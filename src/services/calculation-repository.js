'use strict';

// Postgres-backed store for the WhatsApp calculator running balances.
// Replaces the previous in-memory Map so balances survive restarts and carry a
// full audit trail. Every record path runs in one transaction and dedups on
// `calculation_transactions.message_id` (UNIQUE) so a replayed/reprocessed
// WhatsApp message can never double-count.
class CalculationRepository {
  constructor(pool) { this.pool = pool; }

  // Record one calculation against a group's running balance.
  // Returns { duplicate, balanceBefore, balanceAfter } — on duplicate the
  // balance is left unchanged and balanceAfter === balanceBefore.
  async recordCalculation({ groupId, messageId, sender, expression, calculationType, amount }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO calculation_balances(group_id) VALUES($1) ON CONFLICT (group_id) DO NOTHING',
        [groupId]
      );
      const locked = await client.query(
        'SELECT current_total FROM calculation_balances WHERE group_id=$1 FOR UPDATE',
        [groupId]
      );
      const balanceBefore = locked.rows[0].current_total;
      const inserted = await client.query(
        `INSERT INTO calculation_transactions
           (group_id, message_id, sender, expression, calculation_type, amount, balance_before, balance_after)
         VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,($7::numeric + $6::numeric))
         ON CONFLICT (message_id) DO NOTHING
         RETURNING balance_after`,
        [groupId, messageId || null, sender || null, expression || null, calculationType || null, amount, balanceBefore]
      );
      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
        return { duplicate: true, balanceBefore, balanceAfter: balanceBefore };
      }
      const balanceAfter = inserted.rows[0].balance_after;
      await client.query(
        'UPDATE calculation_balances SET current_total=$2::numeric, updated_at=NOW() WHERE group_id=$1',
        [groupId, balanceAfter]
      );
      await client.query('COMMIT');
      return { duplicate: false, balanceBefore, balanceAfter };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Label a group's display name (used by `/calculate`). Creates the balance row
  // at zero if the group has not posted a calculation yet.
  async setGroupName(groupId, groupName) {
    await this.pool.query(
      `INSERT INTO calculation_balances(group_id, group_name) VALUES($1,$2)
       ON CONFLICT (group_id) DO UPDATE SET group_name=EXCLUDED.group_name, updated_at=NOW()`,
      [groupId, groupName]
    );
  }

  // Data for the `/calculate` report: every active group's balance plus the
  // exact NUMERIC(20,2) grand total (as a "-198.00" string).
  async calculateReport() {
    const client = await this.pool.connect();
    try {
      const rows = (await client.query(
        `SELECT group_id, group_name, current_total
         FROM calculation_balances WHERE active=TRUE ORDER BY created_at, group_id`
      )).rows;
      const grandTotal = (await client.query(
        `SELECT COALESCE(SUM(current_total), 0)::numeric(20,2)::text AS grand_total
         FROM calculation_balances WHERE active=TRUE`
      )).rows[0].grand_total;
      return { rows, grandTotal };
    } finally {
      client.release();
    }
  }

  // --- Currency labeling & broadcasts (/pkr, /usdt, /account) --------------
  // A group's currency stays NULL ("unset") until an admin explicitly runs
  // /pkr or /usdt in it — this upsert never defaults it and never touches
  // current_total (that column is simply absent from the UPDATE SET clause).
  async setCurrency(groupId, currency) {
    await this.pool.query(
      `INSERT INTO calculation_balances(group_id, currency) VALUES($1,$2)
       ON CONFLICT (group_id) DO UPDATE SET currency=EXCLUDED.currency, updated_at=NOW()`,
      [groupId, currency]
    );
  }

  // Target group IDs for a broadcast: active groups labeled `currency`, or —
  // when `currency` is omitted — every active group labeled with EITHER
  // currency (never an unset/NULL group). IDs only; each recipient's balance
  // is read fresh immediately before it is actually sent (see getCurrentTotal
  // and createCalculationHandler's broadcastWithPacing), never from this list.
  async listGroupIdsByCurrency(currency) {
    const result = currency
      ? await this.pool.query(
          'SELECT group_id FROM calculation_balances WHERE active=TRUE AND currency=$1 ORDER BY created_at, group_id',
          [currency]
        )
      : await this.pool.query(
          `SELECT group_id FROM calculation_balances WHERE active=TRUE AND currency IS NOT NULL ORDER BY created_at, group_id`
        );
    return result.rows.map((row) => row.group_id);
  }

  // A single fresh balance read for one group, used right before sending a
  // personalized /account message — deliberately not part of a bulk query so
  // a slow broadcast can never hand out a stale balance (see section 4 of the
  // feature spec / the matching integration test).
  async getCurrentTotal(groupId) {
    const result = await this.pool.query('SELECT current_total FROM calculation_balances WHERE group_id=$1', [groupId]);
    return result.rows[0] ? result.rows[0].current_total : null;
  }

  // --- Dashboard "Calculation groups" panel ---------------------------------
  // Every tracked group (active AND disabled). Disabling only hides a group from
  // the /calculate report; its balance keeps updating on new calculations.
  async listBalances() {
    return (await this.pool.query(
      `SELECT group_id, group_name, current_total, active
       FROM calculation_balances ORDER BY active DESC, created_at, group_id`
    )).rows;
  }

  // Register a group to appear in /calculate before it has posted anything.
  // Never resets an existing running balance; (re)activates the row.
  async registerBalanceGroup(groupId, groupName) {
    await this.pool.query(
      `INSERT INTO calculation_balances(group_id, group_name, current_total, active)
       VALUES ($1, $2, 0, TRUE)
       ON CONFLICT (group_id) DO UPDATE
         SET group_name = COALESCE(EXCLUDED.group_name, calculation_balances.group_name),
             active = TRUE, updated_at = NOW()`,
      [groupId, groupName || null]
    );
  }

  async setBalanceGroupActive(groupId, active) {
    await this.pool.query(
      'UPDATE calculation_balances SET active=$2, updated_at=NOW() WHERE group_id=$1',
      [groupId, active]
    );
  }

  // --- Dashboard "/calculate access" panel ---------------------------------
  // Groups allowed to run /calculate IN ADDITION TO the CALCULATE_ADMIN_GROUP_ID env var.
  async listAccessGroups() {
    return (await this.pool.query(
      `SELECT group_id, group_name, active FROM calculate_access_groups
       ORDER BY active DESC, created_at, group_id`
    )).rows;
  }

  async addAccessGroup(groupId, groupName) {
    await this.pool.query(
      `INSERT INTO calculate_access_groups(group_id, group_name, active)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (group_id) DO UPDATE
         SET group_name = COALESCE(EXCLUDED.group_name, calculate_access_groups.group_name),
             active = TRUE, updated_at = NOW()`,
      [groupId, groupName || null]
    );
  }

  async setAccessGroupActive(groupId, active) {
    await this.pool.query(
      'UPDATE calculate_access_groups SET active=$2, updated_at=NOW() WHERE group_id=$1',
      [groupId, active]
    );
  }

  async isCalculateAllowed(groupId) {
    const result = await this.pool.query(
      'SELECT 1 FROM calculate_access_groups WHERE group_id=$1 AND active=TRUE LIMIT 1',
      [groupId]
    );
    return result.rowCount > 0;
  }
}

module.exports = { CalculationRepository };
