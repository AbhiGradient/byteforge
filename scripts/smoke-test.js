// End-to-end integration tests: Express <-> C++ engine, personal knowledge,
// hybrid math routing, and the Gemini client (against the local mock).
const { spawn } = require('node:child_process');
const path = require('node:path');
const mock = require('./mock-gemini');

const root = path.resolve(__dirname, '..');
const KEY = mock.EXPECTED_KEY;
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) { failures += 1; console.log(`FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
}

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server at ${url} did not start`);
}

function startServer(port, env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return { child, log: () => log };
}

const call = async (base, method, route, body) => {
  const res = await fetch(base + route, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, json, text };
};

async function main() {
  const mockPort = 4300 + Math.floor(Math.random() * 300);
  const keyedPort = mockPort + 400;
  const keylessPort = mockPort + 401;
  const mockServer = await mock.start(mockPort);
  const keyed = startServer(keyedPort, { GEMINI_API_KEY: KEY, GEMINI_BASE_URL: `http://127.0.0.1:${mockPort}`, GEMINI_MODEL: '', AI_RATE_LIMIT_PER_MIN: '1000', GENERAL_RATE_LIMIT_PER_MIN: '5000', EXECUTE_RATE_LIMIT_PER_MIN: '5000' });
  const keyless = startServer(keylessPort, { GEMINI_API_KEY: '', GEMINI_BASE_URL: `http://127.0.0.1:${mockPort}`, GENERAL_RATE_LIMIT_PER_MIN: '5000' });
  const A = `http://127.0.0.1:${keyedPort}`;
  const B = `http://127.0.0.1:${keylessPort}`;
  const everything = [];
  const seen = (r) => { everything.push(r.text); return r; };

  try {
    await Promise.all([waitFor(`${A}/api/health`), waitFor(`${B}/api/health`)]);

    // ---- health & catalogue ----
    let r = seen(await call(A, 'GET', '/api/health'));
    check('health ok with engine ready', r.json.ok && r.json.engine.ready && r.json.engine.algorithms === 21);
    check('health reports key configured without exposing it', r.json.ai.configured === true && !r.text.includes(KEY));
    check('default model is gemini-3.5-flash-lite', r.json.ai.model === 'gemini-3.5-flash-lite');
    r = seen(await call(B, 'GET', '/api/health'));
    check('keyless server reports AI not configured', r.json.ai.configured === false && r.json.engine.ready);

    r = seen(await call(A, 'GET', '/api/algorithms'));
    const list = r.json.algorithms;
    check('catalogue has 21 algorithms', list.length === 21);
    check('catalogue entries have summary and complexity', list.every((a) => a.summary && a.complexity.worst));
    const cats = {};
    list.forEach((a) => { cats[a.category] = (cats[a.category] || 0) + 1; });
    check('category counts 6/3/3/5/2/2', JSON.stringify([cats.sorting, cats.searching, cats.graph, cats.structure, cats.recursion, cats.math]) === '[6,3,3,5,2,2]');

    // ---- every algorithm: detail, source, execute ----
    for (const a of list) {
      const d = await call(A, 'GET', `/api/algorithms/${a.id}`);
      check(`${a.id}: detail has examples and defaultInput`, d.json.ok && d.json.algorithm.examples.length >= 2 && d.json.algorithm.defaultInput);
      const s = await call(A, 'GET', `/api/source/${a.id}`);
      check(`${a.id}: real C++ source region`, s.json.ok && s.json.source.code.length > 80 && s.json.source.startLine > 0);
      for (const ex of d.json.algorithm.examples) {
        const e = seen(await call(A, 'POST', '/api/execute', { id: a.id, input: ex.input }));
        const ok = e.status === 200 && e.json.ok && e.json.steps.length > 0 && e.json.meta.durationMicros >= 0;
        check(`${a.id}: executes example "${ex.label}"`, ok, e.text.slice(0, 120));
        if (ok && ex === d.json.algorithm.examples[0]) {
          const lines = e.json.steps.map((x) => x.line).filter((x) => x > 0);
          const inRegion = lines.filter((x) => x >= s.json.source.startLine && x <= s.json.source.endLine).length;
          check(`${a.id}: step line numbers fall inside the displayed source`, lines.length > 0 && inRegion / lines.length > 0.9, `${inRegion}/${lines.length}`);
        }
      }
    }

    // ---- result correctness through the whole stack ----
    r = await call(A, 'POST', '/api/execute', { id: 'quick_sort', input: { array: [5, -2, 9, 0, 5, 1] } });
    check('quick sort result via HTTP', JSON.stringify(r.json.result.sorted) === '[-2,0,1,5,5,9]');
    r = await call(A, 'POST', '/api/execute', { id: 'dijkstra', input: { nodes: 4, directed: true, edges: [[0, 1, 1], [1, 2, 2], [0, 2, 10]], start: 0, target: 2 } });
    check('dijkstra via HTTP finds the 0-1-2 path', JSON.stringify(r.json.result.path) === '[0,1,2]' && r.json.result.dist[3] === null);
    r = await call(A, 'POST', '/api/execute', { id: 'fibonacci', input: { n: 10 } });
    check('fibonacci(10) = 55 with 177 calls', r.json.result.value === '55' && r.json.result.calls === 177);
    r = await call(A, 'POST', '/api/execute', { id: 'factorial', input: { n: 20 } });
    check('factorial(20) exact 64-bit value', r.json.result.value === '2432902008176640000');

    // ---- validation & error handling ----
    r = await call(A, 'POST', '/api/execute', { id: 'bubble_sort', input: { array: Array.from({ length: 41 }, (_, i) => i) } });
    check('41 elements rejected with 422', r.status === 422 && r.json.error.code === 'invalid-input');
    r = await call(A, 'POST', '/api/execute', { id: 'binary_search', input: { array: [3, 1], target: 1 } });
    check('unsorted binary search rejected', r.status === 422 && /sorted/i.test(r.json.error.message));
    r = await call(A, 'POST', '/api/execute', { id: 'nope_sort', input: {} });
    check('unknown algorithm is 404', r.status === 404);
    r = await call(A, 'POST', '/api/execute', { id: '../etc/passwd', input: {} });
    check('path-like id rejected', r.status === 400);
    r = await call(A, 'POST', '/api/execute', { id: 'stack', input: { ops: ['explode 3'] } });
    check('unknown stack operation rejected', r.status === 422);
    const bad = await fetch(`${A}/api/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    check('malformed JSON body is 400', bad.status === 400);
    const big = await fetch(`${A}/api/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'stack', input: { pad: 'x'.repeat(100000) } }) });
    check('oversized body rejected (413)', big.status === 413);
    r = await call(A, 'GET', '/api/does-not-exist');
    check('unknown API route is JSON 404', r.status === 404 && r.json && r.json.ok === false);
    r = await call(A, 'GET', '/api/source/%2e%2e');
    check('source endpoint rejects odd ids', r.status === 400 || r.status === 404);

    // ---- complexity analysis ----
    r = await call(A, 'POST', '/api/analyze', { id: 'merge_sort' });
    check('analysis fits n log n for merge sort', r.json.ok && r.json.modes[0].fit.best === 'O(n log n)');
    r = await call(A, 'POST', '/api/analyze', { id: 'jump_search' });
    check('analysis fits sqrt n for jump search (worst)', r.json.modes.find((m) => m.mode === 'worst').fit.best === 'O(sqrt n)');

    // ---- chat routing: personal / C++ / Gemini ----
    r = seen(await call(A, 'POST', '/api/ai/chat', { message: 'Who is your owner?' }));
    check('personal knowledge answers locally', r.json.engine === 'personal' && r.json.answer.includes('Abhishek Sapkale'));
    r = seen(await call(A, 'POST', '/api/ai/chat', { message: "what's your name" }));
    check('personal knowledge tolerates phrasing', r.json.engine === 'personal' && r.json.answer.includes('BYTEFORGE AI'));
    r = seen(await call(B, 'POST', '/api/ai/chat', { message: 'Who is your owner?' }));
    check('personal knowledge works without any API key', r.status === 200 && r.json.engine === 'personal');
    r = seen(await call(A, 'POST', '/api/ai/chat', { message: 'who is the owner of linux' }));
    check('similar-looking question does not hit personal file', r.json.engine !== 'personal');
    const before = (await (await fetch(`http://127.0.0.1:${mockPort}/__requests`)).json()).length;
    r = seen(await call(A, 'POST', '/api/ai/chat', { message: 'what is 12 * (3 + 4) - 18 / 4?' }));
    check('arithmetic answered by the C++ engine', r.json.engine === 'cpp-math' && r.json.value === '79.5', JSON.stringify(r.json).slice(0, 160));
    r = seen(await call(B, 'POST', '/api/ai/chat', { message: '2^10 + 7 % 4' }));
    check('arithmetic works without an API key', r.json.engine === 'cpp-math' && r.json.value === '1027');
    r = seen(await call(A, 'POST', '/api/ai/chat', { message: '1/0' }));
    check('division by zero reported by the C++ engine', r.json.engine === 'cpp-math' && /zero/i.test(r.json.answer));
    r = seen(await call(A, 'POST', '/api/math/solve', { problem: '(2+3)*4' }));
    check('/api/math/solve uses C++ for arithmetic', r.json.engine === 'cpp-math' && r.json.value === '20');
    const after = (await (await fetch(`http://127.0.0.1:${mockPort}/__requests`)).json()).length;
    check('arithmetic never called Gemini', after === before);

    r = seen(await call(A, 'POST', '/api/ai/chat', { message: 'Integrate x^2 from 0 to 3' }));
    check('complex maths routes to Gemini (math mode)', r.json.engine === 'gemini-math' && r.json.answer.includes('MOCK-GEMINI-REPLY') && /mathematics question/i.test(r.json.answer));
    r = seen(await call(A, 'POST', '/api/ai/chat', { message: 'Explain polymorphism', history: [{ role: 'user', text: 'hi' }, { role: 'ai', text: 'hello there' }], style: 'detailed', context: { algorithmId: 'bubble_sort' } }));
    check('general question routes to Gemini with history, style and context', r.json.engine === 'gemini' && r.json.answer.includes('hello there') && r.json.answer.includes('thorough') && r.json.answer.includes('Bubble Sort'));
    const last = (await (await fetch(`http://127.0.0.1:${mockPort}/__requests`)).json()).pop();
    check('Gemini request uses the x-goog-api-key header and default model', last.key === KEY && last.model === 'gemini-3.5-flash-lite');
    check('Gemini request has no deprecated sampling parameters', !('temperature' in last.body.generationConfig) && !('topP' in last.body.generationConfig) && !('topK' in last.body.generationConfig));
    check('Gemini request never puts the key in the body', !JSON.stringify(last.body).includes(KEY));

    // ---- Gemini error mapping ----
    const errors = [['TRIGGER_429', 429, 'quota'], ['TRIGGER_500', 502, 'unavailable'], ['TRIGGER_BLOCK', 422, 'blocked'], ['TRIGGER_EMPTY', 502, 'empty'], ['TRIGGER_INVALIDKEY', 502, 'invalid-key']];
    for (const [trigger, status, code] of errors) {
      r = seen(await call(A, 'POST', '/api/ai/chat', { message: `tell me about trees ${trigger}` }));
      check(`Gemini ${trigger} maps to ${code}`, r.status === status && r.json.error.code === code, `${r.status} ${r.text.slice(0, 100)}`);
    }
    r = seen(await call(B, 'POST', '/api/ai/chat', { message: 'explain recursion' }));
    check('missing key gives a clear 503', r.status === 503 && r.json.error.code === 'missing-key' && /GEMINI_API_KEY/.test(r.json.error.message));
    check('error responses never contain the key', !r.text.includes(KEY));

    // ---- explain / compare / explore ----
    r = seen(await call(A, 'POST', '/api/ai/explain', { id: 'binary_search', mode: 'lines' }));
    check('line-by-line explain sends the real C++ source', r.json.ok && r.json.text.includes('int BinarySearch::search') && r.json.text.includes('Authoritative complexity'));
    r = seen(await call(A, 'POST', '/api/ai/explain', { id: 'heap_sort', mode: 'ask', question: 'why sift down?', context: { input: { array: [3, 1] }, stats: { comparisons: 4 }, step: 'Swap a[0] and a[1]' } }));
    check('context-aware ask includes question, input, stats and step', ['why sift down?', '"array":[3,1]', '"comparisons":4', 'Swap a[0]'].every((t) => r.json.text.includes(t)));
    r = await call(A, 'POST', '/api/ai/explain', { id: 'heap_sort', mode: 'ask' });
    check('ask without a question is rejected', r.status === 400);
    r = seen(await call(A, 'POST', '/api/ai/compare', { a: 'quick_sort', b: 'merge_sort', focus: 'stability' }));
    check('compare includes both algorithms and authoritative complexity', r.json.ok && r.json.text.includes('Quick Sort') && r.json.text.includes('Merge Sort') && r.json.text.includes('O(n^2)') && r.json.text.includes('stability'));
    r = await call(A, 'POST', '/api/ai/compare', { a: 'quick_sort', b: 'quick_sort' });
    check('comparing an algorithm with itself is rejected', r.status === 400);
    r = seen(await call(A, 'POST', '/api/ai/explore', { topic: 'explain bubble sort please' }));
    check('explore recognises a supported algorithm and skips Gemini', r.json.supported === true && r.json.id === 'bubble_sort');
    r = seen(await call(A, 'POST', '/api/ai/explore', { topic: "Kruskal's algorithm" }));
    check('unsupported algorithm is flagged as not interactive', r.json.supported === false && r.json.interactive === false && /not executed/i.test(r.json.disclaimer) && /not executed by the BYTEFORGE C\+\+ engine/.test(r.json.text));

    // ---- viva ----
    r = seen(await call(A, 'POST', '/api/ai/viva', { difficulty: 'intermediate', topic: 'sorting', count: 4, types: ['complexity', 'code'] }));
    const qs = r.json.questions || [];
    check('viva returns the requested number of valid questions', r.json.ok && qs.length === 4, JSON.stringify(r.json).slice(0, 120));
    check('viva drops malformed questions', qs.every((q) => new Set(q.options).size === 4 && q.explanation));
    check('viva answer index points at the correct option after shuffling', qs.every((q) => q.options[q.answerIndex].startsWith('correct')));
    check('viva options are shuffled', qs.length > 0 && qs.some((q) => q.answerIndex !== 0) || qs.length < 3);
    const vivaReq = (await (await fetch(`http://127.0.0.1:${mockPort}/__requests`)).json()).pop();
    check('viva requests structured JSON output', vivaReq.body.generationConfig.responseMimeType === 'application/json');
    check('viva prompt embeds authoritative complexity data', vivaReq.body.contents[0].parts[0].text.includes('Quick Sort: best O(n log n)'));
    r = await call(A, 'POST', '/api/ai/viva', { difficulty: 'beginner', topic: 'made-up-topic', count: 3 });
    check('viva rejects unknown topics', r.status === 400);

    // ---- AI status ----
    r = seen(await call(A, 'POST', '/api/ai/status', { ping: true }));
    check('AI status ping succeeds against the mock', r.json.state === 'ready' && r.json.configured === true && !r.text.includes(KEY));
    r = seen(await call(B, 'POST', '/api/ai/status', { ping: true }));
    check('AI status without key says no-key', r.json.state === 'no-key');
    r = seen(await call(A, 'POST', '/api/ai/status', {}));
    check('AI status without ping makes no network call', r.json.state === 'configured');

    // ---- static frontend ----
    r = seen(await call(A, 'GET', '/'));
    check('index.html served with CSP header', r.status === 200 && r.text.includes('BYTEFORGE'));
    const head = await fetch(`${A}/`);
    check('security headers present', /script-src 'self'/.test(head.headers.get('content-security-policy') || '') && head.headers.get('x-content-type-options') === 'nosniff');
    r = await call(A, 'GET', '/js/main.js');
    check('JS modules are served', r.status === 200 && r.text.includes('hashchange'));
    r = await call(A, 'GET', '/some/client/route');
    check('unknown non-API path falls back to the SPA shell', r.status === 200 && r.text.includes('<main id="view"'));
    const traversal = await fetch(`${A}/..%2f..%2fserver%2fconfig.js`);
    check('path traversal does not expose server files', !(await traversal.text()).includes('GEMINI_API_KEY'));
    // ---- rate limiting (keyless server keeps the default 20 AI requests / minute) ----
    let limited = null;
    for (let i = 0; i < 40 && !limited; i += 1) {
      const rr = await fetch(`${B}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'who is your owner' }) });
      if (rr.status === 429) limited = rr;
    }
    check('AI endpoints are rate limited with Retry-After', limited && Number(limited.headers.get('retry-after')) > 0 && (await limited.json()).error.code === 'rate-limited');
    check('the API key never appeared in any response', !everything.join('').includes(KEY));
  } finally {
    keyed.child.kill();
    keyless.child.kill();
    mockServer.close();
  }

  const passed = results.filter((x) => x.ok).length;
  console.log(`\nSmoke test: ${passed}/${results.length} checks passed${failures ? `, ${failures} FAILED` : ''}`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
