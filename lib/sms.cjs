'use strict';

const crypto = require('crypto');

const APP_ID = process.env.SMS_APP_ID;
const APP_KEY = process.env.SMS_APP_KEY;
const SIGN    = process.env.SMS_SIGN;
const TPL_ID  = Number(process.env.SMS_TEMPLATE_ID);

function checkConfig() {
  if (!APP_ID || !APP_KEY)         throw new Error('SMS_APP_ID / SMS_APP_KEY 未配置');
  if (!SIGN || SIGN === '待填写')   throw new Error('SMS_SIGN 未配置，请在 .env 填写短信签名名称');
  if (!TPL_ID || isNaN(TPL_ID))    throw new Error('SMS_TEMPLATE_ID 未配置，请在 .env 填写模板 ID');
}

async function sendVerificationSms(phone, code) {
  checkConfig();
  const rand = Math.floor(Math.random() * 1_000_000);
  const time = Math.floor(Date.now() / 1000);
  const sig = crypto.createHash('sha256')
    .update(`appkey=${APP_KEY}&random=${rand}&time=${time}&mobile=${phone}`)
    .digest('hex');

  const body = {
    to:     [phone],
    time,
    sig,
    tel:    { nationcode: '86', mobile: phone },
    tpl_id: TPL_ID,
    params: [code, '5'],
    sign:   SIGN,
  };

  const res = await fetch(
    `https://yun.tim.qq.com/v5/tlssmssvr/sendsms?sdkappid=${APP_ID}&random=${rand}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    }
  );

  const json = await res.json();
  if (json.result !== 0) {
    throw new Error(`短信发送失败 (${json.result}): ${json.errmsg || '未知错误'}`);
  }
  return true;
}

module.exports = { sendVerificationSms };
