'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1'],
  {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, RUN_DB_TESTS: '1' },
    stdio: 'inherit'
  }
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
