//================================
// 基本設定（必ず置き換えてください）
//================================
var ACCESS_TOKEN    = 'YOUR_LINE_CHANNEL_ACCESS_TOKEN';
var REPLY_URL       = 'https://api.line.me/v2/bot/message/reply';
var PUSH_URL        = 'https://api.line.me/v2/bot/message/push';
var SPREADSHEET_ID  = 'YOUR_SPREADSHEET_ID';
var SHEET_NAME_1    = '未精算';
var SHEET_NAME_2    = '小計';
var SHEET_NAME_3    = '編集者';

// シートオブジェクト
var sh1 = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME_1);
var sh2 = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME_2);
var sh3 = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME_3);

//================================
// ユーザーデータ管理
//================================
function getUserData(userId) {
  var json = PropertiesService.getScriptProperties().getProperty('user_' + userId);
  return json ? JSON.parse(json) : { state: null, data: {}, lastMessageTime: Date.now() };
}
function setUserData(userId, state, data) {
  var obj = { state: state, data: data || {}, lastMessageTime: Date.now() };
  PropertiesService.getScriptProperties().setProperty('user_' + userId, JSON.stringify(obj));
}
function clearUserData(userId) {
  PropertiesService.getScriptProperties().deleteProperty('user_' + userId);
}

