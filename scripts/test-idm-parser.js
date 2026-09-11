'use strict';
/* Test Raad's IDM registry parser against a synthetic .reg export */
const fs = require('fs');
const path = require('path');
const idm = require('/home/z/my-project/raad-dm/main/idm.js');

function utf16blob(...strings) {
  const parts = [];
  for (const s of strings) {
    const b = Buffer.from(s, 'utf16le');
    parts.push(b, Buffer.from([0, 0]));
  }
  return Buffer.concat(parts);
}

function hexOf(buf) {
  const arr = [...buf];
  const lines = [];
  for (let i = 0; i < arr.length; i += 100) {
    lines.push(arr.slice(i, i + 100).join(','));
  }
  return lines.join(',\\\n    ') + (lines.length > 1 ? '' : '');
}

// Build a synthetic IDM-like registry export
const blob1 = utf16blob(
  'https://cdn.example.com/files/Movie.2023.1080p.BluRay.mkv',
  'https://movies-site.example.com/download/123',
  'Movie.2023.1080p.BluRay.mkv'
);
const blob2 = utf16blob(
  'https://dl.example.net/music/album/taylor_song.flac',
  'https://music.example.net/album',
  'taylor_song.flac'
);
const blob3 = utf16blob(
  'https://files.example.org/software/setup_tool_x64.exe',
  'https://software.example.org/downloads',
  'setup_tool_x64.exe'
);

const reg = [
  'Windows Registry Editor Version 5.00',
  '',
  '[HKEY_CURRENT_USER\\Software\\DownloadManager]',
  '"ConnNumber"=dword:00000010',
  '"SegmentNumber"=dword:00000020',
  '"SpeedLimit"=dword:000001f4',
  '"ScrapPath"="C:\\\\Users\\\\TestUser\\\\Downloads\\\\IDM"',
  '"SomeSettings"=dword:00000001',
  '',
  '[HKEY_CURRENT_USER\\Software\\DownloadManager\\History]',
  '"Data0"=hex:' + hexOf(blob1),
  '',
  '"Data1"=hex:' + hexOf(blob2),
  '',
  '"Other"="plain string value"',
  '',
  '[HKEY_CURRENT_USER\\Software\\DownloadManager\\Jobs\\001]',
  '"Entry"=hex:' + hexOf(blob3),
  ''
].join('\r\n');

const buf = Buffer.from('\ufeff' + reg, 'utf16le');
const file = '/tmp/raad-test-idm.reg';
fs.writeFileSync(file, buf);

console.log('=== parsing .reg (UTF-16LE, continuations) ===');
const result = idm.importFromFile(file);
console.log('mode:', result.mode);
console.log('totalValues:', result.totalValues);
console.log('entries found:', result.entries.length);
for (const e of result.entries) {
  console.log(' -', JSON.stringify(e, null, 1));
}
console.log('settings guesses:');
for (const g of result.settings) console.log(' -', g.key, '=', JSON.stringify(g.value), `(${g.label})`);

/* ---- assertions ---- */
const ok = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; } else console.log('✓', msg); };

ok(result.mode === 'reg', 'mode is reg');
ok(result.entries.length === 3, '3 entries extracted (got ' + result.entries.length + ')');
const e1 = result.entries.find(e => e.url.includes('Movie'));
ok(!!e1, 'movie entry found');
ok(e1 && e1.filename === 'Movie.2023.1080p.BluRay.mkv', 'filename correct');
ok(e1 && e1.referrer === 'https://movies-site.example.com/download/123', 'referrer correct');

const gc = result.settings.find(g => g.key === 'maxConcurrent');
ok(gc && gc.value === 10, 'maxConcurrent guessed from dword 0x10 → clamped to 10 (got ' + (gc && gc.value) + ')');
const gs = result.settings.find(g => g.key === 'maxSegments');
ok(gs && gs.value === 32, 'maxSegments guessed 0x20 = 32 (got ' + (gs && gs.value) + ')');
const gp = result.settings.find(g => g.key === 'downloadDir');
ok(!!gp, 'download folder candidate found');

