/**
 * Canonical D1 schema for the shared crypto intelligence control plane.
 * Keep each entry to exactly one SQL statement so runtime initialization can
 * safely execute the list with D1 prepared statements.
 */
export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    paper_account_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS paper_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    starting_balance REAL NOT NULL CHECK (starting_balance >= 0),
    cash REAL NOT NULL CHECK (cash >= 0),
    daily_limit REAL NOT NULL CHECK (daily_limit >= 0),
    order_size REAL NOT NULL CHECK (order_size > 0),
    risk_level INTEGER NOT NULL DEFAULT 50 CHECK (risk_level BETWEEN 0 AND 100),
    minimum_confidence INTEGER NOT NULL CHECK (minimum_confidence BETWEEN 0 AND 100),
    execution_drag_bps INTEGER NOT NULL CHECK (execution_drag_bps BETWEEN 0 AND 1000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS paper_positions (
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL CHECK (symbol IN ('BTC', 'ETH', 'SOL')),
    quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    cost_basis REAL NOT NULL DEFAULT 0 CHECK (cost_basis >= 0),
    PRIMARY KEY (account_id, symbol),
    FOREIGN KEY (account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS paper_trades (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    symbol TEXT NOT NULL CHECK (symbol IN ('BTC', 'ETH', 'SOL')),
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity REAL NOT NULL CHECK (quantity > 0),
    gross_value REAL NOT NULL CHECK (gross_value > 0),
    market_price REAL NOT NULL CHECK (market_price > 0),
    execution_drag REAL NOT NULL CHECK (execution_drag >= 0),
    cash_impact REAL NOT NULL,
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    rationale TEXT NOT NULL,
    realized_pnl REAL,
    executed_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE,
    UNIQUE (account_id, signal_id)
  )`,
  `CREATE TABLE IF NOT EXISTS market_snapshots (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL CHECK (symbol IN ('BTC', 'ETH', 'SOL')),
    price REAL NOT NULL CHECK (price > 0),
    change_pct REAL NOT NULL,
    volume_usd REAL NOT NULL CHECK (volume_usd >= 0),
    source TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feed_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    asset TEXT NOT NULL,
    bias TEXT NOT NULL CHECK (bias IN ('bullish', 'bearish', 'neutral')),
    headline TEXT NOT NULL,
    detail TEXT NOT NULL,
    evidence_score INTEGER NOT NULL CHECK (evidence_score BETWEEN 0 AND 100),
    source_url TEXT,
    occurred_at TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS signal_snapshots (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL CHECK (symbol IN ('BTC', 'ETH', 'SOL')),
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    direction TEXT NOT NULL,
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    horizon TEXT NOT NULL,
    invalidation TEXT NOT NULL,
    factors_json TEXT NOT NULL,
    rationale TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    equity REAL NOT NULL,
    cash REAL NOT NULL,
    market_value REAL NOT NULL,
    realized_pnl REAL NOT NULL,
    unrealized_pnl REAL NOT NULL,
    btc_price REAL NOT NULL,
    captured_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'watch', 'action')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    source_url TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS paper_cash_flows (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    kind TEXT NOT NULL CHECK (kind IN ('deposit', 'reset')),
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    signals_created INTEGER NOT NULL DEFAULT 0,
    events_created INTEGER NOT NULL DEFAULT 0,
    paper_trade_id TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_paper_trades_account_time ON paper_trades(account_id, executed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_market_symbol_time ON market_snapshots(symbol, captured_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_feed_events_time ON feed_events(occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_signals_symbol_time ON signal_snapshots(symbol, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_portfolio_account_time ON portfolio_snapshots(account_id, captured_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_unread_time ON alerts(read_at, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_user_unread_time ON alerts(user_id, read_at, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cash_flows_account_time ON paper_cash_flows(account_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_time ON automation_runs(started_at DESC)`,
] as const;
