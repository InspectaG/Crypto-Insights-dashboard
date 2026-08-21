import {
  executePaperTrade,
  portfolioSnapshot,
  type PaperPrices,
  type PaperSide,
  type PaperSymbol,
} from "../lib/paper-trading";
import { minimumConfidenceForRisk } from "../lib/risk-controls";
import { runAutomation } from "./automation";
import { getCoinbaseStatus } from "./coinbase";
import { fetchMarketData } from "./intelligence";
import { buildPerformance } from "./performance";
import {
  createAlert,
  depositPaperFunds,
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
import type { AppUser } from "./types";
import { appUsers, unauthorized, userForRequest } from "./access";

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

async function controlPlane(env: WorkerEnv, user: AppUser) {
  await ensureDatabase(env.DB);
  let signals = await loadLatestSignals(env.DB);
  if (!signals.length) {
    await runAutomation(env);
    signals = await loadLatestSignals(env.DB);
  }
  const market = await fetchMarketData();
  const prices = pricesFromMarket(market);
  const account = await loadPaperAccount(env.DB, user.accountId);
  const [events, alerts, automation, coinbase, autoPaperEnabled, performance] = await Promise.all([
    loadRecentEvents(env.DB),
    loadAlerts(env.DB, user.id),
    latestAutomationRun(env.DB),
    getCoinbaseStatus(env, user.id),
    getSetting(env.DB, `auto_paper_enabled:${user.id}`, "true"),
    buildPerformance(env.DB, user.accountId, account, prices),
  ]);
  const comparison = await Promise.all(appUsers.map(async (profile) => {
    const profileAccount = profile.id === user.id ? account : await loadPaperAccount(env.DB, profile.accountId);
    const profilePerformance = profile.id === user.id
      ? performance
      : await buildPerformance(env.DB, profile.accountId, profileAccount, prices);
    return {
      id: profile.id,
      displayName: profile.displayName,
      isViewer: profile.id === user.id,
      equity: profilePerformance.equity,
      totalPnl: profilePerformance.totalPnl,
      returnPct: profilePerformance.returnPct,
      realizedPnl: profilePerformance.realizedPnl,
      maxDrawdownPct: profilePerformance.maxDrawdownPct,
      closedTrades: profilePerformance.closedTrades,
      winRate: profilePerformance.winRate,
      riskLevel: profileAccount.riskLevel,
      dailyLimit: profileAccount.dailyLimit,
    };
  }));
  return json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
    paperAccount: account,
    market,
    signals,
    events,
    alerts,
    performance,
    comparison,
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

async function manualPaperTrade(env: WorkerEnv, request: Request, user: AppUser) {
  const input = await body(request);
  const symbol = String(input.symbol ?? "") as PaperSymbol;
  const side = String(input.side ?? "") as PaperSide;
  if (!["BTC", "ETH", "SOL"].includes(symbol) || !["BUY", "SELL"].includes(side)) {
    return json({ error: "Invalid paper order" }, { status: 400 });
  }
  const [account, market, signals] = await Promise.all([
    loadPaperAccount(env.DB, user.accountId),
    fetchMarketData(),
    loadLatestSignals(env.DB),
  ]);
  const signal = signals.find((item) => item.symbol === symbol);
  if (!signal) return json({ error: "No current signal is available" }, { status: 409 });
  const prices = pricesFromMarket(market);
  const result = executePaperTrade(account, {
    symbol,
    side,
    grossValue: Math.min(1_000_000, Math.max(1, Number(input.grossValue ?? account.orderSize))),
    marketPrice: prices[symbol],
    confidence: signal.confidence,
    rationale: `${signal.rationale}${side !== signal.side ? " · manual counter-signal simulation" : " · manual simulation"}`,
    signalId: `manual:${user.id}:${symbol}:${side}:${Math.floor(Date.now() / 900_000)}`,
  });
  if (!result.ok) return json({ error: result.message, paperAccount: result.account }, { status: 409 });
  await savePaperAccount(env.DB, user.accountId, result.account, result.trade);
  const capturedAt = new Date().toISOString();
  const portfolio = portfolioSnapshot(result.account, prices);
  await Promise.all([
    savePortfolioSnapshot(env.DB, user.accountId, {
      equity: portfolio.equity,
      cash: result.account.cash,
      marketValue: portfolio.marketValue,
      realizedPnl: portfolio.realizedPnl,
      unrealizedPnl: portfolio.unrealizedPnl,
      btcPrice: prices.BTC,
      capturedAt,
    }),
    createAlert(env.DB, {
      id: `alert:${user.id}:manual:${result.trade.id}`,
      userId: user.id,
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
  const user = userForRequest(request);
  if (!user) return json({ error: "Forbidden" }, { status: 403 });
  await ensureDatabase(env.DB);

  try {
    if (request.method === "GET" && url.pathname === "/api/control-plane") {
      return controlPlane(env, user);
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
      return manualPaperTrade(env, request, user);
    }
    if (request.method === "POST" && url.pathname === "/api/paper/reset") {
      const input = await body(request);
      const startingBalance = Math.max(100, Math.min(10_000_000, Number(input.startingBalance ?? 10_000)));
      const dailyLimit = Math.max(1, Math.min(startingBalance, Number(input.dailyLimit ?? 1_000)));
      return json({ ok: true, paperAccount: await resetPaperAccount(env.DB, user.accountId, startingBalance, dailyLimit) });
    }
    if (request.method === "POST" && url.pathname === "/api/paper/deposit") {
      const input = await body(request);
      const amount = Math.max(1, Math.min(10_000_000, Number(input.amount ?? 0)));
      if (!Number.isFinite(amount)) return json({ error: "Invalid deposit amount" }, { status: 400 });
      return json({ ok: true, paperAccount: await depositPaperFunds(env.DB, user.accountId, amount) });
    }
    if (request.method === "PATCH" && url.pathname === "/api/paper/settings") {
      const input = await body(request);
      const account = await loadPaperAccount(env.DB, user.accountId);
      account.dailyLimit = Math.max(1, Math.min(10_000_000, Number(input.dailyLimit ?? account.dailyLimit)));
      account.orderSize = Math.max(1, Math.min(account.dailyLimit, Number(input.orderSize ?? account.orderSize)));
      account.riskLevel = Math.round(Math.max(0, Math.min(100, Number(input.riskLevel ?? account.riskLevel))));
      account.minimumConfidence = minimumConfidenceForRisk(account.riskLevel);
      await savePaperAccount(env.DB, user.accountId, account);
      if (typeof input.autoPaperEnabled === "boolean") {
        await setSettings(env.DB, { [`auto_paper_enabled:${user.id}`]: String(input.autoPaperEnabled) });
      }
      return json({ ok: true, paperAccount: account });
    }
    if (request.method === "POST" && url.pathname === "/api/automation/run") {
      const result = await runAutomation(env, new Date(Date.now() + 1));
      return json({ ok: true, capturedAt: result.capturedAt, tradeId: result.tradeId ?? null });
    }
    if (request.method === "POST" && url.pathname === "/api/alerts/read") {
      await markAlertsRead(env.DB, user.id);
      return json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/api/coinbase/status") {
      return json(await getCoinbaseStatus(env, user.id));
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
