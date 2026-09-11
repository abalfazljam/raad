'use strict';
/* Raad DM — renderer bootstrap: theme, language, navigation, live events */
window.state = window.state || {}; // shared with views.js state object

(function boot() {
  const viewMap = {
    downloads: () => Views.renderDownloads($('#view-downloads')),
    scheduler: () => Views.renderScheduler($('#view-scheduler')),
    idm: () => Views.renderIdm($('#view-idm')),
    settings: () => Views.renderSettings($('#view-settings'))
  };
  let currentView = 'downloads';

  window.nav = function (view) {
    if (!viewMap[view]) return;
    currentView = view;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    $$('.view').forEach(v => v.classList.remove('active'));
    const el = $('#view-' + view);
    el.classList.add('active');
    viewMap[view]();
  };

  /* ---------- theme & language ---------- */
  function shade(hex, target, amount) {
    /* mix hex color toward white (target='light') or black (target='dark') by amount 0..1 */
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mix = (c) => Math.round(target === 'light' ? c + (255 - c) * amount : c * (1 - amount));
    return '#' + [mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('');
  }
  function applyTheme(s) {
    if (!s) return;
    const root = document.documentElement;
    root.dataset.mode = s.mode || 'dark';
    root.dataset.style = s.style || 'glass';
    root.dataset.accent = s.accent || 'indigo';
    root.dataset.anim = s.animations === false ? 'off' : 'on';
    root.dataset.deco = s.deco || 'none';
    root.dataset.radius = s.radius || 'md';
    root.dataset.font = s.fontScale || 'm';
    root.dataset.glow = s.glow || 'soft';
    root.dataset.density = s.density || 'comfy';
    if (s.accent === 'custom' && /^#[0-9a-f]{6}$/i.test(s.accentCustom || '')) {
      const c = s.accentCustom;
      root.style.setProperty('--acc', c);
      root.style.setProperty('--acc2', shade(c, 'light', .45));
      root.style.setProperty('--acc-deep', shade(c, 'dark', .3));
    } else {
      root.style.removeProperty('--acc'); root.style.removeProperty('--acc2'); root.style.removeProperty('--acc-deep');
    }
    window.raad && window.raad.theme.sync(s.mode || 'dark');
  }

  window.applyLanguage = async function () {
    const s = await window.raad.settings.get();
    window.__raadLang = s.language || 'fa';
    document.documentElement.lang = window.__raadLang;
    document.documentElement.dir = window.__raadLang === 'fa' ? 'rtl' : 'ltr';
    $('#tbLang span').textContent = window.__raadLang === 'fa' ? 'EN' : 'فا';
    $$('[data-i]').forEach(el => { const v = t(el.dataset.i); if (v) el.textContent = v; });
    $$('[data-ip]').forEach(el => el.placeholder = t(el.dataset.ip));
    nav(currentView);
  };

  /* ---------- titlebar ---------- */
  $('#tbMin').onclick = () => window.raad.win.min();
  $('#tbMax').onclick = () => window.raad.win.max();
  $('#tbClose').onclick = () => window.raad.win.close();
  $('#tbTheme').onclick = async () => {
    const s = await window.raad.settings.get();
    const order = ['dark', 'light', 'auto'];
    const next = order[(order.indexOf(s.mode) + 1) % 3];
    await window.raad.settings.set({ mode: next });
    toast(t('ok'), next === 'dark' ? t('modeDark') : next === 'light' ? t('modeLight') : t('modeAuto'));
  };
  $('#tbLang').onclick = async () => {
    const s = await window.raad.settings.get();
    await window.raad.settings.set({ language: s.language === 'fa' ? 'en' : 'fa' });
  };
  $('#stLimit').onclick = speedLimitModal;

  function speedLimitModal() {
    const input = h('input', { class: 'input', type: 'number', min: 0, step: 0.5, style: { direction: 'ltr' }, value: ((state.settings.speedLimit || 0) / 1048576).toFixed(1) });
    openModal({
      title: t('speedLimit'),
      body: (b) => b.append(h('div', { class: 'field' }, h('label', { text: t('speedLimitUnit') }), input)),
      foot: [
        h('button', { class: 'btn', onclick: closeModal, text: t('cancel') }),
        h('button', {
          class: 'btn primary', text: t('ok'), onclick: async () => {
            const mb = Math.max(0, parseFloat(input.value || '0'));
            await window.raad.settings.set({ speedLimit: Math.round(mb * 1048576) });
            updateLimitLabel(mb);
            closeModal();
          }
        })
      ]
    });
  }
  function updateLimitLabel(mb) { $('#stLimit').textContent = mb > 0 ? t('stLimitOff').replace('خاموش', mb + ' MB/s').replace('off', mb + ' MB/s') : t('stLimitOff'); }

  /* ---------- sidebar ---------- */
  $$('.nav-item').forEach(n => n.onclick = () => nav(n.dataset.view));

  /* ---------- live events from main ---------- */
  window.raad.onEvent(async (e) => {
    switch (e.type) {
      case 'dl:progress': {
        const entry = state.rows.get(e.id);
        if (!entry) break;
        const r = entry.rec;
        r.received = e.received; r.size = e.size; r.speed = e.speed; r.eta = e.eta;
        entry.pct.textContent = pctText(r);
        entry.pbar.style.width = pctW(r);
        renderMeta(entry, r);
        state.speeds.set(e.id, e.speed || 0);
        updateStatusTotals();
        break;
      }
      case 'dl:status': {
        const entry = state.rows.get(e.id);
        const rec = entry ? entry.rec : null;
        if (entry && rec) {
          rec.status = e.status; rec.error = e.error || '';
          entry.chip.className = 'chip ' + ({ queued: '', downloading: 'acc', paused: 'warn', completed: 'ok', failed: 'err' }[e.status] || '');
          entry.chip.textContent = t(e.status);
          entry.pct.textContent = pctText(rec);
          entry.pbar.style.width = pctW(rec);
          renderAct(entry, rec);
          renderMeta(entry, rec);
          state.speeds.set(e.id, e.status === 'downloading' ? (rec.speed || 0) : 0);
          updateStatusTotals();
        }
        Views.refreshFilters();
        if (e.status === 'completed' && rec) entry && entry.root.classList.add('flash');
        break;
      }
      case 'dl:added': {
        if (currentView === 'downloads') {
          const show = state.filter === 'all' || (state.filter === 'active' && ['queued', 'downloading'].includes(e.rec.status));
          if (show && !state.rows.has(e.rec.id)) {
            $('.empty') && $('.empty').remove();
            listEl.prepend(buildRow(e.rec));
          }
        }
        Views.refreshFilters();
        break;
      }
      case 'dl:removed': {
        const entry = state.rows.get(e.id);
        if (entry) { entry.root.remove(); state.rows.delete(e.id); state.speeds.delete(e.id); updateStatusTotals(); }
        Views.refreshFilters();
        break;
      }
      case 'clip:urls':
        toast(t('clipToast').replace('{n}', e.urls.length), e.urls[0].slice(0, 60), 'link');
        if (currentView === 'downloads') Views.clipboardModal(e.urls);
        break;
      case 'sched:fired':
        toast(t('ok'), e.effect === 'started' ? t('schedFiredStart').replace('{name}', e.schedule.name) : t('schedFiredPause').replace('{name}', e.schedule.name));
        break;
      case 'settings:changed':
        applyTheme(e.settings);
        state.settings = e.settings;
        updateLimitLabel((e.settings.speedLimit || 0) / 1048576);
        if (e.settings.language !== window.__raadLang) applyLanguage();
        else nav(currentView);
        break;
      case 'win:max':
        document.documentElement.dataset.winMax = e.value ? '1' : '0';
        break;
      case 'ext:added':
        Views.refreshFilters();
        break;
    }
  });

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'v') { e.preventDefault(); Views.clipboardModal(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); Views.addModal(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); state.searchInput && state.searchInput.focus(); }
    else if (e.key === 'Escape') { closeModal(); hideCtx(); }
  });

  /* ---------- statusbar poll ---------- */
  setInterval(() => Views.refreshFilters && Views.refreshFilters(), 4000);

  /* ---------- init ---------- */
  (async function init() {
    state.settings = await window.raad.settings.get();
    applyTheme(state.settings);
    await applyLanguage();
    const info = await window.raad.appInfo();
    $('#statVersion').textContent = 'Raad v' + info.version;
    updateLimitLabel((state.settings.speedLimit || 0) / 1048576);
    nav('downloads');
  })();
})();
