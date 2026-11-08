# BYTEFORGE

**AI-Powered Interactive Algorithm & Data Structure Laboratory**

BYTEFORGE executes 21 classic algorithms and data structures in a real **C++17 engine**, streams every comparison, swap and pointer move to the browser, and adds a Gemini-powered tutor, a viva quiz arena and a hybrid chatbot. There is **no database**: everything is bundled or kept in the browser's `localStorage`.

The C++ source lives directly in the repository root (`main.cpp`, `algorithm.cpp`, `sorting.cpp`, ...), so anyone opening the repository sees the genuine implementation first.

## Problem statement
Students meet algorithms as static pseudocode and cannot see what actually happens inside a running program. Visualizers usually animate hand-written JavaScript that only resembles the real algorithm.

## Objectives
1. Run the real C++ implementation and visualize *its* execution trace (no fake animations).
2. Show the exact source lines being executed.
3. Separate theoretical complexity from measured statistics.
4. Add AI explanations without letting AI pretend to execute code.
5. Deploy for free (Render free tier) with zero database.

## Features
| Area | What you get |
|---|---|
| Algorithm library | Bubble, Selection, Insertion, Merge, Quick, Heap sort; Linear, Binary, Jump search; BFS, DFS, Dijkstra; Stack, Queue, Singly/Doubly/Circular linked list; Factorial, Fibonacci; Euclidean GCD; Sieve of Eratosthenes |
| Visualizer | Play / Pause / Resume / Replay, Reset, Next, Previous, speed control, scrub slider, step counter, progress bar, keyboard shortcuts. Separate views: bars, search cells, graph, stack/queue/linked lists, recursion call tree, GCD table, sieve grid |
| Code explorer | Real C++ regions read from the source files, syntax highlighting, active-line highlight with auto-scroll, line numbers, copy, expand/collapse, wrap |
| Statistics | Comparisons, swaps, writes, operations, steps, input size, measured time (median of untraced runs), result; theory (best/average/worst/space) shown separately; optional empirical growth fitting |
| AI tutor | Explanation, line-by-line, complexity, applications, pseudocode, C++ sample, context-aware Q&A, algorithm comparison, "explore any algorithm" (clearly labelled *not executed*) |
| VIVA ARENA | Beginner/Intermediate/Advanced, 5 question types, scoring, explanations, final report, retry, local history |
| BYTEFORGE AI | Full-page chat with hybrid routing: personal TXT -> C++ arithmetic -> Gemini |
| Settings | Theme, accent, motion, density, speeds, auto-pause, panels, editor font/size/numbers/wrap, chat style/engine badge/history, AI status, storage resets |

## Technology stack
C++17 (engine) - Node.js 18+ and Express (bridge) - HTML5/CSS3/vanilla JS ES modules (frontend) - JSON - Google Gemini API (`gemini-3.5-flash-lite`) - `localStorage` - Docker - Render free web service. The only npm dependency is `express`.

## Architecture
```
Browser (vanilla JS)  ->  Express (server.js, server/*.js)  ->  child process  bin/byteforge  (C++17, built from root *.cpp)
        |                         |
        |                         +--> Gemini REST API (key stays on the server)
        +-- localStorage          +--> data/*.json, data/personal_questions.txt
```
Each execution request spawns the engine once: JSON command on stdin, one JSON document on stdout, hard timeout, bounded output, max 4 concurrent processes. User input is parsed as data and validated; **no user-supplied code is ever compiled or executed**.

