'use strict';

class GroupRepository {
  constructor(pool) { this.pool = pool; }
  async set(groupId, groupName, active = true) {
    await this.pool.query(
      `INSERT INTO allowed_groups(group_id,group_name,active) VALUES($1,$2,$3)
       ON CONFLICT(group_id) DO UPDATE SET group_name=EXCLUDED.group_name,active=EXCLUDED.active,updated_at=NOW()`,
      [groupId, groupName, active]
    );
  }
  async toggle(groupId, active) {
    return this.pool.query('UPDATE allowed_groups SET active=$2,updated_at=NOW() WHERE group_id=$1', [groupId, active]);
  }
  async list() { return (await this.pool.query('SELECT * FROM allowed_groups ORDER BY group_name')).rows; }
}

module.exports = { GroupRepository };
