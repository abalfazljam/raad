'use strict';
/* Raad DM v1.2 (for app v1.6) — extension popup.
 * v1.6: honest connection status, one-click AUTO-CONNECT (no manual JSON
 * paste needed — discovery + pairing are automatic), bilingual FA/EN UI. */

const api = (typeof browser !== 'undefined' && browser && browser.runtime) ? browser : chrome;
const $ = (s) => document.querySelector(s);

/* ---------------- i18n ---------------- */
const STR = {
  fa: {
    checking: 'در حال بررسی…', connected: 'متصل به رعد', connectedSub: 'پورت {port} — هماهنگی خودکار فعال',
    notRunning: 'رعد اجرا نیست', notRunningSub: 'برنامه رعد را باز کنید، سپس ↻ را بزنید',
    connecting: 'در حال جست‌وجوی برنامه…', invalid: 'JSON نامعتبر',
    on: 'شنود دانلود: فعال', off: 'شنود دانلود: غیرفعال',
    cookies: 'ارسال کوکی‌ها<span>برای سایت‌های نیازمند ورود (پیشنهاد می‌شود)</span>',
    notify: 'اعلان‌ها<span>پیام هنگام ارسال هر دانلود</span>',
    disableSite: 'غیرفعال‌سازی در این سایت', enableSite: 'فعال‌سازی در این سایت ({h})',
    advanced: 'پیشرفته: کانفیگ دستی JSON', test: 'تست', saveCfg: 'ذخیره کانفیگ',
    foot: 'اتصال خودکار است — فقط برنامه رعد باید باز باشد.',
    footOff: 'شنود خاموش است — کلیک روی لینک، مثل همیشه در مرورگر دانلود می‌شود.',
    authNote: 'متصل شد؛ توکن به‌روزرسانی گردید.'
  },
  en: {
    checking: 'Checking…', connected: 'Connected to Raad', connectedSub: 'port {port} — auto pairing active',
    notRunning: 'Raad is not running', notRunningSub: 'Start the Raad app, then press ↻',
    connecting: 'Searching for the app…', invalid: 'Invalid JSON',
    on: 'Interception: ON', off: 'Interception: OFF',
    cookies: 'Send cookies<span>For sites that need login (recommended)</span>',
    notify: 'Notifications<span>Toast when a download is sent</span>',
    disableSite: 'Disable on this site', enableSite: 'Enable on this site ({h})',
    advanced: 'Advanced: manual JSON config', test: 'Test', saveCfg: 'Save config',
    foot: 'Connection is automatic — just keep Raad running.',
    footOff: 'Interception is OFF — links download in the browser as usual.',
    authNote: 'Connected; token refreshed.'
  }
};
/* v1.7: Persian-first — the popup opens in Persian; the EN button switches
 * (and remembers) English for whoever prefers it. */
let lang = localStorage.getItem('raadLang') || 'fa';
const L = () => STR[lang] || STR.en;

function applyLang() {
  document.body.classList.toggle('fa', lang === 'fa');
  $('#btnLang').textContent = lang === 'fa' ? 'EN' : 'فا';
  $('#pTitle').textContent = $('#pState').textContent === 'ON' ? L().on : L().off;
  $('#lbCookies').innerHTML = L().cookies;
  $('#lbNotify').innerHTML = L().notify;
  $('#advTitle').textContent = L().advanced;
  $('#btnPing').textContent = L().test;
  $('#btnSave').textContent = L().saveCfg;
  $('#footMsg').textContent = $('#pState').textContent === 'OFF' ? L().footOff : L().foot;
  $('#btnSite').textContent = ($('#btnSite').dataset.on === '1') ? L().enableSite.replace('{h}', $('#btnSite').dataset.host || '') : L().disableSite;
  localStorage.setItem('raadLang', lang);
}
$('#btnLang').onclick = () => { lang = lang === 'fa' ? 'en' : 'fa'; applyLang(); refresh(); sendMsg({ type: 'raad-set-config', patch: { lang } }); };

