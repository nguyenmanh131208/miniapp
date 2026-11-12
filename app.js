/* ═══════════════════════════════════════════════════════════════
   BANNEI MOD LQ — LIQUID GLASS 6.1 · app.js
   ═══════════════════════════════════════════════════════════════ */

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation?.();
  try { tg.setHeaderColor?.('secondary_bg_color'); } catch {}
  try { tg.setBackgroundColor?.('#07080d'); } catch {}
}

const ADMIN_ID = 2056107378;
const ADMIN_CONTACT = 'https://t.me/quangbaong';

/* ── selectors ── */
const $ = (id) => document.getElementById(id);
const qsa = (s, r = document) => [...r.querySelectorAll(s)];

/* ── state ── */
const state = {
  catalog: {},
  cart: {},
  currentLetter: null,
  currentHero: null,
  isAdmin: false,
  isVip: false,
  vipDays: 0,
  totalHeroes: 0,
  totalSkins: 0,
  settings: loadSettings(),
  heroIcons: {},
  skinCodes: {},
  searchIndex: [],
};

const EXTRA_KEYS = new Set(['Cam Xa', 'HD Chiêu', 'Server']);
// Server mod — mỗi server = 1 thư mục Resources* trong BANNEI_SOURCE (khớp bot.py SERVER_LABELS).
const SERVERS = [
  { dir: 'Resources',    label: 'VN · Việt Nam (Garena)' },
  { dir: 'Resources_EU', label: 'EU · Châu Âu' },
  { dir: 'Resources_TH', label: 'TH · Thái Lan' },
  { dir: 'Resources_TW', label: 'TW · Đài Loan' },
];

/* SVG icon helpers (thay emoji cũ) */
const SVG_HERO = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l2.2 4.5 5 .7-3.6 3.5.9 5L12 14.8 7.5 16.7l.9-5L4.8 8.2l5-.7L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const SVG_TOOL = `<svg viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5 2.5-2.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const SVG_SEARCH = `<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.7"/><path d="M16 16l4.2 4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
function svgIcon(svg, cls = 'hc-icon-fb') {
  return `<span class="${cls} ico-svg">${svg}</span>`;
}

/* ═══════════════════════════════════════════════════════════════
   WEB ↔ BOT API BRIDGE  (1 luồng: gửi lệnh + nhận phản hồi tại chỗ)
   - API_BASE: bot tự gắn qua ?api=<tunnel> khi mở Mini App
   - INIT_DATA: chuỗi gốc để bot xác thực (HMAC) chống giả mạo
   ═══════════════════════════════════════════════════════════════ */
const _urlp = new URLSearchParams(location.search);
let API_BASE = (_urlp.get('api') || '').replace(/\/+$/, '');
// Nhớ địa chỉ API: mở đúng 1 lần (qua nút có ?api=) thì lần sau nút menu cũ vẫn chạy
if (API_BASE) {
  try { localStorage.setItem('bannei_api', API_BASE); } catch {}
} else {
  try { API_BASE = (localStorage.getItem('bannei_api') || '').replace(/\/+$/, ''); } catch {}
}
const INIT_DATA = tg?.initData || '';
const API_READY = !!(API_BASE && INIT_DATA);
let _pollSeq = 0;
let _pollTimer = null;

// Tự kiểm tra & báo trạng thái kết nối bot (giúp chẩn đoán "không chạy")
async function checkApiConnection() {
  if (!INIT_DATA) {
    toast('⚠️ Hãy mở Mini App TRONG Telegram (nút bàn phím), không mở bằng trình duyệt.', 'error');
    return;
  }
  if (!API_BASE) {
    toast('⚠️ Chưa có địa chỉ bot. Gõ /start trong bot rồi mở lại Mini App.', 'error');
    return;
  }
  progressStart();
  try {
    const r = await fetch(API_BASE + '/api/health', { cache: 'no-store' });
    const j = await r.json();
    if (!j || !j.ok) throw new Error('bad');
    // Kết nối tốt = im lặng, chỉ báo ở khung chat (đỡ toast rác mỗi lần mở app)
    setChatStatus('on', 'Trực tuyến');
    toast('🟢 Đã kết nối bot', 'success', 1500);
  } catch {
    setChatStatus('off', 'Mất kết nối', true);
    toast('⚠️ Không kết nối được bot (tunnel có thể đã đổi). Gõ /start rồi mở lại.', 'error');
  } finally {
    progressEnd();
  }
}

async function apiSend(payload, silent) {
  try {
    const res = await fetch(API_BASE + '/api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: INIT_DATA, ...payload }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) {
      if (!silent) toast('❌ Bot từ chối: ' + (j.error || res.status), 'error');
      return false;
    }
    return true;
  } catch (e) {
    if (!silent) toast('❌ Không gọi được bot: ' + e.message, 'error');
    return false;
  }
}

let _botUnread = 0;

function _chatVisible() {
  const p = $('botPanel');
  return p && !p.hidden;
}
function _setFabBadge() {
  const b = $('chatFabBadge');
  if (!b) return;
  if (_botUnread > 0) { b.textContent = _botUnread > 9 ? '9+' : String(_botUnread); b.classList.add('show'); }
  else { b.textContent = ''; b.classList.remove('show'); }
}

/* ── cuộn thông minh: chỉ tự xuống đáy khi user đang ở đáy ── */
function _isChatNearBottom() {
  const box = $('botLog');
  if (!box) return true;
  return box.scrollHeight - box.scrollTop - box.clientHeight < 72;
}
function _scrollChatEnd(smooth) {
  const box = $('botLog');
  if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  _toggleNewPill(false);
}
function _toggleNewPill(show) {
  const pill = $('chatNewPill');
  if (pill) pill.hidden = !show;
}
/* gọi TRƯỚC khi thêm tin, dùng kết quả để quyết định sau khi thêm */
function _afterAppend(wasAtBottom) {
  if (wasAtBottom) _scrollChatEnd(false);
  else if (_chatVisible()) _toggleNewPill(true);
}

function _appendTyping() {
  const box = $('botLog');
  if (!box || $('chatTyping')) return;
  const stick = _isChatNearBottom();
  const t = document.createElement('div');
  t.id = 'chatTyping';
  t.className = 'chat-typing';
  t.innerHTML = '<span></span><span></span><span></span>';
  box.appendChild(t);
  _afterAppend(stick);
}
function _removeTyping() {
  const t = $('chatTyping');
  if (t) t.remove();
}

function _nowTime() {
  const d = new Date();
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

// Gộp tin liên tiếp cùng người gửi trong 90 giây → bớt lặp avatar/giờ
let _lastRowKind = null;
let _lastRowAt = 0;
const GROUP_WINDOW_MS = 90_000;

function _resetGrouping() { _lastRowKind = null; _lastRowAt = 0; }

// Tạo 1 dòng tin: bot có avatar + giờ, me căn phải + giờ
function _appendRow(kind, contentEl) {
  const box = $('botLog');
  if (!box) return;
  const stick = _isChatNearBottom();
  const side = kind === 'me' ? 'me' : 'bot';
  const now = Date.now();
  const grouped = _lastRowKind === side && (now - _lastRowAt) < GROUP_WINDOW_MS;

  const row = document.createElement('div');
  row.className = 'chat-msg ' + side + (grouped ? ' grouped' : '');

  if (side !== 'me') {
    const av = document.createElement('div');
    av.className = 'chat-ava-sm';
    av.textContent = '🤖';
    row.appendChild(av);
  }
  const col = document.createElement('div');
  col.className = 'chat-col';
  col.appendChild(contentEl);
  const t = document.createElement('div');
  t.className = 'chat-time';
  t.textContent = _nowTime();
  col.appendChild(t);
  row.appendChild(col);

  box.appendChild(row);
  _lastRowKind = side;
  _lastRowAt = now;
  _afterAppend(stick);

  // chỉ tin từ bot mới tính là chưa đọc
  if (side === 'bot' && !_chatVisible()) { _botUnread++; _setFabBadge(); }
}

// kind: 'bot' (mặc định) | 'me' | 'sys' | 'sys-err'
function botLog(text, fileUrl, kind) {
  const box = $('botLog');
  if (!box) return;
  _removeTyping();

  if (text) {
    if (kind === 'sys' || kind === 'sys-err') {
      const stick = _isChatNearBottom();
      const s = document.createElement('div');
      s.className = 'chat-sys' + (kind === 'sys-err' ? ' err' : '');
      s.textContent = text;
      box.appendChild(s);
      _resetGrouping();          // sau dòng hệ thống, tin kế tiếp hiện lại avatar
      _afterAppend(stick);
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.textContent = text;
      _appendRow(kind, bubble);
    }
  }

  if (fileUrl) {
    const a = document.createElement('a');
    a.className = 'chat-file';
    a.href = API_BASE + fileUrl + '?initData=' + encodeURIComponent(INIT_DATA);
    a.innerHTML = '<span class="chat-file-ic">📦</span><span class="chat-file-tx"><b>MOD_LQ.zip</b><small>Chạm để tải về máy</small></span><span class="chat-file-dl">⬇️</span>';
    a.target = '_blank';
    a.rel = 'noopener';
    _appendRow('bot', a);
  }
}

// Nút liên kết (vd: 🔑 Lấy Key Kích Hoạt) — như bên Telegram
function botLink(url, label) {
  if (!url) return;
  _removeTyping();
  const a = document.createElement('a');
  a.className = 'chat-link';
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = label || '🔗 Mở liên kết';
  _appendRow('bot', a);
}

// Mở khung chat nổi (đè lên tab hiện tại)
function showBotChat(clear) {
  const p = $('botPanel');
  if (!p) return;
  if (clear) { const b = $('botLog'); if (b) b.innerHTML = ''; _resetGrouping(); }
  const fab = $('chatFab'); if (fab) fab.hidden = true;
  _botUnread = 0; _setFabBadge();
  _toggleNewPill(false);
  p.classList.remove('closing');
  p.hidden = false;
  refreshChatStatus();
  // lời chào khi mở khung trống
  const box = $('botLog');
  if (box && !box.children.length) {
    botLog('Xin chào! Mình là trợ lý BANNEI 🤖\nMọi tiến trình & file Mod sẽ hiện ngay tại đây.', null, 'bot');
  }
  requestAnimationFrame(() => _scrollChatEnd(false));
}

function minimizeChat() {
  const p = $('botPanel'); if (!p) return;
  p.hidden = true;
  const fab = $('chatFab'); if (fab) fab.hidden = false;
}

function closeChat() {
  stopPolling();
  const p = $('botPanel');
  if (p) { p.classList.add('closing'); setTimeout(() => { p.hidden = true; p.classList.remove('closing'); }, 260); }
  const fab = $('chatFab'); if (fab) fab.hidden = true;
  _botUnread = 0; _setFabBadge();
}

// Kéo di chuyển khung chat bằng header
function _initChatDrag() {
  const win = $('botPanel');
  const head = $('chatwHead');
  if (!win || !head) return;
  let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.chatw-btn')) return;   // bỏ qua nút
    if (win.classList.contains('maximized')) return;  // đang phóng to thì không kéo
    drag = true;
    const r = win.getBoundingClientRect();
    ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
    win.style.transition = 'none';
    try { head.setPointerCapture(e.pointerId); } catch {}
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    let nx = ox + (e.clientX - sx);
    let ny = oy + (e.clientY - sy);
    const mw = window.innerWidth - win.offsetWidth - 6;
    const mh = window.innerHeight - win.offsetHeight - 6;
    nx = Math.max(6, Math.min(nx, mw));
    ny = Math.max(6, Math.min(ny, mh));
    win.style.left = nx + 'px';
    win.style.top = ny + 'px';
    win.style.right = 'auto';
    win.style.bottom = 'auto';
  });
  const end = (e) => { drag = false; win.style.transition = ''; try { head.releasePointerCapture(e.pointerId); } catch {} };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
}

