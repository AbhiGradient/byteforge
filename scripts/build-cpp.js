const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const outDir = path.join(root, 'bin');
const output = path.join(outDir, isWindows ? 'byteforge.exe' : 'byteforge');

function sources() {
  return fs.readdirSync(root).filter((f) => f.endsWith('.cpp')).sort();
}

function build() {
  const files = sources();
  if (!files.includes('main.cpp')) {
    console.error('[build:cpp] main.cpp must be in the repository root.');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const compiler = process.env.CXX || 'g++';
  const args = ['-std=c++17', '-O2', '-Wall', '-Wextra', '-o', output, ...files];
  console.log(`[build:cpp] ${compiler} ${args.join(' ')}`);
  const result = spawnSync(compiler, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error(`[build:cpp] Could not run '${compiler}'. Install g++ (MinGW-w64 on Windows, build-essential on Linux).`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`[build:cpp] Built ${path.relative(root, output)}`);
}

module.exports = { build, output, sources, root };

if (require.main === module) build();
