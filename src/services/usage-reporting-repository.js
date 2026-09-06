'use strict';

// Global usage-reporting baseline (migration 008). "Used" counts on the
// dashboard and the per-group usage report are measured from `reset_at`, not
// all-time. Resetting the baseline never touches code inventory (`unused`).
class UsageReportingRepository {
  constructor(pool) { this.pool = pool; }

  async resetAt() {
    const result = await this.pool.query('SELECT reset_at FROM usage_reporting_state WHERE id=1');
    return result.rowCount ? result.rows[0].reset_at : new Date(0);
  }

  // One transaction: bump the global baseline AND re-anchor every active group's
  // daily-limit window (section 5) so both restart together.
  async resetAllUsageCounters() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE usage_reporting_state SET reset_at=NOW(), updated_at=NOW() WHERE id=1');
      await client.query(
        `INSERT INTO group_limit_windows(group_id, window_started_at)
         SELECT group_id, NOW() FROM allowed_groups WHERE active=TRUE
         ON CONFLICT (group_id) DO UPDATE SET window_started_at=NOW(), updated_at=NOW()`
      );
      await client.query("INSERT INTO audit_logs(action) VALUES('usage_counters_reset')");
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Per-category count of codes a group has used since the baseline, plus total.
  async groupUsageReport(groupId) {
    const rows = (await this.pool.query(
      `SELECT c.category, count(*)::int AS used
       FROM codes c
       WHERE c.used_by_group=$1 AND c.status='used'
         AND c.used_at >= (SELECT reset_at FROM usage_reporting_state WHERE id=1)
       GROUP BY c.category
       ORDER BY c.category`,
      [groupId]
    )).rows;
    return { rows, total: rows.reduce((sum, row) => sum + row.used, 0) };
  }
}

module.exports = { UsageReportingRepository };
