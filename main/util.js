'use strict';
/* Raad DM — shared utilities for the main process */
const path = require('path');
const os = require('os');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const EXT_CATS = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'flv', 'wmv', 'ts', 'mpg', 'mpeg', '3gp', 'ogv', 'm3u8'],
  audio: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'mid', 'aiff'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'cab', '001', 'zst', 'lz4'],
  program: ['exe', 'msi', 'dmg', 'apk', 'deb', 'rpm', 'appx', 'msix', 'jar', 'appimage'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'mobi', 'djvu', 'odt', 'csv', 'txt'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'psd', 'ai', 'ico', 'tiff', 'heic']
};

const MIME_CATS = {
  'video/': 'video', 'audio/': 'audio', 'image/': 'image',
  'application/zip': 'archive', 'application/x-rar': 'archive', 'application/x-7z': 'archive',
  'application/gzip': 'archive', 'application/x-tar': 'archive', 'application/x-iso': 'archive',
  'application/pdf': 'document', 'application/msword': 'document', 'application/vnd.': 'document',
  'application/epub': 'document', 'application/octet-stream': 'program',
  'application/x-msdownload': 'program', 'application/vnd.android': 'program',
  'text/html': 'document'
};

function extOf(nameOrUrl) {
  try {
    let p = String(nameOrUrl || '');
    if (p.includes('://')) p = new URL(p).pathname;
    p = p.split('?')[0].split('#')[0];
    const base = p.split('/').pop() || '';
    const i = base.lastIndexOf('.');
    if (i <= 0) return '';
    return base.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch { return ''; }
}

function categoryFor(filename, mime) {
  const e = extOf(filename);
  for (const [cat, list] of Object.entries(EXT_CATS)) {
    if (list.includes(e)) return cat;
  }
  if (mime) {
    for (const [pre, cat] of Object.entries(MIME_CATS)) {
      if (mime.startsWith(pre)) return cat;
    }
  }
  return 'other';
}

function sanitizeFilename(name, fallback) {
  let n = String(name || '').trim();
  try { n = decodeURIComponent(n); } catch { /* keep raw */ }
  n = n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!n || n === '.' || n === '..') n = fallback || 'download';
  if (n.length > 180) {
    const e = extOf(n);
    n = n.slice(0, 170) + (e ? '.' + e : '');
  }
  return n;
}

function filenameFromDisposition(cd) {
  if (!cd) return '';
  let m = /filename\*=(?:UTF-8'')?([^;\s]+)/i.exec(cd);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  m = /filename="?([^";]+)"?/i.exec(cd);
  return m ? m[1] : '';
}

function filenameFromUrl(u) {
  try {
    const url = new URL(u);
    const seg = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    return seg || '';
  } catch { return ''; }
}

function uniqPath(dir, name) {
  const ext = extOf(name);
  const stem = ext ? name.slice(0, name.length - ext.length - 1) : name;
  let candidate = name, i = 1;
  const fs = require('fs');
  for (;;) {
    try {
      fs.accessSync(path.join(dir, candidate));
      candidate = `${stem} (${++i})${ext ? '.' + ext : ''}`;
    } catch { return candidate; }
  }
}

function fmtBytes(n) {
  if (n === null || n === undefined || isNaN(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + u[i];
}

function parseDataSize(str) {
  // "10.5MiB", "1.2MB", "512KiB", "800B", "1GiB"
  if (!str) return null;
  const m = /([\d.]+)\s*(B|KB?i?B?|MB?i?B?|GB?i?B?|TB?i?B?)/i.exec(String(str));
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2].toUpperCase().replace('IB', 'B');
  const mul = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] || 1;
  return Math.round(v * mul);
}

function isVideoSite(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|x\.com|twitter\.com|instagram\.com|facebook\.com|soundcloud\.com|aparat\.com)$/i.test(h);
  } catch { return false; }
}

function homedirDownloads() {
  const winDl = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : null;
  const candidates = [winDl, path.join(os.homedir(), 'Downloads'), os.homedir()].filter(Boolean);
  for (const c of candidates) {
    try { require('fs').accessSync(c); return c; } catch { /* next */ }
  }
  return os.homedir();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = {
  UA, EXT_CATS, extOf, categoryFor, sanitizeFilename, filenameFromDisposition,
  filenameFromUrl, uniqPath, fmtBytes, parseDataSize, isVideoSite, homedirDownloads, sleep
};
