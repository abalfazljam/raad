'use strict';
/* Raad DM — views: settings + IDM migration wizard */
window.Views = window.Views || {};

/* ═══════════════════ SETTINGS ═══════════════════ */
Views.renderSettings = async function (root) {
  root.innerHTML = '';
  const s = state.settings = await window.raad.settings.get();
  state.info = await window.raad.appInfo();

  const head = h('div', { class: 'view-head' },
    h('h2', { html: ic.gear + '<span>' + t('setTitle') + '</span>' }));
  const wrap = h('div', { class: 'settings-wrap' });
  root.append(head, wrap);

  /* ---- General ---- */
  const langSel = h('select', { class: 'select', style: { width: '150px' } },
    h('option', { value: 'fa', text: 'فارسی', selected: s.language === 'fa' ? '' : null }),
    h('option', { value: 'en', text: 'English', selected: s.language === 'en' ? '' : null }));
  langSel.onchange = () => window.raad.settings.set({ language: langSel.value }).then(() => window.applyLanguage());

  const fp = folderPicker(s.downloadDir);
  fp.input.readOnly = true;

  wrap.append(setCard(t('setGeneral'), ic.gear, [
    setRow(t('lang'), t('langDesc'), langSel),
    setRow(t('dlFolder'), '', fp.wrap),
    switchRow(t('categorize'), t('categorizeDesc'), s.categorize, v => window.raad.settings.set({ categorize: v })),
    switchRow(t('askBefore'), t('askBeforeDesc'), s.askBefore, v => window.raad.settings.set({ askBefore: v })),
    switchRow(t('closeToTray'), '', s.closeToTray, v => window.raad.settings.set({ closeToTray: v })),
    switchRow(t('autostart'), '', s.autostart, v => window.raad.settings.set({ autostart: v })),
    switchRow(t('animations'), t('animationsDesc'), s.animations, v => window.raad.settings.set({ animations: v }))
  ]));

  /* ---- Appearance ---- */
  const modeSeg = h('div', { class: 'seg' });
  for (const [val, key] of [['dark', 'modeDark'], ['light', 'modeLight'], ['auto', 'modeAuto']]) {
    modeSeg.append(h('button', {
      class: s.mode === val ? 'on' : '', text: t(key),
      onclick: () => { window.raad.settings.set({ mode: val }); $$('.seg button', modeSeg).forEach(b => b.classList.remove('on')); }
    }));
  }
  const styleSeg = h('div', { class: 'seg' });
  for (const [val, key] of [['glass', 'styleGlass'], ['flat', 'styleFlat'], ['soft', 'styleSoft']]) {
    styleSeg.append(h('button', {
      class: s.style === val ? 'on' : '', text: t(key),
      onclick: () => { window.raad.settings.set({ style: val }); $$('.seg button', styleSeg).forEach(b => b.classList.remove('on')); }
    }));
  }
  const accColors = { indigo: '#6366f1', emerald: '#10b981', amber: '#f59e0b', rose: '#f43f5e', cyan: '#06b6d4', violet: '#8b5cf6' };
  const swatches = h('div', { class: 'swatches' });
  const markSw = (box) => $$('.swatch', box.parentElement || box).forEach(b => b.classList.remove('on'));
  for (const [name, color] of Object.entries(accColors)) {
    swatches.append(h('button', {
      class: 'swatch' + (s.accent === name ? ' on' : ''), title: t('acc' + name[0].toUpperCase() + name.slice(1)),
      style: { background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 60%, #1e293b))` },
      onclick: () => { window.raad.settings.set({ accent: name }); markSw(swatches); }
    }));
  }
  /* custom accent color */
  const colorIn = h('input', {
    type: 'color', class: 'swatch color-swatch' + (s.accent === 'custom' ? ' on' : ''),
    title: t('customAccent'), value: /^#[0-9a-f]{6}$/i.test(s.accentCustom || '') ? s.accentCustom : '#6366f1'
  });
  colorIn.onchange = () => {
    window.raad.settings.set({ accent: 'custom', accentCustom: colorIn.value });
    $$('.swatch').forEach(b => b.classList.remove('on')); colorIn.classList.add('on');
  };
  swatches.append(colorIn);

  /* animated background themes were removed in v1.2 (dark/light + styles remain) */
  /* corner radius */
  const radiusSeg = h('div', { class: 'seg' });
  for (const [val, key] of [['sm', 'rSmall'], ['md', 'rMedium'], ['lg', 'rLarge']]) {
    radiusSeg.append(h('button', {
      class: (s.radius || 'md') === val ? 'on' : '', text: t(key),
      onclick: () => { window.raad.settings.set({ radius: val }); $$('.seg button', radiusSeg).forEach(b => b.classList.remove('on')); }
    }));
  }
  /* text size */
  const fontSeg = h('div', { class: 'seg' });
  for (const [val, key] of [['s', 'fSmall'], ['m', 'fMedium'], ['l', 'fLarge'], ['xl', 'fXLarge']]) {
    fontSeg.append(h('button', {
      class: (s.fontScale || 'm') === val ? 'on' : '', text: t(key),
      onclick: () => { window.raad.settings.set({ fontScale: val }); $$('.seg button', fontSeg).forEach(b => b.classList.remove('on')); }
    }));
  }
  /* background glow intensity */
  const glowSeg = h('div', { class: 'seg' });
  for (const [val, key] of [['off', 'gOff'], ['soft', 'gSoft'], ['vivid', 'gVivid']]) {
    glowSeg.append(h('button', {
      class: (s.glow || 'soft') === val ? 'on' : '', text: t(key),
      onclick: () => { window.raad.settings.set({ glow: val }); $$('.seg button', glowSeg).forEach(b => b.classList.remove('on')); }
    }));
  }
  wrap.append(setCard(t('setAppearance'), '🎨', [
    setRow(t('themeMode'), '', modeSeg),
    setRow(t('styleTheme'), '', styleSeg),
    setRow(t('accent'), t('customAccentDesc'), swatches),
    setRow(t('radiusLabel'), '', radiusSeg),
    setRow(t('fontLabel'), '', fontSeg),
    setRow(t('glowLabel'), '', glowSeg),
    switchRow(t('density'), t('densityDesc'), s.density === 'compact', v => window.raad.settings.set({ density: v ? 'compact' : 'comfy' }))
  ]));

  /* ---- Connection & engine ---- */
  const conn = h('span', { class: 'chip acc', text: String(s.maxConcurrent) });
  const connR = h('input', { type: 'range', min: 1, max: 10, value: s.maxConcurrent });
  connR.oninput = () => conn.textContent = connR.value;
  connR.onchange = () => window.raad.settings.set({ maxConcurrent: +connR.value });

  const segs = h('span', { class: 'chip acc', text: String(s.maxSegments) });
  const segsR = h('input', { type: 'range', min: 1, max: 32, value: s.maxSegments });
  segsR.oninput = () => segs.textContent = segsR.value;
  segsR.onchange = () => window.raad.settings.set({ maxSegments: +segsR.value });

  const speedIn = h('input', { class: 'input', type: 'number', min: 0, step: 0.5, value: (s.speedLimit / 1048576).toFixed(1), style: { width: '90px', direction: 'ltr' } });
  speedIn.onchange = () => window.raad.settings.set({ speedLimit: Math.max(0, Math.round(parseFloat(speedIn.value || '0') * 1048576)) });

  wrap.append(setCard(t('setConnection'), '⚡', [
    setRow(t('maxConn'), '', h('div', { class: 'ctl' }, connR, conn)),
    setRow(t('maxSeg'), t('maxSegDesc'), h('div', { class: 'ctl' }, segsR, segs)),
    setRow(t('speedLimit'), t('speedLimitUnit'), speedIn),
    switchRow(t('useYt'), t('useYtDesc'), s.useYtdlp, v => window.raad.settings.set({ useYtdlp: v })),
    setRow(t('ytStatus'), '', h('span', { class: 'chip ' + (state.info.ytAvailable ? 'ok' : ''), text: state.info.ytAvailable ? t('ytFound') : t('ytMissing') }))
  ]));

  /* ---- Clipboard ---- */
  wrap.append(setCard(t('setClipboard'), '📋', [
    switchRow(t('clipAuto'), t('clipAutoDesc'), s.clipAuto, v => window.raad.settings.set({ clipAuto: v }))
  ]));

  /* ---- Browser extension ---- */
  const tokenIn = h('code', { class: 'mono', text: s.token.slice(0, 6) + '••••••••••••' + s.token.slice(-4), title: s.token });
  const portIn = h('input', { class: 'input', type: 'number', value: s.port, style: { width: '110px', direction: 'ltr' } });
  portIn.onchange = () => window.raad.settings.set({ port: +portIn.value }).then(() => toast(t('ok'), 'port → ' + portIn.value));
  const copyCfg = h('button', {
    class: 'btn sm', text: t('extCopyConfig'),
    onclick: async () => {
      await navigator.clipboard.writeText(JSON.stringify({ port: state.info.port, token: s.token }));
      toast(t('extCopied'), 'JSON config', 'ok');
    }
  });
  const regenBtn = h('button', {
    class: 'btn sm ghost', text: t('extRegen'),
    onclick: async () => { const ns = await window.raad.ext.regenToken(); tokenIn.textContent = ns.token.slice(0, 6) + '••••••••••••' + ns.token.slice(-4); tokenIn.title = ns.token; toast(t('ok'), t('extRegen')); }
  });
  wrap.append(setCard(t('setExt'), '🌐', [
    setRow(t('extPort'), '127.0.0.1', portIn),
    setRow(t('extToken'), '', h('div', { class: 'ctl' }, tokenIn, regenBtn)),
    setRow('', '', copyCfg),
    accordion(t('extGuide'), t('extSteps'))
  ]));

  /* ---- IDM ---- */
  wrap.append(setCard(t('setIdm'), '⬇', [
    setRow(t('idmAuto'), t('idmAutoDesc'), h('button', { class: 'btn sm primary', text: t('navIdm'), onclick: () => window.nav('idm') })),
    setRow(t('idmFile'), t('idmFileDesc'), h('button', { class: 'btn sm', text: t('idmFile'), onclick: () => window.nav('idm') }))
  ]));

  /* ---- About ---- */
  wrap.append(setCard(t('setAbout'), '💙', [
    h('p', { style: { fontSize: '12px', color: 'var(--dim)', lineHeight: 2 }, text: t('aboutText') }),
    h('div', { class: 'row', style: { gap: '8px', marginTop: '6px' } },
      h('span', { class: 'chip acc', text: 'Raad v' + state.info.version }),
      h('span', { class: 'chip', text: 'Electron / Chromium' })
    )
  ]));
};

function setCard(title, iconSvg, children) {
  return h('div', { class: 'card set-card' },
    h('h3', { html: (iconSvg.startsWith('<') ? iconSvg : `<span style="font-size:15px">${iconSvg}</span>`) + `<span>${title}</span>` }),
    ...children);
}
function setRow(label, desc, control) {
  return h('div', { class: 'set-row' },
    h('div', { class: 'lab' }, h('b', { text: label }), desc ? h('span', { text: desc }) : null),
    h('div', { class: 'ctl' }, control));
}
function switchRow(label, desc, val, on) {
  const input = h('input', { type: 'checkbox', checked: val ? '' : null, onchange: (e) => on(e.target.checked) });
  return h('div', { class: 'set-row' },
    h('div', { class: 'lab' }, h('b', { text: label }), desc ? h('span', { text: desc }) : null),
    h('div', { class: 'ctl' }, h('label', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', { class: 'knob' }))));
}
function accordion(title, htmlContent) {
  const body = h('div', { class: 'accord-body', html: htmlContent ? '<ol>' + htmlContent + '</ol>' : '' });
  const head = h('div', { class: 'accord-head', onclick: () => { head.classList.toggle('open'); body.classList.toggle('open'); } },
    h('b', { style: { fontSize: '12.5px' }, text: title }),
    h('span', { class: 'caret', html: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="m9 5 7 7-7 7-1.4-1.4L13.2 12 7.6 6.4 9 5z"/></svg>' }));
  return h('div', {}, head, body);
}

/* ═══════════════════ IDM WIZARD ═══════════════════ */
Views.renderIdm = function (root) {
  root.innerHTML = '';
  let resultsBox = null;
  const head = h('div', { class: 'view-head' },
    h('h2', { html: ic.folder + '<span>' + t('navIdm') + '</span>' }));
  const wrap = h('div', { class: 'idm-wrap' });
  root.append(head, wrap);

  const autoCard = h('div', { class: 'card idm-opt', onclick: () => runAuto() },
    h('div', { class: 'o-ic', html: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V17h2v-1.5h4V17h2v-2.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7zM9 21h6v2H9v-2z"/></svg>' }),
    h('h4', { text: t('idmAuto') }),
    h('p', { text: t('idmAutoDesc') }),
    h('div', { class: 'go', html: '<span>' + t('navIdm') + '</span> <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="m9 5 7 7-7 7-1.4-1.4L13.2 12 7.6 6.4 9 5z"/></svg>' })
  );
  const fileCard = h('div', { class: 'card idm-opt', onclick: () => runFile() },
    h('div', { class: 'o-ic', html: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>' }),
    h('h4', { text: t('idmFile') }),
    h('p', { text: t('idmFileDesc') }),
    h('div', { class: 'go', html: '<span>' + t('navIdm') + '</span> <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="m9 5 7 7-7 7-1.4-1.4L13.2 12 7.6 6.4 9 5z"/></svg>' })
  );

  wrap.append(
    h('div', { class: 'idm-cards' }, autoCard, fileCard),
    h('div', { class: 'card', style: { padding: '16px 18px' } },
      h('h3', { style: { fontSize: '13px', marginBottom: '9px' }, text: t('idmHowTitle') }),
      h('div', { class: 'accord-body open', html: '<ol style="padding-inline-start:18px">' + t('idmSteps') + '</ol>' })
    ),
    resultsBox = h('div', { class: 'idm-results' })
  );
  async function runAuto() {
    autoCard.style.pointerEvents = 'none';
    autoCard.querySelector('.go').textContent = '…';
    const r = await window.raad.idm.auto();
    autoCard.style.pointerEvents = '';
    if (!r.ok) { toast(t('err'), r.error || '', 'err', 8000); return; }
    showResults(r);
  }
  async function runFile() {
    const r = await window.raad.idm.file();
    if (!r.ok) { if (!r.canceled) toast(t('err'), r.error || '', 'err'); return; }
    showResults(r);
  }

  function showResults(r) {
    resultsBox.innerHTML = '';
    const applied = [];
    resultsBox.append(h('div', { class: 'idm-sums' },
      h('div', { class: 'sum-chip' }, h('b', { text: r.entries.length }), h('span', { text: t('idmFound') })),
      h('div', { class: 'sum-chip' }, h('b', { text: (r.settings || []).length }), h('span', { text: t('idmSettings') })),
      h('div', { class: 'sum-chip' }, h('b', { text: r.totalValues || '—' }), h('span', { text: t('idmValues') }))
    ));

    if (r.settings && r.settings.length) {
      const guessCard = h('div', { class: 'card', style: { padding: '14px 18px' } }, h('h3', { style: { fontSize: '13px', marginBottom: '4px' }, text: t('idmGuess') }));
      for (const g of r.settings) {
        const appliedCb = h('input', { type: 'checkbox', class: 'checkbox', checked: '' });
        appliedCb.onchange = () => {
          if (appliedCb.checked) { if (!applied.includes(g)) applied.push(g); }
          else { const i = applied.indexOf(g); if (i >= 0) applied.splice(i, 1); }
        };
        guessCard.append(h('div', { class: 'guess-row' },
          appliedCb,
          h('code', { class: 'mono mono-dir', text: g.key }),
          h('span', { style: { fontSize: '12px', color: 'var(--dim)', flex: 1 }, text: g.label }),
          g.key === 'downloadDir' ? h('button', {
            class: 'btn sm', text: t('idmUseFolder'),
            onclick: async () => { await window.raad.idm.useFolder(g.value); toast(t('ok'), g.value); }
          }) : null
        ));
      }
      resultsBox.append(guessCard);
    }

    if (!r.entries.length) {
      resultsBox.append(h('div', { class: 'card', style: { padding: '20px', color: 'var(--dim)', fontSize: '12.5px', lineHeight: 2 }, text: t('idmNoEntries') }));
      return;
    }

    const boxes = [];
    const allCb = h('input', { type: 'checkbox', class: 'checkbox', checked: '' });
    allCb.onchange = () => boxes.forEach(b => b.cb.checked = allCb.checked);
    const body = h('div', { class: 'idm-body' });
    for (const en of r.entries) {
      const cb = h('input', { type: 'checkbox', class: 'checkbox', checked: '' });
      boxes.push({ cb, en });
      body.append(h('div', { class: 'idm-tr' },
        cb,
        h('span', { class: 'url', text: en.url }),
        h('span', { class: 'fn', text: en.filename || '—' }),
        h('span', { class: 'chip cat-chip', text: en.source || 'IDM' })
      ));
    }
    const importBtn = h('button', {
      class: 'btn primary',
      text: t('idmImport').replace('{n}', boxes.length),
      onclick: async () => {
        const sel = boxes.filter(b => b.cb.checked).map(b => b.en);
        if (!sel.length) return;
        const res = await window.raad.idm.apply({ entries: sel, settings: applied });
        toast(t('ok'), t('idmDone').replace('{n}', res.added));
        window.nav('downloads');
      }
    });
    for (const b of boxes) b.cb.onchange = () => importBtn.textContent = t('idmImport').replace('{n}', boxes.filter(x => x.cb.checked).length);

    resultsBox.append(h('div', { class: 'idm-table' },
      h('div', { class: 'idm-thead' }, allCb, h('span', { text: 'URL' }), h('span', { text: t('size') === 'حجم' ? 'نام فایل' : 'Filename' }), h('span', { text: '' })),
      body
    ));
    resultsBox.append(h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '9px' } },
      h('button', { class: 'btn', text: t('clipSelectAll'), onclick: () => { boxes.forEach(b => b.cb.checked = true); importBtn.textContent = t('idmImport').replace('{n}', boxes.length); } }),
      importBtn
    ));
  }
};
