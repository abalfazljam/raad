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

const MAX_ENTRIES = 5000;
/* IDM's own service URLs are not user downloads */
const IDM_OWN_RE = /internetdownloadmanager\.com|tonec\.com|secure\.internetdownloadmanager/i;
const URL_LINE_RE = /^(https?:\/\/|ftp:\/\/)\S+$/i;
const URL_GLOBAL_RE = /\b(?:https?:\/\/|ftp:\/\/)[^\s"'<>()\[\]{}]+/gi;

/* ---------- text decoding (any of: UTF-16LE BOM, UTF-16BE BOM, UTF-8/ANSI) ---------- */
function decodeTextBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return buf.swap16().toString('utf16le', 2);
  /* reg files may be UTF-16LE without BOM (every 2nd byte 0) */
  if (buf.length > 4 && buf[0] !== 0 && buf[1] === 0 && buf[2] !== 0 && buf[3] === 0) return buf.toString('utf16le');
  return buf.toString('utf8').replace(/\u0000/g, '');
}

/* ---------- history / list text parsing (IDM's own transfer format) ---------- */
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
      if (!/^https?:\/\//i.test(url)) continue;            // http(s) only for history import
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

function extractEntries(values) {
  const entries = [];
  const seen = new Set();
  for (const v of values) {
    if (v.type !== 'binary' || !Buffer.isBuffer(v.data) || v.data.length < 8) continue;
    const strings = decodeIdmStrings(v.data).sort((a, b) => a.pos - b.pos);
    const url = (strings.find(x => /^https?:\/\//i.test(x.s) && x.s.length < 2000 && !IDM_OWN_RE.test(x.s)) || {}).s;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const others = strings.filter(x => x.s !== url && /^https?:\/\//i.test(x.s) && !IDM_OWN_RE.test(x.s));
    const referrer = others.length ? others[0].s : '';
    const fnameCandidates = strings
      .filter(x => !/^https?:\/\//i.test(x.s) && x.s.length < 200 && FILENAME_RE.test(x.s) && !/^[a-z]:\\/i.test(x.s))
      .sort((a, b) => b.s.length - a.s.length);
    const filename = fnameCandidates.length ? fnameCandidates[0].s.split(/[\\/]/).pop() : (U.filenameFromUrl(url) || '');
    entries.push({ url, referrer, filename: U.sanitizeFilename(filename, ''), key: v.key, valueName: v.name });
    if (entries.length >= MAX_ENTRIES) break;
  }
  return entries;
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

/* ---------- Windows live import: UrlHistory.txt + reg query ---------- */
function idmHistoryPaths() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const dir = path.join(appData, 'IDM');
  return [path.join(dir, 'UrlHistory.txt'), path.join(dir, 'UrlHistory2.txt')];
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

function importAuto() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ ok: false, error: 'auto-import works only on Windows. On the old PC copy %APPDATA%\\IDM\\UrlHistory.txt and import it via the file method.' });
    }
    (async () => {
      let entries = [];
      let histFile = '';
      for (const f of idmHistoryPaths()) {
        if (!fs.existsSync(f)) continue;
        try {
          const parsed = parseHistoryText(fs.readFileSync(f));
          if (parsed.length && !entries.length) { entries = parsed; histFile = f; }
        } catch { }
      }
      const settings = await queryWinSettings();
      if (!entries.length && !settings.length) {
        return resolve({
          ok: false,
          error: 'IDM history not found (looked for %APPDATA%\\IDM\\UrlHistory.txt). Copy that file from the old PC and use the file method — or export the list from IDM: Tasks → Export.'
        });
      }
      resolve({ ok: true, entries, settings, totalValues: entries.length, histFile });
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
    return { mode: 'reg', entries: extractEntries(pool), settings: guessSettings(pool), totalValues: values.length };
  }
  return { mode: 'list', entries: parseHistoryText(buf), settings: [], totalValues: 0 };
}

module.exports = {
  parseRegFile, decodeIdmStrings, extractEntries, guessSettings,
  parseHistoryText, extractFromListFile: parseHistoryText,
  importFromFile, importAuto, idmHistoryPaths
};
