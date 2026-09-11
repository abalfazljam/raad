'use strict';
/* Raad DM — IDM migration v2.
 *
 * FACTS about IDM storage (verified from official IDM docs/FAQ):
 *   • Download history  →  %APPDATA%\IDM\UrlHistory.txt   (NOT the registry!)
 *   • Settings          →  HKEY_CURRENT_USER\Software\DownloadManager
 *   • List transfer     →  IDM "Tasks → Export" produces a plain-text URL list
 *
 * Modes:
 *   auto — (Windows) read UrlHistory.txt + `reg query` for settings
 *   file — UrlHistory.txt / IDM text export / any URL list / .reg file
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const U = require('./util');

const MAX_ENTRIES = 20000;
/* IDM's own service URLs are not user downloads */
const IDM_OWN_RE = /internetdownloadmanager\.com|tonec\.com|secure\.internetdownloadmanager/i;
const URL_LINE_RE = /^(?:(?:https?|ftp):\/\/|www\.)\S+$/i;
const URL_GLOBAL_RE = /\b(?:(?:https?|ftp):\/\/|www\.)[^\s"'<>()\[\]{}]+/gi;
/* ---------- text decoding (any of: UTF-16LE BOM, UTF-16BE BOM, UTF-8/ANSI) ---------- */
function decodeTextBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return buf.swap16().toString('utf16le', 2);
  /* reg files may be UTF-16LE without BOM (every 2nd byte 0) */
  if (buf.length > 4 && buf[0] !== 0 && buf[1] === 0 && buf[2] !== 0 && buf[3] === 0) return buf.toString('utf16le');
  return buf.toString('utf8').replace(/\u0000/g, '');
}

/* ---------- history / list text parsing (IDM's own transfer format) ----------
 * Tolerant by design: the FULL IDM history list must come over, including
 * entries whose local file was deleted long ago. We therefore:
 *   • scan every line (and embedded URLs inside longer lines)
 *   • accept scheme-less www.* URLs and ftp:// links (IDM downloads FTP too)
 *   • never check whether the local file still exists (we can't know it)
 *   • only dedupe exact duplicate URLs, never drop otherwise
 */
function parseHistoryText(buf) {
  const text = decodeTextBuffer(buf);
  const entries = [];
  const seen = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const urls = URL_LINE_RE.test(line) ? [line] : (line.match(URL_GLOBAL_RE) || []);
    for (let url of urls) {
      url = url.replace(/[.,;:)\]]+$/, '').trim();
      if (/^www\./i.test(url)) url = 'http://' + url;
      if (!/^(?:https?|ftp):\/\//i.test(url)) continue;      // http(s)/ftp for history import
      if (url.length > 2000 || IDM_OWN_RE.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      entries.push({ url, referrer: '', filename: U.filenameFromUrl(url) || '', key: '', valueName: '' });
      if (entries.length >= MAX_ENTRIES) return entries;
    }
  }
  return entries;
}

/* ---------- .reg file parsing (for settings & legacy blob history) ---------- */
function unquoteRegString(v) {
  let out = '', i = 1;
  while (i < v.length) {
    const c = v[i];
    if (c === '\\' && i + 1 < v.length) { out += v[i + 1]; i += 2; continue; }
    if (c === '"') break;
    out += c; i++;
  }
  return out;
}

