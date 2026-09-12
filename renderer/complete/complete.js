'use strict';
/* Raad DM v1.7 — per-file completion card (IDM-style "download complete").
 * Open the file, reveal it in its folder, copy it to the clipboard
 * (paste with Ctrl+V in Explorer) or DRAG the chip into any folder.       */

const $ = (s) => document.querySelector(s);
let data = null;

function fmtBytes(n) {
  if (n === null || n === undefined || isNaN(n) || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + u[i];
}

async function applyTheme() {
  try {
    const s = await window.raad.settings.get();
    const root = document.documentElement;
    root.dataset.mode = s.mode || 'dark';
    root.dataset.style = s.style || 'glass';
    root.dataset.accent = s.accent || 'indigo';
    root.dataset.anim = s.animations === false ? 'off' : 'on';
    root.lang = s.language || 'fa';
    root.dir = s.language === 'fa' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i]').forEach(el => { el.textContent = t(el.dataset.i); });
  } catch { }
}

function fill(d) {
  if (!d) return;
  data = d;
  $('#cpName').textContent = d.filename || 'file';
  const ext = ((d.filename || '').split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
  $('#cpExt').textContent = ext;
  $('#cpSub').textContent = [fmtBytes(d.size), d.folder].filter(Boolean).join('  •  ');
  $('#cpPath').textContent = d.path || '';
  $('#cpDrag').title = d.path || '';
}

(async function init() {
  await applyTheme();
  if (window.__completeInit) fill(window.__completeInit);
  window.addEventListener('complete:init', (e) => fill(e.detail));

  $('#cpClose').onclick = () => window.raad.comp.close();
  $('#cpOpen').onclick = () => { if (data) window.raad.dl.open(data.id); };
  $('#cpFolder').onclick = () => { if (data) window.raad.dl.showInFolder(data.id); };

  let copyT = null;
  $('#cpCopy').onclick = async () => {
    if (!data || !data.path) return;
    const r = await window.raad.comp.copyFile(data.path);
    const b = $('#cpCopy');
    const old = t('compCopy');
    b.textContent = (r && r.ok) ? t('compCopied') : t('err');
    clearTimeout(copyT);
    copyT = setTimeout(() => { b.textContent = old; }, 2200);
  };

  /* drag the finished file anywhere (Explorer, desktop, …) */
  $('#cpDrag').addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !data || !data.path) return;
    e.preventDefault();
    try { window.raad.comp.dragFile(data.path); } catch { }
  });
})();
