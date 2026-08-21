import { schemaStatements } from "../db/schema";
import {
  createPaperAccount,
  type PaperAccount,
  type PaperPosition,
  type PaperTrade,
  type PaperSymbol,
} from "../lib/paper-trading";
import type { AlertRecord, D1Database, IntelligenceEvent, LiveSignal, MarketAsset } from "./types";
import { appUsers } from "./access";

const symbols: PaperSymbol[] = ["BTC", "ETH", "SOL"];
let schemaReady: Promise<void> | null = null;

type AccountRow = {
  id: string;
  user_id: string;
  starting_balance: number;
  cash: number;
  daily_limit: number;
  order_size: number;
  risk_level: number;
  minimum_confidence: number;
  execution_drag_bps: number;
  created_at: string;
  version: number;
};

type PositionRow = {
  symbol: PaperSymbol;
  quantity: number;
  cost_basis: number;
};

type TradeRow = {
  id: string;
  signal_id: string;
  symbol: PaperSymbol;
  side: "BUY" | "SELL";
  quantity: number;
  gross_value: number;
  market_price: number;
  execution_drag: number;
  cash_impact: number;
  confidence: number;
  rationale: string;
  realized_pnl: number | null;
  executed_at: string;
};

export async function ensureDatabase(db: D1Database) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.batch(schemaStatements.map((sql) => db.prepare(sql)));
      const now = new Date().toISOString();
      await db.batch([
        ...appUsers.map((user) => db.prepare(
          `INSERT OR IGNORE INTO app_users (id, email, display_name, paper_account_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(user.id, user.email, user.displayName, user.accountId, now)),
        ...appUsers.map((user) => db.prepare(
          `INSERT OR IGNORE INTO paper_accounts (
            id, user_id, starting_balance, cash, daily_limit, order_size, risk_level,
            minimum_confidence, execution_drag_bps, created_at, updated_at, version
          ) VALUES (?, ?, 10000, 10000, 1000, 250, 50, 65, 30, ?, ?, 1)`,
        ).bind(user.accountId, user.id, now, now)),
        ...appUsers.flatMap((user) => symbols.map((symbol) =>
          db.prepare(
            "INSERT OR IGNORE INTO paper_positions (account_id, symbol, quantity, cost_basis) VALUES (?, ?, 0, 0)",
          ).bind(user.accountId, symbol),
        )),
        ...appUsers.map((user) => db.prepare(
          "INSERT OR IGNORE INTO runtime_settings (key, value, updated_at) VALUES (?, 'true', ?)",
        ).bind(`auto_paper_enabled:${user.id}`, now)),
        db.prepare(
          "INSERT OR IGNORE INTO runtime_settings (key, value, updated_at) VALUES ('real_trading_enabled', 'false', ?)",
        ).bind(now),
        db.prepare(
          "INSERT OR IGNORE INTO runtime_settings (key, value, updated_at) VALUES ('real_trading_kill_switch', 'true', ?)",
        ).bind(now),
        db.prepare(
          "INSERT OR IGNORE INTO runtime_settings (key, value, updated_at) VALUES ('real_daily_limit', '0', ?)",
        ).bind(now),
      ]);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

export async function loadPaperAccount(db: D1Database, accountId: string): Promise<PaperAccount> {
  await ensureDatabase(db);
  const account = await db.prepare("SELECT * FROM paper_accounts WHERE id = ?").bind(accountId).first<AccountRow>();
  if (!account) return createPaperAccount();

  const [positionsResult, tradesResult] = await Promise.all([
    db.prepare("SELECT symbol, quantity, cost_basis FROM paper_positions WHERE account_id = ?").bind(accountId).all<PositionRow>(),
    db.prepare(
      `SELECT id, signal_id, symbol, side, quantity, gross_value, market_price,
        execution_drag, cash_impact, confidence, rationale, realized_pnl, executed_at
       FROM paper_trades WHERE account_id = ? ORDER BY executed_at DESC LIMIT 1000`,
    ).bind(accountId).all<TradeRow>(),
  ]);

  const positions = Object.fromEntries(
    symbols.map((symbol) => [symbol, { quantity: 0, costBasis: 0 } satisfies PaperPosition]),
  ) as Record<PaperSymbol, PaperPosition>;
  for (const row of positionsResult.results) {
    positions[row.symbol] = { quantity: row.quantity, costBasis: row.cost_basis };
  }

  const trades: PaperTrade[] = tradesResult.results.map((row) => ({
    id: row.id,
    signalId: row.signal_id,
    createdAt: row.executed_at,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    marketPrice: row.market_price,
    grossValue: row.gross_value,
    executionDrag: row.execution_drag,
    cashImpact: row.cash_impact,
    confidence: row.confidence,
    rationale: row.rationale,
    realizedPnl: row.realized_pnl,
  }));

  return {
    version: 1,
    createdAt: account.created_at,
    startingBalance: account.starting_balance,
    cash: account.cash,
    dailyLimit: account.daily_limit,
    orderSize: account.order_size,
    riskLevel: account.risk_level,
    minimumConfidence: account.minimum_confidence,
    executionDragBps: account.execution_drag_bps,
    positions,
    trades,
  };
}

export async function savePaperAccount(
  db: D1Database,
  accountId: string,
  account: PaperAccount,
  newTrade?: PaperTrade,
) {
  const now = new Date().toISOString();
  const statements = [
    db.prepare(
      `UPDATE paper_accounts SET starting_balance = ?, cash = ?, daily_limit = ?,
        order_size = ?, risk_level = ?, minimum_confidence = ?, execution_drag_bps = ?,
        updated_at = ?, version = version + 1 WHERE id = ?`,
    ).bind(
      account.startingBalance,
      account.cash,
      account.dailyLimit,
      account.orderSize,
      account.riskLevel,
      account.minimumConfidence,
      account.executionDragBps,
      now,
      accountId,
    ),
    ...symbols.map((symbol) =>
      db.prepare(
        `INSERT INTO paper_positions (account_id, symbol, quantity, cost_basis)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id, symbol) DO UPDATE SET
           quantity = excluded.quantity, cost_basis = excluded.cost_basis`,
      ).bind(accountId, symbol, account.positions[symbol].quantity, account.positions[symbol].costBasis),
    ),
  ];

  if (newTrade) {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO paper_trades (
          id, account_id, signal_id, symbol, side, quantity, gross_value,
          market_price, execution_drag, cash_impact, confidence, rationale,
          realized_pnl, executed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newTrade.id,
        accountId,
        newTrade.signalId,
        newTrade.symbol,
        newTrade.side,
        newTrade.quantity,
        newTrade.grossValue,
        newTrade.marketPrice,
        newTrade.executionDrag,
        newTrade.cashImpact,
        newTrade.confidence,
        newTrade.rationale,
        newTrade.realizedPnl,
        newTrade.createdAt,
      ),
    );
  }

  await db.batch(statements);
}

export async function resetPaperAccount(db: D1Database, accountId: string, startingBalance: number, dailyLimit: number) {
  const account = createPaperAccount(startingBalance, dailyLimit);
  await db.batch([
    db.prepare("DELETE FROM paper_trades WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM portfolio_snapshots WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM paper_cash_flows WHERE account_id = ?").bind(accountId),
    db.prepare(
      `UPDATE paper_accounts SET starting_balance = ?, cash = ?, daily_limit = ?,
        order_size = ?, risk_level = ?, minimum_confidence = ?, execution_drag_bps = ?,
        created_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    ).bind(
      account.startingBalance,
      account.cash,
      account.dailyLimit,
      account.orderSize,
      account.riskLevel,
      account.minimumConfidence,
      account.executionDragBps,
      account.createdAt,
      account.createdAt,
      accountId,
    ),
    ...symbols.map((symbol) =>
      db.prepare("UPDATE paper_positions SET quantity = 0, cost_basis = 0 WHERE account_id = ? AND symbol = ?")
        .bind(accountId, symbol),
    ),
    db.prepare(
      "INSERT INTO paper_cash_flows (id, account_id, amount, kind, note, created_at) VALUES (?, ?, ?, 'reset', 'Paper account reset', ?)",
    ).bind(`reset:${accountId}:${account.createdAt}`, accountId, startingBalance, account.createdAt),
  ]);
  return account;
}

