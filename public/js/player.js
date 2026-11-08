import { settings, SPEEDS } from './store.js';

// Keys that only describe the current step. Everything else persists until a
// later step overwrites it (or clears it with null).
const TRANSIENT = new Set(['cmp', 'cmpAux', 'swap', 'set', 'm', 'event', 'node', 'id', 'value']);
const KEY_EVENTS = new Set(['found', 'missing', 'done']);

/** Turns the raw C++ step list into renderable frames (state after each step). */
export function buildFrames(steps, kind) {
  const persist = {};
  let nodes = [];
  let cells = new Uint8Array(0);
  const counts = { compare: 0, swap: 0, set: 0 };
  return steps.map((step) => {
    const d = step.data || {};
    const transient = {};
    for (const key of Object.keys(d)) {
      if (TRANSIENT.has(key)) transient[key] = d[key];
      else if (d[key] === null) delete persist[key];
      else persist[key] = d[key];
    }
    if (kind === 'calltree') {
      if (d.event === 'call') nodes = [...nodes, { ...d.node, value: null }];
      else if (d.event === 'return') nodes = nodes.map((n) => (n.id === d.id ? { ...n, value: d.value } : n));
    }
    if (kind === 'sieve') {
      if (typeof d.n === 'number') cells = new Uint8Array(d.n + 1);
      if (Array.isArray(d.cells) && d.cells.length) {
        cells = Uint8Array.from(cells);
        for (const [v, s] of d.cells) cells[v] = s;
      }
    }
    if (step.type === 'compare') counts.compare += 1;
    else if (step.type === 'swap') counts.swap += 1;
    else if (step.type === 'set') counts.set += 1;
    return { step, view: { ...persist, ...transient }, nodes, cells, counts: { ...counts } };
  });
}

export class Player {
  constructor({ frames, algorithmId, onFrame, onState }) {
    this.frames = frames;
    this.algorithmId = algorithmId;
    this.onFrame = onFrame;
    this.onState = onState || (() => {});
    this.index = 0;
    this.playing = false;
    this.timer = null;
    this.speed = settings().speed;
    this.emit();
  }

  get last() { return this.frames.length - 1; }
  get atEnd() { return this.index >= this.last; }
  get delay() { return SPEEDS[this.speed] || SPEEDS.normal; }

  emit() {
    this.onFrame(this.frames[this.index], this.index);
    this.onState(this);
  }

  goto(i) {
    this.index = Math.max(0, Math.min(this.last, i));
    this.emit();
  }

  next() { this.pause(); this.goto(this.index + 1); }
  prev() { this.pause(); this.goto(this.index - 1); }
  reset() { this.pause(); this.goto(0); }

  setSpeed(name) {
    this.speed = name;
    this.onState(this);
  }

  play() {
    if (this.playing) return;
    if (this.atEnd) this.index = 0;
    this.playing = true;
    this.emit();
    this.schedule();
  }

  pause() {
    this.playing = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.onState(this);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      if (this.atEnd) { this.pause(); return; }
      this.index += 1;
      const type = this.frames[this.index].step.type;
      const quickPivot = this.algorithmId === 'quick_sort' && type === 'sorted';
      this.emit();
      if (this.atEnd) { this.pause(); return; }
      if (settings().autoPause && (KEY_EVENTS.has(type) || quickPivot)) { this.pause(); return; }
      this.schedule();
    }, this.delay);
  }

  destroy() {
    this.playing = false;
    clearTimeout(this.timer);
  }
}
