// BYTEFORGE web server: Express bridge between the browser, the C++ engine
// (bin/byteforge, built from the root-level .cpp files) and Google Gemini.
const express = require('express');
const path = require('node:path');
const config = require('./server/config');
const engine = require('./server/engine');
const sources = require('./server/sources');
const personal = require('./server/personal');
const api = require('./server/api');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});

app.use('/api', express.json({ limit: config.limits.bodyBytes }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', api);
app.use('/api', (err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: { code: 'bad-json', message: 'The request body is not valid JSON.' } });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: { code: 'too-large', message: 'The request is too large.' } });
  }
  console.error('[server] unhandled API error:', err);
  return res.status(500).json({ ok: false, error: { code: 'internal', message: 'Something went wrong on the server.' } });
});

app.use(express.static(config.publicDir, { maxAge: config.production ? '1h' : 0, extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

const server = app.listen(config.port, config.host, () => {
  console.log(`BYTEFORGE listening on http://${config.host}:${config.port}`);
  console.log(`  C++ engine : ${engine.available() ? 'ready' : 'NOT BUILT (run npm run build:cpp)'}`);
  console.log(`  C++ sources: ${sources.reload()} algorithm regions indexed`);
  console.log(`  Gemini     : ${config.hasApiKey ? `key configured, model ${config.model}` : 'no API key (AI features disabled, everything else works)'}`);
  console.log(`  Personal Q&A entries: ${personal.count()}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
