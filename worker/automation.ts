import {
  executePaperTrade,
  portfolioSnapshot,
  todayBuySpend,
  type PaperPrices,
} from "../lib/paper-trading";
import { buildSignals, fetchIntelligence } from "./intelligence";
import { fetchMarketData } from "./market";
import {
  createAlert,
  ensureDatabase,
  evaluateMatureSignals,
  finishAutomationRun,
  getSetting,
  loadPaperAccount,
  saveIngestion,
  savePaperAccount,
  savePortfolioSnapshot,
  startAutomationRun,
} from "./store";
import type { AlertRecord, WorkerEnv } from "./types";
import { appUsers } from "./access";

function intervalId(now: Date) {
  return Math.floor(now.getTime() / 900_000);
}

async function sendOptionalWebhook(env: WorkerEnv, alert: AlertRecord) {
  if (!env.ALERT_WEBHOOK_URL) return;
  await fetch(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${alert.title}\n${alert.body}`,
      title: alert.title,
      body: alert.body,
      severity: alert.severity,
      source_url: alert.sourceUrl,
    }),
  });
}

export async function runAutomation(env: WorkerEnv, now = new Date()) {
  await ensureDatabase(env.DB);
  const windowId = intervalId(now);
  const runId = `run:${windowId}`;
  const capturedAt = now.toISOString();
  await startAutomationRun(env.DB, runId, capturedAt);

  try {
    const market = await fetchMarketData();
    const events = await fetchIntelligence(market);
    const signals = buildSignals(market, events);
    await saveIngestion(env.DB, market, events, signals, capturedAt);
    await evaluateMatureSignals(env.DB, capturedAt);

    const prices = Object.fromEntries(market.map((asset) => [asset.symbol, asset.price])) as PaperPrices;
    const tradeIds: string[] = [];
    const accounts = [];
    for (const user of appUsers) {
      let account = await loadPaperAccount(env.DB, user.accountId);
      const autoPaperEnabled = (await getSetting(env.DB, `auto_paper_enabled:${user.id}`, "true")) === "true";
      let tradeId: string | undefined;

      if (autoPaperEnabled) {
        const candidates = signals
          .filter((signal) => signal.confidence >= account.minimumConfidence && signal.direction !== "WATCH")
          .sort((left, right) => right.confidence - left.confidence);
        for (const signal of candidates) {
          if (signal.side === "SELL" && account.positions[signal.symbol].quantity <= 0) continue;
          const grossValue = signal.side === "BUY"
            ? Math.min(account.orderSize, Math.max(0, account.dailyLimit - todayBuySpend(account, now)), account.cash)
            : account.orderSize;
          if (grossValue < 0.01) continue;
          const result = executePaperTrade(
            account,
            {
              symbol: signal.symbol,
              side: signal.side,
              grossValue,
              marketPrice: prices[signal.symbol],
              confidence: signal.confidence,
              rationale: `Scheduled · ${signal.rationale}`,
              signalId: `auto:${user.id}:${windowId}:${signal.symbol}:${signal.side}`,
            },
            now,
          );
          if (result.ok) {
            account = result.account;
            tradeId = result.trade.id;
            tradeIds.push(tradeId);
            await savePaperAccount(env.DB, user.accountId, account, result.trade);
            const alert: AlertRecord = {
              id: `alert:${user.id}:trade:${result.trade.id}`,
              userId: user.id,
              kind: "paper_trade",
              severity: "action",
              title: `Paper ${result.trade.side.toLowerCase()} simulated for ${result.trade.symbol}`,
              body: `$${result.trade.grossValue.toFixed(2)} at ${signal.confidence}% confidence. Your risk, cash, holdings, and daily-buy limit were enforced.`,
              sourceUrl: null,
              readAt: null,
              createdAt: capturedAt,
            };
            await createAlert(env.DB, alert);
            await sendOptionalWebhook(env, alert).catch(() => undefined);
            break;
          }
        }
      }

      for (const signal of signals.filter((item) => item.confidence >= 75)) {
        await createAlert(env.DB, {
          id: `alert:${user.id}:signal:${windowId}:${signal.symbol}`,
          userId: user.id,
          kind: "high_confidence_signal",
          severity: "watch",
          title: `${signal.symbol} ${signal.direction.toLowerCase()} signal`,
          body: `${signal.confidence}% confidence · ${signal.modelNote}`,
          sourceUrl: null,
          readAt: null,
          createdAt: capturedAt,
        });
      }

      const snapshot = portfolioSnapshot(account, prices);
      await savePortfolioSnapshot(env.DB, user.accountId, {
        equity: snapshot.equity,
        cash: account.cash,
        marketValue: snapshot.marketValue,
        realizedPnl: snapshot.realizedPnl,
        unrealizedPnl: snapshot.unrealizedPnl,
        btcPrice: prices.BTC,
        capturedAt,
      });
      accounts.push({ userId: user.id, account, tradeId, autoPaperEnabled });
    }
    await finishAutomationRun(env.DB, runId, {
      status: "succeeded",
      signals: signals.length,
      events: events.length,
      tradeId: tradeIds.join(",") || undefined,
    });
    return { market, events, signals, accounts, tradeId: tradeIds[0], tradeIds, capturedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown automation error";
    await finishAutomationRun(env.DB, runId, {
      status: "failed",
      signals: 0,
      events: 0,
      error: message.slice(0, 500),
    });
    await Promise.all(appUsers.map((user) => createAlert(env.DB, {
      id: `alert:${user.id}:automation:${runId}`,
      userId: user.id,
      kind: "automation_error",
      severity: "info",
      title: "Scheduled intelligence run needs attention",
      body: message.slice(0, 300),
      sourceUrl: null,
      readAt: null,
      createdAt: capturedAt,
    })));
    throw error;
  }
}