// Bỏ qua tin cũ còn trong hàng đợi bot (tránh hiện lại lịch sử/trùng lặp)
async function drainBaseline() {
  if (!API_READY) return;
  try {
    const r = await fetch(API_BASE + '/api/poll?after=0&initData=' + encodeURIComponent(INIT_DATA));
    const j = await r.json();
    if (j.ok && Array.isArray(j.msgs)) for (const m of j.msgs) if (m.seq > _pollSeq) _pollSeq = m.seq;
  } catch {}
}

function setChatStatus(kind, text, withRetry) {
  const el = $('chatStatus');
  if (!el) return;
  const dot = kind === 'on' ? '' : (kind === 'warn' ? ' warn' : ' off');
  el.innerHTML = `<span class="chat-dot${dot}"></span> ${escapeHtml(text)}` +
    (withRetry ? '<button type="button" class="chat-retry" id="chatRetry">thử lại</button>' : '');
  const rt = $('chatRetry');
  if (rt) rt.addEventListener('click', () => { haptic('light'); refreshChatStatus(); });
}

async function refreshChatStatus() {
  if (!$('chatStatus')) return;
  if (!INIT_DATA) return setChatStatus('off', 'Mở trong Telegram');
  if (!API_BASE) return setChatStatus('off', 'Chưa kết nối · gõ /start');
  setChatStatus('warn', 'Đang kiểm tra…');
  try {
    const r = await fetch(API_BASE + '/api/health', { cache: 'no-store' });
    const j = await r.json();
    if (j && j.ok) { _pollFails = 0; setChatStatus('on', 'Trực tuyến'); }
    else setChatStatus('off', 'Mất kết nối', true);
  } catch {
    setChatStatus('off', 'Mất kết nối · /start lại', true);
  }
}

/* ── POLLING THÍCH ỨNG ──
   Có tin → nhịp nhanh. Im lặng lâu → giãn dần (đỡ pin & đỡ tải bot).
   Ẩn Mini App → dừng hẳn, quay lại → poll ngay. */
const POLL_MIN = 1200;
const POLL_MAX = 8000;
let _pollDelay = POLL_MIN;
let _pollFails = 0;
let _pollOn = false;

async function _pollOnce() {
  const res = await fetch(API_BASE + '/api/poll?after=' + _pollSeq +
    '&initData=' + encodeURIComponent(INIT_DATA));
  const j = await res.json().catch(() => ({}));
  let got = 0;
  if (j.ok && Array.isArray(j.msgs)) {
    for (const m of j.msgs) {
      if (m.seq > _pollSeq) _pollSeq = m.seq;
      if (m.clear) clearCartFromServer();
      if (m.text || m.file) { botLog(m.text, m.file); got++; }
      if (m.link) { botLink(m.link.url, m.link.label); got++; }
    }
  }
  return got;
}

function _scheduleNextPoll() {
  if (!_pollOn) return;
  clearTimeout(_pollTimer);
  _pollTimer = setTimeout(_pollTick, _pollDelay);
}

async function _pollTick() {
  if (!_pollOn) return;
  if (document.hidden) { _scheduleNextPoll(); return; }   // ẩn app → bỏ nhịp này
  try {
    const got = await _pollOnce();
    if (_pollFails) { _pollFails = 0; setChatStatus('on', 'Trực tuyến'); }
    // có tin → về nhịp nhanh; im lặng → giãn dần tới POLL_MAX
    _pollDelay = got ? POLL_MIN : Math.min(POLL_MAX, Math.round(_pollDelay * 1.35));
  } catch {
    _pollFails++;
    _pollDelay = Math.min(POLL_MAX, Math.round(_pollDelay * 1.6));
    if (_pollFails === 3) setChatStatus('warn', 'Mạng chập chờn · đang thử lại');
    if (_pollFails === 8) setChatStatus('off', 'Mất kết nối', true);
  }
  _scheduleNextPoll();
}

function startPolling() {
  if (!API_READY) return;
  _pollOn = true;
  _pollDelay = POLL_MIN;
  clearTimeout(_pollTimer);
  _pollTimer = setTimeout(_pollTick, 400);   // nhịp đầu tiên gần như tức thì
}

function stopPolling() {
  _pollOn = false;
  if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
}

// Quay lại app → kiểm tra ngay, không chờ hết nhịp giãn
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !_pollOn) return;
  _pollDelay = POLL_MIN;
  clearTimeout(_pollTimer);
  _pollTimer = setTimeout(_pollTick, 150);
});

/* ═══════════════════════════════════════════════════════════════
   TELEGRAM LOGIN + VIP / ADMIN DETECTION
   ═══════════════════════════════════════════════════════════════ */
// Lấy user: ưu tiên initDataUnsafe, fallback parse từ initData thô.
// Nhờ vậy nút menu / nút bàn phím đều nhận diện được, không kẹt "login gate".
function getTgUser() {
  if (tg?.initDataUnsafe?.user) return tg.initDataUnsafe.user;
  try {
    const raw = tg?.initData || '';
    if (raw) {
      const us = new URLSearchParams(raw).get('user');
      if (us) return JSON.parse(us);
    }
  } catch {}
  return null;
}

function loginTelegram() {
  const u = getTgUser();
  if (!u) {
    $('userName').textContent = 'Mở qua Telegram';
    $('userId').textContent = 'Chưa đăng nhập';
    $('avatar').textContent = '?';
    $('vipText').textContent = 'N/A';
    $('vipPill').classList.add('none');
    showWebLoginGate();
    return;
  }

  hideWebLoginGate();
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'User';
  $('userName').textContent = name;
  $('userId').textContent = `ID: ${u.id}`;
  $('myidVal').textContent = u.id;

  if (u.photo_url) {
    $('avatar').innerHTML = `<img src="${u.photo_url}" alt="">`;
  } else {
    $('avatar').textContent = (u.first_name || '?')[0].toUpperCase();
  }

  // parse start_param: vip:<days> | admin:1 | vip:<days>+admin:1
  // Source priority: Telegram start_param → URL query (?s=...) → empty
  const urlParams = new URLSearchParams(location.search);
  const sp =
    tg.initDataUnsafe?.start_param ||
    urlParams.get('s') ||
    urlParams.get('start_param') ||
    urlParams.get('tgWebAppStartParam') ||
    '';
  const vipMatch = /vip:(\d+)/.exec(sp);
  if (vipMatch) {
    const days = parseInt(vipMatch[1], 10);
    state.vipDays = days;
    if (days > 0) {
      state.isVip = true;
      $('vipText').textContent = `VIP · ${days} ngày`;
      $('vipPill').className = 'vip-pill';
    } else {
      $('vipText').textContent = 'VIP hết hạn';
      $('vipPill').className = 'vip-pill expired';
    }
  } else {
    $('vipText').textContent = 'Free';
    $('vipPill').className = 'vip-pill none';
  }

  // admin detection: by ID OR start_param flag
  const isAdminParam = /admin:1/.test(sp);
  if (u.id === ADMIN_ID || isAdminParam) {
    state.isAdmin = true;
    qsa('.admin-only').forEach((el) => (el.hidden = false));
    $('tabsBar').classList.add('with-admin');
    $('vipText').textContent = '👑 ADMIN';
    $('vipPill').className = 'vip-pill admin';
  }
}

/* ── Web Login Gate (non-Telegram access) ── */
function showWebLoginGate() {
  let gate = $('webLoginGate');
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'webLoginGate';
    gate.className = 'web-login-gate';
    gate.innerHTML = `
      <div class="wlg-card">
        <div class="wlg-logo">🛡️</div>
        <h2>BANNEI MOD LQ</h2>
        <p>Mini App này chạy <b>bên trong Telegram</b>.</p>
        <div class="wlg-buttons">
          <a class="wlg-btn primary" href="https://t.me/">🤖 Mở Bot Telegram</a>
        </div>
        <p class="wlg-hint">Trong bot: gõ <b>/start</b> → bấm <b>☰ Mở </b>.</p>
      </div>
    `;
    document.body.appendChild(gate);
  }
  gate.style.display = 'flex';
}

