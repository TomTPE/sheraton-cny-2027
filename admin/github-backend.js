/* 雲端後台資料後端：GitHub 儲存庫
 * 以 GitHub REST API 模擬 server.py 的 /api 介面，讓同一套後台介面可部署在 GitHub Pages 上實際上稿。
 *   草稿：cms/draft.json（commit 到 main，不觸發部署）
 *   發布：data/content.json（commit 到 main，觸發 GitHub Actions 建置與部署）
 *   上傳：assets/uploads/<sha256 前 16 碼>.<副檔名>
 *   角色：cms/roles.json 的 publishers 名單為「發布者」，其他具寫入權限的帳號為「編輯者」
 *   版本紀錄、操作紀錄：讀取 commit 歷史
 * 登入金鑰為使用者自己的 GitHub fine-grained personal access token（只授權此儲存庫的 Contents 讀寫），
 * 只保存在這個瀏覽器分頁的 sessionStorage，關閉分頁即清除；本程式不會把金鑰送到 GitHub 以外的地方。
 */
(function () {
  'use strict';
  const CFG = window.CMS_CONFIG;
  if (!CFG || CFG.backend !== 'github') return;

  const API = 'https://api.github.com';
  const REPO = '/repos/' + encodeURIComponent(CFG.owner) + '/' + encodeURIComponent(CFG.repo);
  const BRANCH = CFG.branch || 'main';
  const DRAFT = 'cms/draft.json', CONTENT = 'data/content.json', ROLES = 'cms/roles.json';
  const MAX_DOC = 2 * 1024 * 1024, MAX_UP = 3 * 1024 * 1024;
  const state = { login: null, role: null, revMap: {} };

  function res(status, data, etag) { return { status, ok: status >= 200 && status < 300, data, etag: etag || null }; }
  function fail(status, error, extra) { return res(status, Object.assign({ error }, extra || {})); }

  async function gh(method, path, token, body, accept) {
    const headers = { Authorization: 'Bearer ' + token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let r;
    try {
      r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (e) {
      return { status: 0, ok: false, json: null, text: '' };
    }
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    return { status: r.status, ok: r.ok, json, text };
  }

  // UTF-8 ↔ base64
  function b64encodeBytes(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const b64encode = (str) => b64encodeBytes(new TextEncoder().encode(str));
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  const dump = (doc) => JSON.stringify(doc, null, 2) + '\n';
  const nowIso = () => {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.toISOString().replace(/\.\d+Z$/, '+08:00');
  };

  async function readFile(path, token, ref) {
    const r = await gh('GET', REPO + '/contents/' + path + '?ref=' + encodeURIComponent(ref || BRANCH), token);
    if (r.status === 404) return { missing: true };
    if (!r.ok || !r.json) return { error: r };
    let content = r.json.content;
    if (!content && r.json.sha) {
      // 超過 1 MB 的檔案 contents API 不附內容，改讀 blob
      const b = await gh('GET', REPO + '/git/blobs/' + r.json.sha, token);
      content = b.json && b.json.content;
    }
    return { sha: r.json.sha, text: b64decode(content || '') };
  }
  async function writeFile(path, token, base64, message, sha) {
    const body = { message, content: base64, branch: BRANCH };
    if (sha) body.sha = sha;
    return gh('PUT', REPO + '/contents/' + path, token, body);
  }

  async function whoami(token) {
    const u = await gh('GET', '/user', token);
    if (u.status === 401) return fail(401, '金鑰不正確或已過期');
    if (!u.ok) return fail(u.status || 502, '無法連線到 GitHub（HTTP ' + u.status + '）');
    const repo = await gh('GET', REPO, token);
    if (!repo.ok) return fail(403, '此金鑰無法存取儲存庫 ' + CFG.owner + '/' + CFG.repo + '，請確認已授權該儲存庫');
    if (!repo.json.permissions || !repo.json.permissions.push) return fail(403, '此帳號對儲存庫沒有寫入權限，無法上稿');
    state.login = u.json.login;
    let role = 'publisher';
    const rf = await readFile(ROLES, token);
    if (rf.text) {
      try {
        const roles = JSON.parse(rf.text);
        const pubs = (roles.publishers || []).map((x) => String(x).toLowerCase());
        role = pubs.includes(state.login.toLowerCase()) ? 'publisher' : 'editor';
      } catch (e) { role = 'editor'; }
    }
    state.role = role;
    return res(200, { role, login: state.login });
  }

  async function getContent(stage, token) {
    if (stage === 'draft') {
      const f = await readFile(DRAFT, token);
      if (f.text) return res(200, JSON.parse(f.text), f.sha);
      if (!f.missing) return fail(502, '無法讀取草稿');
      const c = await readFile(CONTENT, token);
      if (!c.text) return fail(502, '無法讀取已發布內容');
      return res(200, JSON.parse(c.text), 'new');
    }
    const c = await readFile(CONTENT, token);
    if (!c.text) return fail(502, '無法讀取已發布內容');
    return res(200, JSON.parse(c.text), c.sha);
  }

  async function putDraft(doc, ifMatch, token) {
    if (!ifMatch) return fail(428, '缺少 If-Match：請先載入草稿再儲存');
    const cur = await readFile(DRAFT, token);
    const curEtag = cur.missing ? 'new' : cur.sha;
    if (cur.error) return fail(502, '無法讀取目前草稿');
    if (ifMatch !== curEtag) {
      let meta = {};
      try { meta = JSON.parse(cur.text).meta || {}; } catch (e) { /* 忽略 */ }
      return fail(409, '草稿已被其他人更新，請重新載入後再編輯', { etag: curEtag, updatedAt: meta.updatedAt, updatedBy: meta.updatedBy });
    }
    doc.meta = doc.meta || {};
    doc.meta.updatedAt = nowIso();
    doc.meta.updatedBy = state.login || state.role;
    const out = dump(doc);
    if (new Blob([out]).size > MAX_DOC) return fail(413, '文件超過 2 MB 上限');
    const w = await writeFile(DRAFT, token, b64encode(out), 'CMS 草稿：' + state.login, cur.missing ? null : cur.sha);
    if (w.status === 409 || w.status === 422) return fail(409, '草稿已被其他人更新，請重新載入後再編輯');
    if (!w.ok) return fail(w.status || 502, '儲存失敗（GitHub HTTP ' + w.status + '）');
    const tag = w.json.content.sha;
    return res(200, { ok: true, etag: tag, meta: doc.meta }, tag);
  }

  async function publish(ifMatch, token) {
    if (state.role !== 'publisher') return fail(403, '只有發布者可以發布');
    const cur = await readFile(DRAFT, token);
    if (cur.missing) return fail(409, '尚無草稿，請先儲存草稿再發布');
    if (ifMatch && ifMatch !== cur.sha) return fail(409, '草稿已被其他人更新，請重新載入並確認後再發布', { etag: cur.sha });
    const doc = JSON.parse(cur.text);
    const pub = await readFile(CONTENT, token);
    let pubRev = 0;
    try { pubRev = parseInt(JSON.parse(pub.text).meta.revision, 10) || 0; } catch (e) { pubRev = 0; }
    const rev = Math.max(pubRev, parseInt(doc.meta && doc.meta.revision, 10) || 0) + 1;
    doc.meta.revision = rev;
    doc.meta.updatedAt = nowIso();
    doc.meta.updatedBy = state.login;
    const w = await writeFile(CONTENT, token, b64encode(dump(doc)), 'CMS 發布 rev ' + rev + '：' + state.login, pub.sha);
    if (!w.ok) return fail(w.status || 502, '發布失敗（GitHub HTTP ' + w.status + '）');
    return res(200, { ok: true, revision: rev, updatedAt: doc.meta.updatedAt, note: '已送出，約 1–2 分鐘後線上網站更新' });
  }

  async function commits(path, token, n) {
    const r = await gh('GET', REPO + '/commits?sha=' + encodeURIComponent(BRANCH) + '&path=' + encodeURIComponent(path) + '&per_page=' + (n || 30), token);
    return r.ok && Array.isArray(r.json) ? r.json : [];
  }

  async function revisions(token) {
    const list = await commits(CONTENT, token, 30);
    state.revMap = {};
    const out = list.map((c, i) => {
      const m = /rev (\d+)/.exec(c.commit.message);
      const rev = m ? Number(m[1]) : c.sha.slice(0, 7);
      state.revMap[rev] = c.sha;
      return { revision: rev, updatedAt: c.commit.author.date, updatedBy: (c.author && c.author.login) || c.commit.author.name, live: i === 0 };
    });
    return res(200, { revisions: out });
  }

  async function rollback(body, token) {
    if (state.role !== 'publisher') return fail(403, '只有發布者可以還原版本');
    const sha = state.revMap[body && body.revision];
    if (!sha) return fail(404, '找不到此版本，請重新整理版本紀錄');
    const old = await readFile(CONTENT, token, sha);
    if (!old.text) return fail(502, '無法讀取該版本內容');
    const doc = JSON.parse(old.text);
    doc.meta.updatedAt = nowIso();
    doc.meta.updatedBy = state.login;
    const cur = await readFile(DRAFT, token);
    const w = await writeFile(DRAFT, token, b64encode(dump(doc)), 'CMS 還原 rev ' + body.revision + ' 至草稿：' + state.login, cur.missing ? null : cur.sha);
    if (!w.ok) return fail(w.status || 502, '還原失敗（GitHub HTTP ' + w.status + '）');
    return res(200, { ok: true, revision: body.revision, etag: w.json.content.sha }, w.json.content.sha);
  }

  function sniff(b) {
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null;
  }
  async function upload(blob, filename, token) {
    if (!(blob instanceof Blob) || !blob.size) return fail(400, '沒有收到檔案內容');
    if (blob.size > MAX_UP) return fail(413, '檔案超過 3 MB 上限');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ext = sniff(bytes);
    if (!ext) return fail(415, '僅接受 JPEG、PNG、WebP 圖片（依檔案內容判斷，非副檔名）');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
    const rel = 'assets/uploads/' + hash + '.' + ext;
    const exists = await gh('GET', REPO + '/contents/' + rel + '?ref=' + encodeURIComponent(BRANCH), token);
    if (!exists.ok) {
      const w = await writeFile(rel, token, b64encodeBytes(bytes), 'CMS 上傳：' + rel + ' ← ' + String(filename || '').slice(0, 80) + '（' + state.login + '）');
      if (!w.ok) return fail(w.status || 502, '上傳失敗（GitHub HTTP ' + w.status + '）');
    }
    return res(201, { path: rel, bytes: bytes.length, type: ext });
  }

  async function audit(token) {
    if (state.role !== 'publisher') return fail(403, '只有發布者可以查看操作紀錄');
    const lists = await Promise.all([commits(DRAFT, token, 40), commits(CONTENT, token, 40), commits('assets/uploads', token, 20)]);
    const seen = new Set();
    const entries = [].concat.apply([], lists).filter((c) => !seen.has(c.sha) && seen.add(c.sha))
      .sort((a, b) => (a.commit.author.date < b.commit.author.date ? 1 : -1)).slice(0, 100)
      .map((c) => {
        const msg = c.commit.message.split('\n')[0];
        const action = /^CMS 發布/.test(msg) ? 'publish' : /^CMS 還原/.test(msg) ? 'rollback' : /^CMS 上傳/.test(msg) ? 'upload' : /^CMS 草稿/.test(msg) ? 'save_draft' : msg;
        const m = /rev (\d+)/.exec(msg);
        return { ts: c.commit.author.date, role: (c.author && c.author.login) || c.commit.author.name, action, revision: m ? Number(m[1]) : null, detail: c.sha.slice(0, 7) + ' ' + msg };
      });
    return res(200, { entries });
  }

  window.CMS_BACKEND = {
    name: 'github',
    loginHelp: '請輸入您的 GitHub fine-grained personal access token（只授權儲存庫 ' + CFG.owner + '/' + CFG.repo + '，權限 Contents：Read and write）。金鑰只保存在這個瀏覽器分頁，關閉分頁即清除。',
    async api(method, path, opts, token) {
      opts = opts || {};
      const h = opts.headers || {};
      const [p, q] = path.split('?');
      const query = new URLSearchParams(q || '');
      try {
        if (method === 'GET' && p === '/api/whoami') {
          const r = await whoami(token);
          if (r.ok) sessionStorage.setItem('cmsGithub', JSON.stringify({ owner: CFG.owner, repo: CFG.repo, branch: BRANCH }));
          return r;
        }
        if (!state.role) { const w = await whoami(token); if (!w.ok) return w; }
        if (method === 'GET' && p === '/api/content') return getContent(query.get('stage') || 'published', token);
        if (method === 'PUT' && p === '/api/draft') return putDraft(JSON.parse(JSON.stringify(opts.body)), h['If-Match'], token);
        if (method === 'POST' && p === '/api/publish') return publish(h['If-Match'], token);
        if (method === 'GET' && p === '/api/revisions') return revisions(token);
        if (method === 'POST' && p === '/api/rollback') return rollback(opts.body, token);
        if (method === 'POST' && p === '/api/upload') return upload(opts.body, decodeURIComponent(h['X-Filename'] || ''), token);
        if (method === 'GET' && p === '/api/audit') return audit(token);
        return fail(404, '不支援的操作');
      } catch (e) {
        return fail(500, '雲端後台錯誤：' + (e && e.message ? e.message : e));
      }
    }
  };
})();
