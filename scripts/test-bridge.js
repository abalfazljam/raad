'use strict';
/* Raad DM v1.6 — bridge server test (no Electron/GUI needed).
 * Stubs the `electron` module, then exercises the extension bridge:
 * discovery/port-drift, /ping honesty, /pair origin gating, /add auth rules.
 * Run: node scripts/test-bridge.js                                       */
const Module = require('module');
const path = require('path');
const http = require('http');

/* ---- stub electron.app (server.js only uses app.getVersion) ---- */
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getVersion: () => '1.6.0-test' } };
  }
  return origLoad.apply(this, arguments);
};

const { BridgeServer } = require(path.join(__dirname, '..', 'main', 'server.js'));

const results = [];
let failed = 0;
function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra });
  if (!cond) failed++;
  console.log(`  ${cond ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function req(method, port, pathName, { headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port, path: pathName, method,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers }
    }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { } resolve({ status: res.statusCode, json: j, body: b }); });
    });
    r.on('error', e => resolve({ status: 0, json: null, body: String(e) }));
    if (data) r.write(data);
    r.end();
    setTimeout(() => { try { r.destroy(); } catch { } resolve({ status: 0, json: null, body: 'timeout' }); }, 4000);
  });
}

async function main() {
  const TOKEN = 'test-token-abc123';
  const EXT_ORIGIN = { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' };
  const FF_ORIGIN = { Origin: 'moz-extension://8f2c1d34-1111-2222-3333-aaaaaaaaaaaa' };
  const WEB_ORIGIN = { Origin: 'https://evil.example.com' };
  let added = [];

  console.log('\n[1] basic lifecycle');
  const bridge = new BridgeServer(TOKEN);
  bridge.on('add', (item) => added.push(item));
  let port = await bridge.start(27500);
  check('server starts on preferred port 27500', port === 27500, `got ${port}`);

  let ping = await req('GET', port, '/ping');
  check('/ping → 200 ok/name=raad', ping.status === 200 && ping.json && ping.json.ok && ping.json.name === 'raad');
  check('/ping reports auth:true when token set', ping.json && ping.json.auth === true);
  check('/ping reports version', ping.json && ping.json.version === '1.6.0-test');

  console.log('\n[2] /add auth rules');
  let r = await req('POST', port, '/add', { body: { url: 'https://example.com/a.zip' } });
  check('/add without token/origin → 401', r.status === 401);
  r = await req('POST', port, '/add?token=wrong', { body: { url: 'https://example.com/a.zip' } });
  check('/add with wrong token → 401', r.status === 401);
  r = await req('POST', port, '/add', { headers: WEB_ORIGIN, body: { url: 'https://example.com/a.zip' } });
  check('/add from WEB origin without token → 401 (drive-by blocked)', r.status === 401);
  r = await req('POST', port, '/add', { headers: EXT_ORIGIN, body: { url: 'https://example.com/one.zip', referrer: 'https://example.com/p' } });
  check('/add with CHROME extension origin (no token) → 200', r.status === 200 && r.json && r.json.ok);
  r = await req('POST', port, '/add', { headers: FF_ORIGIN, body: { url: 'https://example.com/two.zip' } });
  check('/add with FIREFOX extension origin (no token) → 200', r.status === 200 && r.json && r.json.ok);
  r = await req('POST', port, `/add?token=${TOKEN}`, { body: { url: 'https://example.com/three.zip' } });
  check('/add with valid token (no origin) → 200', r.status === 200 && r.json && r.json.ok);
  r = await req('POST', port, '/add', { headers: EXT_ORIGIN, body: { url: 'notaurl' } });
  check('/add invalid url → 400', r.status === 400);
  check('bridge emitted 3 add events', added.length === 3, `got ${added.length}`);
  check('emitted item carries source=extension + referrer', added[0] && added[0].source === 'extension' && added[0].referrer === 'https://example.com/p');

  console.log('\n[3] /pair — automatic extension pairing (the v1.5 killer)');
  r = await req('GET', port, '/pair', { headers: EXT_ORIGIN });
  check('/pair with extension origin → 200 + token', r.status === 200 && r.json && r.json.ok && r.json.token === TOKEN && r.json.port === port);
  r = await req('GET', port, '/pair', { headers: FF_ORIGIN });
  check('/pair with firefox origin → 200 + token', r.status === 200 && r.json && r.json.ok && r.json.token === TOKEN);
  r = await req('GET', port, '/pair', { headers: WEB_ORIGIN });
  check('/pair from web origin → 403 (secret stays secret)', r.status === 403);
  r = await req('GET', port, '/pair');
  check('/pair without origin → 403', r.status === 403);
  r = await req('GET', port, `/pair?token=${TOKEN}`);
  check('/pair with valid token (native host style) → 200', r.status === 200 && r.json && r.json.ok);

  console.log('\n[4] token auth disabled mode');
  bridge.setToken('');
  ping = await req('GET', port, '/ping');
  check('/ping reports auth:false when token empty', ping.json && ping.json.auth === false);
  r = await req('POST', port, '/add', { body: { url: 'https://example.com/free.zip' } });
  check('/add without token allowed when token auth disabled', r.status === 200);

  console.log('\n[5] port drift / restart self-heal (the v1.5 core bug)');
  bridge.setToken(TOKEN);
  bridge.stop();                       /* free 27500 … */
  await sleep(120);
  /* … then occupy the preferred port with a decoy, then restart the bridge */
  const decoy = http.createServer(() => { });
  decoy.on('error', () => { });
  const decoyReady = new Promise(res => decoy.listen(27500, '127.0.0.1', res));
  await decoyReady;
  const newPort = await bridge.start(27500);
  check('bridge restarts on next free port when 27500 is busy', newPort === 27501, `got ${newPort}`);
  ping = await req('GET', newPort, '/ping');
  check('/ping answers on the new port', ping.status === 200 && ping.json && ping.json.ok);
  ping = await req('GET', 27500, '/ping').catch(() => ({ status: 0 }));
  check('old port 27500 is now the decoy (no leak), not our /ping', !(ping.json && ping.json.name === 'raad'));
  /* remembered fast-path: free the decoy, restart → should return to 27500? lastGood=27501 first then preferred... preferred is tried first */
  await new Promise(res => { try { decoy.closeAllConnections && decoy.closeAllConnections(); } catch { } decoy.close(res); });
  const backPort = await bridge.start(27500);
  check('after freeing, bridge rebinds preferred 27500', backPort === 27500, `got ${backPort}`);
  r = await req('POST', backPort, '/add', { headers: EXT_ORIGIN, body: { url: 'https://example.com/four.zip' } });
  check('/add still works after restarts', r.status === 200 && r.json && r.json.ok && added.length === 5, `status=${r.status} adds=${added.length}`);

  console.log('\n[6] full shutdown');
  bridge.shutdown();
  await sleep(120);
  ping = await req('GET', 27500, '/ping');
  check('after shutdown /ping refuses (socket closed)', ping.status === 0);

  console.log('\n──────── result ────────');
  const pass = results.filter(x => x.pass).length;
  console.log(`${pass}/${results.length} checks passed`);
  if (failed) { console.log('FAILED:', results.filter(x => !x.pass).map(x => x.name).join(' | ')); process.exit(1); }
  process.exit(0);
}

main().catch(e => { console.error('fatal', e); process.exit(1); });
