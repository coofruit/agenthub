/**
 * 生产环境挂载在 /agent-hub；本地 dev-server 仍在根路径。
 */
(function (global) {
  const PROD_MOUNT = '/agent-hub';
  const PROD_HOSTS = new Set([
    'goalinlegal.com',
    'www.goalinlegal.com',
    'goinlegal.com',
    'www.goinlegal.com',
  ]);

  global.isProdHost = function isProdHost() {
    return PROD_HOSTS.has(location.hostname);
  };

  global.getAppBasePath = function getAppBasePath() {
    if (global.isProdHost()) return PROD_MOUNT;
    if (location.pathname === PROD_MOUNT || location.pathname.startsWith(`${PROD_MOUNT}/`)) {
      return PROD_MOUNT;
    }
    return '';
  };
})(typeof window !== 'undefined' ? window : globalThis);