function hideWebLoginGate() {
  const gate = $('webLoginGate');
  if (gate) gate.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════════
   CATALOG LOADER
   ═══════════════════════════════════════════════════════════════ */
async function loadCatalog() {
  showLoader('Đang tải catalog…');
  try {
    const res = await fetch('catalog.json?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.catalog = await res.json();
    const folders = Object.keys(state.catalog);
    if (!folders.length) throw new Error('catalog rỗng');

    state.totalHeroes = folders.length;
    state.totalSkins = folders.reduce((n, f) => n + (state.catalog[f]?.length || 0), 0);
    countUpTo($('stHeroes'), state.totalHeroes);
    countUpTo($('stSkins'), state.totalSkins);

    buildSearchIndex();
    hideLoader();
    renderAlphabet();
  } catch (e) {
    hideLoader();
    const skel = $('alphaSkel');
    if (skel) skel.hidden = true;
    $('alphaGrid').innerHTML =
      `<div class="empty" style="grid-column:1/-1">
         <div class="empty-icon ei-svg">${SVG_SEARCH}</div>
         <p>Không tải được danh sách tướng.<br><b>${escapeHtml(e.message)}</b></p>
         <button type="button" class="btn-ghost" id="catalogRetry" style="margin-top:14px">Thử lại</button>
       </div>`;
    $('catalogRetry')?.addEventListener('click', (ev) =>
      withBusy(ev.currentTarget, () => loadCatalog()));
    toast('Không tải được catalog: ' + e.message, 'error');
  }
}

/* Số ở thanh thống kê đếm tăng dần — phản hồi "app đã tải xong" rõ ràng hơn */
function countUpTo(el, target, ms = 650) {
  if (!el) return;
  if (state.settings.perfLite || prefersReducedMotion()) { el.textContent = target; return; }
  const from = parseInt(el.textContent, 10) || 0;
  if (from === target) return;
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function prefersReducedMotion() {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; }
  catch { return false; }
}

function showLoader(text) {
  $('loaderText').textContent = text;
  $('loader').hidden = false;
}
function hideLoader() { $('loader').hidden = true; }

/* ═══════════════════════════════════════════════════════════════
   HERO ICON HELPERS
   ═══════════════════════════════════════════════════════════════ */

// Static hero prefix map (fallback if hero_icons.json fails to load)
const HERO_PREFIX = {"Airi":"130","Aleister":"156","Alice":"118","Allain":"537","Amily":"193","Annette":"519","Aoi":"536","Arduin":"126","Arthur":"166","Arum":"187","Astrid":"502","Ata":"511","Aya":"543","Azzen'Ka":"127","Baldum":"505","Bijan":"548","Billow":"599","Biron":"597","Bolt Baron":"598","Bonnie":"541","Bright":"540","Butterfly":"116","Capheny":"524","Celica":"192","Charlotte":"206","Chaugnar":"113","Cresht":"171","D'Arcy":"523","Dextra":"534","Dirak":"530","Dolia":"159","Eland'orr":"199","Elsu":"196","Enzo":"195","Erin":"567","Errol":"522","Fennik":"173","Florentino":"521","Gildur":"108","Goverra":"596","Grakk":"175","Hayate":"132","Heino":"563","Helen":"184","Iggy":"538","Ignis":"124","Ilumia":"136","Ishar":"526","Jinna":"115","Kahlii":"110","Kaine":"153","Keera":"531","Kil'Groth":"139","Kriknak":"162","Krixi":"106","Krizzix":"189","Lauriel":"141","Laville":"533","Liliana":"510","Lindis":"177","Lorion":"539","Lumburr":"168","Lữ Bố":"128","Maloch":"123","Marja":"121","Max":"180","Mganga":"119","Mina":"120","Ming":"568","Moren":"170","Murad":"131","Nakroth":"150","Natalya":"142","Ngộ Không":"167","Omega":"114","Omen":"506","Ormarr":"117","Paine":"137","Preyta":"148","Qi":"528","Quillen":"518","Raz":"157","Richter":"515","Rouie":"191","Rourke":"512","Roxie":"514","Ryoma":"163","Sephera":"527","Sinestrea":"535","Skud":"134","Slimz":"169","Stuart":"174","Superman":"140","Taara":"144","Tachi":"542","TeeMee":"186","Teeri":"546","Tel'Annas":"501","Thane":"135","The Flash":"507","Thorne":"532","Toro":"105","Triệu Vân":"129","Tulen":"190","Valhein":"133","Veera":"109","Veres":"520","Violet":"111","Volkath":"529","Wisp":"508","Wonder Woman":"504","Xeniel":"149","Y'bneth":"509","Yan":"544","Yena":"154","Yorn":"112","Yue":"545","Zata":"513","Zephys":"107","Zill":"146","Zip":"525","Zuka":"503","Điêu Thuyền":"152"};

async function loadHeroIcons() {
  // Try fetching extended data first, fall back to static HERO_PREFIX
  try {
    const res = await fetch('hero_icons.json?t=' + Date.now());
    if (res.ok) { state.heroIcons = await res.json(); return; }
  } catch {}
  // Build minimal structure from static data
  for (const [name, prefix] of Object.entries(HERO_PREFIX)) {
    state.heroIcons[name] = { prefix: prefix };
  }
}
async function loadSkinCodes() {
  try {
    const res = await fetch('skin_codes.json?t=' + Date.now());
    if (res.ok) state.skinCodes = await res.json();
  } catch {}
}

/**
 * Icon CDN Garena KGVN
 *  - Hero default (variant 0) : {cdn}{prefix}0.jpg
 *      Nakroth → 301500.jpg · Omega → 301140.jpg
 *  - Skin id ≥ 1            : {cdn}{prefix}{variant}head.jpg
 *      Nakroth skin 01 → 301501head.jpg · skin 09 → 301509head.jpg
 *  - Không có file → ICON_FALLBACK (301140.jpg)
 */
const ICON_CDN_BASE = 'https://dl.ops.kgvn.garenanow.com/hok/VN/HeroHeadPath/';
const ICON_FALLBACK = ICON_CDN_BASE + '301140.jpg'; // Omega default — luôn có trên CDN

function getHeroIconUrl(heroName, skinName) {
  const info = state.heroIcons[heroName];
  const prefix = (info && info.prefix) || HERO_PREFIX[heroName] || '';
  if (!prefix) return ICON_FALLBACK;
  const CDN = (info && info.cdn_id) || state.heroIcons._cdn_id || '30';
  let variant = 0;
  if (skinName) {
    const skinCode = state.skinCodes[heroName + '|' + skinName];
    if (skinCode && String(skinCode).length >= 4) {
      // 15001 → 1 ; 13009 → 9 ; 13019 → 19
      const tail = String(skinCode).slice(prefix.length) || String(skinCode).slice(-2);
      const n = parseInt(tail, 10);
      if (!Number.isNaN(n)) variant = n;
    }
  }
  const id = `${CDN}${prefix}${variant}`;
  // hero mặc định: 301500.jpg — skin từ 1: 301501head.jpg
  if (variant <= 0) return `${ICON_CDN_BASE}${id}.jpg`;
  return `${ICON_CDN_BASE}${id}head.jpg`;
}

function heroDisplayId(heroName) {
  const info = state.heroIcons[heroName];
  return (info && (info.display_id || info.prefix)) || HERO_PREFIX[heroName] || '';
}

// onerror: skin head→.jpg ; rồi ICON_FALLBACK
window.__hiFb = function (el) {
  if (!el) return;
  if (el.dataset.fbDone === '1') {
    el.style.display = 'none';
    return;
  }
  const step = parseInt(el.dataset.fb || '0', 10) || 0;
  const src = String(el.src || '');
  // skin: 301501head.jpg 403 → thử 301501.jpg
  if (step === 0 && /head\.jpg$/i.test(src)) {
    el.dataset.fb = '1';
    el.src = src.replace(/head\.jpg$/i, '.jpg');
    return;
  }
  // hero: 30xxx0.jpg 403 → thử head (hiếm)
  if (step === 0 && /\d+\.jpg$/i.test(src) && !/head\.jpg$/i.test(src)) {
    el.dataset.fb = '1';
    el.src = src.replace(/\.jpg$/i, 'head.jpg');
    return;
  }
  // hết cách → icon mặc định 301140.jpg
  el.dataset.fbDone = '1';
  el.src = ICON_FALLBACK;
};

function heroIconImg(heroName, skinName, cls) {
  const url = getHeroIconUrl(heroName, skinName) || ICON_FALLBACK;
  return `<img class="${cls || 'hi-avatar'}" src="${url}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="__hiFb(this)">`;
}

/* ═══════════════════════════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════════════════════════ */
/* 1 nơi duy nhất đổi tab — dùng cho cả bấm tay lẫn chuyển tự động */
function switchTab(tab, { scroll = true } = {}) {
  qsa('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  qsa('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${tab}`));
  if (tab === 'cart') renderCart();
  if (tab === 'more') refreshSettingsLabels();
  if (scroll) {
    const smooth = !state.settings.perfLite && !prefersReducedMotion();
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  }
  scheduleBack();
}

$('tabsBar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  haptic('light');
  switchTab(btn.dataset.tab);
});

/* ═══════════════════════════════════════════════════════════════
   ALPHA / HERO / SKIN PAGES
   ═══════════════════════════════════════════════════════════════ */
/* Dựng HTML 1 lần rồi gán innerHTML — nhanh hơn nhiều so với appendChild từng ô.
   Sự kiện dùng delegation (1 listener / lưới) thay vì 1 listener / ô. */
function renderAlphabet() {
  const counts = new Map();
  for (const f of Object.keys(state.catalog)) {
    const L = f[0].toUpperCase();
    counts.set(L, (counts.get(L) || 0) + 1);
  }
  const letters = [...counts.keys()].sort();
  $('alphaGrid').innerHTML = letters
    .map((L, i) => `<button class="alpha-cell" data-letter="${escapeAttr(L)}" style="animation-delay:${Math.min(i, 12) * 0.03}s">${escapeHtml(L)}<span class="ac-count">${counts.get(L)}</span></button>`)
    .join('');
  const skel = $('alphaSkel');
  if (skel) skel.hidden = true;
}

function openLetter(L) {
  state.currentLetter = L;
  haptic('medium');
  const folders = Object.keys(state.catalog)
    .filter((f) => f[0].toUpperCase() === L)
    .sort();
  $('heroListTitle').textContent = `Chữ "${L}"`;
  $('heroListSub').textContent = `${folders.length} tướng`;

  $('heroGrid').innerHTML = folders.map((f, i) => {
    const skins = state.catalog[f] || [];
    const iconHtml = heroIconImg(f, null, 'hc-icon') || svgIcon(SVG_HERO, 'hc-icon-fb');
    const hid = heroDisplayId(f);
    return `<button class="hero-cell hero-card${state.cart[f] ? ' has-skin' : ''}"
        data-folder="${escapeAttr(f)}" style="animation-delay:${Math.min(i, 30) * 0.025}s">
      <div class="hc-ava-wrap">${iconHtml}</div>
      <div class="hc-meta">
        <span class="hc-name">${escapeHtml(f)}</span>
        <span class="hc-skins">${skins.length} skin${hid ? ` · <em class="hc-id">#${escapeHtml(hid)}</em>` : ''}</span>
      </div>
      <span class="hc-chev">›</span>
    </button>`;
  }).join('');

  switchHeroesPane('list');
}

function openHero(folder) {
  state.currentHero = folder;
  haptic('medium');
  const skins = state.catalog[folder] || [];
  const hid = heroDisplayId(folder);
  $('skinListTitle').textContent = folder;
  $('skinListSub').textContent = skins.length
    ? `${skins.length} skin có sẵn${hid ? ` · ID ${hid}` : ''}`
    : 'Chưa có skin';

  const grid = $('skinGrid');
  grid.className = 'skin-grid icon-mode';
  if (!skins.length) {
    grid.innerHTML = `<div class="empty"><div class="empty-icon ei-svg">${SVG_HERO}</div><p>Tướng này chưa có skin trong catalog.</p></div>`;
  } else {
    grid.innerHTML = skins.map((s, i) => {
      const skIcon = heroIconImg(folder, s, 'sk-portrait');
      const code = state.skinCodes[folder + '|' + s] || '';
      const shortName = s.replace(folder + ' ', '');
      return `<button class="skin-icon-cell${state.cart[folder] === s ? ' selected' : ''}"
          data-i="${i}" style="animation-delay:${Math.min(i, 20) * 0.03}s">
        <div class="sk-ava">${skIcon || svgIcon(SVG_HERO, 'sk-portrait-fb')}</div>
        <span class="sk-label">${escapeHtml(shortName)}</span>
        ${code ? `<span class="sk-code">${escapeHtml(code)}</span>` : ''}
        <span class="sk-check">✓</span>
      </button>`;
    }).join('');
  }
  switchHeroesPane('skin');
}

/* ── delegation: 1 listener cho mỗi lưới, gắn 1 lần khi khởi động ── */
$('alphaGrid').addEventListener('click', (e) => {
  const c = e.target.closest('.alpha-cell');
  if (c) openLetter(c.dataset.letter);
});
$('heroGrid').addEventListener('click', (e) => {
  const c = e.target.closest('.hero-cell');
  if (c) openHero(c.dataset.folder);
});
$('skinGrid').addEventListener('click', (e) => {
  const c = e.target.closest('.skin-icon-cell');
  if (!c) return;
  const folder = state.currentHero;
  const skin = (state.catalog[folder] || [])[Number(c.dataset.i)];
  if (skin) pickSkin(folder, skin, c);
});

function switchHeroesPane(which) {
  $('alphaPane').hidden = which !== 'alpha';
  $('heroListPane').hidden = which !== 'list';
  $('skinListPane').hidden = which !== 'skin';
}

$('heroBack').addEventListener('click', () => { switchHeroesPane('alpha'); haptic('light'); });
$('skinBack').addEventListener('click', () => { switchHeroesPane('list'); haptic('light'); });

function pickSkin(folder, skin, cellEl) {
  state.cart[folder] = skin;
  saveCart();
  qsa('.skin-cell, .skin-icon-cell', $('skinGrid')).forEach((c) => c.classList.remove('selected'));
  cellEl.classList.add('selected');
  haptic('success');
  toast(`✓ ${folder} → ${shorten(skin, 26)}`, 'success');
  updateBadge();
}

/* ═══════════════════════════════════════════════════════════════
   HERO/SKIN SEARCH (heroes page)
   ═══════════════════════════════════════════════════════════════ */
let searchDebounce = 0;
$('heroSearch').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  $('heroSearchClr').hidden = !q;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => doHeroSearch(q), 180);
});
$('heroSearchClr').addEventListener('click', () => {
  $('heroSearch').value = '';
  $('heroSearchClr').hidden = true;
  doHeroSearch('');
});

/* Index phẳng dựng 1 lần sau khi tải catalog — mỗi lần gõ chỉ quét mảng
   đã lowercase sẵn, không phải toLowerCase() lại ~2000 chuỗi mỗi phím. */
function buildSearchIndex() {
  const idx = [];
  for (const [folder, skins] of Object.entries(state.catalog)) {
    idx.push({ type: 'hero', folder, hay: folder.toLowerCase() });
    if (!Array.isArray(skins)) continue;
    for (const s of skins) {
      idx.push({ type: 'skin', folder, skin: s, hay: s.toLowerCase() });
    }
  }
  state.searchIndex = idx;
}

const SEARCH_LIMIT = 50;

function doHeroSearch(qRaw) {
  const wrap = $('heroSearchResults');
  if (qRaw.length < 2) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    $('alphaGrid').hidden = false;
    return;
  }
  $('alphaGrid').hidden = true;
  const q = qRaw.toLowerCase();
  const hits = [];
  for (const it of state.searchIndex) {
    if (it.hay.includes(q)) hits.push(it);
    if (hits.length >= SEARCH_LIMIT) break;
  }

  if (!hits.length) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon ei-svg">${SVG_SEARCH}</div><p>Không tìm thấy "<b>${escapeHtml(qRaw)}</b>"</p></div>`;
  } else {
    wrap.innerHTML = hits.map((h, i) => {
      const delay = `style="animation-delay:${Math.min(i, 20) * 0.02}s"`;
      if (h.type === 'hero') {
        return `<div class="search-row" data-sr="hero" data-folder="${escapeAttr(h.folder)}" ${delay}>
          ${heroIconImg(h.folder, null, 'sr-icon')}
          <div><b>${highlight(h.folder, qRaw)}</b><div class="meta">Mở danh sách skin</div></div>
          <span class="chev">›</span></div>`;
      }
      return `<div class="search-row" data-sr="skin" data-folder="${escapeAttr(h.folder)}" data-skin="${escapeAttr(h.skin)}" ${delay}>
        ${heroIconImg(h.folder, h.skin, 'sr-icon')}
        <div><b>${escapeHtml(h.folder)}</b><div class="meta">${highlight(h.skin, qRaw)}</div></div>
        <span class="chev">+</span></div>`;
    }).join('');
  }
  wrap.hidden = false;
}

$('heroSearchResults').addEventListener('click', (e) => {
  const row = e.target.closest('.search-row');
  if (!row) return;
  const folder = row.dataset.folder;
  if (row.dataset.sr === 'hero') {
    $('heroSearch').value = '';
    $('heroSearchClr').hidden = true;
    doHeroSearch('');
    openHero(folder);
    return;
  }
  const skin = row.dataset.skin;
  state.cart[folder] = skin;
  saveCart();
  updateBadge();
  haptic('success');
  flashOk(row);
  toast(`✓ ${folder} → ${shorten(skin, 22)}`, 'success');
});

/* ═══════════════════════════════════════════════════════════════
   EXTRAS
   ═══════════════════════════════════════════════════════════════ */
qsa('.extra-card').forEach((card) => {
  card.addEventListener('click', () => {
    const e = card.dataset.extra;
    haptic('medium');
    if (e === 'camxa') return openZoomPicker();
    if (e === 'hdchieu') return toggleExtra('HD Chiêu', 'HD', card);
    if (e === 'server')  return openServerPicker();
    if (e === 'random')  return openRandomPicker();
    if (e === 'idlist')  return openIdListPicker();
  });
});

function toggleExtra(key, source, cardEl) {
  if (state.cart[key]) {
    delete state.cart[key];
    cardEl.classList.remove('selected');
    toast(`✗ Đã bỏ ${key}`);
  } else {
    state.cart[key] = source;
    cardEl.classList.add('selected');
    toast(`✓ Đã thêm ${key}`, 'success');
    haptic('success');
  }
  saveCart();
  updateBadge();
}

function syncExtraCardsState() {
  qsa('.extra-card').forEach((c) => {
    const e = c.dataset.extra;
    const key = ({
      camxa: 'Cam Xa', hdchieu: 'HD Chiêu', server: 'Server',
    })[e];
    c.classList.toggle('selected', !!state.cart[key]);
  });
}

function openZoomPicker() {
  const cur = state.cart['Cam Xa'];
  const cells = [];
  let i = 0;
  for (let z = 105; z < 300; z += 5) {
    const v = `${z}%`;
    cells.push(`<button class="zoom-cell${cur === v ? ' selected' : ''}" data-z="${z}" style="animation-delay:${(i++) * 0.012}s">${v}</button>`);
  }
  $('zoomGrid').innerHTML = cells.join('');
  switchExtrasPane('zoom');
}

$('zoomGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.zoom-cell');
  if (!b) return;
  state.cart['Cam Xa'] = `${b.dataset.z}%`;
  saveCart();
  haptic('success');
  toast(`✓ Cam Xa ${b.dataset.z}%`, 'success');
  syncExtraCardsState();
  switchExtrasPane('list');
  updateBadge();
});

