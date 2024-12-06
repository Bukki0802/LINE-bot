//********************************
//　基本設定情報
//********************************

var ACCESS_TOKEN = YOUR_ACCESS_TOKEN //Messaging APIチャネル・チャネルアクセストークンで発行したトークンを設定
var URL = 'https://api.line.me/v2/bot/message/reply'; // 応答メッセージ用のAPI URL
var ID = YOUR_SPREADSHEETS_ID ; //スプレッドシートIDを設定　https://docs.google.com/spreadsheets/d/<スプレッドシートID>/edit
var SHEET_NAME_1 = 'YOUR_SHEETS_NAME'
var SHEET_NAME_2 = 'YOUR_SHEETS_NAME'

var sh1 = SpreadsheetApp.openById(ID).getSheetByName(SHEET_NAME_1);
var sh2 = SpreadsheetApp.openById(ID).getSheetByName(SHEET_NAME_2);
var last_row_sh1 = sh1.getLastRow();
var last_row_sh2 = sh2.getLastRow();

// ユーザーの状態とデータを取得する関数
function getUserData(userId) {
  const userDataJson = PropertiesService.getScriptProperties().getProperty(`user_${userId}`);
  if (userDataJson) {
    return JSON.parse(userDataJson);
  }
  return { state: null, data: {}, lastMessageTime: new Date().getTime() };
}

// ユーザーの状態とデータを設定する関数
function setUserData(userId, state, data = {}) {
  const userData = { 
    state: state, 
    data: data,
    lastMessageTime: new Date().getTime() // 現在の時刻をミリ秒で記録
  };
  PropertiesService.getScriptProperties().setProperty(`user_${userId}`, JSON.stringify(userData));
}

// ユーザーの状態とデータをクリアする関数
function clearUserData(userId) {
  PropertiesService.getScriptProperties().deleteProperty(`user_${userId}`);
}

//********************************
// 日付の形式を検証する関数
//********************************

function isValidDate(input) {
  const currentYear = new Date().getFullYear(); // 現在の年を取得

  // 入力がYYYYMMDD形式の場合
  const fullDateRegex = /^\d{8}$/;
  if (fullDateRegex.test(input)) {
    const year = parseInt(input.substring(0, 4), 10);
    const month = parseInt(input.substring(4, 6), 10);
    const day = parseInt(input.substring(6, 8), 10);
    return isValidMonthAndDay(year, month, day);
  }

  // 入力が4桁の数字（MMDD形式）の場合
  const mmddRegex = /^\d{4}$/;
  if (mmddRegex.test(input)) {
    const month = parseInt(input.substring(0, 2), 10); // 最初の2桁を月として解釈
    const day = parseInt(input.substring(2, 4), 10);   // 後ろの2桁を日として解釈
    return isValidMonthAndDay(currentYear, month, day);
  }

  // それ以外は無効
  return false;
}

function isValidMonthAndDay(year, month, day) {
  // 月が01-12の範囲か確認
  if (month < 1 || month > 12) {
    return false;
  }

  // 日付が1-31の範囲か確認
  if (day < 1 || day > 31) {
    return false;
  }

  // 月ごとに日数を確認 (簡易版、2月のうるう年などを考慮したい場合はさらに修正可能)
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    daysInMonth[1] = 29; // うるう年の2月
  }
  return day <= daysInMonth[month - 1];
}

