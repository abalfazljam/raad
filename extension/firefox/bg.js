'use strict';
/* Raad DM v1.3 (for app v1.7) — extension background
 * Chrome MV3 service worker / Firefox MV2 event page — ONE shared codebase.
 *
 * v1.7 DOWNLOAD-RELIABILITY fixes (why v1.6 could drop downloads):
 *  1. SEND-FIRST, CANCEL-AFTER — v1.6 cancelled the browser download BEFORE
 *     handing it to Raad. If that handoff failed for any reason, the user's
 *     download was silently destroyed (browser copy cancelled, Raad never got
 *     it). Now the item is sent to Raad first, and the browser copy is
 *     cancelled ONLY after Raad accepts it. If Raad refuses → the normal
 *     browser download simply continues.
 *  2. COMPLETED GUARD — a browser download that already finished is left
 *     alone (no duplicate in Raad).
 *  3. COOKIES ON BY DEFAULT — IDM sends the browser session with every
 *     download; authenticated links (login-required) failed without it.
 *  4. PERSIAN-FIRST UI — popup and context menus default to Persian.
 *
 * v1.6 connection fixes (kept):
 *  auto-discovery scan 27500..27520, auto /pair, self-healing sends,
 *  honest status badge, unified browser/chrome promise wrapper.              */

const api = (typeof browser !== 'undefined' && browser && browser.runtime) ? browser : chrome;

const DEFAULTS = {
  port: 27500,            /* preferred port (first candidate)              */
  token: '',              /* filled automatically by /pair                 */
  enabled: true,
  cookies: true,          /* v1.7: ON like IDM — auth'd links need session */
  notify: true,
  lang: 'fa',             /* v1.7: Persian-first UI (popup + menus)        */
  disabledSites: [],
  lastGoodPort: 0,        /* remembered fast-path                          */
  lastSeenAt: 0           /* ms timestamp of last successful ping          */
};
const PORT_SPAN = 21;            /* 27500 .. 27520                        */
const SCAN_TIMEOUT = 700;        /* per-port ping timeout (ms)            */
const SEND_TIMEOUT = 6000;       /* /add timeout (ms)                     */
const FRESH_MS = 30000;          /* treat connection as fresh for 30 s    */

const cfg = {
  cache: { ...DEFAULTS },
  async load() {
    const st = await api.storage.local.get(DEFAULTS);
    this.cache = { ...DEFAULTS, ...st };
    updateBadge();
    return this.cache;
  },
  async save(patch) {
    this.cache = { ...this.cache, ...patch };
    await api.storage.local.set(patch);
    updateBadge();
    try {
      const p = api.runtime.sendMessage({ type: 'raad-config-changed', config: this.cache });
      if (p && typeof p.catch === 'function') p.catch(() => { });
    } catch { }
  }
};
api.storage.onChanged && api.storage.onChanged.addListener(() => { cfg.load(); });

