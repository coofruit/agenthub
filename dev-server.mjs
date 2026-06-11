/**
 * 本地 Demo 开发服务器
 * 解决：直接打开 HTML 或 localhost 访问时，上传接口 /api/proxy/up/v1 无 CORS 导致 Failed to fetch
 *
 * 用法：npm start  或  node dev-server.mjs
 * 浏览器打开：http://127.0.0.1:8765/index.html
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./lib/db.cjs').loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8765;
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = process.env.HIAGENT_ORIGIN || 'http://hiagent.aigc.smdata.com.cn';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Apikey, Content-Type, X-Content-Sha256, X-Requested-With, Authorization',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxyToHiAgent(req, res) {
  const targetUrl = `${UPSTREAM}${req.url}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase();
    if (['host', 'connection', 'origin', 'referer', 'content-length', 'transfer-encoding'].includes(k)) continue;
    if (value != null) headers[key] = value;
  }
  if (body?.length) headers['Content-Length'] = String(body.length);

  if (req.url.includes('Action=UploadRaw')) {
    console.log(`[proxy] UploadRaw → ${targetUrl} (${body?.length ?? 0} bytes)`);
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, { method: req.method, headers, body });
  } catch (e) {
    console.error('[proxy] upstream error:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
    res.end(JSON.stringify({ error: '代理请求失败', detail: String(e.message || e) }));
    return;
  }

  const contentType = upstream.headers.get('content-type') || '';
  const isEventStream = contentType.includes('text/event-stream');
  const outHeaders = { ...corsHeaders() };
  const skipOut = new Set([
    'transfer-encoding', 'content-encoding', 'content-length',
    'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers',
  ]);
  upstream.headers.forEach((v, k) => {
    if (skipOut.has(k.toLowerCase())) return;
    outHeaders[k] = v;
  });

  if (isEventStream && upstream.body) {
    res.writeHead(upstream.status, outHeaders);
    Readable.fromWeb(upstream.body).pipe(res);
    return;
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  outHeaders['Content-Length'] = String(buf.length);
  res.writeHead(upstream.status, outHeaders);
  res.end(buf);
}

const { handleAuthRoutes } = require('./lib/auth-routes.cjs');
const fileExtract = (() => {
  try {
    return require('./lib/file-extract.cjs');
  } catch (e) {
    console.warn('[dev-server] 附件解析模块加载失败:', e.message);
    return null;
  }
})();

async function handleExtractFile(req, res) {
  try {
    const raw = await readBody(req);
    const { fileName, mimeType, base64 } = JSON.parse(raw.toString('utf8') || '{}');
    if (!base64 || !fileName) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
      res.end(JSON.stringify({ error: '缺少 fileName 或 base64' }));
      return;
    }
    const buffer = Buffer.from(base64, 'base64');
    if (!fileExtract?.extractFileText) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
      res.end(JSON.stringify({
        error: '附件解析模块未加载。请在项目目录执行 npm install 后重启。',
        text: '',
      }));
      return;
    }
    const text = await fileExtract.extractFileText(buffer, fileName, mimeType || '');
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
    res.end(JSON.stringify({
      text: text || '',
      ok: true,
      extracted: !!(text && text.length >= 8),
      ext,
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const staticHeaders = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ...corsHeaders(),
    };
    if (ext === '.html') {
      staticHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }
    res.writeHead(200, staticHeaders);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const pathname = req.url.split('?')[0];
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/admin/')) {
    const handled = await handleAuthRoutes(req, res, pathname, corsHeaders());
    if (handled !== false) return;
  }

  if (req.url.startsWith('/api/proxy/up/')
    || req.url.startsWith('/api/proxy/upload/')
    || req.url.startsWith('/api/proxy/api/')) {
    await proxyToHiAgent(req, res);
    return;
  }

  if (req.url.split('?')[0] === '/api/local/extract-file') {
    if (req.method === 'GET') {
      const caps = fileExtract?.getExtractCapabilities?.() || { error: 'module not loaded' };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
      res.end(JSON.stringify(caps));
      return;
    }
    if (req.method === 'POST') {
      await handleExtractFile(req, res);
      return;
    }
  }

  serveStatic(req, res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用。可直接访问 http://${HOST}:${PORT}/index.html`);
    console.error(`  或执行: taskkill /F /PID <占用进程PID> 后再启动\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  GoalinWeb 本地 Demo 已启动');
  console.log(`  首页:         http://${HOST}:${PORT}/`);
  console.log(`  婚姻家事咨询: http://${HOST}:${PORT}/agent-family.html`);
  console.log(`  客户需求整理: http://${HOST}:${PORT}/agent-client.html`);
  console.log(`  执行文书起草: http://${HOST}:${PORT}/agent-document.html`);
  console.log(`  国企投资合规: http://${HOST}:${PORT}/agent-compliance.html`);
  console.log(`  税务咨询:     http://${HOST}:${PORT}/agent-tax.html`);
  console.log(`  对话 API 代理: http://${HOST}:${PORT}/api/proxy/api/v1/ → ${UPSTREAM}/api/proxy/api/v1/`);
  console.log(`  上传代理:     http://${HOST}:${PORT}/api/proxy/upload/v1/ → ${UPSTREAM}/api/proxy/upload/v1/`);
  console.log(`  附件解析:     http://${HOST}:${PORT}/api/local/extract-file (项目内 lib/file-extract.cjs)`);
  console.log(`  用户认证:     http://${HOST}:${PORT}/api/auth/`);
  console.log(`  管理接口:     http://${HOST}:${PORT}/api/admin/ (admin)`);
  if (fileExtract?.getExtractCapabilities) {
    const caps = fileExtract.getExtractCapabilities();
    const npmOn = Object.entries(caps.npm || {}).filter(([, v]) => v).map(([k]) => k);
    console.log(`  解析能力:     内置 ${(caps.builtin || []).join('+')}${npmOn.length ? `；npm: ${npmOn.join(', ')}` : '；可选 npm install 增强 PDF/Excel'}`);
  }
  console.log('');
  console.log('  启动命令: npm start');
  console.log('  请勿用 file:// 直接打开 HTML；对话/上传 API 均需经本服务代理。');
  console.log('');
});