function isLeapYear(year) {
  // うるう年判定
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function formatDate(input) {
  const currentYear = new Date().getFullYear();

  // 入力がYYYYMMDD形式の場合
  const fullDateRegex = /^\d{8}$/;
  if (fullDateRegex.test(input)) {
    return input; // そのまま返す
  }

  // 入力がMMDD形式の場合
  const mmddRegex = /^\d{4}$/;
  if (mmddRegex.test(input)) {
    const month = input.substring(0, 2);
    const day = input.substring(2, 4);
    return `${currentYear}${month}${day}`; // YYYYMMDD形式に変換
  }

  // 無効な形式
  return null;
}

//********************************
// 日付の形式を日本語形式にする
//********************************

// 日本語形式で日付をフォーマットする関数
function formatJapaneseDate(date) {
  const year = date.substring(0, 4);
  const month = date.substring(4, 6);
  const day = date.substring(6, 8);
  return `${year}年${month}月${day}日`;
}

//********************************
// 金額の入力を検証する関数
//********************************
// 金額の検証とフォーマットを改善
function isValidAmount(input) {
  // 数字だけにして、"円"などの文字を削除
  const numericValue = input.replace(/[^\d]/g, '');
  const calculation = calculate_message(numericValue)
  const amount = parseInt(calculation, 10);

  // 金額が正の整数であればそのまま返す
  return amount !== null ? amount : null;
}

//********************************
// スプレッドシートに保存する関数
//********************************

// 収集したデータをスプレッドシートに保存する関数
function saveData(data) {
  const sheet = SpreadsheetApp.openById(ID).getSheetByName(SHEET_NAME_1);
  sheet.appendRow([new Date(), data.name, data.date, data.location, data.amount]);
}

//********************************
// メイン関数
//********************************
function doPost(e) {
  try{
    const json = JSON.parse(e.postData.contents);
    const events = json.events;
    //返信するためのトークン取得
    var reply_token = json.events[0].replyToken;
    if (typeof reply_token === 'undefined') {
        return;
    }

    events.forEach(event => {
        const userId = event.source.userId;
        const userData = getUserData(userId);
        const currentState = userData.state;

      // まずはpostbackイベントを先に処理
      if (event.type === 'postback') {
        // datetimepickerで日付が選択された場合
        if (currentState === 'waiting_for_date' && event.postback.params && event.postback.params.date) {
          const selectedDate = event.postback.params.date; // 例: "2024-12-25"
          const dateParts = selectedDate.split('-');       // ["2024", "12", "25"]
          const month = dateParts[1];
          const day = dateParts[2];

          // yyyyddmm形式に変換（データ保存用）
          const formattedDate = formatDateForUser(selectedDate); 
          userData.data.date = formattedDate;

          // 表示用は「MM月DD日」にする
          const monthDayFormat = `${month}月${day}日`;

          setUserData(userId, 'waiting_for_location', userData.data);
          replyMessage(event.replyToken, `選択された日付は${monthDayFormat}です。\nどこに行った？`);
        }
        return;
      }

      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text.trim();

        // ユーザーの最終メッセージ時間を取得
        const currentTime = new Date().getTime();
        const timeSinceLastMessage = currentTime - userData.lastMessageTime;

        // 2分以上経過している場合はリセット
        if (timeSinceLastMessage >= 2 * 60 * 1000) { // 2分 (120秒) = 2 * 60 * 1000ミリ秒
          clearUserData(userId);
          replyMessage(event.replyToken, "2分以上新しい入力がなかったため、入力がリセットされました。");
          return;
        }

        //　やめる　が送信されたときの処理
        if (userMessage == "やめる"){
          clearUserData(userId);
          replyMessage(event.replyToken, "入力を中断しました");
          return 
        }

        // もしユーザーが最初に「みずたに」または「そのだ」を送った後に「今の支払い状況」を送った場合、リセット
        if (currentState === 'waiting_for_payment_status' || currentState === 'waiting_for_date' || currentState === 'waiting_for_location') {
          if (userMessage === "今の支払い状況") {
            clearUserData(userId);
            replyMessage(event.replyToken, "入力をリセットしました、最初からやり直してください");
            return;
          }
        }

        if (!currentState) {
          if (userMessage === "今の支払い状況") {
            // 支払い状況を表示する
            const paymentStatusMessage = getPaymentStatus();
            replyMessage(event.replyToken, paymentStatusMessage);
          
          // ユーザーが特定のコマンドを送信したかチェック
          }else if (userMessage === 'みずたに' || userMessage === 'そのだ' || userMessage === '水谷' || userMessage === '其田') { 
            if (userMessage === 'みずたに' || userMessage === '水谷') {
              // みずたに or 水谷の場合、名前を「水谷」に統一
              userData.data = { name: 'みずたに' }; // 名前を水谷に設定
              setUserData(userId, 'waiting_for_date', userData.data);
            } else if (userMessage === 'そのだ' || userMessage === '其田') {
              userData.data = { name: userMessage }; // 名前を記録
              setUserData(userId, 'waiting_for_date', userData.data);
            }
            sendDateQuestion(event.replyToken);
          } else {
            // 特定のコマンド以外のメッセージに対する応答
            replyMessage(event.replyToken, 'ボタンを押して入力を開始。');
          }

        } else if (currentState === 'waiting_for_date') {
          // クイックリプライで今日の日付を受け取る場合
          // mmddToday (例: "08月23日") から yyyyddmm 形式へ変換する処理
          // クイックリプライで提示した今日の日付（例: "08月23日"）を判定するためには、
          // sendDateQuestion で生成した mmddToday と一致するか確認します。
          // まず、todayを取得し、mmddToday生成方法と同じ処理で再生成します
          var today = new Date();
          var mmddToday = Utilities.formatDate(today, 'Asia/Tokyo', 'MM月dd日');
          // 今日の日付をyyyyddmm形式に変換
          var yyyy = today.getFullYear();
          var month = ("0" + (today.getMonth() + 1)).slice(-2);
          var day = ("0" + today.getDate()).slice(-2);
          var yyyyddmm = yyyy + day + month;

          if (userMessage === mmddToday) {
            // ユーザーが今日の日付を選んだ場合
            userData.data.date = yyyyddmm;
            setUserData(userId, 'waiting_for_location', userData.data);
            replyMessage(event.replyToken, `選択された日付は${mmddToday}です。\nどこに行った？`);

          } else {
            // ユーザーが想定外のメッセージを送った場合は再度日付選択を促す
            replyMessage(event.replyToken, '日付が選択されていません。\nもう一度日付を選んでください。');
            sendDateQuestion(event.replyToken);
          }

        } else if (currentState === 'waiting_for_location') {
          // ユーザーが場所を入力
          userData.data.location = userMessage;
          setUserData(userId, 'waiting_for_amount', userData.data);
          replyMessage(event.replyToken, 'いくら支払った？（金額、もしくは計算式）。');

        } else if (currentState === 'waiting_for_amount') {
          // ユーザーが金額を入力
          if (isValidAmount(userMessage)) {
            userData.data.amount = calculate_message(userMessage);
            // 割り勘かどうかを聞く
            sendYesNoQuestion(event.replyToken);
            setUserData(userId, 'waiting_for_split_confirmation', userData.data); // 割り勘確認の状態に遷移
          } else {
            replyMessage(event.replyToken, '無効な金額です。数字で入力してください（例: 5000 または 5000円）。');
          }

        } else if (currentState === 'waiting_for_split_confirmation') {
          // ユーザーの「はい」または「いいえ」の応答を処理
          if (userMessage === "はい") {
            // 割り勘の場合、金額を半分にする
            userData.data.amount = userData.data.amount / 2;
          }else if (userMessage === "いいえ"){
          } else {
            replyMessage(event.replyToken, "「はい」または「いいえ」を選択してください。");
          } 
          saveData(userData.data);
          clearUserData(userId); // データをクリア
          const formattedDate = formatJapaneseDate(userData.data.date); // 日本語形式に変換
          replyMessage(event.replyToken, `データが保存されました\n金額: ${userData.data.amount}円\n払った人: ${userData.data.name}\n日にち: ${formattedDate}\n場所: ${userData.data.location}`);
        } 
      }
    });

    return ContentService.createTextOutput(JSON.stringify({status: 'success'})).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
    // エラーハンドリング
    Logger.log('Error in doPost: ' + error);
    return ContentService.createTextOutput(JSON.stringify({status: 'error', message: error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

//********************************
//　シート読み込み処理
//********************************

// 支払い状況を取得する関数
function getPaymentStatus() {
  const sheet = SpreadsheetApp.openById(ID).getSheetByName(SHEET_NAME_1);
  const data = sheet.getDataRange().getValues(); // シートのデータを取得

  let mizutani = 0; // 水谷の合計
  let sonoda = 0; // 其田の合計

  // データをループしてB列が「水谷」または「其田」の場合にE列の値を合計
  for (let i = 1; i < data.length; i++) {  // 1行目はヘッダーなので2行目からループ
    const name = data[i][1]; // B列（名前）
    const amount = data[i][4]; // E列（支払金額）

    // 金額が数値でない場合はスキップ
    if (isNaN(amount)) continue;

    if (name === 'みずたに') {
      mizutani += amount; // 水谷の合計に加算
    } else if (name === 'そのだ') {
      sonoda += amount; // 其田の合計に加算
    }
  }
  
  // メッセージを作成
  const message = `其田の支払い: ${sonoda}円 \n水谷の支払い: ${mizutani}円`;
  const result = getPayresult(mizutani, sonoda)


  return message + '\n\n' + "【結論】" + result;
}

// どっちが支払う必要があるかを計算する
function getPayresult(mizutani, sonoda){
  // 水谷が支払うべき場合
  if (mizutani > sonoda) {
    const amountToPay = mizutani - sonoda;
    return `其田 -> 水谷: ${amountToPay} 円`;
  }
  
  // 其田が支払うべき場合
  else if (sonoda > mizutani) {
    const amountToPay = sonoda - mizutani;
    return `水谷 -> 其田: ${amountToPay} 円`;
  }
  
  // 同じ金額の場合は、支払いの必要なし
  else {
    return "イーブン！";
  }
}

//********************************
//　返信処理
//********************************
function replyMessage(reply_token, message){
  UrlFetchApp.fetch(URL, {
      'headers': {
          'Content-Type': 'application/json; charset=UTF-8',
          'Authorization': 'Bearer ' + ACCESS_TOKEN,
      },
      'method': 'post',
      'payload': JSON.stringify({
          'replyToken': reply_token,
          'messages': [{
            "type": "text",
            "text": message,
          }],
      }),
  });
  return ContentService.createTextOutput(JSON.stringify({ 'content': 'post ok' })).setMimeType(ContentService.MimeType.JSON);
}

//********************************
//　日付の形式を変える
//********************************

function formatDateForUser(dateString) {
  // 受け取った日付の形式は yyyy-mm-dd 形式なので、これを yyyyddmm 形式に変換
  const dateParts = dateString.split('-'); // 日付を "-" で分割
  const year = dateParts[0];   // 年
  const month = dateParts[1];  // 月
  const day = dateParts[2];    // 日

  return `${year}${month}${day}`; // yyyyddmm 形式に変換
}


//********************************
// はい/いいえの質問を送信する関数
//********************************
function sendYesNoQuestion(replyToken) {
  UrlFetchApp.fetch(URL, {
      'headers': {
          'Content-Type': 'application/json; charset=UTF-8',
          'Authorization': 'Bearer ' + ACCESS_TOKEN,
      },
      'method': 'post',
      'payload': JSON.stringify({
          'replyToken': replyToken,
          'messages': [{
            "type": "template",
            "altText": "this is a confirm template",
            "template": {
              "type": "confirm",
              "text": "割り勘する？",
              "actions": [
                {
                  "type": "message",
                  "label": "はい",
                  "text": "はい"
                },
                {
                  "type": "message",
                  "label": "いいえ",
                  "text": "いいえ"
                }
              ]
            }
          }]
        }),
          });
          return ContentService.createTextOutput(JSON.stringify({ 'content': 'post ok' })).setMimeType(ContentService.MimeType.JSON);
        }

//********************************
//　計算処理
//********************************

function calculate_message(userMessage){
  //　ユーザーからのメッセージに含まれる　×を数式に置き換える
  if (userMessage.match(/[\d\s\+\-\*\/\=\(\)×]/)) {
    // 数式に含まれる「×」を「*」に置き換える
    let expression = userMessage.replace(/×/g, '*');
    expression = expression.replace(/=/g, "");
 
    try {
      // eval() を使用して計算
      const result = eval(expression);
      return result;
    } catch (error) {
      return null;
    }
  }
}

//********************************
// 日付の選択を送信する関数
//********************************
function sendDateQuestion(replyToken) {
  // 今日の日付を取得
  var today = new Date();
  // 日付を MM月dd日 形式にフォーマットする関数
  function formatDateMMDD(date) {
    return Utilities.formatDate(date, 'Asia/Tokyo', 'MM月dd日');
  }
  var mmddToday = formatDateMMDD(today);

  UrlFetchApp.fetch(URL, {
      'headers': {
          'Content-Type': 'application/json; charset=UTF-8',
          'Authorization': 'Bearer ' + ACCESS_TOKEN,
      },
      'method': 'post',
      'payload': JSON.stringify({
          'replyToken': replyToken,
          'messages': [{
            "type": "text",
            "text": "いつその支払いは生じた？",
            "quickReply": {
              "items": [
                {
                  "type": "action",
                  "action": {
                    "type": "message",
                    "label": mmddToday,
                    "text": mmddToday,
                  }
                },
                {
                  "type": "action",
                  "action": {
                    "type": "datetimepicker",
                    "label": "今日以外の場合",
                    "mode": "date",
                    "data": "action=selectDate", // 不要な "text" フィールドを削除
                    "min": "2023-07-01"
                    }
                }
              ]
            }
          }]
        }),
      });
    return ContentService.createTextOutput(JSON.stringify({ 'content': 'post ok' })).setMimeType(ContentService.MimeType.JSON);
  }
