/* 雲端後台資料後端：Cloudflare Workers（帳號密碼登入）
 * 介面與 server.py 的 /api 相同，另加 /api/login、/api/logout、/api/password、/api/users。
 * 工作階段權杖只存在這個瀏覽器分頁的 sessionStorage（關閉分頁即清除），8 小時後失效。
 */
(function () {
  'use strict';
  const CFG = window.CMS_CONFIG;
  if (!CFG || CFG.backend !== 'worker' || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost):\d+)/.test(CFG.api || '')) return;
  const API = CFG.api.replace(/\/+$/, '');

  async function call(method, path, opts, token) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    if (headers['If-Match'] && !/^"/.test(headers['If-Match'])) headers['If-Match'] = '"' + headers['If-Match'] + '"';
    let body = opts.body;
    if (body !== undefined && !(body instanceof Blob)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    let r;
    try {
      r = await fetch(API + path, { method, headers, body, cache: 'no-store', credentials: 'omit' });
    } catch (e) {
      return { status: 0, ok: false, data: { error: '無法連線到後台服務，請稍後再試' }, etag: null };
    }
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    const etag = (r.headers.get('ETag') || '').replace(/^W\//, '').replace(/"/g, '') || null;
    if (data && data.etag) data.etag = String(data.etag).replace(/"/g, '');
    return { status: r.status, ok: r.ok, data, etag };
  }

  window.CMS_BACKEND = {
    name: 'worker',
    accounts: true,
    login: (username, password) => call('POST', '/api/login', { body: { username, password } }),
    logout: (token) => call('POST', '/api/logout', {}, token),
    api: async (method, path, opts, token) => {
      const r = await call(method, path, opts, token);
      if (r.ok && path === '/api/whoami') sessionStorage.setItem('cmsWorker', JSON.stringify({ api: API, owner: CFG.owner, repo: CFG.repo, branch: CFG.branch || 'main' }));
      return r;
    }
  };
})();
