'use strict';
/* Raad DM — application entry point (Electron main process) */
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, Notification, dialog, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Store } = require('./store');
const { Engine } = require('./engine');
const { Scheduler } = require('./scheduler');
const { ClipboardWatcher, extractUrls } = require('./clipboard');
const { BridgeServer } = require('./server');
const idm = require('./idm');
const U = require('./util');

const DEV = process.argv.includes('--dev');
app.setAsDefaultProtocolClient('raad');
app.setAppUserModelId('dev.raad.dm');   /* correct taskbar icon & notifications on Windows */

/* ── portable mode: keep ALL app data (settings, history, schedules, cache)
 *    inside a "Raad-Data" folder next to the exe — nothing in the registry
 *    beyond the protocol entry, fully removable by deleting the folder. ── */
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    const portableData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Raad-Data');
    fs.mkdirSync(portableData, { recursive: true });
    app.setPath('userData', portableData);
  } catch { }
}

let store, engine, scheduler, clipWatcher, bridge;
let mainWin = null, dlgWin = null, tray = null;
let quitting = false;
const iconOf = (name) => path.join(__dirname, '..', 'assets', 'icons', name);

/* ---------------- strings (main-process side) ---------------- */
const STR = {
  fa: {
    ready: 'رعد آماده است', startDl: 'شروع دانلود', done: 'دانلود کامل شد',
    doneBody: (n, f) => `${n} — در پوشه دانلودها ذخیره شد`, open: 'نمایش فایل',
    extSent: 'به رعد ارسال شد', queueEmpty: 'همه دانلودها تمام شد'
  },
  en: {
    ready: 'Raad is ready', startDl: 'Start download', done: 'Download completed',
    doneBody: (n) => `${n} — saved to your downloads`, open: 'Show file',
    extSent: 'Sent to Raad', queueEmpty: 'All downloads finished'
  }
};
const T = () => STR[(store.get('settings', {}).language || 'fa')] || STR.fa;

/* ---------------- defaults ---------------- */
function defaultSettings() {
  return {
    language: 'fa',
    mode: 'dark',            // dark | light | auto
    style: 'glass',          // glass | flat | soft
    accent: 'indigo',        // indigo | emerald | amber | rose | cyan | violet
    animations: true,
    downloadDir: U.homedirDownloads(),
    categorize: true,
    maxConcurrent: 3,
    maxSegments: 16,
    speedLimit: 0,
    clipAuto: true,
    askBefore: true,
    useYtdlp: false,
    ytdlpPath: '',
    port: 27500,
    token: crypto.randomBytes(12).toString('hex'),
    autostart: false,
    closeToTray: true,
    /* appearance extras (v1.1) */
    deco: 'none',            // none | aurora | stars | waves | particles | mesh
    radius: 'md',            // sm | md | lg
    fontScale: 'm',          // s | m | l | xl
    glow: 'soft',            // off | soft | vivid
    density: 'comfy',        // comfy | compact
    accentCustom: ''         // '#rrggbb' when accent === 'custom'
  };
}

