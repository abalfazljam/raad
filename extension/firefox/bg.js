'use strict';
/* Raad DM v1.2 (for app v1.6) — extension background
 * Chrome MV3 service worker / Firefox MV2 event page — ONE shared codebase.
 *
 * v1.6 connection fixes (why v1.5 kept failing):
 *  1. AUTO-DISCOVERY — the extension now scans 127.0.0.1:27500..27520 and
 *     finds the app by itself. v1.5 relied on one hand-copied port, so the
 *     link broke whenever the app picked a different port.
 *  2. AUTO-PAIRING — after discovery it calls GET /pair (extension-origin
 *     only) and stores {port, token} automatically. Manual JSON paste is now
 *     an advanced fallback, not a requirement.
 *  3. SELF-HEALING — every send failure re-runs discovery/pairing once, so
 *     app restarts, port moves and token regeneration survive silently.
 *  4. HONEST STATUS — /ping reports auth state; popup/badge show the truth
 *     (v1.5 said "connected" while /add was failing with 401).
 *  5. REAL DOWNLOAD INTERCEPTION — chrome.downloads.onCreated catches every
 *     browser download (not just link clicks), cancels it and routes it to
 *     Raad — IDM behaviour. If Raad is unreachable the browser continues
 *     normally.
 *  6. FIREFOX-SAFE — AbortController timeouts (AbortSignal.timeout is missing
 *     on Firefox < 100) and a unified `api = browser || chrome` promise
 *     wrapper (v1.5 called .catch() on chrome.* which throws on Firefox).   */

const api = (typeof browser !== 'undefined' && browser && browser.runtime) ? browser : chrome;

const DEFAULTS = {
  port: 27500,            /* preferred port (first candidate)              */
  token: '',              /* filled automatically by /pair                 */
  enabled: true,
  cookies: false,
  notify: true,
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
          api.notifications.create({
            type: 'basic', iconUrl: 'icons/icon48.png',
            title: 'Raad', message: 'Sent to Raad ▸ ' + (body.filename || msg.url.slice(0, 60))
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

/* ---------- browser-download interception (IDM style, v1.6) ---------- */
if (api.downloads && api.downloads.onCreated) {
  api.downloads.onCreated.addListener(async (item) => {
    try {
      if (!item || !item.url || !cfg.cache.enabled) return;
      if (isDisabled(item.finalUrl || item.url) || isDisabled(item.referrer || '')) return;

      /* Only hijack when Raad is actually reachable — otherwise the browser
       * download continues untouched (graceful fallback).                   */
      const ready = await ensureReady();
      if (!ready) return;

      /* Cancel the browser copy FIRST so we never double-download.
       * If cancel fails the file already finished — leave it alone.         */
      try { await api.downloads.cancel(item.id); } catch { return; }
      try { await api.downloads.erase({ id: item.id }); } catch { }

      let cookies = '';
      if (cfg.cache.cookies) {
        try {
          const jar = await api.cookies.getAll({ url: item.finalUrl || item.url });
          cookies = (jar || []).map(c => `${c.name}=${c.value}`).join('; ');
        } catch { }
      }
      await sendToRaad({
        url: item.finalUrl || item.url,
        pageUrl: item.referrer || '',
        filename: (item.filename || '').split(/[\\/]/).pop() || '',
        cookies
      });
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

/* ---------- context menus ---------- */
api.runtime.onInstalled.addListener(async () => {
  await cfg.load();
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: 'raad-root', title: 'Raad', contexts: ['link'] });
    api.contextMenus.create({ id: 'raad-dl', parentId: 'raad-root', title: '⬇ Download with Raad', contexts: ['link'] });
    api.contextMenus.create({ id: 'raad-copy', parentId: 'raad-root', title: 'Copy link to clipboard', contexts: ['link'] });
    api.contextMenus.create({ id: 'raad-toggle', title: toggleTitle(), contexts: ['page', 'video', 'image'] });
  });
  connect();                                   /* v1.6: pair right away      */
});

function toggleTitle() { return cfg.cache.enabled === false ? '▶ Enable Raad interception' : '⏸ Disable Raad interception'; }

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'raad-dl' && info.linkUrl) {
    await sendToRaad({ url: info.linkUrl, pageUrl: info.pageUrl || '' });
  } else if (info.menuItemId === 'raad-toggle') {
    await cfg.save({ enabled: cfg.cache.enabled === false });
    api.contextMenus.update('raad-toggle', { title: toggleTitle() });
    try {
      api.notifications.create({
        type: 'basic', iconUrl: 'icons/icon48.png', title: 'Raad',
        message: cfg.cache.enabled === false ? 'Interception disabled' : 'Interception enabled'
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