function openServerPicker() {
  const cur = state.cart['Server'] || 'Resources';
  $('serverGrid').innerHTML = SERVERS.map((s, i) =>
    `<button class="zoom-cell${cur === s.dir ? ' selected' : ''}" data-dir="${escapeAttr(s.dir)}" style="animation-delay:${i * 0.03}s">${escapeHtml(s.label)}</button>`
  ).join('');
  switchExtrasPane('server');
}

$('serverGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.zoom-cell');
  if (!b) return;
  const dir = b.dataset.dir;
  const srv = SERVERS.find((s) => s.dir === dir);
  if (dir === 'Resources') delete state.cart['Server'];   // VN = mặc định, không cần lưu
  else state.cart['Server'] = dir;
  saveCart();
  haptic('success');
  toast(`✓ Server: ${srv ? srv.label : dir}`, 'success');
  syncExtraCardsState();
  switchExtrasPane('list');
  updateBadge();
});

function switchExtrasPane(which) {
  $('extrasPane').hidden = which !== 'list';
  $('zoomPicker').hidden = which !== 'zoom';
  $('serverPicker').hidden = which !== 'server';
  const rp = $('randomPicker');
  const ip = $('idListPicker');
  if (rp) rp.hidden = which !== 'random';
  if (ip) ip.hidden = which !== 'idlist';
}

