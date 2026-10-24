/**
 * 台北喜來登 2027 新春網站｜雲端後台 API（Cloudflare Workers）
 *
 * - 帳號密碼登入：PBKDF2-SHA256（100,000 次，Workers 上限）＋每帳號隨機鹽，存於 D1
 * - 工作階段：隨機 32 bytes 權杖，只把 SHA-256 雜湊存進 D1；8 小時到期；以 Authorization: Bearer 傳遞（不用 Cookie，避免 CSRF）
 * - 連續 5 次密碼錯誤鎖定 15 分鐘；所有登入、帳號異動與內容操作寫入稽核紀錄
 * - 角色：admin（帳號管理＋發布）、publisher（發布）、editor（草稿、上傳）
 * - 內容寫入 GitHub 儲存庫：GITHUB_TOKEN 只存在 Worker secret，瀏覽器拿不到
 *     草稿 cms/draft.json（不觸發部署）；發布 data/content.json（觸發 GitHub Actions 驗證與部署）；上傳 assets/uploads/
 * - CORS 只允許 ALLOWED_ORIGINS
 */

const PBKDF2_ITER = 100000;
const SESSION_TTL_MS = 8 * 3600 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_DOC = 2 * 1024 * 1024;
const MAX_UPLOAD = 3 * 1024 * 1024;
const ROLES = ['admin', 'publisher', 'editor'];
const USER_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const DRAFT = 'cms/draft.json';
const CONTENT = 'data/content.json';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- 小工具 ----------
function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); }
async function sha256hex(data) { return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data)); }
async function pbkdf2(password, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function b64encodeBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64decodeText(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}
const nowIso = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, '+08:00');
const dump = (doc) => JSON.stringify(doc, null, 2) + '\n';

function passwordProblem(pw, username) {
  if (typeof pw !== 'string' || pw.length < 12) return '密碼至少 12 個字元';
  if (pw.length > 128) return '密碼最多 128 個字元';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds < 3) return '密碼需包含大寫、小寫、數字、符號其中至少三種';
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return '密碼不可包含帳號名稱';
  return null;
}

// ---------- 回應與 CORS ----------
function corsHeaders(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, X-Filename', 'Access-Control-Expose-Headers': 'ETag', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(env, req, status, obj, extra) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, corsHeaders(env, req), extra || {}) });
}
const fail = (env, req, status, error, more) => json(env, req, status, Object.assign({ error }, more || {}));

// ---------- 稽核 ----------
async function audit(env, username, action, revision, detail, req) {
  const ip = req ? (req.headers.get('CF-Connecting-IP') || '') : '';
  await env.DB.prepare('INSERT INTO audit (ts, username, action, revision, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(nowIso(), username || '', action, revision == null ? null : String(revision), String(detail || '').slice(0, 500), ip).run();
}

// ---------- GitHub ----------
async function gh(env, method, path, body) {
  const r = await fetch('https://api.github.com/repos/' + env.GITHUB_REPO + path, {
    method,
    headers: { ...(env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + env.GITHUB_TOKEN } : {}), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sheraton-cny-cms-worker', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  return { status: r.status, ok: r.ok, data };
}
const branch = (env) => env.GITHUB_BRANCH || 'main';
async function readFile(env, path, ref) {
  const r = await gh(env, 'GET', '/contents/' + path + '?ref=' + encodeURIComponent(ref || branch(env)));
  if (r.status === 404) return { missing: true };
  if (!r.ok) return { error: r.status };
  let content = r.data.content;
  if (!content && r.data.sha) {
    const b = await gh(env, 'GET', '/git/blobs/' + r.data.sha);
    content = b.data && b.data.content;
  }
  return { sha: r.data.sha, text: b64decodeText(content) };
}
async function writeFile(env, path, base64, message, sha) {
  const body = { message, content: base64, branch: branch(env) };
  if (sha) body.sha = sha;
  return gh(env, 'PUT', '/contents/' + path, body);
}

// ---------- 工作階段 ----------
async function currentUser(env, req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('Authorization') || '');
  if (!m) return null;
  const th = await sha256hex(m[1]);
  const row = await env.DB.prepare('SELECT s.expires, u.id, u.username, u.display_name, u.role, u.disabled, u.must_change FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(th).first();
  if (!row || row.disabled || row.expires < Date.now()) return null;
  return Object.assign(row, { tokenHash: th });
}
function rank(role) { return { editor: 1, publisher: 2, admin: 3 }[role] || 0; }

// ---------- 帳號 ----------
async function login(env, req) {
  const body = await req.json().catch(() => null);
  const username = String((body && body.username) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  const generic = () => fail(env, req, 401, '帳號或密碼錯誤');
  if (!USER_RE.test(username) || !password) return generic();
  const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!u) { await pbkdf2(password, '00'.repeat(16), PBKDF2_ITER); await audit(env, username, 'login_fail', null, '無此帳號', req); return generic(); }
  if (u.disabled) { await audit(env, username, 'login_fail', null, '帳號已停用', req); return fail(env, req, 403, '帳號已停用，請洽管理員'); }
  if (u.locked_until && u.locked_until > Date.now()) return fail(env, req, 423, '密碼錯誤次數過多，帳號暫時鎖定，請 15 分鐘後再試或洽管理員');
  const h = await pbkdf2(password, u.salt, u.iterations);
  if (!safeEqual(h, u.pw_hash)) {
    const fails = (u.failed || 0) + 1;
    const lock = fails >= MAX_FAILS ? Date.now() + LOCK_MS : null;
    await env.DB.prepare('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?').bind(lock ? 0 : fails, lock, u.id).run();
    await audit(env, username, 'login_fail', null, lock ? '連續錯誤，鎖定 15 分鐘' : '密碼錯誤 ' + fails + ' 次', req);
    return generic();
  }
  const token = randomHex(32);
  const expires = Date.now() + SESSION_TTL_MS;
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET failed = 0, locked_until = NULL, last_login = ? WHERE id = ?').bind(nowIso(), u.id),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires, created_at) VALUES (?, ?, ?, ?)').bind(await sha256hex(token), u.id, expires, nowIso()),
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(Date.now())
  ]);
  await audit(env, username, 'login', null, '', req);
  return json(env, req, 200, { token, expires, user: { username: u.username, displayName: u.display_name, role: u.role, mustChange: !!u.must_change } });
}

