const fs = require('node:fs');
const config = require('./config');

// Personal knowledge base: data/personal_questions.txt (re-read when edited).
let cache = { mtime: 0, entries: [] };

const STOP = new Set(['the', 'a', 'an', 'please', 'pls', 'tell', 'me', 'hey', 'hi', 'hello', 'can', 'could', 'would', 'kindly', 'ai', 'byteforge', 'so', 'okay', 'ok']);
const CANON = { u: 'your', you: 'your', ur: 'your', yours: 'your', youre: 'your', whats: 'what', whos: 'who' };

function normalise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => CANON[w] || w)
    .filter((w) => !STOP.has(w));
}

function parse(text) {
  const entries = [];
  let questions = [];
  let answer = null;
  const flush = () => {
    if (questions.length && answer !== null && answer.join('\n').trim()) {
      const reply = answer.join('\n').trim();
      for (const q of questions) entries.push({ question: q, tokens: new Set(normalise(q)), answer: reply });
    }
    questions = [];
    answer = null;
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const q = line.match(/^\s*Q:\s*(.+)$/i);
    const a = line.match(/^\s*A:\s*(.*)$/i);
    if (q) {
      if (answer !== null) flush();
      questions.push(q[1].trim());
    } else if (a && questions.length) {
      answer = [a[1]];
    } else if (answer !== null) {
      answer.push(line);
    }
  }
  flush();
  return entries;
}

function load() {
  try {
    const stat = fs.statSync(config.personalFile);
    if (stat.mtimeMs !== cache.mtime) {
      cache = { mtime: stat.mtimeMs, entries: parse(fs.readFileSync(config.personalFile, 'utf8')) };
    }
  } catch {
    cache = { mtime: 0, entries: [] };
  }
  return cache.entries;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

const THRESHOLD = 0.8;

/** Returns { question, answer, score } when the message matches a stored question, else null. */
function match(message) {
  if (!message || message.length > 200) return null;
  const tokens = new Set(normalise(message));
  if (tokens.size < 2) return null;
  let best = null;
  for (const entry of load()) {
    const score = dice(tokens, entry.tokens);
    if (score >= THRESHOLD && (!best || score > best.score)) best = { question: entry.question, answer: entry.answer, score };
  }
  return best;
}

function count() {
  return load().length;
}

module.exports = { match, count, parse, normalise };