/* ---- list file import ---- */
const txt = 'https://a.example/x.zip\nhttps://b.example/y.mp4?x=1, trailing';
fs.writeFileSync('/tmp/raad-test-list.txt', txt);
const r2 = idm.importFromFile('/tmp/raad-test-list.txt');
ok(r2.mode === 'list' && r2.entries.length === 2, 'list import finds 2 urls (got ' + r2.entries.length + ')');

/* ---- UrlHistory.txt parsing (IDM's real history file, v1.1 method) ---- */
const uh = [
  'https://cdn.example.com/files/Movie.2023.1080p.BluRay.mkv',
  'https://www.internetdownloadmanager.com/update_check?id=1', // IDM's own → filtered
  'this line is not a url',
  'https://dl.example.net/music/song.flac?token=abc',
  'https://cdn.example.com/files/Movie.2023.1080p.BluRay.mkv'  // duplicate → skipped
].join('\r\n');
fs.writeFileSync('/tmp/raad-UrlHistory.txt', uh);
const r3 = idm.importFromFile('/tmp/raad-UrlHistory.txt');
ok(r3.mode === 'list' && r3.entries.length === 2, 'UrlHistory.txt: 2 clean urls (got ' + r3.entries.length + ')');
ok(r3.entries[0] && r3.entries[0].filename.includes('Movie'), 'UrlHistory.txt: filename derived from url');
ok(r3.entries[1] && r3.entries[1].url.includes('song.flac'), 'UrlHistory.txt: second url kept');

/* ---- decodeIdmStrings edge cases ---- */
const strs = idm.decodeIdmStrings(Buffer.from([0, 0, 0x41, 0, 0x42, 0, 0x43, 0, 0, 0]));
ok(strs.length === 1 && strs[0].s === 'ABC', 'utf16 run detection ok (runs <3 chars are noise-filtered)');

/* ---- v1.2: www URLs + mid-line URLs + generous cap ---- */
const txt12 = [
  'www.example-one.com/files/movie.mkv',                              // scheme-less www
  'refer=https://embed.example-two.com/watch/12 ref=http://x.example', // URLs embedded mid-line
  'random text without links',
  'https://cdn.example-three.com/a/b/c/software.zip'
].join('\r\n');
fs.writeFileSync('/tmp/raad-test-v12.txt', txt12);
const r4 = idm.importFromFile('/tmp/raad-test-v12.txt');
ok(r4.entries.length === 4, 'v1.2: www + embedded urls found (got ' + r4.entries.length + ')');
ok(r4.entries[0].url === 'http://www.example-one.com/files/movie.mkv', 'v1.2: www url normalized to http://');
ok(r4.entries.some(e => e.url.startsWith('https://embed.example-two.com')), 'v1.2: mid-line url extracted');

/* ---- v1.2: deleted files are NOT filtered — every history url comes over ---- */
const histMany = [];
for (let i = 0; i < 120; i++) histMany.push('https://mirror.example.com/dl/file-' + i + '.zip');
fs.writeFileSync('/tmp/raad-test-many.txt', histMany.join('\r\n'));
const r5 = idm.importFromFile('/tmp/raad-test-many.txt');
ok(r5.entries.length === 120, 'v1.2: all 120 history urls imported regardless of local files (got ' + r5.entries.length + ')');

