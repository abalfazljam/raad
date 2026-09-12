'use strict';
/* Raad DM v1.6 — END-TO-END test: runs the REAL extension background (bg.js)
 * against a REAL BridgeServer, using a minimal browser-API mock.
 * Verifies: auto-discovery scan → /pair → stored {port, token} → /add works.
 * Run: node scripts/test-extension-bg.js                                  */
const Module = require('module');
const path = require('path');

/* ---- stub electron for server.js ---- */
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getVersion: () => '1.6.0-test' } };
  return origLoad.apply(this, arguments);
};

const { BridgeServer } = require(path.join(__dirname, '..', 'main', 'server.js'));

/* ---- browser API mock ---- */
const stored = {};                       /* what chrome.storage.local holds   */
const messageHandlers = [];
const installHandlers = [];
let downloadsListener = null;
global.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in stored) out[k] = stored[k];
        return out;
      },
      set: async (patch) => { Object.assign(stored, patch); }
    },
    onChanged: { addListener: () => { } }
  },
  runtime: {
    onMessage: { addListener: (fn) => messageHandlers.push(fn) },
    onInstalled: { addListener: (fn) => installHandlers.push(fn) },
    sendMessage: async () => { }
  },
  contextMenus: { removeAll: (cb) => cb && cb(), create: () => { }, onClicked: { addListener: () => { } }, update: () => { } },
  notifications: { create: () => { } },
  browserAction: {
    setBadgeText: () => { }, setBadgeBackgroundColor: () => { }
  },
  downloads: { onCreated: { addListener: (fn) => { downloadsListener = fn; } } }
};

/* ---- boot the real server + real bg.js ---- */
const TOKEN = 'e2e-token-42';
let added = [];

/* Simulate the browser: extension-context fetch always carries the
 * chrome-extension:// Origin header (Node's fetch does not).               */
const realFetch = global.fetch;
global.fetch = (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) {
    opts.headers = { ...(opts.headers || {}), Origin: 'chrome-extension://raadmockid0000000000000000000000' };
  }
  return realFetch(u, opts);
};

async function main() {
  const bridge = new BridgeServer(TOKEN);
  bridge.on('add', (it) => added.push(it));
  const port = await bridge.start(27500);
  console.log(`bridge listening on ${port}`);

  require(path.join(__dirname, '..', 'extension', 'chrome', 'bg.js'));
  await new Promise(r => setTimeout(r, 300));   /* let cfg.load + auto-connect run */

  let pass = 0, fail = 0;
  const check = (name, cond, extra = '') => {
    console.log(`  ${cond ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };
  const handler = messageHandlers[0];
  check('bg.js registered its message handler', typeof handler === 'function');
  check('bg.js registered the downloads.onCreated interceptor', typeof downloadsListener === 'function');

  /* 1 — raad-connect: full discovery + pairing (NO config pre-seeded) */
  const conn = await new Promise(res => {
    const p = handler({ type: 'raad-connect' }, {}, res);
    if (p && typeof p.then === 'function') p.then(res);
  });
  check('raad-connect discovers the app automatically', conn && conn.ok === true, JSON.stringify(conn));
  check('pairing stored the real token', stored.token === TOKEN, `token=${stored.token}`);
  check('pairing stored the real port', stored.port === port && stored.lastGoodPort === port, `port=${stored.port}`);

  /* 2 — raad-add end-to-end: handler → /add → server 'add' event */
  const sent = await new Promise(res => {
    const p = handler({ type: 'raad-add', url: 'https://example.com/e2e.zip', pageUrl: 'https://example.com/page', filename: 'e2e.zip' }, {}, res);
    if (p && typeof p.then === 'function') p.then(res);
  });
  check('raad-add succeeds end-to-end', sent && sent.ok === true, JSON.stringify(sent));
  check('server received the item with referrer', added.length === 1 && added[0].referrer === 'https://example.com/page');

  /* 3 — raad-ping honest status */
  const ping = await new Promise(res => {
    const p = handler({ type: 'raad-ping' }, {}, res);
    if (p && typeof p.then === 'function') p.then(res);
  });
  check('raad-ping returns ok + port', ping && ping.ok === true && ping.port === port, JSON.stringify(ping));

  /* 4 — self-heal: move the server to another port, extension must recover */
  await bridge.start(port + 5);                       /* restart on new port  */
  const healed = await new Promise(res => {
    const p = handler({ type: 'raad-add', url: 'https://example.com/healed.zip', pageUrl: '' }, {}, res);
    if (p && typeof p.then === 'function') p.then(res);
  });
  check('after a silent port move, send self-heals and succeeds', healed && healed.ok === true, JSON.stringify(healed));
  check('extension re-learned the new port', stored.port === port + 5, `port=${stored.port}`);

  /* 5 — token regeneration: app rotates the token, extension keeps working
   *    (sends pass via extension-origin auth; token refreshes on next pair) */
  bridge.setToken('rotated-token-77');
  const afterRot = await new Promise(res => {
    const p = handler({ type: 'raad-add', url: 'https://example.com/after-rotate.zip', pageUrl: '' }, {}, res);
    if (p && typeof p.then === 'function') p.then(res);
  });
  check('after token rotation, send still succeeds (origin auth / re-pair)', afterRot && afterRot.ok === true, JSON.stringify(afterRot));
  await new Promise(res => {
    const p = handler({ type: 'raad-connect' }, {}, res);
    if (p && typeof p.then === 'function') p.then(res);
  });
  check('next pairing cycle picks up the rotated token', stored.token === 'rotated-token-77', `token=${stored.token}`);

  console.log(`\n──────── result ────────\n${pass}/${pass + fail} checks passed`);
  bridge.shutdown();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('fatal', e); process.exit(1); });
