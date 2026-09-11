'use strict';
/* Raad DM — IDM migration v3.
 *
 * FACTS about IDM storage (verified: forensics papers + the tooling
 * ecosystem around IDM, incl. how history cleaners and IDM Backup
 * Manager restore a FULL list across Windows reinstalls):
 *
 *   • The MAIN download list (what IDM's window shows) lives in the
 *     registry: HKEY_CURRENT_USER\Software\DownloadManager contains one
 *     NUMERIC SUBKEY per download ("85", "847", …), each holding the
 *     record as string values — the URL in "Url0" (REG_SZ), plus
 *     filename / referrer strings. This is why a registry restore
 *     brings back THOUSANDS of downloads even when the files are gone.
 *   • Legacy/older records may also appear as REG_BINARY blobs under the
 *     same tree → scanned as a fallback.
 *   • %APPDATA%\IDM\UrlHistory*.txt only mirrors recent activity.
 *   • Settings      →  HKEY_CURRENT_USER\Software\DownloadManager
 *   • List transfer →  IDM "Tasks → Export" produces a plain-text URL list
 *
 * Modes:
 *   auto — (Windows) `reg export` the whole DownloadManager tree
 *          (UTF-16LE file — no console codepage mangling of Persian
 *          names), extract every subkey record + every binary blob,
 *          then merge every UrlHistory* file. `reg query /s` stays as
 *          fallback when export is unavailable.
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
const URLISH_RE = /^(?:(?:https?|ftp):\/\/|www\.)/i;

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
function blobsFromValues(values, col) {
  let blobs = 0;
  for (const v of values) {
    if (!/binary/i.test(v.type) || !v.data) continue;
    let buf;
    try { buf = Buffer.isBuffer(v.data) ? v.data : Buffer.from(String(v.data).replace(/\s+/g, ''), 'hex'); } catch { continue; }
    if (buf.length < 12) continue;
    blobs++;
    const strings = decodeIdmStrings(buf).sort((a, b) => a.pos - b.pos);
    entryFromBlob(strings, (u, r, f) => col.add(u, r, f));
    if (col.full()) break;
  }
  return blobs;
}

function extractEntries(values, collector) {
  const col = collector || makeCollector();
  blobsFromValues(values, col);
  return col.entries;
}

/* ---------- THE REAL HISTORY: record subkeys with Url0 values ----------
 * HKEY_CURRENT_USER\Software\DownloadManager\85
 *     Url0        REG_SZ    https://site/file.zip
 *     Filename0   REG_SZ    C:\Users\...\file.zip      (names vary)
 *     Referer0    REG_SZ    https://site/page          (names vary)
 * One entry per subkey. Field names other than Url* differ between IDM
 * versions, so filename/referrer are detected by name sniffing + a
 * file-extension test, and everything dedupes through the collector. */
const REG_STRING_TYPE_RE = /^(REG_(SZ|EXPAND_SZ|MULTI_SZ)|sz|expand_sz|multi_sz)$/i;

function entriesFromRecords(values, col) {
  const colRef = col || makeCollector();
  const groups = new Map();
  for (const v of values) {
    if (!REG_STRING_TYPE_RE.test(String(v.type)) || typeof v.data !== 'string') continue;
    const k = String(v.key || '');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  let records = 0;
  for (const [, vals] of groups) {
    if (colRef.full()) break;
    const urls = vals.filter(v => URLISH_RE.test(v.data.trim()) && v.data.length < 2000 && !IDM_OWN_RE.test(v.data.trim()));
    if (!urls.length) continue;
    urls.sort((a, b) => (/^url/i.test(a.name) ? 0 : 1) - (/^url/i.test(b.name) ? 0 : 1));
    const url = urls[0].data.trim();
    const ref = urls.find(v => /refer|^ref/i.test(v.name) && v.data.trim() !== url);
    const fnames = vals
      .filter(v => !URLISH_RE.test(v.data.trim()) && (/(file|fname|name|title)/i.test(v.name) || FILENAME_RE.test(v.data.trim())))
      .map(v => v.data.trim());
    const filename = fnames.length
      ? fnames.sort((a, b) => b.length - a.length)[0].split(/[\\/]/).pop()
      : (U.filenameFromUrl(url) || '');
    if (colRef.add(url, ref ? ref.data.trim() : '', U.sanitizeFilename(filename, ''))) records++;
  }
  return records;
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

/* Full-tree EXPORT (UTF-16LE .reg file) — the reliable primary path:
 * perfect Unicode fidelity (Persian filenames survive), and unlike
 * console output, nothing is truncated. Returns the file bytes or null. */
function exportRegTree() {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), 'raad-idm-export.reg');
    execFile('reg', ['export', 'HKCU\\Software\\DownloadManager', file, '/y'],
      { timeout: 90000, maxBuffer: 4 * 1024 * 1024 }, (err) => {
        if (err) return resolve(null);
        try { resolve(fs.readFileSync(file)); } catch { resolve(null); }
      });
  });
}

