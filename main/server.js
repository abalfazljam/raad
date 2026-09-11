'use strict';
/* Raad DM — local HTTP bridge for browser extensions (Chrome/Firefox).
 * Endpoints:
 *   GET  /ping        → handshake {ok,name,version}
 *   POST /add         → enqueue download  {url, referrer?, cookies?, filename?}
 * Auth: header "x-raad-token" or ?token= (configurable in app settings) */
const http = require('http');
const { EventEmitter } = require('events');
const { app } = require('electron');

const VERSION = () => { try { return app.getVersion(); } catch { return '1.0.0'; } };

class BridgeServer extends EventEmitter {
  constructor(token) {
    super();
    this.token = token;
    this.port = 0;
    this.server = null;
  }

  setToken(t) { this.token = t; }

  start(preferredPort = 27500) {
    return new Promise((resolve) => {
      const tryPort = (port, attempt = 0) => {
        const server = http.createServer((req, res) => this._route(req, res));
        server.on('error', () => {
          if (attempt < 12) tryPort(port + 1, attempt + 1);
          else { this.port = 0; resolve(0); }
        });
        server.listen(port, '127.0.0.1', () => {
          this.server = server; this.port = port;
          resolve(port);
        });
      };
      tryPort(preferredPort);
    });
  }

  stop() { try { this.server && this.server.close(); } catch { } }

  _cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-raad-token');
  }

  _route(req, res) {
    this._cors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const u = new URL(req.url, 'http://127.0.0.1');
    const token = req.headers['x-raad-token'] || u.searchParams.get('token') || '';

    if (u.pathname === '/ping' || u.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, name: 'raad', version: VERSION(), port: this.port }));
    }

    if (u.pathname === '/add' && req.method === 'POST') {
      if (!this.token || token !== this.token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'bad token' }));
      }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
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
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  }

  shutdown() { this.stop(); }
}

module.exports = { BridgeServer };