/* ---------- tiny cross-browser helpers ---------- */
async function fetchJSON(url, opts = {}, timeoutMs = SCAN_TIMEOUT) {
  const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ac ? setTimeout(() => { try { ac.abort(); } catch { } }, timeoutMs) : null;
  try {
    const r = await fetch(url, { ...opts, signal: ac ? ac.signal : undefined });
    const j = await r.json();
    return { status: r.status, json: j };
  } finally { if (timer) clearTimeout(timer); }
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const isDisabled = (u) => (cfg.cache.disabledSites || []).includes(hostOf(u));

/* ---------- badge ---------- */
function updateBadge() {
  try {
    const off = cfg.cache.enabled === false;
    const connected = off ? false : (Date.now() - (cfg.cache.lastSeenAt || 0)) < FRESH_MS;
    const ACT = api.action || api.browserAction;
    if (!ACT) return;
    ACT.setBadgeText({ text: off ? 'OFF' : (connected ? '✓' : '!') });
    ACT.setBadgeBackgroundColor({ color: off ? '#64748b' : (connected ? '#10b981' : '#f59e0b') });
  } catch { }
}

/* ---------- bridge calls ---------- */
async function pingPort(port, ms = SCAN_TIMEOUT) {
  try {
    const { status, json } = await fetchJSON(`http://127.0.0.1:${port}/ping`, {}, ms);
    if (status === 200 && json && json.ok && json.name === 'raad') {
      return { ok: true, port, auth: !!json.auth, version: json.version };
    }
  } catch { }
  return { ok: false };
}

/* Scan 27500..27520 in parallel — loopback pings are cheap. */
async function scanPorts() {
  const base = cfg.cache.port || DEFAULTS.port;
  const ports = [];
  if (cfg.cache.lastGoodPort) ports.push(cfg.cache.lastGoodPort);
  ports.push(base);
  for (let i = 0; i < PORT_SPAN; i++) {
    const p = base + i;
    if (!ports.includes(p)) ports.push(p);
  }
  const results = await Promise.all(ports.map(p => pingPort(p)));
  const hit = results.find(r => r.ok);
  return hit || { ok: false };
}

/* Ask the app for the current {port, token} — extension Origin required. */
async function pair(port) {
  try {
    const { status, json } = await fetchJSON(`http://127.0.0.1:${port}/pair`, {}, 2500);
    if (status === 200 && json && json.ok && typeof json.port === 'number') {
      await cfg.save({
        port: json.port, token: json.token || '',
        lastGoodPort: json.port, lastSeenAt: Date.now()
      });
      updateBadge();
      return { ok: true, port: json.port, paired: true };
    }
  } catch { }
  return { ok: false };
}

/* Full connect: ping last-known → pair → scan → pair. */
async function connect() {
  if (!cfg.cache.enabled) return { ok: false, disabled: true };
  /* fast path: remembered port */
  const lg = cfg.cache.lastGoodPort;
  if (lg) {
    const p = await pingPort(lg, 900);
    if (p.ok) {
      await cfg.save({ lastSeenAt: Date.now(), port: lg });
      updateBadge();
      /* refresh the token quietly in case it changed in the app */
      await pair(lg);
      return { ok: true, port: lg };
    }
  }
  const found = await scanPorts();
  if (!found.ok) {
    await cfg.save({ lastGoodPort: 0, lastSeenAt: 0 });
    updateBadge();
    return { ok: false };
  }
  const pr = await pair(found.port);
  if (pr.ok) return pr;
  /* reachable but pairing refused → still usable if token already matches */
  await cfg.save({ port: found.port, lastGoodPort: found.port, lastSeenAt: Date.now() });
  updateBadge();
  return { ok: true, port: found.port };
}

/* True when the last ping is recent enough; otherwise (re)connect. */
async function ensureReady(force = false) {
  if (!cfg.cache.enabled) return false;
  const fresh = (Date.now() - (cfg.cache.lastSeenAt || 0)) < FRESH_MS && cfg.cache.lastGoodPort;
  if (fresh && !force) return true;
  const r = await connect();
  return !!r.ok;
}

async function sendToRaad(msg) {
  if (!cfg.cache.enabled) return { ok: false, error: 'disabled' };
  const ready = await ensureReady();
  const attempt = async () => {
    const { port, token, notify, cookies } = cfg.cache;
    const body = {
      url: msg.url,
      referrer: msg.pageUrl || '',
      filename: msg.filename || '',
      cookies: cookies && msg.cookies ? msg.cookies : ''
    };
    const { status, json } = await fetchJSON(`http://127.0.0.1:${port}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-raad-token': token || '' },
      body: JSON.stringify(body)
    }, SEND_TIMEOUT);
    if (status === 200 && json && json.ok) {
      await cfg.save({ lastSeenAt: Date.now() });
      updateBadge();
      if (notify) {
        try {
          const fa = (cfg.cache.lang || 'fa') !== 'en';
          api.notifications.create({
            type: 'basic', iconUrl: 'icons/icon48.png',
            title: 'Raad ⚡',
            message: (fa ? 'به رعد ارسال شد ▸ ' : 'Sent to Raad ▸ ') + (body.filename || msg.url.slice(0, 60))
          });
        } catch { }
      }
      return { ok: true };
    }
    if (status === 401) return { ok: false, error: 'auth', retry: 'pair' };
    return { ok: false, error: (json && json.error) || ('HTTP ' + status) };
  };

  try {
    let r = await attempt();
    /* token changed in the app → re-pair once and retry (v1.6 self-heal)   */
    if (!r.ok && r.retry === 'pair') {
      const pr = await pair(cfg.cache.lastGoodPort || cfg.cache.port);
      if (pr.ok) r = await attempt();
    }
    return r;
  } catch {
    /* unreachable → rediscover once, then retry (v1.6 self-heal)           */
    const c = await connect();
    if (!c.ok) return { ok: false, error: 'Raad is not running' };
    try { return await attempt(); }
    catch { return { ok: false, error: 'Raad is not running' }; }
  }
}

/* ---------- browser-download interception (IDM style) ----------
 * v1.7 ORDER: send to Raad FIRST; cancel the browser copy only AFTER Raad
 * accepts the item. If Raad is unreachable or refuses, the ordinary browser
 * download continues untouched — the user can never lose a file.           */
if (api.downloads && api.downloads.onCreated) {
  api.downloads.onCreated.addListener(async (item) => {
    try {
      if (!item || !item.url || cfg.cache.enabled === false) return;
      if (isDisabled(item.finalUrl || item.url) || isDisabled(item.referrer || '')) return;
      /* browser already finished the file → leave it alone (no duplicate)  */
      if (item.state === 'complete') return;

      /* Only hijack when Raad is actually reachable — otherwise the browser
       * download continues untouched (graceful fallback).                   */
      const ready = await ensureReady();
      if (!ready) return;

      let cookies = '';
      if (cfg.cache.cookies) {
        try {
          const jar = await api.cookies.getAll({ url: item.finalUrl || item.url });
          cookies = (jar || []).map(c => `${c.name}=${c.value}`).join('; ');
        } catch { }
      }

      const sent = await sendToRaad({
        url: item.finalUrl || item.url,
        pageUrl: item.referrer || '',
        filename: (item.filename || '').split(/[\\/]/).pop() || '',
        cookies
      });
      if (!sent || !sent.ok) return;   /* Raad refused → browser keeps it   */

      /* Raad accepted → stop the browser copy so we never double-download.
       * If it already completed meanwhile, just drop it from the shelf.    */
      try { await api.downloads.cancel(item.id); } catch { }
      try { await api.downloads.erase({ id: item.id }); } catch { }
    } catch { }
  });
}

/* ---------- messaging ---------- */
async function handle(msg) {
  switch (msg && msg.type) {
    case 'raad-add': return sendToRaad(msg);
    case 'raad-ping': {
      const ok = await pingPort(cfg.cache.lastGoodPort || cfg.cache.port, 1600);
      if (ok.ok) { await cfg.save({ lastSeenAt: Date.now(), lastGoodPort: ok.port, port: ok.port }); updateBadge(); return { ok: true, port: ok.port }; }
      const c = await connect();
      return { ok: !!c.ok, port: c.port || 0 };
    }
    case 'raad-connect': return connect();
    case 'raad-get-config': return { ...cfg.cache };
    case 'raad-set-config': {
      await cfg.save(msg.patch || {});
      if (msg.patch && (typeof msg.patch.port === 'number')) {
        await cfg.save({ lastGoodPort: 0 });
        connect();
      }
      return { ...cfg.cache };
    }
    case 'raad-get-cookies': return msg.cookies;
    case 'raad-set-config': {
      await cfg.save(msg.patch || {});
      if (msg.patch && (typeof msg.patch.port === 'number')) {
        await cfg.save({ lastGoodPort: 0 });
        connect();
      }
      if (msg.patch && (msg.patch.lang || msg.patch.enabled !== undefined)) buildMenus();
      return { ...cfg.cache };
    }
    default: return { ok: false };
  }
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const p = handle(msg).catch(e => ({ ok: false, error: String(e && e.message || e) }));
  if (api === (typeof browser !== 'undefined' ? browser : null)) {
    return p;                                   /* Firefox: promise response */
  }
  p.then(sendResponse, () => sendResponse({ ok: false }));
  return true;                                  /* Chrome: keep channel open */
});

/* ---------- context menus (Persian-first, rebuildable) ---------- */
function menuTitles() {
  const fa = (cfg.cache.lang || 'fa') !== 'en';
  return {
    root: 'رعد | Raad',
    dl: fa ? '⬇ دانلود با رعد' : '⬇ Download with Raad',
    copy: fa ? 'کپی لینک' : 'Copy link to clipboard',
    toggle: fa ? (cfg.cache.enabled === false ? '▶ فعال‌سازی شنود دانلود' : '⏸ غیرفعال‌سازی شنود دانلود')
               : (cfg.cache.enabled === false ? '▶ Enable Raad interception' : '⏸ Disable Raad interception')
  };
}
function buildMenus() {
  try {
    api.contextMenus.removeAll(() => {
      const mt = menuTitles();
      api.contextMenus.create({ id: 'raad-root', title: mt.root, contexts: ['link'] });
      api.contextMenus.create({ id: 'raad-dl', parentId: 'raad-root', title: mt.dl, contexts: ['link'] });
      api.contextMenus.create({ id: 'raad-copy', parentId: 'raad-root', title: mt.copy, contexts: ['link'] });
      api.contextMenus.create({ id: 'raad-toggle', title: mt.toggle, contexts: ['page', 'video', 'image'] });
    });
  } catch { }
}

api.runtime.onInstalled.addListener(async () => {
  await cfg.load();
  buildMenus();
  connect();                                   /* v1.6: pair right away      */
});

function toggleTitle() { return menuTitles().toggle; }

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'raad-dl' && info.linkUrl) {
    await sendToRaad({ url: info.linkUrl, pageUrl: info.pageUrl || '' });
  } else if (info.menuItemId === 'raad-toggle') {
    await cfg.save({ enabled: cfg.cache.enabled === false });
    buildMenus();
    try {
      const fa = (cfg.cache.lang || 'fa') !== 'en';
      api.notifications.create({
        type: 'basic', iconUrl: 'icons/icon48.png', title: 'Raad',
        message: fa ? (cfg.cache.enabled === false ? 'شنود دانلود خاموش شد' : 'شنود دانلود روشن شد')
                    : (cfg.cache.enabled === false ? 'Interception disabled' : 'Interception enabled')
      });
    } catch { }
  } else if (info.menuItemId === 'raad-copy' && info.linkUrl) {
    try {
      if (api.scripting && tab && tab.id != null) {
        await api.scripting.executeScript({ target: { tabId: tab.id }, func: (t) => navigator.clipboard.writeText(t), args: [info.linkUrl] });
      }
    } catch { }
  }
});

/* service worker / event page woke up → verify the bridge quietly */
cfg.load().then(() => { if (cfg.cache.enabled) { connect(); setInterval(updateBadge, 20000); } });
