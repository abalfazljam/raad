'use strict';
/* Raad DM — smoke test / screenshot harness (runs only with RAAD_SMOKE=1) */
const fs = require('fs');
const path = require('path');
const { BrowserWindow, net } = require('electron');

const SHOTS = process.env.RAAD_SHOTS || '/home/z/my-project/download/raad-screenshots';
const results = { steps: [], server: {}, errors: [] };
const log = (k, v) => { results.steps.push({ k, v }); console.log('[smoke]', k, v ?? ''); };

/* executeJavaScript with a watchdog so one hung call cannot stall the whole run */
function js(win, code, ms = 20000) {
  return Promise.race([
    win.webContents.executeJavaScript(code),
    new Promise((_, rej) => setTimeout(() => rej(new Error('JS-TIMEOUT: ' + code.slice(0, 90))), ms))
  ]);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = async function run(ctx) {
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    await sleep(3500);
    const win = ctx.mainWin();
    if (!win) throw new Error('main window missing');
    log('main window loaded', win.webContents.isLoading() === false);
    win.webContents.on('render-process-gone', (_e, d) => log('RENDERER-GONE', JSON.stringify(d)));
    win.webContents.on('console-message', (_e, level, message, line, source) => { if (level >= 3) log('console-error', source + ':' + line + ' ' + message); });

    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG());
      log('shot', name);
    };

    // capture each view
    for (const v of ['downloads', 'cats', 'scheduler', 'idm', 'settings']) {
      await js(win, `window.nav('${v}')`);
      await sleep(1000);
      await shot('view-' + v);
    }

    // language switch
    await js(win, `window.raad.settings.set({language:'en'})`);
    await sleep(900);
    await shot('view-downloads-en');
    await js(win, `window.raad.settings.set({language:'fa'})`);
    await sleep(600);

    // add a fake download row for visuals
    log('adding rows', '');
    await js(win, `
      window.raad.dl.add({ items: [{ url: 'https://speed.hetzner.de/100MB.bin', filename: '100MB.bin' }], start: false })
        .then(() => window.raad.dl.add({ items: [{ url: 'https://example.com/Ubuntu-24.04.iso', filename: 'Ubuntu-24.04.iso' }], start: false }))
    `);
    await sleep(900);
    await js(win, `window.nav('downloads')`);
    await sleep(700);
    await shot('view-downloads-populated');

    /* v1.3: 1000-row windowed list — DOM must stay tiny, scroll must re-render */
    log('bulk 1000 rows (windowed list)', '');
    await js(win, `
      const items = [];
      for (let i = 0; i < 1000; i++) items.push({ url: 'https://cdn.example.com/bulk/file-' + i + '.zip', filename: 'bulk-file-' + i + '.zip', source: 'idm' });
      window.raad.dl.add({ items, start: false });
    `);
    await sleep(2200);
    await js(win, `window.nav('downloads')`);
    await sleep(900);
    const domRows = await js(win, `document.querySelectorAll('.dl-row').length`);
    log('DOM rows mounted for 1002 items (must be ~visible only)', domRows);
    await shot('view-downloads-1000-rows');
    await js(win, `const l = document.querySelector('.dl-list'); l.scrollTop = 32000;`);
    await sleep(800);
    const midInfo = await js(win, `({rows: document.querySelectorAll('.dl-row').length, scrollTop: Math.round(document.querySelector('.dl-list').scrollTop)})`);
    log('after deep scroll', JSON.stringify(midInfo));
    await shot('view-downloads-scrolled-mid');

    /* v1.3 regression: resume-all must NOT mass-start PARKED (imported) items */
    await js(win, `window.raad.dl.resumeAll()`);
    await sleep(900);
    const counts = await js(win, `window.raad.dl.counts()`);
    log('counts after resumeAll — parked must stay paused (>=1000), active must stay tiny', JSON.stringify(counts));
    if (counts.paused < 1000) results.errors.push('PARKED LEAK: resumeAll started parked items (paused=' + counts.paused + ')');

    /* v1.5: IDM wizard apply (idm:apply) must land items as COMPLETED,
     * newest-first ordering preserved */
    await js(win, `
      window.raad.idm.apply({ entries: [
        { url: 'https://old.example.com/first.zip', filename: 'first.zip', rank: 1 },
        { url: 'https://new.example.com/latest.zip', filename: 'latest.zip', rank: 0 }
      ] });
    `);
    await sleep(900);
    const idmCounts = await js(win, `(async () => {
      const rows = await window.raad.dl.list({ filter: 'all' });
      const a = rows.find(r => r.url.includes('new.example.com'));
      const b = rows.find(r => r.url.includes('old.example.com'));
      return { a: a && a.status, b: b && b.status, aDate: a && a.addedAt, bDate: b && b.addedAt };
    })()`);
    log('idm:apply → statuses (both must be completed)', JSON.stringify(idmCounts));
    if (idmCounts.a !== 'completed' || idmCounts.b !== 'completed') results.errors.push('IDM IMPORT NOT COMPLETED: ' + JSON.stringify(idmCounts));
    if (!(idmCounts.aDate > idmCounts.bDate)) results.errors.push('IDM IMPORT ORDER WRONG: newest rank must sort above');
    await js(win, `window.nav('settings')`);
    await sleep(600);
    const hasAuto = await js(win, `!!document.querySelector('.seg button') && [...document.querySelectorAll('.seg')].some(s => [...s.querySelectorAll('button')].some(b => /هماهنگ|Follow system/.test(b.textContent)))`);
    log('auto/system theme mode present (must be false)', hasAuto);

    // light mode + violet accent
    await js(win, `window.raad.settings.set({mode:'light', accent:'violet'})`);
    await sleep(900);
    await shot('view-downloads-light');
    await js(win, `window.raad.settings.set({mode:'dark', accent:'indigo', style:'flat'})`);
    await sleep(900);
    await shot('view-downloads-flat');
    await js(win, `window.raad.settings.set({style:'glass'})`);

    // v1.2: animated background themes were REMOVED — verify dark/light/styles only
    await js(win, `window.nav('settings')`);
    await sleep(900);
    await js(win, `const w = document.querySelector('.settings-wrap'); if (w) w.scrollTop = 190;`);
    await sleep(500);
    await shot('view-settings-appearance');
    await js(win, `window.nav('downloads')`);

    // clipboard modal
    await js(win, `
      window.raad.clip.parse && Views.clipboardModal(['https://cdn.example.com/a/file-one.mkv','https://cdn.example.com/b/file-two.zip','https://cdn.example.com/c/album-song.mp3'])
    `);
    await sleep(900);
    await shot('modal-clipboard');
    await js(win, `closeModal()`);
    await sleep(400);

    // dialog window via bridge (extension path)
    ctx.bridge.emit('add', { url: 'https://example.com/media/Sample.Video.1080p.mkv', referrer: 'https://example.com/page', cookies: '', filename: '', source: 'extension' });
    await sleep(2200);
    const dlg = BrowserWindow.getAllWindows().find(w => w !== win);
    if (dlg) {
      const img = await dlg.webContents.capturePage();
      fs.writeFileSync(path.join(SHOTS, 'dialog.png'), img.toPNG());
      log('shot', 'dialog');
      dlg.close();
    } else log('dialog', 'NOT OPENED (askBefore?)');

    // bridge server tests
    const httpGet = (url, headers = {}) => new Promise((resolve) => {
      const req = net.request({ url, method: 'GET' });
      for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
      let body = '';
      req.on('response', res => { res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode, body })); });
      req.on('error', e => resolve({ status: 0, body: String(e) }));
      req.end();
      setTimeout(() => resolve({ status: 0, body: 'timeout' }), 4000);
    });
    const httpPost = (url, data, headers = {}) => new Promise((resolve) => {
      const req = net.request({ url, method: 'POST' });
      req.setHeader('Content-Type', 'application/json');
      for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
      let body = '';
      req.on('response', res => { res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode, body })); });
      req.on('error', e => resolve({ status: 0, body: String(e) }));
      req.write(JSON.stringify(data)); req.end();
      setTimeout(() => resolve({ status: 0, body: 'timeout' }), 4000);
    });

    const port = ctx.port();
    results.server.ping = (await httpGet(`http://127.0.0.1:${port}/ping`)).body;
    log('server ping', results.server.ping);
    results.server.addNoToken = (await httpPost(`http://127.0.0.1:${port}/add`, { url: 'https://x/y.zip' })).status;
    log('add without token → expect 401, got', results.server.addNoToken);
    results.server.addBadToken = (await httpPost(`http://127.0.0.1:${port}/add?token=wrong`, { url: 'https://x/y.zip' })).status;
    log('add bad token → expect 401, got', results.server.addBadToken);
    results.server.addOk = (await httpPost(`http://127.0.0.1:${port}/add?token=${ctx.token()}`, { url: 'https://example.com/ext-trigger.zip', referrer: 'https://example.com' })).body;
    log('add with token →', results.server.addOk);

    // runtime JS errors?
    results.errors = await js(win, `window.__raadErrors || []`);
    log('renderer errors', JSON.stringify(results.errors));

    fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  } catch (e) {
    results.errors.push(String(e && e.stack || e));
    console.error('[smoke] fatal', e);
    try { fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2)); } catch { }
  } finally {
    const { app } = require('electron');
    setTimeout(() => app.exit(0), 700);
  }
};
