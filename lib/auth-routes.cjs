const { initSchema } = require('./db.cjs');
const auth = require('./auth.cjs');
const { findUserByPhone, createUserByPhone, updateUserLogin } = require('./cloudbase.cjs');
const { sendVerificationSms } = require('./sms.cjs');
const { handleAgentRoutes } = require('./agent-routes.cjs');

// 短信验证码内存存储：phone → { code, expiresAt, sentAt, attempts }
const smsCodeMap = new Map();

let readyPromise;

function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initSchema();
      await auth.ensureAdminAccounts();
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
  if (payload.provider === 'cloudbase') return null;
  const user = await auth.findAdminById(payload.sub);
  if (!user || user.status !== 'active') return null;
  return user;
}

async function requireAdmin(req) {
  const user = await requireUser(req);
  if (!user) return null;
  return user;
}

async function handleAuthRoutes(req, res, pathname, corsHeaders) {
  await ensureReady();

  try {
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      return sendJson(res, 403, { error: '请使用手机号验证码注册登录' }, corsHeaders);
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readJson(req);
      const user = await auth.loginUser(body.username, body.password);
      const token = auth.signToken(user);
      return sendJson(res, 200, { ok: true, token, user: auth.publicUser(user) }, corsHeaders);
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const token = auth.getBearerToken(req);
      if (!token) return sendJson(res, 401, { error: '未登录或登录已过期' }, corsHeaders);
      const payload = auth.verifyToken(token);
      if (!payload?.sub) return sendJson(res, 401, { error: '未登录或登录已过期' }, corsHeaders);
      const cbUser = auth.userFromTokenPayload(payload);
      if (cbUser) {
        const isAdmin = await auth.isAdminPhone(cbUser.phone);
        if (isAdmin) cbUser.role = 'admin';
        return sendJson(res, 200, { ok: true, user: cbUser }, corsHeaders);
      }
      const user = await auth.findAdminById(payload.sub);
      if (!user || user.status !== 'active') {
        return sendJson(res, 401, { error: '未登录或登录已过期' }, corsHeaders);
      }
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

    const userStatusMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userStatusMatch && req.method === 'PATCH') {
      const admin = await requireAdmin(req);
      if (!admin) return sendJson(res, 403, { error: '需要管理员权限' }, corsHeaders);
      const body = await readJson(req);
      const user = await auth.setUserStatus(userStatusMatch[1], body.status);
      return sendJson(res, 200, { ok: true, user }, corsHeaders);
    }

    // ── 手机号登录：发送验证码 ──────────────────────────
    if (pathname === '/api/auth/send-sms' && req.method === 'POST') {
      const { phone } = await readJson(req);
      if (!/^1[3-9]\d{9}$/.test(String(phone || ''))) {
        return sendJson(res, 400, { error: '请输入有效的大陆手机号' }, corsHeaders);
      }
      const existing = smsCodeMap.get(phone);
      if (existing && Date.now() - existing.sentAt < 60_000) {
        return sendJson(res, 429, { error: '发送太频繁，请 60 秒后再试' }, corsHeaders);
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      smsCodeMap.set(phone, { code, expiresAt: Date.now() + 5 * 60_000, sentAt: Date.now(), attempts: 0 });
      await sendVerificationSms(phone, code);
      return sendJson(res, 200, { ok: true, message: '验证码已发送' }, corsHeaders);
    }

    // ── 手机号登录：验证并登录 ──────────────────────────
    if (pathname === '/api/auth/verify-sms' && req.method === 'POST') {
      const { phone, code } = await readJson(req);
      const record = smsCodeMap.get(String(phone || ''));
      if (!record || Date.now() > record.expiresAt) {
        return sendJson(res, 400, { error: '验证码已过期，请重新获取' }, corsHeaders);
      }
      record.attempts++;
      if (record.attempts > 5) {
        smsCodeMap.delete(phone);
        return sendJson(res, 400, { error: '错误次数过多，请重新获取验证码' }, corsHeaders);
      }
      if (record.code !== String(code || '')) {
        return sendJson(res, 400, { error: `验证码错误，还可尝试 ${5 - record.attempts} 次` }, corsHeaders);
      }
      smsCodeMap.delete(phone);

      let cbUser = await findUserByPhone(phone);
      if (!cbUser) {
        cbUser = await createUserByPhone(phone);
      } else {
        updateUserLogin(cbUser._id);
      }
      if (cbUser.enabled === false) {
        return sendJson(res, 403, { error: '账号已被禁用，请联系管理员' }, corsHeaders);
      }
      const isAdmin = await auth.isAdminPhone(phone);
      const token = auth.signCloudbaseToken(cbUser, { isAdmin });
      return sendJson(res, 200, {
        ok: true,
        token,
        user: auth.publicCloudbaseUser(cbUser, { isAdmin }),
      }, corsHeaders);
    }

    const agentHandled = await handleAgentRoutes(req, res, pathname, corsHeaders, { requireAdmin });
    if (agentHandled !== false) return true;

    return false;
  } catch (e) {
    const msg = String(e.message || e);
    const status = msg.includes('已存在') || msg.includes('用户名') || msg.includes('密码') ? 400 : 500;
    sendJson(res, status, { error: msg }, corsHeaders);
    return true;
  }
}

module.exports = { handleAuthRoutes, ensureReady, requireAdmin };