function parseRegFile(buf) {
  const text = decodeTextBuffer(buf);
  const lines = text.split(/\r?\n/);
  const joined = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith(';')) continue;
    const prev = joined[joined.length - 1];
    if (prev && prev.endsWith('\\')) joined[joined.length - 1] = prev.slice(0, -1) + t.replace(/^\s+/, '');
    else joined.push(t);
  }

  const values = [];
  let key = '';
  for (const line of joined) {
    if (line.startsWith('[')) { key = line.replace(/^\[|\]$/g, ''); continue; }
    const m = /^(?:"([^"]*)"|@)=(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1] !== undefined ? m[1] : '';
    const raw = m[2].trim();
    const value = { key, name, type: 'unknown', data: null };
    try {
      if (raw === '-' || raw === '') value.type = 'delete';
      else if (raw.startsWith('"')) { value.type = 'sz'; value.data = unquoteRegString(raw); }
      else if (raw.startsWith('dword:')) { value.type = 'dword'; value.data = parseInt(raw.slice(6), 16); }
      else if (raw.startsWith('hex(b):')) {
        value.type = 'qword';
        const b = Buffer.from(raw.slice(7).replace(/\s/g, '').split(',').filter(x => x), 'hex');
        value.data = b.length === 8 ? Number(b.readBigUInt64LE(0)) : 0;
      } else if (raw.startsWith('hex(2):') || raw.startsWith('hex(7):')) {
        value.type = raw[4] === '2' ? 'expand_sz' : 'multi_sz';
        const b = Buffer.from(raw.slice(7).replace(/\s/g, '').split(',').filter(x => x), 'hex');
        value.data = b.toString('utf16le').replace(/\u0000+$/, '');
      } else if (raw.startsWith('hex:')) {
        value.type = 'binary';
        value.data = Buffer.from(raw.slice(4).replace(/\s/g, '').split(',').filter(x => x), 'hex');
      } else if (raw.startsWith('hex(')) {
        value.type = 'binary';
        value.data = Buffer.from(raw.slice(raw.indexOf(':') + 1).replace(/\s/g, '').split(',').filter(x => x), 'hex');
      }
    } catch { /* keep raw */ }
    values.push(value);
  }
  return values;
}

/* ---------- string extraction from binary blobs (legacy/last resort) ---------- */
function decodeIdmStrings(buf) {
  const out = [];
  if (!buf || buf.length < 4) return out;
  let cur = '', startPos = -1;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf[i] | (buf[i + 1] << 8);
    const printable = (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c !== 0x7f);
    if (printable) { if (!cur) startPos = i; cur += String.fromCharCode(c); }
    else { if (cur.length >= 3) out.push({ s: cur, pos: startPos }); cur = ''; startPos = -1; }
  }
  if (cur.length >= 3) out.push({ s: cur, pos: startPos });
  cur = '';
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c);
    else { if (cur.length >= 4) out.push({ s: cur, pos: i - cur.length }); cur = ''; }
  }
  if (cur.length >= 4) out.push({ s: cur, pos: buf.length - cur.length });
  return out;
}

const FILENAME_RE = new RegExp('\\.(' + Object.values(U.EXT_CATS).flat().concat(['bin', 'dat', 'part']).join('|') + ')$', 'i');

