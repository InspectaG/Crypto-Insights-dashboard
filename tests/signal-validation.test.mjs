import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreSignalOutcome,
  summarizeSignalValidation,
} from "../lib/signal-validation.ts";

function outcome(overrides = {}) {
  return scoreSignalOutcome({
    signalId: "signal-1",
    symbol: "BTC",
    side: "BUY",
    confidence: 78,
    horizonHours: 24,
    entryPrice: 100,
    exitPrice: 102,
    signalCreatedAt: "2026-08-20T12:00:00.000Z",
    evaluatedAt: "2026-08-21T12:00:00.000Z",
    ...overrides,
  });
}

test("scores buy and sell signals after round-trip execution costs", () => {
  const buy = outcome();
  assert.equal(buy.correct, true);
  assert.equal(buy.rawReturnPct, 2);
  assert.equal(buy.netReturnPct, 1.4);

  const sell = outcome({ side: "SELL", exitPrice: 98 });
  assert.equal(sell.correct, true);
  assert.equal(sell.rawReturnPct, 2);
  assert.equal(sell.netReturnPct, 1.4);

  const tooSmall = outcome({ exitPrice: 100.5 });
  assert.equal(tooSmall.correct, false);
  assert.ok(tooSmall.netReturnPct < 0);
});

test("keeps calibration observational until the mature-sample gates are met", () => {
  const collecting = summarizeSignalValidation([
    outcome({ signalId: "four-hour", horizonHours: 4 }),
    outcome({ signalId: "twenty-four-hour", horizonHours: 24 }),
  ], new Date("2026-08-22T12:00:00.000Z"));
  assert.equal(collecting.readiness, "collecting");
  assert.equal(collecting.primarySample, 1);
  assert.equal(collecting.horizons.find((item) => item.hours === 4).sample, 1);

  const mature = Array.from({ length: 100 }, (_, index) => outcome({
    signalId: `signal-${index}`,
    confidence: index < 30 ? 80 : 68,
  }));
  const reviewReady = summarizeSignalValidation(mature);
  assert.equal(reviewReady.readiness, "review_ready");
  assert.equal(reviewReady.highConfidenceSample, 30);
  assert.equal(reviewReady.bands.find((band) => band.key === "high").hitRate, 100);
});