//================================
// メイン：Webhook 受信
//================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var events = body.events;
    if (!events || !events.length) return;

    events.forEach(function(ev) {
      var replyToken = ev.replyToken;
      if (!replyToken) return;

      var userId   = ev.source.userId;
      var userData = getUserData(userId);
      var state    = userData.state;
      var msg      = ev.message && ev.message.text && ev.message.text.trim();

      // 二分以上放置でリセット
      if (Date.now() - userData.lastMessageTime > 2*60*1000) {
        clearUserData(userId);
        reply(replyToken, '入力をリセットしました。最初からやり直してください。');
        return;
      }

      // 中断コマンド
      if (msg === 'やめる') {
        clearUserData(userId);
        reply(replyToken, '入力を中断しました。');
        return;
      }

      // 支払い状況照会は常に対応
      if (!state && msg === '今の支払い状況') {
        reply(replyToken, getPaymentStatus());
        return;
      }

      // ステートレス開始
      if (!state) {
        if (msg === 'User1' || msg === 'User2') {
          var name = (msg === 'User1') ? 'User1' : 'User2';
          setUserData(userId, 'waiting_for_date', { name: name });
          sendDateQuestion(replyToken);
        } else {
          reply(replyToken, '「User1」または「User2」と入力してください。');
        }
        return;
      }

      // 各ステート処理
      switch(state) {
        case 'waiting_for_date':
          handleDate(replyToken, msg, userId, userData);
          break;
        case 'waiting_for_location':
          userData.data.location = msg;
          setUserData(userId, 'waiting_for_amount', userData.data);
          reply(replyToken, 'いくら支払った？（例: 5000 または 3000+2000）');
          break;
        case 'waiting_for_amount':
          if (isValidAmount(msg)) {
            userData.data.amount = calculate_message(msg);
            setUserData(userId, 'waiting_for_split', userData.data);
            sendYesNo(replyToken, '割り勘にしますか？');
          } else {
            reply(replyToken, '無効な金額です。数字か計算式で入力してください。');
          }
          break;
        case 'waiting_for_split':
          handleSplit(replyToken, msg, userId, userData);
          break;
        case 'waiting_for_dup_confirm':
          handleDupConfirm(replyToken, msg, userId, userData);
          break;
        default:
          clearUserData(userId);
          reply(replyToken, 'エラーが発生したため、最初からやり直してください。');
      }
    });

    return ContentService
      .createTextOutput(JSON.stringify({status:'success'}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log(err);
    return ContentService
      .createTextOutput(JSON.stringify({status:'error', message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

//================================
// 日付選択ハンドラ
//================================
function handleDate(token, msg, userId, userData) {
  var today = new Date();
  var mmdd  = Utilities.formatDate(today, 'Asia/Tokyo','MM月dd日');
  var yyyymmdd;
  if (msg === mmdd) {
    yyyymmdd = formatDate(mmddToYYYYMMDD(mmdd));
  } else {
    // 「YYYY-MM-DD」形式のピッカー もしくは直接「YYYYMMDD」入力
    if (/^\d{4}-\d{2}-\d{2}$/.test(msg)) {
      yyyymmdd = formatDate(msg.replace(/-/g,'')); 
    } else if (/^\d{8}$/.test(msg) || /^\d{4}$/.test(msg)) {
      if (isValidDate(msg)) yyyymmdd = formatDate(msg);
    }
  }
  if (yyyymmdd) {
    userData.data.date = yyyymmdd;
    setUserData(userId, 'waiting_for_location', userData.data);
    reply(token, '場所を教えてください。');
  } else {
    reply(token, '日付が正しくありません。再度選択してください。');
    sendDateQuestion(token);
  }
}

// MM月DD日 → MMDD
function mmddToYYYYMMDD(mmdd) {
  var parts = mmdd.match(/(\d{2})月(\d{2})日/);
  var d = new Date();
  return d.getFullYear() + parts[1] + parts[2];
}

//================================
// 割り勘ハンドラ
//================================
function handleSplit(token, msg, userId, userData) {
  if (msg === 'はい' || msg === 'いいえ') {
    if (msg === 'はい') userData.data.amount /= 2;
    // 重複チェック
    if (check_duplicate(userData.data)) {
      setUserData(userId, 'waiting_for_dup_confirm', userData.data);
      sendYesNo(token, '重複データがあります。保存しますか？');
    } else {
      finalizeEntry(userData.data, token, userId);
      clearUserData(userId);
    }
  } else {
    sendYesNo(token, '「はい」か「いいえ」を選択してください。');
  }
}

//================================
// 重複確認ハンドラ
//================================
function handleDupConfirm(token, msg, userId, userData) {
  if (msg === 'はい') {
    finalizeEntry(userData.data, token, userId);
  } else {
    reply(token, '書き込みをキャンセルしました。');
  }
  clearUserData(userId);
}

//================================
// 最終保存＆通知
//================================
function finalizeEntry(data, token, authorId) {
  saveData(data);
  var fmt = formatJapaneseDate(data.date);
  reply(token,
    '保存しました：\n' +
    '名前: '    + data.name    + '\n' +
    '日付: '    + fmt          + '\n' +
    '場所: '    + data.location+ '\n' +
    '金額: '    + data.amount  + '円'
  );
  // 他ユーザーへプッシュ通知
  getExcludedUser(authorId).forEach(function(u){
    push(u.id, u.name + ' が入力しました：' + data.amount + '円');
  });
}

//================================
// スプレッドシート操作
//================================
function saveData(d){ sh1.appendRow([new Date(), d.name, d.date, d.location, d.amount]); }
function check_duplicate(d){
  var rows = sh1.getDataRange().getValues();
  for (var i=1;i<rows.length;i++){
    if (rows[i][1]===d.name && String(rows[i][2])===String(d.date) && rows[i][4]===d.amount) return true;
  }
  return false;
}

//================================
// 支払い状況取得
//================================
function getPaymentStatus(){
  var data = sh1.getDataRange().getValues();
  var miz=0, son=0;
  for(var i=1;i<data.length;i++){
    var nm=data[i][1], am=data[i][4];
    if(isNaN(am)) continue;
    if(nm==='User1') miz+=am;
    if(nm==='User2')     son+=am;
  }
  var msg = 'User1: '+miz+'円\nUser2: '+son+'円\n\n【結論】'+getPayResult(miz,son);
  return msg;
}
function getPayResult(miz,son){
  if(miz>son) return 'User2 → User1: '+(miz-son)+'円';
  if(son>miz) return 'User1 → User2: '+(son-miz)+'円';
  return 'イーブンです！';
}

//================================
// ヘルパー: 日付フォーマット
//================================
function isValidDate(input){
  var yNow=new Date().getFullYear();
  if(/^\d{8}$/.test(input)){
    return true;
  }
  if(/^\d{4}$/.test(input)){
    return true;
  }
  return false;
}
function formatDate(input){ 
  if(/^\d{8}$/.test(input)) return input;
  var d=new Date(), y=d.getFullYear(), m=input.slice(0,2), da=input.slice(2,4);
  return ''+y+m+da;
}
function formatJapaneseDate(s){ return s.slice(0,4)+'年'+s.slice(4,6)+'月'+s.slice(6,8)+'日'; }

//================================
// ヘルパー: 金額計算
//================================
function isValidAmount(s){ return !!calculate_message(s); }
function calculate_message(s){
  try{ return eval(s.replace(/×/g,'*').replace(/=/g,'')); }
  catch(e){return null;}
}

//================================
// ヘルパー: 日付質問＆「はい/いいえ」
//================================
function sendDateQuestion(token){
  var t=new Date(), mm=Utilities.formatDate(t,'Asia/Tokyo','MM月dd日');
  UrlFetchApp.fetch(REPLY_URL,{
    headers:{'Content-Type':'application/json; charset=UTF-8','Authorization':'Bearer '+ACCESS_TOKEN},
    method:'post',
    payload: JSON.stringify({
      replyToken:token,
      messages:[{
        type:'text',text:'いつ支払いが生じましたか？',quickReply:{
          items:[
            {type:'action',action:{type:'message',label:mm,text:mm}},
            {type:'action',action:{type:'datetimepicker',label:'他の日を選択',data:'action=selectDate',mode:'date',min:'2023-01-01'}}
          ]
        }
      }]
    })
  });
}
function sendYesNo(token,text){
  UrlFetchApp.fetch(REPLY_URL,{
    headers:{'Content-Type':'application/json; charset=UTF-8','Authorization':'Bearer '+ACCESS_TOKEN},
    method:'post',
    payload: JSON.stringify({
      replyToken:token,
      messages:[{
        type:'template',altText:'Confirm',template:{
          type:'confirm',text:text,actions:[
            {type:'message',label:'はい',text:'はい'},
            {type:'message',label:'いいえ',text:'いいえ'}
          ]
        }
      }]
    })
  });
}

//================================
// 返信・プッシュ
//================================
function reply(token, text){
  UrlFetchApp.fetch(REPLY_URL,{
    headers:{'Content-Type':'application/json; charset=UTF-8','Authorization':'Bearer '+ACCESS_TOKEN},
    method:'post',
    payload: JSON.stringify({ replyToken:token, messages:[{type:'text',text:text}] })
  });
}
function push(to, text){
  UrlFetchApp.fetch(PUSH_URL,{
    headers:{'Content-Type':'application/json; charset=UTF-8','Authorization':'Bearer '+ACCESS_TOKEN},
    method:'post',
    payload: JSON.stringify({ to:to, messages:[{type:'text',text:text}] })
  });
}

//================================
// 他ユーザー取得（固定 or シートから動的に取得）
//================================
function getExcludedUser(authorId){
  // 固定例。必要なら sh3 から動的に取得してください。
  var users = [
    { id: 'USER_ID_1', name: 'User1' },
    { id: 'USER_ID_2', name: 'User2' }
  ];
  return users.filter(function(u){ return u.id !== authorId; });
}
