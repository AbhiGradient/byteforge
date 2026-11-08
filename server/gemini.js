const config = require('./config');

// Thin Gemini REST client. Every request is made from the server, so the API
// key is never sent to (or readable by) the browser.
class AiError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const FRIENDLY = {
  'missing-key': ['No Gemini API key is configured on the server. Add GEMINI_API_KEY to the .env file and restart the server.', 503],
  'invalid-key': ['The Gemini API key was rejected. Check the key in the .env file and restart the server.', 502],
  quota: ['The Gemini usage limit for this key has been reached. Wait a little while and try again.', 429],
  timeout: ['The AI service took too long to respond. Please try again.', 504],
  network: ['The server could not reach the Gemini service. Check the internet connection and try again.', 502],
  'unsupported-model': ['The configured Gemini model is not available for this key. Check GEMINI_MODEL in the .env file.', 502],
  'bad-request': ['The AI service could not process that request. Try rephrasing it.', 502],
  blocked: ['The AI service declined to answer that request. Try rephrasing it.', 422],
  empty: ['The AI service returned an empty answer. Please try again.', 502],
  'bad-output': ['The AI service returned an answer in an unexpected format. Please try again.', 502],
  unavailable: ['The AI service is temporarily unavailable. Please try again shortly.', 502]
};

function aiError(code) {
  const [message, status] = FRIENDLY[code] || FRIENDLY.unavailable;
  return new AiError(code, message, status);
}

function classify(status, bodyText, err) {
  const text = String(bodyText || (err && err.message) || '');
  if (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'timeout';
    return 'network';
  }
  if (/api key not valid|API_KEY_INVALID|api key.*(expired|invalid)/i.test(text)) return 'invalid-key';
  if (status === 401 || status === 403) return 'invalid-key';
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(text)) return 'quota';
  if (status === 404 || /model.*(not found|not supported|is not available)/i.test(text)) return 'unsupported-model';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  if (status >= 400) return 'bad-request';
  return 'unavailable';
}

function redact(text) {
  let out = String(text || '').slice(0, 300);
  if (config.apiKey) out = out.split(config.apiKey).join('[hidden]');
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[hidden]');
}

function endpoint() {
  return `${config.geminiBaseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
}

/**
 * generate({ system, contents, json, maxOutputTokens, timeoutMs })
 * contents: [{ role: 'user' | 'model', text }]
 * Returns { text, model, finishReason }.
 */
async function generate({ system, contents, json = false, maxOutputTokens = 2048, timeoutMs = config.limits.aiTimeoutMs }) {
  if (!config.hasApiKey) throw aiError('missing-key');

  const body = {
    contents: contents.map((c) => ({ role: c.role === 'model' ? 'model' : 'user', parts: [{ text: c.text }] })),
    generationConfig: { maxOutputTokens }
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig.responseMimeType = 'application/json';

  let response;
  let raw = '';
  try {
    response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    raw = await response.text();
  } catch (err) {
    console.warn(`[gemini] request failed: ${redact(err.message)}`);
    throw aiError(classify(0, '', err));
  }

  if (!response.ok) {
    const code = classify(response.status, raw);
    console.warn(`[gemini] HTTP ${response.status} -> ${code}: ${redact(raw)}`);
    throw aiError(code);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw aiError('bad-output');
  }
  if (data.promptFeedback && data.promptFeedback.blockReason) throw aiError('blocked');
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw aiError('empty');
  const parts = (candidate.content && candidate.content.parts) || [];
  const text = parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
  if (!text) throw aiError(candidate.finishReason === 'SAFETY' ? 'blocked' : 'empty');
  return { text, model: config.model, finishReason: candidate.finishReason || null };
}

function parseJsonText(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw aiError('bad-output');
  }
}

let pingCache = { at: 0, value: null };

// Real connectivity check with a tiny request, cached for 30 seconds.
async function ping() {
  if (!config.hasApiKey) return { state: 'no-key', message: 'No API key configured.' };
  if (pingCache.value && Date.now() - pingCache.at < 30000) return pingCache.value;
  let value;
  try {
    await generate({ contents: [{ role: 'user', text: 'Reply with the single word OK.' }], maxOutputTokens: 16, timeoutMs: 15000 });
    value = { state: 'ready', message: 'Gemini responded successfully.' };
  } catch (err) {
    value = { state: err.code || 'unavailable', message: err.message };
  }
  pingCache = { at: Date.now(), value };
  return value;
}

module.exports = { AiError, aiError, generate, parseJsonText, ping };
