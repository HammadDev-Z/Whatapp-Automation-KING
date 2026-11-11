'use strict';

const { normalizeCategory } = require('../utilities/normalization');

function validateCodeLines(input) {
  const rows = [];
  const errors = [];
  const seen = new Set();
  let skipped = 0;

  String(input || '').split(/\r?\n/).forEach((line, index) => {
    const code = line.trim().replace(/^\d+[.)]\s+/, '').trim();
    if (!code) return;
    if (/\s/.test(code) || code.length > 512) {
      errors.push(`Line ${index + 1}: codes cannot contain spaces and must be 512 characters or fewer`);
      return;
    }
    if (seen.has(code)) { skipped += 1; return; }
    seen.add(code);
    rows.push(code);
  });

  if (!rows.length && !errors.length) throw new Error('Enter at least one code, with one code per line');
  return { rows, skipped, failed: errors.length, errors };
}

async function importCodeLines(pool, categoryInput, input) {
  const categoryAlias = normalizeCategory(categoryInput);
  if (!categoryAlias) throw new Error('Select a valid category');
  const validation = validateCodeLines(input);
  const client = await pool.connect();
  let imported = 0;
  let skipped = validation.skipped;

  try {
    await client.query('BEGIN');
    const categoryResult = await client.query(
      `SELECT a.category
       FROM category_aliases a
       JOIN code_categories c ON c.category=a.category
       WHERE a.alias=$1 AND c.active=TRUE`,
      [categoryAlias]
    );
    if (!categoryResult.rowCount) throw new Error('The selected category is not active');
    const category = categoryResult.rows[0].category;

    for (const code of validation.rows) {
      const result = await client.query(
        `INSERT INTO codes(category,code) VALUES($1,$2)
         ON CONFLICT(code) DO NOTHING RETURNING id`,
        [category, code]
      );
      if (!result.rowCount) { skipped += 1; continue; }
      imported += 1;
      await client.query(
        `INSERT INTO audit_logs(action,category,code_id,delivery_status)
         VALUES('code_imported',$1,$2,NULL)`,
        [category, result.rows[0].id]
      );
    }
    await client.query('COMMIT');
    return { category, imported, skipped, failed: validation.failed, errors: validation.errors };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function shiftCodeLines(pool, categoryInput, input) {
  const categoryAlias = normalizeCategory(categoryInput);
  if (!categoryAlias) throw new Error('Select a valid target category');
  const validation = validateCodeLines(input);
  const client = await pool.connect();
  let moved = 0;
  let skippedSameCategory = 0;
  let skippedNotFound = 0;
  const notFound = [];
  const notUnused = [];

  try {
    await client.query('BEGIN');
    const categoryResult = await client.query(
      `SELECT a.category
       FROM category_aliases a
       JOIN code_categories c ON c.category=a.category
       WHERE a.alias=$1 AND c.active=TRUE`,
      [categoryAlias]
    );
    if (!categoryResult.rowCount) throw new Error('The selected target category is not active');
    const targetCategory = categoryResult.rows[0].category;

    for (const code of validation.rows) {
      const existing = (await client.query('SELECT id,category,status FROM codes WHERE code=$1', [code])).rows[0];
      if (!existing) { skippedNotFound += 1; notFound.push(code); continue; }
      if (existing.category === targetCategory) { skippedSameCategory += 1; continue; }
      if (existing.status !== 'unused') { notUnused.push({ code, status: existing.status, category: existing.category }); continue; }
      await client.query('UPDATE codes SET category=$1 WHERE id=$2', [targetCategory, existing.id]);
      await client.query(
        `INSERT INTO audit_logs(action,category,code_id,delivery_status)
         VALUES('category_corrected',$1,$2,NULL)`,
        [targetCategory, existing.id]
      );
      moved += 1;
    }
    await client.query('COMMIT');
    return {
      category: targetCategory,
      moved,
      skippedSameCategory,
      skippedNotFound,
      notFound,
      notUnused,
      failed: validation.failed,
      errors: validation.errors
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function shiftCodesByIds(pool, categoryInput, idsInput) {
  const categoryAlias = normalizeCategory(categoryInput);
  if (!categoryAlias) throw new Error('Select a valid target category');
  const ids = [...new Set((Array.isArray(idsInput) ? idsInput : [idsInput])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  if (!ids.length) throw new Error('Select at least one code to shift');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryResult = await client.query(
      `SELECT a.category
       FROM category_aliases a
       JOIN code_categories c ON c.category=a.category
       WHERE a.alias=$1 AND c.active=TRUE`,
      [categoryAlias]
    );
    if (!categoryResult.rowCount) throw new Error('The selected target category is not active');
    const targetCategory = categoryResult.rows[0].category;

    const existing = (await client.query(
      'SELECT id,category,status FROM codes WHERE id=ANY($1::bigint[])',
      [ids]
    )).rows;
    const byId = new Map(existing.map((row) => [row.id, row]));

    let skippedSameCategory = 0;
    const notUnused = [];
    const moveIds = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue; // selection went stale (page refreshed/edited elsewhere); ignore silently
      if (row.category === targetCategory) { skippedSameCategory += 1; continue; }
      if (row.status !== 'unused') { notUnused.push({ id, status: row.status, category: row.category }); continue; }
      moveIds.push(id);
    }

    let moved = 0;
    if (moveIds.length) {
      await client.query('UPDATE codes SET category=$1 WHERE id=ANY($2::bigint[])', [targetCategory, moveIds]);
      for (const id of moveIds) {
        await client.query(
          `INSERT INTO audit_logs(action,category,code_id,delivery_status)
           VALUES('category_corrected',$1,$2,NULL)`,
          [targetCategory, id]
        );
      }
      moved = moveIds.length;
    }

    await client.query('COMMIT');
    return { category: targetCategory, moved, skippedSameCategory, notUnused };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { validateCodeLines, importCodeLines, shiftCodeLines, shiftCodesByIds };