/* `reg query /s` output parser (FALLBACK path when reg export fails):
 *   HKEY_CURRENT_USER\...\Key          ← current key tracked per value
 *       ValueName    REG_SZ    https://...   (record subkeys, v1.4+)
 *       ValueName    REG_BINARY    5C004400...   (long hex wraps onto
 *                                                    20-space indented lines)
 *       ValueName    REG_DWORD    0x20
 */
function parseRegQuery(text) {
  const values = [];
  let cur = null;
  let keyPath = '';
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (/^HKEY_/i.test(rawLine)) { keyPath = rawLine.trim(); cur = null; continue; }
    const m = /^ {4}(.+?)\s{2,}(REG_[A-Z_]+)\s+(.*)$/.exec(rawLine);
    if (m) { cur = { key: keyPath, name: m[1], type: m[2], data: m[3].trim() }; values.push(cur); continue; }
    if (cur && cur.type === 'REG_BINARY' && /^ {6,}\S/.test(rawLine)) {
      const hexish = rawLine.trim();
      if (/^[0-9A-Fa-f]+( [0-9A-Fa-f]+)*$/.test(hexish)) cur.data += ' ' + hexish;
    }
  }
  return values;
}

function entriesFromRegQuery(text, col) {
  const values = parseRegQuery(text);
  const records = entriesFromRecords(values, col);
  const blobs = blobsFromValues(values, col);
  return { values: values.length, blobs, records };
}

function importAuto() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ ok: false, error: 'auto-import works only on Windows. On the old PC copy %APPDATA%\\IDM\\UrlHistory.txt and import it via the file method.' });
    }
    (async () => {
      const col = makeCollector();
      const srcs = [];

      /* 1) registry — the MAIN list (usually the big one).
       * Records are NUMERIC SUBKEYS holding the URL in "Url0" (REG_SZ);
       * legacy REG_BINARY blobs are scanned too. Primary path is a full
       * `reg export` (Unicode-safe file), `reg query /s` as fallback. */
      const exported = await exportRegTree();
      if (exported) {
        const dmValues = parseRegFile(exported).filter(v => /downloadmanager/i.test(v.key));
        const recs = entriesFromRecords(dmValues, col);
        const before = col.entries.length;
        blobsFromValues(dmValues, col);
        srcs.push('registry(subkeys): ' + recs + ' +blobs: ' + (col.entries.length - before));
      } else {
        const regText = await queryRegTree();
        if (regText) {
          const stats = entriesFromRegQuery(regText, col);
          srcs.push('registry-query(subkeys): ' + stats.records + ' +blobs: ' + stats.blobs);
        } else {
          srcs.push('registry: not readable');
        }
      }
      const afterReg = col.entries.length;

      /* 2) every UrlHistory* text file (recent history mirror) */
      const files = [];
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
    const records = entriesFromRecords(pool, col);
    blobsFromValues(pool, col);
    return { mode: 'reg', entries: col.entries, settings: guessSettings(pool), totalValues: values.length, records };
  }
  return { mode: 'list', entries: parseHistoryText(buf), settings: [], totalValues: 0 };
}

module.exports = {
  parseRegFile, decodeIdmStrings, extractEntries, guessSettings,
  parseHistoryText, extractFromListFile: parseHistoryText,
  parseRegQuery, entriesFromRegQuery, entriesFromRecords, blobsFromValues, makeCollector,
  importFromFile, importAuto, idmHistoryPaths, idmHistoryFiles, idmHistoryDir
};
