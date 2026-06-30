const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool } = require('./db.cjs');
const cloudbase = require('./cloudbase.cjs');

const GUEST_LIMIT = Number(process.env.GUEST_CHAT_LIMIT || 3);

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET 未配置');
  return s;
}

function signToken(user) {
  const id = user._id || user.id;
  return jwt.sign(
    {
      sub: id,
      username: user.username,
      role: 'admin',
      provider: 'local_admin',
    },
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

async function loginUser(username, password) {
  const user = await cloudbase.findAdminByUsername(String(username || '').trim());
  if (!user) throw new Error('用户名或密码错误');
  if (user.status !== 'active') throw new Error('账号已被禁用，请联系管理员');
  const ok = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!ok) throw new Error('用户名或密码错误');
  return user;
}

function defaultAdminPhones() {
  const raw = process.env.ADMIN_PHONES || '15880266926,15080459806';
  return raw.split(',').map(s => s.trim()).filter(p => /^1[3-9]\d{9}$/.test(p));
}

async function syncAdminPhones() {
  const phones = defaultAdminPhones();
  await cloudbase.syncAdminPhoneList(phones);
  console.log(`[auth] 已同步内测管理员手机号（CloudBase）: ${phones.join(', ')}`);
  return phones;
}

async function ensureAdminCredential() {
  const adminName = process.env.ADMIN_USERNAME || 'root';
  const adminPass = process.env.ADMIN_PASSWORD || '123456@mima';
  const existing = await cloudbase.findAdminByUsername(adminName);
  if (existing) return existing;

  const hash = await bcrypt.hash(adminPass, 10);
  const created = await cloudbase.createAdminAccount({
    username: adminName,
    password_hash: hash,
    status: 'active',
  });
  console.log(`[auth] 已创建内测管理员账号（CloudBase）: ${adminName}`);
  return created;
}

async function migrateMysqlAdminPhonesToCloudBase() {
  const db = getPool();
  const [tables] = await db.query("SHOW TABLES LIKE 'admin_phones'");
  if (!tables.length) return false;

  const [rows] = await db.query(
    'SELECT phone, username, password_hash, status, created_at FROM admin_phones ORDER BY id ASC',
  );
  for (const row of rows) {
    await cloudbase.upsertAdminAccount({
      phone: row.phone || '',
      username: row.username || '',
      password_hash: row.password_hash || '',
      status: row.status || 'active',
    });
  }
  await db.query('DROP TABLE IF EXISTS admin_phones');
  console.log(`[auth] 已将 ${rows.length} 条管理员数据从 MySQL 迁移至 CloudBase ${cloudbase.ADMIN_COL}`);
  return true;
}

async function ensureAdminAccounts() {
  await migrateMysqlAdminPhonesToCloudBase();
  await ensureAdminCredential();
  await syncAdminPhones();
}

async function isAdminPhone(phone) {
  return cloudbase.isAdminPhone(phone);
}

async function findAdminById(id) {
  return cloudbase.findAdminById(id);
}

async function listAdminPhones() {
  const rows = await cloudbase.listAdminAccounts();
  return rows.map(r => ({
    phone: r.phone || null,
    username: r.username || null,
    status: r.status,
    created_at: r.createTime,
  }));
}

function publicCloudbaseAdminUser(cbUser) {
  const enabled = cbUser.enabled !== false;
  return {
    id: cbUser._id,
    phone: cbUser.phone || '',
    nickName: cbUser.nickName || '',
    totalQuota: cbUser.totalQuota ?? Number(process.env.DEFAULT_QUOTA || 10),
    usedQuota: cbUser.usedQuota ?? 0,
    enabled,
    status: enabled ? 'active' : 'disabled',
    createTime: cbUser.createTime || '',
    lastLogin: cbUser.lastLogin || '',
    loginCount: cbUser.loginCount ?? 0,
  };
}

async function listUsers() {
  const users = await cloudbase.listUsers();
  return users.map(publicCloudbaseAdminUser);
}

async function setUserStatus(id, status) {
  if (!['active', 'disabled'].includes(status)) throw new Error('无效状态');
  const user = await cloudbase.setUserEnabled(id, status === 'active');
  if (!user) throw new Error('用户不存在');
  return publicCloudbaseAdminUser(user);
}

async function logUsage({ userId = null, guestId = null, agentPage = 'unknown', action = 'chat' }) {
  await getPool().query(
    'INSERT INTO usage_logs (user_id, guest_id, agent_page, action) VALUES (?, ?, ?, ?)',
    [userId, guestId, agentPage, action],
  );
}

async function getAdminStats() {
  const { totalUsers, activeUsers } = await cloudbase.getUserStats();
  const db = getPool();
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
    id: user._id || user.id,
    username: user.username,
    role: 'admin',
    status: user.status,
    created_at: user.createTime || user.created_at,
    provider: 'local_admin',
  };
}

function signCloudbaseToken(cbUser, { isAdmin = false } = {}) {
  return jwt.sign(
    {
      sub:        cbUser._id,
      phone:      cbUser.phone,
      nickName:   cbUser.nickName || '',
      role:       isAdmin ? 'admin' : 'user',
      provider:   'cloudbase',
      totalQuota: cbUser.totalQuota,
      usedQuota:  cbUser.usedQuota,
    },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
}

function publicCloudbaseUser(cbUser, { isAdmin = false } = {}) {
  return {
    id:         cbUser._id,
    phone:      cbUser.phone,
    nickName:   cbUser.nickName || '',
    avatarUrl:  cbUser.avatarUrl || '',
    role:       isAdmin ? 'admin' : 'user',
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
  }, { isAdmin: payload.role === 'admin' });
}

function isBetaAdminUser(user) {
  return !!user && user.role === 'admin';
}

module.exports = {
  GUEST_LIMIT,
  signToken,
  signCloudbaseToken,
  publicCloudbaseUser,
  verifyToken,
  getBearerToken,
  findAdminById,
  loginUser,
  ensureAdminAccounts,
  isAdminPhone,
  listAdminPhones,
  listUsers,
  setUserStatus,
  logUsage,
  getAdminStats,
  publicUser,
  publicCloudbaseAdminUser,
  userFromTokenPayload,
  isBetaAdminUser,
};