/* ---------------- status ---------------- */
function setStatus(kind, text, sub) {
  const dot = $('#stDot');
  dot.classList.remove('on', 'err');
  if (kind === 'on') dot.classList.add('on');
  if (kind === 'err') dot.classList.add('err');
  $('#stTxt').textContent = text;
  $('#stSub').textContent = sub || '';
}

function paintPower(enabled) {
  const on = enabled !== false;
  $('#powerBtn').classList.toggle('off', !on);
  $('#pTitle').textContent = on ? L().on : L().off;
  $('#pState').textContent = on ? 'ON' : 'OFF';
  $('#footMsg').textContent = on ? L().foot : L().footOff;
}

function sendMsg(msg) {
  const p = api.runtime.sendMessage(msg);
  return Promise.resolve(p).catch(() => undefined);
}

async function refresh() {
  const cfg = await sendMsg({ type: 'raad-get-config' }) || {};
  paintPower(cfg.enabled);
  $('#swCookies').checked = !!cfg.cookies;
  $('#swNotify').checked = cfg.notify !== false;
  if (cfg.port) $('#cfg').value = JSON.stringify({ port: cfg.port, token: cfg.token || '' });
  setStatus('', L().checking, '');
  const r = await sendMsg({ type: 'raad-ping' }) || {};
  if (r.ok) setStatus('on', L().connected, L().connectedSub.replace('{port}', r.port || cfg.port || ''));
  else setStatus('err', L().notRunning, L().notRunningSub);

  /* per-site button state */
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    const host = tabs && tabs[0] ? new URL(tabs[0].url).hostname : '';
    const btn = $('#btnSite');
    if (host) {
      const list = cfg.disabledSites || [];
      btn.dataset.host = host;
      btn.dataset.on = list.includes(host) ? '1' : '0';
      btn.textContent = list.includes(host) ? L().enableSite.replace('{h}', host) : L().disableSite;
      btn.onclick = () => {
        const cur = btn.dataset.on === '1';
        sendMsg({ type: 'raad-set-config', patch: { disabledSites: cur ? list.filter(x => x !== host) : [...list, host] } })
          .then(() => refresh());
      };
    } else btn.onclick = null;
  } catch { }
}

/* ---------------- controls ---------------- */
$('#powerBtn').onclick = async () => {
  const now = $('#pState').textContent === 'ON';
  await sendMsg({ type: 'raad-set-config', patch: { enabled: !now } });
  refresh();
};
$('#swCookies').onchange = (e) => sendMsg({ type: 'raad-set-config', patch: { cookies: e.target.checked } }).then(refresh);
$('#swNotify').onchange = (e) => sendMsg({ type: 'raad-set-config', patch: { notify: e.target.checked } }).then(refresh);

/* v1.6: one-click auto connect — scans ports and pairs automatically */
$('#btnConnect').onclick = async () => {
  setStatus('', L().connecting, '');
  const r = await sendMsg({ type: 'raad-connect' }) || {};
  if (r.ok) setStatus('on', L().connected, L().connectedSub.replace('{port}', r.port || ''));
  else setStatus('err', L().notRunning, L().notRunningSub);
};

$('#btnPing').onclick = async () => {
  const r = await sendMsg({ type: 'raad-ping' }) || {};
  if (r.ok) setStatus('on', L().connected, L().connectedSub.replace('{port}', r.port || ''));
  else setStatus('err', L().notRunning, L().notRunningSub);
};

$('#btnSave').onclick = async () => {
  try {
    const c = JSON.parse($('#cfg').value || '{}');
    const patch = {};
    if (Number.isFinite(+c.port)) patch.port = +c.port;
    if (typeof c.token === 'string') patch.token = c.token;
    await sendMsg({ type: 'raad-set-config', patch });
    const r = await sendMsg({ type: 'raad-ping' }) || {};
    if (r.ok) setStatus('on', L().connected, L().connectedSub.replace('{port}', r.port || ''));
    else setStatus('err', L().notRunning, L().notRunningSub);
  } catch {
    setStatus('err', L().invalid, '');
  }
};

refresh();
