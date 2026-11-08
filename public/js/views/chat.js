import { icon } from '../icons.js';
import { api } from '../api.js';
import { esc, copyText } from '../util.js';
import { renderMarkdown, bindMarkdown } from '../markdown.js';
import { settings, loadChat, saveChat, clearChat, getLastAlgorithm } from '../store.js';

const SUGGESTIONS = [
  ['Explain an algorithm', 'Explain how merge sort works with a small example.'],
  ['C++ and OOP', 'What is runtime polymorphism in C++? Show a short example with virtual functions.'],
  ['Arithmetic (C++ engine)', 'What is 12 * (3 + 4) - 18 / 4?'],
  ['Complex maths (Gemini)', 'Differentiate x^3 * sin(x) with respect to x.'],
  ['About BYTEFORGE', 'Who is your owner?'],
  ['Compare data structures', 'When should I use a linked list instead of an array?']
];

export default async function mount(root) {
  let messages = loadChat();
  let busy = false;
  let useContext = true;
  let lastAlgo = null;
  const catalog = await api.catalog().catch(() => null);
  const lastId = getLastAlgorithm();
  if (catalog && lastId) lastAlgo = catalog.algorithms.find((a) => a.id === lastId) || null;

  root.innerHTML = `
    <div class="chat-shell">
      <div class="chat-head">
        <span class="avatar" style="background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--accent-ink)">${icon('ai')}</span>
        <div><strong>BYTEFORGE AI</strong><div class="faint" style="font-size:.78rem">C++, OOP, algorithms, data structures, maths and BYTEFORGE</div></div>
        <span class="spacer"></span>
        <span id="ctxChip"></span>
        <button class="btn sm" id="clear">${icon('trash')} Clear conversation</button>
      </div>
      <div class="chat-scroll" id="scroll" aria-live="polite"></div>
      <div class="composer">
        <textarea id="input" class="textarea" rows="1" maxlength="4000" placeholder="Message BYTEFORGE AI. Enter to send, Shift+Enter for a new line." aria-label="Message"></textarea>
        <button class="btn primary icon" id="send" aria-label="Send message">${icon('send')}</button>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const scroll = $('#scroll');
  const input = $('#input');
  bindMarkdown(scroll);

  function ctxChip() {
    $('#ctxChip').innerHTML = lastAlgo ? `<button class="chip ${useContext ? 'accent' : ''}" id="ctxBtn" title="Send the algorithm you last opened as context">${icon('target')} Context: ${esc(lastAlgo.name)} ${useContext ? '✓' : '(off)'}</button>` : '';
    const b = $('#ctxBtn');
    if (b) b.addEventListener('click', () => { useContext = !useContext; ctxChip(); });
  }

  function bubble(m, i) {
    if (m.role === 'user') return `<div class="msg user"><span class="avatar">${icon('user')}</span><div class="bubble">${esc(m.text)}</div></div>`;
    const showEngine = settings().showEngine && m.engineLabel;
    return `<div class="msg ai" data-i="${i}"><span class="avatar">${icon('ai')}</span><div class="bubble ${m.error ? 'err' : ''}">${m.error ? `<strong>${esc(m.text)}</strong>` : renderMarkdown(m.text)}
      ${m.notice ? `<div class="hint" style="margin-top:6px">${esc(m.notice)}</div>` : ''}
      <div class="bubble-foot">${showEngine ? `<span class="chip ${m.engine === 'cpp-math' ? 'accent' : m.engine === 'personal' ? 'warn' : 'teal'}" title="Which engine produced this answer">${icon(m.engine === 'cpp-math' ? 'cpu' : m.engine === 'personal' ? 'database' : 'ai')} ${esc(m.engineLabel)}${m.model ? ` · ${esc(m.model)}` : ''}</span>` : ''}
        ${m.error ? `<button class="btn sm" data-retry>${icon('refresh')} Retry</button>` : `<button class="btn sm ghost" data-copy>${icon('copy')} Copy</button>`}</div></div></div>`;
  }

  function draw() {
    if (!messages.length) {
      scroll.innerHTML = `<div class="chat-empty"><div class="brand-mark">${icon('ai')}</div><h2>How can I help?</h2><p class="muted">Ask about algorithms, C++, OOP or maths. Plain arithmetic is solved locally by the C++ engine; harder maths and explanations go to Gemini. The badge under each answer shows which engine replied.</p>
        <div class="suggestions">${SUGGESTIONS.map(([t, q]) => `<button class="suggestion" data-q="${esc(q)}"><b>${esc(t)}</b>${esc(q)}</button>`).join('')}</div></div>`;
      return;
    }
    scroll.innerHTML = messages.map(bubble).join('') + (busy ? `<div class="msg ai"><span class="avatar">${icon('ai')}</span><div class="bubble"><span class="typing" aria-label="BYTEFORGE AI is typing"><i></i><i></i><i></i></span></div></div>` : '');
    scroll.scrollTop = scroll.scrollHeight;
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    messages.push({ role: 'user', text });
    input.value = '';
    autosize();
    busy = true;
    draw();
    const history = messages.slice(0, -1).filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role, text: m.text }));
    try {
      const reply = await api.chat({
        message: text,
        history,
        style: settings().chatStyle,
        context: useContext && lastAlgo ? { algorithmId: lastAlgo.id } : undefined
      });
      messages.push({ role: 'ai', text: reply.answer, engine: reply.engine, engineLabel: reply.engineLabel, model: reply.model, notice: reply.notice || (reply.truncated ? 'The answer was cut off at the length limit. Ask me to continue.' : null) });
    } catch (err) {
      messages.push({ role: 'ai', error: true, text: err.message });
    }
    busy = false;
    saveChat(messages);
    draw();
    input.focus();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(180, input.scrollHeight)}px`;
  }

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  $('#send').addEventListener('click', () => send(input.value));
  $('#clear').addEventListener('click', () => { messages = []; clearChat(); draw(); input.focus(); });
  scroll.addEventListener('click', (e) => {
    const sug = e.target.closest('[data-q]');
    if (sug) { send(sug.dataset.q); return; }
    const msgEl = e.target.closest('.msg.ai');
    if (!msgEl) return;
    const i = Number(msgEl.dataset.i);
    if (e.target.closest('[data-copy]')) copyText(messages[i].text, 'Answer copied');
    if (e.target.closest('[data-retry]')) {
      const lastUser = [...messages.slice(0, i)].reverse().find((m) => m.role === 'user');
      messages.splice(i, 1);
      if (lastUser) { messages.splice(messages.lastIndexOf(lastUser), 1); send(lastUser.text); }
    }
  });

  ctxChip();
  draw();
  input.focus();
  return () => saveChat(messages);
}
