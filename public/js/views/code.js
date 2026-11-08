import { icon } from '../icons.js';
import { api } from '../api.js';
import { esc } from '../util.js';
import { buildFrames, Player } from '../player.js';
import { mountCodeViewer } from '../codeviewer.js';
import { mountAiPanel } from '../ai-panel.js';
import { addRecent, getLastAlgorithm } from '../store.js';

export default async function mount(root, { params }) {
  const catalog = await api.catalog();
  const all = catalog.algorithms;
  const id = params[0] || (all.some((a) => a.id === getLastAlgorithm()) ? getLastAlgorithm() : all[0].id);
  if (!all.some((a) => a.id === id)) { location.hash = '#/code'; return null; }
  const algo = await api.algorithm(id);
  addRecent(id, 'code');

  root.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon('code')} Code Explorer</div><h1>${esc(algo.name)}</h1><p>The exact C++ that runs inside the engine, read from the repository source files. Trace it on an example to watch the active line move.</p></div>
      <div class="row">
        <div class="field" style="min-width:230px"><label for="sel">Algorithm</label><select id="sel" class="select">${Object.entries(catalog.categories).map(([k, l]) => `<optgroup label="${esc(l)}">${all.filter((a) => a.category === k).map((a) => `<option value="${a.id}" ${a.id === id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
        <a class="btn primary" href="#/visualizer/${id}">${icon('play')} Open visualizer</a>
      </div>
    </div>
    <div class="viz-layout">
      <div class="viz-main">
        <div id="viewer"></div>
        <div class="card">
          <div class="card-head"><h3>${icon('bolt')} Trace on the example input</h3><span class="chip mono">${esc(JSON.stringify(algo.defaultInput).slice(0, 70))}${JSON.stringify(algo.defaultInput).length > 70 ? '…' : ''}</span></div>
          <div class="stage-msg" id="msg"><span class="step-type">idle</span><span>Run the example to highlight each executed line.</span></div>
          <div class="controls" style="margin-top:10px;border:0;padding:0;background:none">
            <button class="btn primary" id="run">${icon('bolt')} Run trace</button>
            <button class="btn icon" id="prev" disabled aria-label="Previous step">${icon('prev')}</button>
            <button class="btn" id="play" disabled>${icon('play')} <span>Play</span></button>
            <button class="btn icon" id="next" disabled aria-label="Next step">${icon('next')}</button>
            <span class="mono faint" id="count"></span>
          </div>
        </div>
      </div>
      <div class="viz-side"><div id="ai"></div></div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const viewer = mountCodeViewer($('#viewer'), { full: true });
  api.source(id).then((src) => viewer.setSource(src)).catch((e) => { $('#viewer').innerHTML = `<div class="notice error"><div>${esc(e.message)}</div></div>`; });
  const ai = mountAiPanel($('#ai'), { initialMode: 'lines', getContext: () => ({ input: algo.defaultInput }) });
  ai.setAlgorithm(id);
  $('#sel').addEventListener('change', (e) => { location.hash = `#/code/${e.target.value}`; });

  let player = null;
  const sync = (p) => {
    $('#play').innerHTML = `${icon(p.playing ? 'pause' : 'play')} <span>${p.playing ? 'Pause' : p.atEnd ? 'Replay' : p.index > 0 ? 'Resume' : 'Play'}</span>`;
    $('#count').textContent = `step ${p.index + 1} / ${p.frames.length}`;
    $('#prev').disabled = p.index === 0;
    $('#next').disabled = p.atEnd;
  };
  $('#run').addEventListener('click', async () => {
    $('#run').disabled = true;
    try {
      const report = await api.execute(id, algo.defaultInput);
      if (player) player.destroy();
      const frames = buildFrames(report.steps, algo.visualization);
      player = new Player({
        frames, algorithmId: id,
        onFrame: (f) => { viewer.setActive(f.step.line); $('#msg').innerHTML = `<span class="step-type">${esc(f.step.type)}</span><span>${esc(f.step.msg)}</span>`; },
        onState: sync
      });
      ['#play', '#prev', '#next'].forEach((s) => { $(s).disabled = false; });
      sync(player);
    } catch (err) {
      $('#msg').innerHTML = `<span class="step-type" style="color:var(--danger)">error</span><span>${esc(err.message)}</span>`;
    } finally { $('#run').disabled = false; }
  });
  $('#play').addEventListener('click', () => player && player.toggle());
  $('#prev').addEventListener('click', () => player && player.prev());
  $('#next').addEventListener('click', () => player && player.next());

  return () => { if (player) player.destroy(); viewer.destroy(); ai.destroy(); };
}
