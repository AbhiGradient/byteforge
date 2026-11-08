export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function fmtNumber(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : String(n ?? '-');
}

export function fmtMicros(us) {
  if (us == null) return '-';
  if (us < 1) return `${(us * 1000).toFixed(0)} ns`;
  if (us < 1000) return `${us.toFixed(us < 10 ? 2 : 1)} µs`;
  return `${(us / 1000).toFixed(2)} ms`;
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function toast(message, type = 'info', ms = 3200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export async function copyText(text, okMessage = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { toast('Copy failed', 'error'); return false; }
    ta.remove();
  }
  toast(okMessage);
  return true;
}

export function skeleton(lines = 4) {
  return Array.from({ length: lines }, (_, i) => `<div class="skeleton" style="width:${95 - (i % 3) * 18}%"></div>`).join('');
}

export function notice(type, message) {
  return `<div class="notice ${type}">${type === 'error' || type === 'warn' ? '⚠' : 'ℹ'}<div>${esc(message)}</div></div>`;
}

export function randomInts(count, min = 1, max = 99) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * (max - min + 1)) + min);
}

export function parseIntList(text) {
  const parts = String(text).split(/[\s,;]+/).filter(Boolean);
  const values = parts.map(Number);
  if (values.some((v) => !Number.isFinite(v))) return null;
  return values;
}
