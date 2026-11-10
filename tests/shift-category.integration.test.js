'use strict';

// Live-Postgres test for shiftCodeLines (dashboard "shift codes to another
// category" feature). Opt-in: RUN_DB_TESTS=1 + TEST_DATABASE_URL (`npm run test:integration`).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { shiftCodeLines } = require('../src/services/code-importer');

const RUN = process.env.RUN_DB_TESTS === '1' && process.env.TEST_DATABASE_URL;
const skip = RUN ? false : 'set RUN_DB_TESTS=1 and TEST_DATABASE_URL to run';

test('shiftCodeLines moves only unused codes and reports the rest', { skip }, async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  t.after(() => pool.end());

  const dir = path.join(__dirname, '..', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
  }

  const codes = ['SHIFT-TEST-UNUSED-1', 'SHIFT-TEST-UNUSED-2', 'SHIFT-TEST-USED-1', 'SHIFT-TEST-SAME-CAT'];
  await pool.query('DELETE FROM codes WHERE code = ANY($1)', [codes]);
  await pool.query(`INSERT INTO codes(category, code, status) VALUES ('830','SHIFT-TEST-UNUSED-1','unused')`);
  await pool.query(`INSERT INTO codes(category, code, status, delivery_status, used_at) VALUES ('830','SHIFT-TEST-UNUSED-2','unused',NULL,NULL)`);
  await pool.query(`INSERT INTO codes(category, code, status, delivery_status, used_at) VALUES ('830','SHIFT-TEST-USED-1','used','sent',NOW())`);
  await pool.query(`INSERT INTO codes(category, code, status) VALUES ('2320','SHIFT-TEST-SAME-CAT','unused')`);

  const result = await shiftCodeLines(pool, '2320', codes.join('\n') + '\nSHIFT-TEST-NOT-FOUND');

  assert.equal(result.category, '2320');
  assert.equal(result.moved, 2, 'only the two unused codes moved');
  assert.equal(result.skippedSameCategory, 1, 'already-2320 code counted as skipped-same-category');
  assert.equal(result.skippedNotFound, 1);
  assert.deepEqual(result.notFound, ['SHIFT-TEST-NOT-FOUND']);
  assert.equal(result.notUnused.length, 1);
  assert.equal(result.notUnused[0].code, 'SHIFT-TEST-USED-1');
  assert.equal(result.notUnused[0].status, 'used');
  assert.equal(result.notUnused[0].category, '830');

  const rows = (await pool.query('SELECT code, category, status FROM codes WHERE code = ANY($1) ORDER BY code', [codes])).rows;
  assert.deepEqual(rows, [
    { code: 'SHIFT-TEST-SAME-CAT', category: '2320', status: 'unused' },
    { code: 'SHIFT-TEST-UNUSED-1', category: '2320', status: 'unused' },
    { code: 'SHIFT-TEST-UNUSED-2', category: '2320', status: 'unused' },
    { code: 'SHIFT-TEST-USED-1', category: '830', status: 'used' } // untouched
  ]);

  const auditCount = (await pool.query(
    `SELECT count(*)::int AS n FROM audit_logs WHERE action='category_corrected' AND code_id IN (SELECT id FROM codes WHERE code = ANY($1))`,
    [codes]
  )).rows[0].n;
  assert.equal(auditCount, 2, 'one audit row per moved code');

  await pool.query('DELETE FROM codes WHERE code = ANY($1)', [codes]);
});
