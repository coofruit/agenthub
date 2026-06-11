/**
 * 生产环境挂载在 /agent-hub；本地 dev-server 仍在根路径。
 */
(function (global) {
  const PROD_MOUNT = '/agent-hub';

  global.getAppBasePath = function getAppBasePath() {
    const h = location.hostname;
    if (h === 'goinlegal.com' || h === 'www.goinlegal.com') return PROD_MOUNT;
    if (location.pathname === PROD_MOUNT || location.pathname.startsWith(`${PROD_MOUNT}/`)) {
      return PROD_MOUNT;
    }
    return '';
  };
})(typeof window !== 'undefined' ? window : globalThis);