$('zoomBack').addEventListener('click', () => { switchExtrasPane('list'); haptic('light'); });
$('serverBack').addEventListener('click', () => { switchExtrasPane('list'); haptic('light'); });
if ($('randomBack')) $('randomBack').addEventListener('click', () => { switchExtrasPane('list'); haptic('light'); });
if ($('idListBack')) $('idListBack').addEventListener('click', () => { switchExtrasPane('list'); haptic('light'); });

/* ═══════════════════════════════════════════════════════════════
   RANDOM SKIN + PASTE ID LIST
   ═══════════════════════════════════════════════════════════════ */
function buildSkinIdIndex() {
  // code → { folder, skin }
  const byId = {};
  for (const [key, code] of Object.entries(state.skinCodes || {})) {
    if (!code) continue;
    const i = key.indexOf('|');
    if (i < 0) continue;
    const folder = key.slice(0, i);
    const skin = key.slice(i + 1);
    byId[String(code)] = { folder, skin, code: String(code) };
  }
  return byId;
}

function getHeroSkinPool() {
  // hero → [skinName, ...] từ catalog, chỉ hero có skin
  const pool = [];
  for (const [folder, skins] of Object.entries(state.catalog || {})) {
    if (EXTRA_KEYS.has(folder)) continue;
    if (!Array.isArray(skins) || !skins.length) continue;
    pool.push({ folder, skins: skins.slice() });
  }
  return pool;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Xoá skin tướng khỏi cart, giữ Cam Xa / HD / Server */
function clearHeroSkinsFromCart() {
  for (const k of Object.keys(state.cart)) {
    if (!EXTRA_KEYS.has(k)) delete state.cart[k];
  }
}

/**
 * randomN: lấy N hero khác nhau, mỗi hero 1 skin ngẫu nhiên.
 */
function applyRandomSkins(n) {
  n = Math.max(1, Math.min(120, parseInt(n, 10) || 0));
  if (!n) { toast('Số lượng không hợp lệ', 'error'); return; }
  const pool = getHeroSkinPool();
  if (!pool.length) {
    toast('Catalog trống — chưa load được skin', 'error');
    return;
  }
  if (n > pool.length) {
    toast(`Chỉ có ${pool.length} tướng — random tối đa ${pool.length}`, 'error');
    n = pool.length;
  }
  shuffleInPlace(pool);
  const picked = pool.slice(0, n);
  clearHeroSkinsFromCart();
  for (const h of picked) {
    const skin = h.skins[Math.floor(Math.random() * h.skins.length)];
    state.cart[h.folder] = skin;
  }
  saveCart();
  updateBadge();
  syncExtraCardsState();
  haptic('success');
  toast(`🎲 Random ${picked.length} skin (1 / hero)`, 'success');
  // mở giỏ để xem
  switchTab('cart');
  switchExtrasPane('list');
}

function openRandomPicker() {
  switchExtrasPane('random');
}

function openIdListPicker() {
  switchExtrasPane('idlist');
  const prev = $('idListPreview');
  if (prev) prev.hidden = true;
}

/** Chuẩn hoá text nhập/dán: fullwidth digits, zero-width, ký tự lạ */
function normalizeIdText(text) {
  return String(text || '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[|；;、，]/g, ',')
    .replace(/[^\d,\s\n\r.\/\-]+/g, ' ');
}

/** Parse "15009, 11106\\n10620" hoặc dán hỗn hợp → codes */
function parseSkinIdList(text) {
  if (!text) return [];
  const cleaned = normalizeIdText(text);
  // Ưu tiên cụm 5 số (skin id chuẩn AOV); vẫn nhận 4–6
  const raw = cleaned.match(/\d{4,6}/g) || [];
  const codes = [];
  const seen = new Set();
  for (const t of raw) {
    let c = t;
    if (t.length === 6) c = t.slice(0, 5);
    if (seen.has(c)) continue;
    seen.add(c);
    codes.push(c);
  }
  return codes;
}

function updateIdListLive(text) {
  const live = $('idListLive');
  if (!live) return;
  const n = parseSkinIdList(text).length;
  live.innerHTML = `Đã nhận: <b>${n}</b> mã`;
}

/**
 * Map list ID → cart (1 hero 1 skin; ID sau ghi đè cùng hero).
 * Giữ extras.
 */
function applyIdListToCart(text, { replaceHeroes = true } = {}) {
  const codes = parseSkinIdList(text);
  if (!codes.length) {
    toast('Không thấy mã skin hợp lệ', 'error');
    return null;
  }
  const index = buildSkinIdIndex();
  const ok = [];
  const bad = [];
  const mapped = {}; // folder → { skin, code }

  for (const code of codes) {
    const hit = index[code];
    if (!hit) {
      bad.push(code);
      continue;
    }
    mapped[hit.folder] = { skin: hit.skin, code };
    ok.push({ code, folder: hit.folder, skin: hit.skin });
  }

  if (replaceHeroes) clearHeroSkinsFromCart();
  for (const [folder, info] of Object.entries(mapped)) {
    state.cart[folder] = info.skin;
  }
  saveCart();
  updateBadge();
  syncExtraCardsState();

  const prev = $('idListPreview');
  if (prev) {
    prev.hidden = false;
    const lines = [];
    lines.push(`<b class="ok">✓ Thêm ${ok.length} skin</b> · bỏ qua ${bad.length}`);
    ok.slice(0, 40).forEach((x) => {
      lines.push(`<span class="ok">${escapeHtml(x.code)}</span> → ${escapeHtml(x.folder)}`);
    });
    if (ok.length > 40) lines.push(`… +${ok.length - 40} nữa`);
    if (bad.length) {
      lines.push(`<b class="bad">✗ Không map được:</b> ${bad.slice(0, 20).map(escapeHtml).join(', ')}${bad.length > 20 ? '…' : ''}`);
    }
    prev.innerHTML = lines.join('<br>');
  }

  if (ok.length) {
    haptic('success');
    toast(`➕ ${ok.length} ID → giỏ${bad.length ? ` · ${bad.length} lỗi` : ''}`, 'success');
  } else {
    haptic('error');
    toast('Không map được ID nào (cần chạy build_hero_data?)', 'error');
  }
  return { ok, bad };
}

// wire random UI
const _randChips = $('randChips');
if (_randChips) {
  qsa('button[data-n]', _randChips).forEach((b) => {
    b.addEventListener('click', () => {
      const n = b.dataset.n;
      if ($('randInput')) $('randInput').value = n;
      applyRandomSkins(n);
    });
  });
}
if ($('randApply')) {
  $('randApply').addEventListener('click', () => {
    applyRandomSkins($('randInput')?.value || 30);
  });
}
if ($('idListApply')) {
  $('idListApply').addEventListener('click', (ev) => withBusy(ev.currentTarget, async () => {
    const el = $('idListInput');
    if (el) el.value = normalizeIdText(el.value);
    const res = applyIdListToCart(el?.value || '', { replaceHeroes: true });
    if (!res) { shake(ev.currentTarget); return; }
    // sau khi thêm → mở giỏ xem
    if (Object.keys(state.cart).some((k) => !EXTRA_KEYS.has(k))) switchTab('cart');
  }));
}
if ($('idListClear')) {
  $('idListClear').addEventListener('click', () => {
    if ($('idListInput')) $('idListInput').value = '';
    const prev = $('idListPreview');
    if (prev) { prev.hidden = true; prev.innerHTML = ''; }
    updateIdListLive('');
    haptic('light');
  });
}
if ($('idListPaste')) {
  $('idListPaste').addEventListener('click', async () => {
    const el = $('idListInput');
    if (!el) return;
    try {
      let text = '';
      if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      } else {
        // fallback: focus textarea để user Ctrl+V
        el.focus();
        toast('Dán bằng Ctrl+V / giữ để paste', 'success');
        return;
      }
      if (!text) { toast('Clipboard trống', 'error'); return; }
      const cur = el.value.trim();
      el.value = normalizeIdText(cur ? (cur + '\n' + text) : text);
      updateIdListLive(el.value);
      haptic('success');
      toast('Đã dán list ID', 'success');
    } catch {
      el.focus();
      toast('Không đọc được clipboard — hãy dán tay (Ctrl+V)', 'error');
    }
  });
}
// gõ / dán realtime
if ($('idListInput')) {
  const el = $('idListInput');
  el.addEventListener('input', () => updateIdListLive(el.value));
  el.addEventListener('paste', () => {
    // sau khi browser paste xong mới normalize
    setTimeout(() => {
      const start = el.selectionStart;
      el.value = normalizeIdText(el.value);
      updateIdListLive(el.value);
      try { el.setSelectionRange(start, start); } catch {}
    }, 0);
  });
  el.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      $('idListApply')?.click();
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   CART
   ═══════════════════════════════════════════════════════════════ */
function renderCart() {
  const list = $('cartList');
  const empty = $('cartEmpty');
  const summaryWrap = $('cartSummaryWrap');
  const entries = Object.entries(state.cart);
  list.innerHTML = '';

  if (!entries.length) {
    empty.hidden = false;
    summaryWrap.hidden = true;
    return;
  }
  empty.hidden = true;
  summaryWrap.hidden = false;

  // summary
  const heroCount = entries.filter(([k]) => !EXTRA_KEYS.has(k)).length;
  const extraCount = entries.length - heroCount;
  $('csVal').textContent = entries.length;
  $('csMeta').textContent = `${heroCount} Skin · ${extraCount} Bổ trợ`;
  $('csVipBadge').hidden = !state.isVip;

  list.innerHTML = entries.map(([k, v], i) => {
    const isExtra = EXTRA_KEYS.has(k);
    const cartIconHtml = isExtra
      ? `<div class="cart-icon ico-svg">${SVG_TOOL}</div>`
      : (heroIconImg(k, v, 'cart-avatar') || `<div class="cart-icon ico-svg">${SVG_HERO}</div>`);
    return `<div class="cart-item${isExtra ? ' extra' : ''}" style="animation-delay:${Math.min(i, 15) * 0.04}s">
      ${cartIconHtml}
      <div>
        <div class="cart-name">${escapeHtml(k)}</div>
        <div class="cart-source">${escapeHtml(v)}</div>
      </div>
      <button class="cart-del" data-key="${escapeAttr(k)}" aria-label="Xoá ${escapeAttr(k)}">✕</button>
    </div>`;
  }).join('');
}

/* Xoá 1 mục — có 'Hoàn tác' trong toast, khỏi phải đi chọn lại */
$('cartList').addEventListener('click', (e) => {
  const b = e.target.closest('.cart-del');
  if (!b) return;
  const key = b.dataset.key;
  const value = state.cart[key];
  if (value === undefined) return;
  const item = b.closest('.cart-item');
  item.classList.add('removing');
  haptic('warning');
  setTimeout(() => {
    delete state.cart[key];
    saveCart();
    updateBadge();
    renderCart();
    syncExtraCardsState();
    const t = toast(`Đã gỡ ${shorten(key, 18)} · chạm để hoàn tác`, 'warn', 4000);
    if (t) t.addEventListener('click', () => {
      state.cart[key] = value;
      saveCart();
      updateBadge();
      renderCart();
      syncExtraCardsState();
      haptic('success');
      toast(`↩️ Đã khôi phục ${shorten(key, 18)}`, 'success');
    }, { once: true });
  }, 300);
});

$('clearBtn').addEventListener('click', async () => {
  const n = Object.keys(state.cart).length;
  if (!n) { toast('Giỏ đang trống rồi', 'info'); return; }
  const ok = await askConfirm({
    title: 'Xoá toàn bộ giỏ?',
    message: `${n} mục đang chọn sẽ bị gỡ khỏi giỏ. Không thể hoàn tác.`,
    okText: 'Xoá hết',
    danger: true,
    icon: '🧹',
  });
  if (!ok) return;
  state.cart = {};
  clearCartStorage();
  apiSend({ type: 'clearcart' }, true);   // xoá luôn giỏ phía server (Test JSON) cho khớp
  updateBadge();
  renderCart();
  syncExtraCardsState();
  haptic('warning');
  toast('🧹 Đã xoá sạch giỏ', 'success');
});

$('runBtn').addEventListener('click', (ev) => {
  const btn = ev.currentTarget;
  const entries = Object.entries(state.cart);
  if (!entries.length) {
    toast('Giỏ trống — chọn skin hoặc bổ trợ trước nhé!', 'error');
    haptic('error');
    shake(btn);
    return;
  }

  // Cam Xa mod được riêng lẻ (không cần Skin) — tool_run.py đã hỗ trợ, gửi thẳng.

  haptic('success');
  if (state.settings.confetti) fireConfetti();

  withBusy(btn, async () => {
    if (API_READY) {
      // Luồng chính: gửi qua API, phản hồi hiện trong khung chat nổi
      showBotChat(false);
      const n = entries.length;
      botLog(`🚀 Chạy Mod cho ${n} mục:\n${entries.map(([k]) => '• ' + k).join('\n')}`, null, 'me');
      botLog('Đã gửi tới hệ thống · đang xử lý', null, 'sys');
      startPolling();
      _appendTyping();
      const ok = await apiSend({ type: 'chaymod', items: state.cart });
      if (!ok) {
        _removeTyping();
        botLog('Gửi thất bại — kiểm tra kết nối rồi bấm Chạy Mod lại.', null, 'sys-err');
        haptic('error');
      }
      return;
    }

    if (getTgUser()) {
      // Dự phòng: mở qua nút bàn phím → sendData
      const payload = { type: 'chaymod', items: state.cart, ts: Date.now(), vip: state.isVip, admin: state.isAdmin };
      try {
        tg.sendData(JSON.stringify(payload));
      } catch (e) {
        toast('Lỗi gửi: ' + e.message, 'error');
        haptic('error');
        return;
      }
      showRunOverlay(entries.length);
      return;
    }

    // Ngoài Telegram: deep link (chỉ hợp giỏ nhỏ)
    const cartJson = JSON.stringify(state.cart);
    const encoded = btoa(unescape(encodeURIComponent(cartJson))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const deepLink = 'https://t.me/MODSKINin1_bot?start=mod_' + encoded;
    toast('📤 Đang chuyển sang Telegram...', 'success');
    setTimeout(() => { window.open(deepLink, '_blank'); }, 500);
    showRunOverlayWeb(entries.length);
  });
});

function showRunOverlayWeb(itemCount) {
  $('runOverlay').hidden = false;
  $('runTitle').textContent = '🎉 Đã gửi yêu cầu!';
  $('runMsg').innerHTML = `Bot đang xử lý <b>${itemCount}</b> mục Mod.<br>📬 <b>Kiểm tra Telegram để nhận file ZIP!</b>`;
  $('runStatus').textContent = '✅ Đã chuyển sang Telegram';
  $('runStatus').classList.add('ok');
  $('runBar').style.width = '100%';
  $('runClose').textContent = 'Đi Telegram nhận file';
  $('runStay').textContent = 'Ở lại tiếp tục Mod';
}

function showRunOverlay(itemCount) {
  $('runOverlay').hidden = false;
  $('runTitle').textContent = '🎉 Đã gửi yêu cầu!';
  $('runMsg').innerHTML = API_READY
    ? `Bot đang xử lý <b>${itemCount}</b> mục Mod.<br>📥 Phản hồi & file sẽ hiện <b>ngay trong app</b>.`
    : `Bot đang xử lý <b>${itemCount}</b> mục Mod.<br>Quay lại chat để nhận file ZIP nhé!`;

  const steps = [
    { p: 15, t: '🔄 Đã nhận dữ liệu, đang khởi tạo...' },
    { p: 38, t: '🛠️ Đang ghép mã Mod...' },
    { p: 65, t: '📦 Đang đóng gói file ZIP...' },
    { p: 92, t: '📤 Sắp gửi file vào chat của bạn...' },
  ];
  let i = 0;
  const bar = $('runBar');
  const status = $('runStatus');
  bar.style.width = '5%';
  status.textContent = '⏳ Đang gửi yêu cầu...';
  status.classList.remove('ok');

  const tick = () => {
    if (i >= steps.length) {
      bar.style.width = '100%';
      status.textContent = '✅ Hoàn tất. Mở chat để xem file Mod!';
      status.classList.add('ok');
      return;
    }
    const s = steps[i++];
    bar.style.width = s.p + '%';
    status.textContent = s.t;
    setTimeout(tick, 1100 + Math.random() * 600);
  };
  setTimeout(tick, 450);
}

$('runClose').addEventListener('click', () => {
  haptic('light');
  $('runOverlay').hidden = true;
  state.cart = {};
  saveCart();
  updateBadge();
  renderCart();
  syncExtraCardsState();
  // Chế độ API: ở lại app để xem phản hồi bot, KHÔNG đóng Mini App
  if (!API_READY) setTimeout(() => tg?.close?.(), 180);
});

$('runStay').addEventListener('click', () => {
  haptic('light');
  $('runOverlay').hidden = true;
  toast('🛒 Tiếp tục chọn Mod!', 'success');
});

(() => {
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  on('chatMin',   () => { haptic('light'); minimizeChat(); });
  on('chatClose', () => { haptic('light'); closeChat(); });
  on('chatFab',   () => { haptic('light'); showBotChat(false); });
  on('chatNewPill', () => { haptic('light'); _scrollChatEnd(true); });
  on('chatMax',   () => {
    haptic('light');
    const p = $('botPanel');
    if (!p) return;
    const max = p.classList.toggle('maximized');
    // rời chế độ phóng to → bỏ toạ độ do kéo tay để về góc mặc định
    if (!max) { p.style.left = ''; p.style.top = ''; p.style.right = ''; p.style.bottom = ''; }
    $('chatMax').textContent = max ? '⤡' : '⤢';
    $('chatMax').title = max ? 'Thu gọn' : 'Phóng to';
    requestAnimationFrame(() => _scrollChatEnd(false));
  });

  // user cuộn về đáy → tự ẩn pill "tin mới"
  const box = $('botLog');
  if (box) {
    let raf = 0;
    box.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (_isChatNearBottom()) _toggleNewPill(false);
      });
    }, { passive: true });
  }

  _initChatDrag();
})();