/* ---- v1.2: importAuto merges EVERY UrlHistory* file (simulated APPDATA) ---- */
const fakeAppData = '/tmp/raad-fake-appdata/IDM';
fs.rmSync('/tmp/raad-fake-appdata', { recursive: true, force: true });
fs.mkdirSync(fakeAppData, { recursive: true });
fs.writeFileSync(path.join(fakeAppData, 'UrlHistory.txt'), 'https://one.example/file1.iso\r\nhttps://shared.example/dup.zip');
fs.writeFileSync(path.join(fakeAppData, 'UrlHistory2.txt'), 'https://two.example/file2.mp4\r\nhttps://shared.example/dup.zip\r\nhttps://www.internetdownloadmanager.com/x'); // dup + own-domain
fs.writeFileSync(path.join(fakeAppData, 'Unrelated.txt'), 'https://no.example/skip.me');
process.env.APPDATA = '/tmp/raad-fake-appdata';
const files = idm.idmHistoryFiles();
ok(files.length === 2, 'v1.2: only UrlHistory* files picked up (got ' + files.length + ')');
const mergedSet = new Set();
for (const f of files) for (const en of idm.parseHistoryText(fs.readFileSync(f))) mergedSet.add(en.url);
ok(mergedSet.size === 3, 'v1.2: merged files dedupe to 3 urls (got ' + mergedSet.size + ')');
ok([...mergedSet].every(u => !/internetdownloadmanager/.test(u)), 'v1.2: IDM own domain still filtered');

/* ---- v1.3: ftp links are imported too (IDM downloads FTP as well) ---- */
const txt13 = 'ftp://mirror.example.org/pub/tools/tool.zip\r\nhttps://a.example/x.zip';
fs.writeFileSync('/tmp/raad-test-v13.txt', txt13);
const r6 = idm.importFromFile('/tmp/raad-test-v13.txt');
ok(r6.entries.length === 2, 'v1.3: ftp:// imported alongside http (got ' + r6.entries.length + ')');

/* ---- v1.3: `reg query /s` output parsing (the live IDM MAIN list) ---- */
const qblob = utf16blob(
  'https://cdn.example.com/files/Movie.2023.1080p.BluRay.mkv',
  'https://movies-site.example.com/download/123',
  'C:\\Users\\TestUser\\Downloads\\Movie.2023.1080p.BluRay.mkv'
);
const hexStr = [...qblob].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
const hexLines = [];
for (let i = 0; i < hexStr.length; i += 50) hexLines.push('                    ' + hexStr.slice(i, i + 50));
const queryOut = [
  'HKEY_CURRENT_USER\\Software\\DownloadManager',
  '',
  '    FThread0    REG_BINARY    ' + hexLines[0].trim(),
  ...hexLines.slice(1),
  '',
  '',
  'HKEY_CURRENT_USER\\Software\\DownloadManager\\Settings',
  '    ConnNumber    REG_DWORD    0x10',
  '    SomePath    REG_SZ    C:\\Users\\X'
].join('\r\n');
const vals = idm.parseRegQuery(queryOut);
ok(vals.length === 3, 'v1.3: reg query parser finds 3 values (got ' + vals.length + ')');
const binVal = vals.find(v => v.type === 'REG_BINARY');
ok(!!binVal && binVal.data.replace(/\s+/g, '').length === hexStr.length, 'v1.3: wrapped REG_BINARY hex reassembled');
const col = idm.makeCollector();
const stats = idm.entriesFromRegQuery(queryOut, col);
ok(stats.blobs === 1, 'v1.3: one binary blob processed (got ' + stats.blobs + ')');
ok(col.entries.length === 1 && col.entries[0].url.includes('Movie'), 'v1.3: main-list entry extracted from registry dump');
ok(col.entries[0].filename === 'Movie.2023.1080p.BluRay.mkv', 'v1.3: filename pulled from record path (got ' + col.entries[0].filename + ')');
ok(col.entries[0].referrer === 'https://movies-site.example.com/download/123', 'v1.3: referrer from second url in blob');

/* ---- v1.3: registry + files merge dedupes across sources ---- */
const col2 = idm.makeCollector();
idm.entriesFromRegQuery(queryOut, col2);
for (const en of idm.parseHistoryText(fs.readFileSync('/tmp/raad-UrlHistory.txt'))) col2.add(en.url, '', en.filename);
ok(col2.entries.filter(e => e.url.includes('Movie')).length === 1, 'v1.3: same download in registry AND UrlHistory imports once (got ' + col2.entries.filter(e => e.url.includes('Movie')).length + ')');