async function changeOwnPassword(env, req, me) {
  const body = await req.json().catch(() => null);
  if (!body) return fail(env, req, 400, '格式錯誤');
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first();
  if (!safeEqual(await pbkdf2(String(body.current || ''), u.salt, u.iterations), u.pw_hash)) return fail(env, req, 403, '目前密碼不正確');
  const p = passwordProblem(body.next, u.username);
  if (p) return fail(env, req, 422, p);
  if (body.next === body.current) return fail(env, req, 422, '新密碼不可與目前密碼相同');
  const salt = randomHex(16);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pw_hash = ?, salt = ?, iterations = ?, must_change = 0, updated_at = ? WHERE id = ?').bind(await pbkdf2(body.next, salt, PBKDF2_ITER), salt, PBKDF2_ITER, nowIso(), u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(u.id, me.tokenHash)
  ]);
  await audit(env, u.username, 'password_change', null, '', req);
  return json(env, req, 200, { ok: true });
}

async function listUsers(env, req) {
  const r = await env.DB.prepare('SELECT id, username, display_name, role, disabled, must_change, locked_until, last_login, created_at, updated_at FROM users ORDER BY id').all();
  return json(env, req, 200, { users: r.results.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, disabled: !!u.disabled, mustChange: !!u.must_change, locked: !!(u.locked_until && u.locked_until > Date.now()), lastLogin: u.last_login, createdAt: u.created_at, updatedAt: u.updated_at })) });
}