/* ═══════════════════════════════════════════════════════════════
   ADMIN ACTIONS
   ═══════════════════════════════════════════════════════════════ */
function bindAdminButtons() {
  qsa('.admin-card button[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => onAdminClick(btn));
  });
}

async function onAdminClick(btn) {
  const act = btn.dataset.act;
  const confirmMsg = btn.dataset.confirm;
  if (!getTgUser()) { showWebLoginGate(); toast('Cần mở qua Telegram!', 'error'); return; }
  if (!state.isAdmin) { toast('Bạn không phải Admin!', 'error'); haptic('error'); shake(btn); return; }
  if (confirmMsg) {
    const ok = await askConfirm({
      title: 'Xác nhận thao tác',
      message: confirmMsg,
      okText: 'Thực hiện',
      danger: btn.classList.contains('btn-danger'),
    });
    if (!ok) return;
  }

  const args = {};
  let valid = true;

  switch (act) {
    case 'vipmember':
      args.user_id = $('adm_vip_uid').value.trim();
      args.days = $('adm_vip_days').value.trim();
      if (!args.user_id || !args.days) { toast('Điền đủ User ID + ngày', 'error'); valid = false; }
      break;
    case 'congvipall':
      args.days = $('adm_all_days').value.trim();
      if (!args.days) { toast('Nhập số ngày', 'error'); valid = false; }
      break;
    case 'resetvip':
      args.user_id = $('adm_reset_uid').value.trim();
      if (!args.user_id) { toast('Nhập User ID', 'error'); valid = false; }
      break;
    case 'ban':
      args.user_id = $('adm_ban_uid').value.trim();
      if (!args.user_id) { toast('Nhập User ID', 'error'); valid = false; }
      break;
    case 'unban':
      args.user_id = $('adm_unban_uid').value.trim();
      if (!args.user_id) { toast('Nhập User ID', 'error'); valid = false; }
      break;
    case 'guiall':
      args.text = $('adm_broadcast').value.trim();
      if (!args.text) { toast('Nhập nội dung', 'error'); valid = false; }
      break;
    case 'resetvipall':
    case 'tatkey':
    case 'batkey':
    case 'statuskey':
    case 'listvip':
    case 'capnhat':
      break;
  }

  if (!valid) { haptic('error'); shake(btn.closest('.admin-card') || btn); return; }

  haptic('success');
  await withBusy(btn, async () => {
    if (API_READY) {
      showBotChat(false);
      botLog('⚙️ Lệnh quản trị: ' + act, null, 'me');
      botLog('Đang thực thi', null, 'sys');
      startPolling();
      _appendTyping();
      const ok = await apiSend({ type: 'admin', action: act, args });
      if (!ok) { _removeTyping(); botLog('Không gửi được lệnh — thử lại sau.', null, 'sys-err'); }
      return ok;
    }
    const payload = { type: 'admin', action: act, args, ts: Date.now() };
    try {
      tg.sendData(JSON.stringify(payload));
    } catch (e) {
      toast('Lỗi gửi: ' + e.message, 'error');
      return false;
    }
    toast('📤 Đã gửi → mở chat bot để xem kết quả', 'success');
    return true;
  });

  flashOk(btn.closest('.admin-card') || btn);
  // clear inputs after send
  if (['vipmember','congvipall','resetvip','ban','unban','guiall'].includes(act)) {
    ['adm_vip_uid','adm_vip_days','adm_all_days','adm_reset_uid','adm_ban_uid','adm_unban_uid','adm_broadcast']
      .forEach((id) => { const el = $(id); if (el) el.value = ''; });
  }
}