/* ---------- shared URL collector (dedupe + cap) ---------- */
function makeCollector(cap = MAX_ENTRIES) {
  const seen = new Set();
  const entries = [];
  return {
    entries,
    add(url, referrer = '', filename = '', source = 'IDM') {
      url = String(url || '').trim();
      if (/^www\./i.test(url)) url = 'http://' + url;
      if (!/^(?:https?|ftp):\/\//i.test(url)) return false;
      if (url.length > 2000 || IDM_OWN_RE.test(url)) return false;
      if (seen.has(url)) return false;
      seen.add(url);
      entries.push({ url, referrer, filename, source, key: '', valueName: '' });
      return true;
    },
    full() { return entries.length >= cap; }
  };
}

/* one IDM record blob → one entry (first URL = download, second = referrer) */
function entryFromBlob(strings, add) {
  const urls = strings.filter(x => /^(?:(?:https?|ftp):\/\/|www\.)/i.test(x.s) && x.s.length < 2000 && !IDM_OWN_RE.test(x.s));
  if (!urls.length) return false;
  const url = urls[0].s;
  const referrer = urls.length > 1 ? urls[1].s : '';
  const fnames = strings
    .filter(x => !/^(?:(?:https?|ftp):\/\/|www\.)/i.test(x.s) && x.s.length < 300 && FILENAME_RE.test(x.s))
    .sort((a, b) => b.s.length - a.s.length);
  const filename = fnames.length ? fnames[0].s.split(/[\\/]/).pop() : (U.filenameFromUrl(url) || '');
  return add(url, referrer, U.sanitizeFilename(filename, ''));
}

/* .reg file binary values → entries (legacy path, kept for old exports) */
function extractEntries(values, collector) {
  const col = collector || makeCollector();
  for (const v of values) {
    if (v.type !== 'binary' || !Buffer.isBuffer(v.data) || v.data.length < 8) continue;
    const strings = decodeIdmStrings(v.data).sort((a, b) => a.pos - b.pos);
    entryFromBlob(strings, (u, r, f) => col.add(u, r, f));
    if (col.full()) break;
  }
  return col.entries;
}

/* ---------- settings guesses (strict) ---------- */
const EXE_LIKE_RE = /\.(exe|dll|tmp|log|txt|dat|idm)$/i;

function pushDirGuess(guesses, name, dir) {
  if (!dir || typeof dir !== 'string') return false;
  dir = dir.trim();
  if (!/^[a-z]:[\\/]/i.test(dir)) return false;          // local absolute path
  if (EXE_LIKE_RE.test(dir)) return false;               // not a file path
  const hay = (name + ' ' + dir).toLowerCase();
  if (!/(download|dwnl|save)/.test(hay)) return false;   // must smell like a save folder
  if (guesses.some(g => g.key === 'downloadDir' && g.value.toLowerCase() === dir.toLowerCase())) return true;
  guesses.push({ key: 'downloadDir', value: dir, label: 'folder: ' + dir });
  return true;
}

function guessSettings(values) {
  const guesses = [];
  const findDword = (re, lo, hi) => {
    const v = values.find(x => x.type === 'dword' && re.test(x.name) && typeof x.data === 'number' && x.data >= lo && x.data <= hi);
    return v ? v.data : null;
  };
  const conn = findDword(/(max)?con(nections?)?(num|number|count)?$/i, 1, 32) || findDword(/conn/i, 1, 32);
  if (conn) guesses.push({ key: 'maxConcurrent', value: Math.min(10, Math.max(1, conn)), label: 'max connections ≈ ' + conn });
  const segs = findDword(/segment|partnum|connper/i, 1, 32);
  if (segs) guesses.push({ key: 'maxSegments', value: Math.min(32, Math.max(1, segs)), label: 'segments ≈ ' + segs });
  const speed = findDword(/speed|limit/i, 1, 100000);
  if (speed) guesses.push({ key: 'speedLimit', value: speed * 1024, label: 'speed limit ≈ ' + speed + ' KB/s' });

  /* folders: prefer value names that literally mean a save dir */
  for (const v of values) {
    if (typeof v.data !== 'string') continue;
    if (/^(down)?load.*(dir|path|folder)|save(path|dir|folder)|dirsave$/i.test(v.name)) {
      pushDirGuess(guesses, v.name, v.data);
      if (guesses.filter(g => g.key === 'downloadDir').length >= 3) break;
    }
  }
  if (guesses.filter(g => g.key === 'downloadDir').length < 3) {
    for (const v of values) {
      if (typeof v.data !== 'string') continue;
      pushDirGuess(guesses, v.name, v.data);
      if (guesses.filter(g => g.key === 'downloadDir').length >= 3) break;
    }
  }
  return guesses;
}

/* ---------- Windows live import: merge EVERY UrlHistory* file + reg query ---------- */
function idmHistoryDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'IDM');
}
/* kept for compat */
function idmHistoryPaths() {
  const dir = idmHistoryDir();
  return [path.join(dir, 'UrlHistory.txt'), path.join(dir, 'UrlHistory2.txt')];
}
/* IDM may split its list across UrlHistory.txt / UrlHistory2.txt / backups —
 * read ALL of them and merge (exact-URL dedupe), biggest-first by mtime. */
function idmHistoryFiles() {
  const dir = idmHistoryDir();
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter(f => /^urlhistory/i.test(f) && /\.(txt|bak)$/i.test(f))
      .map(f => ({ f: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .map(x => x.f);
  } catch { }
  return files;
}

function queryWinSettings() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\DownloadManager'], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const values = [];
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = /^\s{4}(.*?)\s{4}(REG_[A-Z_]+)\s+(.*)$/.exec(line);
        if (!m) continue;
        const [, name, type, raw] = m;
        if (type === 'REG_DWORD') values.push({ type: 'dword', name, data: parseInt(raw, 16) });
        else if (type === 'REG_SZ' || type === 'REG_EXPAND_SZ') values.push({ type: 'sz', name, data: raw.trim() });
      }
      resolve(guessSettings(values));
    });
  });
}

/* ---------- the REAL main list lives in the registry ----------
 * IDM keeps the download list you see in its window inside
 * HKEY_CURRENT_USER\Software\DownloadManager as REG_BINARY records —
 * UrlHistory.txt only mirrors recent activity. A full recursive
 * `reg query /s` pulls EVERY record (files may long be deleted —
 * they are still imported). */
