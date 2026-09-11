'use strict';
/* Raad DM — views: downloads / scheduler / idm / settings */
window.Views = {};
const state = {
  filter: 'all', search: '',
  rows: new Map(),        // id -> {root, pct, pbar, meta, chip, act}
  speeds: new Map(),      // id -> speed (for status bar total)
  settings: {}, info: {}
};

/* ═══════════════════ DOWNLOADS ═══════════════════ */
Views.renderDownloads = async function (root) {
  root.innerHTML = '';
  const toolbar = h('div', { class: 'dl-toolbar' },
    h('div', { class: 'top' },
      h('div', { class: 'search' },
        h('svg', { viewBox: '0 0 24 24', width: '14', height: '14', html: '<path fill="currentColor" d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/>' }),
        searchInput = h('input', { class: 'input', type: 'text', placeholder: t('phSearch'), oninput: (e) => { state.search = e.target.value; Views.refreshList(); } })
      ),
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', title: t('btnStartAll'), html: ic.play + '<span>' + t('btnStartAll') + '</span>', onclick: () => { window.raad.dl.resumeAll(); toast(t('ok'), t('btnStartAll')); } }),
      h('button', { class: 'btn', title: t('btnPauseAll'), html: ic.pause + '<span>' + t('btnPauseAll') + '</span>', onclick: () => { window.raad.dl.pauseAll(); toast(t('ok'), t('btnPauseAll')); } }),
      h('button', { class: 'btn', id: 'btnPaste', onclick: Views.clipboardModal, html: ic.clip + '<span>' + t('btnPaste') + '</span>' }),
      h('button', { class: 'btn primary', onclick: Views.addModal, html: ic.plus + '<span>' + t('btnAdd') + '</span>' })
    ),
    filterBar = h('div', { class: 'filters' })
  );
  root.append(toolbar, listEl = h('div', { class: 'dl-list' }));
  state.searchInput = searchInput;
  await Views.refreshFilters();
  Views.refreshList(true);
};

let listEl = null, filterBar = null, searchInput = null;

/* progress events are coalesced into one DOM flush every 250ms — keeps the UI
 * smooth and light on the GPU even with dozens of simultaneous downloads */
const dirty = new Map();
let flushT = null;
Views.noteProgress = function (e) {
  dirty.set(e.id, e);
  if (!flushT) flushT = setTimeout(flushProgress, 250);
};
function flushProgress() {
  flushT = null;
  for (const [id, ev] of dirty) {
    const entry = state.rows.get(id);
    if (!entry) continue;
    const r = entry.rec;
    r.received = ev.received; r.size = ev.size; r.speed = ev.speed; r.eta = ev.eta;
    entry.pct.textContent = pctText(r);
    entry.pbar.style.width = pctW(r);
    renderMeta(entry, r);
    state.speeds.set(id, ev.speed || 0);
  }
  dirty.clear();
  updateStatusTotals();
}

const ic = {
  plus: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/></svg>',
  clip: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2a3 3 0 0 1 6 0zm-2 0a1 1 0 1 0-2 0 1 1 0 0 0 2 0zm-2 6v2H8v-2h4zm0 4v2H8v-2h4z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M7 5h4v14H7V5zm6 0h4v14h-4V5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M8 5.1v13.8c0 .8.9 1.3 1.6.9l10.9-6.9c.6-.4.6-1.4 0-1.8L9.6 4.2c-.7-.4-1.6.1-1.6.9z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>',
  open: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>',
  retry: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 12H7L6 9z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="m10.2 3 .4 2.2c-.7.3-1.3.6-1.9 1.1l-2.1-.8-1.8 3.1 1.7 1.4a7 7 0 0 0 0 2.2l-1.7 1.4 1.8 3.1 2.1-.8c.6.5 1.2.8 1.9 1.1l-.4 2.2h3.6l.4-2.2c.7-.3 1.3-.6 1.9-1.1l2.1.8 1.8-3.1-1.7-1.4a7 7 0 0 0 0-2.2l1.7-1.4-1.8-3.1-2.1.8c-.6-.5-1.2-.8-1.9-1.1L13.8 3h-3.6zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l4 2.3-.8 1.6L11 13.5V7h2z"/></svg>'
};

