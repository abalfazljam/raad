'use strict';
/* Raad DM — floating "new download" window (IDM-style) */
let payload = null;

const $ = (s) => document.querySelector(s);

function fmtBytes(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + u[i];
}

async function applyTheme() {
  const s = await window.raad.settings.get();
  const root = document.documentElement;
  root.dataset.mode = s.mode || 'dark';
  root.dataset.style = s.style || 'glass';
  root.dataset.accent = s.accent || 'indigo';
  root.dataset.anim = s.animations === false ? 'off' : 'on';
  document.documentElement.lang = s.language || 'fa';
  document.documentElement.dir = s.language === 'fa' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i]').forEach(el => { el.textContent = t(el.dataset.i); });
}

function fill(p) {
  payload = p;
  $('#dlgName').textContent = p.filename || p.url.split('/').pop() || 'download';
  $('#dlgUrl').textContent = p.url;
  $('#dlgUrl').title = p.url;
  $('#dlgIcon').innerHTML = '';
  const icon = document.createElement('div');
  icon.className = 'f-ic other';
  const extSrc = (p.filename || p.url.split('/').pop() || 'file');
  const ext = (extSrc.split('.').pop() || 'file').slice(0, 4).toUpperCase();
  icon.textContent = ext;
  $('#dlgIcon').append(icon);
  const srcKeys = { extension: 'dlgFromExt', clipboard: 'dlgFromClipboard', manual: 'dlgFromManual', deeplink: 'dlgFromDeeplink', idm: 'dlgFromIdm' };
  $('#dlgSrc').textContent = t(srcKeys[p.source] || 'dlgFromManual');
  $('#dlgFolder').value = window.__dlgFolder || '';
  probe();
}

async function probe() {
  $('#dlgSpin').style.display = '';
  $('#dlgSize').textContent = '…';
  try {
    const r = await window.raad.dlg.probe({ url: payload.url, referrer: payload.referrer || '' });
    if (r.ok) {
      payload.filename = r.filename || payload.filename;
      if (r.filename) $('#dlgName').textContent = r.filename;
      $('#dlgSize').textContent = r.size ? fmtBytes(r.size) : t('unknown');
    } else {
      $('#dlgSize').textContent = t('unknown');
    }
  } catch {
    $('#dlgSize').textContent = t('unknown');
  }
  $('#dlgSpin').style.display = 'none';
}

async function start(startNow) {
  if (!payload) return window.raad.dlg.close();
  await window.raad.dlg.start({ payload, folder: $('#dlgFolder').value || '', start: startNow });
}

(async function init() {
  await applyTheme();
  const info = await window.raad.appInfo();
  window.__dlgFolder = info.downloadDir;
  $('#dlgFolder').value = info.downloadDir;

  // payload arrives from main on ready
  if (window.__dlgInit) fill(window.__dlgInit);
  window.addEventListener('dlg:init', (e) => fill(e.detail));

  $('#dlgMin').onclick = () => window.raad.dlg.min();
  $('#dlgClose').onclick = () => window.raad.dlg.close();
  $('#dlgCancel').onclick = () => window.raad.dlg.close();
  $('#dlgStart').onclick = () => start(true);
  $('#dlgQueue').onclick = () => start(false);
  $('#dlgBrowse').onclick = async () => {
    const dir = await window.raad.fs.pickFolder($('#dlgFolder').value);
    if (dir) { $('#dlgFolder').value = dir; window.__dlgFolder = dir; }
  };
})();
