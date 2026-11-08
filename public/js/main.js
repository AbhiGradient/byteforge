import { applySettings, settings, setSettings, onSettings } from './store.js';
import { icon } from './icons.js';
import { api } from './api.js';
import { $, toast } from './util.js';

applySettings();

const NAV = [
  ['/', 'Dashboard', 'dashboard'],
  ['/algorithms', 'Algorithms', 'algorithms'],
  ['/visualizer', 'Visualizer', 'visualizer'],
  ['/code', 'Code Explorer', 'code'],
  ['/viva', 'VIVA ARENA', 'viva']
];

const ROUTES = [
  { re: /^\/$/, section: '/', load: () => import('./views/dashboard.js') },
  { re: /^\/algorithms(?:\/([a-z_]+))?$/, section: '/algorithms', load: () => import('./views/algorithms.js') },
  { re: /^\/visualizer(?:\/([a-z_]+))?$/, section: '/visualizer', load: () => import('./views/visualizer.js') },
  { re: /^\/code(?:\/([a-z_]+))?$/, section: '/code', load: () => import('./views/code.js') },
  { re: /^\/viva$/, section: '/viva', load: () => import('./views/viva.js') },
  { re: /^\/ai$/, section: '/ai', load: () => import('./views/chat.js'), wide: true },
  { re: /^\/settings$/, section: '/settings', load: () => import('./views/settings.js') }
];

const view = $('#view');
let cleanup = null;
let navToken = 0;

function renderNav() {
  const nav = $('#navbar');
  nav.innerHTML = `
    <a class="brand" href="#/" aria-label="BYTEFORGE home"><span class="brand-mark">${icon('logo')}</span><span class="word">BYTEFORGE</span></a>
    <nav class="nav-links" id="navlinks" aria-label="Main">
      ${NAV.map(([href, label, ic]) => `<a class="nav-link" data-section="${href}" href="#${href}">${icon(ic)}${label}</a>`).join('')}
      <a class="nav-link nav-ai" data-section="/ai" href="#/ai">${icon('ai')}BYTEFORGE AI</a>
      <a class="nav-link" data-section="/settings" href="#/settings">${icon('settings')}Settings</a>
    </nav>
    <div class="nav-tools">
      <span class="status-dot" id="statusDot" title="Checking server..."></span>
      <button class="btn ghost icon" id="themeBtn" aria-label="Toggle colour theme" title="Toggle theme"></button>
      <button class="btn ghost icon menu-btn" id="menuBtn" aria-label="Open menu" aria-expanded="false">${icon('menu')}</button>
    </div>`;
  $('#menuBtn').addEventListener('click', () => {
    const open = $('#navlinks').classList.toggle('open');
    $('#menuBtn').setAttribute('aria-expanded', String(open));
    $('#menuBtn').innerHTML = icon(open ? 'x' : 'menu');
  });
  $('#themeBtn').addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    setSettings({ theme: dark ? 'light' : 'dark' });
  });
  const syncTheme = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    $('#themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
    $('#themeBtn').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  };
  syncTheme();
  onSettings(syncTheme);
}

function markActive(section) {
  document.querySelectorAll('.nav-link').forEach((a) => {
    const on = a.dataset.section === section;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#navlinks').classList.remove('open');
  const mb = $('#menuBtn');
  if (mb) { mb.setAttribute('aria-expanded', 'false'); mb.innerHTML = icon('menu'); }
}

async function route() {
  const token = ++navToken;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  const query = new URLSearchParams(queryString);
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;

  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  const found = match || { r: ROUTES[0], m: ['/'] };
  markActive(found.r.section);
  view.classList.toggle('wide', Boolean(found.r.wide));
  view.innerHTML = '';
  try {
    const mod = await found.r.load();
    if (token !== navToken) return;
    const result = await mod.default(view, { params: found.m.slice(1), query, path });
    if (token !== navToken) { if (typeof result === 'function') result(); return; }
    cleanup = result;
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${String(err.message || err).replace(/</g, '&lt;')}</p><a class="btn" href="#/">Back to dashboard</a></div>`;
  }
  window.scrollTo(0, 0);
  if (location.hash !== '' ) view.focus({ preventScroll: true });
}

async function checkHealth() {
  const dot = $('#statusDot');
  try {
    const h = await api.health();
    const engineOk = h.engine && h.engine.ready;
    dot.className = `status-dot ${engineOk ? (h.ai.configured ? 'ok' : 'warn') : 'bad'}`;
    dot.title = engineOk ? `C++ engine ready. Gemini: ${h.ai.configured ? `configured (${h.ai.model})` : 'no API key (AI features off)'}` : 'C++ engine is not available';
  } catch {
    dot.className = 'status-dot bad';
    dot.title = 'Cannot reach the BYTEFORGE server';
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });
renderNav();
checkHealth();
route();
setInterval(checkHealth, 60000);