export async function depositPaperFunds(db: D1Database, accountId: string, amount: number) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE paper_accounts SET starting_balance = starting_balance + ?, cash = cash + ?,
       updated_at = ?, version = version + 1 WHERE id = ?`,
    ).bind(amount, amount, now, accountId),
    db.prepare(
      "INSERT INTO paper_cash_flows (id, account_id, amount, kind, note, created_at) VALUES (?, ?, ?, 'deposit', 'One-time paper cash deposit', ?)",
    ).bind(`deposit:${accountId}:${now}`, accountId, amount, now),
  ]);
  return loadPaperAccount(db, accountId);
}

export async function saveIngestion(
  db: D1Database,
  market: MarketAsset[],
  events: IntelligenceEvent[],
  signals: LiveSignal[],
  capturedAt: string,
) {
  await ensureDatabase(db);
  const statements = [
    ...market.map((asset) =>
      db.prepare(
        `INSERT OR IGNORE INTO market_snapshots
          (id, symbol, price, change_pct, volume_usd, source, captured_at)
         VALUES (?, ?, ?, ?, ?, 'Coinbase Exchange', ?)`,
      ).bind(`${capturedAt}:${asset.symbol}`, asset.symbol, asset.price, asset.changePct, asset.volumeUsd, capturedAt),
    ),
    ...events.map((event) =>
      db.prepare(
        `INSERT OR IGNORE INTO feed_events
          (id, source, asset, bias, headline, detail, evidence_score, source_url, occurred_at, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        event.id,
        event.source,
        event.asset,
        event.bias,
        event.headline,
        event.detail,
        event.score,
        event.url,
        event.occurredAt,
        capturedAt,
      ),
    ),
    ...signals.map((signal) =>
      db.prepare(
        `INSERT OR IGNORE INTO signal_snapshots
          (id, symbol, side, direction, confidence, horizon, invalidation,
           factors_json, rationale, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `${capturedAt}:${signal.symbol}`,
        signal.symbol,
        signal.side,
        signal.direction,
        signal.confidence,
        signal.horizon,
        signal.invalidation,
        JSON.stringify(signal.factors),
        signal.rationale,
        capturedAt,
      ),
    ),
  ];
  if (statements.length) await db.batch(statements);
}

export async function loadLatestSignals(db: D1Database): Promise<LiveSignal[]> {
  const result = await db.prepare(
    `SELECT s.* FROM signal_snapshots s
     INNER JOIN (
       SELECT symbol, MAX(created_at) AS created_at FROM signal_snapshots GROUP BY symbol
     ) latest ON latest.symbol = s.symbol AND latest.created_at = s.created_at
     ORDER BY s.symbol`,
  ).all<{
    symbol: PaperSymbol;
    side: "BUY" | "SELL";
    direction: string;
    confidence: number;
    horizon: string;
    invalidation: string;
    factors_json: string;
    rationale: string;
    created_at: string;
  }>();
  return result.results.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    direction: row.direction,
    confidence: row.confidence,
    horizon: row.horizon,
    invalidation: row.invalidation,
    factors: JSON.parse(row.factors_json),
    modelNote: row.rationale,
    rationale: row.rationale,
    createdAt: row.created_at,
  }));
}

export async function loadRecentEvents(db: D1Database, limit = 20): Promise<IntelligenceEvent[]> {
  const result = await db.prepare(
    `SELECT id, source, asset, bias, headline, detail, evidence_score,
      source_url, occurred_at FROM feed_events ORDER BY occurred_at DESC LIMIT ?`,
  ).bind(limit).all<{
    id: string;
    source: IntelligenceEvent["source"];
    asset: IntelligenceEvent["asset"];
    bias: IntelligenceEvent["bias"];
    headline: string;
    detail: string;
    evidence_score: number;
    source_url: string | null;
    occurred_at: string;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    source: row.source,
    asset: row.asset,
    bias: row.bias,
    headline: row.headline,
    detail: row.detail,
    score: row.evidence_score,
    url: row.source_url,
    occurredAt: row.occurred_at,
  }));
}

export async function createAlert(db: D1Database, alert: AlertRecord) {
  await db.prepare(
    `INSERT OR IGNORE INTO alerts
      (id, user_id, kind, severity, title, body, source_url, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    alert.id,
    alert.userId,
    alert.kind,
    alert.severity,
    alert.title,
    alert.body,
    alert.sourceUrl,
    alert.readAt,
    alert.createdAt,
  ).run();
}

export async function loadAlerts(db: D1Database, userId: string, limit = 20): Promise<AlertRecord[]> {
  const result = await db.prepare(
    `SELECT id, user_id, kind, severity, title, body, source_url, read_at, created_at
     FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).bind(userId, limit).all<{
    id: string;
    user_id: AlertRecord["userId"];
    kind: string;
    severity: AlertRecord["severity"];
    title: string;
    body: string;
    source_url: string | null;
    read_at: string | null;
    created_at: string;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    body: row.body,
    sourceUrl: row.source_url,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export async function markAlertsRead(db: D1Database, userId: string) {
  await db.prepare("UPDATE alerts SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
    .bind(new Date().toISOString(), userId).run();
}

export async function getSetting(db: D1Database, key: string, fallback: string) {
  const row = await db.prepare("SELECT value FROM runtime_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? fallback;
}

export async function setSettings(db: D1Database, entries: Record<string, string>) {
  const now = new Date().toISOString();
  await db.batch(
    Object.entries(entries).map(([key, value]) =>
      db.prepare(
        `INSERT INTO runtime_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(key, value, now),
    ),
  );
}