Views.refreshFilters = async function () {
  const counts = await window.raad.dl.counts();
  const tabs = [['all', 'fAll'], ['active', 'fActive'], ['paused', 'fPaused'], ['done', 'fDone'], ['failed', 'fFailed']];
  filterBar.innerHTML = '';
  for (const [key, label] of tabs) {
    filterBar.append(h('button', {
      class: 'ftab' + (state.filter === key ? ' on' : ''),
      onclick: () => { state.filter = key; Views.refreshFilters(); Views.refreshList(true); }
    }, h('span', { text: t(label) }), h('span', { class: 'n', text: counts[key] || 0 })));
  }
  const badge = $('#badgeActive');
  if (counts.active) { badge.hidden = false; badge.textContent = counts.active; } else badge.hidden = true;
  $('#stActive').textContent = (counts.active ? counts.active + ' × ' + t('stDownloading') : t('stReady'));
};

Views.refreshList = async function (rebuild = false) {
  const rows = await window.raad.dl.list({ filter: state.filter, search: state.search });
  if (rebuild) {
    state.rows.clear(); state.speeds.clear();
    listEl.innerHTML = '';
    if (!rows.length) {
      listEl.append(h('div', { class: 'empty' },
        h('div', { class: 'e-ic', html: '<svg viewBox="0 0 24 24" width="38" height="38"><path fill="currentColor" d="M13 2 4.5 13.5h5.2L8.6 22l8.9-11.5h-5.3L13 2z"/></svg>' }),
        h('h4', { text: t('emptyTitle') }),
        h('p', { text: t('emptyText') })
      ));
      updateStatusTotals();
      return;
    }
    const frag = document.createDocumentFragment();
    rows.forEach(r => frag.append(buildRow(r)));
    listEl.append(frag);
  } else {
    // remove rows no longer in list
    for (const [id, el] of state.rows) if (!rows.find(r => r.id === id)) { el.root.remove(); state.rows.delete(id); }
  }
  updateStatusTotals();
};

function updateStatusTotals() {
  let total = 0;
  for (const s of state.speeds.values()) total += s;
  const txt = fmtSpeed(total);
  $('#stSpeed').textContent = txt;
  $('#statTotalSpeed').textContent = txt;
}

function chipFor(r) {
  const map = { queued: '', downloading: 'acc', paused: 'warn', completed: 'ok', failed: 'err' };
  return h('span', { class: 'chip ' + (map[r.status] || ''), text: t(r.status) });
}

function buildRow(r) {
  const chip = chipFor(r);
  const name = h('div', { class: 'dl-name', title: r.filename, text: r.filename });
  const urlEl = h('div', { class: 'dl-url', title: r.url, text: r.url });
  const pct = h('span', { class: 'dl-pct', text: pctText(r) });
  const pbar = h('div', { class: 'pbar dl-pbar' }, h('i', { style: { width: pctW(r) } }));
  const meta = h('div', { class: 'dl-meta' });
  const act = h('div', { class: 'dl-act' });
  const root = h('div', { class: 'dl-row' },
    fileIcon(r.filename),
    h('div', { class: 'dl-mid' },
      h('div', { class: 'dl-line1' }, name, chip),
      urlEl,
      h('div', { class: 'dl-prog' }, pbar, pct),
      meta
    ),
    act
  );
  const entry = { root, chip, pct, pbar: pbar.firstChild, meta, act, rec: r };
  state.rows.set(r.id, entry);
  state.speeds.set(r.id, r.status === 'downloading' ? (r.speed || 0) : 0);
  renderMeta(entry, r);
  renderAct(entry, r);
  root.addEventListener('contextmenu', (e) => { e.preventDefault(); rowMenu(e, r); });
  root.addEventListener('dblclick', () => window.raad.dl.open(r.id));
  return root;
}

function pctText(r) {
  if (r.status === 'completed') return '✓';
  if (r.size) return Math.floor((r.received / r.size) * 100) + '%';
  return r.status === 'downloading' ? '…' : '—';
}
function pctW(r) {
  if (r.status === 'completed') return '100%';
  if (!r.size) return r.status === 'downloading' ? '30%' : '0%';
  return Math.min(100, (r.received / r.size) * 100) + '%';
}