/* ═══════════════════════════════════════════════════════════════
   MORE / SETTINGS
   ═══════════════════════════════════════════════════════════════ */
function refreshSettingsLabels() {
  $('hapticVal').textContent = state.settings.haptic ? 'BẬT' : 'TẮT';
  $('confettiVal').textContent = state.settings.confetti ? 'BẬT' : 'TẮT';
  const pv = $('perfVal');
  if (pv) pv.textContent = state.settings.perfLite ? 'BẬT' : 'TẮT';
}

qsa('.set-card').forEach((card) => {
  card.addEventListener('click', async () => {
    const a = card.dataset.action;
    haptic('light');
    if (a === 'checkvip') {
      if (API_READY) {
        // Hỏi bot để có kết quả chính xác, hiện trong khung chat
        showBotChat(false);
        botLog('💎 Kiểm tra hạn VIP', null, 'me');
        startPolling();
        _appendTyping();
        apiSend({ type: 'checkvip' }, true).then((ok) => {
          if (ok) return;
          _removeTyping();
          if (state.isVip) botLog(`💎 Bạn còn ${state.vipDays} ngày VIP.`, null, 'bot');
          else if (state.isAdmin) botLog('👑 Bạn là ADMIN — quyền tối cao.', null, 'bot');
          else botLog('❌ Bạn chưa có VIP. Liên hệ Admin để mua nhé.', null, 'bot');
        });
      } else if (state.isVip) {
        toast(`💎 Bạn còn ${state.vipDays} ngày VIP`, 'success');
      } else if (state.isAdmin) {
        toast('👑 Bạn là ADMIN — quyền tối cao', 'success');
      } else {
        toast('❌ Bạn chưa có VIP. Liên hệ Admin để mua.', 'warn');
      }
    } else if (a === 'myid') {
      const id = getTgUser()?.id;
      if (!id) return toast('Không lấy được ID — hãy mở trong Telegram', 'error');
      copyText(String(id)).then((ok) =>
        toast(ok ? `📋 Đã copy ID: ${id}` : `🆔 ID của bạn: ${id}`, 'success'));
    } else if (a === 'haptic') {
      state.settings.haptic = !state.settings.haptic;
      saveSettings();
      refreshSettingsLabels();
      toast(`📳 Rung ${state.settings.haptic ? 'BẬT' : 'TẮT'}`, 'success');
    } else if (a === 'confetti') {
      state.settings.confetti = !state.settings.confetti;
      saveSettings();
      refreshSettingsLabels();
      toast(`🎉 Pháo bông ${state.settings.confetti ? 'BẬT' : 'TẮT'}`, 'success');
    } else if (a === 'perflite') {
      state.settings.perfLite = !state.settings.perfLite;
      saveSettings();
      applyPerfMode();
      refreshSettingsLabels();
      toast(state.settings.perfLite
        ? '⚡ Hiệu ứng nhẹ BẬT — ưu tiên mượt'
        : '✨ Hiệu ứng nhẹ TẮT — full liquid glass', 'success');
    } else if (a === 'contact') {
      try { tg?.openTelegramLink?.(ADMIN_CONTACT); } catch {}
      try { tg?.openLink?.(ADMIN_CONTACT); } catch {}
    } else if (a === 'donate') {
      copyText('109874557013').then((ok) =>
        toast(ok ? '📋 Đã copy STK: 109874557013 — VIETINBANK' : '🏦 STK: 109874557013 — VIETINBANK', 'success'));
    } else if (a === 'reset') {
      const ok = await askConfirm({
        title: 'Đặt lại ứng dụng?',
        message: 'Xoá cache, giỏ hàng và cài đặt. Kết nối bot vẫn được giữ lại.',
        okText: 'Đặt lại',
        danger: true,
        icon: '♻️',
      });
      if (!ok) return;
      try { localStorage.clear(); } catch {}
      clearCartStorage();                       // xoá luôn giỏ trên Telegram CloudStorage
      apiSend({ type: 'clearcart' }, true);     // xoá luôn giỏ phía server (Test JSON)
      if (API_BASE) { try { localStorage.setItem('bannei_api', API_BASE); } catch {} }  // giữ kết nối bot
      state.cart = {};
      state.settings = defaultSettings();
      saveSettings();
      applyPerfMode();
      updateBadge();
      renderCart();
      syncExtraCardsState();
      refreshSettingsLabels();
      toast('♻️ Đã reset sạch (giỏ + cache)', 'success');
    } else if (a === 'about') {
      toast('BANNEI MOD LQ · Liquid Glass 7.0', 'info');
    }
  });
});

/* Máy yếu → tự bật hiệu ứng nhẹ ngay lần mở đầu (user vẫn tắt được trong tab Khác) */
function guessLowEndDevice() {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    const mem = navigator.deviceMemory;
    if (typeof mem === 'number' && mem > 0 && mem <= 3) return true;
    const cpu = navigator.hardwareConcurrency;
    if (typeof cpu === 'number' && cpu > 0 && cpu <= 4) return true;
  } catch {}
  return false;
}

function defaultSettings() {
  return { haptic: true, confetti: true, perfLite: guessLowEndDevice() };
}

function applyPerfMode() {
  document.body.classList.toggle('perf-lite', !!state.settings.perfLite);
}
function loadSettings() {
  try {
    const v = localStorage.getItem('bannei_settings');
    return v ? { ...defaultSettings(), ...JSON.parse(v) } : defaultSettings();
  } catch { return defaultSettings(); }
}
function saveSettings() {
  try { localStorage.setItem('bannei_settings', JSON.stringify(state.settings)); } catch {}
}
async function copyText(t) {
  // 1) Clipboard API (chỉ chạy trong secure context)
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {}
  // 2) Fallback execCommand (Telegram WebView cũ)
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/* ═══════════════════════════════════════════════════════════════
   UTIL
   ═══════════════════════════════════════════════════════════════ */
function saveCart() {
  const raw = JSON.stringify(state.cart);
  try { localStorage.setItem('bannei_cart', raw); } catch {}
  // Sync to Telegram CloudStorage (cross-device, cross-session)
  if (tg?.CloudStorage) {
    try { tg.CloudStorage.setItem('bannei_cart', raw); } catch {}
  }
}
// Xoá SẠCH giỏ ở cả localStorage lẫn Telegram CloudStorage (chống giỏ "sống lại")
function clearCartStorage() {
  try { localStorage.removeItem('bannei_cart'); } catch {}
  if (tg?.CloudStorage) {
    try { tg.CloudStorage.removeItem('bannei_cart', () => {}); } catch {}
  }
}
// Nhận tín hiệu /cleandanhsach từ chat (qua poll) → xoá giỏ local cho khớp server.
function clearCartFromServer() {
  const had = Object.keys(state.cart).length;
  state.cart = {};
  clearCartStorage();
  updateBadge();
  renderCart();
  syncExtraCardsState();
  if (had) toast('🧹 Giỏ đã được xoá (đồng bộ /cleandanhsach)', 'success');
}
async function loadCartLocal() {
  // 1) CloudStorage (Telegram cloud, cross-device)
  if (tg?.CloudStorage) {
    try {
      const raw = await promisifyCS(tg.CloudStorage.getItem, 'bannei_cart');
      if (raw) { state.cart = JSON.parse(raw) || {}; updateBadge(); syncExtraCardsState(); return; }
    } catch {}
  }
  // 2) localStorage fallback
  try {
    const v = localStorage.getItem('bannei_cart');
    if (v) { state.cart = JSON.parse(v) || {}; updateBadge(); syncExtraCardsState(); }
  } catch {}
}
function promisifyCS(fn, key) {
  return new Promise((resolve) => {
    fn.call(tg.CloudStorage, key, (err, val) => {
      resolve(err ? null : val);
    });
  });
}
function updateBadge() {
  const n = Object.keys(state.cart).length;
  const el = $('cartBadge');
  el.textContent = n ? n : '';
  if (n) el.removeAttribute('data-zero'); else el.setAttribute('data-zero', '');
  $('stCart').textContent = n;
}
/* ── TOAST STACK ──
   Xếp chồng tối đa 3 tin, chạm để tắt sớm, có thanh đếm ngược.
   Emoji đứng đầu message được tách ra làm icon (giữ nguyên call site cũ). */
const TOAST_MAX = 3;
const TOAST_FALLBACK_ICON = { success: '✓', error: '✕', warn: '!', info: 'i', '': '•' };
let _leadEmojiRe = null;
try {
  _leadEmojiRe = new RegExp('^((?:\\p{Extended_Pictographic}|[\\u2190-\\u21FF\\u2600-\\u27BF])[\\uFE0F\\u200D\\p{Extended_Pictographic}]*)\\s*', 'u');
} catch { _leadEmojiRe = null; }

function splitToastIcon(msg, type) {
  const s = String(msg);
  if (_leadEmojiRe) {
    const m = _leadEmojiRe.exec(s);
    if (m && s.length > m[0].length) return { icon: m[1], text: s.slice(m[0].length) };
  }
  return { icon: TOAST_FALLBACK_ICON[type] ?? TOAST_FALLBACK_ICON[''], text: s };
}

function dismissToast(el) {
  if (!el || el.dataset.out === '1') return;
  el.dataset.out = '1';
  clearTimeout(el._t);
  el.classList.add('out');
  setTimeout(() => el.remove(), 220);
}

function toast(msg, type = '', ms) {
  const stack = $('toastStack');
  if (!stack) return;
  const dur = ms || (type === 'error' ? 3600 : 2400);
  const { icon, text } = splitToastIcon(msg, type);

  const el = document.createElement('div');
  el.className = 'toast-item ' + type;
  el.innerHTML =
    `<span class="toast-ic">${escapeHtml(icon)}</span>` +
    `<span class="toast-tx">${escapeHtml(text)}</span>` +
    `<span class="toast-bar" style="animation-duration:${dur}ms"></span>`;
  el.addEventListener('click', () => dismissToast(el));
  stack.appendChild(el);

  // giữ stack gọn: tin cũ nhất rời đi trước
  while (stack.children.length > TOAST_MAX) dismissToast(stack.firstElementChild);

  el._t = setTimeout(() => dismissToast(el), dur);
  return el;
}

/* ── MODAL XÁC NHẬN (thay confirm() của trình duyệt) ── */
function askConfirm(opts = {}) {
  const {
    title = 'Xác nhận',
    message = '',
    okText = 'Đồng ý',
    cancelText = 'Huỷ',
    danger = false,
    icon = danger ? '⚠️' : '❓',
  } = opts;

  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal-card ${danger ? 'danger' : 'ask'}" role="dialog" aria-modal="true">
        <div class="modal-ic">${escapeHtml(icon)}</div>
        <h3>${escapeHtml(title)}</h3>
        ${message ? `<p>${escapeHtml(message)}</p>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn-ghost" data-mc="0">${escapeHtml(cancelText)}</button>
          <button type="button" class="${danger ? 'btn-danger' : 'btn-primary'}" data-mc="1">${escapeHtml(okText)}</button>
        </div>
      </div>`;

    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      back.classList.add('out');
      setTimeout(() => back.remove(), 180);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };

    back.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mc]');
      if (b) { haptic(b.dataset.mc === '1' ? 'warning' : 'light'); return close(b.dataset.mc === '1'); }
      if (e.target === back) close(false);   // chạm nền = huỷ
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(back);
    back.querySelector('[data-mc="1"]')?.focus();
  });
}

