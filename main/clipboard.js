'use strict';
/* Raad DM — clipboard watcher: detects URLs pasted anywhere (multi-link aware) */
const { clipboard } = require('electron');
const { EventEmitter } = require('events');

const URL_RE = /(?:https?:\/\/|ftp:\/\/)[^\s"'<>()\[\]{}]+/gi;

function extractUrls(text) {
  if (!text) return [];
  const found = String(text).match(URL_RE) || [];
  const seen = new Set();
  return found.map(u => u.replace(/[.,;:!)]+$/, '')).filter(u => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

class ClipboardWatcher extends EventEmitter {
  constructor() {
    super();
    this.enabled = true;
    this.lastText = '';
    this.timer = setInterval(() => this.poll(), 900);
  }

  configure({ enabled }) {
    this.enabled = !!enabled;
    if (enabled) this.lastText = clipboard.readText();
  }

  poll() {
    if (!this.enabled) return;
    let text = '';
    try { text = clipboard.readText(); } catch { return; }
    if (!text || text === this.lastText) return;
    this.lastText = text;
    const urls = extractUrls(text);
    if (urls.length) this.emit('urls', { urls, at: Date.now() });
  }

  readUrlsNow() { return extractUrls(clipboard.readText()); }

  shutdown() { clearInterval(this.timer); }
}

module.exports = { ClipboardWatcher, extractUrls };
