export class ApiError extends Error {
  constructor(message, code = 'error', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, timeout = 60000 } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new ApiError('The request took too long. Please try again.', 'timeout');
    throw new ApiError('Could not reach the BYTEFORGE server. Check that it is running.', 'network');
  }
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON response */ }
  if (!response.ok || !data || data.ok === false) {
    const e = data && data.error;
    throw new ApiError(e?.message || `Request failed (${response.status}).`, e?.code || 'error', response.status);
  }
  return data;
}

const cache = new Map();
async function cached(key, loader) {
  if (!cache.has(key)) cache.set(key, loader().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

export const api = {
  health: () => request('/health', { timeout: 8000 }),
  catalog: () => cached('catalog', () => request('/algorithms')),
  algorithm: (id) => cached(`algo:${id}`, () => request(`/algorithms/${id}`).then((r) => r.algorithm)),
  source: (id) => cached(`src:${id}`, () => request(`/source/${id}`).then((r) => r.source)),
  execute: (id, input) => request('/execute', { method: 'POST', body: { id, input }, timeout: 20000 }),
  analyze: (id) => request('/analyze', { method: 'POST', body: { id }, timeout: 30000 }),
  aiStatus: (ping = false) => request('/ai/status', { method: 'POST', body: { ping }, timeout: 25000 }),
  chat: (payload) => request('/ai/chat', { method: 'POST', body: payload, timeout: 70000 }),
  explain: (payload) => request('/ai/explain', { method: 'POST', body: payload, timeout: 70000 }),
  compare: (a, b, focus) => request('/ai/compare', { method: 'POST', body: { a, b, focus }, timeout: 70000 }),
  explore: (topic, force = false) => request('/ai/explore', { method: 'POST', body: { topic, force }, timeout: 70000 }),
  viva: (payload) => request('/ai/viva', { method: 'POST', body: payload, timeout: 90000 })
};