### C++ OOP architecture
```
Algorithm (abstract: info(), defaultInput(), validate(), run())
 |- SortingAlgorithm   (abstract, template method run -> virtual sort())
 |    BubbleSort  SelectionSort  InsertionSort  MergeSort  QuickSort  HeapSort
 |- SearchingAlgorithm (abstract, virtual search())
 |    LinearSearch  BinarySearch  JumpSearch
 |- GraphAlgorithm     (abstract, virtual traverse())
 |    BreadthFirstSearch  DepthFirstSearch  DijkstraShortestPath
 |- StructureAlgorithm (abstract, operation-script driven)
 |    StackAlgorithm (IntStack)  QueueAlgorithm (IntQueue, circular buffer)
 |    SinglyLinkedListAlgorithm  DoublyLinkedListAlgorithm  CircularLinkedListAlgorithm
 |- RecursionAlgorithm (abstract)  FactorialAlgorithm  FibonacciAlgorithm
 |- EuclideanGcd   SieveOfEratosthenes
AlgorithmManager (owns unique_ptr<Algorithm>, registry)   ExecutionEngine (validate -> time -> trace)
ComplexityAnalyzer (theory + empirical growth fit)        InputValidator   ExecutionStep / StepRecorder / Stats
Json (own parser/serializer)    ExpressionEvaluator (Shunting Yard)
```
Concepts demonstrated: classes/objects, encapsulation, abstraction, inheritance, runtime polymorphism via virtual functions and overriding, constructors/destructors (RAII, `new`/`delete` in the data structures, `unique_ptr` registry), STL (`vector`, `map`, `set`, `deque`-style queues), template method and strategy patterns.

### Execution flow
1. Browser POSTs `{id, input}` to `/api/execute`.
2. Node validates the id/shape and spawns `bin/byteforge` with `{"cmd":"execute",...}`.
3. `ExecutionEngine` validates input, measures wall time with recording **off** (median of several runs), then runs once with recording **on** to produce `ExecutionStep`s.
4. Every step carries the real `__LINE__` of the C++ statement that produced it. `/api/source/:id` returns the matching region (found via `// ==== BEGIN id ====` markers) so the explorer highlights the exact line.
5. The browser reduces steps into frames and renders them.

Macros like `CMP(...)`, `SWAPPED(...)`, `STEP(...)` in the source are instrumentation that only record events.

## Algorithm catalogue
| Category | Algorithms | Typical complexity |
|---|---|---|
| Sorting | Bubble, Selection, Insertion, Merge, Quick, Heap | see `data/complexity.json` |
| Searching | Linear, Binary, Jump | O(n), O(log n), O(sqrt n) |
| Graph | BFS, DFS, Dijkstra | O(V+E), O((V+E) log V) |
| Data structures | Stack, Queue, Singly/Doubly/Circular list | O(1) / O(n) |
| Recursion | Factorial, Fibonacci | O(n), O(2^n) |
| Math | Euclidean GCD, Sieve | O(log n), O(n log log n) |

Complexity values exist in C++ (`AlgorithmInfo`) and `data/complexity.json`; the test suite checks they agree.

