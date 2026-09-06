'use strict';

const { activeLimitWindowStart } = require('../utilities/limits');

// Dashboard-side reads/writes for the daily per-group / per-category code quota
// (migration 006). The enforcement path itself lives in CodeAllocationService.
class GroupLimitRepository {
  constructor(pool) { this.pool = pool; }

  // Effective start of the group's current 24h cycle (for usage counting / display).
  async currentWindowStart(groupId, now = new Date()) {
    const row = await this.pool.query(
      'SELECT window_started_at FROM group_limit_windows WHERE group_id=$1', [groupId]
    );
    return activeLimitWindowStart(row.rowCount ? row.rows[0].window_started_at : null, now);
  }

  // Every active category with this group's daily limit (null = unlimited) and
  // how many codes it has used in the current cycle.
  async listForGroup(groupId, now = new Date()) {
    const windowStart = await this.currentWindowStart(groupId, now);
    const rows = (await this.pool.query(
      `SELECT cc.category, cc.display_name, gcl.daily_limit,
              (SELECT count(*)::int FROM codes c
                 WHERE c.used_by_group=$1 AND c.category=cc.category
                   AND c.status='used' AND c.used_at >= $2) AS used
       FROM code_categories cc
       LEFT JOIN group_category_limits gcl ON gcl.category=cc.category AND gcl.group_id=$1
       WHERE cc.active=TRUE
       ORDER BY cc.category`,
      [groupId, windowStart]
    )).rows;
    return { windowStart, rows };
  }

  // Replace ALL of a group's limit rows in one transaction. `limits` is
  // { [category]: value }; blank/absent = unlimited (row removed). Non-blank
  // values must be positive whole numbers or the whole save is rejected.
  async replaceLimits(groupId, limits) {
    const clean = [];
    for (const [category, raw] of Object.entries(limits || {})) {
      const value = String(raw ?? '').trim();
      if (value === '') continue;
      if (!/^\d+$/.test(value) || Number(value) < 1) {
        throw new Error(`Invalid daily limit for "${category}": must be a positive whole number`);
      }
      clean.push([category, Number(value)]);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM group_category_limits WHERE group_id=$1', [groupId]);
      for (const [category, value] of clean) {
        await client.query(
          'INSERT INTO group_category_limits(group_id, category, daily_limit) VALUES ($1,$2,$3)',
          [groupId, category, value]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resetWindow(groupId) {
    await this.pool.query(
      `INSERT INTO group_limit_windows(group_id, window_started_at) VALUES ($1, NOW())
       ON CONFLICT (group_id) DO UPDATE SET window_started_at=NOW(), updated_at=NOW()`,
      [groupId]
    );
  }
}

module.exports = { GroupLimitRepository };
