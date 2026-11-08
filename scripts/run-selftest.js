const { spawnSync } = require('node:child_process');
const { output } = require('./build-cpp');

const result = spawnSync(output, ['--selftest'], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