async function createUser(env, req, me) {
  const b = await req.json().catch(() => null);
  if (!b) return fail(env, req, 400, '格式錯誤');
  const username = String(b.username || '').trim().toLowerCase();
  if (!USER_RE.test(username)) return fail(env, req, 422, '帳號需為 3–32 字元的小寫英數字，可含 . _ -，且以英數字開頭');
  if (!ROLES.includes(b.role)) return fail(env, req, 422, '角色無效');
  const p = passwordProblem(b.password, username);
  if (p) return fail(env, req, 422, p);
  const dn = String(b.displayName || '').trim().slice(0, 40);
  const salt = randomHex(16);
  try {
    await env.DB.prepare('INSERT INTO users (username, display_name, role, pw_hash, salt, iterations, must_change, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .bind(username, dn, b.role, await pbkdf2(b.password, salt, PBKDF2_ITER), salt, PBKDF2_ITER, nowIso(), nowIso()).run();
  } catch (e) {
    return fail(env, req, 409, '帳號已存在');
  }
  await audit(env, me.username, 'user_create', null, username + '（' + b.role + '）', req);
  return json(env, req, 201, { ok: true });
}

async function updateUser(env, req, me, id) {
  const b = await req.json().catch(() => null);
  if (!b) return fail(env, req, 400, '格式錯誤');
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!u) return fail(env, req, 404, '找不到帳號');
  const sets = [], vals = [], notes = [];
  if (b.displayName !== undefined) { sets.push('display_name = ?'); vals.push(String(b.displayName).trim().slice(0, 40)); notes.push('名稱'); }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return fail(env, req, 422, '角色無效');
    if (u.id === me.id && b.role !== 'admin') return fail(env, req, 422, '不能降低自己的權限，請由其他管理員操作');
    sets.push('role = ?'); vals.push(b.role); notes.push('角色→' + b.role);
  }
  if (b.disabled !== undefined) {
    if (u.id === me.id && b.disabled) return fail(env, req, 422, '不能停用自己的帳號');
    sets.push('disabled = ?'); vals.push(b.disabled ? 1 : 0); notes.push(b.disabled ? '停用' : '啟用');
  }
  if (b.unlock) { sets.push('failed = 0', 'locked_until = NULL'); notes.push('解除鎖定'); }
  if (b.password !== undefined) {
    const p = passwordProblem(b.password, u.username);
    if (p) return fail(env, req, 422, p);
    const salt = randomHex(16);
    sets.push('pw_hash = ?', 'salt = ?', 'iterations = ?', 'must_change = 1', 'failed = 0', 'locked_until = NULL');
    vals.push(await pbkdf2(b.password, salt, PBKDF2_ITER), salt, PBKDF2_ITER);
    notes.push('重設密碼');
  }
  if (!sets.length) return fail(env, req, 400, '沒有要更新的欄位');
  if ((b.role !== undefined && b.role !== 'admin') || b.disabled) {
    const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?").bind(u.id).first();
    if (u.role === 'admin' && admins.n === 0) return fail(env, req, 422, '至少要保留一位啟用中的管理員');
  }
  sets.push('updated_at = ?'); vals.push(nowIso());
  const stmts = [env.DB.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals, u.id)];
  if (b.disabled || b.password !== undefined || b.role !== undefined) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id));
  await env.DB.batch(stmts);
  await audit(env, me.username, 'user_update', null, u.username + '：' + notes.join('、'), req);
  return json(env, req, 200, { ok: true });
}

async function deleteUser(env, req, me, id) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!u) return fail(env, req, 404, '找不到帳號');
  if (u.id === me.id) return fail(env, req, 422, '不能刪除自己的帳號');
  if (u.role === 'admin') {
    const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?").bind(u.id).first();
    if (admins.n === 0) return fail(env, req, 422, '至少要保留一位啟用中的管理員');
  }
  await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(u.id)]);
  await audit(env, me.username, 'user_delete', null, u.username, req);
  return json(env, req, 200, { ok: true });
}

