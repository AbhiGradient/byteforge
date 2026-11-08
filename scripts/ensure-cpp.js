const fs = require('node:fs');
const path = require('node:path');
const { build, output, root } = require('./build-cpp');

function newestSourceTime() {
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith('.cpp') || f.endsWith('.h'))
    .map((f) => fs.statSync(path.join(root, f)).mtimeMs)
    .reduce((a, b) => Math.max(a, b), 0);
}

if (!fs.existsSync(output) || fs.statSync(output).mtimeMs < newestSourceTime()) {
  console.log('[ensure-cpp] C++ engine is missing or out of date, compiling...');
  build();
} else {
  console.log('[ensure-cpp] C++ engine is up to date.');
}