/* ---- v1.4: THE REAL MAIN LIST — numeric subkeys with Url0 REG_SZ values ----
 * This is the storage IDM Backup Manager / history cleaners operate on
 * (HKCU\Software\DownloadManager\<number>\Url0). Simulates a user with a
 * 1200-entry history, Persian filenames included. */
const recLines = [];
for (let i = 1; i <= 1198; i++) {
  recLines.push(
    '[HKEY_CURRENT_USER\\Software\\DownloadManager\\' + (100 + i) + ']',
    '"Url0"="https://mirror-' + (i % 7) + '.example.com/dl/' + (i % 7) + '/file-' + i + '.zip"',
    '"Referer0"="https://site-' + (i % 7) + '.example.com/page/' + i + '"',
    '"Filename0"="C:\\\\Users\\\\TestUser\\\\Downloads\\\\file-' + i + '.zip"',
    ''
  );
}
/* two subkeys sharing one URL → dedupes to a single entry */
recLines.push(
  '[HKEY_CURRENT_USER\\Software\\DownloadManager\\9001]',
  '"Url0"="https://dup.example.com/same.zip"',
  '',
  '[HKEY_CURRENT_USER\\Software\\DownloadManager\\9002]',
  '"Url0"="https://dup.example.com/same.zip"',
  '',
  '[HKEY_CURRENT_USER\\Software\\DownloadManager\\9003]',
  '"Url0"="https://persian.example.com/files/video-amuzeshi.mp4"',
  '"Filename0"="C:\\\\Users\\\\TestUser\\\\Downloads\\\\video-amuzeshi.mp4"',
  ''
);
const reg14 = ['Windows Registry Editor Version 5.00', '',
  '[HKEY_CURRENT_USER\\Software\\DownloadManager]',
  '"ConnNumber"=dword:00000010', ''
].concat(recLines).join('\r\n');
fs.writeFileSync('/tmp/raad-test-v14.reg', Buffer.from('\ufeff' + reg14, 'utf16le'));
const r14 = idm.importFromFile('/tmp/raad-test-v14.reg');
ok(r14.entries.length === 1200, 'v1.4: all 1200 subkey records imported (1198 unique + 1 deduped pair + 1 Persian; got ' + r14.entries.length + ')');
const m14 = r14.entries.find(e => e.url.endsWith('file-42.zip'));
ok(!!m14, 'v1.4: record 42 present');
ok(m14 && m14.filename === 'file-42.zip', 'v1.4: filename from Filename0 (got ' + (m14 && m14.filename) + ')');
ok(m14 && m14.referrer === 'https://site-0.example.com/page/42', 'v1.4: referrer from Referer0 (got ' + (m14 && m14.referrer) + ')');
const mp = r14.entries.find(e => e.url.includes('video-amuzeshi'));
ok(mp && mp.filename === 'video-amuzeshi.mp4', 'v1.4: Persian filename survives UTF-16LE export (got ' + (mp && mp.filename) + ')');
ok(r14.entries.filter(e => e.url === 'https://dup.example.com/same.zip').length === 1, 'v1.4: duplicate URL in two subkeys imported once');