function renderMeta(entry, r) {
  const { meta } = entry;
  meta.innerHTML = '';
  const parts = [];
  if (r.status === 'downloading') {
    parts.push(h('span', { class: 'speed-tag', text: fmtSpeed(r.speed) }));
    parts.push(h('span', { class: 'sep', text: '•' }));
    parts.push(h('span', { class: 'eta-tag', text: t('eta') + ': ' + fmtEta(r.eta) }));
    parts.push(h('span', { class: 'sep', text: '•' }));
  }
  parts.push(h('span', { text: fmtBytes(r.received) + (r.size ? ' / ' + fmtBytes(r.size) : '') }));
  if (r.completedAt) {
    parts.push(h('span', { class: 'sep', text: '•' }));
    parts.push(h('span', { text: fmtDate(r.completedAt) }));
  }
  if (r.error) {
    parts.push(h('span', { class: 'sep', text: '•' }));
    parts.push(h('span', { class: 'err-text', title: r.error, text: r.error.slice(0, 80) }));
  }
  meta.append(...parts);
}

function renderAct(entry, r) {
  const { act } = entry;
  act.innerHTML = '';
  const btn = (icon, tip, fn, cls = '') => h('button', { class: 'icon-btn ' + cls, title: tip, html: icon, onclick: fn });
  if (r.status === 'downloading' || r.status === 'queued')
    act.append(btn(ic.pause, t('paused'), () => window.raad.dl.control(r.id, 'pause')));
  else if (r.status === 'paused' || r.status === 'failed')
    act.append(btn(ic.play, t('fActive'), () => window.raad.dl.control(r.id, 'resume')));
  if (r.status === 'completed')
    act.append(btn(ic.open, t('ctxOpen'), () => window.raad.dl.open(r.id)));
  act.append(btn(ic.folder, t('ctxFolder'), () => window.raad.dl.showInFolder(r.id)));
  act.append(btn(ic.trash, t('ctxRemove'), () => rowMenuRemove(r), 'danger'));
}

function rowMenu(e, r) {
  showCtx(e.clientX, e.clientY, [
    { label: t('ctxOpen'), action: () => window.raad.dl.open(r.id), },
    { label: t('ctxFolder'), action: () => window.raad.dl.showInFolder(r.id) },
    { label: t('ctxCopyUrl'), action: async () => { await navigator.clipboard.writeText(r.url); toast(t('copied'), r.url.slice(0, 60)); } },
    '-',
    { label: t('ctxRestart'), action: () => window.raad.dl.control(r.id, 'restart') },
    { label: t('ctxRemove'), action: () => window.raad.dl.remove(r.id, true) },
    { label: t('ctxRemoveFile'), danger: true, action: () => window.raad.dl.remove(r.id, false) }
  ]);
}
function rowMenuRemove(r) {
  confirmDialog(t('confirmRemoveTitle'), t('confirmRemoveText').replace('{name}', r.filename), t('confirm'))
    .then(ok => { if (ok) { window.raad.dl.remove(r.id, true); toast(t('dlGone'), r.filename); } });
}

/* ---- add modal ---- */
Views.addModal = function () {
  const fp = folderPicker(state.settings.downloadDir);
  let startNow = true;
  const cb = h('input', { type: 'checkbox', class: 'checkbox', checked: '' });
  cb.onchange = () => startNow = cb.checked;
  const ta = h('textarea', { class: 'input', placeholder: t('phUrls'), rows: 4, style: { direction: 'ltr' } });
  openModal({
    title: t('addTitle'),
    body: (b) => b.append(
      h('div', { class: 'field' }, h('label', { text: t('addUrls') }), ta),
      h('div', { class: 'field' }, h('label', { text: t('addFolder') }), fp.wrap),
      h('label', { class: 'row', style: { gap: '9px', cursor: 'pointer' } }, cb, h('span', { text: t('addStartNow') }))
    ),
    foot: [
      h('button', { class: 'btn', onclick: closeModal, text: t('cancel') }),
      h('button', {
        class: 'btn primary', text: t('addBtn'),
        onclick: async () => {
          const urls = ta.value.split(/\s+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s) || /^ftp:\/\//i.test(s));
          if (!urls.length) return toast(t('err'), t('addInvalid'), 'err');
          const res = await window.raad.dl.add({ items: urls.map(u => ({ url: u })), folder: fp.input.value || '', start: startNow });
          const ok = res.filter(x => !x.error && !x.existed).length;
          if (ok) toast(t('ok'), t('addedN').replace('{n}', ok));
          const dup = res.filter(x => x.existed).length;
          if (dup) toast(t('alreadyActive'), '', 'warn');
          closeModal();
        }
      })
    ]
  });
};

