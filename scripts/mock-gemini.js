// Minimal fake of the Gemini generateContent endpoint, used only by the test
// suite. It lets the Node <-> Gemini integration be tested without a real key:
// request shape, authentication header, JSON parsing and error mapping.
// It does NOT prove that the real Gemini service accepts the same requests.
const http = require('node:http');

const EXPECTED_KEY = 'TEST_KEY_123';

function start(port) {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/__requests') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(requests));
    }
    const match = req.url.match(/^\/v1beta\/models\/([^:]+):generateContent$/);
    if (req.method !== 'POST' || !match) {
      res.statusCode = 404;
      return res.end('{}');
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const system = body.systemInstruction?.parts?.[0]?.text || '';
      const user = (body.contents || []).map((c) => c.parts.map((p) => p.text).join('')).join('\n---\n');
      requests.push({ model: decodeURIComponent(match[1]), key: req.headers['x-goog-api-key'], body });
      res.setHeader('content-type', 'application/json');
      const send = (status, payload) => { res.statusCode = status; res.end(JSON.stringify(payload)); };
      const reply = (text) => send(200, { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] });

      if (req.headers['x-goog-api-key'] !== EXPECTED_KEY || user.includes('TRIGGER_INVALIDKEY')) {
        return send(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
      }
      if (user.includes('TRIGGER_429')) return send(429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } });
      if (user.includes('TRIGGER_500')) return send(500, { error: { code: 500, message: 'Internal error' } });
      if (user.includes('TRIGGER_BLOCK')) return send(200, { promptFeedback: { blockReason: 'SAFETY' } });
      if (user.includes('TRIGGER_EMPTY')) return send(200, { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] });
      if (user.includes('TRIGGER_SLOW')) return setTimeout(() => reply('late'), 5000);

      if (system.includes('Respond with JSON only')) {
        const wanted = Number((user.match(/exactly (\d+) viva questions/) || [])[1] || 3);
        const questions = [{ type: 'mcq', topic: 'Broken', question: 'Duplicate options?', options: ['same', 'same', 'x', 'y'], answerIndex: 0, explanation: 'invalid on purpose' }];
        for (let i = 1; i <= wanted; i += 1) {
          questions.push({ type: i % 2 ? 'complexity' : 'code', topic: 'Mock topic', question: `Mock question ${i}?`, code: i % 2 ? '' : 'int x = 1;', options: [`correct ${i}`, `wrong a ${i}`, `wrong b ${i}`, `wrong c ${i}`], answerIndex: 0, explanation: `Because correct ${i} is correct.` });
        }
        return reply(JSON.stringify({ questions }));
      }
      return reply(`MOCK-GEMINI-REPLY\n\nSYSTEM:\n${system}\n\nPROMPT:\n${user}`);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { start, EXPECTED_KEY };

if (require.main === module) {
  const port = Number(process.env.PORT) || 4010;
  start(port).then(() => console.log(`mock Gemini listening on http://127.0.0.1:${port}`));
}
