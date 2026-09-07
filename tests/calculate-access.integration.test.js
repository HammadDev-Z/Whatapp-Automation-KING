'use strict';

// Live-Postgres test for /calculate access: CALCULATE_ADMIN_GROUP_ID env group
// OR any active row in calculate_access_groups (migration 007).
// Opt-in: RUN_DB_TESTS=1 + TEST_DATABASE_URL  (`npm run test:integration`).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { CalculationRepository } = require('../src/services/calculation-repository');

const RUN = process.env.RUN_DB_TESTS === '1' && process.env.TEST_DATABASE_URL;
const skip = RUN ? false : 'set RUN_DB_TESTS=1 and TEST_DATABASE_URL to run';

const GROUP = 'access-integration-test@g.us';

test('calculate_access_groups gates /calculate correctly', { skip }, async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  t.after(() => pool.end());

  const dir = path.join(__dirname, '..', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  await pool.query('DELETE FROM calculate_access_groups WHERE group_id=$1', [GROUP]);

  const repo = new CalculationRepository(pool);

  assert.equal(await repo.isCalculateAllowed(GROUP), false, 'unknown group not allowed');

  await repo.addAccessGroup(GROUP, 'Access Integration Test');
  assert.equal(await repo.isCalculateAllowed(GROUP), true, 'added group allowed');
  assert.equal(await repo.isCalculateAllowed('not-in-list@g.us'), false, 'other group still not allowed');

  await repo.setAccessGroupActive(GROUP, false);
  assert.equal(await repo.isCalculateAllowed(GROUP), false, 'disabled group not allowed');

  await repo.addAccessGroup(GROUP, null); // re-add reactivates, keeps name
  const row = (await pool.query('SELECT group_name, active FROM calculate_access_groups WHERE group_id=$1', [GROUP])).rows[0];
  assert.equal(row.active, true);
  assert.equal(row.group_name, 'Access Integration Test');

  await pool.query('DELETE FROM calculate_access_groups WHERE group_id=$1', [GROUP]);
});