// ---------- 內容 ----------
async function getContent(env, req, stage) {
  if (stage === 'draft') {
    const f = await readFile(env, DRAFT);
    if (f.text) return json(env, req, 200, JSON.parse(f.text), { ETag: '"' + f.sha + '"' });
    if (!f.missing) return fail(env, req, 502, '無法讀取草稿（GitHub ' + f.error + '）');
  }
  const c = await readFile(env, CONTENT);
  if (!c.text) return fail(env, req, 502, '無法讀取已發布內容（GitHub ' + c.error + '）');
  return json(env, req, 200, JSON.parse(c.text), { ETag: stage === 'draft' ? '"new"' : '"' + c.sha + '"' });
}
const etagOf = (req) => String(req.headers.get('If-Match') || '').replace(/^W\//, '').replace(/"/g, '');

async function putDraft(env, req, me) {
  const ifm = etagOf(req);
  if (!ifm) return fail(env, req, 428, '缺少 If-Match：請先載入草稿再儲存');
  const raw = await req.text();
  if (raw.length > MAX_DOC) return fail(env, req, 413, '文件超過 2 MB 上限');
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { return fail(env, req, 400, 'JSON 格式錯誤'); }
  if (!doc || typeof doc !== 'object' || !doc.meta) return fail(env, req, 422, '文件缺少 meta');
  const cur = await readFile(env, DRAFT);
  if (cur.error) return fail(env, req, 502, '無法讀取目前草稿（GitHub ' + cur.error + '）');
  const curTag = cur.missing ? 'new' : cur.sha;
  if (ifm !== curTag) {
    let meta = {};
    try { meta = JSON.parse(cur.text).meta || {}; } catch (e) { /* 忽略 */ }
    return fail(env, req, 409, '草稿已被其他人更新，請重新載入後再編輯', { etag: curTag, updatedAt: meta.updatedAt, updatedBy: meta.updatedBy });
  }
  doc.meta.updatedAt = nowIso();
  doc.meta.updatedBy = me.username;
  const w = await writeFile(env, DRAFT, b64encodeBytes(enc.encode(dump(doc))), 'CMS 草稿：' + me.username, cur.missing ? null : cur.sha);
  if (w.status === 409 || w.status === 422) return fail(env, req, 409, '草稿已被其他人更新，請重新載入後再編輯');
  if (!w.ok) return fail(env, req, 502, '儲存失敗（GitHub ' + w.status + '）');
  await audit(env, me.username, 'save_draft', doc.meta.revision, '', req);
  const tag = w.data.content.sha;
  return json(env, req, 200, { ok: true, etag: tag, meta: doc.meta }, { ETag: '"' + tag + '"' });
}

async function publish(env, req, me) {
  const cur = await readFile(env, DRAFT);
  if (cur.missing) return fail(env, req, 409, '尚無草稿，請先儲存草稿再發布');
  if (cur.error) return fail(env, req, 502, '無法讀取草稿（GitHub ' + cur.error + '）');
  const ifm = etagOf(req);
  if (ifm && ifm !== cur.sha) return fail(env, req, 409, '草稿已被其他人更新，請重新載入並確認後再發布', { etag: cur.sha });
  const doc = JSON.parse(cur.text);
  const pub = await readFile(env, CONTENT);
  let pubRev = 0;
  try { pubRev = parseInt(JSON.parse(pub.text).meta.revision, 10) || 0; } catch (e) { pubRev = 0; }
  const rev = Math.max(pubRev, parseInt(doc.meta.revision, 10) || 0) + 1;
  doc.meta.revision = rev;
  doc.meta.updatedAt = nowIso();
  doc.meta.updatedBy = me.username;
  const w = await writeFile(env, CONTENT, b64encodeBytes(enc.encode(dump(doc))), 'CMS 發布 rev ' + rev + '：' + me.username, pub.sha);
  if (!w.ok) return fail(env, req, 502, '發布失敗（GitHub ' + w.status + '）');
  await audit(env, me.username, 'publish', rev, '', req);
  return json(env, req, 200, { ok: true, revision: rev, updatedAt: doc.meta.updatedAt, note: '已送出，GitHub Actions 驗證與建置後約 1–2 分鐘上線' });
}

async function revisions(env, req) {
  const r = await gh(env, 'GET', '/commits?sha=' + encodeURIComponent(branch(env)) + '&path=' + encodeURIComponent(CONTENT) + '&per_page=30');
  if (!r.ok) return fail(env, req, 502, '無法讀取版本紀錄');
  const out = r.data.map((c, i) => {
    const m = /rev (\d+)：?(\S*)/.exec(c.commit.message);
    return { revision: m ? Number(m[1]) : c.sha.slice(0, 7), ref: c.sha, updatedAt: c.commit.author.date, updatedBy: (m && m[2]) || (c.author && c.author.login) || c.commit.author.name, live: i === 0 };
  });
  return json(env, req, 200, { revisions: out });
}

async function rollback(env, req, me) {
  const b = await req.json().catch(() => null);
  const list = await gh(env, 'GET', '/commits?sha=' + encodeURIComponent(branch(env)) + '&path=' + encodeURIComponent(CONTENT) + '&per_page=30');
  const hit = list.ok ? list.data.find((c) => String((/rev (\d+)/.exec(c.commit.message) || [])[1] || c.sha.slice(0, 7)) === String(b && b.revision)) : null;
  if (!hit) return fail(env, req, 404, '找不到此版本');
  const old = await readFile(env, CONTENT, hit.sha);
  if (!old.text) return fail(env, req, 502, '無法讀取該版本內容');
  const doc = JSON.parse(old.text);
  doc.meta.updatedAt = nowIso();
  doc.meta.updatedBy = me.username;
  const cur = await readFile(env, DRAFT);
  const w = await writeFile(env, DRAFT, b64encodeBytes(enc.encode(dump(doc))), 'CMS 還原 rev ' + b.revision + ' 至草稿：' + me.username, cur.missing ? null : cur.sha);
  if (!w.ok) return fail(env, req, 502, '還原失敗（GitHub ' + w.status + '）');
  await audit(env, me.username, 'rollback', b.revision, '還原至草稿', req);
  return json(env, req, 200, { ok: true, revision: b.revision, etag: w.data.content.sha }, { ETag: '"' + w.data.content.sha + '"' });
}

function sniff(b) {
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}
async function upload(env, req, me) {
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) return fail(env, req, 400, '沒有收到檔案內容');
  if (buf.length > MAX_UPLOAD) return fail(env, req, 413, '檔案超過 3 MB 上限');
  const ext = sniff(buf);
  if (!ext) return fail(env, req, 415, '僅接受 JPEG、PNG、WebP 圖片（依檔案內容判斷，非副檔名）');
  const rel = 'assets/uploads/' + (await sha256hex(buf)).slice(0, 16) + '.' + ext;
  const exists = await gh(env, 'GET', '/contents/' + rel + '?ref=' + encodeURIComponent(branch(env)));
  if (!exists.ok) {
    const name = decodeURIComponent(req.headers.get('X-Filename') || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80);
    const w = await writeFile(env, rel, b64encodeBytes(buf), 'CMS 上傳 ' + rel + ' ← ' + name + '：' + me.username);
    if (!w.ok) return fail(env, req, 502, '上傳失敗（GitHub ' + w.status + '）');
  }
  await audit(env, me.username, 'upload', null, rel, req);
  return json(env, req, 201, { path: rel, bytes: buf.length, type: ext });
}

