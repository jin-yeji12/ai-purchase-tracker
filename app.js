const express = require('express');
const { WebClient } = require('@slack/web-api');
const { createEventAdapter } = require('@slack/events-api');
const { google } = require('googleapis');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

// 환경 변수 설정 (실제 사용시 .env 파일에서 관리)
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID; // 스프레드시트 ID
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// Slack 클라이언트 초기화
const slack = new WebClient(SLACK_BOT_TOKEN);

// Google Sheets 설정
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: GOOGLE_PRIVATE_KEY,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// 미들웨어
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Slack 서명 검증 미들웨어
function verifySlackRequest(req, res, next) {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  const body = JSON.stringify(req.body);

  if (!signature || !timestamp) {
    return res.status(400).send('Invalid request');
  }

  const time = Math.floor(new Date().getTime() / 1000);
  if (Math.abs(time - timestamp) > 300) {
    return res.status(400).send('Request too old');
  }

  const sigBasestring = 'v0:' + timestamp + ':' + body;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(sigBasestring, 'utf8')
    .digest('hex');

  if (signature !== mySignature) {
    return res.status(400).send('Invalid signature');
  }

  next();
}

// 구글 스프레드시트에 데이터 추가 함수
async function addToSpreadsheet(purchaserName, programName, amount, date) {
  try {
    const values = [
      [
        date, // 날짜
        purchaserName, // 구입자
        programName, // 프로그램명
        amount, // 금액
        '', // 비고 (빈값)
      ]
    ];

    const resource = {
      values,
    };

    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'Sheet1!A:E', // A부터 E열까지
      valueInputOption: 'USER_ENTERED',
      resource,
    });

    console.log('Successfully added to spreadsheet:', result.data);
    return true;
  } catch (error) {
    console.error('Error adding to spreadsheet:', error);
    return false;
  }
}

// 슬랙 사용자 정보 가져오기
async function getSlackUserInfo(userId) {
  try {
    const result = await slack.users.info({ user: userId });
    return result.user.real_name || result.user.display_name || result.user.name;
  } catch (error) {
    console.error('Error getting user info:', error);
    return 'Unknown User';
  }
}

// 입력 파싱 및 검증
function parseInput(text) {
  // 다양한 입력 형식 지원
  // 예: "ChatGPT Plus 20000" 또는 "Claude Pro $20" 또는 "Midjourney 10달러"
  const patterns = [
    /^(.+?)\s+(\$?[\d,]+(?:\.\d{2})?)\s*(?:달러|원|USD|KRW)?$/,
    /^(.+?)\s+(\d+(?:\.\d{2})?)\s*$/
  ];

  for (let pattern of patterns) {
    const match = text.trim().match(pattern);
    if (match) {
      let programName = match[1].trim();
      let amount = match[2].replace(/[\$,]/g, '').trim();
      
      // 숫자 검증
      if (!isNaN(parseFloat(amount))) {
        return {
          programName,
          amount: parseFloat(amount)
        };
      }
    }
  }

  return null;
}

// 슬랙 슬래시 커맨드 핸들러
app.post('/slack/commands', async (req, res) => {
  console.log('Slack request received');
  
  const { text } = req.body;
  
  if (!text || text.trim() === '') {
    res.status(200).send({
      text: '사용법: /ai구매 [프로그램명] [금액]\n예시: /ai구매 ChatGPT Plus 20$',
      response_type: 'ephemeral'
    });
    return;
  }
  
  // 간단한 파싱
  const parts = text.split(' ');
  if (parts.length < 2) {
    res.status(200).send({
      text: '형식이 올바르지 않습니다. 예시: /ai구매 ChatGPT Plus 20$',
      response_type: 'ephemeral'
    });
    return;
  }
  
  const amount = parts[parts.length - 1].replace(/[^0-9.]/g, '');
  const programName = parts.slice(0, -1).join(' ');
  const currentDate = new Date().toLocaleDateString('ko-KR');
  
  try {
    // 구글 시트에 데이터 추가 시도
    const values = [[currentDate, '테스트사용자', programName, amount, '']];
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: 'Sheet1!A:E',
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });
    
    res.status(200).send({
      text: `구매 내역 등록 완료!\n프로그램: ${programName}\n금액: ${amount}`,
      response_type: 'ephemeral'
    });
    
  } catch (error) {
    console.error('Google Sheets error:', error);
    res.status(200).send({
      text: `파싱 성공했지만 구글 시트 연동 실패\n프로그램: ${programName}\n금액: ${amount}`,
      response_type: 'ephemeral'
    });
  }
});


// 헬스 체크
app.get('/', (req, res) => {
  res.send('AI Purchase Tracker Slack App is running!');
});

// 서버 시작
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log('AI Purchase Tracker Slack App is ready!');
});


module.exports = app;






