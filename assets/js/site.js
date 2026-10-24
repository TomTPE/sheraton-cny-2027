/* 台北喜來登 2027 新春餐飲 — 前台
 * 全部內容由 data/content.json（CMS 發布版）渲染；?stage=draft 讀取 CMS 草稿（需登入權杖）。
 * ?review 顯示所有 verify 校稿備註。
 */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);
  var REVIEW = Q.has('review');
  var DRAFT = Q.get('stage') === 'draft';
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var D; // content
  var VERIFY = [];

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nt(n) { return Number(n).toLocaleString('en-US'); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function ss(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function visible(it) { return it && it.status !== 'hidden'; }
  function verify(text, where) {
    if (!text) return '';
    VERIFY.push((where ? where + '：' : '') + text);
    return '<p class="verify">待確認：' + esc(text) + '</p>';
  }
  function icon(id) { return '<svg class="ico" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }
  function head(id, title, lead, extra) {
    return '<header class="head' + (extra ? ' head--split' : '') + '" data-reveal><div>' +
      '<h2 id="' + id + '-title">' + esc(title) + '</h2>' + (lead ? '<p>' + esc(lead) + '</p>' : '') +
      '<div class="head__rule" aria-hidden="true"><i></i></div></div>' + (extra || '') + '</header>';
  }
  function telDisplay(tel) { return tel.replace(/^\+886(\d)(\d{4})(\d{4})$/, '0$1-$2-$3'); }

  /* ---------- CTA：電話／線上訂位／線上購買／洽詢／連結／頁內 ---------- */
  function cta(c, style) {
    var t = (D.ctaTypes && D.ctaTypes[c.type]) || {};
    var label = c.label || t.label || '了解更多';
    var cls = 'btn btn--' + (style || 'gold');
    var ic = t.icon || 'arrow';
    var note = c.note ? '<span class="cta-note">' + esc(c.note) + '</span>' : '';
    if (c.type === 'phone' || c.type === 'inquiry') {
      return '<span class="cta"><a class="' + cls + '" href="tel:' + esc(c.tel) + '" data-track="tel" aria-label="' + esc(label + '，撥打 ' + telDisplay(c.tel) + (c.note ? '，' + c.note : '')) + '">' + icon('phone') + esc(label) + '</a></span>';
    }
    if (c.type === 'anchor') {
      var pre = c.preset ? ' data-preset="' + esc(JSON.stringify(c.preset)) + '"' : '';
      return '<span class="cta"><a class="' + cls + '" href="#' + esc(c.target) + '"' + pre + '>' + esc(label) + icon('arrow') + '</a></span>';
    }
    return '<span class="cta"><a class="' + cls + '" href="' + esc(c.url) + '" target="_blank" rel="noopener" data-track="' + esc(c.type) + '" aria-label="' + esc(label + '（另開新視窗）') + '">' + icon(ic) + esc(label) + '</a>' + note + '</span>';
  }
  function ctas(list, dark, soldout) {
    if (soldout) return '<div class="ctas"><span class="btn btn--line" aria-disabled="true">已售完</span></div>';
    if (!list || !list.length) return '';
    return '<div class="ctas">' + list.map(function (c, i) { return cta(c, i === 0 ? 'gold' : (dark ? 'line-light' : 'line')); }).join('') + '</div>';
  }
  function photo(src, alt, status, frame) {
    if (!src) return '<div class="photo photo--empty"><span>影像準備中</span></div>';
    var tag = status === 'placeholder' || status === 'reference' ? '<span class="ph-tag">示意圖</span>' : '';
    return '<div class="photo' + (frame ? ' photo--frame' : '') + '"><img src="' + esc(src) + '" alt="' + esc(alt || '') + '" loading="lazy" decoding="async">' + tag + '</div>';
  }

  /* ---------- 套用 CIS tokens（與資料庫一致） ---------- */
  function applyBrand() {
    var tk = D.brand && D.brand.tokens || {};
    var root = document.documentElement.style;
    Object.keys(tk).forEach(function (k) { root.setProperty('--' + k, tk[k]); });
    if (D.meta) {
      document.title = D.meta.title || document.title;
      var m = $('meta[name=robots]'); if (m) m.content = D.meta.noindex ? 'noindex, nofollow' : 'index, follow';
      var desc = $('meta[name=description]'); if (desc && D.meta.description) desc.content = D.meta.description;
    }
    var logo = $('[data-logo]'); if (logo && D.brand.logo) logo.src = D.brand.logo.onDark;
    var main = D.contacts.main;
    $$('[data-main-tel]').forEach(function (a) { a.href = 'tel:' + main.tel; a.setAttribute('aria-label', main.label + ' ' + main.display); });
  }

  /* ---------- 導覽 ---------- */
  function renderNav() {
    $('[data-nav]').innerHTML = D.nav.map(function (n) { return '<a href="#' + esc(n.id) + '">' + esc(n.label) + '</a>'; }).join('');
  }

  /* ---------- HERO ---------- */
  var slideshow = { list: [], idx: 0, timer: 0, paused: false, userPaused: false, visible: true };
  function loadArtFont(text) {
    var fam = (D.brand.fonts && D.brand.fonts.art) || 'LXGW WenKai TC';
    var l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(fam).replace(/%20/g, '+') + ':wght@400&display=swap&text=' + encodeURIComponent(text);
    document.head.appendChild(l);
  }
  function renderHero() {
    var h = D.hero;
    $('[data-hero-eyebrow]').textContent = h.eyebrow;
    // 主標逐字遮罩揭示
    var n = 0;
    $('[data-hero-title]').innerHTML = h.title.map(function (t) {
      return '<span class="hero__word">' + Array.from(t).map(function (c) { return '<span class="ch"><span style="--i:' + (n++) + '">' + esc(c) + '</span></span>'; }).join('') + '</span>';
    }).join('');
    $('[data-hero-title]').setAttribute('aria-label', h.title.join(''));
    loadArtFont(h.title.join(''));
    $('[data-hero-lead]').textContent = h.lead;
    var list = (h.slides || []).filter(visible);
    slideshow.list = list;
    $('[data-track]').innerHTML = list.map(function (sl, i) {
      return '<img class="slide" src="' + esc(sl.image) + '" alt="' + esc(sl.imageAlt || '') + '" width="1400" height="934"' + (i ? ' loading="lazy"' : '') + ' decoding="async" data-slide="' + i + '">';
    }).join('');
    $('[data-segs]').innerHTML = list.map(function (sl, i) {
      return '<button type="button" class="seg" data-seg="' + i + '" aria-label="' + esc('顯示' + sl.venue + '影像') + '"><i></i></button>';
    }).join('');
    $('[data-slidebar]').hidden = list.length < 2;
    $('[data-scenes]').innerHTML = h.scenes.map(function (s, i) {
      return '<div class="scene" data-scene="' + i + '"><p class="scene__kicker">' + esc(s.kicker) + '</p><h2>' + esc(s.title) + '</h2><p>' + esc(s.text) + '</p>' +
        '<a class="btn btn--gold" href="#' + esc(s.target) + '" tabindex="-1">' + esc('前往' + s.kicker) + icon('arrow') + '</a></div>';
    }).join('');
    $('[data-dots]').innerHTML = h.scenes.map(function () { return '<li></li>'; }).join('');
  }

  /* ---------- 餐廳輪播：每次開啟隨機起始、自動輪播、可暫停 ---------- */
  function startSlideshow() {
    var S = slideshow, cfg = D.hero.slideshow || {}, n = S.list.length;
    if (!n) return;
    var dur = Math.max(3, Number(cfg.intervalSec) || 6) * 1000;
    $('[data-hero]').style.setProperty('--slide-dur', dur + 'ms');
    var last = -1; try { last = Number(localStorage.getItem('heroSlide')); } catch (e) { /* 無痕模式 */ }
    if (cfg.randomStart !== false && n > 1) { do { S.idx = Math.floor(Math.random() * n); } while (S.idx === last); }
    try { localStorage.setItem('heroSlide', String(S.idx)); } catch (e) { /* ignore */ }
    var imgs = $$('[data-slide]'), segs = $$('[data-seg]'), venue = $('[data-venue]'), pause = $('[data-pause]');
    var hero = $('[data-hero]');
    function show(i) {
      S.idx = (i + n) % n;
      imgs.forEach(function (im, k) { var on = k === S.idx; im.classList.toggle('is-on', on); if (on) { im.loading = 'eager'; im.style.animation = 'none'; void im.offsetWidth; im.style.animation = ''; } });
      segs.forEach(function (b, k) { b.classList.toggle('is-done', k < S.idx); b.classList.remove('is-on'); if (k === S.idx) { void b.offsetWidth; b.classList.add('is-on'); } b.setAttribute('aria-current', k === S.idx ? 'true' : 'false'); });
      var sl = S.list[S.idx];
      venue.innerHTML = '<b>' + esc(sl.venue) + '</b><span>' + esc(sl.label) + '</span>';
      var nx = imgs[(S.idx + 1) % n]; if (nx) nx.loading = 'eager';
      schedule();
    }
    function running() { return cfg.autoplay !== false && !REDUCED && !S.userPaused && S.visible && !document.hidden; }
    function schedule() {
      clearTimeout(S.timer);
      hero.classList.toggle('is-paused', !running());
      if (running()) S.timer = setTimeout(function () { show(S.idx + 1); }, dur);
    }
    $('[data-segs]').addEventListener('click', function (e) { var b = e.target.closest('[data-seg]'); if (b) show(Number(b.dataset.seg)); });
    pause.addEventListener('click', function () {
      S.userPaused = !S.userPaused;
      pause.setAttribute('aria-pressed', String(S.userPaused));
      pause.setAttribute('aria-label', S.userPaused ? '繼續輪播' : '暫停輪播');
      show(S.idx);
    });
    document.addEventListener('visibilitychange', schedule);
    S.reschedule = function (vis) { if (vis !== S.visible) { S.visible = vis; if (vis) show(S.idx); else schedule(); } };
    if (REDUCED || cfg.autoplay === false) pause.hidden = true;
    show(S.idx);
  }

  /* ---------- 四大需求入口 ---------- */
  // 價格提示由各區塊資料自動計算，確保入口與內容一致
  function pathHint(it) {
    if (it.hint) return it.hint;
    if (it.status === 'soldout') return '已售完';
    var t = it.ctas && it.ctas[0] && it.ctas[0].target, min;
    if (t === 'takeaway') {
      var f = D.takeaway.items.filter(function (i) { return visible(i) && i.status === 'onsale' && i.price; });
      if (f.length) { min = Math.min.apply(null, f.map(function (i) { return i.price; })); return '預購中　NT$' + nt(min) + ' 起'; }
    }
    if (t === 'dining') {
      var a = [];
      D.dining.offers.filter(visible).forEach(function (o) { (o.slots || []).forEach(function (s) { a.push(s.adult); }); });
      if (a.length) return 'NT$' + nt(Math.min.apply(null, a)) + ' 起＋10%';
    }
    if (t === 'gifts') {
      var g = D.gifts.items.filter(function (i) { return visible(i) && i.status === 'onsale' && i.price; });
      if (g.length) return '線上購買　NT$' + nt(Math.min.apply(null, g.map(function (i) { return i.price; }))) + ' 起';
    }
    return '';
  }
  function renderPaths() {
    var P = D.paths, sec = $('[data-section=paths]');
    if (!P || !P.items) { sec.hidden = true; return; }
    // 照片磚＋春聯式直排標題；桌機滑過展開，手機 2×2 直接點選
    sec.innerHTML = '<div class="wrap"><header class="paths__head" data-reveal><h2 id="paths-title">' + esc(P.title) + '</h2>' + (P.lead ? '<p>' + esc(P.lead) + '</p>' : '') + '</header>' +
      '<div class="paths" data-paths>' + P.items.filter(visible).map(function (it, i) {
        var c = (it.ctas && it.ctas[0]) || {}, sold = it.status === 'soldout';
        var pre = c.preset ? ' data-preset="' + esc(JSON.stringify(c.preset)) + '"' : '';
        var hint = pathHint(it);
        return '<a class="door' + (sold ? ' door--sold' : '') + (i === 0 ? ' is-open' : '') + '" href="#' + esc(c.target) + '"' + pre + ' data-reveal style="--d:' + (i * .08) + 's"' +
          ' aria-label="' + esc(it.need + '，' + it.title + '，' + (hint ? hint + '，' : '') + (c.label || '')) + '">' +
          '<span class="door__media">' + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy" decoding="async">' : '') + '</span>' +
          '<span class="door__num" aria-hidden="true">' + esc(it.order || '') + '</span>' +
          '<span class="door__couplet" aria-hidden="true">' + esc(it.couplet || it.title) + '</span>' +
          (sold ? '<span class="door__stamp" aria-hidden="true">售完</span>' : '') +
          '<span class="door__body"><span class="door__need">' + esc(it.need) + '</span><strong class="door__title">' + esc(it.title) + '</strong>' +
          '<span class="door__desc">' + esc(it.desc) + '</span>' +
          (hint ? '<span class="door__hint">' + esc(hint) + '</span>' : '') +
          '<span class="door__go">' + esc(c.label || '前往') + icon('arrow') + '</span></span></a>';
      }).join('') + '</div><p class="paths__note">影像為往年料理示意</p></div>';
    var wrap = $('[data-paths]', sec);
    function open(el) { $$('.door', wrap).forEach(function (d) { d.classList.toggle('is-open', d === el); }); }
    wrap.addEventListener('pointerenter', function (e) { var d = e.target.closest && e.target.closest('.door'); if (d && e.pointerType === 'mouse') open(d); }, true);
    wrap.addEventListener('focusin', function (e) { var d = e.target.closest('.door'); if (d) open(d); });
  }

  /* ---------- 外帶年菜 ---------- */
  var tkCat = 'all';
  function itemCard(it, kind) {
    var sold = it.status === 'soldout';
    var status = it.status === 'onsale'
      ? '<p class="card__price">NT$' + nt(it.price) + (it.originalPrice ? '<s>原價 ' + nt(it.originalPrice) + '</s>' : '') + '</p>' + (it.priceNote ? '<p class="card__meta">' + esc(it.priceNote) + '</p>' : '')
      : '<span class="card__status' + (sold ? ' card__status--sold' : '') + '">' + (sold ? '已售完' : '2027 售價公布中') + '</span>';
    var sub = kind === 'gift' ? esc(it.spec) : esc(it.serve);
    return '<article class="card" data-reveal>' +
      '<button type="button" class="card__media" data-detail="' + esc(kind + ':' + it.id) + '" aria-label="' + esc('查看' + it.name + '詳情') + '">' +
      photo(it.image, it.imageAlt || it.name, it.imageStatus, false) + '</button>' +
      '<div class="card__body"><p class="card__venue">' + esc(it.venue) + (it.tag ? '<span>' + esc(it.tag) + '</span>' : '') + '</p>' +
      '<h3>' + esc(it.name) + '</h3><p class="card__meta">' + sub + '</p>' + status +
      (it.pickup ? '<p class="card__meta">' + esc(it.pickup) + '</p>' : '') +
      verify(it.verify, it.name) + ctas(it.ctas, false, sold) + '</div></article>';
  }
  function renderTakeaway() {
    var t = D.takeaway, items = t.items.filter(visible);
    var rest = items;
    var ctrl = '<div class="rail-ctrl" data-rail-ctrl="tk"><button class="rail-btn" data-dir="-1" aria-label="上一個">' + icon('arrow') + '</button><button class="rail-btn rail-pause" type="button" data-rail-pause aria-pressed="false" aria-label="暫停自動輪播"><span></span></button><button class="rail-btn" data-dir="1" aria-label="下一個">' + icon('arrow') + '</button></div>';
    var html = head('takeaway', t.title, t.lead);
    html += '<div class="sub-head sub-head--row" data-reveal><div><h3>年菜品項</h3><p>宴會廳冷凍年菜已開放預購，各餐廳品項陸續公布。</p></div>' + ctrl + '</div>';
    html += '<div class="filters" role="group" aria-label="年菜類型" data-tk-filter>' + t.categories.map(function (c) {
      return '<button type="button" aria-pressed="' + (c.id === tkCat) + '" data-cat="' + esc(c.id) + '">' + esc(c.label) + '</button>';
    }).join('') + '</div><div class="rail" data-rail="tk" data-tk-list></div>';
    var sec = $('[data-section=takeaway]');
    sec.innerHTML = '<div class="wrap">' + html + '</div>';
    function list() {
      var shown = rest.filter(function (i) { return tkCat === 'all' || i.category === tkCat; });
      var railEl = $('[data-tk-list]', sec); railEl.dispatchEvent(new Event('rail:reset'));
      railEl.innerHTML = shown.length ? shown.map(function (i) { return itemCard(i, 'tk'); }).join('') : '<p class="empty">此類別品項即將公布。</p>';
      observeReveal(sec);
    }
    $('[data-tk-filter]', sec).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      tkCat = b.dataset.cat;
      $$('button', this).forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      list();
    });
    list();
  }

  /* ---------- 各餐廳除夕菜單：圖像化超連結 ---------- */
  function menusHtml(M) {
    if (!M || !M.items) return '';
    return '<div class="menus" data-reveal><div class="sub-head"><h3>' + esc(M.title) + '</h3>' + (M.lead ? '<p>' + esc(M.lead) + '</p>' : '') + '</div>' + verify(M.verify, M.title) +
        '<ul class="menu-grid">' + M.items.filter(visible).map(function (m) {
          var c = (m.ctas && m.ctas[0]) || {}, ext = c.type === 'link' || c.type === 'booking' || c.type === 'buy';
          var href = c.type === 'anchor' ? '#' + c.target : (c.url || '#');
          var pre = c.preset ? ' data-preset="' + esc(JSON.stringify(c.preset)) + '"' : '';
          var st = m.status === 'soldout' ? ' is-sold' : (m.status === 'confirmed' ? ' is-open' : '');
          var media = m.image ? '<img src="' + esc(m.image) + '" alt="" loading="lazy" decoding="async">' : '';
          return '<li><a class="menu-tile' + st + '" href="' + esc(href) + '"' + pre + (ext ? ' target="_blank" rel="noopener"' : '') +
            ' aria-label="' + esc(m.venue + '，' + m.note + '，' + (c.label || '') + (ext ? '（另開新視窗）' : '')) + '">' +
            '<span class="menu-tile__media">' + media + (m.imageStatus === 'reference' || m.imageStatus === 'placeholder' ? '<span class="ph-tag">示意圖</span>' : '') + '</span>' +
            '<span class="menu-tile__body"><span class="menu-tile__label">' + esc(m.label) + '</span><strong>' + esc(m.venue) + '</strong>' +
            '<span class="menu-tile__note">' + esc(m.note) + '</span><span class="menu-tile__go">' + esc(c.label || '查看') + icon('arrow') + '</span></span></a></li>';
        }).join('') + '</ul></div>';
  }

  /* ---------- 餐廳內用：十二廚價目表＋大廳酒吧補充 ---------- */
  function renderDining() {
    var d = D.dining;
    var R = {}; d.restaurants.forEach(function (r) { R[r.id] = r; });
    var DT = {}; d.dates.forEach(function (x) { DT[x.id] = x; });
    var ML = {}; d.meals.forEach(function (x, i) { ML[x.id] = { label: x.label, order: i }; });
    var sec = $('[data-section=dining]'), rooms = d.rooms;
    var k12 = R.kitchen12, lounge = R.lounge;

    // 十二廚：日曆頁日期列＋當日時間軸（資訊圖像化）
    var kOffers = d.offers.filter(function (o) { return visible(o) && o.restaurant === 'kitchen12'; });
    var kDates = d.dates.filter(function (x) { return kOffers.some(function (o) { return o.dates.indexOf(x.id) > -1; }); });
    function dayOffers(id) { return kOffers.filter(function (o) { return o.dates.indexOf(id) > -1; }).sort(function (a, b) { return ML[a.meal].order - ML[b.meal].order; }); }
    function minutes(t) { var m = /(\d{1,2}):(\d{2})/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
    function span(t) { var m = /(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/.exec(t); return m ? [minutes(m[1]), minutes(m[2])] : [0, 0]; }
    function dinnerPrice(id) { var o = dayOffers(id).filter(function (x) { return x.meal === 'dinner'; })[0]; return o && o.slots ? o.slots[0].adult : 0; }
    function fromPrice(id) { var a = []; dayOffers(id).forEach(function (o) { (o.slots || []).forEach(function (sl) { a.push(sl.adult); }); }); return a.length ? Math.min.apply(null, a) : 0; }
    var maxDinner = Math.max.apply(null, kDates.map(function (x) { return dinnerPrice(x.id); }).concat([1]));
    var AX0 = 11 * 60, AX1 = 22 * 60;
    var axis = []; for (var hh = 11; hh <= 21; hh += 2) axis.push('<span style="--s:' + ((hh * 60 - AX0) / (AX1 - AX0)).toFixed(4) + '">' + hh + ':00</span>');
    var kState = { date: d.defaultDate || (kDates[0] && kDates[0].id), meal: '' };
    // 大廳酒吧：只留一行補充（除夕晚餐固定價，其餘單點）
    var lgEve = d.offers.filter(function (o) { return visible(o) && o.restaurant === 'lounge' && o.slots; })[0];
    var loungeLine = lgEve ? '除夕晚餐兩場次 成人 NT$' + nt(lgEve.slots[0].adult) + '／兒童 NT$' + nt(lgEve.slots[0].child) + '，須預付全額，' + (lgEve.bookingNote || '') + '；其他時段為制式單點菜單。' : '除夕及春節期間為制式單點菜單。';

    sec.innerHTML = '<div class="wrap">' + head('dining', d.title, d.lead) + menusHtml(d.menus) +
      '<div class="sub-head sub-head--row" data-reveal><div><h3>' + esc(d.finderTitle || '十二廚 除夕・春節餐價') + '</h3><p>' + esc(k12.type + (kDates.length ? '｜' + kDates[0].lunar + '至' + kDates[kDates.length - 1].lunar : '') + '｜價格另加 10% 服務費') + '</p></div></div>' +
      '<div class="daybook" id="finder" data-reveal>' +
      '<div class="cal" role="radiogroup" aria-label="選擇日期" data-cal></div>' +
      '<div class="dayview" aria-live="polite" data-dayview></div>' +
      '<div class="daybook__foot"><p>除夕及春節期間僅受理電話訂位。</p>' +
      ctas([{ type: 'phone', label: '電話訂位　十二廚', tel: k12.tel }, { type: 'link', label: '餐廳介紹', url: k12.page }]) + '</div>' + verify(d.verify, '餐廳內用') + '</div>' +
      (d.showLounge && lounge ? '<div class="lounge-line" data-reveal><div><b>' + esc(lounge.name) + '</b><p>' + esc(loungeLine) + '</p></div>' +
      ctas([{ type: 'booking', label: '線上訂位', url: lounge.booking.url }, { type: 'phone', label: '電話', tel: lounge.tel }]) + '</div>' : '') +
      '<details class="fold" data-reveal><summary>' + esc(rooms.title) + '</summary><div class="fold__body"><table class="tbl"><thead><tr>' +
      rooms.columns.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rooms.rows.map(function (r) { return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td><td>' + nt(r[2]) + '</td><td>' + nt(r[3]) + '</td></tr>'; }).join('') +
      '</tbody></table><p class="card__meta" style="margin-top:10px">金額單位新台幣，含服務費依 MEMO 規定。包廂需求請電話洽詢。</p>' + verify(rooms.verify, '包廂低消') + '</div></details></div>';

    function drawCal() {
      $('[data-cal]', sec).innerHTML = kDates.map(function (x) {
        var on = x.id === kState.date, dp = dinnerPrice(x.id);
        return '<button type="button" class="cal__day" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-id="' + esc(x.id) + '" aria-label="' + esc(x.lunar + ' ' + x.md + '，自助餐 NT$' + nt(fromPrice(x.id)) + ' 起') + '">' +
          '<b class="cal__lunar">' + esc(x.lunar) + '</b><span class="cal__date">' + esc(Number(x.md.slice(0, 2)) + '/' + Number(x.md.slice(3))) + '<small>週' + esc(x.wd) + '</small></span>' +
          '<span class="cal__bar" aria-hidden="true"><i style="--h:' + (dp / maxDinner).toFixed(3) + '"></i></span>' +
          '<span class="cal__from"><small>NT$</small>' + nt(fromPrice(x.id)) + '<small>起</small></span></button>';
      }).join('');
    }
    function drawDay() {
      var x = kDates.filter(function (y) { return y.id === kState.date; })[0];
      var list = dayOffers(kState.date), blocks = [], segs = [];
      // 當日所有餐期條件相同時只寫一次，避免每列重複
      var same = list.length > 1 && list.every(function (o) { return o.deposit === list[0].deposit && !o.noDiscount; });
      list.forEach(function (o) {
        (o.slots || []).forEach(function (sl, k) {
          var sp = span(sl.time), s0 = (sp[0] - AX0) / (AX1 - AX0), dd = (sp[1] - sp[0]) / (AX1 - AX0);
          var full = /全額/.test(o.deposit);
          segs.push('<i class="' + (kState.meal === o.meal ? 'is-hl' : '') + '" style="--s:' + s0.toFixed(4) + ';--d:' + dd.toFixed(4) + '"></i>');
          blocks.push('<article class="slot slot--' + esc(o.meal) + (kState.meal === o.meal ? ' is-hl' : '') + '" style="--s:' + s0.toFixed(4) + ';--d:' + dd.toFixed(4) + '">' +
            '<span class="slot__icon" aria-hidden="true">' + icon({ lunch: 'sun', tea: 'tea', dinner: 'moon' }[o.meal] || 'sun') + '</span>' +
            '<p class="slot__meal">' + esc(ML[o.meal].label) + (o.slots.length > 1 ? '<small class="slot__seat">' + (k ? '第二場' : '第一場') + '</small>' : '') + '</p>' +
            '<p class="slot__time">' + esc(sl.time.replace(/^第[一二]場\s*/, '')) + '</p>' +
            '<p class="slot__price"><small>NT$</small>' + nt(sl.adult) + '</p>' +
            '<p class="slot__child">兒童 ' + nt(sl.child) + '</p>' +
            (same ? '' : '<p class="slot__cond"><span class="badge-dep' + (full ? ' is-full' : '') + '">' + esc(full ? '預付全額' : o.deposit.replace('訂金每位 ', '訂金 ')) + '</span>' +
            (o.noDiscount ? '<span class="badge-off">不適用會員優惠</span>' : '') + '</p>') + '</article>');
        });
      });
      var disc = d.discounts[kState.date];
      $('[data-dayview]', sec).innerHTML =
        '<header class="dayview__head"><h4>' + esc(x.lunar) + '<span>' + esc(x.md + '（' + x.wd + '）') + '</span></h4>' +
        (disc ? '<p class="dayview__ribbon">' + esc(disc) + '</p>' : '') + (same ? '<p class="slot__cond"><span class="badge-dep">' + esc('各餐期' + list[0].deposit.replace('訂金每位 ', '訂金每位 ')) + '</span></p>' : '') + '</header>' +
        '<div class="dayband" aria-hidden="true"><div class="dayband__bar">' + segs.join('') + '</div><div class="dayband__ticks">' + [11, 14, 17, 22].map(function (h) { return '<span style="--s:' + ((h * 60 - AX0) / (AX1 - AX0)).toFixed(4) + '">' + h + ':00</span>'; }).join('') + '</div></div>' +
        '<div class="timeline"><div class="timeline__axis" aria-hidden="true">' + axis.join('') + '</div><div class="timeline__track">' + blocks.join('') + '</div></div>';
      var tl = $('.timeline', sec); tl.classList.remove('is-swap'); void tl.offsetWidth; tl.classList.add('is-swap');
    }
    function pick(id) { kState.date = id; drawCal(); drawDay(); }
    var cal = $('[data-cal]', sec);
    cal.addEventListener('click', function (e) { var b = e.target.closest('[data-id]'); if (!b) return; kState.meal = ''; pick(b.dataset.id); $('[data-id="' + kState.date + '"]', cal).focus(); });
    cal.addEventListener('keydown', function (e) {
      var dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!dir) return; e.preventDefault();
      var bs = $$('[data-id]', cal), i2 = bs.map(function (b) { return b.dataset.id; }).indexOf(kState.date);
      pick(bs[(i2 + dir + bs.length) % bs.length].dataset.id); $('[data-id="' + kState.date + '"]', cal).focus();
    });
    pick(kState.date);
    // 帶入日期的連結（例如宴會廳售完改訂除夕晚餐）：切到該日並標示餐期
    renderDining.set = function (p) { kState.meal = p.meal || ''; if (p.date) pick(p.date); else drawDay(); };
  }

  /* ---------- 宴會廳（售完，縮小） ---------- */
  function renderBanquet() {
    var b = D.banquet; if (!visible(b)) { $('[data-section=banquet]').hidden = true; return; }
    var sold = b.status === 'soldout';
    $('[data-section=banquet]').innerHTML = '<div class="wrap"><article class="sold" data-reveal><div>' +
      '<p class="tag">' + esc(b.venue + '　除夕限定') + '</p><h2 id="banquet-title">' + esc(b.title) + '</h2><p class="sold__date">' + esc(b.date) + '</p>' +
      '<p style="margin-top:10px">' + esc(b.text) + '</p>' +
      '<div class="sold__prices">' + b.prices.map(function (p) { return '<span>' + esc(p.label) + ' ' + (sold ? '<s>' + esc(p.value) + '</s>' : esc(p.value)) + '</span>' + verify(p.verify, b.title + p.label); }).join('') + '</div>' +
      '<details style="margin-top:8px"><summary>查看圍爐宴菜單</summary><ol>' + b.menu.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ol></details>' +
      '</div>' + ctas(b.ctas) + (sold ? '<span class="sold__stamp" aria-label="已售完">' + esc(b.statusLabel) + '</span>' : '') + '</article></div>';
  }

  /* ---------- 新春館內活動 ---------- */
  var evDay = 'all';
  function renderEvents() {
    var ev = D.events, sec = $('[data-section=events]');
    sec.innerHTML = '<div class="wrap">' + head('events', ev.title, ev.lead) + verify(ev.verify, '館內活動') +
      '<div class="days" role="group" aria-label="選擇日期" data-days>' + ev.days.map(function (d) { return '<button type="button" aria-pressed="' + (d.id === evDay) + '" data-day="' + esc(d.id) + '">' + esc(d.label) + '</button>'; }).join('') + '</div>' +
      '<div class="events" data-ev-list></div></div>';
    function list() {
      var items = ev.items.filter(function (i) { return visible(i) && (evDay === 'all' || i.days.indexOf(evDay) > -1); });
      $('[data-ev-list]', sec).innerHTML = items.length ? items.map(function (i, k) {
        var ok = i.status === 'confirmed';
        return '<article class="event" data-reveal style="--d:' + (k % 3) * .08 + 's">' + photo(i.image, i.title + '示意圖', i.imageStatus) +
          '<div><p class="event__time">' + esc(i.time + '　' + i.place) + '</p><h3>' + esc(i.title) + '</h3><p class="event__desc">' + esc(i.desc) + '</p>' +
          '<span class="event__tag' + (ok ? ' event__tag--ok' : '') + '">' + esc(ok ? i.tag : '示意內容，待公布') + '</span>' + ctas(i.ctas, true) + '</div></article>';
      }).join('') : '<p class="empty empty--dark">當日活動規劃中，敬請期待。</p>';
      observeReveal(sec);
    }
    $('[data-days]', sec).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; evDay = b.dataset.day;
      $$('button', this).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); list();
    });
    list();
  }

  /* ---------- 通路伴手禮 ---------- */
  function renderGifts() {
    var g = D.gifts, sec = $('[data-section=gifts]');
    var ctrl = '<div class="rail-ctrl" data-rail-ctrl="gf"><button class="rail-btn" data-dir="-1" aria-label="上一個">' + icon('arrow') + '</button><button class="rail-btn rail-pause" type="button" data-rail-pause aria-pressed="false" aria-label="暫停自動輪播"><span></span></button><button class="rail-btn" data-dir="1" aria-label="下一個">' + icon('arrow') + '</button></div>';
    // 伴手禮：淺色橫幅＋通路標籤
    sec.innerHTML = '<div class="gift-hero"><div class="wrap"><span class="couplet gift-hero__couplet" aria-hidden="true">' + esc(g.couplet || '新春好禮') + '</span>' +
      '<header class="gift-hero__head" data-reveal><p class="gift-hero__kicker">' + esc(g.kicker || '新春好禮') + '</p>' +
      '<h2 id="gifts-title">' + esc(g.title) + '</h2>' + (g.tagline ? '<p class="gift-hero__tagline">' + esc(g.tagline) + '</p>' : '') +
      '<p class="gift-hero__lead">' + esc(g.lead) + '</p></header>' +
      '<ul class="channels" aria-label="購買通路">' + g.channels.map(function (c) { return '<li>' + (c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.label) + icon('arrow') + '</a>' : esc(c.label)) + '</li>'; }).join('') + '</ul>' +
      '</div></div><div class="wrap gift-body"><div class="sub-head sub-head--row" data-reveal><div><h3>' + esc(g.listTitle || '人氣禮盒') + '</h3></div>' + ctrl + '</div>' +
      '<div class="rail" data-rail="gf">' + g.items.filter(visible).map(function (i) { return itemCard(i, 'gift'); }).join('') + '</div>' +
      '<div class="corp" data-reveal><div><h3>' + esc(g.corporate.title) + '</h3><p>' + esc(g.corporate.text) + '</p></div>' + ctas(g.corporate.ctas, true) + '</div></div>';
  }

  /* ---------- 須知 ---------- */
  function renderFaq() {
    var f = D.faq;
    $('[data-section=faq]').innerHTML = '<div class="wrap">' + head('faq', f.title) + '<div class="faq">' + f.items.map(function (x, i) {
      return '<details' + (i === 0 ? ' open' : '') + ' data-reveal><summary>' + esc(x.q) + '</summary><p>' + esc(x.a) + '</p>' + verify(x.verify, x.q) + '</details>';
    }).join('') + '</div></div>';
  }

  /* ---------- Footer ---------- */
  function renderFooter() {
    var f = D.footer, c = D.contacts, m = D.meta, lg = D.brand.logo;
    var upd = new Date(m.updatedAt);
    var updStr = isNaN(upd) ? m.updatedAt : upd.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    var stage = DRAFT ? 'CMS 草稿預覽' : (m.stage === 'published' ? '正式版' : '內部預覽版（未正式發布）');
    $('[data-footer]').innerHTML =
      '<div class="wrap"><div class="foot__hero"><span class="foot__logo"><img src="' + esc(lg.onDark) + '" alt="' + esc(lg.alt) + '" width="92" height="81"></span>' +
      '<p class="foot__hotel">台北喜來登大飯店<small>SHERATON GRAND TAIPEI HOTEL</small></p>' +
      ctas([{ type: 'phone', label: '訂位與訂購專線 ' + c.main.display, tel: c.main.tel }]) + '</div>' +
      '<div class="foot__grid"><div class="foot__contact"><h4>聯絡我們</h4><ul>' +
      '<li><span>地址</span>' + esc(c.address) + '</li>' +
      '<li><span>電話</span><a href="tel:' + esc(c.main.tel) + '">' + esc(c.main.display) + '</a></li>' +
      '<li><span>傳真</span>' + esc(c.fax) + '</li>' +
      '<li><span>信箱</span><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></li>' +
      '<li><span>統編</span>' + esc(c.taxId) + '</li></ul></div>' +
      '<div><h4>新春服務</h4><ul>' + D.nav.map(function (n) { return '<li><a href="#' + esc(n.id) + '">' + esc(n.label) + '</a></li>'; }).join('') + '</ul></div>' +
      '<div><h4>官方連結</h4><ul>' + f.links.map(function (l) { return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a></li>'; }).join('') + '</ul></div>' +
      '<div><h4>關注我們</h4><div class="social">' + f.social.map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" aria-label="' + esc(s.label + '（另開新視窗）') + '">' + icon(s.id) + '</a>'; }).join('') + '</div></div></div>' +
      '<div class="foot__meta"><p>' + esc(f.legal) + '</p>' +
      '<details><summary>標誌使用規範</summary><ul>' + lg.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></details>' +
      '<p>' + esc(f.trademark) + '</p>' +
      '<p class="version" aria-label="版本資料"><span>網站版本 <b>v' + esc(m.siteVersion) + '</b></span><span>內容版本 <b>rev ' + esc(m.revision) + '</b></span><span>最後更新 <b>' + esc(updStr) + '</b></span><span>' + esc(stage) + '</span></p>' +
      '<p>' + esc(f.copyright) + '</p></div></div>' +
      '<p class="drink">' + esc(f.drinkWarning) + '</p>';
  }

  /* ---------- 詳情對話框 ---------- */
  var lastTrigger;
  function openDetail(key) {
    var parts = key.split(':'), list = parts[0] === 'gift' ? D.gifts.items : D.takeaway.items;
    var it = list.filter(function (x) { return x.id === parts[1]; })[0]; if (!it) return;
    $('[data-dlg-body]').innerHTML = photo(it.image, it.imageAlt || it.name, it.imageStatus, false) +
      '<p class="tag">' + esc(it.venue + (it.tag ? '　' + it.tag : '')) + '</p><h3 id="dlg-title">' + esc(it.name) + '</h3>' +
      '<p class="card__meta">' + esc(it.serve || it.spec || '') + '</p><p>' + esc(it.desc) + '</p>' +
      (it.periods ? '<dl class="dlg__periods">' + it.periods.map(function (p) { return '<div><dt>' + esc(p.label) + '</dt><dd>' + esc(p.value) + '</dd></div>'; }).join('') + '</dl>' : '') +
      (it.menu ? '<ol class="dlg__menu">' + it.menu.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ol>' : '') +
      (it.status === 'onsale' ? '<p class="card__price" style="margin-top:10px">NT$' + nt(it.price) + (it.originalPrice ? '<s>原價 ' + nt(it.originalPrice) + '</s>' : '') + '</p>' + (it.priceNote ? '<p class="card__meta">' + esc(it.priceNote) + '</p>' : '') + (it.notes ? '<p class="dlg__fine">' + esc(it.notes) + '</p>' : '') : '<p class="dlg__fine">2027 內容、售價與訂購方式公布後於本頁更新；目前可來電洽詢。</p>') +
      ctas(it.ctas, false, it.status === 'soldout') + (it.source ? '<p class="dlg__fine">資料來源：' + esc(it.source) + '</p>' : '');
    $('#dlg').showModal();
  }

  /* ---------- 動態：揭示、導覽、快捷列 ---------- */
  var revealIO = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); revealIO.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px' }) : null;
  function observeReveal(root) {
    $$('[data-reveal]:not(.is-in)', root).forEach(function (el) { if (revealIO && !REDUCED) revealIO.observe(el); else el.classList.add('is-in'); });
  }

  function navSpy() {
    if (!('IntersectionObserver' in window)) return;
    var links = $$('[data-nav] a');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) {
          var on = a.getAttribute('href') === '#' + e.target.id;
          if (on) {
            a.setAttribute('aria-current', 'true');
            // 只水平捲動章節列，避免 scrollIntoView 連帶捲動整頁
            var nav = a.parentNode;
            if (nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: REDUCED ? 'auto' : 'smooth' });
          } else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    ['hero', 'paths'].concat(D.nav.map(function (n) { return n.id; }), ['site-footer']).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ---------- HERO 捲動敘事（Apple 式） ---------- */
  function heroMotion() {
    var hero = $('[data-hero]'), frame = $('[data-frame]'), heroImg = $('[data-track]'), scenes = $$('[data-scene]'), dots = $$('[data-dots] li');
    var dock = $('.dock');
    var mobile = function () { return innerWidth < 768; };
    var ticking = false, cur = -2;
    function frameStep() {
      ticking = false;
      var r = hero.getBoundingClientRect();
      var span = Math.max(1, r.height - innerHeight);
      var p = clamp(-r.top / span, 0, 1);
      var s = hero.style;
      s.setProperty('--p', p.toFixed(4));
      if (!REDUCED) {
        var mb = mobile(), t = mb ? ss(0, .75, p) : ss(0, .42, p);
        var ct = lerp(mb ? 52 : 50, 0, t), cx = lerp(mb ? 9 : 31, 0, t), cb = lerp(mb ? 11 : 7, 0, t), cr = lerp(mb ? 170 : 320, 0, t);
        frame.style.setProperty('--ct', ct + '%'); frame.style.setProperty('--cx', cx + '%'); frame.style.setProperty('--cb', cb + '%'); frame.style.setProperty('--cr', cr + 'px');
        // 起始時讓整張料理照收進拱形視窗，之後放大為滿版
        var W = innerWidth, H = innerHeight, ar = 1.5;
        var rw = Math.max(W, H * ar), rh = rw / ar;
        var ww = W * (1 - 2 * cx / 100), wh = H * (1 - (ct + cb) / 100);
        var fit = Math.max(ww / rw, wh / rh) * 1.04;
        var sc = lerp(fit, 1, t) * lerp(1.08, 1, ss(.42, 1, p));
        var dy = H * (ct - cb) / 200;
        heroImg.style.width = rw + 'px'; heroImg.style.height = rh + 'px';
        heroImg.style.transform = 'translate(-50%,-50%) translate3d(0,' + dy.toFixed(1) + 'px,0) scale(' + sc.toFixed(4) + ')';
        s.setProperty('--intro', (1 - (mb ? ss(.2, .55, p) : ss(.16, .36, p))).toFixed(3));
        s.setProperty('--shade', (mb ? ss(.55, 1, p) * .6 : ss(.3, .5, p)).toFixed(3));
        var idx = (mb || p < .46) ? -1 : Math.min(scenes.length - 1, Math.floor((p - .46) / .54 * scenes.length));
        if (idx !== cur) {
          cur = idx;
          scenes.forEach(function (el, i) { el.classList.toggle('is-on', i === idx); var a = $('a', el); if (a) a.tabIndex = i === idx ? 0 : -1; });
          dots.forEach(function (el, i) { el.classList.toggle('is-on', i === idx); });
        }
      }
      // 手機快捷列在首屏結束後才出現，避免遮住輪播控制
      if (dock) dock.classList.toggle('is-on', r.bottom < innerHeight * .6);
      if (slideshow.reschedule) slideshow.reschedule(p < .06);
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frameStep); } }
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    frameStep();
  }

  /* ---------- 輪播按鈕 ---------- */
  // 自動輪播：每 4 秒前進一張，到底回到第一張；觸碰、滑鼠停留、鍵盤聚焦、離開畫面或分頁隱藏時暫停
  function rails() {
    $$('[data-rail-ctrl]').forEach(function (ctrl) {
      var rail = $('[data-rail="' + ctrl.dataset.railCtrl + '"]'); if (!rail) return;
      var pauseBtn = $('[data-rail-pause]', ctrl);
      var st = { user: false, hover: false, focus: false, seen: false, idle: 0, timer: 0 };
      function step() { var c = rail.firstElementChild; return c ? c.getBoundingClientRect().width + parseFloat(getComputedStyle(rail).columnGap || 14) : 300; }
      function go(dir) {
        var max = rail.scrollWidth - rail.clientWidth;
        if (dir > 0 && rail.scrollLeft >= max - 4) rail.scrollTo({ left: 0, behavior: REDUCED ? 'auto' : 'smooth' });
        else rail.scrollBy({ left: step() * dir, behavior: REDUCED ? 'auto' : 'smooth' });
      }
      // 回傳暫停原因（空字串表示可自動前進），寫入 data-autoplay 方便測試檢查
      function reason() {
        if (REDUCED) return 'reduced-motion'; if (st.user) return 'user'; if (st.hover) return 'hover'; if (st.focus) return 'focus';
        if (!st.seen) return 'offscreen'; if (document.hidden) return 'hidden'; if (Date.now() < st.idle) return 'interaction';
        if (rail.scrollWidth <= rail.clientWidth + 4) return 'no-overflow'; return '';
      }
      function tick() { clearTimeout(st.timer); st.timer = setTimeout(function () { var why = reason(); rail.dataset.autoplay = why || 'running'; if (!why) go(1); tick(); }, 4000); }
      function hold() { st.idle = Date.now() + 12000; }
      function stopByUser() {
        st.user = true;
        if (pauseBtn) { pauseBtn.setAttribute('aria-pressed', 'true'); pauseBtn.setAttribute('aria-label', '繼續自動輪播'); }
      }
      ctrl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-dir]'); if (b) { stopByUser(); go(Number(b.dataset.dir)); }
      });
      if (pauseBtn) {
        if (REDUCED) pauseBtn.hidden = true;
        pauseBtn.addEventListener('click', function () {
          st.user = !st.user;
          pauseBtn.setAttribute('aria-pressed', String(st.user));
          pauseBtn.setAttribute('aria-label', st.user ? '繼續自動輪播' : '暫停自動輪播');
        });
      }
      rail.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') st.hover = true; });
      rail.addEventListener('pointerleave', function () { st.hover = false; });
      rail.addEventListener('pointerdown', stopByUser);
      rail.addEventListener('wheel', function (e) { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) stopByUser(); }, { passive: true });
      rail.addEventListener('touchstart', stopByUser, { passive: true });
      rail.addEventListener('focusin', function () { st.focus = true; });
      rail.addEventListener('focusout', function () { st.focus = false; });
      if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { st.seen = es[0].isIntersecting; }, { threshold: .4 }).observe(rail);
      else st.seen = true;
      // 篩選切換時回到第一張
      rail.addEventListener('rail:reset', function () { rail.scrollLeft = 0; hold(); });
      tick();
    });
  }

  /* ---------- 頁內跳轉：平滑捲動＋到位保險 ---------- */
  function goTo(el, hash) {
    if (!el) return;
    if (hash && location.hash !== hash) history.pushState(null, '', hash);
    el.scrollIntoView({ behavior: REDUCED ? 'instant' : 'smooth', block: 'start' });
    setTimeout(function () {
      var m = parseFloat(getComputedStyle(el).scrollMarginTop) || parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      // 'auto' 會沿用 CSS 的 smooth，這裡要用 'instant' 才能確保定位
      if (Math.abs(el.getBoundingClientRect().top - m) > 48) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    }, 1000);
  }

  /* ---------- 全域事件 ---------- */
  function globalEvents() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (link && !e.defaultPrevented && !link.hasAttribute('data-preset') && link.getAttribute('href').length > 1) {
        var tgt = document.getElementById(link.getAttribute('href').slice(1));
        if (tgt) { e.preventDefault(); goTo(tgt, link.getAttribute('href')); }
      }
      var pre = e.target.closest('[data-preset]');
      if (pre && renderDining.set) {
        try { renderDining.set(JSON.parse(pre.dataset.preset)); } catch (err) { /* ignore */ }
        var fd = document.getElementById('finder');
        // 帶入日期的連結直接跳到十二廚價目表
        if (fd && pre.getAttribute('href') === '#dining') { e.preventDefault(); goTo(fd, '#finder'); }
      }
      var det = e.target.closest('[data-detail]');
      if (det) { lastTrigger = det; openDetail(det.dataset.detail); }
      if (e.target.closest('[data-close]')) $('#dlg').close();
    });
    var dlg = $('#dlg');
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () { if (lastTrigger) lastTrigger.focus(); });
  }

  /* ---------- 校稿面板 ---------- */
  function reviewPanel() {
    if (!REVIEW) return;
    document.body.classList.add('review');
    var extra = [];
    function scan(arr, where) { (arr || []).forEach(function (i) { if (i.imageStatus === 'placeholder' || i.imageStatus === 'reference') extra.push(where + '「' + (i.name || i.title) + '」使用示意圖（' + i.imageStatus + '）'); }); }
    scan(D.takeaway.items, '外帶年菜'); scan(D.gifts.items, '伴手禮'); scan(D.events.items, '館內活動');
    var all = VERIFY.concat(extra);
    var p = document.createElement('aside'); p.className = 'review-panel is-min';
    p.innerHTML = '<h2>校稿模式：待確認 ' + all.length + ' 項</h2><ol>' + all.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol><button type="button">收合／展開</button>';
    document.body.appendChild(p);
    $('button', p).addEventListener('click', function () { p.classList.toggle('is-min'); });
  }

  /* ---------- 啟動 ---------- */
  function load() {
    if (DRAFT) {
      var tok = sessionStorage.getItem('cmsToken') || '';
      return fetch('/api/content?stage=draft', { headers: { 'X-Admin-Token': tok }, cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('draft ' + r.status); return r.json(); });
    }
    return fetch('data/content.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('content ' + r.status); return r.json(); });
  }
  load().then(function (data) {
    D = data;
    applyBrand(); renderNav(); renderHero(); renderPaths(); renderTakeaway(); renderDining(); renderBanquet(); renderEvents(); renderGifts(); renderFaq(); renderFooter();
    observeReveal(document); navSpy(); startSlideshow(); heroMotion(); rails(); globalEvents(); reviewPanel();
    if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
  }).catch(function (err) {
    $('main').innerHTML = '<div class="load-error"><p>內容載入失敗（' + esc(err.message) + '）。請以本機伺服器開啟本頁，或來電 02-2321-5511 洽詢。</p></div>';
  });
})();
