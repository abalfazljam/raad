'use strict';
/* Raad DM — extension background (Chrome MV3 service worker / Firefox MV2 event page) */

const DEFAULTS = { port: 27500, token: '', enabled: true, cookies: false, notify: true, disabledSites: [] };
const ACT = chrome.action || chrome.browserAction;

const config = {
  cache: { ...DEFAULTS },
  async load() {
    const st = await chrome.storage.local.get(DEFAULTS);
    this.cache = st;
    updateBadge();
    return st;
  },
  async save(patch) {
    this.cache = { ...this.cache, ...patch };
    await chrome.storage.local.set(patch);
    updateBadge();
    chrome.runtime.sendMessage({ type: 'raad-config-changed', config: this.cache }).catch(() => {});
  }
};

/* toolbar badge shows OFF when interception is disabled */
function updateBadge() {
  try {
    const off = config.cache.enabled === false;
    ACT.setBadgeText({ text: off ? 'OFF' : '' });
    ACT.setBadgeBackgroundColor({ color: off ? '#64748b' : '#6366f1' });
  } catch { }
}
chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener(() => { config.load(); });

/* ---------- bridge calls ---------- */
async function ping() {
  const { port, token } = config.cache;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined });
    const j = await r.json();
    return { ok: j.ok && j.name === 'raad' };
  } catch { return { ok: false }; }
}

async function sendToRaad(msg) {
  const { port, token, notify, cookies } = config.cache;
  const body = {
    url: msg.url,
    referrer: msg.pageUrl || '',
    filename: msg.filename || '',
    cookies: cookies && msg.cookies ? msg.cookies : ''
  };
  try {
    const r = await fetch(`http://127.0.0.1:${port}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-raad-token': token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout ? AbortSignal.timeout(3500) : undefined
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { ok: false, error: j.error || ('HTTP ' + r.status) };
    }
    if (notify) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon48.png',
        title: 'Raad', message: 'Sent to Raad ▸ ' + (body.filename || msg.url.slice(0, 60))
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Raad is not running' };
  }
}

/* ---------- messaging ---------- */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'raad-add': sendResponse(await sendToRaad(msg)); break;
      case 'raad-ping': sendResponse(await ping()); break;
      case 'raad-get-config': sendResponse(config.cache); break;
      case 'raad-set-config': await config.save(msg.patch); sendResponse(config.cache); break;
      case 'raad-get-cookies': sendResponse(msg.cookies); break;
      default: sendResponse({ ok: false });
    }
  })();
  return true; // async response
});

/* ---------- context menus ---------- */
chrome.runtime.onInstalled.addListener(async () => {
  await config.load();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'raad-root', title: 'Raad', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'raad-dl', parentId: 'raad-root', title: '⬇ Download with Raad', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'raad-copy', parentId: 'raad-root', title: 'Copy link to clipboard', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'raad-toggle', title: toggleTitle(), contexts: ['page', 'video', 'image'] });
  });
});

function toggleTitle() { return config.cache.enabled === false ? '▶ Enable Raad interception' : '⏸ Disable Raad interception'; }

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'raad-dl' && info.linkUrl) {
    await sendToRaad({ url: info.linkUrl, pageUrl: info.pageUrl || '' });
  } else if (info.menuItemId === 'raad-toggle') {
    await config.save({ enabled: config.cache.enabled === false });
    chrome.contextMenus.update('raad-toggle', { title: toggleTitle() });
    try {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon48.png', title: 'Raad',
        message: config.cache.enabled === false ? 'Interception disabled' : 'Interception enabled'
      });
    } catch { }
  } else if (info.menuItemId === 'raad-copy' && info.linkUrl) {
    // write via offscreen-free approach: use tab script
    try { await chrome.scripting && chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (t) => navigator.clipboard.writeText(t), args: [info.linkUrl] }); } catch { }
  }
});

config.load();
