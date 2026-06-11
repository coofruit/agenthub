'use strict';

const ENV_ID = process.env.CLOUDBASE_ENV_ID;
const API_KEY = process.env.CLOUDBASE_API_KEY;
const CB_URL = `https://tcb-api.tencentcloudapi.com/web?env=${ENV_ID}`;

async function cbRequest(action, params) {
  const res = await fetch(CB_URL, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${API_KEY}`,
      'content-type': 'application/json',
      'x-sdk-version': '@cloudbase/js-sdk/2.6.4',
    },
    body: JSON.stringify({ action, dataVersion: '2019-08-16', env: ENV_ID, params }),
  });

  const json = await res.json();
  if (json.code && json.code !== 0) {
    throw new Error(`[CloudBase] ${json.message || json.code}`);
  }
  return json;
}

async function findUserByPhone(phone) {
  const res = await cbRequest('database.queryDocument', {
    collectionName: 'users',
    query: JSON.stringify({ phone }),
    limit: 1,
    offset: 0,
    projection: JSON.stringify({}),
  });
  const list = res.data?.list ?? (Array.isArray(res.data) ? res.data : []);
  return list[0] || null;
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
  const res = await cbRequest('database.addDocument', {
    collectionName: 'users',
    data: JSON.stringify(doc),
  });
  return { _id: res.id || res.data?.id || null, ...doc };
}

async function updateUserLogin(userId) {
  const now = new Date().toISOString();
  await cbRequest('database.updateDocument', {
    collectionName: 'users',
    query: JSON.stringify({ _id: userId }),
    data: JSON.stringify({ lastLogin: now }),
    operation: 'update',
  }).catch(e => console.warn('[CloudBase] updateUserLogin failed:', e.message));
}

module.exports = { findUserByPhone, createUserByPhone, updateUserLogin };
