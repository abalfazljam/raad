'use strict';
/* Raad DM v1.2 (for app v1.6) — content script:
 * intercept download-link clicks and route them to Raad DM (IDM-like).
 * v1.6: cross-browser promise messaging, double-click dedupe, smarter
 * fallback when Raad is not running. */

(function () {
  const api = (typeof browser !== 'undefined' && browser && browser.runtime) ? browser : chrome;

  const DL_EXT_RE = new RegExp(
    '\\.(zip|rar|7z|001|tar|gz|bz2|xz|zst|iso|cab|apk|exe|msi|msix|dmg|deb|rpm|jar|appimage|' +
    'mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|3gp|mpg|mpeg|' +
    'mp3|flac|wav|m4a|aac|ogg|opus|wma|' +
    'pdf|epub|mobi|djvu|doc|docx|xls|xlsx|ppt|pptx|csv|' +
    'jpg|jpeg|png|gif|webp|bmp|psd|ai|tiff|' +
    'torrent|bin|dat|ipa|apk\\.1)(\\?|#|$)', 'i');

  let cfg = { enabled: true, disabledSites: [] };
  let toastsRoot = null;

  function loadCfg() {
    try {
      api.storage && api.storage.local.get(['enabled', 'disabledSites']).then(st => {
        cfg.enabled = st.enabled !== false;
        cfg.disabledSites = st.disabledSites || [];
      }).catch(() => { });
    } catch {
      try {
        api.storage && api.storage.local.get(['enabled', 'disabledSites'], (st) => {
          cfg.enabled = st.enabled !== false;
          cfg.disabledSites = st.disabledSites || [];
        });
      } catch { }
    }
  }
  loadCfg();
  if (api.storage && api.storage.onChanged) api.storage.onChanged.addListener(loadCfg);

  function showToast(text, ok) {
    try {
      if (!toastsRoot || !toastsRoot.isConnected) {
        toastsRoot = document.createElement('div');
        toastsRoot.style.cssText = 'position:fixed;z-index:2147483647;bottom:22px;inset-inline-end:22px;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        (document.body || document.documentElement).append(toastsRoot);
      }
      const t = document.createElement('div');
      t.textContent = text;
      t.style.cssText = 'pointer-events:auto;max-width:340px;padding:11px 16px;border-radius:12px;' +
        'background:' + (ok ? '#111827' : '#7f1d1d') + ';color:#fff;font:600 12.5px -apple-system,Segoe UI,Tahoma,sans-serif;' +
        'box-shadow:0 10px 30px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);' +
        'transition:opacity .3s,transform .3s;opacity:0;transform:translateY(8px);direction:ltr;';
      toastsRoot.append(t);
      requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'none'; });
      setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 350); }, 2600);
    } catch { }
  }

  function candidate(link) {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return null;
    let url;
    try { url = new URL(href, location.href); } catch { return null; }
    if (!/^https?:$/i.test(url.protocol)) return null;
    const hasDlAttr = link.hasAttribute('download');
    const extHit = DL_EXT_RE.test(url.pathname);
    if (hasDlAttr || extHit) return url.href;
    return null;
  }

  document.addEventListener('click', (e) => {
    if (!cfg.enabled || e.defaultPrevented || e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;
    if ((cfg.disabledSites || []).includes(location.hostname)) return;
    const url = candidate(link);
    if (!url) return;
    /* v1.6: don't intercept the same link twice (site scripts may re-dispatch) */
    if (link.__raadTaken) return;
    link.__raadTaken = true;
    setTimeout(() => { delete link.__raadTaken; }, 4000);

    e.preventDefault();
    e.stopPropagation();

    const send = api.runtime.sendMessage({
      type: 'raad-add', url, pageUrl: location.href,
      filename: (link.getAttribute('download') || ''), cookies: document.cookie || ''
    });
    Promise.resolve(send).then((resp) => {
      if (!resp || !resp.ok) {
        /* IDM-like fallback: app closed → let the browser handle it */
        showToast('Raad is not running — opening in browser…', false);
        setTimeout(() => {
          if (link.target === '_blank') window.open(url, '_blank');
          else location.href = url;
        }, 900);
        return;
      }
      showToast('Sent to Raad ✓', true);
    }).catch(() => {
      showToast('Raad is not running — opening in browser…', false);
      setTimeout(() => { if (link.target === '_blank') window.open(url, '_blank'); else location.href = url; }, 900);
    });
  }, true);

  /* Keep-alive for MV3 service worker responsiveness (cheap) */
  if (api.runtime && api.runtime.connect && navigator.userAgent.includes('Chrome')) {
    try { const p = api.runtime.connect({ name: 'raad-keepalive' }); p.onDisconnect.addListener(() => { }); } catch { }
  }
})();