/* ---- clipboard modal (single + multi link import) ---- */
Views.clipboardModal = async function (preUrls) {
  const urls = preUrls || await window.raad.clip.parse();
  if (!urls.length) return toast(t('clipEmpty'), '', 'warn');
  const boxes = [];
  const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '260px', overflowY: 'auto' } });
  for (const u of urls) {
    const cb = h('input', { type: 'checkbox', class: 'checkbox', checked: '' });
    boxes.push({ cb, url: u });
    const name = decodeURIComponent((new URL(u)).pathname.split('/').pop() || '') || u.slice(0, 40);
    list.append(h('label', { class: 'row', style: { padding: '7px 6px', borderRadius: '9px', cursor: 'pointer' }, onmouseenter: e => e.currentTarget.style.background = 'var(--hover)', onmouseleave: e => e.currentTarget.style.background = '' },
      cb, h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontWeight: 600, fontSize: '12px', direction: 'ltr', textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: name }),
        h('div', { style: { fontSize: '10.5px', color: 'var(--dim)', direction: 'ltr', textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: u })
      )
    ));
  }
  const countBtn = h('button', {
    class: 'btn primary', text: t('clipAddN').replace('{n}', boxes.length),
    onclick: async () => {
      const sel = boxes.filter(b => b.cb.checked).map(b => ({ url: b.url }));
      if (!sel.length) return;
      const res = await window.raad.dl.add({ items: sel, start: true });
      const ok = res.filter(x => !x.error && !x.existed).length;
      toast(t('ok'), t('addedN').replace('{n}', ok));
      closeModal();
    }
  });
  const allCb = h('input', { type: 'checkbox', class: 'checkbox', checked: '' });
  allCb.onchange = () => { boxes.forEach(b => b.cb.checked = allCb.checked); updateCount(); };
  for (const b of boxes) b.cb.onchange = updateCount;
  function updateCount() { countBtn.textContent = t('clipAddN').replace('{n}', boxes.filter(b => b.cb.checked).length); }
  openModal({
    title: t('clipTitle'),
    body: (b) => b.append(
      h('p', { style: { fontSize: '11.5px', color: 'var(--dim)', lineHeight: 1.9 }, text: t('clipHint') }),
      h('div', { class: 'row between' }, h('label', { class: 'row', style: { gap: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 } }, allCb, h('span', { text: t('clipSelectAll') })), h('span', { class: 'chip acc', text: urls.length + ' URL' })),
      list
    ),
    foot: [
      h('button', { class: 'btn', onclick: closeModal, text: t('cancel') }),
      countBtn
    ]
  });
}

/* ═══════════════════ SCHEDULER ═══════════════════ */
Views.renderScheduler = async function (root) {
  root.innerHTML = '';
  const head = h('div', { class: 'view-head' },
    h('h2', { html: ic.clock + '<span>' + t('schTitle') + '</span>' }),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', html: ic.plus + '<span>' + t('schNew') + '</span>', onclick: () => schedModal() }))
  );
  const grid = h('div', { class: 'sched-grid stagger' });
  root.append(head, grid);
  const items = await window.raad.sched.list();
  if (!items.length) {
    grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } },
      h('div', { class: 'e-ic', html: '<svg viewBox="0 0 24 24" width="38" height="38"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l4 2.3-.8 1.6L11 13.5V7h2z"/></svg>' }),
      h('h4', { text: t('schNone') }), h('p', { text: t('schNoneText') })
    ));
    return;
  }
  for (const s of items) grid.append(schedCard(s));
};

