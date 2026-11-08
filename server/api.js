const express = require('express');
const config = require('./config');
const engine = require('./engine');
const gemini = require('./gemini');
const prompts = require('./prompts');
const catalog = require('./catalog');
const sources = require('./sources');
const personal = require('./personal');
const { handleChat } = require('./chat');
const { rateLimit } = require('./ratelimit');

const router = express.Router();

const generalLimit = rateLimit({ windowMs: 60_000, max: config.rate.generalPerMin, name: 'API' });
const executeLimit = rateLimit({ windowMs: 60_000, max: config.rate.executePerMin, name: 'execution' });
const aiLimit = rateLimit({ windowMs: 60_000, max: config.rate.aiPerMin, name: 'AI' });

router.use(generalLimit);

// ---- response helpers --------------------------------------------------------

function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof gemini.AiError) return fail(res, err.httpStatus || 502, err.code, err.message);
    if (err instanceof engine.EngineError) return fail(res, err.code === 'engine-missing' ? 503 : 500, err.code, err.message);
    console.error('[api] unexpected error:', err);
    return fail(res, 500, 'internal', 'Something went wrong on the server.');
  }
};

const ID = /^[a-z][a-z_]{1,39}$/;
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function requireAlgorithm(res, id) {
  if (typeof id !== 'string' || !ID.test(id)) {
    fail(res, 400, 'bad-id', 'A valid algorithm id is required.');
    return null;
  }
  const entry = await catalog.get(id);
  if (!entry) {
    fail(res, 404, 'unknown-algorithm', `Unknown algorithm "${id}".`);
    return null;
  }
  return entry;
}

function cleanHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const items = raw
    .filter((m) => isObject(m) && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'ai', text: m.text.trim().slice(0, config.limits.messageChars) }))
    .slice(-config.limits.historyMessages);
  let total = 0;
  const kept = [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    total += items[i].text.length;
    if (total > config.limits.historyChars) break;
    kept.unshift(items[i]);
  }
  return kept;
}

