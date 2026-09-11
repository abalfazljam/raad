'use strict';
/* Raad DM — Download engine: multi-segment HTTP(S) downloads with pause/resume,
 * queue with concurrency limit, global speed limiter, auto categories, yt-dlp support. */
const fs = require('fs');
const path = require('path');
const { net } = require('electron');
const { EventEmitter } = require('events');
const U = require('./util');

const MIN_SEG_SIZE = 2 * 1024 * 1024; // below this: single stream
const IDLE_TIMEOUT = 30000;
const RETRIES = 5;

/* ---------- global speed limiter ---------- */
class Limiter {
  constructor() { this.rate = 0; this.budget = 0; this.waiters = []; this._t = setInterval(() => this._tick(), 200); }
  _tick() {
    if (this.rate > 0) this.budget = Math.min(this.budget + this.rate * 0.2, this.rate);
    else this.budget = Infinity;
    const ws = this.waiters.splice(0);
    for (const w of ws) w();
  }
  take(n) {
    if (this.rate <= 0) return Promise.resolve();
    /* v1.5 FIX: a single network chunk can be larger than the bucket cap.
     * Grant as soon as 1 second worth of bytes accumulated, but DEBIT the
     * full chunk size (the bucket may go negative and refill) — otherwise
     * oversized chunks slip through unaccounted and the limit is fake. */
    return new Promise(res => {
      const tryGive = () => {
        if (this.budget >= Math.min(n, this.rate)) { this.budget -= n; res(); }
        else this.waiters.push(tryGive);
      };
      tryGive();
    });
  }
  setRate(bps) {
    this.rate = Math.max(0, bps | 0);
    if (this.rate > 0) {
      /* v1.5 FIX: turning the limit ON after starting unlimited left
       * budget === Infinity → every take() granted instantly and the speed
       * limit never applied. Re-arm the bucket whenever the limiter goes
       * from unlimited to limited. */
      if (this.budget === Infinity) this.budget = 0;
    } else {
      this.budget = Infinity;
      const ws = this.waiters.splice(0); ws.forEach(w => w());
    }
  }
}

