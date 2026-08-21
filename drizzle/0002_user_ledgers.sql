PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  paper_account_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

ALTER TABLE paper_accounts ADD COLUMN user_id TEXT;
ALTER TABLE paper_accounts ADD COLUMN risk_level INTEGER NOT NULL DEFAULT 50 CHECK (risk_level BETWEEN 0 AND 100);

UPDATE paper_accounts SET user_id = 'justin' WHERE id = 'shared' AND user_id IS NULL;

INSERT OR IGNORE INTO app_users (id, email, display_name, paper_account_id, created_at)
VALUES
  ('justin', 'gatchek@gmail.com', 'Justin', 'shared', CURRENT_TIMESTAMP),
  ('gatcho', 'gatcho@gmail.com', 'Gatcho', 'gatcho', CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO paper_accounts (
  id, user_id, starting_balance, cash, daily_limit, order_size, risk_level,
  minimum_confidence, execution_drag_bps, created_at, updated_at, version
) VALUES (
  'gatcho', 'gatcho', 10000, 10000, 1000, 250, 50,
  65, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1
);

INSERT OR IGNORE INTO paper_positions (account_id, symbol, quantity, cost_basis)
VALUES
  ('gatcho', 'BTC', 0, 0),
  ('gatcho', 'ETH', 0, 0),
  ('gatcho', 'SOL', 0, 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_accounts_user_id ON paper_accounts(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE alerts ADD COLUMN user_id TEXT;
UPDATE alerts SET user_id = 'justin' WHERE user_id IS NULL;

CREATE TABLE IF NOT EXISTS paper_cash_flows (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'reset')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_unread_time ON alerts(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_flows_account_time ON paper_cash_flows(account_id, created_at DESC);

INSERT OR IGNORE INTO runtime_settings (key, value, updated_at)
VALUES
  ('auto_paper_enabled:justin', COALESCE((SELECT value FROM runtime_settings WHERE key = 'auto_paper_enabled'), 'true'), CURRENT_TIMESTAMP),
  ('auto_paper_enabled:gatcho', 'true', CURRENT_TIMESTAMP);

PRAGMA foreign_keys = ON;
PRAGMA optimize;