## Gemini integration
All calls go through `server/gemini.js` (plain REST, header `x-goog-api-key`). The key is read from `.env`, never sent to the browser, and redacted from logs. The model is `gemini-3.5-flash-lite` (checked against Google's model documentation); override with `GEMINI_MODEL`. Sampling parameters are not sent. Viva questions use `responseMimeType: application/json`, then are validated, filtered and have their options shuffled server-side. AI answers about unsupported algorithms are flagged `interactive:false`.

## Chatbot architecture and math routing
`server/chat.js` routes every message in this order:
1. **Personal knowledge** (`data/personal_questions.txt`, re-read on save, fuzzy match with a strict threshold) -> badge "Personal knowledge file". Works without an API key.
2. **C++ arithmetic**: messages that are pure arithmetic (`+ - * / % ^ **`, parentheses, decimals, negatives, "plus/times/mod" words) go to the Shunting Yard evaluator in `mathparser.cpp` -> badge "C++ math engine". Gemini is not called.
3. **Gemini**: everything else; integration, differentiation, trigonometry, probability, matrices, equations and word problems get a math-specific prompt and the badge "Gemini (mathematical reasoning)".

## Directory structure
```
main.cpp algorithm.{h,cpp} sorting.{h,cpp} searching.{h,cpp} graph.{h,cpp}
structures.{h,cpp} recursion.{h,cpp} mathalgo.{h,cpp} mathparser.{h,cpp} json.{h,cpp} selftest.{h,cpp}
server.js  package.json  Dockerfile  render.yaml  .env.example  .gitignore  README.md  CLAUDE.md
server/    config engine sources catalog gemini prompts personal chat api ratelimit
data/      algorithms.json complexity.json personal_questions.txt
public/    index.html css/styles.css js/(main, store, api, player, viz, codeviewer, ai-panel, markdown, highlight, icons, util) js/views/*
scripts/   build-cpp.js ensure-cpp.js run-selftest.js smoke-test.js mock-gemini.js ui-test.py
```

## Installation and local run
Requirements: Node.js 18+ and a C++17 compiler (`g++`; on Windows use MinGW-w64/MSYS2).
```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
# edit .env and paste your key after GEMINI_API_KEY=
npm run build:cpp           # compiles every root-level .cpp into bin/byteforge
npm start                   # http://localhost:3000   (start also rebuilds if sources changed)
```
Manual compile (equivalent): `g++ -std=c++17 -O2 -Wall -Wextra -o bin/byteforge *.cpp`

Tests: `npm run selftest` (C++ correctness suite) and `npm test` (selftest + full-stack smoke test against a local mock Gemini). Optional browser test: `pip install playwright && playwright install chromium && python3 scripts/ui-test.py`.

## Render deployment (free tier)
1. Push the repository to GitHub (see below).
2. Render dashboard -> **New** -> **Blueprint** (uses `render.yaml`) or **Web Service** -> *Docker* runtime, free plan.
3. Set `GEMINI_API_KEY` in the service's environment (not in Git).
4. Health check path: `/api/health`. Render sets `PORT`; the server binds `0.0.0.0`.

The Dockerfile installs `g++`, runs `npm ci --omit=dev`, compiles the root `*.cpp`, and starts Express as a non-root user.

**Free-tier limits:** the service sleeps after about 15 minutes idle (the first request afterwards takes tens of seconds); the filesystem is ephemeral (BYTEFORGE stores nothing server-side; edits to `personal_questions.txt` on Render are lost on redeploy, so commit them); limited CPU/RAM.

## GitHub upload
```bash
git init && git add . && git commit -m "BYTEFORGE: algorithm laboratory"
git branch -M main
git remote add origin https://github.com/<you>/BYTEFORGE.git
git push -u origin main
```
`.env` and `bin/` are git-ignored.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "C++ engine is not compiled" | `npm run build:cpp`; install g++ |
| AI features say no key | create `.env` from `.env.example`, restart |
| "key was rejected" | check the key in `.env` (no quotes/spaces) |
| "model not available" | set `GEMINI_MODEL` to a model your key supports |
| Port in use | change `PORT` in `.env` |
| Fonts look different offline | Inter / JetBrains Mono load from Google Fonts; system fallbacks are used offline |

## Limitations
- Visualization size limits: sorting 40 elements, searching 64, graphs 12 nodes / 40 edges, structures 30 operations, Fibonacci n<=12, sieve n<=200.
- Gemini answers can be wrong; the C++ source and measured statistics are the ground truth. Viva requires Gemini.
- Math: only arithmetic is computed locally; other maths depends on Gemini.
- Dijkstra needs non-negative weights; no graph editor by mouse.
- Free-tier cold starts; the in-memory rate limiter is per instance.

## Testing status (what was actually run)
- C++ `--selftest`: 13,361 checks (every algorithm vs `std::sort`, `std::binary_search`, Bellman-Ford, `std::gcd`, trial division, vector models, expression table, growth fitting), also under AddressSanitizer + UBSan.
- `scripts/smoke-test.js`: 179 checks (HTTP + engine + routing + validation + rate limit) with Gemini **mocked**.
- `scripts/ui-test.py`: 61 browser checks in headless Chromium (chat, visualizer controls, themes/settings persistence, viva, code explorer, mobile/tablet overflow).
- **Not tested here:** the real Gemini service (no key in the build environment; only the mock) and the Docker image build (no Docker available). Add your key and run the checks in the Troubleshooting/Deployment sections to confirm both.

## Future scope
Mouse-driven graph editor, more algorithms (AVL, heaps, Kruskal), shareable run links, offline question bank for viva, WebAssembly build of the engine.

Created by Abhishek Sapkale (AbhiGradient).
