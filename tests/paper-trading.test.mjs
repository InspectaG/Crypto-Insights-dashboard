import assert from "node:assert/strict";
import test from "node:test";

import {
  createPaperAccount,
  executePaperTrade,
  learningSummary,
  portfolioSnapshot,
  todayBuySpend,
} from "../lib/paper-trading.ts";

const start = new Date("2026-08-21T12:00:00.000Z");

function buy(account, overrides = {}) {
  return executePaperTrade(
    account,
    {
      symbol: "BTC",
      side: "BUY",
      grossValue: 250,
      marketPrice: 100_000,
      confidence: 78,
      rationale: "Test signal",
      signalId: `buy-${account.trades.length}`,
      ...overrides,
    },
    start,
  );
}

test("paper buys spend fake cash and enforce the daily limit", () => {
  const account = createPaperAccount(1_000, 300, start);
  const first = buy(account);
  assert.equal(first.ok, true);
  assert.equal(first.account.cash, 750);
  assert.equal(todayBuySpend(first.account, start), 250);

  const blocked = buy(first.account, { grossValue: 100 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /daily paper-buy limit reached/i);
  assert.equal(blocked.account.cash, 750);
});

test("paper sells realize outcomes after execution drag", () => {
  const account = createPaperAccount(1_000, 500, start);
  const opened = buy(account);
  assert.equal(opened.ok, true);

  const closed = executePaperTrade(
    opened.account,
    {
      symbol: "BTC",
      side: "SELL",
      grossValue: 400,
      marketPrice: 120_000,
      confidence: 78,
      rationale: "Exit test",
      signalId: "sell-1",
    },
    new Date("2026-08-21T12:16:00.000Z"),
  );

  assert.equal(closed.ok, true);
  assert.ok(closed.trade.realizedPnl > 0);
  assert.equal(closed.account.positions.BTC.quantity, 0);
  assert.ok(closed.account.cash > account.cash);

  const snapshot = portfolioSnapshot(closed.account, {
    BTC: 120_000,
    ETH: 4_000,
    SOL: 180,
  });
  assert.ok(snapshot.totalPnl > 0);
  assert.equal(learningSummary(closed.account).wins, 1);
});

test("confidence and duplicate-signal guardrails reject unsafe simulations", () => {
  const account = createPaperAccount(1_000, 500, start);
  const lowConfidence = buy(account, { confidence: 50 });
  assert.equal(lowConfidence.ok, false);
  assert.match(lowConfidence.message, /below the 65% paper threshold/i);

  const first = buy(account, { signalId: "same-signal" });
  assert.equal(first.ok, true);
  const duplicate = buy(first.account, { signalId: "same-signal" });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message, /already paper-traded/i);
});
