'use strict';
/* Raad DM — download scheduler: daily time windows & one-shot triggers,
 * optional auto shutdown/sleep when queue drains. */
const { EventEmitter } = require('events');
const { execFile } = require('child_process');

class Scheduler extends EventEmitter {
  constructor(store, engine) {
    super();
    this.store = store;
    this.engine = engine;
    this.schedules = store.get('schedules', []);
    this._firedOnce = new Set();
    this.timer = setInterval(() => this.tick(), 20000);
    this.shutdownArm = null; // {at, scheduleId}
  }

  list() { return this.schedules; }

  save(item) {
    if (!item.id) item.id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const i = this.schedules.findIndex(s => s.id === item.id);
    if (i >= 0) this.schedules[i] = item; else this.schedules.push(item);
    this.store.save('schedules');
    return item;
  }

  remove(id) {
    this.schedules = this.schedules.filter(s => s.id !== id);
    this.store.set('schedules', this.schedules);
  }

  toggle(id) {
    const s = this.schedules.find(x => x.id === id);
    if (s) { s.enabled = !s.enabled; this.store.save('schedules'); }
    return s;
  }

  _hmNow() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  _inWindow(s) {
    const now = this._hmNow();
    const start = s.start, end = s.end;
    if (!end || start === end) return now >= start; // start-only trigger
    if (start < end) return now >= start && now < end;
    return now >= start || now < end; // overnight window
  }

  tick() {
    const day = new Date().getDay();
    const hhmm = this._hmNow();
    const minuteKey = hhmm.slice(0, 4); // HH:M — fire once per minute
    for (const s of this.schedules) {
      if (!s.enabled) continue;
      if (Array.isArray(s.days) && s.days.length && !s.days.includes(day)) continue;
      const key = s.id + '@' + hhmm;
      if (s.start === hhmm && !this._firedOnce.has(key)) {
        this._firedOnce.add(key);
        this.fire(s);
      }
      if (s.end && s.end !== s.start && s.end === hhmm && s.action === 'start') {
        this.engine.pauseAll();
        this.emit('fired', { schedule: s, effect: 'paused' });
      }
    }
    // prune old one-minute keys
    if (this._firedOnce.size > 500) this._firedOnce.clear();

    // auto shutdown when queue drained (armed by schedule with shutdown flag)
    if (this.shutdownArm && Date.now() >= this.shutdownArm.at) {
      const pending = this.engine.counts().active;
      if (pending === 0) { this.shutdownArm = null; this.powerOff(); }
      else this.shutdownArm.at = Date.now() + 30000;
    }
  }

  fire(s) {
    if (s.action === 'start') {
      this.engine.resumeAll();
      if (s.shutdown) this.shutdownArm = { at: Date.now() + 60000 };
      this.emit('fired', { schedule: s, effect: 'started' });
    } else {
      this.engine.pauseAll();
      this.emit('fired', { schedule: s, effect: 'paused' });
    }
  }

  powerOff(mode = 'shutdown') {
    try {
      if (process.platform === 'win32') {
        execFile('shutdown', mode === 'sleep' ? [] : ['/s', '/t', '60']);
      } else if (process.platform === 'darwin') {
        execFile('osascript', ['-e', 'tell app "System Events" to shut down']);
      } else {
        execFile('systemctl', [mode === 'sleep' ? 'suspend' : 'poweroff']);
      }
      return true;
    } catch (e) { return false; }
  }

  cancelPowerOff() {
    try { if (process.platform === 'win32') execFile('shutdown', ['/a']); } catch { }
  }

  shutdown() { clearInterval(this.timer); this.store.save('schedules'); }
}

module.exports = { Scheduler };
