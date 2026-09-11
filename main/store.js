'use strict';
/* Raad DM — JSON persistence layer (debounced, atomic writes) */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this._cache = new Map();
    this._timers = new Map();
  }

  _file(name) { return path.join(this.dir, name + '.json'); }

  load(name, fallback) {
    try {
      const raw = fs.readFileSync(this._file(name), 'utf8');
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  get(name, fallback) {
    if (!this._cache.has(name)) this._cache.set(name, this.load(name, fallback));
    return this._cache.get(name);
  }

  set(name, value) {
    this._cache.set(name, value);
    this.save(name);
  }

  save(name) {
    clearTimeout(this._timers.get(name));
    this._timers.set(name, setTimeout(() => this._flush(name), 350));
  }

  _flush(name) {
    try {
      const tmp = this._file(name) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._cache.get(name) ?? null, null, 1), 'utf8');
      fs.renameSync(tmp, this._file(name));
    } catch (e) {
      console.error('[store] flush failed:', name, e.message);
    }
  }

  flushAll() {
    for (const name of this._cache.keys()) this._flush(name);
  }
}

module.exports = { Store };
