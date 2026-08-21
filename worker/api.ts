import {
  executePaperTrade,
  portfolioSnapshot,
  type PaperPrices,
  type PaperSide,
  type PaperSymbol,
} from "../lib/paper-trading";
import { normalizePaperSettings, paperStartingCashSettingKey } from "../lib/paper-settings";
import { runAutomation } from "./automation";
import { getCoinbaseStatus, validateCoinbaseCredentials } from "./coinbase";
import {
  deleteCoinbaseCredentials,
  normalizeCoinbaseCredentials,
  saveCoinbaseCredentials,
} from "./coinbase-credentials";
import { fetchMarketData } from "./intelligence";
import { buildPerformance, buildSignalValidation } from "./performance";
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

function safeCredentialWrite(request: Request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
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
  const [events, alerts, automation, coinbase, autoPaperEnabled, paperStartingCash, performance, validation] = await Promise.all([
    loadRecentEvents(env.DB),
    loadAlerts(env.DB, user.id),
    latestAutomationRun(env.DB),
    getCoinbaseStatus(env, user.id),
    getSetting(env.DB, `auto_paper_enabled:${user.id}`, "true"),
    getSetting(env.DB, paperStartingCashSettingKey(user.id), String(account.startingBalance)),
    buildPerformance(env.DB, user.accountId, account, prices),
    buildSignalValidation(env.DB),
  ]);
  const savedStartingCash = normalizePaperSettings({ startingCash: paperStartingCash }, account).startingCash;
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
    validation,
    comparison,
    automation,
    settings: {
      autoPaperEnabled: autoPaperEnabled === "true",
      paperStartingCash: savedStartingCash,
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
      const paperAccount = await resetPaperAccount(env.DB, user.accountId, startingBalance, dailyLimit);
      await setSettings(env.DB, { [paperStartingCashSettingKey(user.id)]: String(startingBalance) });
      return json({ ok: true, paperAccount });
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
      const settings = normalizePaperSettings(input, account);
      account.dailyLimit = settings.dailyLimit;
      account.orderSize = settings.orderSize;
      account.riskLevel = settings.riskLevel;
      account.minimumConfidence = settings.minimumConfidence;
      await savePaperAccount(env.DB, user.accountId, account);
      const runtimeSettings: Record<string, string> = {
        [paperStartingCashSettingKey(user.id)]: String(settings.startingCash),
      };
      if (typeof input.autoPaperEnabled === "boolean") {
        runtimeSettings[`auto_paper_enabled:${user.id}`] = String(input.autoPaperEnabled);
      }
      await setSettings(env.DB, runtimeSettings);
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
    if (request.method === "GET" && url.pathname === "/api/coinbase/settings") {
      return json({
        user: { id: user.id, email: user.email, displayName: user.displayName },
        coinbase: await getCoinbaseStatus(env, user.id),
      });
    }
    if (request.method === "PUT" && url.pathname === "/api/coinbase/credentials") {
      if (!safeCredentialWrite(request)) return json({ error: "Invalid request origin" }, { status: 403 });
      if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
        return json({ error: "JSON request required" }, { status: 415 });
      }
      if (Number(request.headers.get("Content-Length") ?? 0) > 20_000) {
        return json({ error: "Credential payload is too large" }, { status: 413 });
      }
      if (!env.COINBASE_CREDENTIALS_ENCRYPTION_KEY) {
        return json({ error: "Secure credential storage is not configured" }, { status: 503 });
      }
      try {
        const credentials = normalizeCoinbaseCredentials(await body(request));
        await validateCoinbaseCredentials(user.displayName, credentials);
        await saveCoinbaseCredentials(
          env.DB,
          env.COINBASE_CREDENTIALS_ENCRYPTION_KEY,
          user.id,
          credentials,
        );
        return json({ ok: true, coinbase: await getCoinbaseStatus(env, user.id) });
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : "Coinbase validation failed" },
          { status: 400 },
        );
      }
    }
    if (request.method === "DELETE" && url.pathname === "/api/coinbase/credentials") {
      if (!safeCredentialWrite(request)) return json({ error: "Invalid request origin" }, { status: 403 });
      await deleteCoinbaseCredentials(env.DB, user.id);
      return json({ ok: true, coinbase: await getCoinbaseStatus(env, user.id) });
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
