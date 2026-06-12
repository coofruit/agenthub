'use strict';

/**
 * 阿里云短信服务（Dysmsapi 2017-05-25）
 * 使用 RPC 风格 API + HMAC-SHA1 签名，仅依赖 Node 内置 crypto，无需额外 npm 包。
 * 对外导出 sendVerificationSms(phone, code)，与上层调用保持一致。
 */

const crypto = require('crypto');

const AK_ID      = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
const AK_SECRET  = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
const SIGN_NAME  = process.env.ALIYUN_SMS_SIGN_NAME;
const TPL_CODE   = process.env.ALIYUN_SMS_TEMPLATE_CODE;
// 模板里的变量名，例如模板内容为「验证码 ${code}」则填 code
const PARAM_NAME = process.env.ALIYUN_SMS_PARAM_NAME || 'code';
const REGION     = process.env.ALIYUN_SMS_REGION || 'cn-hangzhou';

const ENDPOINT = 'https://dysmsapi.aliyuncs.com/';

function checkConfig() {
  if (!AK_ID || !AK_SECRET)              throw new Error('ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET 未配置');
  if (!SIGN_NAME || SIGN_NAME === '待填写') throw new Error('ALIYUN_SMS_SIGN_NAME 未配置，请填写短信签名名称');
  if (!TPL_CODE || TPL_CODE === '待填写')   throw new Error('ALIYUN_SMS_TEMPLATE_CODE 未配置，请填写模板 CODE（形如 SMS_123456789）');
}

// 阿里云 POP 协议要求的百分号编码（与 encodeURIComponent 有细微差异）
function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

async function sendVerificationSms(phone, code) {
  checkConfig();

  const params = {
    // ── 公共参数 ──
    AccessKeyId:      AK_ID,
    Action:           'SendSms',
    Format:           'JSON',
    RegionId:         REGION,
    SignatureMethod:  'HMAC-SHA1',
    SignatureNonce:   crypto.randomUUID(),
    SignatureVersion: '1.0',
    Timestamp:        new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version:          '2017-05-25',
    // ── 业务参数 ──
    PhoneNumbers:     phone,
    SignName:         SIGN_NAME,
    TemplateCode:     TPL_CODE,
    TemplateParam:    JSON.stringify({ [PARAM_NAME]: code }),
  };

  // 1. 按 key 字典序排序并规范化查询串
  const canonical = Object.keys(params).sort()
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');

  // 2. 构造待签名串：HTTPMethod & encode("/") & encode(canonical)
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;

  // 3. HMAC-SHA1 签名，密钥为 AccessKeySecret + "&"
  const signature = crypto
    .createHmac('sha1', AK_SECRET + '&')
    .update(stringToSign)
    .digest('base64');

  // 4. 发送请求
  const url = `${ENDPOINT}?Signature=${percentEncode(signature)}&${canonical}`;
  const res = await fetch(url, { method: 'GET' });
  const json = await res.json();

  if (json.Code !== 'OK') {
    throw new Error(`阿里云短信发送失败 (${json.Code}): ${json.Message || '未知错误'}`);
  }
  return true;
}

module.exports = { sendVerificationSms };
