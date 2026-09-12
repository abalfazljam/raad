'use strict';
/* Raad DM v1.6 — local HTTP bridge for browser extensions (Chrome/Firefox).
 *
 * What changed vs v1.5 (the "extension can't reach the app" fix):
 *  1. start() now STOPS any previous server first (v1.5 leaked the old one),
 *     remembers the last-good port and tries it FIRST, scans a wider range
 *     (preferred .. preferred+30) and — if every port is busy — keeps retrying
 *     every 5 s instead of dying silently until app restart.
 *  2. GET /pair — lets a browser extension fetch {port, token} AUTOMATICALLY.
 *     It is only answered when the request carries a browser-extension Origin
 *     (chrome-extension://… or moz-extension://…) or a valid token. Web pages
 *     cannot forge the Origin header, so drive-by pages still get 403.
 *  3. POST /add now accepts EITHER the token OR an extension Origin. This
 *     means after a token regeneration the extension re-pairs by itself and
 *     keeps working (v1.5 returned 401 forever until manual re-paste).
 *  4. GET /ping is now HONEST: reports `auth` (whether a token is required)
 *     so the extension can display a real status instead of a fake
 *     "connected" while /add was failing with 401 (classic v1.5 trap).
 *  5. CORS: echoes extension origins, keeps `*` for plain tools.
 *
 * Endpoints:
 *   GET  /ping     → {ok,name,version,port,auth}          (no auth)
 *   GET  /healthz  → same as /ping                         (no auth)
 *   GET  /pair     → {ok,port,token}   extension Origin or valid token only
 *   POST /add      → enqueue download  {url, referrer?, cookies?, filename?}
 *                    token OR extension Origin required
 * Auth: header "x-raad-token" or ?token=  (empty token in settings = token not
 *       required, exactly like IDM — extension Origin still gates /pair)      */
const http = require('http');
const { EventEmitter } = require('events');
const { app } = require('electron');

const VERSION = () => { try { return app.getVersion(); } catch { return '1.6.0'; } };

const PORT_RANGE = 31;          /* preferred .. preferred+30 */
const RETRY_MS = 5000;          /* keep retrying when every port is busy */
const MAX_BODY = 1e6;

const isExtOrigin = (o) =>
  typeof o === 'string' && /^(chrome-extension|moz-extension|safari-web-extension):\/\//i.test(o);

class BridgeServer extends EventEmitter {
  constructor(token) {
    super();
    this.token = token || '';
    this.port = 0;
    this.lastGoodPort = 0;      /* remembered across restarts */
    this.preferredPort = 27500;
    this.server = null;
    this._retryTimer = null;
    this._stopping = false;
  }

  setToken(t) { this.token = t || ''; }

  /* ---- lifecycle ------------------------------------------------------- */
  start(preferredPort = this.preferredPort || 27500) {
    this.preferredPort = preferredPort;
    this._stopping = false;
    this._clearRetry();
    /* v1.6 fix: never leak the previous server when the port changes */
    this.stop();
    return new Promise((resolve) => {
      const base = this.lastGoodPort && this.lastGoodPort !== preferredPort
        ? [preferredPort, this.lastGoodPort]
        : [preferredPort];
      const ports = [];
      for (const b of base) for (let i = 0; i < PORT_RANGE; i++) {
        const p = b + i;
        if (!ports.includes(p)) ports.push(p);
      }
      let idx = 0;
      const tryNext = () => {
        if (this._stopping) return resolve(0);
        if (idx >= ports.length) {
          /* every candidate busy → self-heal later instead of staying dead */
          this.port = 0;
          this._emitStatus(false, 'all ports busy');
          this._retryTimer = setTimeout(() => { if (!this._stopping) { this._retryTimer = null; this.start(preferredPort).then(p => resolve(p)); } }, RETRY_MS);
          return;
        }
        const port = ports[idx++];
        const server = http.createServer((req, res) => this._route(req, res));
        server.on('error', () => tryNext());
        server.listen(port, '127.0.0.1', () => {
          this.server = server;
          this.port = port;
          this.lastGoodPort = port;
          try { server.on('close', () => { if (this.server === server) { this.server = null; this.port = 0; } }); } catch { }
          this._emitStatus(true, `listening on 127.0.0.1:${port}`);
          resolve(port);
        });
      };
      tryNext();
    });
  }