/* ---- v1.4: `reg query /s` fallback now picks up Url0 REG_SZ records too ---- */
const query14 = [
  'HKEY_CURRENT_USER\\Software\\DownloadManager',
  '',
  '',
  'HKEY_CURRENT_USER\\Software\\DownloadManager\\85',
  '    Url0    REG_SZ    https://subkey.example.com/a/clip.mkv',
  '    Referer0    REG_SZ    https://subkey.example.com/watch/9',
  '',
  'HKEY_CURRENT_USER\\Software\\DownloadManager\\86',
  '    Url0    REG_SZ    https://subkey.example.com/a/ep2.mkv',
  '',
  'HKEY_CURRENT_USER\\Software\\DownloadManager\\Settings',
  '    ConnNumber    REG_DWORD    0x10'
].join('\r\n');
const v14q = idm.parseRegQuery(query14);
ok(v14q.find(v => v.name === 'Url0' && v.data.includes('clip')).key.endsWith('\\85'), 'v1.4: query parser tracks record subkey path');
const col14 = idm.makeCollector();
const st14 = idm.entriesFromRegQuery(query14, col14);
ok(st14.records === 2, 'v1.4: 2 Url0 records from query output (got ' + st14.records + ')');
ok(col14.entries.length === 2 && col14.entries[0].url.includes('clip.mkv'), 'v1.4: records extracted via query fallback');
ok(col14.entries[0].referrer === 'https://subkey.example.com/watch/9', 'v1.4: referrer via query fallback');

/* ---- v1.5: IDM list order (numeric subkey = chronology) + timestamps ---- */
ok(idm.ordFromKeyPath('HKEY_CURRENT_USER\\Software\\DownloadManager\\847') === 847, 'v1.5: ord from key path (got ' + idm.ordFromKeyPath('HKEY_CURRENT_USER\\Software\\DownloadManager\\847') + ')');
ok(idm.ordFromKeyPath('HKEY_CURRENT_USER\\Software\\DownloadManager\\Settings') === null, 'v1.5: non-numeric subkey has no ord');
ok(idm.plausibleUnixMs(133989710000000000) > 631152000000 && idm.plausibleUnixMs(133989710000000000) < Date.now(), 'v1.5: FILETIME ticks → unix ms');
ok(idm.plausibleUnixMs(1757000000) === 1757000000000, 'v1.5: unix seconds → ms');
ok(idm.plausibleUnixMs(42) === null, 'v1.5: tiny number is not a timestamp');

/* orderEntries: highest subkey first = newest first, like IDM's own window */
const entries15 = [
  { url: 'https://a/old.bin', ord: 12 },
  { url: 'https://b/new.bin', ord: 909 },
  { url: 'https://c/mid.bin', ord: 77 },
  { url: 'https://d/fileless.bin' }          // UrlHistory/blob entry — no ord
];
const ordered15 = idm.orderEntries(entries15);
ok(ordered15[0].url === 'https://b/new.bin', 'v1.5: newest (highest id) first');
ok(ordered15[1].url === 'https://c/mid.bin' && ordered15[2].url === 'https://a/old.bin', 'v1.5: descending id order');
ok(ordered15[3].url === 'https://d/fileless.bin', 'v1.5: entries without ord come last');
ok(ordered15[0].rank === 0 && ordered15[2].rank === 2 && ordered15[3].rank === 3, 'v1.5: rank assigned 0..n');

/* record extraction captures ord + sniffed dates */
const rec15 = [{
  key: 'HKEY_CURRENT_USER\\Software\\DownloadManager\\841',
  name: 'Url0', type: 'sz', data: 'https://x.example.com/v/movie.mp4'
}, {
  key: 'HKEY_CURRENT_USER\\Software\\DownloadManager\\841',
  name: 'LastDownloadDate', type: 'sz', data: '1757000000'
}];
const col15 = idm.makeCollector();
idm.entriesFromRecords(rec15, col15);
const e15 = col15.entries[0];
ok(e15 && e15.ord === 841, 'v1.5: record keeps its numeric subkey ord');
ok(e15 && e15.dateReal === true && e15.date === 1757000000000, 'v1.5: timestamp value → dateReal date (got ' + (e15 && e15.date) + ')');

/* collector upgrade: same URL re-downloaded later keeps the NEWEST ord */
const col16 = idm.makeCollector();
col16.add('https://z/a.zip', '', '', 'IDM', { ord: 10 });
col16.add('https://z/a.zip', '', '', 'IDM', { ord: 999 });
ok(col16.entries.length === 1 && col16.entries[0].ord === 999, 'v1.5: duplicate URL keeps newest ord');

console.log('\nDone. exitCode =', process.exitCode || 0);