/* ---------- engine ---------- */
class Engine extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.history = store.get('history', []);
    this.limiter = new Limiter();
    this.jobs = new Map();          // id -> job
    this._draining = false;
    this.applySettings(store.get('settings', {}));
    let migrated = 0;
    for (const r of this.history) {
      if (r.status === 'downloading' || r.status === 'queued') { r.status = 'paused'; r.speed = 0; }
      /* v1.5 migration: IDM history imports are FINISHED downloads — mark them
       * completed (user request: a restored list must look like the list IDM
       * itself shows, not a wall of paused items). Restarting one is a
       * deliberate per-row action. */
      if (r.source === 'idm' && (r.status === 'paused' || r.status === 'queued')) {
        r.status = 'completed'; r.parked = false; r.speed = 0; r.eta = null;
        if (!r.completedAt) r.completedAt = r.addedAt || Date.now();
        if (r.dateReal === undefined) r.dateReal = false;
        migrated++;
      }
    }
    if (migrated) console.log('[engine] migrated ' + migrated + ' IDM imports to completed');
    store.set('history', this.history);
  }

  applySettings(s) {
    this.maxConcurrent = Math.max(1, Math.min(10, s.maxConcurrent ?? 3));
    this.maxSegments = Math.max(1, Math.min(32, s.maxSegments ?? 16));
    this.speedLimit = Math.max(0, s.speedLimit ?? 0);           // bytes/sec, 0 = off
    this.downloadDir = s.downloadDir || U.homedirDownloads();
    this.categorize = s.categorize !== false;
    /* per-category folders (IDM-style): { video: 'D:\\Movies', audio: '', … }
     * empty string = default downloadDir/<category> subfolder */
    this.categoryFolders = (s.categoryFolders && typeof s.categoryFolders === 'object') ? s.categoryFolders : {};
    this.useYtdlp = !!s.useYtdlp;
    this.ytdlpPath = s.ytdlpPath || '';
    this._ytCache = undefined;
    this.limiter.setRate(this.speedLimit);
  }

  /* ============ listing / records ============ */
  list({ filter = 'all', search = '' } = {}) {
    let rows = this.history;
    if (filter === 'active') rows = rows.filter(r => ['downloading', 'queued'].includes(r.status));
    else if (filter === 'paused') rows = rows.filter(r => r.status === 'paused');
    else if (filter === 'done') rows = rows.filter(r => r.status === 'completed');
    else if (filter === 'failed') rows = rows.filter(r => r.status === 'failed');
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => (r.filename || '').toLowerCase().includes(q) || (r.url || '').toLowerCase().includes(q));
    }
    return rows;
  }

  get(id) { return this.history.find(r => r.id === id); }

  counts() {
    const c = { all: this.history.length, active: 0, paused: 0, done: 0, failed: 0 };
    /* v1.5 FIX: the old code checked c[r.status], but the status literal is
     * 'completed' while the counter key is 'done' — the Completed tab badge
     * was always 0. Explicit mapping instead. */
    for (const r of this.history) {
      if (r.status === 'downloading' || r.status === 'queued') c.active++;
      else if (r.status === 'completed') c.done++;
      else if (r.status === 'paused') c.paused++;
      else if (r.status === 'failed') c.failed++;
    }
    return c;
  }

  _emitStatus(rec, extra = {}) { this.emit('status', { id: rec.id, status: rec.status, error: rec.error, ...extra }); this.store.save('history'); }
  _emitProgress(rec) {
    this.emit('progress', { id: rec.id, received: rec.received, size: rec.size, speed: rec.speed, eta: rec.eta });
  }

  /* ============ add ============ */
  /* start  = begin downloading now
   * markDone = import as a FINISHED download (IDM history: the list must look
   *            exactly like IDM's own list — every item shows completed)
   * addedAt / completedAt / dateReal / ord = migration metadata from IDM */
  add({ url, referrer = '', cookies = '', filename = '', source = 'manual', start = true, folder = '',
        markDone = false, addedAt = null, completedAt = null, dateReal = null, ord = null }) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url) && !/^ftp:\/\//i.test(url)) throw new Error('invalid url: ' + url);
    if (!markDone) {
      const dup = this.history.find(r => r.url === url && ['downloading', 'queued', 'paused'].includes(r.status));
      if (dup) return { id: dup.id, existed: true };
    }

    const now = Date.now();
    const rec = {
      id: 'd' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      url, referrer, cookies,
      filename: U.sanitizeFilename(filename || U.filenameFromUrl(url) || 'download'),
      folder: folder || '',
      category: 'other', size: null, received: 0, speed: 0, eta: null,
      error: '', source,
      addedAt: addedAt || now, startedAt: null,
      completedAt: markDone ? (completedAt || addedAt || now) : null,
      /* dateReal=true only when a genuine timestamp arrived with the item */
      dateReal: dateReal === true,
      ord: (typeof ord === 'number' && isFinite(ord)) ? ord : null,
      engine: U.isVideoSite(url) && this.useYtdlp ? 'yt' : 'http'
    };
    if (markDone) {
      /* history import → completed, never queued, never auto-started. */
      rec.status = 'completed'; rec.parked = false;
    } else {
      /* start=false → parked only for IDM-style bulk imports (never part of
       * resume-all/scheduler); a user "queue only" add stays a normal paused
       * row the scheduler may pick up later. */
      rec.status = start ? 'queued' : 'paused';
      rec.parked = !start && source === 'idm';
    }
    this.history.unshift(rec);
    this.store.save('history');
    this.emit('added', rec);
    if (start && !markDone) this._drain();
    return { id: rec.id, existed: false };
  }

  /* ============ queue ============ */
  _drain() {
    if (this._draining) return;
    this._draining = true;
    const tick = () => {
      const active = [...this.jobs.values()].filter(j => j.rec.status === 'downloading').length;
      let started = false;
      if (active < this.maxConcurrent) {
        const next = this.history.find(r => r.status === 'queued');
        if (next) { started = true; this._start(next).catch(e => console.error('[engine]', e.message)); }
      }
      if (started) setTimeout(tick, 120); else { this._draining = false; }
    };
    tick();
  }

  /* ============ probe (info about remote file) ============
   * v1.5 FIX: probe previously used `redirect:'manual'` + a hand-rolled
   * redirect loop. On real CDNs (HTTP/2 302) Electron's net module never
   * delivers the 302 response in manual mode and the request dies with
   * "Redirect was cancelled" — EVERY redirecting download link failed.
   * Now: plain GET with Range:bytes=0-0 and redirect:'follow' (Chromium
   * follows the chain, headers survive the hops), stream cancelled right
   * after the headers arrive. Retry once without Range if the server
   * rejects it. */
  async probe(url, { referrer = '', cookies = '' } = {}) {
    const attempt = async (withRange) => {
      const res = await this._request(url, {
        method: 'GET',
        headers: {
          ...(withRange ? { Range: 'bytes=0-0' } : {}),
          ...(referrer ? { Referer: referrer } : {}),
          ...(cookies ? { Cookie: cookies } : {})
        },
        redirect: 'follow'
      });
      const out = { res };
      try { res.on('error', () => { }); } catch { }
      return out;
    };
    const read = (res) => {
      const out = { ok: false, status: res.statusCode || 0, size: null, mime: '', acceptRanges: false, filename: '' };
      const st = out.status;
      if (st >= 200 && st < 300) {
        out.ok = true;
        const h = res.headers;
        const cr = h['content-range'];
        if (st === 206 && cr) {
          const total = parseInt(String(cr).split('/')[1], 10);
          if (!isNaN(total)) { out.size = total; out.acceptRanges = true; }
        } else {
          const cl = parseInt(h['content-length'], 10);
          if (!isNaN(cl)) out.size = cl;
        }
        out.mime = String(h['content-type'] || '').split(';')[0];
        out.filename = U.filenameFromDisposition(h['content-disposition']);
        if (String(h['accept-ranges'] || '').toLowerCase() === 'bytes') out.acceptRanges = true;
      }
      return out;
    };
    let result = null, lastStatus = 0;
    for (const withRange of [true, false]) {
      try {
        const { res } = await attempt(withRange);
        result = read(res);
        lastStatus = result.status;
        try { res.cancel(); } catch { try { res.resume(); } catch { } }
        if (result.ok) break;
        /* 416 = bad range → retry without; other hard errors → stop */
        if (!withRange || (result.status && result.status !== 416)) break;
      } catch (e) {
        if (!withRange) return { ok: false, url, error: String(e.message || e), status: lastStatus, size: null, mime: '', acceptRanges: false, filename: '' };
      }
    }
    if (!result) return { ok: false, url, error: 'probe failed', status: lastStatus, size: null, mime: '', acceptRanges: false, filename: '' };
    if (!result.filename) result.filename = U.filenameFromUrl(url);
    result.url = url;
    return result;
  }

  _request(url, { method = 'GET', headers = {}, redirect = 'follow' } = {}) {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = net.request({ url, method, redirect });
      } catch (e) { return reject(e); }
      req.setHeader('User-Agent', U.UA);
      req.setHeader('Accept-Encoding', 'identity');
      for (const [k, v] of Object.entries(headers)) if (v) req.setHeader(k, v);
      req.on('response', res => resolve(res));
      req.on('error', reject);
      req.end();
    });
  }

  /* ============ job lifecycle ============ */
  async _start(rec) {
    if (this.jobs.has(rec.id)) return;
    const job = {
      rec, fd: null, aborting: false, aborted: false,
      aborts: new Set(), segments: [], stateFile: '', etag: '', lastModified: '',
      target: '', finalFile: '', size: null, ranges: false, mime: '', finalUrl: rec.url,
      tick: null, saveT: null, lastBytes: rec.received, child: null, lastData: 0
    };
    this.jobs.set(rec.id, job);
    rec.status = 'downloading'; rec.startedAt = Date.now(); rec.error = '';
    this._emitStatus(rec);
    try {
      if (rec.engine === 'yt') await this._runYt(job);
      else await this._runHttp(job);
    } catch (e) {
      if (!job.aborted && rec.status !== 'paused') {
        rec.status = 'failed';
        rec.error = String(e.message || e);
        this._finishJob(job, false);
        this._emitStatus(rec);
      }
    }
  }

  async _runHttp(job) {
    const rec = job.rec;
    // 1) probe
    const info = await this.probe(rec.url, { referrer: rec.referrer, cookies: rec.cookies });
    if (info.finalUrl) job.finalUrl = info.finalUrl;
    job.size = info.size; job.ranges = info.acceptRanges; job.mime = info.mime;
    rec.size = info.size;
    rec.mime = info.mime;
    if (info.filename) rec.filename = U.sanitizeFilename(info.filename, rec.filename);
    rec.category = U.categoryFor(rec.filename, info.mime);
    job.finalFile = path.join(this._folderFor(rec), rec.filename);
    fs.mkdirSync(path.dirname(job.finalFile), { recursive: true });
    job.finalFile = path.join(path.dirname(job.finalFile), U.uniqPath(path.dirname(job.finalFile), rec.filename));
    rec.filename = path.basename(job.finalFile);
    rec.folder = path.dirname(job.finalFile);
    job.target = job.finalFile;
    job.stateFile = job.finalFile + '.raad';

    // 2) resume or fresh
    let fresh = true;
    try {
      const st = JSON.parse(fs.readFileSync(job.stateFile, 'utf8'));
      if (st.url === job.finalUrl && fs.existsSync(job.finalFile)) {
        const sz = fs.statSync(job.finalFile).size;
        if (job.size === null || sz === job.size) {
          job.fd = fs.openSync(job.finalFile, 'r+');
          job.segments = st.segments;
          job.etag = st.etag || ''; job.lastModified = st.lastModified || '';
          rec.received = job.segments.reduce((a, s) => a + (s.pos - s.start), 0);
          fresh = false;
        }
      }
    } catch { /* fresh */ }
    if (fresh) {
      job.fd = fs.openSync(job.finalFile, 'w');
      if (job.size != null) fs.ftruncateSync(job.fd, job.size);
      job.segments = this._makeSegments(job.size, this.maxSegments, job.ranges);
      rec.received = 0;
    }
    if (!job.ranges && job.segments.length > 1) job.segments = [job.segments[0]];

    // 3) run segments
    await new Promise((resolveAll, rejectAll) => {
      let doneCount = 0, failed = false;
      const segs = job.segments;
      const onDone = () => { doneCount++; if (doneCount >= segs.length) resolveAll(); };
      const onFail = (err) => {
        if (failed || job.aborting) return;
        failed = true;
        for (const s of segs) s.abort && s.abort();
        rejectAll(err);
      };
      for (const seg of segs) {
        if (seg.pos > seg.end) { onDone(); continue; }
        this._runSegment(job, seg, onDone, onFail);
      }
      if (!segs.length) resolveAll();

      // progress ticker
      job.tick = setInterval(() => {
        const total = segs.reduce((a, s) => a + (s.pos - s.start), 0);
        rec.received = total;
        const dt = (Date.now() - (job._lastT || Date.now())) / 1000;
        const bytes = total - (job._lastB ?? total);
        if (dt > 0.3) {
          rec.speed = Math.max(0, Math.round(bytes / dt));
          job._lastT = Date.now(); job._lastB = total;
          rec.eta = job.size && rec.speed > 0 ? Math.max(0, Math.round((job.size - total) / rec.speed)) : null;
        }
        this._emitProgress(rec);
        this.store.save('history');
      }, 600);

      job.saveT = setInterval(() => this._saveState(job), 2500);
    });

    clearInterval(job.tick); clearInterval(job.saveT);
    if (job.aborting) return;
    fs.closeSync(job.fd); job.fd = null;
    try { fs.unlinkSync(job.stateFile); } catch { }
    rec.status = 'completed'; rec.received = job.size != null ? job.size : rec.received;
    rec.completedAt = Date.now(); rec.speed = 0; rec.eta = null;
    this._finishJob(job, true);
    this._emitStatus(rec);
    this.emit('completed', rec);
    this._drain();
  }

  _makeSegments(size, maxSeg, ranges) {
    if (size == null || !ranges) return [{ start: 0, end: Infinity, pos: 0 }];
    const n = Math.max(1, Math.min(maxSeg, Math.ceil(size / MIN_SEG_SIZE)));
    const per = Math.floor(size / n);
    const segs = [];
    for (let i = 0; i < n; i++) {
      const start = i * per;
      const end = i === n - 1 ? size - 1 : start + per - 1;
      segs.push({ start, end, pos: start });
    }
    return segs;
  }

  _runSegment(job, seg, onDone, onFail) {
    (async () => {
      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        if (job.aborting) return;
        try {
          await this._downloadRange(job, seg);
          onDone();
          return;
        } catch (e) {
          if (job.aborting) return;
          if (e && e.fatal) throw e;
          console.error('[engine]', job.rec.filename, 'segment', seg.start + '-' + (seg.end === Infinity ? '∞' : seg.end), 'attempt', attempt + 1, 'failed:', (e && e.message) || e);
          await U.sleep(600 * (attempt + 1));
        }
      }
      onFail(new Error('segment retries exhausted'));
    })().catch(onFail);
  }

  _downloadRange(job, seg) {
    return new Promise((resolve, reject) => {
      if (job.aborting) return reject({ abort: true });
      const rec = job.rec;
      const headers = {};
      if (job.size != null && seg.end !== Infinity) headers['Range'] = `bytes=${seg.pos}-${seg.end}`;
      if (rec.referrer) headers['Referer'] = rec.referrer;
      if (rec.cookies) headers['Cookie'] = rec.cookies;

      let req;
      try {
        req = net.request({ url: job.finalUrl || rec.url, method: 'GET', redirect: 'follow' });
      } catch (e) { return reject(e); }
      req.setHeader('User-Agent', U.UA);
      req.setHeader('Accept-Encoding', 'identity');
      for (const [k, v] of Object.entries(headers)) if (v) req.setHeader(k, v);
      const abortFn = () => { try { req.abort(); } catch { } };
      job.aborts.add(abortFn);
      seg.abort = abortFn;
      const unreg = () => { job.aborts.delete(abortFn); clearTimeout(idle); };

      let idle = setTimeout(onIdle, IDLE_TIMEOUT);
      function onIdle() { abortFn(); }
      const bump = () => { clearTimeout(idle); idle = setTimeout(onIdle, IDLE_TIMEOUT); };

      req.on('response', async (res) => {
        const st = res.statusCode || 0;
        if (st >= 300 || st < 200) {
          res.resume();
          return reject(new Error('HTTP ' + st));
        }
        if (job.size != null && st === 200 && seg.start > 0) {
          res.resume();
          return reject(new Error('server ignored range'));
        }
        job.lastData = Date.now();
        /* v1.5 FIX: the old `res.on('data', async …)` handler raced itself —
         * the stream kept emitting chunks while the previous write was still
         * pending, so two chunks could be written at the SAME position
         * (silent corruption at chunk boundaries). `for await` on the
         * response stream applies real backpressure: the next chunk is only
         * pulled after the previous one is fully written. */
        try {
          for await (let chunk of res) {
            bump();
            if (job.aborting) { try { req.abort(); } catch { } return unreg() || reject({ abort: true }); }
            if (job.size != null && seg.pos + chunk.length > seg.end + 1) {
              chunk = chunk.subarray(0, seg.end + 1 - seg.pos);
            }
            if (!chunk.length) continue;
            await this.limiter.take(chunk.length);
            if (job.fd === null || job.aborting) { unreg(); return reject({ abort: true }); }
            try {
              /* NOTE: Electron 33's bundled Node does NOT expose
               * fs.promises.write — the callback form fs.write() is the
               * portable one (this bug made every multi-segment download
               * fail with "fs.promises.write is not a function"). */
              await new Promise((res2, rej2) => fs.write(job.fd, chunk, 0, chunk.length, seg.pos, (err2) => err2 ? rej2(err2) : res2()));
            } catch (e) { unreg(); return reject(e); }
            seg.pos += chunk.length;
          }
          unreg(); resolve();
        } catch (e) { unreg(); reject(e); }
      });
      req.on('error', (e) => { unreg(); reject(e); });
      req.end();
    });
  }

  _saveState(job) {
    if (!job.stateFile || job.size == null) return; // unknown-size (single stream) not resumable
    try {
      fs.writeFileSync(job.stateFile, JSON.stringify({
        url: job.finalUrl || job.rec.url,
        etag: job.etag, lastModified: job.lastModified,
        size: job.size, segments: job.segments
      }));
    } catch { }
  }

  _folderFor(rec) {
    /* explicit per-request folder always wins */
    if (rec.folder) return rec.folder;
    /* IDM-style per-category folder from Settings → Categories */
    const catDir = this.categoryFolders && this.categoryFolders[rec.category];
    if (this.categorize && catDir && typeof catDir === 'string' && catDir.trim()) {
      return catDir.replace(/[\\/]+$/, '');
    }
    if (this.categorize) {
      return path.join(this.downloadDir, rec.category === 'other' ? '' : rec.category).replace(/[\\/]+$/, '');
    }
    return this.downloadDir;
  }

  _finishJob(job, cleanup) {
    clearInterval(job.tick); clearInterval(job.saveT);
    for (const a of job.aborts) { try { a(); } catch { } }
    if (job.child) { try { job.child.kill(); } catch { } }
    try { if (job.fd !== null && job.fd !== undefined) fs.closeSync(job.fd); } catch { }
    if (cleanup) { try { fs.unlinkSync(job.stateFile); } catch { } }
    this.jobs.delete(job.rec.id);
    this._drain();
  }

  /* ============ controls ============ */
  async pause(id) {
    const rec = this.get(id); const job = this.jobs.get(id);
    if (!rec || !['downloading', 'queued'].includes(rec.status)) return;
    rec.status = 'paused'; rec.speed = 0; rec.eta = null;
    if (job) {
      job.aborting = true;
      for (const a of job.aborts) { try { a(); } catch { } }
      this._saveState(job);
      this._finishJob(job, false);
    }
    this._emitStatus(rec);
  }

  resume(id) {
    const rec = this.get(id);
    if (!rec || !['paused', 'failed'].includes(rec.status)) return;
    rec.status = 'queued'; rec.error = ''; rec.parked = false;  // explicit user action → no longer parked
    this._emitStatus(rec);
    this._drain();
  }

  async restart(id) {
    const rec = this.get(id); const job = this.jobs.get(id);
    if (job) { job.aborting = true; for (const a of job.aborts) { try { a(); } catch { } } this._finishJob(job, false); }
    if (rec) {
      if (rec.folder) { try { fs.rmSync(path.join(rec.folder, rec.filename + '.raad'), { force: true }); } catch { } }
      rec.status = 'queued'; rec.received = 0; rec.speed = 0; rec.error = '';
      this._emitStatus(rec);
      this._drain();
    }
  }

  remove(id, { keepFile = true } = {}) {
    const rec = this.get(id); if (!rec) return;
    const job = this.jobs.get(id);
    if (job) { job.aborting = true; for (const a of job.aborts) { try { a(); } catch { } } this._finishJob(job, false); }
    if (!keepFile && rec.folder) {
      try { fs.rmSync(path.join(rec.folder, rec.filename), { force: true }); } catch { }
      try { fs.rmSync(path.join(rec.folder, rec.filename + '.raad'), { force: true }); } catch { }
    }
    this.history = this.history.filter(r => r.id !== id);
    this.store.set('history', this.history);
    this.emit('removed', { id });
  }

  pauseAll() { for (const r of this.list({ filter: 'active' })) if (r.status === 'downloading') this.pause(r.id); }
  /* resume-all deliberately skips PARKED items (IDM history imports): a mass
   * "start" from the toolbar/tray/scheduler must never trigger hundreds of
   * downloads the user did not personally choose. */
  resumeAll() { for (const r of this.list({ filter: 'paused' })) { if (r.parked) continue; this.resume(r.id); } }

  /* ============ yt-dlp ============ */
  _findYtdlp() {
    if (this._ytCache !== undefined) return this._ytCache;
    const cand = [this.ytdlpPath, 'yt-dlp', path.join(process.resourcesPath || '', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')].filter(Boolean);
    for (const c of cand) {
      try { require('child_process').execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 8000 }); return this._ytCache = c; } catch { }
    }
    return this._ytCache = '';
  }

  async _runYt(job) {
    const rec = job.rec;
    const exe = this._findYtdlp();
    if (!exe) throw new Error('yt-dlp not found. Install it or set its path in Settings.');
    const folder = this._folderFor(rec);
    fs.mkdirSync(folder, { recursive: true });
    const { spawn } = require('child_process');
    const args = ['--newline', '--no-playlist', '--no-part', '-o', path.join(folder, '%(title).120s [%(id)s].%(ext)s', ), rec.url];
    const child = spawn(exe, args, { windowsHide: true });
    job.child = child;
    let outFile = '';
    let buf = '';
    child.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('[') && path.isAbsolute(line.trim()) && fs.existsSync(line.trim())) outFile = line.trim();
        const m = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\w+i?B)/.exec(line);
        if (m) {
          rec.size = U.parseDataSize(m[2]);
          rec.received = Math.round((parseFloat(m[1]) / 100) * (rec.size || 0));
          const sm = /at\s+([\d.]+\s*\w+\/s)/.exec(line);
          rec.speed = sm ? U.parseDataSize(sm[1].replace('/s', '')) : 0;
          rec.eta = rec.speed ? Math.max(0, Math.round(((rec.size || 0) - rec.received) / rec.speed)) : null;
          this._emitProgress(rec);
        }
      }
    });
    child.stderr.on('data', d => { rec.error = String(d).slice(0, 300); });
    await new Promise((resolve, reject) => {
      child.on('close', code => (code === 0 ? resolve() : reject(new Error('yt-dlp exited ' + code + ' ' + (rec.error || '')))));
      child.on('error', reject);
    });
    if (outFile) {
      rec.filename = path.basename(outFile);
      rec.folder = path.dirname(outFile);
      rec.size = rec.received;
      try { rec.size = fs.statSync(outFile).size; rec.received = rec.size; } catch { }
      rec.category = U.categoryFor(rec.filename, '');
    }
    clearInterval(job.tick);
    rec.status = 'completed'; rec.completedAt = Date.now(); rec.speed = 0; rec.eta = null;
    this._finishJob(job, true);
    this._emitStatus(rec);
    this.emit('completed', rec);
  }

  shutdown() {
    for (const [id, job] of [...this.jobs]) {
      job.aborting = true;
      for (const a of job.aborts) { try { a(); } catch { } }
      this._saveState(job);
    }
    this.store.save('history');
  }
}

module.exports = { Engine };
