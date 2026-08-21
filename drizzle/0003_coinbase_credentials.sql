PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS coinbase_credentials (
  user_id TEXT PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_at TEXT,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

PRAGMA optimize;