function numberedSource(source) {
  return source.code
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(3, ' ')}  ${line}`)
    .join('\n');
}

// ---- health & catalogue ------------------------------------------------------

let pingCache = { at: 0, value: null };
async function enginePing() {
  if (!engine.available()) return { ready: false, reason: 'not-compiled' };
  if (pingCache.value && Date.now() - pingCache.at < 30_000) return pingCache.value;
  let value;
  try {
    const reply = await engine.ping();
    value = reply.ok ? { ready: true, version: reply.version, algorithms: reply.algorithms } : { ready: false, reason: 'bad-reply' };
  } catch (err) {
    value = { ready: false, reason: err.code || 'error' };
  }
  pingCache = { at: Date.now(), value };
  return value;
}

router.get('/health', wrap(async (req, res) => {
  const eng = await enginePing();
  res.json({
    ok: true,
    status: eng.ready ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    engine: eng,
    ai: { configured: config.hasApiKey, model: config.model },
    personalEntries: personal.count()
  });
}));

router.get('/algorithms', wrap(async (req, res) => {
  const list = await catalog.all();
  res.json({
    ok: true,
    categories: catalog.CATEGORY_LABELS,
    algorithms: list.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      categoryLabel: a.categoryLabel,
      visualization: a.visualization,
      summary: a.summary,
      complexity: a.complexity,
      properties: a.properties
    }))
  });
}));

router.get('/algorithms/:id', wrap(async (req, res) => {
  const entry = await requireAlgorithm(res, req.params.id);
  if (entry) res.json({ ok: true, algorithm: entry });
}));

router.get('/source/:id', wrap(async (req, res) => {
  if (!ID.test(req.params.id)) return fail(res, 400, 'bad-id', 'A valid algorithm id is required.');
  const source = sources.get(req.params.id);
  if (!source) return fail(res, 404, 'no-source', 'No C++ source is available for that algorithm.');
  return res.json({ ok: true, source });
}));

// ---- execution -----------------------------------------------------------------

router.post('/execute', executeLimit, wrap(async (req, res) => {
  const { id, input } = req.body || {};
  const entry = await requireAlgorithm(res, id);
  if (!entry) return;
  if (!isObject(input)) return fail(res, 400, 'bad-input', '"input" must be a JSON object.');
  const report = await engine.execute(id, input);
  if (!report.ok) return fail(res, 422, 'invalid-input', report.error || 'The input was rejected.');
  return res.json(report);
}));

router.post('/analyze', executeLimit, wrap(async (req, res) => {
  const entry = await requireAlgorithm(res, (req.body || {}).id);
  if (!entry) return;
  const report = await engine.analyze(entry.id);
  if (!report.ok) return fail(res, 422, 'analysis-failed', report.error || 'Analysis failed.');
  return res.json(report);
}));

// ---- mathematics ---------------------------------------------------------------

router.post('/math/solve', aiLimit, wrap(async (req, res) => {
  const problem = text((req.body || {}).problem || (req.body || {}).expression, 500);
  if (!problem) return fail(res, 400, 'empty', 'Enter a mathematical expression or problem.');
  const reply = await handleChat({ message: problem, history: [], style: 'concise', allowPersonal: false });
  return res.json({ ok: true, ...reply });
}));

// ---- AI ------------------------------------------------------------------------

router.post('/ai/status', wrap(async (req, res) => {
  const body = req.body || {};
  const base = { ok: true, configured: config.hasApiKey, model: config.model };
  if (!body.ping) return res.json({ ...base, state: config.hasApiKey ? 'configured' : 'no-key' });
  const result = await gemini.ping();
  return res.json({ ...base, ...result });
}));

router.post('/ai/chat', aiLimit, wrap(async (req, res) => {
  const body = req.body || {};
  const message = text(body.message, config.limits.messageChars);
  if (!message) return fail(res, 400, 'empty', 'Type a message first.');
  const reply = await handleChat({
    message,
    history: cleanHistory(body.history),
    context: isObject(body.context) ? { algorithmId: text(body.context.algorithmId, 40), input: body.context.input } : null,
    style: body.style === 'detailed' ? 'detailed' : 'concise'
  });
  return res.json({ ok: true, ...reply });
}));

const EXPLAIN_MODES = ['overview', 'lines', 'complexity', 'applications', 'pseudocode', 'cpp', 'ask'];

router.post('/ai/explain', aiLimit, wrap(async (req, res) => {
  const body = req.body || {};
  const entry = await requireAlgorithm(res, body.id);
  if (!entry) return;
  const mode = EXPLAIN_MODES.includes(body.mode) ? body.mode : 'overview';
  const question = text(body.question, 1000);
  if (mode === 'ask' && !question) return fail(res, 400, 'empty', 'Type a question about this algorithm.');

  const parts = [
    `Algorithm: ${entry.name} (id ${entry.id}, category ${entry.categoryLabel}).`,
    `Authoritative complexity from the BYTEFORGE engine: ${catalog.complexityText(entry)}.`
  ];
  if (mode === 'lines' || mode === 'cpp' || mode === 'ask') {
    const source = sources.get(entry.id);
    if (source) parts.push(`Actual C++ source from ${source.file} (displayed line numbers on the left):\n${numberedSource(source)}`);
  }
  const ctx = isObject(body.context) ? body.context : null;
  if (ctx) {
    if (isObject(ctx.input) && JSON.stringify(ctx.input).length <= 1500) parts.push(`Learner's current input: ${JSON.stringify(ctx.input)}`);
    if (isObject(ctx.stats) && JSON.stringify(ctx.stats).length <= 600) parts.push(`Measured statistics of the last run: ${JSON.stringify(ctx.stats)}`);
    if (typeof ctx.step === 'string') parts.push(`Step the learner is looking at: ${ctx.step.slice(0, 200)}`);
  }
  if (mode === 'ask') parts.push(`Learner's question: ${question}`);

  const result = await gemini.generate({
    system: prompts.explain(mode),
    contents: [{ role: 'user', text: parts.join('\n\n') }],
    maxOutputTokens: mode === 'lines' || mode === 'cpp' ? 4096 : 2048
  });
  return res.json({ ok: true, mode, id: entry.id, text: result.text, model: result.model, truncated: result.finishReason === 'MAX_TOKENS' });
}));

router.post('/ai/compare', aiLimit, wrap(async (req, res) => {
  const body = req.body || {};
  const a = await requireAlgorithm(res, body.a);
  if (!a) return;
  const b = await requireAlgorithm(res, body.b);
  if (!b) return;
  if (a.id === b.id) return fail(res, 400, 'same', 'Choose two different algorithms to compare.');
  const focus = text(body.focus, 200);
  const prompt =
    `Compare these two BYTEFORGE algorithms.\n\n1. ${a.name} (${a.categoryLabel}): ${catalog.complexityText(a)}.\n2. ${b.name} (${b.categoryLabel}): ${catalog.complexityText(b)}.` +
    (focus ? `\n\nThe learner especially cares about: ${focus}` : '');
  const result = await gemini.generate({ system: prompts.compare, contents: [{ role: 'user', text: prompt }], maxOutputTokens: 3072 });
  return res.json({ ok: true, a: a.id, b: b.id, text: result.text, model: result.model });
}));

