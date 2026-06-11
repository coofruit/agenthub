const { initSchema } = require('./db.cjs');
const auth = require('./auth.cjs');

let readyPromise;

function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initSchema();
      await auth.ensureAdminUser();
    })();
  }
  return readyPromise;
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString('utf8'));
}

async function requireUser(req) {
  const token = auth.getBearerToken(req);
  if (!token) return null;
  const payload = auth.verifyToken(token);
  if (!payload?.sub) return null;
  const user = await auth.findUserById(payload.sub);
  if (!user || user.status !== 'active') return null;
  return user;
}

async function requireAdmin(req) {
  const user = await requireUser(req);
  if (!user || user.role !== 'admin') return null;
  return user;
}

async function handleAuthRoutes(req, res, pathname, corsHeaders) {
  await ensureReady();

  try {
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readJson(req);
      const user = await auth.registerUser(body.username, body.password);
      const token = auth.signToken(user);
      return sendJson(res, 200, { ok: true, token, user: auth.publicUser(user) }, corsHeaders);
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readJson(req);
      const user = await auth.loginUser(body.username, body.password);
      const token = auth.signToken(user);
      return sendJson(res, 200, { ok: true, token, user: auth.publicUser(user) }, corsHeaders);
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const user = await requireUser(req);
      if (!user) return sendJson(res, 401, { error: '未登录或登录已过期' }, corsHeaders);
      return sendJson(res, 200, { ok: true, user: auth.publicUser(user) }, corsHeaders);
    }

    if (pathname === '/api/auth/guest-limit' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        limit: auth.GUEST_LIMIT,
      }, corsHeaders);
    }

    if (pathname === '/api/auth/usage' && req.method === 'POST') {
      const body = await readJson(req);
      const user = await requireUser(req);
      await auth.logUsage({
        userId: user?.id || null,
        guestId: user ? null : (body.guestId || null),
        agentPage: body.agentPage || 'unknown',
        action: body.action || 'chat',
      });
      return sendJson(res, 200, { ok: true }, corsHeaders);
    }

    if (pathname === '/api/admin/stats' && req.method === 'GET') {
      const admin = await requireAdmin(req);
      if (!admin) return sendJson(res, 403, { error: '需要管理员权限' }, corsHeaders);
      const stats = await auth.getAdminStats();
      return sendJson(res, 200, { ok: true, stats }, corsHeaders);
    }

    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const admin = await requireAdmin(req);
      if (!admin) return sendJson(res, 403, { error: '需要管理员权限' }, corsHeaders);
      const users = await auth.listUsers();
      return sendJson(res, 200, { ok: true, users }, corsHeaders);
    }

    const userStatusMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (userStatusMatch && req.method === 'PATCH') {
      const admin = await requireAdmin(req);
      if (!admin) return sendJson(res, 403, { error: '需要管理员权限' }, corsHeaders);
      const body = await readJson(req);
      const user = await auth.setUserStatus(Number(userStatusMatch[1]), body.status);
      return sendJson(res, 200, { ok: true, user }, corsHeaders);
    }

    return false;
  } catch (e) {
    const msg = String(e.message || e);
    const status = msg.includes('已存在') || msg.includes('用户名') || msg.includes('密码') ? 400 : 500;
    sendJson(res, status, { error: msg }, corsHeaders);
    return true;
  }
}

module.exports = { handleAuthRoutes, ensureReady };
