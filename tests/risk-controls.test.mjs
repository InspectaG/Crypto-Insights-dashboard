import assert from "node:assert/strict";
import test from "node:test";

import { minimumConfidenceForRisk, riskLabel } from "../lib/risk-controls.ts";

test("risk control maps to bounded, explainable confidence thresholds", () => {
  assert.equal(minimumConfidenceForRisk(0), 80);
  assert.equal(minimumConfidenceForRisk(50), 65);
  assert.equal(minimumConfidenceForRisk(100), 50);
  assert.equal(minimumConfidenceForRisk(-100), 80);
  assert.equal(minimumConfidenceForRisk(900), 50);
  assert.equal(riskLabel(20), "Conservative");
  assert.equal(riskLabel(50), "Balanced");
  assert.equal(riskLabel(80), "Aggressive");
});
