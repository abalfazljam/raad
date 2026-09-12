'use strict';
/* Raad DM — preload bridge (contextIsolation-safe API exposed as window.raad) */
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('evt', (_e, data) => listeners.forEach(fn => { try { fn(data); } catch { } }));
ipcRenderer.on('dlg:init', (_e, data) => { window.__dlgInit = data; window.dispatchEvent(new CustomEvent('dlg:init', { detail: data })); });
ipcRenderer.on('complete:init', (_e, data) => { window.__completeInit = data; window.dispatchEvent(new CustomEvent('complete:init', { detail: data })); });

contextBridge.exposeInMainWorld('raad', {
  /* events from main */
  onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /* app info */
  appInfo: () => ipcRenderer.invoke('app:info'),

  /* window controls */
  win: {
    min: () => ipcRenderer.send('win:min'),
    max: () => ipcRenderer.send('win:max'),
    close: () => ipcRenderer.send('win:close'),
    showMain: () => ipcRenderer.send('win:showMain')   /* v1.7: from tray-style windows */
  },
  /* v1.7: floating progress window */
  prog: {
    close: () => ipcRenderer.send('prog:close'),
    min: () => ipcRenderer.send('prog:min'),
    rows: (n) => ipcRenderer.send('prog:rows', n)
  },
  /* v1.7: per-file completion card — open / folder / copy / drag */
  comp: {
    close: () => ipcRenderer.send('complete:close'),
    dragFile: (p) => ipcRenderer.send('drag:file', p),
    copyFile: (p) => ipcRenderer.invoke('clip:copyFile', p)
  },
  dlg: {
    close: () => ipcRenderer.send('dlg:close'),
    min: () => ipcRenderer.send('dlg:min'),
    start: (payload) => ipcRenderer.invoke('dlg:start', payload),
    probe: (q) => ipcRenderer.invoke('dlg:probe', q)
  },

  /* downloads */
  dl: {
    list: (q) => ipcRenderer.invoke('dl:list', q),
    counts: () => ipcRenderer.invoke('dl:counts'),
    add: (payload) => ipcRenderer.invoke('dl:add', payload),
    probe: (q) => ipcRenderer.invoke('dl:probe', q),
    control: (id, action) => ipcRenderer.invoke('dl:control', { id, action }),
    pauseAll: () => ipcRenderer.invoke('dl:pauseAll'),
    resumeAll: () => ipcRenderer.invoke('dl:resumeAll'),
    remove: (id, keepFile = true) => ipcRenderer.invoke('dl:remove', { id, keepFile }),
    open: (id) => ipcRenderer.invoke('dl:open', id),
    showInFolder: (id) => ipcRenderer.invoke('dl:showInFolder', id)
  },

  /* clipboard */
  clip: {
    read: () => ipcRenderer.invoke('clip:read'),
    parse: () => ipcRenderer.invoke('clip:parse')
  },
  /* filesystem */
  fs: {
    pickFolder: (current) => ipcRenderer.invoke('fs:pickFolder', current),
    pickFile: (opts) => ipcRenderer.invoke('fs:pickFile', opts)
  },

  /* settings */
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },

  /* scheduler */
  sched: {
    list: () => ipcRenderer.invoke('sched:list'),
    save: (item) => ipcRenderer.invoke('sched:save', item),
    remove: (id) => ipcRenderer.invoke('sched:delete', id),
    toggle: (id) => ipcRenderer.invoke('sched:toggle', id)
  },

  /* IDM migration */
  idm: {
    auto: () => ipcRenderer.invoke('idm:auto'),
    file: () => ipcRenderer.invoke('idm:file'),
    apply: (payload) => ipcRenderer.invoke('idm:apply', payload),
    useFolder: (dir) => ipcRenderer.invoke('idm:useFolder', dir)
  },

  /* misc */
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p)
  },
  ext: {
    regenToken: () => ipcRenderer.invoke('ext:regenToken'),
    bridgeInfo: () => ipcRenderer.invoke('ext:bridgeInfo')   /* v1.6: live bridge status */
  },
  theme: { sync: (mode) => ipcRenderer.invoke('theme:sync', mode) },
  relaunch: () => ipcRenderer.invoke('app:relaunch')
});
