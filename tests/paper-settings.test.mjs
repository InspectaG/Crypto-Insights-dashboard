import assert from "node:assert/strict";
import test from "node:test";

import { createPaperAccount } from "../lib/paper-trading.ts";
import {
  normalizePaperSettings,
  paperStartingCashSettingKey,
} from "../lib/paper-settings.ts";
import { minimumConfidenceForRisk } from "../lib/risk-controls.ts";

test("paper preferences normalize to durable, safe per-user values", () => {
  const account = createPaperAccount();
  const settings = normalizePaperSettings({
    startingCash: 25_000,
    dailyLimit: 125,
    orderSize: 50,
    riskLevel: 72,
  }, account);

  assert.deepEqual(settings, {
    startingCash: 25_000,
    dailyLimit: 125,
    orderSize: 50,
    riskLevel: 72,
    minimumConfidence: minimumConfidenceForRisk(72),
  });
});

test("paper preferences reject non-finite values and enforce guardrails", () => {
  const account = createPaperAccount(10_000, 1_000);
  const settings = normalizePaperSettings({
    startingCash: "not-a-number",
    dailyLimit: 0,
    orderSize: 900,
    riskLevel: 500,
  }, account);

  assert.equal(settings.startingCash, 10_000);
  assert.equal(settings.dailyLimit, 1);
  assert.equal(settings.orderSize, 1);
  assert.equal(settings.riskLevel, 100);
  assert.equal(settings.minimumConfidence, minimumConfidenceForRisk(100));
});

test("starting-cash presets are isolated by signed-in user", () => {
  assert.equal(paperStartingCashSettingKey("justin"), "paper_starting_cash:justin");
  assert.equal(paperStartingCashSettingKey("gatcho"), "paper_starting_cash:gatcho");
  assert.notEqual(paperStartingCashSettingKey("justin"), paperStartingCashSettingKey("gatcho"));
});
