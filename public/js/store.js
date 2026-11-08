// Local persistence (localStorage only; there is no database anywhere).
const PREFIX = 'byteforge:';

export const DEFAULTS = {
  theme: 'system',
  accent: 'violet',
  motion: 'full',
  density: 'comfortable',
  speed: 'normal',
  autoPause: false,
  showStats: true,
  showCode: true,
  highlightLines: true,
  fontSize: 13,
  fontFamily: 'jetbrains',
  lineNumbers: true,
  wordWrap: false,
  chatStyle: 'concise',
  showEngine: true,
  keepChat: true
};

export const SPEEDS = { slow: 900, normal: 450, fast: 180, veryfast: 50 };
const FONTS = {
  jetbrains: "'JetBrains Mono', ui-monospace, Consolas, monospace",
  consolas: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
  courier: "'Courier New', Courier, monospace",
  system: 'ui-monospace, SFMono-Regular, Menlo, monospace'
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

let current = { ...DEFAULTS, ...read('settings', {}) };
const listeners = new Set();
const media = window.matchMedia('(prefers-color-scheme: dark)');

export const settings = () => current;
export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function applySettings() {
  const root = document.documentElement;
  const dark = current.theme === 'dark' || (current.theme === 'system' && media.matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.setAttribute('data-accent', current.accent);
  root.setAttribute('data-density', current.density);
  root.setAttribute('data-motion', current.motion);
  root.style.setProperty('--code-size', `${current.fontSize}px`);
  root.style.setProperty('--code-font', FONTS[current.fontFamily] || FONTS.jetbrains);
}

export function setSettings(patch) {
  current = { ...current, ...patch };
  write('settings', current);
  applySettings();
  listeners.forEach((fn) => fn(current, patch));
}

export function resetSettings() {
  current = { ...DEFAULTS };
  try { localStorage.removeItem(PREFIX + 'settings'); } catch { /* ignore */ }
  applySettings();
  listeners.forEach((fn) => fn(current, {}));
}

media.addEventListener('change', () => { if (current.theme === 'system') applySettings(); });

// ---- recent activity & learning statistics ----
export const getRecent = () => read('recent', []);
export function addRecent(id, kind) {
  const list = getRecent().filter((r) => r.id !== id);
  list.unshift({ id, kind, ts: Date.now() });
  write('recent', list.slice(0, 12));
  const explored = read('explored', {});
  explored[id] = { count: (explored[id]?.count || 0) + 1, last: Date.now() };
  write('explored', explored);
  write('last', id);
}
export const getLastAlgorithm = () => read('last', null);
export const getExplored = () => read('explored', {});
export function countRun() { write('runs', (read('runs', 0) || 0) + 1); }
export const getRuns = () => read('runs', 0);
export function clearRecent() {
  for (const k of ['recent', 'explored', 'runs', 'last']) localStorage.removeItem(PREFIX + k);
}

// ---- viva history ----
export const getQuizHistory = () => read('quiz', []);
export function addQuizResult(result) {
  write('quiz', [{ ...result, ts: Date.now() }, ...getQuizHistory()].slice(0, 50));
}
export function clearQuizHistory() { localStorage.removeItem(PREFIX + 'quiz'); }

// ---- chat session ----
export function loadChat() {
  const store = current.keepChat ? sessionStorage : null;
  try { return JSON.parse(store?.getItem(PREFIX + 'chat') || '[]'); } catch { return []; }
}
export function saveChat(messages) {
  if (!current.keepChat) return;
  try { sessionStorage.setItem(PREFIX + 'chat', JSON.stringify(messages.slice(-60))); } catch { /* ignore */ }
}
export function clearChat() { try { sessionStorage.removeItem(PREFIX + 'chat'); } catch { /* ignore */ } }
