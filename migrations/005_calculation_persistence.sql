CREATE TABLE IF NOT EXISTS calculation_balances (
  group_id TEXT PRIMARY KEY,
  current_total NUMERIC(20,2) NOT NULL DEFAULT 0,
  group_name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS calculation_balances_active_idx ON calculation_balances (active);

CREATE TABLE IF NOT EXISTS calculation_transactions (
  id BIGSERIAL PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES calculation_balances(group_id) ON UPDATE CASCADE ON DELETE CASCADE,
  message_id TEXT UNIQUE,
  sender TEXT,
  expression TEXT,
  calculation_type TEXT,
  amount NUMERIC(20,2) NOT NULL,
  balance_before NUMERIC(20,2) NOT NULL,
  balance_after NUMERIC(20,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS calculation_transactions_group_idx ON calculation_transactions (group_id, created_at DESC);
