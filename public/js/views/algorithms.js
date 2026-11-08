import { icon, CATEGORY_ICON } from '../icons.js';
import { api } from '../api.js';
import { esc, debounce, skeleton } from '../util.js';
import { addRecent } from '../store.js';
import { renderMarkdown, bindMarkdown } from '../markdown.js';

export default async function mount(root, { params, query }) {
  const id = params[0];
  return id ? detail(root, id) : list(root, query);
}

/* ------------------------------ list ------------------------------------- */
async function list(root, query) {
  root.innerHTML = '<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:300px"></div>';
  const catalog = await api.catalog();
  const all = catalog.algorithms;
  let cat = query.get('cat') || 'all';
  let text = '';

  root.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon('algorithms')} Library</div><h1>Algorithms</h1><p>${all.length} algorithms and data structures, each implemented in C++ and executed by the engine. Pick one to read about it, run it or study its source.</p></div>
      <div class="field" style="min-width:260px"><label for="q">Search</label><input id="q" class="input" placeholder="Name, category or complexity" autocomplete="off"></div>
    </div>
    <div class="row" id="chips" style="margin-bottom:var(--gap)"></div>
    <div class="grid auto" id="grid"></div>

    <div class="grid cols-2" style="margin-top:28px">
      <div class="card" id="compare">
        <div class="card-head"><h3>${icon('layers')} Compare two algorithms</h3></div>
        <div class="input-grid">
          <div class="field"><label for="ca">First</label><select id="ca" class="select">${all.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="cb">Second</label><select id="cb" class="select">${all.map((a, i) => `<option value="${a.id}" ${i === 1 ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
          <button class="btn primary" id="cgo">${icon('arrowRight')} Compare</button>
        </div>
        <div id="cout" style="margin-top:14px"></div>
      </div>
      <div class="card" id="explore">
        <div class="card-head"><h3>${icon('ai')} Explore any algorithm with AI</h3></div>
        <p class="muted">Ask about an algorithm that is not in the library, such as Kruskal's algorithm or an AVL tree. The AI writes an explanation, pseudocode and sample C++. It is <strong>not executed or visualised</strong> by the C++ engine.</p>
        <div class="row"><input id="etopic" class="input" style="flex:1;min-width:180px" maxlength="80" placeholder="e.g. Kruskal's algorithm"><button class="btn primary" id="ego">${icon('search')} Explain</button></div>
        <div id="eout" style="margin-top:14px"></div>
      </div>
    </div>`;

  const chips = root.querySelector('#chips');
  const grid = root.querySelector('#grid');
  const draw = () => {
    chips.innerHTML = [['all', 'All'], ...Object.entries(catalog.categories)].map(([k, l]) => `<button class="chip ${cat === k ? 'on' : ''}" data-cat="${k}">${esc(l)}</button>`).join('');
    const t = text.toLowerCase();
    const items = all.filter((a) => (cat === 'all' || a.category === cat) && (!t || `${a.name} ${a.categoryLabel} ${a.summary} ${a.complexity.average} ${a.complexity.worst}`.toLowerCase().includes(t)));
    grid.innerHTML = items.length ? items.map((a) => `
      <div class="card link algo-card" data-go="#/algorithms/${a.id}">
        <div class="row between"><span class="chip accent">${icon(CATEGORY_ICON[a.category] || 'info')}${esc(a.categoryLabel)}</span><span class="chip mono" title="Average time complexity">${esc(a.complexity.average)}</span></div>
        <h3>${esc(a.name)}</h3><p>${esc(a.summary)}</p>
        <div class="row"><a class="btn sm primary" href="#/visualizer/${a.id}">${icon('play')} Visualize</a><a class="btn sm" href="#/code/${a.id}">${icon('code')} Code</a></div>
      </div>`).join('') : '<div class="empty" style="grid-column:1/-1">No algorithm matches that search.</div>';
  };
  draw();
  chips.addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { cat = b.dataset.cat; draw(); } });
  root.querySelector('#q').addEventListener('input', debounce((e) => { text = e.target.value.trim(); draw(); }, 120));
  grid.addEventListener('click', (e) => { const c = e.target.closest('[data-go]'); if (c && !e.target.closest('a')) location.hash = c.dataset.go; });

  const pre = query.get('compare');
  if (pre) root.querySelector('#ca').value = pre;

  const cout = root.querySelector('#cout');
  bindMarkdown(cout);
  root.querySelector('#cgo').addEventListener('click', async () => {
    const a = root.querySelector('#ca').value, b = root.querySelector('#cb').value;
    if (a === b) { cout.innerHTML = '<div class="notice warn"><div>Choose two different algorithms.</div></div>'; return; }
    const A = all.find((x) => x.id === a), B = all.find((x) => x.id === b);
    const row = (label, k) => `<tr><td>${label}</td><td class="mono">${esc(A.complexity[k])}</td><td class="mono">${esc(B.complexity[k])}</td></tr>`;
    cout.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>From the C++ engine</th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead><tbody>${row('Best', 'best')}${row('Average', 'average')}${row('Worst', 'worst')}${row('Space', 'space')}</tbody></table></div><div id="cai" style="margin-top:14px">${skeleton(5)}</div>`;
    try {
      const r = await api.compare(a, b);
      cout.querySelector('#cai').innerHTML = `${renderMarkdown(r.text)}<div class="ai-tag">${icon('ai')} AI-generated by ${esc(r.model)}. The table above is the authoritative data.</div>`;
    } catch (err) {
      cout.querySelector('#cai').innerHTML = `<div class="notice error"><div>${esc(err.message)}</div></div>`;
    }
  });

  const eout = root.querySelector('#eout');
  bindMarkdown(eout);
  const explore = async (force = false) => {
    const topic = root.querySelector('#etopic').value.trim();
    if (topic.length < 2) return;
    eout.innerHTML = skeleton(6);
    try {
      const r = await api.explore(topic, force);
      if (r.supported) {
        eout.innerHTML = `<div class="notice info"><div><strong>${esc(r.name)}</strong> is in the BYTEFORGE library and runs on the real C++ engine.<div class="row" style="margin-top:8px"><a class="btn sm primary" href="#/visualizer/${r.id}">${icon('play')} Open interactive visualization</a><a class="btn sm" href="#/algorithms/${r.id}">Details</a><button class="btn sm ghost" data-force>Show AI reference anyway</button></div></div></div>`;
        eout.querySelector('[data-force]').addEventListener('click', () => explore(true));
        return;
      }
      eout.innerHTML = `<div class="notice warn"><div><strong>AI-generated reference, not executed.</strong> ${esc(r.topic)} is not part of the C++ library, so there is no interactive visualization for it.</div></div><div style="margin-top:12px">${renderMarkdown(r.text)}</div><div class="ai-tag">${icon('ai')} Generated by ${esc(r.model)}. Verify before relying on it.</div>`;
    } catch (err) {
      eout.innerHTML = `<div class="notice error"><div>${esc(err.message)}</div></div>`;
    }
  };
  root.querySelector('#ego').addEventListener('click', () => explore(false));
  root.querySelector('#etopic').addEventListener('keydown', (e) => { if (e.key === 'Enter') explore(false); });
}

/* ------------------------------ detail ----------------------------------- */
async function detail(root, id) {
  root.innerHTML = '<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:300px"></div>';
  let a;
  try { a = await api.algorithm(id); } catch (err) {
    root.innerHTML = `<div class="empty"><h2>Algorithm not found</h2><p>${esc(err.message)}</p><a class="btn" href="#/algorithms">Back to the library</a></div>`;
    return;
  }
  addRecent(id, 'algorithms');
  const c = a.complexity, n = a.complexityNotes || {};
  root.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon(CATEGORY_ICON[a.category] || 'info')} ${esc(a.categoryLabel)}</div><h1>${esc(a.name)}</h1><p>${esc(a.summary)}</p></div>
      <div class="row"><a class="btn primary" href="#/visualizer/${a.id}">${icon('play')} Visualize</a><a class="btn" href="#/code/${a.id}">${icon('code')} View C++</a><a class="btn ghost" href="#/algorithms?compare=${a.id}">${icon('layers')} Compare</a></div>
    </div>
    <div class="grid cols-2" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr)">
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('book')} How it works</h3></div><p>${esc(a.description)}</p><ol>${a.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
        <div class="card"><div class="card-head"><h3>${icon('target')} Real-world applications</h3></div><ul>${a.applications.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>
        <div class="card"><div class="card-head"><h3>${icon('play')} Example inputs</h3></div>
          <p class="muted">${esc(a.inputHelp)}</p>
          ${a.examples.map((ex, i) => `<div class="row between" style="padding:8px 0;border-top:1px solid var(--border)"><div><strong>${esc(ex.label)}</strong><div class="mono faint" style="font-size:.78rem;word-break:break-all">${esc(JSON.stringify(ex.input))}</div></div><a class="btn sm" href="#/visualizer/${a.id}?ex=${i}">${icon('play')} Run</a></div>`).join('')}
        </div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>${icon('clock')} Complexity</h3><span class="chip teal">theoretical</span></div>
          <table class="data"><tbody>
            <tr><td>Best case</td><td class="mono">${esc(c.best)}</td></tr><tr><td colspan="2" class="faint" style="padding-top:0;font-size:.8rem">${esc(n.best || '')}</td></tr>
            <tr><td>Average case</td><td class="mono">${esc(c.average)}</td></tr>
            <tr><td>Worst case</td><td class="mono">${esc(c.worst)}</td></tr><tr><td colspan="2" class="faint" style="padding-top:0;font-size:.8rem">${esc(n.worst || '')}</td></tr>
            <tr><td>Space</td><td class="mono">${esc(c.space)}</td></tr><tr><td colspan="2" class="faint" style="padding-top:0;font-size:.8rem">${esc(n.space || '')}</td></tr>
          </tbody></table>
          <p class="hint" style="margin-top:10px">The visualizer shows the <em>measured</em> operation counts of your actual run next to these theoretical bounds.</p>
        </div>
        <div class="card"><div class="card-head"><h3>Properties</h3></div><div class="badge-row">${a.properties.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div></div>
      </div>
    </div>`;
}