function queryRegTree() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\DownloadManager', '/s'],
      { timeout: 60000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

/* `reg query /s` output parser:
 *   HKEY_CURRENT_USER\...\Key
 *       ValueName    REG_BINARY    5C004400...   (long hex wraps onto
 *                                                    20-space indented lines)
 *       ValueName    REG_DWORD    0x20
 */
function parseRegQuery(text) {
  const values = [];
  let cur = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (/^HKEY_/i.test(rawLine)) { cur = null; continue; }
    const m = /^ {4}(.+?)\s{2,}(REG_[A-Z_]+)\s+(.*)$/.exec(rawLine);
    if (m) { cur = { name: m[1], type: m[2], data: m[3].trim() }; values.push(cur); continue; }
    if (cur && cur.type === 'REG_BINARY' && /^ {6,}\S/.test(rawLine)) {
      const hexish = rawLine.trim();
      if (/^[0-9A-Fa-f]+( [0-9A-Fa-f]+)*$/.test(hexish)) cur.data += ' ' + hexish;
    }
  }
  return values;
}

function entriesFromRegQuery(text, col) {
  const values = parseRegQuery(text);
  let blobs = 0;
  for (const v of values) {
    if (v.type !== 'REG_BINARY' || !v.data) continue;
    let buf;
    try { buf = Buffer.from(v.data.replace(/\s+/g, ''), 'hex'); } catch { continue; }
    if (buf.length < 12) continue;
    blobs++;
    const strings = decodeIdmStrings(buf).sort((a, b) => a.pos - b.pos);
    entryFromBlob(strings, (u, r, f) => col.add(u, r, f));
    if (col.full()) break;
  }
  return { values: values.length, blobs };
}

function importAuto() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ ok: false, error: 'auto-import works only on Windows. On the old PC copy %APPDATA%\\IDM\\UrlHistory.txt and import it via the file method.' });
    }
    (async () => {
      const col = makeCollector();
      const srcs = [];

      /* 1) registry — the MAIN list (usually the big one) */
      const regText = await queryRegTree();
      if (regText) {
        const { values, blobs } = entriesFromRegQuery(regText, col);
        srcs.push('registry: ' + blobs + '/' + values + ' records → ' + col.entries.length);
      } else {
        srcs.push('registry: not readable');
      }

      /* 2) every UrlHistory* text file (recent history mirror) */
      const files = [];
      const afterReg = col.entries.length;
      for (const f of idmHistoryFiles()) {
        try {
          const parsed = parseHistoryText(fs.readFileSync(f));
          if (!parsed.length) continue;
          files.push(f);
          let added = 0;
          for (const en of parsed) { if (!col.add(en.url, '', en.filename)) break; added++; }
          srcs.push(path.basename(f) + ': +' + added);
        } catch { }
        if (col.full()) break;
      }

      const entries = col.entries;
      const settings = await queryWinSettings();
      if (!entries.length && !settings.length) {
        return resolve({
          ok: false,
          error: 'IDM history not found. Close IDM completely and retry — or export the list from IDM: Tasks → Export, and import the text file here.',
          detail: srcs.join(' | ')
        });
      }
      resolve({
        ok: true, entries, settings,
        totalValues: entries.length,
        histFile: files[0] || '', histFiles: files,
        fromRegistry: afterReg, fromFiles: entries.length - afterReg,
        detail: srcs.join(' | ')
      });
    })();
  });
}

/* ---------- public API ---------- */
function importFromFile(filePath) {
  const buf = fs.readFileSync(filePath);
  if (filePath.toLowerCase().endsWith('.reg')) {
    const values = parseRegFile(buf);
    const dmValues = values.filter(v => /downloadmanager/i.test(v.key));
    const pool = dmValues.length ? dmValues : values;
    const col = makeCollector();
    extractEntries(pool, col);
    return { mode: 'reg', entries: col.entries, settings: guessSettings(pool), totalValues: values.length };
  }
  return { mode: 'list', entries: parseHistoryText(buf), settings: [], totalValues: 0 };
}

module.exports = {
  parseRegFile, decodeIdmStrings, extractEntries, guessSettings,
  parseHistoryText, extractFromListFile: parseHistoryText,
  parseRegQuery, entriesFromRegQuery, makeCollector,
  importFromFile, importAuto, idmHistoryPaths, idmHistoryFiles, idmHistoryDir
};
