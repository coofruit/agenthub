'use strict';

const tcb = require('@cloudbase/node-sdk');

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

async function findUserByPhone(phone) {
  const res = await getDb()
    .collection('users')
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
  const res = await getDb().collection('users').add(doc);
  return { _id: res.id || res._id || null, ...doc };
}

async function updateUserLogin(userId) {
  const now = new Date().toISOString();
  await getDb()
    .collection('users')
    .doc(userId)
    .update({ lastLogin: now })
    .catch(e => console.warn('[CloudBase] updateUserLogin failed:', e.message));
}

module.exports = { findUserByPhone, createUserByPhone, updateUserLogin };
