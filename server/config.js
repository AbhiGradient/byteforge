const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

loadEnvFile(path.join(root, '.env'));

const PLACEHOLDERS = new Set(['', 'YOUR_API_KEY_HERE', 'PASTE_YOUR_API_KEY_HERE', 'YOUR_SUPPORTED_MODEL_ID']);
const apiKey = (process.env.GEMINI_API_KEY || '').trim();
const model = (process.env.GEMINI_MODEL || '').trim();

module.exports = {
  root,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT) || 3000,
  production: process.env.NODE_ENV === 'production',
  publicDir: path.join(root, 'public'),
  dataDir: path.join(root, 'data'),
  enginePath: path.join(root, 'bin', isWindows ? 'byteforge.exe' : 'byteforge'),
  personalFile: path.join(root, 'data', 'personal_questions.txt'),
  apiKey,
  hasApiKey: !PLACEHOLDERS.has(apiKey),
  model: PLACEHOLDERS.has(model) ? 'gemini-3.5-flash-lite' : model,
  geminiBaseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, ''),
  rate: {
    generalPerMin: Number(process.env.GENERAL_RATE_LIMIT_PER_MIN) || 240,
    executePerMin: Number(process.env.EXECUTE_RATE_LIMIT_PER_MIN) || 90,
    aiPerMin: Number(process.env.AI_RATE_LIMIT_PER_MIN) || 20
  },
  limits: {
    bodyBytes: '64kb',
    engineTimeoutMs: 6000,
    analyzeTimeoutMs: 15000,
    engineConcurrency: 4,
    engineOutputBytes: 12 * 1024 * 1024,
    aiTimeoutMs: 45000,
    messageChars: 4000,
    historyMessages: 12,
    historyChars: 12000
  }
};
