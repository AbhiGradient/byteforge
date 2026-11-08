import { icon, CATEGORY_ICON } from '../icons.js';
import { api } from '../api.js';
import { esc, timeAgo } from '../util.js';
import { getRecent, getExplored, getRuns, getQuizHistory } from '../store.js';

const FEATURED = ['quick_sort', 'dijkstra', 'binary_search', 'fibonacci', 'stack', 'sieve'];
const ACTIONS = { 'visualizer': 'Visualized', code: 'Viewed source of', algorithms: 'Read about' };

export default async function mount(root) {
  root.innerHTML = '<div class="skeleton" style="height:180px"></div><div class="skeleton" style="height:120px"></div>';
  let catalog, health = null;
  try {
    [catalog, health] = await Promise.all([api.catalog(), api.health().catch(() => null)]);
  } catch (err) {
    root.innerHTML = `<div class="notice error"><div><strong>${esc(err.message)}</strong></div></div>`;
    return;
  }
  const list = catalog.algorithms;
  const byId = new Map(list.map((a) => [a.id, a]));
  const counts = {};
  list.forEach((a) => { counts[a.category] = (counts[a.category] || 0) + 1; });

  const explored = Object.keys(getExplored()).filter((id) => byId.has(id)).length;
  const runs = getRuns();
  const quiz = getQuizHistory();
  const avg = quiz.length ? Math.round(quiz.reduce((s, q) => s + (q.score / q.total) * 100, 0) / quiz.length) : null;
  const best = quiz.length ? Math.max(...quiz.map((q) => Math.round((q.score / q.total) * 100))) : null;
  const recent = getRecent().filter((r) => byId.has(r.id)).slice(0, 6);

  const engine = health && health.engine;
  const ai = health && health.ai;

  root.innerHTML = `
    <section class="hero">
      <div class="eyebrow">${icon('cpu')} Real C++17 execution engine</div>
      <h1>Watch real algorithms execute, step by step.</h1>
      <p>BYTEFORGE runs ${list.length} classic algorithms and data structures in C++, streams every comparison, swap and pointer move to your browser, and lets an AI tutor explain what you are seeing.</p>
      <div class="row">
        <a class="btn primary" href="#/visualizer/bubble_sort">${icon('play')} Open the visualizer</a>
        <a class="btn" href="#/ai">${icon('ai')} Ask BYTEFORGE AI</a>
        <a class="btn" href="#/viva">${icon('viva')} Start a viva</a>
      </div>
    </section>

    <div class="grid cols-4" style="margin-bottom:var(--gap)">
      <div class="card stat"><span class="v">${explored}<span class="faint" style="font-size:1rem"> / ${list.length}</span></span><span class="l">Algorithms explored</span></div>
      <div class="card stat"><span class="v">${runs}</span><span class="l">Visualizations run</span></div>
      <div class="card stat"><span class="v">${quiz.length}</span><span class="l">Viva attempts</span></div>
      <div class="card stat"><span class="v">${avg === null ? '-' : `${avg}%`}</span><span class="l">Average viva score${best === null ? '' : ` · best ${best}%`}</span></div>
    </div>
    ${explored + runs + quiz.length === 0 ? `<p class="faint" style="margin:-4px 0 var(--gap)">These numbers come only from what you do in this browser (stored in localStorage). Run a visualization to start tracking.</p>` : ''}

    <div class="grid cols-3" style="grid-template-columns:2fr 1fr;margin-bottom:var(--gap)" id="mid">
      <div class="card">
        <div class="card-head"><h3>${icon('layers')} Categories</h3><a href="#/algorithms">Browse all</a></div>
        <div class="grid cols-3">
          ${Object.entries(catalog.categories).map(([key, label]) => `
            <a class="card flat link cat-card" href="#/algorithms?cat=${key}" style="color:inherit;text-decoration:none">
              <span class="cat-icon">${icon(CATEGORY_ICON[key] || 'info')}</span>
              <h3>${esc(label)}</h3>
              <span class="muted">${counts[key] || 0} algorithm${counts[key] === 1 ? '' : 's'}</span>
            </a>`).join('')}
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>${icon('bolt')} System</h3></div>
          <dl class="kv">
            <dt>C++ engine</dt><dd>${engine && engine.ready ? `ready (v${esc(engine.version)})` : 'not available'}</dd>
            <dt>Algorithms</dt><dd>${list.length}</dd>
            <dt>Gemini AI</dt><dd>${ai ? (ai.configured ? 'key configured' : 'no key (optional)') : 'unknown'}</dd>
            <dt>Model</dt><dd>${ai ? esc(ai.model) : '-'}</dd>
          </dl>
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('clock')} Recently explored</h3></div>
          ${recent.length ? recent.map((r) => { const a = byId.get(r.id); return `<a class="recent-item" href="#/${r.kind === 'code' ? 'code' : 'visualizer'}/${r.id}"><span class="cat-icon" style="width:28px;height:28px">${icon(CATEGORY_ICON[a.category] || 'info')}</span><span style="flex:1"><strong>${esc(a.name)}</strong><br><span class="faint" style="font-size:.78rem">${ACTIONS[r.kind] || 'Opened'} · ${timeAgo(r.ts)}</span></span>${icon('arrowRight')}</a>`; }).join('') : '<p class="muted" style="margin:0">Nothing yet. Open any algorithm and it will show up here.</p>'}
        </div>
      </div>
    </div>

    <div class="card-head" style="margin-top:8px"><h2>Featured algorithms</h2><a href="#/algorithms">See the full library</a></div>
    <div class="grid auto">
      ${FEATURED.filter((id) => byId.has(id)).map((id) => { const a = byId.get(id); return `
        <div class="card link algo-card" data-go="#/algorithms/${id}">
          <div class="row between"><span class="chip accent">${esc(a.categoryLabel)}</span><span class="chip mono">${esc(a.complexity.average)}</span></div>
          <h3>${esc(a.name)}</h3>
          <p>${esc(a.summary)}</p>
          <div class="row"><a class="btn sm primary" href="#/visualizer/${id}">${icon('play')} Visualize</a><a class="btn sm" href="#/code/${id}">${icon('code')} Code</a></div>
        </div>`; }).join('')}
    </div>`;

  root.addEventListener('click', (e) => {
    const card = e.target.closest('[data-go]');
    if (card && !e.target.closest('a')) location.hash = card.dataset.go;
  });
  if (window.innerWidth < 980) root.querySelector('#mid').style.gridTemplateColumns = 'minmax(0,1fr)';
}
