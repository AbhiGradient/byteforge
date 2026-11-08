import { icon } from '../icons.js';
import { api } from '../api.js';
import { esc, toast } from '../util.js';
import { settings, setSettings, resetSettings, clearRecent, clearQuizHistory, clearChat, getRecent, getQuizHistory, DEFAULTS } from '../store.js';
import { highlightBlock } from '../highlight.js';

const ACCENTS = { violet: '#8B7CFF', teal: '#35D6C5', blue: '#5AA9FF', rose: '#FF7A9E', amber: '#FFB454' };
const SAMPLE = `int partition(std::vector<int>& a, int lo, int hi) {
    int pivot = a[hi];            // last element
    int i = lo - 1;
    for (int j = lo; j < hi; ++j)
        if (a[j] < pivot) std::swap(a[++i], a[j]);
    std::swap(a[i + 1], a[hi]);
    return i + 1;
}`;

export default async function mount(root) {
  const draw = () => {
    const s = settings();
    const seg = (key, options) => `<div class="seg" data-seg="${key}">${options.map(([v, l, ic]) => `<button data-v="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${ic ? icon(ic) : ''}${l}</button>`).join('')}</div>`;
    const toggle = (key) => `<label class="switch"><input type="checkbox" data-toggle="${key}" ${s[key] ? 'checked' : ''}><span></span></label>`;
    const row = (title, desc, control) => `<div class="setting"><div><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div>${control}</div>`;
    root.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">${icon('settings')} Settings</div><h1>Settings</h1><p>Everything is saved in this browser (localStorage). Nothing is sent to a server and no API key is ever shown here.</p></div></div>
      <div class="settings-grid">
        <div class="stack">
          <div class="card"><div class="card-head"><h3>Appearance</h3></div>
            ${row('Theme', 'System follows your operating system.', seg('theme', [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['system', 'System', 'monitor']]))}
            ${row('Accent colour', '', `<div class="swatches" role="radiogroup" aria-label="Accent colour">${Object.entries(ACCENTS).map(([k, c]) => `<button class="swatch ${s.accent === k ? 'on' : ''}" data-accent="${k}" style="background:${c}" role="radio" aria-checked="${s.accent === k}" aria-label="${k}" title="${k}"></button>`).join('')}</div>`)}
            ${row('Animations', 'Reduced and off also respect your system preference.', seg('motion', [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']]))}
            ${row('UI density', '', seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']]))}
          </div>
          <div class="card"><div class="card-head"><h3>Visualization</h3></div>
            ${row('Default animation speed', 'Used when a visualization starts.', seg('speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast'], ['veryfast', 'Very fast']]))}
            ${row('Auto pause', 'Pause playback when a value is found, a search fails, a quick-sort pivot lands or a run finishes.', toggle('autoPause'))}
            ${row('Show statistics', 'Statistics tab in the visualizer.', toggle('showStats'))}
            ${row('Show code panel', 'C++ code tab in the visualizer.', toggle('showCode'))}
            ${row('Highlight active lines', 'Highlight the C++ line being executed.', toggle('highlightLines'))}
          </div>
          <div class="card"><div class="card-head"><h3>Code editor</h3></div>
            ${row('Font size', `${s.fontSize}px`, `<input type="range" min="11" max="20" step="1" value="${s.fontSize}" data-range="fontSize" style="width:160px" aria-label="Font size">`)}
            ${row('Font family', '', `<select class="select" data-select="fontFamily" style="width:auto"><option value="jetbrains" ${s.fontFamily === 'jetbrains' ? 'selected' : ''}>JetBrains Mono</option><option value="consolas" ${s.fontFamily === 'consolas' ? 'selected' : ''}>Consolas</option><option value="courier" ${s.fontFamily === 'courier' ? 'selected' : ''}>Courier New</option><option value="system" ${s.fontFamily === 'system' ? 'selected' : ''}>System monospace</option></select>`)}
            ${row('Line numbers', '', toggle('lineNumbers'))}
            ${row('Word wrapping', '', toggle('wordWrap'))}
            <div class="code-sample-box"><div class="code-card"><div class="code-scroll" style="max-height:none"><pre class="code-lines ${s.lineNumbers ? '' : 'nonum'} ${s.wordWrap ? 'wrap' : ''}">${highlightBlock(SAMPLE, 'cpp').split('\n').map((l, i) => `<div class="cl ${i === 3 && s.highlightLines ? 'active' : ''}"><span class="no">${i + 1}</span><span class="src">${l}</span></div>`).join('')}</pre></div></div></div>
          </div>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><h3>Chatbot</h3></div>
            ${row('Response style', 'Detailed answers are longer and use more examples.', seg('chatStyle', [['concise', 'Concise'], ['detailed', 'Detailed']]))}
            ${row('Show processing engine', 'Badge showing C++, Gemini or personal knowledge.', toggle('showEngine'))}
            ${row('Preserve current-session history', 'Keeps the conversation when you reload the tab.', toggle('keepChat'))}
            ${row('Clear chat history', '', `<button class="btn danger sm" id="clearChat">${icon('trash')} Clear</button>`)}
          </div>
          <div class="card" id="aiCard"><div class="card-head"><h3>AI</h3><span class="chip" id="aiChip">checking...</span></div>
            <dl class="kv" id="aiInfo"><dt>Model</dt><dd>-</dd><dt>API key</dt><dd>-</dd><dt>Connectivity</dt><dd>not tested</dd></dl>
            <div class="row" style="margin-top:12px"><button class="btn" id="testAi">${icon('refresh')} Test Gemini connection</button></div>
            <p class="hint" style="margin-top:8px">The key lives only in the server's <code>.env</code> file. This page can only tell you whether one is configured.</p>
          </div>
          <div class="card"><div class="card-head"><h3>Storage</h3></div>
            ${row('Recent activity', `${getRecent().length} recent item(s) and exploration counts.`, `<button class="btn danger sm" id="clearRecent">Clear</button>`)}
            ${row('Quiz history', `${getQuizHistory().length} saved attempt(s).`, `<button class="btn danger sm" id="clearQuiz">Clear</button>`)}
            ${row('Reset preferences', 'Restore every setting above to its default.', `<button class="btn danger sm" id="resetPrefs">Reset</button>`)}
          </div>
        </div>
      </div>`;
    wire();
    loadAi();
  };

  function wire() {
    root.querySelectorAll('[data-seg]').forEach((el) => el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      const key = el.dataset.seg;
      const raw = b.dataset.v;
      setSettings({ [key]: typeof DEFAULTS[key] === 'number' ? Number(raw) : raw });
      draw();
    }));
    root.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('change', () => { setSettings({ [el.dataset.toggle]: el.checked }); draw(); }));
    root.querySelectorAll('[data-accent]').forEach((el) => el.addEventListener('click', () => { setSettings({ accent: el.dataset.accent }); draw(); }));
    root.querySelectorAll('[data-select]').forEach((el) => el.addEventListener('change', () => { setSettings({ [el.dataset.select]: el.value }); draw(); }));
    root.querySelectorAll('[data-range]').forEach((el) => el.addEventListener('input', () => { setSettings({ [el.dataset.range]: Number(el.value) }); draw(); const again = root.querySelector(`[data-range="${el.dataset.range}"]`); again && again.focus(); }));
    root.querySelector('#clearChat').addEventListener('click', () => { clearChat(); toast('Chat history cleared'); });
    root.querySelector('#clearRecent').addEventListener('click', () => { clearRecent(); toast('Recent activity cleared'); draw(); });
    root.querySelector('#clearQuiz').addEventListener('click', () => { clearQuizHistory(); toast('Quiz history cleared'); draw(); });
    root.querySelector('#resetPrefs').addEventListener('click', () => { resetSettings(); toast('Preferences reset'); draw(); });
    root.querySelector('#testAi').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      setAi(null, 'testing...');
      try {
        const r = await api.aiStatus(true);
        setAi(r, r.state === 'ready' ? 'connected' : r.message);
      } catch (err) { setAi(null, err.message); }
      btn.disabled = false;
    });
  }

  let health = null;
  function setAi(status, connectivity) {
    const chip = root.querySelector('#aiChip');
    const info = root.querySelector('#aiInfo');
    if (!chip || !info) return;
    const configured = health ? health.ai.configured : Boolean(status && status.configured);
    const model = health ? health.ai.model : status && status.model;
    chip.textContent = !configured ? 'unavailable' : status && status.state === 'ready' ? 'available' : 'configured';
    chip.className = `chip ${!configured ? 'danger' : status && status.state === 'ready' ? 'teal' : 'accent'}`;
    info.innerHTML = `<dt>Model</dt><dd>${esc(model || '-')}</dd><dt>API key</dt><dd>${configured ? 'configured on the server' : 'not configured'}</dd><dt>Connectivity</dt><dd>${esc(connectivity || 'not tested')}</dd>`;
  }

  async function loadAi() {
    try { health = await api.health(); setAi(null, health.ai.configured ? 'not tested' : 'add GEMINI_API_KEY to .env'); } catch { setAi(null, 'server unreachable'); }
  }

  draw();
}
