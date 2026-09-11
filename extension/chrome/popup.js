'use strict';
/* Raad DM — extension popup */
const $ = (s) => document.querySelector(s);

function setStatus(ok) {
  $('#stDot').classList.toggle('on', !!ok);
  $('#stTxt').textContent = ok ? 'connected' : 'Raad closed';
}

function paintPower(enabled) {
  const on = enabled !== false;
  $('#powerBtn').classList.toggle('off', !on);
  $('#pTitle').textContent = on ? 'Interception: ON' : 'Interception: OFF';
  $('#pState').textContent = on ? 'ON' : 'OFF';
  $('#pBulb').textContent = on ? '⏻' : '⏻';
}

function load() {
  chrome.runtime.sendMessage({ type: 'raad-get-config' }, (cfg) => {
    paintPower(cfg.enabled);
    $('#swCookies').checked = !!cfg.cookies;
    $('#swNotify').checked = cfg.notify !== false;
    $('#cfg').value = JSON.stringify({ port: cfg.port, token: cfg.token });
    chrome.runtime.sendMessage({ type: 'raad-ping' }, (r) => setStatus(r && r.ok));
  });
}

/* one-click master toggle */
$('#powerBtn').onclick = () => {
  const now = $('#pState').textContent === 'ON';
  chrome.runtime.sendMessage({ type: 'raad-set-config', patch: { enabled: !now } }, () => load());
};

$('#swCookies').onchange = (e) => chrome.runtime.sendMessage({ type: 'raad-set-config', patch: { cookies: e.target.checked } }, load);
$('#swNotify').onchange = (e) => chrome.runtime.sendMessage({ type: 'raad-set-config', patch: { notify: e.target.checked } }, load);

$('#btnSave').onclick = () => {
  try {
    const cfg = JSON.parse($('#cfg').value || '{}');
    const patch = {};
    if (Number.isFinite(+cfg.port)) patch.port = +cfg.port;
    if (typeof cfg.token === 'string') patch.token = cfg.token;
    chrome.runtime.sendMessage({ type: 'raad-set-config', patch }, () => {
      chrome.runtime.sendMessage({ type: 'raad-ping' }, (r) => setStatus(r && r.ok));
    });
  } catch {
    $('#stTxt').textContent = 'invalid JSON';
  }
};

$('#btnPing').onclick = () => chrome.runtime.sendMessage({ type: 'raad-ping' }, (r) => setStatus(r && r.ok));

$('#btnSite').onclick = () => {
  chrome.tabs ? chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const host = tabs[0] ? new URL(tabs[0].url).hostname : '';
    if (!host) return;
    chrome.runtime.sendMessage({ type: 'raad-get-config' }, (cfg) => {
      const list = cfg.disabledSites || [];
      const i = list.indexOf(host);
      if (i >= 0) list.splice(i, 1); else list.push(host);
      $('#btnSite').textContent = i >= 0 ? 'Disable on this site' : 'Enable on this site (' + host + ')';
      chrome.runtime.sendMessage({ type: 'raad-set-config', patch: { disabledSites: list } });
    });
  }) : browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const host = new URL(tabs[0].url).hostname;
    chrome.runtime.sendMessage({ type: 'raad-get-config' }, (cfg) => {
      const list = cfg.disabledSites || [];
      const i = list.indexOf(host);
      if (i >= 0) list.splice(i, 1); else list.push(host);
      chrome.runtime.sendMessage({ type: 'raad-set-config', patch: { disabledSites: list } });
    });
  });
};

load();