router.post('/ai/explore', aiLimit, wrap(async (req, res) => {
  const body = req.body || {};
  const topic = text(body.topic, 80);
  if (topic.length < 2) return fail(res, 400, 'empty', 'Enter the name of an algorithm or data structure.');
  if (/[\u0000-\u001f]/.test(topic)) return fail(res, 400, 'bad-topic', 'The topic contains invalid characters.');
  const known = catalog.findByName(topic);
  if (known && !body.force) {
    const entry = await catalog.get(known);
    return res.json({ ok: true, supported: true, id: known, name: entry ? entry.name : known });
  }
  const result = await gemini.generate({
    system: prompts.explore,
    contents: [{ role: 'user', text: `Algorithm or data structure to explain: ${topic}` }],
    maxOutputTokens: 4096
  });
  return res.json({
    ok: true,
    supported: false,
    interactive: false,
    topic,
    text: result.text,
    model: result.model,
    disclaimer: 'AI-generated reference. This algorithm is not executed or visualised by the BYTEFORGE C++ engine.'
  });
}));

// ---- Viva Arena ------------------------------------------------------------------

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const QUESTION_TYPES = ['mcq', 'code', 'conceptual', 'complexity', 'application'];

function shuffle(list) {
  const out = list.map((value, index) => ({ value, index }));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sanitiseQuestions(raw, allowedTypes) {
  const list = raw && Array.isArray(raw.questions) ? raw.questions : [];
  const out = [];
  for (const q of list) {
    if (!isObject(q) || typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length !== 4) continue;
    if (!q.options.every((o) => typeof o === 'string' && o.trim()) || new Set(q.options.map((o) => o.trim().toLowerCase())).size !== 4) continue;
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) continue;
    if (typeof q.explanation !== 'string' || !q.explanation.trim()) continue;
    const shuffled = shuffle(q.options.map((o) => o.trim().replace(/^[A-Da-d][).:]\s+/, '').slice(0, 300)));
    out.push({
      id: `q${out.length + 1}`,
      type: allowedTypes.includes(q.type) ? q.type : 'mcq',
      topic: text(q.topic, 60) || 'General',
      question: q.question.trim().slice(0, 700),
      code: typeof q.code === 'string' ? q.code.slice(0, 1500) : '',
      options: shuffled.map((s) => s.value),
      answerIndex: shuffled.findIndex((s) => s.index === q.answerIndex),
      explanation: q.explanation.trim().slice(0, 1200)
    });
  }
  return out;
}

router.post('/ai/viva', aiLimit, wrap(async (req, res) => {
  const body = req.body || {};
  const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : 'beginner';
  const count = Math.min(10, Math.max(3, Number.parseInt(body.count, 10) || 5));
  const types = Array.isArray(body.types) ? body.types.filter((t) => QUESTION_TYPES.includes(t)) : [];
  const allowedTypes = types.length ? types : QUESTION_TYPES;

  const all = await catalog.all();
  const topic = text(body.topic, 40) || 'all';
  let scope = all;
  let scopeLabel = 'the whole BYTEFORGE algorithm library';
  if (topic !== 'all') {
    const byAlgorithm = all.filter((a) => a.id === topic);
    const byCategory = all.filter((a) => a.category === topic);
    scope = byAlgorithm.length ? byAlgorithm : byCategory;
    if (!scope.length) return fail(res, 400, 'bad-topic', 'Unknown viva topic.');
    scopeLabel = byAlgorithm.length ? byAlgorithm[0].name : `${scope[0].categoryLabel} algorithms`;
  }
  const facts = scope.map((a) => `- ${a.name}: ${catalog.complexityText(a)}`).join('\n');
  const prompt =
    `Create exactly ${count} viva questions about ${scopeLabel}.\n` +
    `Use only these question types, spread across them: ${allowedTypes.join(', ')}.\n` +
    `"code" questions must include a short C++ snippet in the "code" field. Other types leave "code" as an empty string.\n` +
    `Authoritative complexity facts (never contradict them):\n${facts}`;

  const result = await gemini.generate({
    system: prompts.viva(difficulty),
    contents: [{ role: 'user', text: prompt }],
    json: true,
    maxOutputTokens: 6144,
    timeoutMs: 60_000
  });
  const questions = sanitiseQuestions(gemini.parseJsonText(result.text), allowedTypes).slice(0, count);
  if (questions.length < Math.ceil(count / 2)) throw gemini.aiError('bad-output');
  return res.json({ ok: true, difficulty, topic, scope: scopeLabel, requested: count, questions, model: result.model });
}));

router.use((req, res) => fail(res, 404, 'not-found', 'Unknown API endpoint.'));

module.exports = router;
