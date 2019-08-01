'use strict';

const line = require('@line/bot-sdk');
const express = require('express');

// create LINE SDK config from env variables
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const redis = require('redis');
const redis_client = redis.createClient(17339, "ec2-3-221-124-120.compute-1.amazonaws.com"); // this creates a new client
redis_client.auth("p3f05e8fb3a6ef08a40ee3588cf6e1f5c788f5947cbd77e510d45675633e1d266")
redis_client.on('connect', () => {
  console.log('Redis client connected');
});
// create LINE SDK client
const client = new line.Client(config);
const AUTO_CANCEL_TIME = 10 * 10000; 
const BOOKING_TIME =  20 * 1000;
// create Express app
// about Express itself: https://expressjs.com/
const app = express();

// register a webhook handler with middleware
// about the middleware, please refer to doc
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
  if (event.type == 'postback') {
    let data = event.postback.data;
    let room = data.substring(7,10)
    redis_client.get(room, (error, result) => {
      if (result == null || result == "") {
        if (data.substring(0,6) === 'booked') {
          book_room(event.replyToken, room, user)
          let echo = { type: 'text', text: room + " 已預訂"};
          return client.replyMessage(event.replyToken, echo);
        } else {
          let echo = { type: 'text', text: "尚未訂會議室" };
          return client.replyMessage(event.replyToken, echo);
        }
      } else {
        if (data.substring(0,6) === 'cancel' && result === user) {
          release_room(room)
          let echo = { type: 'text', text: room + '的預訂情況為: 已被取消\n原因: 主動取消'};
          return client.replyMessage(event.replyToken, echo);
        }
        let echo = { type: 'text', text: room + '的預訂情況為: 已被人預訂'};
        return client.replyMessage(event.replyToken, echo);
      }
    })
  }
  if (event.type === 'things') {
    switch(event.things.type){
      case 'link':
        checked_in_handle(event.replyToken, user, event.things.deviceId)
        break
    }
  }
  if (event.type === 'message' && event.message.text.substring(4, 11) === "booking") {
    let text = event.message.text
    let room = text.substring(0,3)
    handle_room_booking(event.replyToken, room, user)
  }  

}
function checked_in_handle(replyToken, user, deviceId) {
  let room
  switch(deviceId) {
    case "t016c1a267d6dd4a777b783ae3033f6f2":
      room = 501
      break
  }
  redis_client.get(room, (error, result) => {
    if(result === user){
      let echo = { type: 'text', text: '您已報到, 會議室:' + room}
      client.replyMessage(replyToken, echo)
    } else {
      let echo = { type: 'text', text: '您尚未訂此間會議室'}
      client.replyMessage(replyToken, echo)
    }
  })
}
function release_room(room) {
    redis_client.del(room)
}
function book_room(replyToken, room, user) {
  redis_client.set(room, user)
  setTimeout(() => {
    redis_client.get(room, (error, result) => {
      console.log(user + "超時未報到")      
      if(result != null && result != user + "arrived"){
        redis_client.del(room)
        client.pushMessage(user,{ type: 'text', text: room + '的預訂情況為: 已被取消\n原因: 超時未報到'})
      }
    })
  }, AUTO_CANCEL_TIME) 

  setTimeout(() => {
    redis_client.get(room, (error, result) => {
      console.log(user + "超過預訂時間")
      if(result != null && result == user + "arrived"){
        redis_client.del(room)
        client.pushMessage(user,{ type: 'text', text: room + '的預訂情況為: 已被取消\n原因: 超過預訂時間'})
      }
    })
  }, BOOKING_TIME) 
}

function handle_room_booking (replyToken, room, user) {
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
                  "color": "#FFCFAD"
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
                  "color": "#FFE4B8"
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