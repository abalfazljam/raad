'use strict';
/* Raad DM v1.7 — in-app end-to-end test (runs only with RAAD_E2E=1).
 * Verifies the full v1.7 extension flow against a REAL download:
 *   bridge 'add' (source=extension) → auto-start (extAutoStart)
 *   → progress window opens → engine completes → completion window opens
 *   → file really exists on disk. Plus the askBefore dialog still gates
 *   non-extension sources, and the v1.7 settings migration ran.
 * Run: xvfb-run -a npx electron . (with RAAD_E2E=1)                        */
const fs = require('fs');
const { BrowserWindow, app } = require('electron');

const OUT = process.env.RAAD_E2E_OUT || '/tmp/raad-e2e-results.json';
const DLDIR = '/tmp/raad-e2e-downloads';
const URL_ = 'https://raw.githubusercontent.com/electron/electron/v33.2.1/README.md';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = async function run(ctx) {
  const out = { checks: [], errors: [] };
  const check = (k, ok, extra = '') => {
    out.checks.push({ k, ok, extra });
    console.log(`[e2e] ${ok ? '✔' : '✘'} ${k}${extra ? ' — ' + extra : ''}`);
    if (!ok) out.errors.push(k);
  };
  const winUrls = () => BrowserWindow.getAllWindows().map(w => { try { return w.webContents.getURL(); } catch { return ''; } });

  try {
    await sleep(2500);

    /* deterministic test settings (v1.7 behaviour) */
    const s0 = ctx.store.get('settings', {});
    ctx.store.set('settings', { ...s0, downloadDir: DLDIR, categorize: false, extAutoStart: true, askBefore: true, clipAuto: false });
    ctx.engine.applySettings(ctx.store.get('settings', {}));
    fs.rmSync(DLDIR, { recursive: true, force: true });
    fs.mkdirSync(DLDIR, { recursive: true });

    check('v1.7 settings migration ran (settingsVersion=2, autostart ON)',
      ctx.store.get('settings', {}).settingsVersion === 2 && ctx.store.get('settings', {}).autostart === true);

    /* ---- 1. extension-sourced add → must AUTO-START (no dialog) ---- */
    let done = null;
    ctx.engine.on('status', (s) => { if (s.status === 'completed') done = s; else if (s.status === 'failed') done = s; });
    ctx.bridge.emit('add', { url: URL_, referrer: '', cookies: '', filename: '', source: 'extension' });

    for (let i = 0; i < 90 && !done; i++) await sleep(500);
    check('extension add auto-started the engine (extAutoStart)', !!done, done ? JSON.stringify(done) : 'timeout');
    check('download COMPLETED', done && done.status === 'completed', done ? done.status : 'timeout');

    await sleep(1200);   /* let the windows spawn */
    const urls = winUrls();
    check('progress window opened automatically', urls.some(u => u.includes('/progress/')), urls.join(' | ').slice(0, 160));
    check('completion card opened automatically', urls.some(u => u.includes('/complete/')));
    check('ask-dialog did NOT open for extension source', !urls.some(u => u.includes('/dialog/')));

    /* ---- 2. the file really landed ---- */
    const landed = fs.existsSync(`${DLDIR}/README.md`) && fs.statSync(`${DLDIR}/README.md`).size > 1000;
    check('downloaded file exists on disk (>1KB)', landed, `${DLDIR}/README.md`);

    /* ---- 3. non-extension source still honours askBefore ---- */
    ctx.bridge.emit('add', { url: 'https://example.com/should-ask.bin', referrer: '', cookies: '', filename: '', source: 'deeplink' });
    await sleep(1000);
    const urls2 = winUrls();
    check('askBefore dialog still opens for deeplink/manual source', urls2.some(u => u.includes('/dialog/')));

    /* ---- 4. bridge discovery file kept in sync ---- */
    const info = JSON.parse(fs.readFileSync(require('path').join(app.getPath('userData'), 'bridge.json'), 'utf8'));
    check('bridge.json discovery file present with live port', info.port === ctx.port() && info.port > 0, `port=${info.port}`);
  } catch (e) {
    out.errors.push(String(e && e.stack || e));
    console.error('[e2e] fatal', e);
  }

  try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); } catch { }
  const fail = out.errors.length;
  console.log(`\n[e2e] result: ${out.checks.filter(c => c.ok).length}/${out.checks.length} checks passed`);
  setTimeout(() => app.exit(fail ? 1 : 0), 600);
};