/* ---------------- window helpers ---------------- */
function winOpts(extra = {}) {
  return {
    width: 1180, height: 750, minWidth: 960, minHeight: 600,
    frame: false, backgroundColor: '#00000000',
    icon: iconOf(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false, ...extra
  };
}

function createMain() {
  mainWin = new BrowserWindow(winOpts({
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'bridge.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  }));
  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('maximize', () => broadcast('evt', { type: 'win:max', value: true }));
  mainWin.on('unmaximize', () => broadcast('evt', { type: 'win:max', value: false }));

  mainWin.on('close', (e) => {
    const s = store.get('settings', {});
    if (!quitting && s.closeToTray && tray) {
      e.preventDefault();
      mainWin.hide();
      if (!mainWin._trayHintShown) {
        mainWin._trayHintShown = true;
        notify(T().ready, 'Raad ▸ ' + (s.language === 'fa' ? 'در تری میزبان شماست' : 'lives in your tray'));
      }
    }
  });
}

function createDialog(payload) {
  if (dlgWin && !dlgWin.isDestroyed()) { dlgWin.focus(); dlgWin.webContents.send('dlg:init', payload); return; }
  dlgWin = new BrowserWindow({
    width: 540, height: 460, frame: false, resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, transparent: true,
    icon: iconOf(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'bridge.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  dlgWin.loadFile(path.join(__dirname, '..', 'renderer', 'dialog', 'index.html'));
  dlgWin.once('ready-to-show', () => { dlgWin.show(); dlgWin.webContents.send('dlg:init', payload); });
  dlgWin.on('closed', () => { dlgWin = null; });
}

function createTray() {
  try { tray = new Tray(iconOf('tray.png')); } catch { return; }
  const menu = Menu.buildFromTemplate([
    { label: 'Raad', click: () => showMain() },
    { type: 'separator' },
    { label: T().startDl + ' (All)', click: () => engine.resumeAll() },
    { label: 'Pause All', click: () => engine.pauseAll() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Raad Download Manager');
  tray.setContextMenu(menu);
  tray.on('click', () => showMain());
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createMain();
  else { mainWin.show(); mainWin.focus(); }
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconOf('icon.png'), silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

function broadcast(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, data);
  }
}

/* ---------------- app glue ---------------- */
function applySettings(s) {
  engine.applySettings(s);
  clipWatcher.configure({ enabled: s.clipAuto });
  bridge.setToken(s.token);
  try { app.setLoginItemSettings({ openAtLogin: !!s.autostart, args: ['--hidden'] }); } catch { }
}

async function init() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }

  app.on('second-instance', (_e, argv) => {
    const url = argv.find(a => String(a).startsWith('raad://'));
    if (url) handleDeepLink(url);
    showMain();
  });
  app.on('open-url', (e, url) => { e.preventDefault(); handleDeepLink(url); showMain(); });

  await app.whenReady();
  if (DEV) console.log('[raad] dev mode');

  store = new Store(path.join(app.getPath('userData'), 'raad-data'));
  const settings = { ...defaultSettings(), ...store.get('settings', {}) };
  store.set('settings', settings);

  engine = new Engine(store);
  scheduler = new Scheduler(store, engine);
  clipWatcher = new ClipboardWatcher();
  bridge = new BridgeServer(settings.token);
  applySettings(settings);
  await bridge.start(settings.port);

  /* engine → UI */
  engine.on('added', rec => broadcast('evt', { type: 'dl:added', rec }));
  engine.on('progress', p => broadcast('evt', { type: 'dl:progress', ...p }));
  engine.on('status', s => {
    broadcast('evt', { type: 'dl:status', ...s });
    const rec = engine.get(s.id);
    if (s.status === 'completed') {
      notify(T().done, T().doneBody(rec.filename), () => shell.showItemInFolder(path.join(rec.folder, rec.filename)));
    }
  });
  engine.on('removed', r => broadcast('evt', { type: 'dl:removed', id: r.id }));

  /* scheduler → UI */
  scheduler.on('fired', ({ schedule, effect }) => broadcast('evt', { type: 'sched:fired', schedule, effect }));

  /* clipboard → UI */
  clipWatcher.on('urls', ({ urls }) => {
    if (mainWin && !mainWin.isDestroyed() && mainWin.isFocused()) broadcast('evt', { type: 'clip:urls', urls });
  });

  /* bridge server (extension) → dialog / queue */
  bridge.on('add', (item) => {
    if (store.get('settings', {}).askBefore) {
      createDialog(item);
    } else {
      const { id } = engine.add(item);
      notify(T().startDl, item.url.slice(0, 90));
      broadcast('evt', { type: 'ext:added', id });
    }
  });

  createMain();
  createTray();
  registerIpc();

  if (process.argv.includes('--hidden')) { mainWin.hide(); }

  if (process.env.RAAD_SMOKE) {
    require('./smoke')({
      mainWin: () => mainWin,
      bridge,
      engine,
      store,
      port: () => bridge.port,
      token: () => store.get('settings', {}).token
    });
  }
}

function handleDeepLink(link) {
  try {
    const u = new URL(link.replace('raad://', 'http://'));
    const add = u.searchParams.get('url') || u.searchParams.get('add');
    if (add) bridge.emit('add', { url: add, referrer: '', cookies: '', filename: '', source: 'deeplink' });
  } catch { }
}

/* ---------------- IPC ---------------- */
function registerIpc() {
  const settings = () => store.get('settings', {});

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    locale: app.getLocale(),
    port: bridge.port,
    token: settings().token,
    downloadDir: settings().downloadDir,
    ytAvailable: !!engine._findYtdlp()
  }));

  /* window controls */
  ipcMain.on('win:min', () => mainWin && mainWin.minimize());
  ipcMain.on('win:max', () => mainWin && (mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize()));
  ipcMain.on('win:close', () => mainWin && mainWin.close());
  ipcMain.on('dlg:close', () => dlgWin && dlgWin.close());
  ipcMain.on('dlg:min', () => dlgWin && dlgWin.minimize());

  /* downloads */
  ipcMain.handle('dl:list', (_e, q) => engine.list(q || {}));
  ipcMain.handle('dl:counts', () => engine.counts());
  ipcMain.handle('dl:add', (_e, payload) => {
    const items = Array.isArray(payload.items) ? payload.items : [payload];
    const ids = [];
    for (const it of items) {
      try { ids.push(engine.add({ ...it, start: payload.start !== false })); } catch (err) { ids.push({ error: String(err.message) }); }
    }
    return ids;
  });
  ipcMain.handle('dl:probe', async (_e, { url, referrer = '', cookies = '' }) => {
    try { return await engine.probe(url, { referrer, cookies }); }
    catch (e) { return { ok: false, error: String(e.message || e), url }; }
  });
  ipcMain.handle('dl:control', async (_e, { id, action }) => {
    if (action === 'pause') await engine.pause(id);
    else if (action === 'resume') engine.resume(id);
    else if (action === 'restart') await engine.restart(id);
    return { ok: true };
  });
  ipcMain.handle('dl:pauseAll', () => { engine.pauseAll(); return { ok: true }; });
  ipcMain.handle('dl:resumeAll', () => { engine.resumeAll(); return { ok: true }; });
  ipcMain.handle('dl:remove', (_e, { id, keepFile = true }) => { engine.remove(id, { keepFile }); return { ok: true }; });
  ipcMain.handle('dl:open', (_e, id) => {
    const r = engine.get(id);
    if (r && r.folder) {
      const p = path.join(r.folder, r.filename);
      if (fs.existsSync(p)) shell.openPath(p);
      else shell.openPath(r.folder);
    }
    return { ok: true };
  });
  ipcMain.handle('dl:showInFolder', (_e, id) => {
    const r = engine.get(id);
    if (r && r.folder) shell.showItemInFolder(path.join(r.folder, r.filename));
    return { ok: true };
  });

  /* clipboard */
  ipcMain.handle('clip:read', () => clipboard.readText());
  ipcMain.handle('clip:parse', () => extractUrls(clipboard.readText()));

  /* filesystem pickers */
  ipcMain.handle('fs:pickFolder', async (_e, current) => {
    const r = await dialog.showOpenDialog(dlgWin || mainWin, { defaultPath: current || undefined, properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('fs:pickFile', async (_e, { filters, title }) => {
    const r = await dialog.showOpenDialog(mainWin, { title: title || 'Open', filters: filters || [{ name: 'All', extensions: ['*'] }], properties: ['openFile'] });
    return r.canceled ? null : r.filePaths[0];
  });

  /* settings */
  ipcMain.handle('settings:get', () => settings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const s = { ...settings(), ...patch };
    if (!/^https?:\/\/|^$/.test(s.ytdlpPath || '')) s.ytdlpPath = '';
    if (!Number.isFinite(s.port) || s.port < 1024 || s.port > 65535) s.port = 27500;
    store.set('settings', s);
    applySettings(s);
    if (s.port !== bridge.port) bridge.start(s.port);
    broadcast('evt', { type: 'settings:changed', settings: s });
    return s;
  });

  /* scheduler */
  ipcMain.handle('sched:list', () => scheduler.list());
  ipcMain.handle('sched:save', (_e, item) => scheduler.save(item));
  ipcMain.handle('sched:delete', (_e, id) => { scheduler.remove(id); return { ok: true }; });
  ipcMain.handle('sched:toggle', (_e, id) => scheduler.toggle(id));

  /* IDM import */
  ipcMain.handle('idm:auto', () => idm.importAuto());
  ipcMain.handle('idm:file', async () => {
    const p = await dialog.showOpenDialog(mainWin, {
      title: 'Import IDM export',
      filters: [
        { name: 'IDM History / Export', extensions: ['txt', 'lst', 'log', 'csv', 'reg', 'htm', 'html', 'json'] },
        { name: 'All', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (p.canceled) return { ok: false, canceled: true };
    try {
      const r = idm.importFromFile(p.filePaths[0]);
      return { ok: true, ...r };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('idm:apply', (_e, { entries, settings: guesses }) => {
    let added = 0;
    for (const en of entries || []) {
      if (!en || !en.url) continue;
      try {
        engine.add({
          url: en.url, referrer: en.referrer || '', cookies: '',
          filename: en.filename || '', source: 'idm',
          start: false, folder: ''
        });
        added++;
      } catch { }
    }
    if (guesses && guesses.length) {
      const patch = {};
      for (const g of guesses) patch[g.key] = g.value;
      delete patch.downloadDir; // folder import is explicit
      store.set('settings', { ...settings(), ...patch });
      applySettings(settings());
    }
    return { ok: true, added };
  });
  ipcMain.handle('idm:useFolder', (_e, dir) => {
    const s = { ...settings(), downloadDir: dir };
    store.set('settings', s); applySettings(s);
    return s;
  });

  /* misc */
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });

  /* extension token regen */
  ipcMain.handle('ext:regenToken', () => {
    const s = { ...settings(), token: crypto.randomBytes(12).toString('hex') };
    store.set('settings', s); applySettings(s);
    return s;
  });

  /* dialog window */
  ipcMain.handle('dlg:probe', async (_e, { url, referrer }) => {
    try { return await engine.probe(url, { referrer }); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('dlg:start', (_e, { payload, folder, start = true }) => {
    const { id } = engine.add({
      url: payload.url, referrer: payload.referrer || '', cookies: payload.cookies || '',
      filename: payload.filename || '', source: payload.source || 'dialog',
      folder: folder || '', start
    });
    if (dlgWin) dlgWin.close();
    notify(T().startDl, (payload.filename || payload.url).slice(0, 90));
    return { id };
  });

  /* nativeTheme sync */
  ipcMain.handle('theme:sync', (_e, mode) => {
    nativeTheme.themeSource = mode === 'auto' ? 'system' : mode;
    return { ok: true };
  });
}

/* ---------------- lifecycle ---------------- */
app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  try { engine && engine.shutdown(); } catch { }
  try { scheduler && scheduler.shutdown(); } catch { }
  try { clipWatcher && clipWatcher.shutdown(); } catch { }
  try { bridge && bridge.shutdown(); } catch { }
  try { store && store.flushAll(); } catch { }
});

app.on('window-all-closed', () => {
  // keep running in tray (scheduler & clipboard & extension bridge stay alive)
});

init().catch(e => { console.error('[raad] fatal', e); app.quit(); });
