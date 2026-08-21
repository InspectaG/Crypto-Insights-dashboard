import assert from "node:assert/strict";
import test from "node:test";

import { fetchMarketData } from "../worker/market.ts";

function marketResponse(url, { inconsistent = false } = {}) {
  const symbol = url.match(/products\/(BTC|ETH|SOL)-USD/)?.[1];
  const values = {
    BTC: { price: 117_245.67, open: 115_000, volume: 8_000 },
    ETH: { price: 4_315.42, open: 4_200, volume: 120_000 },
    SOL: { price: 191.38, open: 188, volume: 1_500_000 },
  }[symbol];
  if (!values) return new Response("Not found", { status: 404 });

  if (url.endsWith("/ticker")) {
    return Response.json({
      price: String(values.price),
      bid: String(values.price - 0.1),
      ask: String(values.price + 0.1),
      time: new Date().toISOString(),
    });
  }

  return Response.json({
    open: String(values.open),
    volume: String(values.volume),
    last: String(inconsistent ? values.price * 1.2 : values.price),
  });
}

test("uses validated Coinbase ticker prices with visible provenance and cents", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    return marketResponse(url);
  };

  try {
    const market = await fetchMarketData();
    assert.deepEqual(market.map((asset) => asset.symbol), ["BTC", "ETH", "SOL"]);
    assert.equal(market[0].price, 117_245.67);
    assert.equal(market[0].priceLabel, "$117,245.67");
    assert.equal(market[0].source, "Coinbase Exchange");
    assert.equal(market[0].status, "live");
    assert.equal(requests.length, 6);
    assert.ok(requests.every(({ init }) => init.cache === "no-store"));
    assert.ok(requests.every(({ init }) => init.headers["Cache-Control"] === "no-cache"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a quote when ticker and 24-hour statistics materially disagree", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => marketResponse(String(input), { inconsistent: true });

  try {
    await assert.rejects(fetchMarketData(), /inconsistent BTC quote/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
