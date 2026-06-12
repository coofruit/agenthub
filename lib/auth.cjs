const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool } = require('./db.cjs');

const GUEST_LIMIT = Number(process.env.GUEST_CHAT_LIMIT || 3);

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET 未配置');
  return s;
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, jwtSecret());
  } catch {
    return null;
  }
}

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function findUserByUsername(username) {
  const [rows] = await getPool().query(
    'SELECT id, username, password_hash, role, status, created_at FROM users WHERE username = ? LIMIT 1',
    [username],
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const [rows] = await getPool().query(
    'SELECT id, username, role, status, created_at FROM users WHERE id = ? LIMIT 1',
    [id],
  );
  return rows[0] || null;
}

async function registerUser(username, password) {
  const name = String(username || '').trim();
  if (!name || name.length < 3 || name.length > 32) {
    throw new Error('用户名需为 3-32 个字符');
  }
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(name)) {
    throw new Error('用户名仅支持中文、字母、数字和下划线');
  }
  if (!password || String(password).length < 6) {
    throw new Error('密码至少 6 位');
  }
  if (name === 'root') {
    throw new Error('该用户名不可注册');
  }
  const existing = await findUserByUsername(name);
  if (existing) throw new Error('用户名已存在');

  const hash = await bcrypt.hash(String(password), 10);
  const [result] = await getPool().query(
    'INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, \'user\', \'active\')',
    [name, hash],
  );
  const user = await findUserById(result.insertId);
  return user;
}

async function loginUser(username, password) {
  const user = await findUserByUsername(String(username || '').trim());
  if (!user) throw new Error('用户名或密码错误');
  if (user.status !== 'active') throw new Error('账号已被禁用，请联系管理员');
  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) throw new Error('用户名或密码错误');
  return user;
}

async function ensureAdminUser() {
  const adminName = process.env.ADMIN_USERNAME || 'root';
  const adminPass = process.env.ADMIN_PASSWORD || '123456@mima';
  const existing = await findUserByUsername(adminName);
  if (existing) {
    if (existing.role !== 'admin') {
      await getPool().query('UPDATE users SET role = \'admin\' WHERE id = ?', [existing.id]);
    }
    return existing;
  }
  const hash = await bcrypt.hash(adminPass, 10);
  await getPool().query(
    'INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, \'admin\', \'active\')',
    [adminName, hash],
  );
  console.log(`[auth] 已创建管理员账号: ${adminName}`);
  return findUserByUsername(adminName);
}

async function listUsers() {
  const [rows] = await getPool().query(
    'SELECT id, username, role, status, created_at FROM users ORDER BY id ASC',
  );
  return rows;
}

async function setUserStatus(id, status) {
  if (!['active', 'disabled'].includes(status)) throw new Error('无效状态');
  const user = await findUserById(id);
  if (!user) throw new Error('用户不存在');
  if (user.role === 'admin' && status === 'disabled') throw new Error('不能禁用管理员账号');
  await getPool().query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
  return findUserById(id);
}

async function logUsage({ userId = null, guestId = null, agentPage = 'unknown', action = 'chat' }) {
  await getPool().query(
    'INSERT INTO usage_logs (user_id, guest_id, agent_page, action) VALUES (?, ?, ?, ?)',
    [userId, guestId, agentPage, action],
  );
}

async function getAdminStats() {
  const db = getPool();
  const [[{ totalUsers }]] = await db.query(
    'SELECT COUNT(*) AS totalUsers FROM users WHERE role = \'user\'',
  );
  const [[{ activeUsers }]] = await db.query(
    'SELECT COUNT(*) AS activeUsers FROM users WHERE role = \'user\' AND status = \'active\'',
  );
  const [[{ totalChats }]] = await db.query(
    'SELECT COUNT(*) AS totalChats FROM usage_logs WHERE action = \'chat\'',
  );
  const [[{ todayChats }]] = await db.query(
    'SELECT COUNT(*) AS todayChats FROM usage_logs WHERE action = \'chat\' AND DATE(created_at) = CURDATE()',
  );
  return { totalUsers, activeUsers, totalChats, todayChats, guestChatLimit: GUEST_LIMIT };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
  };
}

function signCloudbaseToken(cbUser) {
  return jwt.sign(
    {
      sub:        cbUser._id,
      phone:      cbUser.phone,
      nickName:   cbUser.nickName || '',
      role:       'user',
      provider:   'cloudbase',
      totalQuota: cbUser.totalQuota,
      usedQuota:  cbUser.usedQuota,
    },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
}

function publicCloudbaseUser(cbUser) {
  return {
    id:         cbUser._id,
    phone:      cbUser.phone,
    nickName:   cbUser.nickName || '',
    avatarUrl:  cbUser.avatarUrl || '',
    role:       'user',
    provider:   'cloudbase',
    totalQuota: cbUser.totalQuota,
    usedQuota:  cbUser.usedQuota,
    enabled:    cbUser.enabled,
  };
}

function userFromTokenPayload(payload) {
  if (!payload || payload.provider !== 'cloudbase') return null;
  return publicCloudbaseUser({
    _id: payload.sub,
    phone: payload.phone,
    nickName: payload.nickName || '',
    avatarUrl: '',
    totalQuota: payload.totalQuota,
    usedQuota: payload.usedQuota,
    enabled: true,
  });
}

module.exports = {
  GUEST_LIMIT,
  signToken,
  signCloudbaseToken,
  publicCloudbaseUser,
  verifyToken,
  getBearerToken,
  findUserById,
  registerUser,
  loginUser,
  ensureAdminUser,
  listUsers,
  setUserStatus,
  logUsage,
  getAdminStats,
  publicUser,
  userFromTokenPayload,
};
