import { esc, copyText } from './util.js';
import { icon } from './icons.js';
import { highlightLines } from './highlight.js';
import { settings, onSettings } from './store.js';

/**
 * Source code explorer widget. `source` is the real C++ region returned by
 * /api/source/:id. setActive() takes an absolute line number of the file
 * (the same number the engine reports with every step).
 */
export function mountCodeViewer(container, { source = null, full = false, title = 'C++ source' } = {}) {
  let current = null;
  let expanded = false;
  let activeEl = null;

  container.innerHTML = `
    <div class="code-card ${full ? 'full' : ''}">
      <div class="code-bar">
        <span class="chip accent">C++17</span>
        <span class="file" data-file></span>
        <button class="btn sm ghost icon" data-copy title="Copy source code" aria-label="Copy source code">${icon('copy')}</button>
        <button class="btn sm ghost icon" data-expand title="Expand or collapse" aria-label="Expand or collapse editor">${icon('expand')}</button>
      </div>
      <div class="code-scroll" data-scroll><pre class="code-lines" data-lines></pre></div>
      <div class="code-foot" data-foot></div>
    </div>`;
  const card = container.querySelector('.code-card');
  const scroll = container.querySelector('[data-scroll]');
  const pre = container.querySelector('[data-lines]');
  const fileEl = container.querySelector('[data-file]');
  const foot = container.querySelector('[data-foot]');

  function applyPrefs() {
    const s = settings();
    pre.classList.toggle('nonum', !s.lineNumbers);
    pre.classList.toggle('wrap', s.wordWrap);
    pre.classList.toggle('noactive', !s.highlightLines);
    if (activeEl) activeEl.classList.toggle('active', s.highlightLines);
  }

  function render() {
    if (!current) {
      pre.innerHTML = '<div class="cl"><span class="src faint" style="padding:12px 14px">No source loaded.</span></div>';
      fileEl.textContent = title;
      foot.textContent = '';
      return;
    }
    const rows = highlightLines(current.code, 'cpp');
    pre.innerHTML = rows.map((html, i) => `<div class="cl" data-n="${current.startLine + i}"><span class="no">${i + 1}</span><span class="src">${html || ' '}</span></div>`).join('');
    fileEl.textContent = `${current.file}  ·  lines ${current.startLine}-${current.endLine}`;
    foot.textContent = 'This is the real implementation. Lines such as CMP(...), SWAPPED(...), STEP(...) only record visualizer events; they are instrumentation, not algorithm logic.';
    activeEl = null;
    applyPrefs();
  }

  function setActive(absLine) {
    if (activeEl) activeEl.classList.remove('active');
    activeEl = null;
    if (!current || !absLine) return;
    const el = pre.querySelector(`[data-n="${absLine}"]`);
    if (!el) return;
    activeEl = el;
    if (settings().highlightLines) el.classList.add('active');
    const top = el.offsetTop;
    const view = scroll.clientHeight;
    if (top < scroll.scrollTop + 24 || top > scroll.scrollTop + view - 48) {
      scroll.scrollTo({ top: Math.max(0, top - view / 2), behavior: settings().motion === 'full' ? 'smooth' : 'auto' });
    }
  }

  container.querySelector('[data-copy]').addEventListener('click', () => current && copyText(current.code, 'C++ source copied'));
  container.querySelector('[data-expand]').addEventListener('click', (e) => {
    expanded = !expanded;
    card.classList.toggle('expanded', expanded);
    e.currentTarget.innerHTML = icon(expanded ? 'collapse' : 'expand');
  });
  const off = onSettings(applyPrefs);

  current = source;
  render();

  return {
    setSource(next) { current = next; render(); },
    setActive,
    destroy() { off(); }
  };
}