async function auditLog(env, req) {
  const r = await env.DB.prepare('SELECT ts, username, action, revision, detail FROM audit ORDER BY id DESC LIMIT 200').all();
  return json(env, req, 200, { entries: r.results.map((e) => ({ ts: e.ts, role: e.username, action: e.action, revision: e.revision, detail: e.detail })) });
}

// ---------- 路由 ----------
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env, req) });
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '');
    const origin = req.headers.get('Origin');
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
    if (origin && !allowed.includes(origin)) return fail(env, req, 403, '來源網域未被允許');
    try {
      if (p === '/api/health') return json(env, req, 200, { ok: true });
      if (p === '/api/login' && req.method === 'POST') return login(env, req);

      const me = await currentUser(env, req);
      if (!me) return fail(env, req, 401, '請先登入');
      if (p === '/api/logout' && req.method === 'POST') { await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(me.tokenHash).run(); return json(env, req, 200, { ok: true }); }
      if (p === '/api/whoami') return json(env, req, 200, { role: me.role, username: me.username, displayName: me.display_name, mustChange: !!me.must_change });
      if (p === '/api/password' && req.method === 'POST') return changeOwnPassword(env, req, me);
      if (me.must_change) return fail(env, req, 403, '請先變更密碼', { mustChange: true });

      if (p === '/api/content' && req.method === 'GET') return getContent(env, req, url.searchParams.get('stage') === 'draft' ? 'draft' : 'published');
      if (p === '/api/draft' && req.method === 'PUT') return putDraft(env, req, me);
      if (p === '/api/upload' && req.method === 'POST') return upload(env, req, me);
      if (p === '/api/revisions' && req.method === 'GET') return revisions(env, req);

      if (rank(me.role) < 2) return fail(env, req, 403, '權限不足（需發布者以上）');
      if (p === '/api/publish' && req.method === 'POST') return publish(env, req, me);
      if (p === '/api/rollback' && req.method === 'POST') return rollback(env, req, me);
      if (p === '/api/audit' && req.method === 'GET') return auditLog(env, req);

      if (rank(me.role) < 3) return fail(env, req, 403, '權限不足（需管理員）');
      if (p === '/api/users' && req.method === 'GET') return listUsers(env, req);
      if (p === '/api/users' && req.method === 'POST') return createUser(env, req, me);
      const m = /^\/api\/users\/(\d+)$/.exec(p);
      if (m && req.method === 'PATCH') return updateUser(env, req, me, Number(m[1]));
      if (m && req.method === 'DELETE') return deleteUser(env, req, me, Number(m[1]));
      return fail(env, req, 404, '不支援的操作');
    } catch (e) {
      return fail(env, req, 500, '伺服器錯誤：' + (e && e.message ? e.message : e));
    }
  }
};
