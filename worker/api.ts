import {
  executePaperTrade,
  portfolioSnapshot,
  type PaperPrices,
  type PaperSide,
  type PaperSymbol,
} from "../lib/paper-trading";
import { runAutomation } from "./automation";
import { getCoinbaseStatus } from "./coinbase";
import { fetchMarketData } from "./intelligence";
import { buildPerformance } from "./performance";
import {
  createAlert,
  ensureDatabase,
  getSetting,
  latestAutomationRun,
  loadAlerts,
  loadLatestSignals,
  loadPaperAccount,
  loadRecentEvents,
  markAlertsRead,
  resetPaperAccount,
  savePaperAccount,
  savePortfolioSnapshot,
  setSettings,
} from "./store";
import type { WorkerEnv } from "./types";
import { emailForRequest, unauthorized } from "./access";

function json(value: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function body(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function pricesFromMarket(market: Awaited<ReturnType<typeof fetchMarketData>>) {
  return Object.fromEntries(market.map((asset) => [asset.symbol, asset.price])) as PaperPrices;
}

async function controlPlane(env: WorkerEnv, request: Request) {
  await ensureDatabase(env.DB);
  let signals = await loadLatestSignals(env.DB);
  if (!signals.length) {
    await runAutomation(env);
    signals = await loadLatestSignals(env.DB);
  }
  const market = await fetchMarketData();
  const prices = pricesFromMarket(market);
  const account = await loadPaperAccount(env.DB);
  const [events, alerts, automation, coinbase, autoPaperEnabled, performance] = await Promise.all([
    loadRecentEvents(env.DB),
    loadAlerts(env.DB),
    latestAutomationRun(env.DB),
    getCoinbaseStatus(env),
    getSetting(env.DB, "auto_paper_enabled", "true"),
    buildPerformance(env.DB, account, prices),
  ]);
  return json({
    user: { email: emailForRequest(request) },
    paperAccount: account,
    market,
    signals,
    events,
    alerts,
    performance,
    automation,
    settings: {
      autoPaperEnabled: autoPaperEnabled === "true",
      realTradingEnabled: false,
      realTradingKillSwitch: true,
      realDailyLimit: 0,
    },
    coinbase,
    generatedAt: new Date().toISOString(),
  });
}

async function manualPaperTrade(env: WorkerEnv, request: Request) {
  const input = await body(request);
  const symbol = String(input.symbol ?? "") as PaperSymbol;
  const side = String(input.side ?? "") as PaperSide;
  if (!["BTC", "ETH", "SOL"].includes(symbol) || !["BUY", "SELL"].includes(side)) {
    return json({ error: "Invalid paper order" }, { status: 400 });
  }
  const [account, market, signals] = await Promise.all([
    loadPaperAccount(env.DB),
    fetchMarketData(),
    loadLatestSignals(env.DB),
  ]);
  const signal = signals.find((item) => item.symbol === symbol);
  if (!signal) return json({ error: "No current signal is available" }, { status: 409 });
  const prices = pricesFromMarket(market);
  const result = executePaperTrade(account, {
    symbol,
    side,
    grossValue: Math.min(account.orderSize, Number(input.grossValue ?? account.orderSize)),
    marketPrice: prices[symbol],
    confidence: signal.confidence,
    rationale: `${signal.rationale}${side !== signal.side ? " · manual counter-signal simulation" : " · manual simulation"}`,
  });
  if (!result.ok) return json({ error: result.message, paperAccount: result.account }, { status: 409 });
  await savePaperAccount(env.DB, result.account, result.trade);
  const capturedAt = new Date().toISOString();
  const portfolio = portfolioSnapshot(result.account, prices);
  await Promise.all([
    savePortfolioSnapshot(env.DB, {
      equity: portfolio.equity,
      cash: result.account.cash,
      marketValue: portfolio.marketValue,
      realizedPnl: portfolio.realizedPnl,
      unrealizedPnl: portfolio.unrealizedPnl,
      btcPrice: prices.BTC,
      capturedAt,
    }),
    createAlert(env.DB, {
      id: `alert:manual:${result.trade.id}`,
      kind: "paper_trade",
      severity: "action",
      title: `Manual paper ${side.toLowerCase()} for ${symbol}`,
      body: `$${result.trade.grossValue.toFixed(2)} simulated at ${signal.confidence}% confidence.`,
      sourceUrl: null,
      readAt: null,
      createdAt: capturedAt,
    }),
  ]);
  return json({ ok: true, paperAccount: result.account, trade: result.trade });
}

export async function handleApi(request: Request, env: WorkerEnv) {
  const url = new URL(request.url);
  if (unauthorized(request)) return json({ error: "Forbidden" }, { status: 403 });
  await ensureDatabase(env.DB);

  try {
    if (request.method === "GET" && url.pathname === "/api/control-plane") {
      return controlPlane(env, request);
    }
    if (request.method === "GET" && url.pathname === "/api/market") {
      const market = await fetchMarketData();
      return json({
        assets: market.map((asset) => ({
          symbol: asset.symbol,
          name: asset.name,
          price: asset.priceLabel,
          change: asset.changeLabel,
          volume: asset.volumeLabel,
          bias: asset.bias,
          bars: asset.bars,
        })),
        source: "Coinbase Exchange",
        asOf: new Date().toISOString(),
      }, { headers: { "Cache-Control": "private, max-age=30" } });
    }
    if (request.method === "POST" && url.pathname === "/api/paper/trade") {
      return manualPaperTrade(env, request);
    }
    if (request.method === "POST" && url.pathname === "/api/paper/reset") {
      const input = await body(request);
      const startingBalance = Math.max(100, Math.min(10_000_000, Number(input.startingBalance ?? 10_000)));
      const dailyLimit = Math.max(1, Math.min(startingBalance, Number(input.dailyLimit ?? 1_000)));
      return json({ ok: true, paperAccount: await resetPaperAccount(env.DB, startingBalance, dailyLimit) });
    }
    if (request.method === "PATCH" && url.pathname === "/api/paper/settings") {
      const input = await body(request);
      const account = await loadPaperAccount(env.DB);
      account.orderSize = Math.max(1, Math.min(account.dailyLimit, Number(input.orderSize ?? account.orderSize)));
      account.minimumConfidence = Math.round(Math.max(0, Math.min(100, Number(input.minimumConfidence ?? account.minimumConfidence))));
      await savePaperAccount(env.DB, account);
      if (typeof input.autoPaperEnabled === "boolean") {
        await setSettings(env.DB, { auto_paper_enabled: String(input.autoPaperEnabled) });
      }
      return json({ ok: true, paperAccount: account });
    }
    if (request.method === "POST" && url.pathname === "/api/automation/run") {
      const result = await runAutomation(env, new Date(Date.now() + 1));
      return json({ ok: true, capturedAt: result.capturedAt, tradeId: result.tradeId ?? null });
    }
    if (request.method === "POST" && url.pathname === "/api/alerts/read") {
      await markAlertsRead(env.DB);
      return json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/api/coinbase/status") {
      return json(await getCoinbaseStatus(env));
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true, database: "connected", realTradingEnabled: false });
    }
    return json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      { status: 500 },
    );
  }
}
