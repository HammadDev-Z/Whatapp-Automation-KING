'use strict';

// Live-Postgres test for shiftCodesByIds (dashboard "select codes from the
// lifecycle table, shift to another category" bulk action).
// Opt-in: RUN_DB_TESTS=1 + TEST_DATABASE_URL (`npm run test:integration`).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { shiftCodesByIds } = require('../src/services/code-importer');

const RUN = process.env.RUN_DB_TESTS === '1' && process.env.TEST_DATABASE_URL;
const skip = RUN ? false : 'set RUN_DB_TESTS=1 and TEST_DATABASE_URL to run';

test('shiftCodesByIds moves only unused selected codes', { skip }, async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  t.after(() => pool.end());

  const dir = path.join(__dirname, '..', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
  }

  const codes = ['SELID-UNUSED-1', 'SELID-UNUSED-2', 'SELID-USED-1', 'SELID-SAME-CAT'];
  await pool.query('DELETE FROM codes WHERE code = ANY($1)', [codes]);
  const inserted = {};
  for (const [code, category, status] of [
    ['SELID-UNUSED-1', '830', 'unused'],
    ['SELID-UNUSED-2', '830', 'unused'],
    ['SELID-USED-1', '830', 'used'],
    ['SELID-SAME-CAT', '2320', 'unused']
  ]) {
    const row = (await pool.query(
      `INSERT INTO codes(category, code, status, delivery_status, used_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [category, code, status, status === 'used' ? 'sent' : null, status === 'used' ? new Date() : null]
    )).rows[0];
    inserted[code] = row.id;
  }

  const ids = Object.values(inserted);
  const result = await shiftCodesByIds(pool, '2320', ids);

  assert.equal(result.category, '2320');
  assert.equal(result.moved, 2, 'only the two unused-in-830 codes moved');
  assert.equal(result.skippedSameCategory, 1);
  assert.equal(result.notUnused.length, 1);
  assert.equal(result.notUnused[0].id, inserted['SELID-USED-1']);
  assert.equal(result.notUnused[0].status, 'used');

  const rows = (await pool.query('SELECT code, category, status FROM codes WHERE code = ANY($1) ORDER BY code', [codes])).rows;
  assert.deepEqual(rows, [
    { code: 'SELID-SAME-CAT', category: '2320', status: 'unused' },
    { code: 'SELID-USED-1', category: '830', status: 'used' }, // untouched
    { code: 'SELID-UNUSED-1', category: '2320', status: 'unused' },
    { code: 'SELID-UNUSED-2', category: '2320', status: 'unused' }
  ]);

  // A stale/nonexistent id in the selection is ignored, not an error.
  const second = await shiftCodesByIds(pool, '830', [...ids, 999999999]);
  assert.equal(second.moved, 2, 'moving back to 830 works and the bogus id is ignored');

  await assert.rejects(() => shiftCodesByIds(pool, '2320', []), /select at least one/i);
  await assert.rejects(() => shiftCodesByIds(pool, 'not-a-category', ids), /active/i);

  await pool.query('DELETE FROM codes WHERE code = ANY($1)', [codes]);
});
