/**
 * HiAgent 平台 API 地址
 * - 浏览器生产环境：走本站 /agent-hub/api/proxy 代理（与内置智能体一致）
 * - 浏览器其他环境：可直连 HiAgent（优先 HTTPS，与官方文档一致）
 * - 服务端校验/代理：使用 HTTP 上游（机房到 HiAgent HTTPS 偶发超时）
 */
const HIAGENT_ORIGIN_HTTP = 'http://hiagent.aigc.smdata.com.cn';
const HIAGENT_ORIGIN_HTTPS = 'https://hiagent.aigc.smdata.com.cn';
const HIAGENT_ORIGIN = process.env.HIAGENT_ORIGIN || HIAGENT_ORIGIN_HTTP;
const HIAGENT_API_BASE_HTTPS = `${HIAGENT_ORIGIN_HTTPS}/api/proxy/api/v1`;
const HIAGENT_UPLOAD_BASE_HTTPS = `${HIAGENT_ORIGIN_HTTPS}/api/proxy/upload/v1`;
const HIAGENT_API_BASE_SERVER = `${HIAGENT_ORIGIN.replace(/\/$/, '')}/api/proxy/api/v1`;

/** 注入到上架生成的 HTML 页面中的运行时脚本 */
const PUBLISHED_HIAGENT_RUNTIME = `const HIAGENT_ORIGIN = 'http://hiagent.aigc.smdata.com.cn';
const HIAGENT_API_BASE = 'https://hiagent.aigc.smdata.com.cn/api/proxy/api/v1';
const HIAGENT_UPLOAD_BASE = 'https://hiagent.aigc.smdata.com.cn/api/proxy/upload/v1';

function isLocalDemoHost() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1'
    || (typeof isProdHost === 'function' && isProdHost());
}

function canUseLocalServices() {
  return isLocalDemoHost();
}

function isHiAgentServiceUrl(url) {
  return !!url && /^https?:\\/\\/hiagent\\.aigc\\.smdata\\.com\\.cn/i.test(url);
}

/** 生产/本地 dev-server 走本站代理；其余环境直连 HiAgent HTTPS API */
function resolveApiBase() {
  if (isLocalDemoHost()) {
    const base = typeof getAppBasePath === 'function' ? getAppBasePath() : '';
    return \`\${location.origin}\${base}/api/proxy/api/v1\`;
  }
  return HIAGENT_API_BASE;
}

function resolveUploadApiBase() {
  if (isLocalDemoHost()) {
    const base = typeof getAppBasePath === 'function' ? getAppBasePath() : '';
    return \`\${location.origin}\${base}/api/proxy/upload/v1\`;
  }
  return HIAGENT_UPLOAD_BASE;
}`;

module.exports = {
  HIAGENT_ORIGIN,
  HIAGENT_ORIGIN_HTTP,
  HIAGENT_ORIGIN_HTTPS,
  HIAGENT_API_BASE_HTTPS,
  HIAGENT_UPLOAD_BASE_HTTPS,
  HIAGENT_API_BASE_SERVER,
  PUBLISHED_HIAGENT_RUNTIME,
};
