import { esc, skeleton, copyText } from './util.js';
import { icon } from './icons.js';
import { api, ApiError } from './api.js';
import { renderMarkdown, bindMarkdown } from './markdown.js';

const TABS = [
  ['overview', 'Explain'],
  ['lines', 'Line by line'],
  ['complexity', 'Complexity'],
  ['applications', 'Real world'],
  ['pseudocode', 'Pseudocode'],
  ['cpp', 'C++ sample'],
  ['ask', 'Ask']
];

let aiConfigured = null;
export async function aiAvailable() {
  if (aiConfigured === null) {
    try { aiConfigured = (await api.health()).ai.configured; } catch { aiConfigured = false; }
  }
  return aiConfigured;
}

/**
 * Gemini-powered explanation panel for one algorithm. Every request goes
 * through the Node server; the API key never reaches the browser.
 */
export function mountAiPanel(container, { getContext = () => ({}), initialMode = 'overview', compact = false } = {}) {
  let algorithmId = null;
  let mode = initialMode;
  const cache = new Map();
  let token = 0;
  const answers = [];

  container.innerHTML = `
    <div class="card pad-0 ai-panel">
      <div class="card-head" style="padding:14px 16px 0;margin:0">
        <h3>${icon('ai')} AI tutor</h3>
        <span class="chip teal">Gemini via server</span>
      </div>
      <div class="tabs" data-tabs style="padding:0 10px;margin-top:8px"></div>
      <div class="ai-body" data-body></div>
      <div class="ai-ask" data-ask hidden>
        <input class="input" data-q maxlength="400" placeholder="Ask about this algorithm and your current run..." aria-label="Question about this algorithm">
        <button class="btn primary" data-send>${icon('send')} Ask</button>
      </div>
    </div>`;
  const tabsEl = container.querySelector('[data-tabs]');
  const body = container.querySelector('[data-body]');
  const askBar = container.querySelector('[data-ask]');
  const qInput = container.querySelector('[data-q]');
  bindMarkdown(body);

  tabsEl.innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}" class="${id === mode ? 'on' : ''}">${label}</button>`).join('');

  function showError(err, retry) {
    const hint = err instanceof ApiError && err.code === 'missing-key'
      ? '<p class="faint" style="margin-top:8px">Tip: copy <code>.env.example</code> to <code>.env</code>, paste your Gemini key and restart the server. Visualizations, the code explorer and arithmetic work without it.</p>'
      : '';
    body.innerHTML = `<div class="notice error"><div><strong>${esc(err.message || 'Something went wrong.')}</strong>${hint}</div></div><div class="row" style="margin-top:10px"><button class="btn sm" data-retry>${icon('refresh')} Try again</button></div>`;
    body.querySelector('[data-retry]').addEventListener('click', retry);
  }

  function showResult(text, model, regenerate) {
    body.innerHTML = `${renderMarkdown(text)}
      <div class="ai-tag">${icon('ai')} AI-generated${model ? ` by ${esc(model)}` : ''}. It can make mistakes; the C++ source and the measured statistics are the ground truth.</div>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-copy>${icon('copy')} Copy</button><button class="btn sm ghost" data-regen>${icon('refresh')} Regenerate</button></div>`;
    body.querySelector('[data-copy]').addEventListener('click', () => copyText(text, 'Answer copied'));
    body.querySelector('[data-regen]').addEventListener('click', regenerate);
  }

  async function load(force = false) {
    askBar.hidden = mode !== 'ask';
    if (!algorithmId) { body.innerHTML = '<p class="muted">Choose an algorithm to get an explanation.</p>'; return; }
    if (mode === 'ask') {
      if (!answers.length) body.innerHTML = '<p class="muted">Ask anything about this algorithm. The tutor knows its source code, complexity and your current input.</p>';
      return;
    }
    const key = `${algorithmId}:${mode}`;
    if (!force && cache.has(key)) { const c = cache.get(key); showResult(c.text, c.model, () => load(true)); return; }
    const mine = ++token;
    body.innerHTML = skeleton(7);
    try {
      const reply = await api.explain({ id: algorithmId, mode, context: getContext() });
      if (mine !== token) return;
      cache.set(key, reply);
      showResult(reply.text, reply.model, () => load(true));
    } catch (err) {
      if (mine !== token) return;
      showError(err, () => load(true));
    }
  }

  async function ask() {
    const question = qInput.value.trim();
    if (!question || !algorithmId) return;
    const mine = ++token;
    qInput.value = '';
    body.innerHTML = `<p class="muted"><strong>You:</strong> ${esc(question)}</p>${skeleton(5)}`;
    try {
      const reply = await api.explain({ id: algorithmId, mode: 'ask', question, context: getContext() });
      if (mine !== token) return;
      answers.push({ question, text: reply.text });
      showResult(`**You asked:** ${question}\n\n${reply.text}`, reply.model, () => { qInput.value = question; ask(); });
    } catch (err) {
      if (mine !== token) return;
      showError(err, () => { qInput.value = question; ask(); });
    }
  }

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    mode = b.dataset.tab;
    tabsEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  container.querySelector('[data-send]').addEventListener('click', ask);
  qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } });

  return {
    setAlgorithm(id) {
      if (id === algorithmId) return;
      algorithmId = id;
      answers.length = 0;
      token += 1;
      load();
    },
    setMode(next) {
      mode = next;
      tabsEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.tab === mode));
      load();
    },
    destroy() { token += 1; }
  };
}
