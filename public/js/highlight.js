import { esc } from './util.js';

const CPP_KEYWORDS = new Set('alignas alignof auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false final float for friend goto if inline int long mutable namespace new noexcept nullptr operator override private protected public register return short signed sizeof static static_cast struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'.split(' '));
const CPP_TYPES = new Set('string vector map set unordered_map unordered_set queue stack deque pair array size_t int64_t uint64_t unique_ptr shared_ptr make_unique make_shared ostream istream cout cin cerr endl std'.split(' '));
const JS_KEYWORDS = new Set('async await break case catch class const continue default else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield'.split(' '));
const PY_KEYWORDS = new Set('and as assert break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' '));

const LANGS = {
  cpp: { kw: CPP_KEYWORDS, types: CPP_TYPES, line: '//', preproc: true },
  js: { kw: JS_KEYWORDS, types: new Set(['console', 'Math', 'JSON', 'Array', 'Object', 'Promise']), line: '//' },
  py: { kw: PY_KEYWORDS, types: new Set(['print', 'len', 'range', 'list', 'dict', 'set', 'int', 'str']), line: '#' },
  plain: { kw: new Set(), types: new Set(), line: null }
};

export function normaliseLang(name) {
  const n = String(name || '').toLowerCase();
  if (['c++', 'cpp', 'cc', 'cxx', 'c', 'h', 'hpp'].includes(n)) return 'cpp';
  if (['js', 'javascript', 'ts', 'typescript', 'json', 'node'].includes(n)) return 'js';
  if (['py', 'python'].includes(n)) return 'py';
  return 'plain';
}

const TOKEN = /(\/\/[^\n]*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d[\d_.]*(?:[eE][+-]?\d+)?[uUlLfF]*\b|[A-Za-z_][A-Za-z0-9_]*(?=\s*\()|[A-Za-z_][A-Za-z0-9_]*)/g;

function highlightLine(line, lang, state) {
  let out = '';
  let rest = line;
  if (state.block) {
    const end = rest.indexOf('*/');
    if (end < 0) return `<span class="tk-c">${esc(rest)}</span>`;
    out += `<span class="tk-c">${esc(rest.slice(0, end + 2))}</span>`;
    rest = rest.slice(end + 2);
    state.block = false;
  }
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  const cfg = LANGS[lang];
  const pushPlain = (s) => { if (s) out += esc(s); };
  while ((m = TOKEN.exec(rest))) {
    const tok = m[0];
    const idx = m.index;
    // block comment start before this token?
    const blockAt = cfg.line === '//' ? rest.indexOf('/*', last) : -1;
    if (blockAt >= 0 && blockAt <= idx) {
      pushPlain(rest.slice(last, blockAt));
      const end = rest.indexOf('*/', blockAt + 2);
      if (end < 0) {
        out += `<span class="tk-c">${esc(rest.slice(blockAt))}</span>`;
        state.block = true;
        return out;
      }
      out += `<span class="tk-c">${esc(rest.slice(blockAt, end + 2))}</span>`;
      last = end + 2;
      TOKEN.lastIndex = last;
      continue;
    }
    pushPlain(rest.slice(last, idx));
    last = idx + tok.length;
    if (tok[0] === '#' && cfg.preproc) {
      out += `<span class="tk-p">${esc(rest.slice(idx))}</span>`;
      return out;
    }
    if (cfg.line && tok.startsWith(cfg.line)) {
      out += `<span class="tk-c">${esc(rest.slice(idx))}</span>`;
      return out;
    }
    if (tok[0] === '#' && lang !== 'py') { out += esc(tok); continue; }
    if (tok[0] === '"' || tok[0] === "'") out += `<span class="tk-s">${esc(tok)}</span>`;
    else if (/^\d/.test(tok)) out += `<span class="tk-n">${esc(tok)}</span>`;
    else if (cfg.kw.has(tok)) out += `<span class="tk-k">${esc(tok)}</span>`;
    else if (cfg.types.has(tok)) out += `<span class="tk-t">${esc(tok)}</span>`;
    else if (/^[A-Z][A-Z0-9_]{2,}$/.test(tok)) out += `<span class="tk-m">${esc(tok)}</span>`;
    else if (/^[A-Z]/.test(tok) && lang === 'cpp') out += `<span class="tk-t">${esc(tok)}</span>`;
    else if (rest.slice(idx + tok.length).trimStart().startsWith('(')) out += `<span class="tk-f">${esc(tok)}</span>`;
    else out += esc(tok);
  }
  pushPlain(rest.slice(last));
  return out;
}

/** Returns one HTML string per source line. */
export function highlightLines(code, language = 'cpp') {
  const lang = normaliseLang(language);
  const state = { block: false };
  return String(code).split('\n').map((line) => highlightLine(line, lang, state));
}

export function highlightBlock(code, language = 'cpp') {
  return highlightLines(code, language).join('\n');
}
