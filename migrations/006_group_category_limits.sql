CREATE TABLE IF NOT EXISTS group_category_limits (
  group_id TEXT NOT NULL REFERENCES allowed_groups(group_id) ON UPDATE CASCADE ON DELETE CASCADE,
  category TEXT NOT NULL REFERENCES code_categories(category) ON UPDATE CASCADE ON DELETE CASCADE,
  daily_limit INTEGER NOT NULL CHECK (daily_limit > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, category)
);

CREATE TABLE IF NOT EXISTS group_limit_windows (
  group_id TEXT PRIMARY KEY REFERENCES allowed_groups(group_id) ON UPDATE CASCADE ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
