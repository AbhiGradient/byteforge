import { icon } from '../icons.js';
import { api } from '../api.js';
import { esc, fmtNumber, fmtMicros, randomInts, parseIntList, skeleton } from '../util.js';
import { buildFrames, Player } from '../player.js';
import { createRenderer } from '../viz.js';
import { mountCodeViewer } from '../codeviewer.js';
import { mountAiPanel } from '../ai-panel.js';
import { settings, onSettings, setSettings, addRecent, countRun } from '../store.js';

const SPEED_LABELS = { slow: 'Slow', normal: 'Normal', fast: 'Fast', veryfast: 'Very fast' };

export default async function mount(root, { params, query }) {
  const catalog = await api.catalog();
  const all = catalog.algorithms;
  const id = params[0] || all[0].id;
  if (!all.some((a) => a.id === id)) { location.hash = '#/visualizer'; return null; }
  const algo = await api.algorithm(id);

  let player = null;
  let renderer = null;
  let report = null;
  let ctx = null;
  let analysis = null;
  let codeViewer = null;
  let aiPanel = null;
  let runToken = 0;
  let sideTab = settings().showCode ? 'code' : settings().showStats ? 'stats' : 'ai';
  const offs = [];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${icon('visualizer')} Visualizer</div>
        <h1>${esc(algo.name)}</h1>
        <p>${esc(algo.summary)}</p>
      </div>
      <div class="row">
        <div class="field" style="min-width:230px"><label for="algoSel">Algorithm</label>
          <select id="algoSel" class="select">${Object.entries(catalog.categories).map(([k, l]) => `<optgroup label="${esc(l)}">${all.filter((a) => a.category === k).map((a) => `<option value="${a.id}" ${a.id === id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
        <a class="btn" href="#/code/${id}">${icon('code')} Code</a>
        <a class="btn ghost" href="#/algorithms/${id}">${icon('book')} Details</a>
      </div>
    </div>

    <div class="viz-layout" id="layout">
      <div class="viz-main">
        <div class="stage" id="stage"><div class="empty" style="border:0">Running the C++ engine...</div></div>
        <div id="legend"></div>
        <div class="stage-msg" id="msg" aria-live="polite"><span class="step-type">ready</span><span>Press Run to execute the algorithm.</span></div>

        <div class="controls" id="controls">
          <button class="btn icon" id="bReset" title="Reset (Home)" aria-label="Reset">${icon('reset')}</button>
          <button class="btn icon" id="bPrev" title="Previous step (Left arrow)" aria-label="Previous step">${icon('prev')}</button>
          <button class="btn primary" id="bPlay" style="min-width:104px">${icon('play')} <span>Play</span></button>
          <button class="btn icon" id="bNext" title="Next step (Right arrow)" aria-label="Next step">${icon('next')}</button>
          <div class="progress"><input type="range" id="scrub" min="0" max="0" value="0" aria-label="Execution progress"><div class="progress-bar"><i id="pbar" style="width:0%"></i></div><div class="counter"><span id="stepCount">Step 0 / 0</span><span id="stepPct">0%</span></div></div>
          <div class="speed"><span class="label">Speed</span><div class="seg" id="speedSeg">${Object.entries(SPEED_LABELS).map(([k, l]) => `<button data-speed="${k}">${l}</button>`).join('')}</div></div>
        </div>

        <div class="card" id="inputCard">
          <div class="card-head"><h3>${icon('list')} Input</h3>
            <div class="row"><select id="examples" class="select" style="width:auto;min-width:170px" aria-label="Load example"><option value="">Load an example...</option>${algo.examples.map((e, i) => `<option value="${i}">${esc(e.label)}</option>`).join('')}</select></div>
          </div>
          <div id="form"></div>
          <div class="row" style="margin-top:12px"><button class="btn primary" id="runBtn">${icon('bolt')} Run on C++ engine</button><span class="hint">${esc(algo.inputHelp)}</span></div>
          <div id="formError" class="error-text" role="alert" style="margin-top:8px"></div>
        </div>

      </div>

      <div class="viz-side" id="side">
        <div class="card pad-0">
          <div class="tabs" id="sideTabs" style="padding:0 8px"></div>
          <div id="paneCode" hidden></div>
          <div id="paneStats" hidden style="padding:16px"></div>
          <div id="paneAi" hidden></div>
        </div>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const stage = $('#stage');

  /* ------------------------------ input form ------------------------------ */
  const cat = algo.category;
  const def = algo.defaultInput;
  const urlExample = query.get('ex') !== null ? algo.examples[Number(query.get('ex'))] : null;
  const startInput = urlExample ? urlExample.input : def;

  function formHtml(input) {
    if (cat === 'sorting' || cat === 'searching') {
      const searching = cat === 'searching';
      return `<div class="stack" style="gap:10px"><div class="field"><label for="fArr">Array (comma separated integers)</label><input id="fArr" class="input mono" value="${esc((input.array || []).join(', '))}" spellcheck="false"></div>
        <div class="row">
          ${searching ? `<div class="field" style="width:130px"><label for="fTarget">Target</label><input id="fTarget" class="input mono" type="number" value="${input.target ?? 0}"></div>` : ''}
          <button class="btn sm" data-gen="random">${icon('shuffle')} Random</button>
          <button class="btn sm" data-gen="sorted">Sorted</button>
          ${searching ? '' : '<button class="btn sm" data-gen="reversed">Reversed</button><button class="btn sm" data-gen="few">Few unique</button>'}
          ${searching ? `<button class="btn sm" data-gen="sortinput">Sort input</button><button class="btn sm" data-gen="pick">Pick a present target</button>` : ''}
          <div class="field" style="width:96px"><label for="fSize">Size</label><select id="fSize" class="select">${[6, 8, 10, 12, 16, 20, 30].map((n) => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        </div></div>`;
    }
    if (cat === 'graph') {
      const edges = (input.edges || []).map((e) => e.join(' ')).join('\n');
      return `<div class="input-grid">
        <div class="field"><label for="gN">Nodes (2-12)</label><input id="gN" class="input mono" type="number" min="2" max="12" value="${input.nodes}"></div>
        <div class="field"><label for="gS">Start node</label><input id="gS" class="input mono" type="number" min="0" value="${input.start ?? 0}"></div>
        <div class="field"><label for="gT">Target (optional)</label><input id="gT" class="input mono" type="number" min="0" value="${input.target ?? ''}" placeholder="none"></div>
        <label class="row" style="padding-bottom:8px"><span class="switch"><input type="checkbox" id="gD" ${input.directed ? 'checked' : ''}><span></span></span> Directed</label>
      </div>
      <div class="field" style="margin-top:10px"><label for="gE">Edges, one per line: from to ${algo.id === 'dijkstra' ? 'weight' : '[weight]'}</label><textarea id="gE" class="textarea" rows="5" spellcheck="false">${esc(edges)}</textarea></div>`;
    }
    if (cat === 'structure') {
      const templates = { stack: ['push 7', 'pop', 'peek'], queue: ['enqueue 7', 'dequeue', 'front'], singly_linked_list: ['insert_head 7', 'insert_tail 7', 'insert_at 1 7', 'delete 7', 'search 7', 'traverse'], doubly_linked_list: ['insert_head 7', 'insert_tail 7', 'insert_at 1 7', 'delete 7', 'search 7', 'traverse', 'traverse_back'], circular_linked_list: ['insert_head 7', 'insert_tail 7', 'delete 7', 'search 7', 'traverse'] }[algo.id] || [];
      const cap = algo.id === 'stack' || algo.id === 'queue';
      return `<div class="field"><label for="sOps">Operations, one per line</label><textarea id="sOps" class="textarea" rows="6" spellcheck="false">${esc((input.ops || []).join('\n'))}</textarea></div>
        <div class="row" style="margin-top:8px">${cap ? `<div class="field" style="width:120px"><label for="sCap">Capacity (1-10)</label><input id="sCap" class="input mono" type="number" min="1" max="10" value="${input.capacity ?? 6}"></div>` : ''}<span class="label">Add:</span>${templates.map((t) => `<button class="chip" data-op="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
    }
    if (algo.id === 'gcd') {
      return `<div class="input-grid"><div class="field"><label for="gA">a</label><input id="gA" class="input mono" type="number" min="0" value="${input.a}"></div><div class="field"><label for="gB">b</label><input id="gB" class="input mono" type="number" min="0" value="${input.b}"></div></div>`;
    }
    const max = algo.id === 'sieve' ? 200 : algo.id === 'fibonacci' ? 12 : 20;
    return `<div class="input-grid"><div class="field"><label for="nN">n (0-${algo.id === 'sieve' ? '200, minimum 2' : max})</label><input id="nN" class="input mono" type="number" min="${algo.id === 'sieve' ? 2 : 0}" max="${max}" value="${input.n}"></div></div>`;
  }

  function readInput() {
    const v = (s) => root.querySelector(s);
    if (cat === 'sorting' || cat === 'searching') {
      const arr = parseIntList(v('#fArr').value);
      if (!arr || !arr.length) throw new Error('Enter the array as comma separated numbers, for example 5, 3, 8.');
      const out = { array: arr };
      if (cat === 'searching') {
        const t = Number(v('#fTarget').value);
        if (!Number.isFinite(t)) throw new Error('The target must be a number.');
        out.target = t;
      }
      return out;
    }
    if (cat === 'graph') {
      const lines = v('#gE').value.split('\n').map((l) => l.trim()).filter(Boolean);
      const edges = lines.map((l, i) => {
        const nums = l.match(/-?\d+/g);
        if (!nums || nums.length < 2 || nums.length > 3) throw new Error(`Edge line ${i + 1} must look like "0 1" or "0 1 5".`);
        return nums.map(Number);
      });
      const t = v('#gT').value.trim();
      return { nodes: Number(v('#gN').value), directed: v('#gD').checked, edges, start: Number(v('#gS').value), target: t === '' ? null : Number(t) };
    }
    if (cat === 'structure') {
      const ops = v('#sOps').value.split(/[\n;]/).map((l) => l.trim()).filter(Boolean);
      const out = { ops };
      if (v('#sCap')) out.capacity = Number(v('#sCap').value);
      return out;
    }
    if (algo.id === 'gcd') return { a: Number(v('#gA').value), b: Number(v('#gB').value) };
    return { n: Number(v('#nN').value) };
  }

  function writeInput(input) {
    $('#form').innerHTML = formHtml(input);
  }

  $('#form').addEventListener('click', (e) => {
    const gen = e.target.closest('[data-gen]');
    const op = e.target.closest('[data-op]');
    if (op) { const ta = $('#sOps'); ta.value = `${ta.value.trim()}${ta.value.trim() ? '\n' : ''}${op.dataset.op}`; return; }
    if (!gen) return;
    const size = Number($('#fSize').value);
    const field = $('#fArr');
    let arr = parseIntList(field.value) || [];
    const kind = gen.dataset.gen;
    if (kind === 'random') arr = randomInts(size);
    else if (kind === 'sorted') arr = (arr.length ? arr : randomInts(size)).slice().sort((a, b) => a - b);
    else if (kind === 'reversed') arr = (arr.length ? arr : randomInts(size)).slice().sort((a, b) => b - a);
    else if (kind === 'few') arr = Array.from({ length: size }, () => 1 + Math.floor(Math.random() * 4));
    else if (kind === 'sortinput') arr = arr.slice().sort((a, b) => a - b);
    else if (kind === 'pick' && arr.length) { $('#fTarget').value = arr[Math.floor(Math.random() * arr.length)]; return; }
    if (cat === 'searching' && kind === 'random') arr = [...new Set(arr)].sort((a, b) => a - b);
    field.value = arr.join(', ');
  });

  $('#examples').addEventListener('change', (e) => {
    if (e.target.value === '') return;
    writeInput(algo.examples[Number(e.target.value)].input);
    e.target.value = '';
    run();
  });
  $('#algoSel').addEventListener('change', (e) => { location.hash = `#/visualizer/${e.target.value}`; });

  /* ------------------------------ running ---------------------------------- */
  async function run() {
    const mine = ++runToken;
    $('#formError').textContent = '';
    let input;
    try { input = readInput(); } catch (err) { $('#formError').textContent = err.message; return; }
    const btn = $('#runBtn');
    btn.disabled = true;
    try {
      const result = await api.execute(id, input);
      if (mine !== runToken) return;
      report = result;
      analysisReset();
      countRun();
      addRecent(id, 'visualizer');
      start(result);
    } catch (err) {
      if (mine !== runToken) return;
      $('#formError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }
  $('#runBtn').addEventListener('click', run);

  function start(result) {
    if (player) player.destroy();
    const frames = buildFrames(result.steps, algo.visualization);
    ctx = { algorithmId: id, input: result.input, frames, index: 0 };
    renderer = createRenderer(algo.visualization, stage, ctx);
    $('#legend').innerHTML = renderer.legend || '';
    $('#scrub').max = String(frames.length - 1);
    player = new Player({
      frames,
      algorithmId: id,
      onFrame: (frame, index) => {
        ctx.index = index;
        renderer.update(frame, ctx);
        $('#msg').innerHTML = `<span class="step-type">${esc(frame.step.type)}</span><span>${esc(frame.step.msg)}</span>`;
        if (codeViewer) codeViewer.setActive(frame.step.line);
        renderStatsLive(frame, index);
      },
      onState: syncControls
    });
    player.setSpeed(settings().speed);
    syncControls(player);
    if (result.meta.truncated) $('#formError').textContent = 'The step list was truncated; statistics are still complete.';
    renderStatsStatic();
  }

  function syncControls(p) {
    const label = p.playing ? 'Pause' : p.atEnd ? 'Replay' : p.index > 0 ? 'Resume' : 'Play';
    $('#bPlay').innerHTML = `${icon(p.playing ? 'pause' : 'play')} <span>${label}</span>`;
    $('#scrub').value = String(p.index);
    const total = p.frames.length;
    $('#stepCount').textContent = `Step ${p.index + 1} / ${total}`;
    const pct = total > 1 ? Math.round((p.index / (total - 1)) * 100) : 100;
    $('#stepPct').textContent = `${pct}%`;
    $('#pbar').style.width = `${pct}%`;
    root.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', b.dataset.speed === p.speed));
    $('#bPrev').disabled = p.index === 0;
    $('#bNext').disabled = p.atEnd;
  }

  $('#bPlay').addEventListener('click', () => player && player.toggle());
  $('#bNext').addEventListener('click', () => player && player.next());
  $('#bPrev').addEventListener('click', () => player && player.prev());
  $('#bReset').addEventListener('click', () => player && player.reset());
  $('#scrub').addEventListener('input', (e) => { if (!player) return; const target = Number(e.target.value); player.pause(); player.goto(target); });
  $('#speedSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-speed]'); if (b && player) player.setSpeed(b.dataset.speed); });

  const onKey = (e) => {
    if (!player || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); player.toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); player.next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); player.prev(); }
    else if (e.key === 'Home') { e.preventDefault(); player.reset(); }
  };
  document.addEventListener('keydown', onKey);

  /* ------------------------------ side panel ------------------------------- */
  function renderSideTabs() {
    const s = settings();
    const tabs = [];
    if (s.showCode) tabs.push(['code', 'C++ code']);
    if (s.showStats) tabs.push(['stats', 'Statistics']);
    tabs.push(['ai', 'AI tutor']);
    if (!tabs.some(([k]) => k === sideTab)) sideTab = tabs[0][0];
    $('#sideTabs').innerHTML = tabs.map(([k, l]) => `<button data-side="${k}" class="${k === sideTab ? 'on' : ''}">${l}</button>`).join('');
    $('#paneCode').hidden = sideTab !== 'code';
    $('#paneStats').hidden = sideTab !== 'stats';
    $('#paneAi').hidden = sideTab !== 'ai';
    if (sideTab === 'ai' && !aiPanel) {
      aiPanel = mountAiPanel($('#paneAi'), { getContext: () => ({ input: report ? report.input : undefined, stats: report ? report.stats : undefined, step: player ? player.frames[player.index].step.msg : undefined }) });
      aiPanel.setAlgorithm(id);
    }
  }
  $('#sideTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) { sideTab = b.dataset.side; renderSideTabs(); } });
  offs.push(onSettings(renderSideTabs));
  renderSideTabs();

  codeViewer = mountCodeViewer($('#paneCode'), { title: 'C++ source' });
  api.source(id).then((src) => { if (codeViewer) { codeViewer.setSource(src); if (player) codeViewer.setActive(player.frames[player.index].step.line); } }).catch(() => {});

  /* ------------------------------ statistics ------------------------------- */
  function statCard(label, now, total, note = '') {
    return `<div class="mini"><h4>${label}</h4><div class="stat"><span class="v" style="font-size:1.35rem">${fmtNumber(now)}${total !== undefined ? `<span class="faint" style="font-size:.85rem"> / ${fmtNumber(total)}</span>` : ''}</span>${note ? `<span class="hint">${note}</span>` : ''}</div></div>`;
  }

  function resultHtml(r) {
    if (!r) return '';
    const j = (a) => esc(JSON.stringify(a));
    if (cat === 'sorting') return `<dt>Sorted</dt><dd>${j(r.sorted)}</dd>`;
    if (cat === 'searching') return `<dt>Found</dt><dd>${r.found ? `yes, index ${r.index}` : 'no'}</dd>`;
    if (cat === 'graph') return [r.order && `<dt>Visit order</dt><dd>${j(r.order)}</dd>`, r.dist && `<dt>Distances</dt><dd>${j(r.dist.map((d) => (d === null ? '∞' : d)))}</dd>`, r.path && r.path.length ? `<dt>Path</dt><dd>${j(r.path)}</dd>` : '', r.unreached && r.unreached.length ? `<dt>Unreached</dt><dd>${j(r.unreached)}</dd>` : ''].filter(Boolean).join('');
    if (cat === 'structure') { const failed = (r.log || []).filter((l) => !l.ok).length; return `<dt>Final contents</dt><dd>${j(r.items)}</dd><dt>Operations</dt><dd>${(r.log || []).length} run, ${failed} rejected or not found</dd>`; }
    if (algo.id === 'gcd') return `<dt>gcd</dt><dd>${r.gcd}</dd><dt>lcm</dt><dd>${r.lcm}</dd><dt>Division steps</dt><dd>${r.iterations}</dd>`;
    if (algo.id === 'sieve') return `<dt>Primes found</dt><dd>${r.count}</dd><dt>List</dt><dd>${j(r.primes)}</dd>`;
    return `<dt>n</dt><dd>${r.n}</dd><dt>Value</dt><dd>${esc(r.value)}</dd><dt>Function calls</dt><dd>${r.calls}</dd>`;
  }

  function renderStatsStatic() {
    const pane = $('#paneStats');
    const s = report.stats, m = report.meta, c = algo.complexity;
    pane.innerHTML = `
      <div class="eyebrow">${icon('chart')} Measured in this run</div>
      <div class="side-panel" id="liveStats" style="margin-top:0"></div>
      <div class="side-panel">
        ${statCard('Input size', m.inputSize)}
        ${statCard('Execution steps', m.steps)}
        ${statCard('Execution time', fmtMicros(m.durationMicros).replace(/^/, ''), undefined, `median of ${m.timingRuns} untraced runs`)}
      </div>
      <hr class="divider">
      <div class="eyebrow">${icon('target')} Result</div>
      <dl class="kv" style="word-break:break-all">${resultHtml(report.result)}</dl>
      <hr class="divider">
      <div class="eyebrow">${icon('clock')} Theoretical complexity</div>
      <table class="data"><tbody>
        <tr><td>Best</td><td class="mono">${esc(c.best)}</td></tr><tr><td>Average</td><td class="mono">${esc(c.average)}</td></tr><tr><td>Worst</td><td class="mono">${esc(c.worst)}</td></tr><tr><td>Space</td><td class="mono">${esc(c.space)}</td></tr>
      </tbody></table>
      <p class="hint" style="margin-top:8px">Theory describes growth for large n. The numbers above are measured for this single input only, so they will not match the formulas exactly.</p>
      <div id="growth" style="margin-top:12px"></div>`;
    renderGrowth();
    if (player) renderStatsLive(player.frames[player.index], player.index);
  }

  function renderStatsLive(frame) {
    const live = $('#liveStats');
    if (!live || !report) return;
    const s = report.stats;
    const parts = [];
    if (cat === 'sorting' || s.comparisons) parts.push(statCard('Comparisons', frame.counts.compare, s.comparisons));
    if (cat === 'sorting') { parts.push(statCard('Swaps', frame.counts.swap, s.swaps)); if (s.writes) parts.push(statCard('Writes', frame.counts.set, s.writes)); }
    if (s.calls) parts.push(statCard('Calls', frame.nodes.length, s.calls));
    parts.push(statCard('Operations (total)', s.operations));
    live.innerHTML = parts.join('');
  }

  function analysisReset() { analysis = null; }

  function renderGrowth() {
    const box = $('#growth');
    if (!box) return;
    if (!algo.supportsScaling) { box.innerHTML = '<p class="hint">Empirical growth analysis is available for sorting, searching, recursion and sieve algorithms.</p>'; return; }
    if (!analysis) { box.innerHTML = `<button class="btn sm" id="growBtn">${icon('chart')} Measure growth on larger inputs</button>`; box.querySelector('#growBtn').addEventListener('click', loadGrowth); return; }
    box.innerHTML = analysis.supported === false ? `<p class="hint">${esc(analysis.note)}</p>` : `<div class="eyebrow">${icon('chart')} Empirical growth (C++ engine)</div>${analysis.modes.map((m) => `
      <h4 style="margin:10px 0 4px">${esc(m.mode === 'worst' ? 'Adversarial input' : 'Pseudo-random input')} <span class="chip teal mono">fits ${esc(m.fit.best)}</span></h4>
      <div class="table-wrap"><table class="data"><thead><tr><th>n</th><th>operations</th><th>time</th></tr></thead><tbody>${m.samples.map((x) => `<tr><td class="mono">${fmtNumber(x.n)}</td><td class="mono">${fmtNumber(x.operations)}</td><td class="mono">${fmtMicros(x.micros)}</td></tr>`).join('')}</tbody></table></div>`).join('')}
      <p class="hint" style="margin-top:8px">The fitted class is the best match among candidate growth models for the measured operation counts. It is evidence, not a proof.</p>`;
  }

  async function loadGrowth() {
    const box = $('#growth');
    box.innerHTML = skeleton(5);
    try { analysis = await api.analyze(id); } catch (err) { box.innerHTML = `<div class="notice error"><div>${esc(err.message)}</div></div>`; return; }
    renderGrowth();
  }

  /* ------------------------------ boot ------------------------------------- */
  writeInput(startInput);
  addRecent(id, 'visualizer');
  run();

  return () => {
    runToken += 1;
    if (player) player.destroy();
    if (codeViewer) codeViewer.destroy();
    if (aiPanel) aiPanel.destroy();
    document.removeEventListener('keydown', onKey);
    offs.forEach((f) => f());
  };
}