/* ── TRẠNG THÁI NÚT: khoá + spinner trong lúc chờ ── */
async function withBusy(btn, fn) {
  if (!btn) return fn();
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  btn.classList.add('is-loading');
  try {
    return await fn();
  } finally {
    btn.classList.remove('is-loading');
    delete btn.dataset.busy;
  }
}

/* phản hồi thị giác nhanh cho 1 phần tử */
function flashOk(el) {
  if (!el) return;
  el.classList.remove('flash-ok');
  void el.offsetWidth;
  el.classList.add('flash-ok');
  setTimeout(() => el.classList.remove('flash-ok'), 520);
}
function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
}

/* thanh tiến trình mảnh trên đỉnh cho tác vụ nền */
let _progressDepth = 0;
function progressStart() {
  _progressDepth++;
  $('topProgress')?.classList.add('on');
}
function progressEnd() {
  _progressDepth = Math.max(0, _progressDepth - 1);
  if (!_progressDepth) $('topProgress')?.classList.remove('on');
}
function haptic(kind = 'light') {
  if (!state.settings.haptic) return;
  try {
    const h = tg?.HapticFeedback;
    if (!h) return;
    if (['success', 'warning', 'error'].includes(kind)) h.notificationOccurred(kind);
    else h.impactOccurred(kind);
  } catch {}
}
function escapeHtml(s){
  return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/'/g, '&#39;'); }
function shorten(s, n){ return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const re = new RegExp('(' + q.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + ')', 'ig');
  return safe.replace(re, '<mark style="background:rgba(108,140,255,.3);color:#fff;border-radius:3px;padding:0 2px">$1</mark>');
}

function fireConfetti() {
  const wrap = $('confetti');
  wrap.innerHTML = '';
  const colors = ['#6c8cff','#b16cff','#ffd25f','#ff6b9a','#34d399','#5ed5ff'];
  for (let i = 0; i < 72; i++) {
    const s = document.createElement('span');
    s.style.left = Math.random() * 100 + '%';
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = (Math.random() * 0.5) + 's';
    s.style.animationDuration = (1.4 + Math.random() * 1.3) + 's';
    s.style.transform = `rotate(${Math.random() * 360}deg)`;
    wrap.appendChild(s);
  }
  setTimeout(() => { wrap.innerHTML = ''; }, 2500);
}

/* ripple on buttons */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-primary, .btn-ghost, .btn-danger, .alpha-cell, .hero-cell, .zoom-cell');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'ripple-fx';
  const size = Math.max(r.width, r.height);
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - r.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - r.top - size / 2) + 'px';
  const pos = getComputedStyle(btn).position;
  if (pos === 'static') btn.style.position = 'relative';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}, true);

/* theme detection */
function applyTheme() {
  const scheme = tg?.colorScheme || 'dark';
  const light = scheme === 'light';
  document.body.classList.toggle('tg-light', light);
  // thanh trạng thái điện thoại khớp nền app
  try { tg?.setBackgroundColor?.(light ? '#f4f6fb' : '#07080d'); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#f4f6fb' : '#07080d');
}
tg?.onEvent?.('themeChanged', applyTheme);

/* ═══════════════════════════════════════════════════════════════
   VIEWPORT · BÀN PHÍM ẢO
   ═══════════════════════════════════════════════════════════════ */
// Telegram co/giãn viewport khi cuộn — dùng chiều cao thật thay cho 100vh
function applyViewport() {
  const h = tg?.viewportStableHeight || tg?.viewportHeight;
  if (h > 0) document.documentElement.style.setProperty('--vh', h + 'px');
}
tg?.onEvent?.('viewportChanged', applyViewport);
window.addEventListener('orientationchange', () => setTimeout(applyViewport, 220));

// Bàn phím ảo mở → tạm ẩn tab bar để không che ô nhập
const _isTextField = (el) => !!el && typeof el.matches === 'function' && el.matches('input, textarea');
document.addEventListener('focusin', (e) => {
  if (_isTextField(e.target)) document.body.classList.add('kb-open');
});
document.addEventListener('focusout', (e) => {
  if (!_isTextField(e.target)) return;
  setTimeout(() => {
    if (!_isTextField(document.activeElement)) document.body.classList.remove('kb-open');
  }, 80);
});

/* ═══════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════ */
(async function boot() {
  applyTheme();
  applyPerfMode();
  applyViewport();
  loginTelegram();
  await loadCartLocal();
  updateBadge();
  syncExtraCardsState();
  bindAdminButtons();
  refreshSettingsLabels();

  // 3 request chạy song song, nhưng bảng chữ cái vẽ ngay khi catalog về —
  // icon/mã skin đến sau, đã có HERO_PREFIX tĩnh làm dự phòng
  const pIcons = loadHeroIcons();
  const pCodes = loadSkinCodes();
  await loadCatalog();
  await Promise.all([pIcons, pCodes]);

  checkApiConnection();
  drainBaseline();

  // sync cart from Telegram bot when inside Telegram
  if (getTgUser()) {
    try {
      tg.sendData(JSON.stringify({ type: 'synccart', ts: Date.now() }));
    } catch (e) {
      // silent — synccart will show reply in chat
    }
  }
})();

/* Telegram BackButton — auto handle */
function refreshBack() {
  if (!tg?.BackButton) return;
  const heroesActive = $('page-heroes').classList.contains('active');
  const extrasActive = $('page-extras').classList.contains('active');
  const onSubHeroes = heroesActive && (!$('heroListPane').hidden || !$('skinListPane').hidden);
  const onSubExtras = extrasActive && (
    !$('zoomPicker').hidden ||
    !$('serverPicker').hidden ||
    !!($('randomPicker') && !$('randomPicker').hidden) ||
    !!($('idListPicker') && !$('idListPicker').hidden)
  );
  if (onSubHeroes || onSubExtras) tg.BackButton.show();
  else tg.BackButton.hide();
}

/* Gộp nhiều lần gọi trong cùng 1 khung hình — trước đây observer quét
   toàn bộ body nên mỗi lần đổi class (ripple, chọn skin, tin chat…)
   đều chạy lại refreshBack. */
let _backRaf = 0;
function scheduleBack() {
  if (_backRaf) return;
  _backRaf = requestAnimationFrame(() => { _backRaf = 0; refreshBack(); });
}
tg?.BackButton?.onClick?.(() => {
  if (!$('skinListPane').hidden) { switchHeroesPane('list'); haptic('light'); refreshBack(); return; }
  if (!$('heroListPane').hidden) { switchHeroesPane('alpha'); haptic('light'); refreshBack(); return; }
  if (
    !$('zoomPicker').hidden ||
    !$('serverPicker').hidden ||
    ($('randomPicker') && !$('randomPicker').hidden) ||
    ($('idListPicker') && !$('idListPicker').hidden)
  ) {
    switchExtrasPane('list');
    haptic('light');
    refreshBack();
    return;
  }
  refreshBack();
});

// Chỉ theo dõi việc ẩn/hiện các pane con — không quét cả body nữa
(() => {
  const obs = new MutationObserver(scheduleBack);
  ['page-heroes', 'page-extras'].forEach((id) => {
    const el = $(id);
    if (el) obs.observe(el, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  });
  scheduleBack();
})();
