PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS signal_evaluations (
  signal_id TEXT NOT NULL,
  symbol TEXT NOT NULL CHECK (symbol IN ('BTC', 'ETH', 'SOL')),
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  horizon_hours INTEGER NOT NULL CHECK (horizon_hours IN (4, 24)),
  entry_price REAL NOT NULL CHECK (entry_price > 0),
  exit_price REAL NOT NULL CHECK (exit_price > 0),
  raw_return_pct REAL NOT NULL,
  net_return_pct REAL NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  signal_created_at TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  PRIMARY KEY (signal_id, horizon_hours),
  FOREIGN KEY (signal_id) REFERENCES signal_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_signal_evaluations_horizon_time
ON signal_evaluations(horizon_hours, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_evaluations_confidence
ON signal_evaluations(horizon_hours, confidence, correct);

PRAGMA optimize;
