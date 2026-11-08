const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

// Scans the root-level C++ files for "// ==== BEGIN <id> ====" regions so the
// code explorer always shows the real implementation, never a copy.
const BEGIN = /^\s*\/\/ ==== BEGIN ([a-z_]+) ====\s*$/;
const END = /^\s*\/\/ ==== END ([a-z_]+) ====\s*$/;

let index = null;

function scan() {
  const found = new Map();
  const files = fs.readdirSync(config.root).filter((f) => f.endsWith('.cpp')).sort();
  for (const file of files) {
    const lines = fs.readFileSync(path.join(config.root, file), 'utf8').split(/\r?\n/);
    let open = null;
    lines.forEach((text, i) => {
      const begin = text.match(BEGIN);
      const end = text.match(END);
      if (begin) open = { id: begin[1], start: i + 2 };
      else if (end && open && open.id === end[1]) {
        const code = lines.slice(open.start - 1, i).join('\n');
        found.set(open.id, {
          id: open.id,
          file,
          language: 'cpp',
          startLine: open.start,
          endLine: i,
          lineCount: i - open.start + 1,
          code
        });
        open = null;
      }
    });
  }
  return found;
}

function get(id) {
  if (!index) index = scan();
  return index.get(id) || null;
}

function reload() {
  index = scan();
  return index.size;
}

module.exports = { get, reload };
