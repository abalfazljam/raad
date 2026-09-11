'use strict';
/* Raad DM — renderer core: helpers, toasts, modals, context menu */

window.__raadErrors = [];
window.addEventListener('error', e => window.__raadErrors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', e => window.__raadErrors.push('promise: ' + String(e.reason)));

window.$ = (sel, root = document) => root.querySelector(sel);
window.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];

window.h = function (tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;            // trusted internal markup only
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
};

/* ---------- formatting ---------- */
window.fmtBytes = function (n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + u[i];
};
window.fmtSpeed = (n) => (n ? fmtBytes(n) + '/s' : '—');
window.fmtEta = function (s) {
  if (s === null || s === undefined || !isFinite(s)) return '—';
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
};
window.fmtDate = (ts) => ts ? new Date(ts).toLocaleString(window.__raadLang === 'fa' ? 'fa-IR' : 'en-US') : '—';

/* file-type icon tile */
window.fileIcon = function (filename, size = 'md') {
  const ext = (String(filename || '').split('.').pop() || '').toLowerCase();
  const cats = {
    video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'flv', 'wmv', 'ts', '3gp'],
    audio: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'cab', 'bz2', 'xz'],
    program: ['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm', 'jar'],
    document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'csv', 'txt'],
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'psd', 'bmp']
  };
  let cat = 'other';
  for (const [c, list] of Object.entries(cats)) if (list.includes(ext)) { cat = c; break; }
  const label = (ext || 'file').slice(0, 4).toUpperCase();
  return h('div', { class: `f-ic ${cat} ${size === 'lg' ? 'f-ic-lg' : ''}`, text: label });
};

/* ---------- toasts ---------- */
window.toast = function (title, sub = '', kind = 'ok', ms = 4200) {
  const root = $('#toastRoot');
  const icons = {
    ok: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>',
    err: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 3v10.6l3.3-3.3 1.4 1.4-5.7 5.7-5.7-5.7 1.4-1.4 3.3 3.3V3h2zM5 19h14v2H5v-2z"/></svg>'
  };
  const el = h('div', { class: `toast ${kind}` },
    h('div', { class: 't-ic', html: icons[kind] || icons.ok }),
    h('div', { class: 't-msg' }, h('b', { text: title }), sub ? h('span', { text: sub }) : null)
  );
  root.append(el);
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); };
  el.onclick = kill;
  setTimeout(kill, ms);
};

/* ---------- modal framework ---------- */
window.openModal = function ({ title, body, foot, width }) {
  closeModal();
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) closeModal(); } });
  const box = h('div', { class: 'modal-box', style: width ? { width } : {} });
  const head = h('div', { class: 'modal-head' },
    h('h3', { text: title }),
    h('button', { class: 'icon-btn', onclick: closeModal, html: '<svg viewBox="0 0 24 24" width="15" height="15"><path stroke="currentColor" stroke-width="2" fill="none" d="m6 6 12 12M18 6 6 18"/></svg>' })
  );
  const bodyEl = h('div', { class: 'modal-body' });
  if (typeof body === 'function') body(bodyEl); else if (body) bodyEl.append(body);
  box.append(head, bodyEl);
  if (foot) box.append(h('div', { class: 'modal-foot' }, foot));
  overlay.append(box);
  $('#modalRoot').append(overlay);
  setTimeout(() => { const f = box.querySelector('textarea, input'); if (f) f.focus(); }, 60);
  return { overlay, box, body: bodyEl };
};
window.closeModal = () => { $('#modalRoot').innerHTML = ''; };

/* ---------- confirm ---------- */
window.confirmDialog = function (title, text, okLabel) {
  return new Promise(res => {
    const m = openModal({
      title,
      body: h('p', { text, style: { lineHeight: '1.9', color: 'var(--dim)', fontSize: '12.5px' } }),
      foot: [
        h('button', { class: 'btn', onclick: () => { closeModal(); res(false); }, text: t('cancel') }),
        h('button', { class: 'btn danger', onclick: () => { closeModal(); res(true); }, text: okLabel || t('confirm') })
      ]
    });
  });
};

/* ---------- context menu ---------- */
window.showCtx = function (x, y, items) {
  hideCtx();
  const menu = h('div', { class: 'ctx' });
  for (const it of items) {
    if (it === '-') { menu.append(h('div', { class: 'sep' })); continue; }
    menu.append(h('button', {
      class: it.danger ? 'danger' : '', text: it.label,
      onclick: () => { hideCtx(); it.action(); }
    }));
  }
  $('#ctxRoot').append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  setTimeout(() => document.addEventListener('click', hideCtx, { once: true }), 10);
};
window.hideCtx = () => { $('#ctxRoot').innerHTML = ''; };

/* folder picker row (reused) */
window.folderPicker = function (current) {
  const input = h('input', { class: 'input', type: 'text', value: current || '', readonly: '', style: { direction: 'ltr' } });
  const wrap = h('div', { class: 'row' },
    input,
    h('button', {
      class: 'btn sm', text: t('browse'),
      onclick: async () => {
        const dir = await window.raad.fs.pickFolder(input.value);
        if (dir) input.value = dir;
      }
    })
  );
  return { wrap, input };
};
