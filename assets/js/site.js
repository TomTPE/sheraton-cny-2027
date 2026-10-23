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
  function mark() { return '<svg class="head__mark" aria-hidden="true"><use href="#emblem"/></svg>'; }
  function head(id, title, lead, extra) {
    return '<header class="head' + (extra ? ' head--split' : '') + '" data-reveal><div>' + mark() +
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
  function photo(src, alt, status, frame, sealChar) {
    if (!src) return '<div class="photo"><div class="seal" aria-hidden="true"><span>' + esc(sealChar || '囍') + '</span></div></div>';
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
  function renderHero() {
    var h = D.hero;
    $('[data-hero-eyebrow]').textContent = h.eyebrow;
    $('[data-hero-title]').innerHTML = h.title.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
    $('[data-hero-lead]').textContent = h.lead;
    var img = $('[data-hero-img]'); img.src = h.image; img.alt = h.imageAlt || '';
    $('[data-hero-tag]').hidden = !(h.imageStatus === 'placeholder' || h.imageStatus === 'reference');
    $('[data-scenes]').innerHTML = h.scenes.map(function (s, i) {
      return '<div class="scene" data-scene="' + i + '"><p class="scene__kicker">' + esc(s.kicker) + '</p><h2>' + esc(s.title) + '</h2><p>' + esc(s.text) + '</p>' +
        '<a class="btn btn--gold" href="#' + esc(s.target) + '" tabindex="-1">' + esc('前往' + s.kicker) + icon('arrow') + '</a></div>';
    }).join('');
    $('[data-dots]').innerHTML = h.scenes.map(function () { return '<li></li>'; }).join('');
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
      photo(it.image, it.imageAlt || it.name, it.imageStatus, false, it.seal || (it.venue || '').charAt(0)) + '</button>' +
      '<div class="card__body"><p class="card__venue">' + esc(it.venue) + (it.tag ? '<span>' + esc(it.tag) + '</span>' : '') + '</p>' +
      '<h3>' + esc(it.name) + '</h3><p class="card__meta">' + sub + '</p>' + status +
      (it.pickup ? '<p class="card__meta">' + esc(it.pickup) + '</p>' : '') +
      verify(it.verify, it.name) + ctas(it.ctas, false, sold) + '</div></article>';
  }
  function renderTakeaway() {
    var t = D.takeaway, items = t.items.filter(visible);
    var feat = items.filter(function (i) { return i.featured; })[0];
    var rest = items.filter(function (i) { return i !== feat; });
    var html = head('takeaway', t.title, t.lead, '<div class="rail-ctrl" data-rail-ctrl="tk"><button class="rail-btn" data-dir="-1" aria-label="上一個">' + icon('arrow') + '</button><button class="rail-btn" data-dir="1" aria-label="下一個">' + icon('arrow') + '</button></div>');
    if (feat) {
      html += '<article class="feature" data-reveal>' + photo(feat.image, feat.imageAlt, feat.imageStatus, true) +
        '<div class="feature__body"><p class="tag">' + esc(feat.venue + '　' + feat.tag) + '</p><h3>' + esc(feat.name) + '</h3><p class="feature__serve">' + esc(feat.serve) + '</p>' +
        '<p class="price"><b><small>NT$</small>' + nt(feat.price) + '</b>' + (feat.originalPrice ? '<s>原價 NT$' + nt(feat.originalPrice) + '</s>' : '') + '<em>' + esc(feat.priceNote) + '</em></p>' +
        '<dl class="periods">' + feat.periods.map(function (p) { return '<div><dt>' + esc(p.label) + '</dt><dd>' + esc(p.value) + '</dd></div>'; }).join('') + '</dl>' +
        '<p class="feature__desc">' + esc(feat.desc) + '</p>' +
        '<details class="menu-fold"><summary>完整菜單</summary><ol>' + feat.menu.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ol></details>' +
        ctas(feat.ctas, true, feat.status === 'soldout') + '<p class="feature__fine">' + esc(feat.notes) + '</p>' + verify(feat.verify, feat.name) + '</div></article>';
    }
    html += '<div class="filters" role="group" aria-label="年菜類型" data-tk-filter>' + t.categories.map(function (c) {
      return '<button type="button" aria-pressed="' + (c.id === tkCat) + '" data-cat="' + esc(c.id) + '">' + esc(c.label) + '</button>';
    }).join('') + '</div><div class="rail rail--grid" data-rail="tk" data-tk-list></div>';
    var sec = $('[data-section=takeaway]');
    sec.innerHTML = '<div class="wrap">' + html + '</div>';
    function list() {
      var shown = rest.filter(function (i) { return tkCat === 'all' || i.category === tkCat; });
      if (tkCat === 'frozen' && feat) shown = [feat].concat(shown);
      $('[data-tk-list]', sec).innerHTML = shown.length ? shown.map(function (i) { return itemCard(i, 'tk'); }).join('') : '<p class="empty">此類別品項即將公布。</p>';
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

  /* ---------- 餐廳內用 ---------- */
  var st = {};
  function renderDining() {
    var d = D.dining; st.date = st.date || d.defaultDate; st.meal = st.meal || d.defaultMeal;
    var R = {}; d.restaurants.forEach(function (r) { R[r.id] = r; });
    var sec = $('[data-section=dining]');
    var rooms = d.rooms;
    sec.innerHTML = '<div class="wrap">' + head('dining', d.title, d.lead) +
      '<div class="finder" data-reveal><div class="dates" role="radiogroup" aria-label="選擇日期" data-dates></div>' +
      '<div class="meals" role="radiogroup" aria-label="選擇餐期" data-meals></div>' +
      '<p class="finder__sum" aria-live="polite" data-sum></p><div class="offers" data-offers></div>' + verify(d.verify, '餐廳內用') + '</div>' +
      '<details class="fold" data-reveal><summary>' + esc(rooms.title) + '</summary><div class="fold__body"><table class="tbl"><thead><tr>' +
      rooms.columns.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rooms.rows.map(function (r) { return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td><td>' + nt(r[2]) + '</td><td>' + nt(r[3]) + '</td></tr>'; }).join('') +
      '</tbody></table><p class="card__meta" style="margin-top:10px">金額單位新台幣，含服務費依 MEMO 規定。包廂需求請電話洽詢。</p>' + verify(rooms.verify, '包廂低消') + '</div></details></div>';

    function radios(el, arr, cur, fn) {
      el.innerHTML = arr.map(function (x) { var on = x.id === cur; return '<button type="button" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-id="' + esc(x.id) + '">' + fn(x) + '</button>'; }).join('');
    }
    function offerCtas(o) {
      var r = R[o.restaurant];
      if (o.booking === 'online' && r.booking && r.booking.url) {
        return [{ type: 'booking', label: '線上訂位', url: r.booking.url }, { type: 'phone', label: '電話訂位', tel: r.tel }];
      }
      return [{ type: 'phone', label: '電話訂位', tel: o.bookingTel || r.tel, note: o.bookingNote }];
    }
    function draw() {
      radios($('[data-dates]', sec), d.dates, st.date, function (x) { return '<b>' + esc(x.lunar) + '</b><small>' + esc(x.md + '（' + x.wd + '）') + '</small>'; });
      radios($('[data-meals]', sec), d.meals, st.meal, function (x) { return esc(x.label); });
      var dd = d.dates.filter(function (x) { return x.id === st.date; })[0], mm = d.meals.filter(function (x) { return x.id === st.meal; })[0];
      var list = d.offers.filter(function (o) { return visible(o) && o.meal === st.meal && o.dates.indexOf(st.date) > -1; });
      $('[data-sum]', sec).textContent = dd.lunar + ' ' + dd.md + '（' + dd.wd + '）' + mm.label + '：' + list.length + ' 個選擇';
      var disc = d.discounts[st.date];
      $('[data-offers]', sec).innerHTML = list.length ? list.map(function (o) {
        var r = R[o.restaurant];
        var body = o.slots ? '<ul class="slots">' + o.slots.map(function (s) {
          return '<li><span>' + esc(s.time) + '</span><b>' + nt(s.adult) + '<small>成人</small></b>' + (s.child ? '<i>兒童 ' + nt(s.child) + '</i>' : '') + '</li>';
        }).join('') + '</ul>' : '<p class="offer__alc">' + esc(o.note) + '</p>';
        var dl = o.noDiscount ? '本餐期不適用會員優惠' : (disc || '');
        var phoneOnly = o.booking === 'phone' && r.booking && r.booking.cnyPhoneOnly ? '除夕及春節期間僅受理電話訂位。' : '';
        return '<article class="offer"><p class="offer__venue"><span>' + esc(r.name + '　' + r.type) + '</span><a href="' + esc(r.page) + '" target="_blank" rel="noopener">餐廳介紹</a></p><h3>' + esc(o.title) + '</h3>' + body +
          '<p class="offer__meta">價格為新台幣，另加 10% 服務費。' + esc(o.deposit) + '。' + (o.extra ? esc(o.extra) + '。' : '') + esc(phoneOnly) + '</p>' +
          (dl ? '<p class="offer__disc">' + esc(dl) + '</p>' : '') + ctas(offerCtas(o)) + '</article>';
      }).join('') : '<p class="empty">這個時段沒有已公布的餐價，請改選其他餐期，或來電 ' + esc(D.contacts.main.display) + ' 洽詢。</p>';
    }
    function bind(el, key) {
      el.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; st[key] = b.dataset.id; draw(); $('[data-id="' + st[key] + '"]', el).focus(); });
      el.addEventListener('keydown', function (e) {
        var dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!dir) return; e.preventDefault();
        var bs = $$('button', el), i = bs.indexOf(document.activeElement), n = bs[(i + dir + bs.length) % bs.length];
        st[key] = n.dataset.id; draw(); $('[data-id="' + st[key] + '"]', el).focus();
      });
    }
    bind($('[data-dates]', sec), 'date'); bind($('[data-meals]', sec), 'meal'); draw();
    renderDining.set = function (p) { if (p.date) st.date = p.date; if (p.meal) st.meal = p.meal; draw(); };
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
      }).join('') : '<p class="empty" style="color:rgba(255,255,255,.7);border-color:var(--line-d)">當日活動規劃中，敬請期待。</p>';
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
    sec.innerHTML = '<div class="wrap">' + head('gifts', g.title, g.lead, '<div class="rail-ctrl" data-rail-ctrl="gf"><button class="rail-btn" data-dir="-1" aria-label="上一個">' + icon('arrow') + '</button><button class="rail-btn" data-dir="1" aria-label="下一個">' + icon('arrow') + '</button></div>') +
      '<ul class="channels" aria-label="購買通路">' + g.channels.map(function (c) { return '<li>' + (c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.label) + '</a>' : esc(c.label)) + '</li>'; }).join('') + '</ul>' +
      '<div class="rail rail--grid" data-rail="gf">' + g.items.filter(visible).map(function (i) { return itemCard(i, 'gift'); }).join('') + '</div>' +
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
    $('[data-dlg-body]').innerHTML = photo(it.image, it.imageAlt || it.name, it.imageStatus, false, it.seal || it.venue.charAt(0)) +
      '<p class="tag">' + esc(it.venue + (it.tag ? '　' + it.tag : '')) + '</p><h3 id="dlg-title">' + esc(it.name) + '</h3>' +
      '<p class="card__meta">' + esc(it.serve || it.spec || '') + '</p><p>' + esc(it.desc) + '</p>' +
      (it.status === 'onsale' ? '<p class="card__price" style="margin-top:10px">NT$' + nt(it.price) + '</p>' : '<p class="dlg__fine">2027 內容、售價與訂購方式公布後於本頁更新；目前可來電洽詢。</p>') +
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
    ['hero'].concat(D.nav.map(function (n) { return n.id; }), ['site-footer']).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ---------- HERO 捲動敘事（Apple 式） ---------- */
  function heroMotion() {
    var hero = $('[data-hero]'), frame = $('[data-frame]'), heroImg = $('[data-hero-img]'), scenes = $$('[data-scene]'), dots = $$('[data-dots] li');
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
        var t = ss(0, .42, p), mb = mobile();
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
        s.setProperty('--intro', (1 - ss(.16, .36, p)).toFixed(3));
        s.setProperty('--shade', ss(.3, .5, p).toFixed(3));
        var idx = p < .46 ? -1 : Math.min(scenes.length - 1, Math.floor((p - .46) / .54 * scenes.length));
        if (idx !== cur) {
          cur = idx;
          scenes.forEach(function (el, i) { el.classList.toggle('is-on', i === idx); var a = $('a', el); if (a) a.tabIndex = i === idx ? 0 : -1; });
          dots.forEach(function (el, i) { el.classList.toggle('is-on', i === idx); });
        }
      }
      if (dock) dock.classList.toggle('is-on', scrollY > innerHeight * .5);
      dust.active = r.bottom > 0;
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frameStep); } }
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    frameStep();
  }

  /* ---------- 金箔微粒 ---------- */
  var dust = { active: true };
  function goldDust() {
    var cv = $('[data-dust]'); if (!cv || REDUCED) return;
    var ctx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), W, H, P = [];
    function size() {
      W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = W < 768 ? 34 : 70; P = [];
      for (var i = 0; i < n; i++) P.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + .4, v: Math.random() * .25 + .08, a: Math.random() * Math.PI * 2, s: Math.random() * .02 + .006, d: (Math.random() - .5) * .2 });
    }
    size(); addEventListener('resize', size);
    function loop() {
      requestAnimationFrame(loop);
      if (!dust.active || document.hidden) return;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < P.length; i++) {
        var q = P[i]; q.y -= q.v; q.x += q.d + Math.sin(q.a) * .15; q.a += q.s;
        if (q.y < -10) { q.y = H + 10; q.x = Math.random() * W; }
        var al = (Math.sin(q.a * 2) + 1) / 2 * .7 + .15;
        var g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r * 4);
        g.addColorStop(0, 'rgba(250,228,186,' + al + ')'); g.addColorStop(1, 'rgba(201,162,107,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * 4, 0, 6.283); ctx.fill();
      }
    }
    loop();
  }

  /* ---------- 輪播按鈕 ---------- */
  function rails() {
    $$('[data-rail-ctrl]').forEach(function (ctrl) {
      var rail = $('[data-rail="' + ctrl.dataset.railCtrl + '"]');
      ctrl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-dir]'); if (!b || !rail) return;
        var card = rail.firstElementChild; var step = card ? card.getBoundingClientRect().width + 14 : 300;
        rail.scrollBy({ left: step * Number(b.dataset.dir), behavior: REDUCED ? 'auto' : 'smooth' });
      });
    });
  }

  /* ---------- 全域事件 ---------- */
  function globalEvents() {
    document.addEventListener('click', function (e) {
      var pre = e.target.closest('[data-preset]');
      if (pre && renderDining.set) { try { renderDining.set(JSON.parse(pre.dataset.preset)); } catch (err) { /* ignore */ } }
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
    var p = document.createElement('aside'); p.className = 'review-panel';
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
    applyBrand(); renderNav(); renderHero(); renderTakeaway(); renderDining(); renderBanquet(); renderEvents(); renderGifts(); renderFaq(); renderFooter();
    observeReveal(document); navSpy(); heroMotion(); goldDust(); rails(); globalEvents(); reviewPanel();
    if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
  }).catch(function (err) {
    $('main').innerHTML = '<div class="load-error"><p>內容載入失敗（' + esc(err.message) + '）。請以本機伺服器開啟本頁，或來電 02-2321-5511 洽詢。</p></div>';
  });
})();
