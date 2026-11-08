# CLAUDE.md - BYTEFORGE developer guide

## Architecture
Browser (vanilla ES modules) -> Express (`server.js`, `server/*.js`) -> per-request child process `bin/byteforge` (C++17). Gemini is called only from `server/gemini.js`. No database; browser state in `localStorage` (`byteforge:*`), chat in `sessionStorage`.

## C++ root-folder rules (non-negotiable)
- `main.cpp` and **every** C++ file stay in the repository root. Never create `cpp/` or `src/`.
- `scripts/build-cpp.js` and the Dockerfile compile `*.cpp` from the root; new `.cpp` files are picked up automatically.
- Each algorithm's code lives between `// ==== BEGIN <id> ====` and `// ==== END <id> ====`; the id must equal the algorithm id. `server/sources.js` serves that region to the code explorer.
- Step line numbers come from `__LINE__`. Instrumentation macros (`CMP`, `SWAPPED`, `STEP`, ...) must be on the same line as the statement they describe, and macro invocations must stay on one line.
- Timing runs use `StepRecorder(false)`; message strings must only be built when `rec.enabled()` (macros already guard this).

## Adding an algorithm
1. Derive from the matching abstract class (or `Algorithm`); implement `defaultInput`, `validate`, `run`.
2. Wrap the implementation in BEGIN/END markers and register it in the module's `register...Algorithms`.
3. Emit steps following the payload contract below.
4. Add entries to `data/algorithms.json` and `data/complexity.json` (values must equal the C++ `Complexity`).
5. Add correctness checks to `selftest.cpp`; run `npm test`.

## Step payload contract (`step.data`)
Step: `{i, type, line, msg, data}`. The frontend (`public/js/player.js`) keeps every key persistent except the transient set `cmp, cmpAux, swap, set, m, event, node, id, value`; `null` clears a persistent key.
- **bars (sorting):** `arr`, `sorted[]`, `range[lo,hi]`, `pivot`, `min`, `key`, `heapSize`, `aux[]`+`auxRange`, transient `cmp`, `cmpAux`, `swap`, `set`.
- **cells (searching):** `arr`, `target`, `low/high/mid`, `block[a,b]`, `found` (-1 missing, null searching), transient `cmp`.
- **graph:** every step is self-contained: `current, visited[], frontier[], frontierKind, edge[u,v]|null, parent[], dist[]?, path[]`.
- **structure:** `kind` (stack|queue|slist|dlist|clist), `op`, `items[]`, plus `cap,hl` (stack), `buffer,front,rear,count,cap,hl` (queue), `cur,hl` (lists).
- **calltree:** `event: call|return`, `node{id,parent,label,depth}` / `id,value`, `stack[]` (values are strings).
- **gcd:** `rows[{a,b,q,r}]`, `gcd`.  **sieve:** `n`, `cells[[value,state]]` (1 prime, 2 composite), `p`, transient `m`.

## API contracts (JSON; errors are `{ok:false,error:{code,message}}`)
| Endpoint | Body -> response |
|---|---|
| `GET /api/health` | `{status, engine{ready,version,algorithms}, ai{configured,model}}` |
| `GET /api/algorithms`, `/api/algorithms/:id` | catalogue / detail with examples, complexity notes |
| `POST /api/execute` | `{id,input}` -> `{algorithm, input, result, stats, meta, complexity, steps[]}`; invalid input 422 |
| `POST /api/analyze` | `{id}` -> empirical growth fit |
| `GET /api/source/:id` | `{source{file,startLine,endLine,code}}` |
| `POST /api/ai/explain` | `{id, mode, question?, context?}` |
| `POST /api/ai/chat` | `{message, history[], style, context?}` -> `{answer, engine, engineLabel, model}` |
| `POST /api/ai/viva` | `{difficulty, topic, count, types[]}` -> validated questions |
| `POST /api/ai/compare`, `/explore`, `/status` | see `server/api.js` |
| `POST /api/math/solve` | `{problem}` -> same routing as chat without personal file |

Rate limits (per IP/min, env-tunable): general 240, execute 90, AI 20.

## Design system
Dark: bg `#090D18`, secondary `#101727`, surface `#151F32`, accent `#8B7CFF`, accent-2 `#35D6C5`, text `#F4F6FF`. Light: bg `#F7F8FC`, surface `#FFFFFF`, accent `#6558E8`, accent-2 `#12A99B`, text `#172033`. Inter + JetBrains Mono. Tokens are CSS variables in `public/css/styles.css`; use them, never hard-coded colours. SVG icons come from `public/js/icons.js` (no emoji in navigation). Settings live in `public/js/store.js` and are applied via `data-theme`, `data-accent`, `data-density`, `data-motion` and CSS variables.

## Coding conventions
C++17, no raw owning pointers outside the teaching data structures, no exceptions across the Node boundary. JS: ES modules, no framework, escape all dynamic HTML with `esc()`, render Markdown only via `markdown.js`. CSP forbids inline scripts. Never log or return the API key.

## Build / test commands
`npm install` - `npm run build:cpp` - `npm start` - `npm run selftest` - `npm test` - `python3 scripts/ui-test.py` (optional, Playwright). Sanitizer build: `g++ -std=c++17 -g -fsanitize=address,undefined -o /tmp/bf_asan *.cpp && /tmp/bf_asan --selftest`.

## Deployment
Docker (see `Dockerfile`) on Render free tier via `render.yaml`; env: `GEMINI_API_KEY`, `GEMINI_MODEL`, `PORT` (injected). Health check `/api/health`. No persistent disk is assumed.

## Modification guidelines
Keep `main.cpp` in root. Keep the engine the single source of truth for execution; AI output must never be presented as executed. Update `README.md` limits and tests with any new limit. Personal facts belong only in `data/personal_questions.txt`.