function schedCard(s) {
  const swInput = h('input', { type: 'checkbox', checked: s.enabled ? '' : null, onchange: async (e) => {
    const updated = await window.raad.sched.toggle(s.id);
    if (updated) s.enabled = updated.enabled;
  } });
  const sw = h('label', { class: 'switch' }, swInput, h('span', { class: 'track' }), h('span', { class: 'knob' }));
  return h('div', { class: 'card sched-card' },
    h('div', { class: 's-top' },
      h('div', { class: 's-ic', html: ic.clock }),
      h('h4', { text: s.name }), sw
    ),
    h('div', { class: 's-meta' },
      h('span', { html: '<b>' + t('schStart') + ':</b> ' + s.start }),
      s.end ? h('span', { html: '<b>' + t('schEnd') + ':</b> ' + s.end }) : null,
      h('span', { html: '<b>' + t('schAction') + ':</b> ' + (s.action === 'start' ? t('schActStart') : t('schActPause')) }),
      s.shutdown ? h('span', { class: 'chip warn', text: '⏻ ' + t('schShutdown') }) : null,
      h('div', { class: 'days' }, (s.days || []).map(d => h('span', { class: 'day-chip', text: t('d' + d) })))
    ),
    h('div', { class: 's-foot' },
      h('div', { class: 'row', style: { gap: '2px' } },
        h('button', { class: 'icon-btn', title: t('schEdit'), html: ic.gear, onclick: () => schedModal(s) }),
        h('button', { class: 'icon-btn danger', title: t('schDelete'), html: ic.trash, onclick: async () => { await window.raad.sched.remove(s.id); Views.renderScheduler(currentRoot()); } })
      ),
      h('span', { class: 'chip ' + (s.enabled ? 'ok' : ''), text: s.enabled ? t('schEnabled') : '—' })
    )
  );
}

function currentRoot() { return $('#view-' + state.view); }

function schedModal(existing) {
  const s = existing || { name: '', days: [0, 1, 2, 3, 4, 5, 6], start: '02:00', end: '', action: 'start', shutdown: false, enabled: true };
  const name = h('input', { class: 'input', value: s.name, placeholder: '🌙 ' });
  name.placeholder = window.__raadLang === 'fa' ? 'مثلاً: دانلود شبانه' : 'e.g. Nightly queue';
  const start = h('input', { class: 'input', type: 'time', value: s.start });
  const end = h('input', { class: 'input', type: 'time', value: s.end || '' });
  const action = h('select', { class: 'select' },
    h('option', { value: 'start', text: t('schActStart'), selected: s.action === 'start' ? '' : null }),
    h('option', { value: 'pause', text: t('schActPause'), selected: s.action === 'pause' ? '' : null }));
  const shutdown = h('input', { type: 'checkbox', class: 'checkbox', checked: s.shutdown ? '' : null });
  const dayBoxes = [];
  const daysRow = h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '7px' } });
  for (let d = 0; d < 7; d++) {
    const cb = h('input', { type: 'checkbox', class: 'checkbox', checked: s.days.includes(d) ? '' : null });
    dayBoxes.push({ cb, d });
    daysRow.append(h('label', { class: 'row', style: { gap: '5px', cursor: 'pointer', fontSize: '11.5px' } }, cb, h('span', { text: t('d' + d).slice(0, 3) })));
  }
  openModal({
    title: existing ? t('schEdit') : t('schNew'),
    body: (b) => b.append(
      h('div', { class: 'field' }, h('label', { text: t('schName') }), name),
      h('div', { class: 'row' },
        h('div', { class: 'field', style: { flex: 1 } }, h('label', { text: t('schStart') }), start),
        h('div', { class: 'field', style: { flex: 1 } }, h('label', { text: t('schEnd') + ' (' + t('fPaused') + ')' }), end)
      ),
      h('div', { class: 'field' }, h('label', { text: t('schAction') }), action),
      h('div', { class: 'field' }, h('label', { text: t('schDays') }), daysRow),
      h('label', { class: 'row', style: { gap: '9px', cursor: 'pointer' } }, shutdown, h('span', { text: t('schShutdown') }))
    ),
    foot: [
      h('button', { class: 'btn', onclick: closeModal, text: t('cancel') }),
      h('button', {
        class: 'btn primary', text: t('schSave'),
        onclick: async () => {
          await window.raad.sched.save({
            ...s, id: existing && existing.id,
            name: name.value || 'Schedule',
            start: start.value || '00:00',
            end: end.value || '',
            action: action.value,
            shutdown: shutdown.checked,
            days: dayBoxes.filter(x => x.cb.checked).map(x => x.d),
            enabled: true
          });
          toast(t('ok'), name.value);
          closeModal();
          Views.renderScheduler(currentRoot());
        }
      })
    ]
  });
}
