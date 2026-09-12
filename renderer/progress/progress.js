'use strict';
/* Raad DM v1.7 — floating IDM-style download-progress window.
 * One shared window: every active download becomes a row with a live bar,
 * speed, ETA and pause/resume/cancel. Pops up (main decides when) as soon
 * as a download starts; auto-closes shortly after the list drains.        */

const $ = (s) => document.querySelector(s);
const list = $('#prList');
const rows = new Map();          /* id → {el, fill, pct, spd, eta, sz, state} */
let seenRow = false;
let closeTimer = null;

function fmtBytes(n) {
  if (n === null || n === undefined || isNaN(n) || n <= 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + u[i];
}
function fmtSpeed(n) { return (!n || n <= 0) ? '—' : fmtBytes(n) + '/s'; }
function fmtEta(s) {
  if (s === null || s === undefined || !isFinite(s) || s <= 0) return '—';
  s = Math.round(s);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
const extOf = (name) => ((name || '').split('.').pop() || 'file').slice(0, 4).toUpperCase();

function applyTheme() {
  return window.raad.settings.get().then(s => {
    const root = document.documentElement;
    root.dataset.mode = s.mode || 'dark';
    root.dataset.style = s.style || 'glass';
    root.dataset.accent = s.accent || 'indigo';
    root.dataset.anim = s.animations === false ? 'off' : 'on';
    root.lang = s.language || 'fa';
    root.dir = s.language === 'fa' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i]').forEach(el => { el.textContent = t(el.dataset.i); });
  }).catch(() => { });
}

function reportRows() {
  try { window.raad.prog.rows(Math.max(1, rows.size)); } catch { }
  $('#prEmpty').style.display = rows.size ? 'none' : '';
  if (rows.size) {
    seenRow = true;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  } else if (seenRow && !closeTimer) {
    /* list drained → close shortly (gives the completion cards the stage) */
    closeTimer = setTimeout(() => { try { window.raad.prog.close(); } catch { } }, 1800);
  }
}

const SVG = {
  pause: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="13" height="13"><path stroke="currentColor" stroke-width="2.4" fill="none" d="m6 6 12 12M18 6 6 18"/></svg>',
  retry: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>'
};

function ensureRow(rec) {
  if (!rec || !rec.id) return null;
  if (rows.has(rec.id)) return rows.get(rec.id);

  const el = document.createElement('div');
  el.className = 'pr-row';
  el.innerHTML = `
    <div class="pr-top">
      <div class="pr-ic">${extOf(rec.filename)}</div>
      <div class="pr-name" title="${String(rec.filename || '').replace(/"/g, '&quot;')}">${rec.filename || rec.url || rec.id}</div>
      <div class="pr-pct">0%</div>
      <div class="pr-acts"></div>
    </div>
    <div class="pr-bar"><div class="pr-fill"></div></div>
    <div class="pr-meta">
      <span class="spd">—</span><span>•</span><span class="eta">—</span><span>•</span><span class="sz">—</span>
      <span class="grow"></span><span class="st"></span>
    </div>`;
  const acts = el.querySelector('.pr-acts');
  const row = {
    el, fill: el.querySelector('.pr-fill'), pct: el.querySelector('.pr-pct'),
    spd: el.querySelector('.spd'), eta: el.querySelector('.eta'), sz: el.querySelector('.sz'),
    st: el.querySelector('.st'), state: rec.status || 'queued', size: rec.size || null, received: rec.received || 0
  };

  const mk = (svg, cls, fn, tip) => {
    const b = document.createElement('button');
    b.className = 'pr-btn' + (cls ? ' ' + cls : '');
    b.innerHTML = svg; b.title = tip || '';
    b.onclick = fn; return b;
  };
  row.btnA = mk(SVG.pause, '', () => window.raad.dl.control(rec.id, 'pause'), t('actPause'));
  row.btnB = mk(SVG.x, 'danger', () => { removeRow(rec.id); window.raad.dl.remove(rec.id, true); }, t('ctxRemove'));
  acts.append(row.btnA, row.btnB);
  row.btnRetry = mk(SVG.retry, '', () => window.raad.dl.control(rec.id, 'restart'), t('ctxRestart'));

  list.append(el);
  rows.set(rec.id, row);
  paintState(rec.id, row.state);
  return row;
}

function paintState(id, state, error) {
  const row = rows.get(id);
  if (!row) return;
  row.state = state;
  row.el.classList.toggle('done', state === 'completed');
  row.el.classList.toggle('err', state === 'failed');
  const acts = row.el.querySelector('.pr-acts');
  /* v1.7: buttons follow state — pause↔resume, retry on failure          */
  if (state === 'downloading') { row.btnA.innerHTML = SVG.pause; row.btnA.onclick = () => window.raad.dl.control(id, 'pause'); if (!row.btnA.isConnected) acts.prepend(row.btnA); }
  else if (state === 'paused' || state === 'queued') { row.btnA.innerHTML = SVG.play; row.btnA.onclick = () => window.raad.dl.control(id, 'resume'); if (!row.btnA.isConnected) acts.prepend(row.btnA); }
  if (state === 'failed') { row.st.textContent = t('failed'); acts.prepend(row.btnRetry); }
  else if (row.btnRetry.isConnected) row.btnRetry.remove();
  if (state === 'paused') row.st.textContent = t('paused');
  else if (state === 'queued') row.st.textContent = t('queued');
  else if (state === 'downloading') row.st.textContent = '';
}

function updateRow(p) {
  const row = rows.get(p.id);
  if (!row) return;
  row.received = p.received || 0;
  row.size = p.size || row.size;
  const pct = row.size ? Math.min(100, (row.received / row.size) * 100) : 0;
  row.fill.style.width = pct.toFixed(1) + '%';
  row.pct.textContent = row.size ? Math.floor(pct) + '%' : '—';
  row.spd.textContent = fmtSpeed(p.speed);
  row.eta.textContent = fmtEta(p.eta);
  row.sz.textContent = fmtBytes(row.received) + (row.size ? ' / ' + fmtBytes(row.size) : '');
}

function removeRow(id) {
  const row = rows.get(id);
  if (!row) return;
  rows.delete(id);
  row.el.remove();
  reportRows();
}

window.raad.onEvent((evt) => {
  try {
    switch (evt.type) {
      case 'dl:added':
        if (['queued', 'downloading'].includes(evt.rec && evt.rec.status)) { ensureRow(evt.rec); reportRows(); }
        break;
      case 'dl:status': {
        const st = evt.status;
        if (['queued', 'downloading', 'paused'].includes(st)) {
          if (!rows.has(evt.id)) ensureRow({ id: evt.id, status: st });
          else paintState(evt.id, st);
          reportRows();
        } else if (st === 'completed') {
          const row = rows.get(evt.id);
          if (row) { paintState(evt.id, 'completed'); row.fill.style.width = '100%'; row.pct.textContent = '100%'; setTimeout(() => removeRow(evt.id), 1300); }
        } else if (st === 'failed') {
          paintState(evt.id, 'failed', evt.error); reportRows();
        }
        break;
      }
      case 'dl:progress': updateRow(evt); break;
      case 'dl:removed': removeRow(evt.id); break;
    }
  } catch { }
});

(async function init() {
  await applyTheme();
  $('#prMin').onclick = () => window.raad.prog.min();
  $('#prClose').onclick = () => window.raad.prog.close();
  $('#prPauseAll').onclick = () => window.raad.dl.pauseAll();
  $('#prOpenApp').onclick = () => window.raad.win.showMain();
  /* seed with whatever is already active */
  try {
    const active = await window.raad.dl.list({ filter: 'active' });
    for (const rec of (active || []).slice(0, 8)) ensureRow(rec);
    reportRows();
  } catch { }
})();
