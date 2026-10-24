/* 後台上稿平台（vanilla JS，無框架、無外部套件）
 * 資料唯一來源：data/content.json（已發布）與 data/draft.json（草稿），經由 server.py 的 /api 存取。
 * 所有資料一律以 textContent / value 寫入 DOM，不使用 innerHTML，避免 XSS。
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // 常數
  // ------------------------------------------------------------------
  const MODULES = [
    { id: 'meta', label: '網站設定', keys: ['meta', 'nav', 'ctaTypes'] },
    { id: 'brand', label: '品牌 CIS', keys: ['brand'] },
    { id: 'contacts', label: '聯絡資訊', keys: ['contacts'] },
    { id: 'hero', label: '首頁 Banner', keys: ['hero'] },
    { id: 'paths', label: '四大需求入口', keys: ['paths'] },
    { id: 'takeaway', label: '外帶年菜', keys: ['takeaway'] },
    { id: 'dining', label: '餐廳內用', keys: ['dining'] },
    { id: 'banquet', label: '宴會廳', keys: ['banquet'] },
    { id: 'events', label: '館內活動', keys: ['events'] },
    { id: 'gifts', label: '通路伴手禮', keys: ['gifts'] },
    { id: 'faq', label: '須知 FAQ', keys: ['faq'] },
    { id: 'footer', label: '頁尾', keys: ['footer'] },
    { id: 'seo', label: 'SEO 與追蹤碼', keys: ['seo', 'tracking'] },
    { id: 'revisions', label: '版本紀錄', special: true },
    { id: 'audit', label: '操作紀錄', special: true, publisherOnly: true }
  ];
  const REQUIRED_KEYS = ['meta', 'brand', 'contacts', 'nav', 'hero', 'takeaway', 'dining', 'banquet', 'events', 'gifts', 'faq', 'footer'];
  const STATUS_OPTIONS = [
    ['onsale', '販售中'], ['coming', '即將公布'], ['soldout', '已售完'],
    ['confirmed', '已確認'], ['sample', '示意'], ['hidden', '隱藏（前台不顯示）']
  ];
  const STATUS_VALUES = STATUS_OPTIONS.map(o => o[0]);
  const IMAGE_STATUS_OPTIONS = [['official', '正式'], ['reference', '參考'], ['placeholder', '示意'], ['none', '無']];
  const IMAGE_STATUS_VALUES = IMAGE_STATUS_OPTIONS.map(o => o[0]);
  const IMAGE_KEYS = new Set(['image', 'onDark', 'onLight', 'ogImage', 'heroImage']);
  const TEL_KEYS = new Set(['tel', 'bookingTel', 'directTel']);
  const TEL_TYPES = new Set(['phone', 'inquiry']);
  const URL_TYPES = new Set(['booking', 'buy', 'link']);
  const CTA_FIELD = { phone: 'tel', inquiry: 'tel', booking: 'url', buy: 'url', link: 'url', anchor: 'target' };
  const NOTE_KEYS = new Set(['verify', 'source']);
  const READONLY = new Set(['meta.revision', 'meta.updatedAt', 'meta.updatedBy']);
  const LONG_KEYS = new Set(['desc', 'lead', 'text', 'a', 'notes', 'note', 'verify', 'source', 'description', 'legal', 'trademark', 'copyright']);
  const TEL_RE = /^\+886\d{8,9}$/;
  const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
  const HTTPS_RE = /^https:\/\/\S+$/;
  const MAX_DOC_BYTES = 2 * 1024 * 1024;
  const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
  const CONTRAST_PAIRS = [
    ['ink', 'ivory', '墨色文字／暖象牙底'],
    ['white', 'red', '白字／新春紅底'],
    ['champagne', 'wine', '香檳字／深酒紅底']
  ];
  const TRACK_RULES = {
    ga4: [/^G-[A-Z0-9]{4,12}$/, 'GA4 評估 ID 格式為 G-XXXXXXXXXX'],
    gtm: [/^GTM-[A-Z0-9]{4,10}$/, 'GTM 容器 ID 格式為 GTM-XXXXXXX'],
    googleAds: [/^AW-\d{6,12}$/, 'Google Ads 轉換 ID 格式為 AW-123456789'],
    metaPixel: [/^\d{10,20}$/, 'Meta Pixel ID 為 10–20 位數字']
  };
  const AUDIT_LABELS = { save_draft: '儲存草稿', publish: '發布', rollback: '還原至草稿', upload: '上傳圖片', auth_fail: '金鑰驗證失敗' };
  const ROLE_LABELS = { editor: '編輯者', publisher: '發布者' };

  const LABELS = {
    meta: '網站設定', nav: '導覽列', ctaTypes: 'CTA 類型', brand: '品牌 CIS', contacts: '聯絡資訊',
    hero: '首頁 Banner', takeaway: '外帶年菜', dining: '餐廳內用', banquet: '宴會廳', events: '館內活動',
    gifts: '通路伴手禮', faq: '須知 FAQ', footer: '頁尾',
    siteVersion: '網站版本', revision: '版本號（系統管理）', updatedAt: '更新時間（系統管理）', updatedBy: '更新者（系統管理）',
    stage: '階段', noindex: '禁止搜尋引擎索引', title: '標題', description: '頁面描述', note: '備註',
    approvedPalette: '核准色盤', name: '名稱', hex: '色碼', source: '資料來源', tokens: '色彩代號',
    fonts: '字體', serif: '襯線字體', serifWeights: '襯線字重', serifLicense: '字體授權', sans: '無襯線字體',
    logo: '標誌', onDark: '深色底標誌', onLight: '淺色底標誌', alt: '替代文字', rules: '使用規範',
    main: '主要電話', label: '顯示文字', tel: '電話（國際格式）', display: '顯示號碼', fax: '傳真', email: '電子郵件',
    lounge: '大廳酒吧電話', address: '地址', taxId: '統一編號', id: '識別碼',
    eyebrow: '眉標', lead: '引言', image: '圖片', imageAlt: '圖片替代文字（alt）', imageStatus: '圖片授權狀態',
    scenes: '輪播情境', kicker: '小標', text: '內文', target: '頁內錨點', icon: '圖示',
    categories: '分類', items: '項目', status: '狀態', featured: '精選', category: '分類', venue: '餐廳／場地',
    tag: '標籤', serve: '份量', price: '售價', originalPrice: '原價', priceNote: '價格說明', periods: '期間',
    value: '內容', desc: '說明', menu: '菜單', notes: '注意事項', officialImage: '官網圖片網址',
    ctas: '行動按鈕（CTA）', verify: '待確認事項', restaurants: '餐廳', type: '類型', booking: '訂位方式',
    url: '網址', cnyPhoneOnly: '春節僅電話訂位', telDisplay: '顯示電話', page: '官網頁面', dates: '日期',
    md: '月日', wd: '星期', lunar: '農曆', meals: '餐期', defaultDate: '預設日期', defaultMeal: '預設餐期',
    offers: '餐價方案', restaurant: '餐廳 id', meal: '餐期', slots: '場次', time: '時間', adult: '成人價',
    child: '兒童價', deposit: '訂金', noDiscount: '不適用優惠', extra: '補充說明', bookingNote: '訂位備註',
    bookingTel: '訂位電話', discounts: '優惠說明（依日期）', rooms: '包廂低消', columns: '欄位', rows: '資料列',
    statusLabel: '狀態文字', date: '日期', prices: '價格', preset: '預設選項', days: '日期', place: '地點',
    channels: '通路', spec: '規格', pickup: '提貨資訊', seal: '印章字', corporate: '企業採購', q: '問題', a: '回答',
    company: '公司名稱', hotel: '飯店名稱', copyright: '版權聲明', trademark: '商標聲明', links: '連結',
    social: '社群', legal: '法律聲明', drinkWarning: '飲酒警語',
    ink: '墨色', white: '白', champagne: '香檳', muted: '次要文字',
    red: '新春紅', wine: '深酒紅', ivory: '暖象牙', gold: '金線',
    seo: 'SEO', tracking: '追蹤碼', siteUrl: '正式網址（canonical）', ogImage: '社群分享圖（1200×630 以上）', ogImageAlt: '分享圖說明',
    siteName: '網站名稱', locale: '語系', keywords: '關鍵字', structuredData: '輸出結構化資料（Schema.org）', googleSiteVerification: 'Google Search Console 驗證碼',
    ga4: 'GA4 評估 ID（G-）', gtm: 'Google Tag Manager ID（GTM-）', googleAds: 'Google Ads 轉換 ID（AW-）', metaPixel: 'Meta Pixel ID',
    cookieNotice: '顯示 Cookie 告知列', cookieText: 'Cookie 告知文字', nameEn: '英文名稱', floor: '樓層', directTel: '餐廳直撥（國際格式）',
    directTelDisplay: '餐廳直撥顯示', bookingHub: '全部餐廳訂位入口', dining: '餐廳訂位專線', banquet: '宴會業務部', line: 'LINE 官方帳號', heroImage: '橫幅圖片'
  };

  // ------------------------------------------------------------------
  // 狀態
  // ------------------------------------------------------------------
  const S = {
    token: null, role: null,
    draft: null, published: null, etag: null, savedJSON: '',
    module: 'meta', errors: [], open: new Set(), previewOpen: false
  };

  const $ = (sel) => document.querySelector(sel);
  let idSeq = 0;
  const nextId = () => 'f' + (++idSeq);

  // ------------------------------------------------------------------
  // 小工具
  // ------------------------------------------------------------------
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (children) {
      for (const c of [].concat(children)) {
        if (c === null || c === undefined || c === false) continue;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return e;
  }
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const pathKey = (path) => path.join('.');

  function fmtPath(parts) {
    let s = '';
    for (const p of parts) {
      if (typeof p === 'number') s += '[' + p + ']';
      else s += (s ? '.' : '') + p;
    }
    return s || '（根）';
  }
  function parsePath(str) {
    const out = [];
    const re = /([^.[\]]+)|\[(\d+)\]/g;
    let m;
    while ((m = re.exec(str))) out.push(m[2] !== undefined ? Number(m[2]) : m[1]);
    return out;
  }
  function getAt(path) {
    let cur = S.draft;
    for (const p of path) { if (cur == null) return undefined; cur = cur[p]; }
    return cur;
  }
  function setAt(path, value) {
    let cur = S.draft;
    for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
    cur[path[path.length - 1]] = value;
    changed();
  }
  function labelOf(key) {
    if (typeof key === 'number') return '第 ' + (key + 1) + ' 項';
    return LABELS[key] || key;
  }
  function moduleForKey(top) {
    const m = MODULES.find(x => x.keys && x.keys.includes(top));
    return m ? m.id : 'meta';
  }
  function moduleKeys(mod) {
    if (mod.id !== 'meta') return mod.keys;
    // 未對應到任何模組的頂層欄位，一律放在「網站設定」
    const known = new Set(MODULES.flatMap(m => m.keys || []));
    const extra = S.draft ? Object.keys(S.draft).filter(k => !known.has(k)) : [];
    return mod.keys.concat(extra);
  }
  function isDirty() { return S.draft && JSON.stringify(S.draft) !== S.savedJSON; }

  let toastTimer = null;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 6000 : 3500);
  }

  function modal(opts) {
    return new Promise((resolve) => {
      const d = $('#modal');
      $('#modal-title').textContent = opts.title || '';
      const body = $('#modal-body');
      body.replaceChildren();
      if (opts.body) {
        for (const b of [].concat(opts.body)) body.appendChild(typeof b === 'string' ? el('p', { text: b }) : b);
      }
      if (opts.list && opts.list.length) {
        body.appendChild(el('ul', null, opts.list.map(x => el('li', { text: x }))));
      }
      const acts = $('#modal-actions');
      acts.replaceChildren();
      for (const a of opts.actions || [{ id: 'ok', label: '確定', primary: true }]) {
        acts.appendChild(el('button', {
          type: 'submit', value: a.id,
          class: 'btn ' + (a.primary ? (a.danger ? 'btn-accent' : 'btn-primary') : '')
        }, a.label));
      }
      d.returnValue = '';
      d.addEventListener('close', () => resolve(d.returnValue || 'cancel'), { once: true });
      d.showModal();
      const first = acts.querySelector('.btn-primary, .btn-accent') || acts.querySelector('button');
      if (first) first.focus();
    });
  }

  // ------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------
  async function api(method, path, opts) {
    opts = opts || {};
    if (window.CMS_BACKEND) {
      const r = await window.CMS_BACKEND.api(method, path, opts, S.token || '');
      if (r.status === 401 && S.role) { S.role = null; toast('登入已失效，請重新輸入金鑰', 'error'); showLogin('登入已失效，請重新輸入金鑰'); }
      return r;
    }
    const headers = Object.assign({ 'X-Admin-Token': S.token || '' }, opts.headers || {});
    let body = opts.body;
    if (body !== undefined && !(body instanceof Blob)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, { method, headers, body, cache: 'no-store', credentials: 'same-origin' });
    } catch (e) {
      return { status: 0, ok: false, data: { error: '無法連線到伺服器，請確認 server.py 是否執行中' } };
    }
    let data = null;
    if ((res.headers.get('Content-Type') || '').includes('json')) {
      try { data = await res.json(); } catch (e) { data = null; }
    }
    if (res.status === 401 && S.role) {
      S.role = null;
      toast('登入已失效，請重新輸入金鑰', 'error');
      showLogin('登入已失效，請重新輸入金鑰');
    }
    return { status: res.status, ok: res.ok, data, etag: res.headers.get('ETag') };
  }
  const errMsg = (r, fallback) => (r.data && r.data.error) || fallback || ('發生錯誤（HTTP ' + r.status + '）');

  async function loadDraft() {
    const r = await api('GET', '/api/content?stage=draft');
    if (!r.ok) throw new Error(errMsg(r, '無法載入草稿'));
    S.draft = r.data;
    S.etag = r.etag;
    S.savedJSON = JSON.stringify(S.draft);
  }
  async function loadPublished() {
    const r = await api('GET', '/api/content?stage=published');
    if (r.ok) S.published = r.data;
  }

  // ------------------------------------------------------------------
  // 驗證（與 server.py validate_document 對應）
  // ------------------------------------------------------------------
  function imagePathOk(v) {
    if (v === '') return true;
    if (HTTPS_RE.test(v)) return true;
    if (!v.startsWith('assets/') || v.includes('\\') || v.includes('\0')) return false;
    return v.split('/').every(s => s !== '' && s !== '.' && s !== '..');
  }

  function validateDoc(doc) {
    const errors = [];
    const err = (p, m) => errors.push({ path: fmtPath(p), message: m });
    if (!isObj(doc)) return [{ path: '（根）', message: '文件必須是 JSON 物件' }];
    if (new Blob([JSON.stringify(doc)]).size > MAX_DOC_BYTES) err([], '文件超過 2 MB 上限');

    for (const k of REQUIRED_KEYS) {
      if (!(k in doc)) err([k], '缺少必要欄位「' + k + '」');
      else if (k === 'nav') { if (!Array.isArray(doc[k])) err([k], '「nav」必須是陣列'); }
      else if (!isObj(doc[k])) err([k], '「' + k + '」必須是物件');
    }

    const brand = doc.brand;
    const palette = new Set();
    if (isObj(brand)) {
      const pal = brand.approvedPalette;
      if (!Array.isArray(pal) || !pal.length) err(['brand', 'approvedPalette'], '核准色盤 approvedPalette 必須是非空陣列');
      else pal.forEach((p, i) => {
        const hx = isObj(p) ? p.hex : null;
        if (typeof hx !== 'string' || !HEX_RE.test(hx)) err(['brand', 'approvedPalette', i, 'hex'], '色碼格式必須為 #RRGGBB');
        else palette.add(hx.toUpperCase());
      });
      const tokens = brand.tokens;
      if (!isObj(tokens)) err(['brand', 'tokens'], '色彩代號 tokens 必須是物件');
      else for (const name of Object.keys(tokens)) {
        const val = tokens[name];
        if (typeof val !== 'string' || !palette.has(val.toUpperCase())) {
          err(['brand', 'tokens', name], '色彩「' + val + '」不在核准色盤 approvedPalette 中，請改選核准色');
        }
      }
    }

    const navIds = Array.isArray(doc.nav) ? doc.nav.filter(n => isObj(n) && typeof n.id === 'string').map(n => n.id) : [];
    let ctaKeys = new Set();
    if (!isObj(doc.ctaTypes)) err(['ctaTypes'], '缺少 ctaTypes 或格式錯誤（必須是物件）');
    else ctaKeys = new Set(Object.keys(doc.ctaTypes));

    function checkCta(c, p) {
      if (!isObj(c)) { err(p, 'CTA 必須是物件'); return; }
      const t = c.type;
      if (!ctaKeys.has(t)) err(p.concat('type'), 'CTA 類型「' + t + '」不存在於 ctaTypes');
      if (TEL_TYPES.has(t)) {
        if (typeof c.tel !== 'string' || !TEL_RE.test(c.tel)) err(p.concat('tel'), '電話必須是 +886 開頭的國際格式（例：+886223215511），不可有空格或連字號');
      } else if (URL_TYPES.has(t)) {
        if (typeof c.url !== 'string' || !HTTPS_RE.test(c.url)) err(p.concat('url'), '網址必須以 https:// 開頭');
      } else if (t === 'anchor') {
        if (!navIds.includes(c.target)) err(p.concat('target'), '頁內錨點 target 必須是導覽列 nav 的 id（可用：' + navIds.join('、') + '）');
      }
    }

    function walk(node, path) {
      if (isObj(node)) {
        for (const k of Object.keys(node)) {
          const v = node[k];
          const p = path.concat(k);
          if (k === 'ctas') {
            if (!Array.isArray(v)) err(p, 'ctas 必須是陣列');
            else v.forEach((c, i) => checkCta(c, p.concat(i)));
            continue;
          }
          if (k === 'status') {
            if (!STATUS_VALUES.includes(v)) err(p, '狀態「' + v + '」無效，必須是：' + STATUS_VALUES.join('、'));
          } else if (k === 'imageStatus') {
            if (!IMAGE_STATUS_VALUES.includes(v)) err(p, '圖片授權狀態「' + v + '」無效，必須是：' + IMAGE_STATUS_VALUES.join('、'));
          } else if (IMAGE_KEYS.has(k)) {
            if (typeof v !== 'string' || !imagePathOk(v)) err(p, '圖片路徑必須留空、assets/ 底下的相對路徑，或 https:// 網址');
          } else if (k === 'url') {
            if (typeof v !== 'string' || (v !== '' && !HTTPS_RE.test(v))) err(p, '網址必須以 https:// 開頭');
          } else if (TEL_KEYS.has(k)) {
            if (typeof v !== 'string' || (v !== '' && !TEL_RE.test(v))) err(p, '電話必須是 +886 開頭的國際格式（例：+886223215511），不可有空格或連字號');
          }
          walk(v, p);
        }
        if (typeof node.image === 'string' && node.image !== '' && 'imageAlt' in node) {
          if (typeof node.imageAlt !== 'string' || !node.imageAlt.trim()) err(path.concat('imageAlt'), '已設定圖片，請填寫替代文字（alt）');
        }
        if (node.status === 'soldout' && Array.isArray(node.ctas)) {
          node.ctas.forEach((c, i) => { if (isObj(c) && c.type === 'buy') err(path.concat('ctas', i, 'type'), '已售完的項目不得顯示「線上購買」按鈕'); });
        }
      } else if (Array.isArray(node)) {
        node.forEach((x, i) => walk(x, path.concat(i)));
      }
    }
    walk(doc, []);

    for (const sec of ['takeaway', 'gifts']) {
      const s = doc[sec];
      if (!isObj(s)) continue;
      if (!Array.isArray(s.items)) { err([sec, 'items'], 'items 必須是陣列'); continue; }
      s.items.forEach((it, i) => {
        if (isObj(it) && it.status === 'onsale' && (!Array.isArray(it.ctas) || it.ctas.length === 0)) {
          err([sec, 'items', i, 'ctas'], '販售中的品項至少需要一個 CTA 按鈕');
        }
      });
    }

    const dining = doc.dining;
    if (isObj(dining) && Array.isArray(dining.offers)) {
      const rest = {};
      (dining.restaurants || []).forEach(r => { if (isObj(r) && typeof r.id === 'string') rest[r.id] = r; });
      dining.offers.forEach((o, i) => {
        if (!isObj(o)) return;
        const b = o.booking;
        if (b !== 'phone' && b !== 'online') err(['dining', 'offers', i, 'booking'], '訂位方式 booking 必須是 phone 或 online');
        const r = rest[o.restaurant];
        if (!r) err(['dining', 'offers', i, 'restaurant'], '找不到對應的餐廳 id「' + o.restaurant + '」');
        else if (isObj(r.booking) && r.booking.cnyPhoneOnly === true && b !== 'phone') {
          err(['dining', 'offers', i, 'booking'], '「' + (r.name || r.id) + '」春節期間僅受理電話訂位，booking 必須為 phone');
        }
      });
    }
    const tr = doc.tracking;
    if (tr !== undefined) {
      if (!isObj(tr)) err(['tracking'], '追蹤碼設定必須是物件');
      else for (const k of Object.keys(TRACK_RULES)) {
        const v = tr[k];
        if (v !== undefined && v !== '' && (typeof v !== 'string' || !TRACK_RULES[k][0].test(v))) err(['tracking', k], TRACK_RULES[k][1] + '；不使用請留空');
      }
    }
    const seo = doc.seo;
    if (isObj(seo)) {
      if (seo.siteUrl && !/^https:\/\/\S+\/$/.test(seo.siteUrl)) err(['seo', 'siteUrl'], '正式網址必須以 https:// 開頭、以 / 結尾');
      if (typeof seo.description === 'string' && seo.description.length > 160) err(['seo', 'description'], '頁面描述建議 160 字以內（目前 ' + seo.description.length + ' 字）');
      if (typeof seo.title === 'string' && seo.title.length > 60) err(['seo', 'title'], '標題建議 60 字以內');
      if (seo.googleSiteVerification && !/^[A-Za-z0-9_-]{10,100}$/.test(seo.googleSiteVerification)) err(['seo', 'googleSiteVerification'], '驗證碼只能包含英數字、- 與 _');
    }
    return errors;
  }

  // ------------------------------------------------------------------
  // 錯誤顯示
  // ------------------------------------------------------------------
  let validateTimer = null;
  function changed() {
    updateSaveState();
    clearTimeout(validateTimer);
    validateTimer = setTimeout(() => { S.errors = validateDoc(S.draft); renderErrorPanel(); applyErrorMarks(); }, 300);
  }

  function renderErrorPanel(forceOpen) {
    const panel = $('#error-panel');
    panel.replaceChildren();
    if (!S.errors.length) { panel.hidden = true; return; }
    panel.hidden = false;
    const det = el('details', { open: forceOpen || S.errors.length <= 5 ? true : null });
    det.appendChild(el('summary', { text: '有 ' + S.errors.length + ' 項欄位需要修正（點選可跳到欄位）' }));
    const ul = el('ul');
    for (const e of S.errors) {
      const parts = parsePath(e.path);
      const mod = MODULES.find(m => m.id === moduleForKey(parts[0]));
      ul.appendChild(el('li', null, el('button', {
        type: 'button', class: 'error-link', onclick: () => goToPath(parts)
      }, [mod ? mod.label + '｜' : '', el('code', { text: e.path }), '：' + e.message])));
    }
    det.appendChild(ul);
    panel.appendChild(det);
  }

  function applyErrorMarks() {
    document.querySelectorAll('#module .err-msg').forEach(n => n.remove());
    document.querySelectorAll('#module [aria-invalid="true"]').forEach(n => n.removeAttribute('aria-invalid'));
    for (const e of S.errors) {
      const key = pathKey(parsePath(e.path));
      const target = document.querySelector('#module [data-path="' + CSS.escape(key) + '"]');
      if (!target) continue;
      target.setAttribute('aria-invalid', 'true');
      const msgId = nextId();
      const msg = el('p', { class: 'err-msg', id: msgId, text: e.message });
      const holder = target.closest('.field') || target.parentElement;
      holder.appendChild(msg);
      const prev = (target.getAttribute('aria-describedby') || '').split(' ').filter(x => x && document.getElementById(x));
      target.setAttribute('aria-describedby', prev.concat(msgId).join(' '));
    }
  }

  function goToPath(parts) {
    S.module = moduleForKey(parts[0]);
    for (let i = 1; i <= parts.length; i++) S.open.add(pathKey(parts.slice(0, i)));
    renderNav();
    renderModule();
    for (let i = parts.length; i > 0; i--) {
      const t = document.querySelector('#module [data-path="' + CSS.escape(pathKey(parts.slice(0, i))) + '"]');
      if (t) {
        t.scrollIntoView({ block: 'center' });
        if (typeof t.focus === 'function') t.focus({ preventScroll: true });
        return;
      }
    }
  }

  // ------------------------------------------------------------------
  // 版面：導覽與狀態
  // ------------------------------------------------------------------
  function visibleModules() { return MODULES.filter(m => !m.publisherOnly || S.role === 'publisher'); }

  function renderNav() {
    const list = $('#module-list');
    list.replaceChildren();
    const sel = $('#module-select');
    sel.replaceChildren();
    for (const m of visibleModules()) {
      list.appendChild(el('li', null, el('button', {
        type: 'button', 'aria-current': m.id === S.module ? 'page' : null,
        onclick: () => switchModule(m.id)
      }, m.label)));
      sel.appendChild(el('option', { value: m.id, selected: m.id === S.module ? true : null }, m.label));
    }
    sel.value = S.module;
  }
  function switchModule(id) {
    S.module = id;
    renderNav();
    renderModule();
    $('#main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function updateSaveState() {
    const st = $('#save-state');
    const dirty = isDirty();
    st.classList.toggle('dirty', !!dirty);
    const meta = S.draft && S.draft.meta;
    const info = meta ? '草稿最後儲存：' + (meta.updatedAt || '—') + '（' + (ROLE_LABELS[meta.updatedBy] || meta.updatedBy || '—') + '）' : '';
    const live = S.published && S.published.meta ? '｜線上版本 rev ' + S.published.meta.revision : '';
    st.textContent = (dirty ? '● 有未儲存的變更　' : '已儲存　') + info + live;
  }

  // ------------------------------------------------------------------
  // 模組渲染
  // ------------------------------------------------------------------
  function renderModule() {
    const y = window.scrollY;
    const root = $('#module');
    root.replaceChildren();
    idSeq = 0;
    const mod = MODULES.find(m => m.id === S.module) || MODULES[0];
    if (mod.id === 'revisions') { renderRevisions(root); return; }
    if (mod.id === 'audit') { renderAudit(root); return; }

    root.appendChild(el('div', { class: 'module-head' }, [el('h1', { text: mod.label })]));
    for (const key of moduleKeys(mod)) {
      const card = el('section', { class: 'section-card', 'aria-labelledby': 'sec-' + key });
      card.appendChild(el('h2', { id: 'sec-' + key }, [labelOf(key), el('code', { text: key })]));
      if (!(key in S.draft)) {
        card.appendChild(el('p', { class: 'error-text', text: '草稿中缺少此欄位，請用下方「原始 JSON」建立。' }));
      } else if (key === 'brand' && isObj(S.draft.brand)) {
        card.appendChild(renderBrand());
      } else {
        card.appendChild(renderValue([key], S.draft[key], null));
      }
      card.appendChild(renderRawJson(key));
      root.appendChild(card);
    }
    applyErrorMarks();
    window.scrollTo(0, y);
  }

  function rerender() { renderModule(); changed(); }

  function renderValue(path, value, parent) {
    const key = path[path.length - 1];
    if (typeof key === 'string') {
      if (key === 'status' && (typeof value === 'string' || value == null)) return selectField(path, value, STATUS_OPTIONS);
      if (key === 'imageStatus') return selectField(path, value, IMAGE_STATUS_OPTIONS);
      if (key === 'effect' && S.draft && S.draft.hero && Array.isArray(S.draft.hero.effectOptions)) return selectField(path, value, S.draft.hero.effectOptions.map(o => [o.id, o.label]));
      if (IMAGE_KEYS.has(key) && typeof value === 'string') return imageField(path, value, parent);
    }
    if (Array.isArray(value)) return arrayField(path, value);
    if (isObj(value)) {
      const parentKey = path[path.length - 2];
      if (parentKey === 'ctas') return ctaField(path, value);
      return objectField(path, value);
    }
    if (typeof value === 'boolean') return checkboxField(path, value);
    if (typeof value === 'number') return numberField(path, value);
    return textField(path, value == null ? '' : String(value));
  }

  function fieldLabel(path, id, extra) {
    const key = path[path.length - 1];
    const kids = [labelOf(key)];
    if (typeof key === 'string') kids.push(el('code', { text: key }));
    if (extra) kids.push(extra);
    return el('label', { for: id }, kids);
  }

  function textField(path, value, opts) {
    opts = opts || {};
    const key = path[path.length - 1];
    const id = nextId();
    const pk = pathKey(path);
    const long = opts.long || LONG_KEYS.has(key) || value.length > 60;
    const isNote = NOTE_KEYS.has(key);
    const attrs = {
      id, dataset: { path: pk }, readonly: READONLY.has(pk) ? true : null,
      'aria-describedby': opts.help ? id + '-h' : null,
      placeholder: opts.placeholder || null,
      oninput: (e) => setAt(path, e.target.value)
    };
    let input;
    if (long) {
      input = el('textarea', Object.assign(attrs, { rows: Math.min(8, Math.max(3, Math.ceil(value.length / 50))) }));
      input.value = value;
    } else {
      input = el('input', Object.assign(attrs, { type: opts.type || 'text', value, autocomplete: 'off' }));
      if (opts.type === 'tel') input.setAttribute('inputmode', 'tel');
    }
    return el('div', { class: 'field' + (isNote ? ' note-field' : '') }, [
      fieldLabel(path, id, opts.required ? el('span', { class: 'req', 'aria-hidden': 'true', text: '*' }) : null),
      input,
      opts.help ? el('p', { class: 'help', id: id + '-h', text: opts.help }) : null
    ]);
  }

  function numberField(path, value) {
    const id = nextId();
    const input = el('input', {
      id, type: 'number', step: 'any', inputmode: 'decimal', value: String(value), dataset: { path: pathKey(path) },
      readonly: READONLY.has(pathKey(path)) ? true : null,
      oninput: (e) => { const v = e.target.value; setAt(path, v === '' ? null : Number(v)); }
    });
    return el('div', { class: 'field' }, [fieldLabel(path, id), input]);
  }

  function checkboxField(path, value) {
    const id = nextId();
    const input = el('input', { id, type: 'checkbox', dataset: { path: pathKey(path) }, onchange: (e) => setAt(path, e.target.checked) });
    input.checked = value;
    const key = path[path.length - 1];
    return el('div', { class: 'field' }, el('label', { class: 'check', for: id }, [input, labelOf(key), el('code', { text: String(key) })]));
  }

  function selectField(path, value, options, onChange) {
    const id = nextId();
    const sel = el('select', { id, dataset: { path: pathKey(path) } });
    const values = options.map(o => o[0]);
    if (!values.includes(value)) sel.appendChild(el('option', { value: value == null ? '' : value, text: '（無效值）' + (value == null ? '空白' : value) }));
    for (const [v, l] of options) sel.appendChild(el('option', { value: v, text: l + '（' + v + '）' }));
    sel.value = value == null ? '' : value;
    sel.addEventListener('change', () => { setAt(path, sel.value); if (onChange) onChange(sel.value); });
    return el('div', { class: 'field' }, [fieldLabel(path, id), sel]);
  }

  function objectField(path, obj, opts) {
    opts = opts || {};
    const skip = new Set(opts.skip || []);
    const hasImage = typeof obj.image === 'string';
    if (hasImage) { skip.add('imageAlt'); skip.add('imageStatus'); }
    const wrap = el('div', { class: 'obj', 'data-path': pathKey(path), tabindex: '-1' });
    // 校稿備註優先顯示
    const keys = Object.keys(obj).filter(k => !skip.has(k));
    keys.sort((a, b) => (NOTE_KEYS.has(b) ? 1 : 0) - (NOTE_KEYS.has(a) ? 1 : 0));
    for (const k of keys) {
      const v = obj[k];
      const p = path.concat(k);
      if (isObj(v) && !(path.length && path[path.length - 1] === 'ctas')) {
        const fs = el('fieldset', { class: 'group', 'data-path': pathKey(p), tabindex: '-1' });
        fs.appendChild(el('legend', null, [labelOf(k), el('code', { text: k })]));
        fs.appendChild(renderValue(p, v, obj));
        wrap.appendChild(fs);
      } else if (Array.isArray(v)) {
        const fs = el('fieldset', { class: 'group', 'data-path': pathKey(p), tabindex: '-1' });
        fs.appendChild(el('legend', null, [labelOf(k), el('code', { text: k }), ' ', el('span', { class: 'badge', text: v.length + ' 項' })]));
        fs.appendChild(arrayField(p, v));
        wrap.appendChild(fs);
      } else {
        wrap.appendChild(renderValue(p, v, obj));
      }
    }
    return wrap;
  }

  // --- CTA ---
  function ctaField(path, cta) {
    const wrap = el('div', { class: 'obj cta', 'data-path': pathKey(path), tabindex: '-1' });
    const types = isObj(S.draft.ctaTypes) ? S.draft.ctaTypes : {};
    const opts = Object.keys(types).map(k => [k, (types[k] && types[k].label) || k]);
    wrap.appendChild(selectField(path.concat('type'), cta.type, opts, (t) => {
      const keep = CTA_FIELD[t];
      for (const f of ['tel', 'url', 'target']) if (f !== keep) delete cta[f];
      if (keep && !(keep in cta)) cta[keep] = keep === 'target' && Array.isArray(S.draft.nav) && S.draft.nav[0] ? S.draft.nav[0].id : '';
      rerender();
    }));
    const relevant = CTA_FIELD[cta.type];
    const showAll = !relevant;
    if (relevant === 'tel' || (showAll && 'tel' in cta)) {
      wrap.appendChild(textField(path.concat('tel'), String(cta.tel || ''), { type: 'tel', required: true, placeholder: '+886223215511', help: '國際格式：+886 後接區碼與號碼，不含 0、空格或連字號（例：02-2321-5511 → +886223215511）' }));
    }
    if (relevant === 'url' || (showAll && 'url' in cta)) {
      wrap.appendChild(textField(path.concat('url'), String(cta.url || ''), { type: 'url', required: true, placeholder: 'https://', help: '必須以 https:// 開頭' }));
    }
    if (relevant === 'target' || (showAll && 'target' in cta)) {
      const navOpts = (Array.isArray(S.draft.nav) ? S.draft.nav : []).filter(isObj).map(n => [n.id, n.label || n.id]);
      wrap.appendChild(selectField(path.concat('target'), cta.target, navOpts));
    }
    const restEl = objectField(path, cta, { skip: ['type', 'tel', 'url', 'target'] });
    restEl.removeAttribute('data-path');
    wrap.appendChild(restEl);
    return wrap;
  }

  // --- 圖片 ---
  function imageSrc(v) {
    if (!v || !imagePathOk(v)) return '';
    return HTTPS_RE.test(v) ? v : '/' + v;
  }

  function imageField(path, value, parent) {
    const key = path[path.length - 1];
    const parentPath = path.slice(0, -1);
    const id = nextId();
    const fs = el('fieldset', { class: 'group', 'data-path': pathKey(path) + '#group' });
    fs.appendChild(el('legend', null, [labelOf(key), el('code', { text: key })]));

    const thumb = el('div', { class: 'thumb' + (key === 'onDark' ? ' dark' : '') });
    const status = el('p', { class: 'upload-status', role: 'status', 'aria-live': 'polite' });
    function showThumb(v) {
      thumb.replaceChildren();
      const src = imageSrc(v);
      if (src) {
        const altText = parent && typeof parent.imageAlt === 'string' ? parent.imageAlt : '';
        const img = el('img', { src, alt: altText ? '預覽：' + altText : '圖片預覽' });
        img.addEventListener('error', () => { thumb.replaceChildren(document.createTextNode('無法載入圖片')); });
        thumb.appendChild(img);
      } else {
        thumb.appendChild(document.createTextNode(v ? '路徑格式不正確' : '尚未設定圖片'));
      }
    }
    showThumb(value);

    const pathInput = el('input', {
      id, type: 'text', value, dataset: { path: pathKey(path) }, autocomplete: 'off',
      'aria-describedby': id + '-h', placeholder: 'assets/… 或 https://…',
      oninput: (e) => { setAt(path, e.target.value.trim()); },
      onchange: (e) => showThumb(e.target.value.trim())
    });
    const fileId = nextId();
    const fileInput = el('input', { id: fileId, type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': '上傳' + labelOf(key) });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > MAX_UPLOAD_BYTES) { status.textContent = '檔案超過 3 MB 上限，請壓縮後再上傳'; fileInput.value = ''; return; }
      status.textContent = '上傳中…';
      const r = await api('POST', '/api/upload', { body: f, headers: { 'X-Filename': encodeURIComponent(f.name), 'Content-Type': f.type || 'application/octet-stream' } });
      fileInput.value = '';
      if (r.ok && r.data && r.data.path) {
        setAt(path, r.data.path);
        pathInput.value = r.data.path;
        showThumb(r.data.path);
        status.textContent = '已上傳：' + r.data.path + (parent && 'imageAlt' in parent ? '。請記得填寫替代文字與授權狀態。' : '');
      } else {
        status.textContent = '上傳失敗：' + errMsg(r);
      }
    });

    const controls = el('div', null, [
      el('div', { class: 'field' }, [
        el('label', { for: id }, ['圖片路徑', el('code', { text: key })]),
        pathInput,
        el('p', { class: 'help', id: id + '-h', text: '可上傳 JPEG／PNG／WebP（3 MB 以內，以檔案內容判斷格式），或填入 assets/ 相對路徑、https:// 網址；留空表示不使用圖片。' })
      ]),
      el('div', { class: 'btn-row' }, [
        el('span', { class: 'btn file-btn' }, ['上傳圖片', fileInput]),
        el('button', { type: 'button', class: 'btn btn-danger', onclick: () => { setAt(path, ''); pathInput.value = ''; showThumb(''); } }, '移除圖片')
      ]),
      status
    ]);
    fs.appendChild(el('div', { class: 'image-field' }, [thumb, controls]));

    if (key === 'image' && parent) {
      if ('imageAlt' in parent) {
        fs.appendChild(textField(parentPath.concat('imageAlt'), String(parent.imageAlt || ''), {
          required: true, help: '描述圖片內容，供螢幕報讀器與圖片無法顯示時使用；若為示意或往年影像請註明。'
        }));
      }
      if ('imageStatus' in parent) fs.appendChild(selectField(parentPath.concat('imageStatus'), parent.imageStatus, IMAGE_STATUS_OPTIONS));
    }
    return fs;
  }

  // --- 陣列 ---
  function blankLike(v, key) {
    if (Array.isArray(v)) return [];
    if (isObj(v)) {
      const o = {};
      for (const k of Object.keys(v)) {
        if (k === 'verify' || k === 'source') continue;
        o[k] = blankLike(v[k], k);
      }
      return o;
    }
    if (typeof v === 'number') return 0;
    if (typeof v === 'boolean') return false;
    if (typeof v === 'string') {
      if (key === 'status') return 'hidden';
      if (key === 'imageStatus') return 'none';
      if (key === 'type') return v;
      if (key === 'id') { const m = v.match(/^[a-z]+-/i); return (m ? m[0] : 'item-') + Math.random().toString(36).slice(2, 7); }
      return '';
    }
    return v;
  }
  function makeTemplate(path, arr) {
    const key = path[path.length - 1];
    if (key === 'ctas') return { type: 'phone', label: '電話訂購', tel: '', note: '' };
    if (arr.length) {
      const first = arr[0];
      if (Array.isArray(first)) return first.map(x => blankLike(x));
      return blankLike(first, isObj(first) ? undefined : key);
    }
    return '';
  }
  function cardTitle(item, i) {
    if (!isObj(item)) return '第 ' + (i + 1) + ' 項';
    const t = item.name || item.title || item.label || item.q || item.kicker || item.time || item.id;
    return (i + 1) + '. ' + (typeof t === 'string' && t ? t : '（未命名）');
  }
  function moveItem(path, i, d) {
    const arr = getAt(path);
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    // 調整展開狀態
    const a = pathKey(path.concat(i)), b = pathKey(path.concat(j));
    const ao = S.open.has(a), bo = S.open.has(b);
    S.open.delete(a); S.open.delete(b);
    if (ao) S.open.add(b);
    if (bo) S.open.add(a);
    rerender();
  }
  async function deleteItem(path, i) {
    const arr = getAt(path);
    if (isObj(arr[i]) || Array.isArray(arr[i])) {
      const c = await modal({ title: '刪除此項目？', body: '將刪除「' + cardTitle(arr[i], i) + '」。儲存草稿前仍可重新載入頁面放棄變更。', actions: [{ id: 'del', label: '刪除', primary: true, danger: true }, { id: 'cancel', label: '取消' }] });
      if (c !== 'del') return;
    }
    arr.splice(i, 1);
    rerender();
  }
  function itemTools(path, i, len, compact) {
    const n = i + 1;
    const cls = 'btn btn-small';
    return el('div', { class: compact ? 'row-tools' : 'card-tools' }, [
      el('button', { type: 'button', class: cls, disabled: i === 0 ? true : null, 'aria-label': '上移第 ' + n + ' 項', onclick: () => moveItem(path, i, -1) }, compact ? '↑' : '上移'),
      el('button', { type: 'button', class: cls, disabled: i === len - 1 ? true : null, 'aria-label': '下移第 ' + n + ' 項', onclick: () => moveItem(path, i, 1) }, compact ? '↓' : '下移'),
      el('button', { type: 'button', class: cls + ' btn-danger', 'aria-label': '刪除第 ' + n + ' 項', onclick: () => deleteItem(path, i) }, compact ? '✕' : '刪除')
    ]);
  }

  function arrayField(path, arr) {
    const wrap = el('div', { class: 'arr' });
    const key = path[path.length - 1];
    if (!arr.length) wrap.appendChild(el('p', { class: 'arr-empty', text: '（目前沒有項目）' }));
    arr.forEach((item, i) => {
      const p = path.concat(i);
      const pk = pathKey(p);
      if (isObj(item) || Array.isArray(item)) {
        const defaultOpen = arr.length <= 3 && !S.open.has('closed:' + pk);
        const det = el('details', { class: 'arr-card', 'data-path': pk, open: (S.open.has(pk) || defaultOpen) ? true : null });
        det.addEventListener('toggle', () => {
          if (det.open) { S.open.add(pk); S.open.delete('closed:' + pk); } else { S.open.delete(pk); S.open.add('closed:' + pk); }
        });
        const sum = el('summary', null, [cardTitle(item, i)]);
        if (isObj(item) && typeof item.status === 'string') {
          const lab = (STATUS_OPTIONS.find(o => o[0] === item.status) || [null, item.status])[1];
          sum.appendChild(el('span', { class: 'badge badge-status', text: lab }));
        }
        if (isObj(item) && (item.verify || (isObj(item.rooms) && item.rooms.verify))) sum.appendChild(el('span', { class: 'badge', text: '有待確認' }));
        det.appendChild(sum);
        const body = el('div', { class: 'card-body' });
        body.appendChild(itemTools(path, i, arr.length, false));
        body.appendChild(Array.isArray(item) ? arrayField(p, item) : renderValue(p, item, arr));
        det.appendChild(body);
        wrap.appendChild(det);
      } else {
        const id = nextId();
        const isNum = typeof item === 'number';
        const input = el('input', {
          id, type: isNum ? 'number' : 'text', step: isNum ? 'any' : null, value: item == null ? '' : String(item),
          dataset: { path: pk }, autocomplete: 'off',
          oninput: (e) => { const v = e.target.value; setAt(p, isNum ? (v === '' ? null : Number(v)) : v); }
        });
        wrap.appendChild(el('div', { class: 'field' }, [
          el('label', { for: id, class: 'field-label' }, labelOf(key) + ' ' + (i + 1)),
          el('div', { class: 'arr-row' }, [input, itemTools(path, i, arr.length, true)])
        ]));
      }
    });
    const addLabel = key === 'ctas' ? '新增 CTA 按鈕' : '新增' + (typeof key === 'string' ? labelOf(key) : '項目');
    wrap.appendChild(el('div', { class: 'add-row' }, el('button', {
      type: 'button', class: 'btn', onclick: () => {
        const tpl = makeTemplate(path, arr);
        arr.push(tpl);
        S.open.add(pathKey(path.concat(arr.length - 1)));
        rerender();
        const t = document.querySelector('#module [data-path="' + CSS.escape(pathKey(path.concat(arr.length - 1))) + '"]');
        if (t) { t.scrollIntoView({ block: 'center' }); const f = t.matches('input,select,textarea') ? t : t.querySelector('input,select,textarea'); if (f) f.focus(); }
      }
    }, '＋ ' + addLabel)));
    return wrap;
  }

  // --- 品牌 CIS ---
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(rgb) {
    const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrastRatio(a, b) {
    const ra = hexToRgb(a), rb = hexToRgb(b);
    if (!ra || !rb) return null;
    const la = luminance(ra), lb = luminance(rb);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function renderBrand() {
    const brand = S.draft.brand;
    const wrap = el('div');
    const palette = Array.isArray(brand.approvedPalette) ? brand.approvedPalette.filter(p => isObj(p) && typeof p.hex === 'string') : [];

    const tokFs = el('fieldset', { class: 'group', 'data-path': 'brand.tokens', tabindex: '-1' });
    tokFs.appendChild(el('legend', null, ['色彩代號（只能選核准色盤）', el('code', { text: 'tokens' })]));
    tokFs.appendChild(el('p', { class: 'help', text: '前台以 CSS 變數讀取這些色彩；伺服器會拒絕不在 approvedPalette 中的色碼。要新增顏色，須先經品牌核准並加入核准色盤。' }));
    const grid = el('div', { class: 'token-grid' });
    const contrastBox = el('div', { class: 'contrast-grid', 'aria-live': 'polite' });
    const tokens = isObj(brand.tokens) ? brand.tokens : {};
    for (const name of Object.keys(tokens)) {
      const id = nextId();
      const path = ['brand', 'tokens', name];
      const sw = el('span', { class: 'swatch', 'aria-hidden': 'true' });
      sw.style.background = tokens[name];
      const sel = el('select', { id, dataset: { path: pathKey(path) } });
      const cur = String(tokens[name] || '');
      const match = palette.find(p => p.hex.toUpperCase() === cur.toUpperCase());
      if (!match) sel.appendChild(el('option', { value: cur, text: '（不在核准色盤）' + cur }));
      for (const p of palette) sel.appendChild(el('option', { value: p.hex, text: (p.name || '') + ' ' + p.hex }));
      sel.value = match ? match.hex : cur;
      sel.addEventListener('change', () => {
        setAt(path, sel.value);
        sw.style.background = sel.value;
        renderContrast(contrastBox);
      });
      grid.appendChild(el('div', { class: 'field token-row' }, [sw, el('div', null, [
        el('label', { for: id }, [labelOf(name), el('code', { text: name })]), sel
      ])]));
    }
    tokFs.appendChild(grid);
    wrap.appendChild(tokFs);

    const cFs = el('fieldset', { class: 'group' });
    cFs.appendChild(el('legend', { text: '對比度檢查（WCAG 2.x，一般文字 AA 需 ≥ 4.5:1）' }));
    cFs.appendChild(contrastBox);
    renderContrast(contrastBox);
    wrap.appendChild(cFs);

    wrap.appendChild(objectField(['brand'], brand, { skip: ['tokens'] }));
    return wrap;
  }

  function renderContrast(box) {
    box.replaceChildren();
    const t = (S.draft.brand && S.draft.brand.tokens) || {};
    for (const [fg, bg, label] of CONTRAST_PAIRS) {
      const r = contrastRatio(t[fg], t[bg]);
      const sample = el('div', { class: 'contrast-sample', text: '團圓有席 Aa' });
      if (r !== null) { sample.style.color = t[fg]; sample.style.background = t[bg]; }
      const pass = r !== null && r >= 4.5;
      box.appendChild(el('div', { class: 'contrast-card' }, [
        sample,
        el('div', { class: 'contrast-meta' }, [
          el('span', null, [label, el('br'), el('code', { text: fg + ' / ' + bg })]),
          el('span', { class: pass ? 'pass' : 'fail', text: r === null ? '無法計算' : r.toFixed(2) + ':1 ' + (pass ? '通過' : '未通過') })
        ])
      ]));
    }
  }

  // --- 原始 JSON ---
  function renderRawJson(key) {
    const det = el('details', { class: 'raw-json' });
    const id = nextId();
    const ta = el('textarea', { id, spellcheck: 'false', autocomplete: 'off', 'aria-describedby': id + '-m' });
    const msg = el('p', { class: 'help', id: id + '-m', role: 'status' });
    det.appendChild(el('summary', { text: '原始 JSON（進階）：' + key }));
    det.addEventListener('toggle', () => { if (det.open) { ta.value = JSON.stringify(S.draft[key], null, 2); msg.textContent = '修改後按「套用」，會先驗證再寫入草稿（尚未儲存）。'; } });
    det.appendChild(el('label', { for: id, class: 'field-label', text: key + ' 的 JSON 內容' }));
    det.appendChild(ta);
    det.appendChild(msg);
    det.appendChild(el('div', { class: 'btn-row' }, [
      el('button', {
        type: 'button', class: 'btn btn-primary', onclick: () => {
          let val;
          try { val = JSON.parse(ta.value); } catch (e) { msg.textContent = 'JSON 格式錯誤：' + e.message; ta.setAttribute('aria-invalid', 'true'); return; }
          const cand = clone(S.draft);
          cand[key] = val;
          const errs = validateDoc(cand).filter(e => parsePath(e.path)[0] === key || e.path === '（根）');
          if (errs.length) {
            ta.setAttribute('aria-invalid', 'true');
            msg.textContent = '未套用，有 ' + errs.length + ' 項錯誤：' + errs.slice(0, 5).map(e => e.path + ' ' + e.message).join('；');
            return;
          }
          S.draft = cand;
          rerender();
          toast('已套用到草稿（尚未儲存）');
        }
      }, '套用'),
      el('button', { type: 'button', class: 'btn', onclick: () => { ta.value = JSON.stringify(S.draft[key], null, 2); ta.removeAttribute('aria-invalid'); msg.textContent = '已還原為目前草稿內容。'; } }, '重設')
    ]));
    return det;
  }

  // --- 版本紀錄 ---
  async function renderRevisions(root) {
    root.appendChild(el('div', { class: 'module-head' }, [el('h1', { text: '版本紀錄' })]));
    root.appendChild(el('p', { class: 'muted', text: '每次發布都會保存一份快照。「還原至草稿」只會把該版本放回草稿，不會直接上線；確認後需再次發布。' }));
    const box = el('div', { class: 'section-card' }, el('p', { text: '載入中…' }));
    root.appendChild(box);
    const r = await api('GET', '/api/revisions');
    box.replaceChildren();
    if (!r.ok) { box.appendChild(el('p', { class: 'error-text', text: errMsg(r) })); return; }
    const revs = r.data.revisions || [];
    if (!revs.length) { box.appendChild(el('p', { text: '尚無版本快照。' })); return; }
    const head = ['版本', '發布時間', '發布者', '狀態'].concat(S.role === 'publisher' ? ['動作'] : []);
    const tbody = el('tbody');
    for (const v of revs) {
      const cells = [
        el('td', { text: 'rev ' + v.revision }),
        el('td', { text: v.updatedAt || '—' }),
        el('td', { text: ROLE_LABELS[v.updatedBy] || v.updatedBy || '—' }),
        el('td', null, v.live ? el('span', { class: 'badge badge-live', text: '目前線上' }) : '')
      ];
      if (S.role === 'publisher') {
        cells.push(el('td', null, el('button', { type: 'button', class: 'btn btn-small', onclick: () => rollback(v.revision) }, '還原至草稿')));
      }
      tbody.appendChild(el('tr', null, cells));
    }
    box.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
      el('caption', { class: 'muted', text: '共 ' + revs.length + ' 個版本（新到舊）' }),
      el('thead', null, el('tr', null, head.map(h => el('th', { scope: 'col', text: h })))), tbody
    ])));
  }

  async function rollback(rev) {
    const body = ['將 rev ' + rev + ' 的內容還原到草稿。目前草稿中尚未發布的內容會被取代；線上網站不會改變，需再次發布才會上線。'];
    if (isDirty()) body.push('注意：你有尚未儲存的變更，還原後將會遺失。');
    const c = await modal({ title: '還原 rev ' + rev + ' 至草稿？', body, actions: [{ id: 'ok', label: '還原至草稿', primary: true, danger: true }, { id: 'cancel', label: '取消' }] });
    if (c !== 'ok') return;
    const r = await api('POST', '/api/rollback', { body: { revision: rev } });
    if (!r.ok) { toast('還原失敗：' + errMsg(r), 'error'); return; }
    await loadDraft();
    S.errors = validateDoc(S.draft);
    renderErrorPanel();
    updateSaveState();
    reloadPreview();
    toast('已將 rev ' + rev + ' 還原至草稿，請預覽確認後再發布');
    renderModule();
  }

  // --- 操作紀錄 ---
  async function renderAudit(root) {
    root.appendChild(el('div', { class: 'module-head' }, [el('h1', { text: '操作紀錄' })]));
    const box = el('div', { class: 'section-card' }, el('p', { text: '載入中…' }));
    root.appendChild(box);
    const r = await api('GET', '/api/audit');
    box.replaceChildren();
    if (!r.ok) { box.appendChild(el('p', { class: 'error-text', text: errMsg(r) })); return; }
    const entries = r.data.entries || [];
    if (!entries.length) { box.appendChild(el('p', { text: '尚無紀錄。' })); return; }
    const tbody = el('tbody');
    for (const e of entries) {
      tbody.appendChild(el('tr', null, [
        el('td', { text: e.ts || '' }),
        el('td', { text: ROLE_LABELS[e.role] || e.role || '' }),
        el('td', { text: AUDIT_LABELS[e.action] || e.action || e.raw || '' }),
        el('td', { text: e.revision == null ? '' : 'rev ' + e.revision }),
        el('td', { text: e.detail || '' })
      ]));
    }
    box.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
      el('caption', { class: 'muted', text: '最近 ' + entries.length + ' 筆（新到舊）' }),
      el('thead', null, el('tr', null, ['時間', '角色', '動作', '版本', '說明'].map(h => el('th', { scope: 'col', text: h })))), tbody
    ])));
  }

  // ------------------------------------------------------------------
  // 儲存 / 預覽 / 發布
  // ------------------------------------------------------------------
  function downloadJSON(obj, name) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function handleConflict(data) {
    const who = data && data.updatedBy ? (ROLE_LABELS[data.updatedBy] || data.updatedBy) : '其他人';
    const when = data && data.updatedAt ? data.updatedAt : '剛才';
    const c = await modal({
      title: '草稿已被其他人更新',
      body: ['在你編輯期間，' + who + ' 於 ' + when + ' 儲存了新的草稿。為避免互相覆蓋，這次儲存沒有寫入。',
        '你可以先下載自己的版本備份，再重新載入最新草稿後重新修改。'],
      actions: [{ id: 'reload', label: '重新載入最新草稿', primary: true }, { id: 'download', label: '下載我的版本' }, { id: 'cancel', label: '取消' }]
    });
    if (c === 'download') { downloadJSON(S.draft, 'my-draft-' + Date.now() + '.json'); return handleConflict(data); }
    if (c === 'reload') {
      await loadDraft();
      S.errors = validateDoc(S.draft);
      renderErrorPanel(); renderModule(); updateSaveState();
      toast('已載入最新草稿');
    }
  }

  let busy = false;
  async function saveDraft() {
    if (busy) return false;
    S.errors = validateDoc(S.draft);
    renderErrorPanel(true);
    applyErrorMarks();
    if (S.errors.length) {
      toast('尚有 ' + S.errors.length + ' 項欄位需要修正，請依錯誤清單修正後再儲存', 'error');
      $('#error-panel').scrollIntoView({ block: 'start' });
      return false;
    }
    busy = true;
    $('#btn-save').disabled = true;
    try {
      const r = await api('PUT', '/api/draft', { body: S.draft, headers: { 'If-Match': S.etag || '' } });
      if (r.status === 200 && r.data) {
        S.etag = r.data.etag;
        S.draft.meta = Object.assign(S.draft.meta || {}, r.data.meta);
        S.savedJSON = JSON.stringify(S.draft);
        updateSaveState();
        if (S.module === 'meta') renderModule();
        reloadPreview();
        toast('草稿已儲存');
        return true;
      }
      if (r.status === 409) { await handleConflict(r.data); return false; }
      if (r.status === 422 && r.data && r.data.errors) {
        S.errors = r.data.errors;
        renderErrorPanel(true); applyErrorMarks();
        toast('伺服器驗證未通過：' + r.data.errors.length + ' 項', 'error');
        return false;
      }
      toast('儲存失敗：' + errMsg(r), 'error');
      return false;
    } finally {
      busy = false;
      $('#btn-save').disabled = false;
    }
  }

  const PREVIEW_URL = '../index.html?stage=draft';
  function reloadPreview() {
    if (!S.previewOpen) return;
    $('#preview-frame').src = PREVIEW_URL + '&t=' + Date.now();
  }
  function setPreview(open) {
    S.previewOpen = open;
    $('#preview').hidden = !open;
    $('#layout').classList.toggle('with-preview', open);
    $('#btn-preview').setAttribute('aria-pressed', open ? 'true' : 'false');
    if (open) reloadPreview(); else $('#preview-frame').src = 'about:blank';
  }
  function preview() {
    if (isDirty()) toast('預覽顯示的是「已儲存」的草稿；未儲存的變更請先按「儲存草稿」');
    if (window.matchMedia('(min-width: 1100px)').matches) {
      setPreview(!S.previewOpen);
    } else {
      // 不加 noopener：新分頁需沿用 sessionStorage 中的金鑰才能讀取草稿
      window.open(PREVIEW_URL, '_blank');
    }
  }

  const IGNORE_DIFF = new Set(['meta.revision', 'meta.updatedAt', 'meta.updatedBy']);
  function diffPaths(a, b, path, out) {
    const k = pathKey(path);
    if (IGNORE_DIFF.has(k)) return out;
    const bothObj = (isObj(a) && isObj(b)) || (Array.isArray(a) && Array.isArray(b));
    if (bothObj) {
      const keys = Array.isArray(a) ? [...Array(Math.max(a.length, b.length)).keys()] : [...new Set(Object.keys(a).concat(Object.keys(b)))];
      for (const kk of keys) diffPaths(a[kk], b[kk], path.concat(kk), out);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push(path);
    }
    return out;
  }

  async function publish() {
    if (S.role !== 'publisher') return;
    if (isDirty()) {
      const c = await modal({ title: '有未儲存的變更', body: '發布的是伺服器上「已儲存」的草稿。要先儲存目前的變更再發布嗎？', actions: [{ id: 'save', label: '儲存並繼續', primary: true }, { id: 'cancel', label: '取消' }] });
      if (c !== 'save') return;
      if (!(await saveDraft())) return;
    }
    const errs = validateDoc(S.draft);
    if (errs.length) { S.errors = errs; renderErrorPanel(true); applyErrorMarks(); toast('草稿仍有錯誤，無法發布', 'error'); return; }
    await loadPublished();
    const diffs = S.published ? diffPaths(S.published, S.draft, [], []) : [];
    const byModule = {};
    for (const p of diffs) { const m = MODULES.find(x => x.id === moduleForKey(p[0])); const l = m ? m.label : p[0]; byModule[l] = (byModule[l] || 0) + 1; }
    const list = Object.keys(byModule).map(l => l + '：' + byModule[l] + ' 處')
      .concat(diffs.slice(0, 12).map(p => '・' + fmtPath(p)));
    if (diffs.length > 12) list.push('…另有 ' + (diffs.length - 12) + ' 處');
    const c = await modal({
      title: '確認發布到正式網站？',
      body: diffs.length
        ? '與目前線上版本（rev ' + (S.published && S.published.meta ? S.published.meta.revision : '?') + '）相比，共 ' + diffs.length + ' 處變更：'
        : '草稿內容與目前線上版本相同（不含系統欄位）。仍要發布嗎？',
      list,
      actions: [{ id: 'ok', label: '確認發布', primary: true, danger: true }, { id: 'cancel', label: '取消' }]
    });
    if (c !== 'ok') return;
    const r = await api('POST', '/api/publish', { headers: { 'If-Match': S.etag || '' } });
    if (r.ok) {
      await loadPublished();
      updateSaveState();
      toast('已發布 rev ' + r.data.revision + (r.data.note ? '。' + r.data.note : ''));
      if (S.module === 'revisions') renderModule();
      return;
    }
    if (r.status === 409) { await handleConflict(r.data); return; }
    if (r.status === 422 && r.data && r.data.errors) { S.errors = r.data.errors; renderErrorPanel(true); applyErrorMarks(); }
    toast('發布失敗：' + errMsg(r), 'error');
  }

  // ------------------------------------------------------------------
  // 登入 / 初始化
  // ------------------------------------------------------------------
  function showLogin(message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-error').textContent = message || '';
    sessionStorage.removeItem('cmsToken');
    S.token = null;
    $('#login-token').focus();
  }

  async function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#role-badge').textContent = ROLE_LABELS[S.role] || S.role;
    $('#btn-publish').hidden = S.role !== 'publisher';
    renderNav();
    S.errors = validateDoc(S.draft);
    renderErrorPanel();
    renderModule();
    updateSaveState();
  }

  async function tryLogin(token, silent) {
    S.token = token;
    const r = await api('GET', '/api/whoami');
    if (!r.ok || !r.data || !r.data.role) {
      S.role = null;
      showLogin(silent ? '' : (r.status === 401 ? '金鑰不正確，請再確認一次' : errMsg(r)));
      return;
    }
    S.role = r.data.role;
    sessionStorage.setItem('cmsToken', token);
    try {
      await Promise.all([loadDraft(), loadPublished()]);
    } catch (e) {
      showLogin(e.message);
      return;
    }
    showApp();
  }

  function init() {
    $('#login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = $('#login-token').value.trim();
      if (!t) { $('#login-error').textContent = '請輸入後台金鑰'; return; }
      $('#login-token').value = '';
      tryLogin(t, false);
    });
    $('#module-select').addEventListener('change', (e) => switchModule(e.target.value));
    $('#btn-save').addEventListener('click', saveDraft);
    $('#btn-preview').addEventListener('click', preview);
    $('#btn-preview-reload').addEventListener('click', reloadPreview);
    $('#btn-preview-close').addEventListener('click', () => setPreview(false));
    $('#btn-publish').addEventListener('click', publish);
    $('#btn-logout').addEventListener('click', async () => {
      if (isDirty()) {
        const c = await modal({ title: '登出？', body: '你有尚未儲存的變更，登出後將會遺失。', actions: [{ id: 'ok', label: '仍要登出', primary: true, danger: true }, { id: 'cancel', label: '取消' }] });
        if (c !== 'ok') return;
      }
      S.savedJSON = JSON.stringify(S.draft);
      sessionStorage.removeItem('cmsToken');
      location.reload();
    });
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && S.role) { e.preventDefault(); saveDraft(); }
    });
    window.addEventListener('beforeunload', (e) => {
      if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });

    if (window.CMS_BACKEND && window.CMS_BACKEND.loginHelp) {
      $('#login-help').textContent = window.CMS_BACKEND.loginHelp;
      document.querySelector('label[for=login-token]').textContent = 'GitHub 存取金鑰';
    }
    const saved = sessionStorage.getItem('cmsToken');
    if (saved) tryLogin(saved, true);
    else showLogin('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
