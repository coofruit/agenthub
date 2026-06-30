/**
 * GoalinWeb 用户认证与游客对话次数限制
 */
(function (global) {
  const TOKEN_KEY = 'goalin_auth_token';
  const GUEST_COUNT_KEY = 'goalin_guest_chat_count';
  const GUEST_ID_KEY = 'goalin_guest_id';
  const GUEST_LIMIT = 3;

  function apiBase() {
    const base = typeof getAppBasePath === 'function' ? getAppBasePath() : '';
    return `${location.origin}${base}/api/auth`;
  }

  function loginPageUrl() {
    const base = typeof getAppBasePath === 'function' ? getAppBasePath() : '';
    const ret = encodeURIComponent(location.pathname + location.search);
    return `${base}/login.html?return=${ret}`;
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function getGuestId() {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id = `g_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  }

  function getGuestCount() {
    return Number(localStorage.getItem(GUEST_COUNT_KEY) || 0);
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async function fetchMe() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${apiBase()}/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        setToken('');
        return null;
      }
      const data = await res.json();
      return data.user || null;
    } catch {
      return null;
    }
  }

  async function login(username, password) {
    const res = await fetch(`${apiBase()}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '登录失败');
    setToken(data.token);
    return data.user;
  }

  async function register(username, password) {
    const res = await fetch(`${apiBase()}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '注册失败');
    setToken(data.token);
    return data.user;
  }

  function logout() {
    setToken('');
  }

  function checkBeforeChat() {
    if (isLoggedIn()) return { allowed: true };
    const used = getGuestCount();
    if (used >= GUEST_LIMIT) {
      return {
        allowed: false,
        message: `未登录用户最多体验 ${GUEST_LIMIT} 次对话，请先登录或注册后继续使用`,
        loginUrl: loginPageUrl(),
        remaining: 0,
      };
    }
    return { allowed: true, remaining: GUEST_LIMIT - used };
  }

  async function recordChat() {
    const page = location.pathname.split('/').pop() || 'unknown';
    if (!isLoggedIn()) {
      localStorage.setItem(GUEST_COUNT_KEY, String(getGuestCount() + 1));
    }
    try {
      await fetch(`${apiBase()}/usage`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          agentPage: page,
          action: 'chat',
          guestId: isLoggedIn() ? null : getGuestId(),
        }),
      });
    } catch (_) { /* 统计失败不阻断对话 */ }
  }

  function getGuestStatusText() {
    if (isLoggedIn()) return '已登录，可持续使用';
    const left = Math.max(0, GUEST_LIMIT - getGuestCount());
    return `游客模式：剩余 ${left}/${GUEST_LIMIT} 次对话`;
  }

  function renderAuthBar() {
    if (!document.body || document.getElementById('goalin-auth-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'goalin-auth-bar';
    bar.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;background:#0f1923;color:#fff;padding:10px 14px;border-radius:10px;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.18);display:flex;gap:10px;align-items:center;';
    const text = document.createElement('span');
    const login = document.createElement('a');
    login.href = loginPageUrl();
    login.textContent = '登录 / 注册';
    login.style.cssText = 'color:#02BBC7;text-decoration:none;font-weight:600;';
    const logout = document.createElement('button');
    logout.textContent = '退出';
    logout.style.cssText = 'border:none;background:#02BBC7;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;';
    logout.onclick = () => { GoalinAuth.logout(); bar.remove(); renderAuthBar(); };
    function refresh() {
      if (isLoggedIn()) {
        text.textContent = '已登录';
        login.style.display = 'none';
        logout.style.display = 'inline-block';
      } else {
        text.textContent = getGuestStatusText();
        login.style.display = 'inline';
        logout.style.display = 'none';
      }
    }
    bar.append(text, login, logout);
    document.body.appendChild(bar);
    refresh();
    fetchMe().then(() => refresh());
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      if (location.pathname.includes('admin.html') || location.pathname.includes('login.html')) return;
      renderAuthBar();
    });
  }

  function isBetaAdmin(user) {
    return !!user && user.role === 'admin';
  }

  global.GoalinAuth = {
    GUEST_LIMIT,
    getToken,
    setToken,
    isLoggedIn,
    isBetaAdmin,
    login,
    register,
    logout,
    fetchMe,
    checkBeforeChat,
    recordChat,
    loginPageUrl,
    getGuestStatusText,
    authHeaders,
    apiBase,
  };
})(typeof window !== 'undefined' ? window : globalThis);