  stop() {
    this._clearRetry();
    const s = this.server;
    this.server = null;
    this.port = 0;
    if (s) {
      try { if (typeof s.closeAllConnections === 'function') s.closeAllConnections(); } catch { }
      try { s.close(); } catch { }
    }
  }

  shutdown() { this._stopping = true; this.stop(); }

  _clearRetry() { if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; } }

  _emitStatus(ok, why) {
    try { this.emit('status', { ok, port: this.port, reason: why }); } catch { }
    try { console.log(`[bridge] ${ok ? 'up' : 'down'} — ${why}`); } catch { }
  }

  /* ---- http helpers ----------------------------------------------------- */
  _cors(req, res) {
    const origin = req.headers.origin || '';
    /* echo extension origins so extension pages/service workers can read the
     * JSON; anything else stays permissive-but-gated by token/origin checks */
    res.setHeader('Access-Control-Allow-Origin', isExtOrigin(origin) ? origin : '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-raad-token');
  }

  _send(res, code, obj) {
    try {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    } catch { }
  }

  _tokenOf(req, u) {
    return String(req.headers['x-raad-token'] || u.searchParams.get('token') || '');
  }

  _authOk(req, u) {
    if (!this.token) return true;                      /* token auth disabled  */
    return this._tokenOf(req, u) === this.token;       /* or token matches     */
  }

  /* ---- routing ----------------------------------------------------------- */
  _route(req, res) {
    this._cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); } catch { return this._send(res, 400, { ok: false, error: 'bad url' }); }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const origin = req.headers.origin || '';

    /* ---- ping (always open — but HONEST about auth) ---- */
    if (path === '/ping' || path === '/healthz') {
      return this._send(res, 200, {
        ok: true, name: 'raad', version: VERSION(),
        port: this.port, auth: !!this.token,
        paired: !this.token || this._tokenOf(req, u) === this.token
      });
    }

    /* ---- pair: extension-only auto configuration (v1.6) ---- */
    if (path === '/pair' && req.method === 'GET') {
      const extOrigin = isExtOrigin(origin);
      const tokenOk = !!this.token && this._tokenOf(req, u) === this.token;
      if (!extOrigin && !tokenOk) {
        return this._send(res, 403, { ok: false, error: 'pairing is restricted to the Raad browser extension' });
      }
      return this._send(res, 200, { ok: true, name: 'raad', version: VERSION(), port: this.port, token: this.token });
    }

    /* ---- add: token OR extension origin ---- */
    if (path === '/add' && req.method === 'POST') {
      const extOrigin = isExtOrigin(origin);
      const authed = this._authOk(req, u) || extOrigin;
      if (!authed) {
        return this._send(res, 401, { ok: false, error: 'bad token' });
      }
      let body = '';
      let tooBig = false;
      req.on('data', c => { body += c; if (body.length > MAX_BODY) { tooBig = true; req.destroy(); } });
      req.on('end', () => {
        if (tooBig) return;
        try {
          const data = JSON.parse(body || '{}');
          const url = String(data.url || '').trim();
          if (!/^https?:\/\//i.test(url) && !/^ftp:/i.test(url)) throw new Error('invalid url');
          this.emit('add', {
            url,
            referrer: String(data.referrer || data.pageUrl || ''),
            cookies: String(data.cookies || ''),
            filename: String(data.filename || ''),
            source: 'extension'
          });
          this._send(res, 200, { ok: true });
        } catch (e) {
          this._send(res, 400, { ok: false, error: e.message });
        }
      });
      req.on('error', () => { });
      return;
    }

    this._send(res, 404, { ok: false, error: 'not found' });
  }
}

module.exports = { BridgeServer };
