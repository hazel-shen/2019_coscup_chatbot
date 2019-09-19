'use strict';
const line = require('@line/bot-sdk');
const express = require('express');

// create LINE SDK config from env variables
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  redisAuth: process.env.REDIS_AUTH,
  deviceIdOne: process.env.DEVICE_ID_ONE,
  roomIdOne: process.env.ROOM_ID_ONE,
  deviceIdTwo: process.env.DEVICE_ID_TWO,
  roomIdTwo: process.env.ROOM_ID_TWO,
};
const redis = require('redis');
const redis_client = redis.createClient(config.redisPort, config.redisHost); // this creates a new client
redis_client.auth(config.redisAuth)
redis_client.on('connect', () => {
  console.log('Redis client connected');
});

const client = new line.Client(config);
const AUTO_CANCEL_TIME = 20 * 10000; 
const BOOKING_TIME =  60 * 1000;
const app = express();

app.post('/callback', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// event handler
function handleEvent(event) {
  let user = event.source.userId
  switch(event.type) {
    case 'postback':
      let data = event.postback.data;
      let replyToken = event.replyToken
      let room = data.substring(7,10)
      handlePostback(data, room, replyToken, user)
      break
    case 'things':
      handleThingsEvent(event, user)
      break
    case 'message':
      console.log(event)
      if (event.message.text.substring(4, 11) === "booking") {
        let text = event.message.text
        let room = text.substring(0,3)
        richmenuProcessing(event.replyToken, room, user)
       }
      break
  }
}
function handleThingsEvent(event, user) {
  let room
  let deviceId = event.things.deviceId
  console.log(deviceId)
  switch(deviceId) {
    case config.deviceIdOne:
      room = config.roomIdOne
      break
    case config.deviceIdTwo:
      room = config.roomIdTwo
  }
  switch(event.things.type){
    case 'link':
      checkedIn(event.replyToken, user, room)
      break
    case 'unlink':
      checkedOut(event.replyToken, user, room)
      break
  }
}
function handlePostback (data, room, replyToken, user) {
  redis_client.get(room, (error, result) => {
    if (result == null || result == "") {
      if (data.substring(0,6) === 'booked') {
        roomBooking(replyToken, room, user)
        let echo = { type: 'text', text: room + " 已預訂"};
        return client.replyMessage(replyToken, echo);
      } else {
        let echo = { type: 'text', text: "尚未訂會議室" };
        return client.replyMessage(replyToken, echo);
      }
    } else {
      if (data.substring(0,6) === 'cancel' && result === user) {
        redis_client.del(room)
        let echo = { type: 'text', text: room + '的預訂情況為: 已被取消\n原因: 主動取消'};
        return client.replyMessage(replyToken, echo);
      }
      let echo = { type: 'text', text: room + '的預訂情況為: 已被人預訂'};
      return client.replyMessage(replyToken, echo);
    }
  })
}
function checkedIn(replyToken, user,  room) {
  redis_client.get(room, (error, result) => {
    if(result === user){
      redis_client.set(room, user + 'arrived')
      let echo = { type: 'text', text: '您已報到, 會議室:' + room}
      client.replyMessage(replyToken, echo)
    } else {
      let echo = { type: 'text', text: '您尚未訂此間會議室'}
      client.replyMessage(replyToken, echo)
    }
  })
}
function checkedOut(replyToken, user,  room) {
  redis_client.get(room, (error, result) => {
    if(result === user + "arrived") {
      redis_client.del(room)
      let echo = { type: 'text', text: '您已釋出會議室:' + room}
      client.replyMessage(replyToken, echo)
    } else if (result === user) {
      let echo = { type: 'text', text: '您尚未報到, 會議室' + room}
      client.replyMessage(replyToken, echo)
    } else {
      let echo = { type: 'text', text: '您尚未訂此間會議室'}
      client.replyMessage(replyToken, echo)
    }
  })
}
function roomBooking(replyToken, room, user) {
  redis_client.set(room, user)
  setTimeout(() => {
    redis_client.get(room, (error, result) => {
      if(result != null && result != user + "arrived"){
        console.log(user + "超時未報到")      
        redis_client.del(room)
        client.pushMessage(user,{ type: 'text', text: room + '的預訂情況為: 已被取消\n原因: 超時未報到'})
      }
    })
  }, AUTO_CANCEL_TIME) 

  setTimeout(() => {
    redis_client.get(room, (error, result) => {
      if(result != null && result == user + "arrived"){
        console.log(user + "超過預訂時間")
        redis_client.del(room)
        client.pushMessage(user,{ type: 'text', text: room + '的預訂情況為: 已被取消\n原因: 超過預訂時間'})
      }
    })
  }, BOOKING_TIME) 
}

function richmenuProcessing (replyToken, room, user) {
  redis_client.get(room, (error, result) => {
    if (result == null || result == "") {
      return client.replyMessage(
        replyToken,
        {  
          "type": "flex",
          "altText": '請問是否預訂會議室 - ' + room,
          "contents": {
            "type": "bubble",
            "body": {
              "type": "box",
              "layout": "vertical",
              "contents": [
                {
                  "type": "button",
                  "action": {  
                    "type":"postback",
                    "label":"預訂" + room,
                    "data":"booked=" + room,
                    "text":"預訂" + room
                 },
                  "style": "primary",
                  "color": "#004D99"
                },
                {
                  "type": "button",
                  "action": {  
                    "type":"postback",
                    "label":"取消預訂" + room,
                    "data":"cancel=" + room,
                    "text":"取消預訂" + room
                 },
                  "style": "primary",
                  "color": "#A52A2A"
                }
              ]
            }
          }
        }
      )
    } else {
      let echo = { type: 'text', text: room + '的預訂情況為: 已被人預訂'};
      return client.replyMessage(replyToken, echo);

    }
  });
}

// listen on port
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`listening on ${port}`);
});