export async function savePortfolioSnapshot(
  db: D1Database,
  accountId: string,
  snapshot: {
    equity: number;
    cash: number;
    marketValue: number;
    realizedPnl: number;
    unrealizedPnl: number;
    btcPrice: number;
    capturedAt: string;
  },
) {
  await db.prepare(
    `INSERT OR IGNORE INTO portfolio_snapshots
      (id, account_id, equity, cash, market_value, realized_pnl, unrealized_pnl, btc_price, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `${accountId}:${snapshot.capturedAt}`,
    accountId,
    snapshot.equity,
    snapshot.cash,
    snapshot.marketValue,
    snapshot.realizedPnl,
    snapshot.unrealizedPnl,
    snapshot.btcPrice,
    snapshot.capturedAt,
  ).run();
}

export async function getPortfolioHistory(db: D1Database, accountId: string) {
  const result = await db.prepare(
    `SELECT equity, btc_price, captured_at FROM portfolio_snapshots
     WHERE account_id = ? ORDER BY captured_at ASC LIMIT 5000`,
  ).bind(accountId).all<{ equity: number; btc_price: number; captured_at: string }>();
  return result.results;
}

export async function startAutomationRun(db: D1Database, id: string, startedAt: string) {
  await db.prepare(
    `INSERT OR IGNORE INTO automation_runs (id, status, started_at) VALUES (?, 'running', ?)`,
  ).bind(id, startedAt).run();
}

export async function finishAutomationRun(
  db: D1Database,
  id: string,
  result: { status: "succeeded" | "failed"; signals: number; events: number; tradeId?: string; error?: string },
) {
  await db.prepare(
    `UPDATE automation_runs SET status = ?, signals_created = ?, events_created = ?,
      paper_trade_id = ?, error_message = ?, finished_at = ? WHERE id = ?`,
  ).bind(
    result.status,
    result.signals,
    result.events,
    result.tradeId ?? null,
    result.error ?? null,
    new Date().toISOString(),
    id,
  ).run();
}

export async function latestAutomationRun(db: D1Database) {
  const row = await db.prepare(
    `SELECT status, signals_created, events_created, paper_trade_id,
      error_message, started_at, finished_at
     FROM automation_runs ORDER BY started_at DESC LIMIT 1`,
  ).first<{
    status: "running" | "succeeded" | "failed";
    signals_created: number;
    events_created: number;
    paper_trade_id: string | null;
    error_message: string | null;
    started_at: string;
    finished_at: string | null;
  }>();
  return row ? {
    id: `run:${Math.floor(new Date(row.started_at).getTime() / 900_000)}`,
    status: row.status,
    signals: row.signals_created,
    events: row.events_created,
    tradeId: row.paper_trade_id,
    error: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  } : null;
}
