const { spawn } = require('node:child_process');
const fs = require('node:fs');
const config = require('./config');

class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Every request starts a fresh C++ process: JSON in on stdin, JSON out on
// stdout, hard timeout, bounded output and a small concurrency limit.
let running = 0;
const waiting = [];

function acquire() {
  if (running < config.limits.engineConcurrency) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

function available() {
  return fs.existsSync(config.enginePath);
}

async function call(command, timeoutMs = config.limits.engineTimeoutMs) {
  if (!available()) throw new EngineError('engine-missing', 'The C++ engine is not compiled. Run "npm run build:cpp".');
  await acquire();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(config.enginePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const chunks = [];
      let size = 0;
      let settled = false;
      let timer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, new EngineError('timeout', 'The C++ engine did not respond in time.'));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        size += chunk.length;
        if (size > config.limits.engineOutputBytes) {
          child.kill('SIGKILL');
          finish(reject, new EngineError('output-too-large', 'The C++ engine produced too much output.'));
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on('data', () => {});
      child.on('error', () => finish(reject, new EngineError('spawn-failed', 'The C++ engine could not be started.')));
      child.on('close', () => {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        try {
          finish(resolve, JSON.parse(text));
        } catch {
          finish(reject, new EngineError('protocol', 'The C++ engine returned malformed output.'));
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(command));
    });
  } finally {
    release();
  }
}

module.exports = {
  EngineError,
  available,
  ping: () => call({ cmd: 'ping' }),
  list: () => call({ cmd: 'list' }),
  execute: (id, input) => call({ cmd: 'execute', id, input }),
  validate: (id, input) => call({ cmd: 'validate', id, input }),
  analyze: (id) => call({ cmd: 'analyze', id }, config.limits.analyzeTimeoutMs),
  math: (expression) => call({ cmd: 'math', expression })
};
