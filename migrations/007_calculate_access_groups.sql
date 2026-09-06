CREATE TABLE IF NOT EXISTS calculate_access_groups (
  group_id TEXT PRIMARY KEY,
  group_name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS calculate_access_groups_active_idx ON calculate_access_groups (active);
