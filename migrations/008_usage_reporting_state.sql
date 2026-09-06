CREATE TABLE IF NOT EXISTS usage_reporting_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO usage_reporting_state(id, reset_at)
VALUES (1, '1970-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
