const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const engine = require('./engine');
const sources = require('./sources');

// Merges the static knowledge files (data/*.json) with the live engine
// registry. The engine is the source of truth for ids, categories and the
// default inputs; the JSON files add descriptions, applications and examples.
const read = (name) => JSON.parse(fs.readFileSync(path.join(config.dataDir, name), 'utf8'));
const meta = read('algorithms.json').algorithms;
const complexityFile = read('complexity.json').complexity;

const CATEGORY_LABELS = {
  sorting: 'Sorting',
  searching: 'Searching',
  graph: 'Graph',
  structure: 'Data Structures',
  recursion: 'Recursion',
  math: 'Mathematical'
};

const ALIASES = {
  bubble_sort: ['bubble sort', 'bubblesort'],
  selection_sort: ['selection sort'],
  insertion_sort: ['insertion sort'],
  merge_sort: ['merge sort', 'mergesort'],
  quick_sort: ['quick sort', 'quicksort'],
  heap_sort: ['heap sort', 'heapsort'],
  linear_search: ['linear search', 'sequential search'],
  binary_search: ['binary search'],
  jump_search: ['jump search'],
  bfs: ['bfs', 'breadth first search', 'breadth-first search'],
  dfs: ['dfs', 'depth first search', 'depth-first search'],
  dijkstra: ['dijkstra', 'dijkstras algorithm', "dijkstra's algorithm", 'dijkstra algorithm'],
  stack: ['stack', 'stack data structure'],
  queue: ['queue', 'queue data structure'],
  singly_linked_list: ['singly linked list'],
  doubly_linked_list: ['doubly linked list'],
  circular_linked_list: ['circular linked list'],
  factorial: ['factorial', 'recursive factorial'],
  fibonacci: ['fibonacci', 'recursive fibonacci', 'fibonacci series'],
  gcd: ['gcd', 'euclidean gcd', 'euclidean algorithm', 'greatest common divisor'],
  sieve: ['sieve of eratosthenes', 'sieve', 'eratosthenes sieve']
};

let engineList = null;
let engineListAt = 0;

async function loadEngineList() {
  if (engineList && Date.now() - engineListAt < 5 * 60 * 1000) return engineList;
  try {
    const reply = await engine.list();
    if (reply.ok) {
      engineList = reply.algorithms;
      engineListAt = Date.now();
    }
  } catch {
    /* fall back to static data */
  }
  return engineList;
}

function fallbackEntry(id) {
  const m = meta[id];
  const c = complexityFile[id];
  const label = id.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  return {
    id,
    name: label,
    category: 'unknown',
    visualization: 'bars',
    complexity: { best: c.best, average: c.average, worst: c.worst, space: c.space },
    defaultInput: m.examples[0].input,
    supportsScaling: false
  };
}

function merge(entry) {
  const m = meta[entry.id] || {};
  const c = complexityFile[entry.id] || {};
  const hasSource = Boolean(sources.get(entry.id));
  return {
    ...entry,
    categoryLabel: CATEGORY_LABELS[entry.category] || entry.category,
    summary: m.summary || '',
    description: m.description || '',
    steps: m.steps || [],
    applications: m.applications || [],
    properties: m.properties || [],
    inputHelp: m.inputHelp || '',
    examples: m.examples || [],
    complexityNotes: c.notes || {},
    hasSource
  };
}

async function all() {
  const list = (await loadEngineList()) || Object.keys(meta).map(fallbackEntry);
  return list.map(merge);
}

async function get(id) {
  return (await all()).find((a) => a.id === id) || null;
}

function normalise(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Returns the id of a predefined algorithm mentioned in `text`, or null. */
function findByName(text) {
  const t = ` ${normalise(text)} `;
  let best = null;
  for (const [id, names] of Object.entries(ALIASES)) {
    for (const name of names) {
      if (t.includes(` ${normalise(name)} `) && (!best || name.length > best.len)) best = { id, len: name.length };
    }
  }
  return best ? best.id : null;
}

function complexityText(entry) {
  const c = entry.complexity;
  return `best ${c.best}, average ${c.average}, worst ${c.worst}, space ${c.space}`;
}

module.exports = { all, get, findByName, complexityText, CATEGORY_LABELS, ids: () => Object.keys(meta) };
