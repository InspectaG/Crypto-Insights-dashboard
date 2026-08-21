import assert from "node:assert/strict";
import test from "node:test";

import { buildSignals } from "../worker/intelligence.ts";

const market = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    price: 100_000,
    priceLabel: "$100,000",
    changePct: 4,
    changeLabel: "+4.00%",
    volumeUsd: 1_000_000,
    volumeLabel: "$1.0M vol",
    bias: "bullish",
    bars: [20, 40, 60],
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    price: 4_000,
    priceLabel: "$4,000",
    changePct: 2,
    changeLabel: "+2.00%",
    volumeUsd: 500_000,
    volumeLabel: "$0.5M vol",
    bias: "bullish",
    bars: [20, 40, 60],
  },
  {
    symbol: "SOL",
    name: "Solana",
    price: 200,
    priceLabel: "$200",
    changePct: -2,
    changeLabel: "−2.00%",
    volumeUsd: 250_000,
    volumeLabel: "$0.3M vol",
    bias: "bearish",
    bars: [60, 40, 20],
  },
];

function event(source, asset, bias) {
  return {
    id: `${source}:${asset}:${bias}`,
    source,
    asset,
    bias,
    headline: "Fixture evidence",
    detail: "Test source",
    score: 70,
    url: "https://example.com/evidence",
    occurredAt: "2026-08-21T12:00:00.000Z",
  };
}

test("live signal confidence requires corroboration before becoming actionable", () => {
  const marketOnly = buildSignals(market, []);
  assert.equal(marketOnly.find((signal) => signal.symbol === "BTC").direction, "WATCH");

  const corroborated = buildSignals(market, [
    event("NEWS", "BTC", "bullish"),
    event("SOCIAL", "BTC", "bullish"),
  ]);
  const btc = corroborated.find((signal) => signal.symbol === "BTC");
  assert.equal(btc.side, "BUY");
  assert.ok(btc.confidence >= 75);
  assert.notEqual(btc.direction, "WATCH");
});
