'use strict';

// Live-Postgres test for the daily per-group / per-category limit enforcement in
// CodeAllocationService.allocate(). Opt-in: set RUN_DB_TESTS=1 and
// TEST_DATABASE_URL to a disposable database (`npm run test:integration`).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { CodeAllocationService } = require('../src/services/code-allocation');
const { GroupLimitRepository } = require('../src/services/group-limit-repository');

const RUN = process.env.RUN_DB_TESTS === '1' && process.env.TEST_DATABASE_URL;
const skip = RUN ? false : 'set RUN_DB_TESTS=1 and TEST_DATABASE_URL to run';

const GROUP = 'limit-integration-test@g.us';
const CATEGORY = '830';

async function applySchema(pool) {
  const dir = path.join(__dirname, '..', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
}

async function reset(pool) {
  await pool.query('DELETE FROM audit_logs WHERE group_id=$1', [GROUP]);
  await pool.query('DELETE FROM processed_messages WHERE group_id=$1', [GROUP]);
  await pool.query('DELETE FROM group_category_limits WHERE group_id=$1', [GROUP]);
  await pool.query('DELETE FROM group_limit_windows WHERE group_id=$1', [GROUP]);
  await pool.query("DELETE FROM codes WHERE code LIKE 'LIMIT-INT-%'");
  await pool.query('DELETE FROM allowed_groups WHERE group_id=$1', [GROUP]);
}

test('daily limit: clamps, then blocks with limit_reached, then a window reset restores quota', { skip }, async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  t.after(() => pool.end());

  await applySchema(pool);
  await reset(pool);
  await pool.query('INSERT INTO allowed_groups(group_id,group_name,active) VALUES($1,$2,TRUE)', [GROUP, 'Limit Integration Test']);
  for (let i = 0; i < 20; i += 1) {
    await pool.query('INSERT INTO codes(category,code) VALUES($1,$2)', [CATEGORY, `LIMIT-INT-${i}`]);
  }
  await pool.query('INSERT INTO group_category_limits(group_id,category,daily_limit) VALUES($1,$2,3)', [GROUP, CATEGORY]);

  const service = new CodeAllocationService(pool);

  const first = await service.allocate({ category: CATEGORY, groupId: GROUP, requestedBy: 'u1', messageId: 'int-1', quantity: 5 });
  assert.equal(first.status, 'allocated');
  assert.equal(first.issuedQuantity, 3);
  assert.equal(first.requestedQuantity, 5);
  assert.equal(first.partial, true);
  assert.equal(first.limitClamped, true);

  const second = await service.allocate({ category: CATEGORY, groupId: GROUP, requestedBy: 'u1', messageId: 'int-2', quantity: 2 });
  assert.equal(second.status, 'limit_reached');
  assert.equal(second.used, 3);
  assert.equal(second.dailyLimit, 3);

  await new GroupLimitRepository(pool).resetWindow(GROUP);

  const third = await service.allocate({ category: CATEGORY, groupId: GROUP, requestedBy: 'u1', messageId: 'int-3', quantity: 2 });
  assert.equal(third.status, 'allocated');
  assert.equal(third.issuedQuantity, 2);
  assert.equal(third.partial, false);

  await reset(pool);
});
