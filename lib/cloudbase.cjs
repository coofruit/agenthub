'use strict';

const tcb = require('@cloudbase/node-sdk');

const USERS_COL = 'users';
const ADMIN_COL = 'admin_accounts';

let app;

function getApp() {
  if (!app) {
    const env = process.env.CLOUDBASE_ENV_ID;
    const accessKey = process.env.CLOUDBASE_API_KEY;
    if (!env || !accessKey) {
      throw new Error('CLOUDBASE_ENV_ID / CLOUDBASE_API_KEY 未配置');
    }
    app = tcb.init({ env, accessKey });
  }
  return app;
}

function getDb() {
  return getApp().database();
}

function adminCol() {
  return getDb().collection(ADMIN_COL);
}

let adminColReady = false;

async function ensureAdminCollection() {
  if (adminColReady) return;
  try {
    await adminCol().limit(1).get();
    adminColReady = true;
    return;
  } catch (e) {
    if (e.code !== 'DATABASE_COLLECTION_NOT_EXIST') throw e;
  }
  const res = await getDb().createCollection(ADMIN_COL);
  if (res.code) throw new Error(res.message || `创建集合 ${ADMIN_COL} 失败`);
  adminColReady = true;
  console.log(`[CloudBase] 已创建集合: ${ADMIN_COL}`);
}

function normalizeAdminDoc(doc) {
  if (!doc) return null;
  const id = doc._id || doc.id || null;
  return {
    _id: id,
    id,
    phone: doc.phone || '',
    username: doc.username || '',
    password_hash: doc.password_hash || '',
    status: doc.status || 'active',
    createTime: doc.createTime || '',
    updateTime: doc.updateTime || '',
  };
}

async function findUserByPhone(phone) {
  const res = await getDb()
    .collection(USERS_COL)
    .where({ phone })
    .limit(1)
    .get();
  return res.data?.[0] || null;
}

async function createUserByPhone(phone) {
  const now = new Date().toISOString();
  const doc = {
    phone,
    openid: '',
    nickName: '',
    avatarUrl: '',
    enabled: true,
    totalQuota: Number(process.env.DEFAULT_QUOTA || 10),
    usedQuota: 0,
    createTime: now,
    lastLogin: now,
    loginCount: 1,
  };
  const res = await getDb().collection(USERS_COL).add(doc);
  return { _id: res.id || res._id || null, ...doc };
}

async function updateUserLogin(userId) {
  const now = new Date().toISOString();
  await getDb()
    .collection(USERS_COL)
    .doc(userId)
    .update({ lastLogin: now })
    .catch(e => console.warn('[CloudBase] updateUserLogin failed:', e.message));
}

async function getUserById(userId) {
  const res = await getDb().collection(USERS_COL).doc(String(userId)).get();
  if (Array.isArray(res.data)) return res.data[0] || null;
  return res.data || null;
}

async function listUsers(limit = 1000) {
  const db = getDb().collection(USERS_COL);
  let res;
  try {
    res = await db.orderBy('createTime', 'desc').limit(limit).get();
  } catch {
    res = await db.limit(limit).get();
  }
  const users = res.data || [];
  users.sort((a, b) => String(b.createTime || '').localeCompare(String(a.createTime || '')));
  return users;
}

async function getUserStats() {
  const db = getDb().collection(USERS_COL);
  const totalRes = await db.count();
  const totalUsers = totalRes.total || 0;
  let disabledUsers = 0;
  try {
    const disabledRes = await db.where({ enabled: false }).count();
    disabledUsers = disabledRes.total || 0;
  } catch (e) {
    console.warn('[CloudBase] count disabled users failed:', e.message);
  }
  return {
    totalUsers,
    activeUsers: Math.max(0, totalUsers - disabledUsers),
  };
}

async function setUserEnabled(userId, enabled) {
  const existing = await getUserById(userId);
  if (!existing) return null;
  await getDb()
    .collection(USERS_COL)
    .doc(String(userId))
    .update({ enabled: !!enabled });
  return getUserById(userId);
}

// ── 内测管理员（admin_accounts 集合）────────────────────

async function findAdminByPhone(phone) {
  if (!phone) return null;
  await ensureAdminCollection();
  const res = await adminCol().where({ phone: String(phone) }).limit(1).get();
  return normalizeAdminDoc(res.data?.[0]);
}

async function findAdminByUsername(username) {
  if (!username) return null;
  await ensureAdminCollection();
  const res = await adminCol().where({ username: String(username) }).limit(1).get();
  return normalizeAdminDoc(res.data?.[0]);
}

async function findAdminById(id) {
  if (!id) return null;
  await ensureAdminCollection();
  const res = await adminCol().doc(String(id)).get();
  const doc = Array.isArray(res.data) ? res.data[0] : res.data;
  return normalizeAdminDoc(doc);
}

async function listAdminAccounts() {
  await ensureAdminCollection();
  const res = await adminCol().limit(1000).get();
  return (res.data || []).map(normalizeAdminDoc).filter(Boolean);
}

async function createAdminAccount({ phone = '', username = '', password_hash = '', status = 'active' } = {}) {
  await ensureAdminCollection();
  const now = new Date().toISOString();
  const doc = {
    phone: phone || '',
    username: username || '',
    password_hash: password_hash || '',
    status,
    createTime: now,
    updateTime: now,
  };
  const res = await adminCol().add(doc);
  return normalizeAdminDoc({ _id: res.id || res._id, ...doc });
}

async function updateAdminAccount(id, patch) {
  const data = { ...patch, updateTime: new Date().toISOString() };
  await adminCol().doc(String(id)).update(data);
  return findAdminById(id);
}

async function deleteAdminAccount(id) {
  await adminCol().doc(String(id)).remove();
}

async function isAdminPhone(phone) {
  const admin = await findAdminByPhone(phone);
  return !!admin && admin.status === 'active';
}

async function syncAdminPhoneList(phones) {
  const all = await listAdminAccounts();
  const phoneSet = new Set(phones);
  for (const row of all) {
    if (row.phone && !phoneSet.has(row.phone)) {
      await deleteAdminAccount(row._id);
    }
  }
  for (const phone of phones) {
    const existing = await findAdminByPhone(phone);
    if (!existing) {
      await createAdminAccount({ phone, status: 'active' });
    }
  }
}

async function upsertAdminAccount({ phone = '', username = '', password_hash = '', status = 'active' } = {}) {
  const existing = phone
    ? await findAdminByPhone(phone)
    : await findAdminByUsername(username);
  if (existing) {
    const patch = { status };
    if (password_hash) patch.password_hash = password_hash;
    return updateAdminAccount(existing._id, patch);
  }
  return createAdminAccount({ phone, username, password_hash, status });
}

module.exports = {
  USERS_COL,
  ADMIN_COL,
  ensureAdminCollection,
  findUserByPhone,
  createUserByPhone,
  updateUserLogin,
  getUserById,
  listUsers,
  getUserStats,
  setUserEnabled,
  findAdminByPhone,
  findAdminByUsername,
  findAdminById,
  listAdminAccounts,
  createAdminAccount,
  updateAdminAccount,
  deleteAdminAccount,
  isAdminPhone,
  syncAdminPhoneList,
  upsertAdminAccount,
};
