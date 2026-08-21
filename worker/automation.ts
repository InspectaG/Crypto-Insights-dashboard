import {
  executePaperTrade,
  portfolioSnapshot,
  type PaperPrices,
} from "../lib/paper-trading";
import { buildSignals, fetchIntelligence, fetchMarketData } from "./intelligence";
import {
  createAlert,
  ensureDatabase,
  finishAutomationRun,
  getSetting,
  loadPaperAccount,
  saveIngestion,
  savePaperAccount,
  savePortfolioSnapshot,
  startAutomationRun,
} from "./store";
import type { AlertRecord, WorkerEnv } from "./types";

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

    const prices = Object.fromEntries(market.map((asset) => [asset.symbol, asset.price])) as PaperPrices;
    let account = await loadPaperAccount(env.DB);
    const autoPaperEnabled = (await getSetting(env.DB, "auto_paper_enabled", "true")) === "true";
    let tradeId: string | undefined;

    if (autoPaperEnabled) {
      const candidates = signals
        .filter((signal) => signal.confidence >= account.minimumConfidence && signal.direction !== "WATCH")
        .sort((left, right) => right.confidence - left.confidence);
      for (const signal of candidates) {
        if (signal.side === "SELL" && account.positions[signal.symbol].quantity <= 0) continue;
        const result = executePaperTrade(
          account,
          {
            symbol: signal.symbol,
            side: signal.side,
            grossValue: account.orderSize,
            marketPrice: prices[signal.symbol],
            confidence: signal.confidence,
            rationale: `Scheduled · ${signal.rationale}`,
            signalId: `auto:${windowId}:${signal.symbol}:${signal.side}`,
          },
          now,
        );
        if (result.ok) {
          account = result.account;
          tradeId = result.trade.id;
          await savePaperAccount(env.DB, account, result.trade);
          const alert: AlertRecord = {
            id: `alert:trade:${result.trade.id}`,
            kind: "paper_trade",
            severity: "action",
            title: `Paper ${result.trade.side.toLowerCase()} simulated for ${result.trade.symbol}`,
            body: `$${result.trade.grossValue.toFixed(2)} at ${signal.confidence}% confidence. Daily and cash limits were enforced.`,
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
      const alert: AlertRecord = {
        id: `alert:signal:${windowId}:${signal.symbol}`,
        kind: "high_confidence_signal",
        severity: "watch",
        title: `${signal.symbol} ${signal.direction.toLowerCase()} signal`,
        body: `${signal.confidence}% confidence · ${signal.modelNote}`,
        sourceUrl: null,
        readAt: null,
        createdAt: capturedAt,
      };
      await createAlert(env.DB, alert);
    }

    const snapshot = portfolioSnapshot(account, prices);
    await savePortfolioSnapshot(env.DB, {
      equity: snapshot.equity,
      cash: account.cash,
      marketValue: snapshot.marketValue,
      realizedPnl: snapshot.realizedPnl,
      unrealizedPnl: snapshot.unrealizedPnl,
      btcPrice: prices.BTC,
      capturedAt,
    });
    await finishAutomationRun(env.DB, runId, {
      status: "succeeded",
      signals: signals.length,
      events: events.length,
      tradeId,
    });
    return { market, events, signals, account, tradeId, capturedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown automation error";
    await finishAutomationRun(env.DB, runId, {
      status: "failed",
      signals: 0,
      events: 0,
      error: message.slice(0, 500),
    });
    await createAlert(env.DB, {
      id: `alert:automation:${runId}`,
      kind: "automation_error",
      severity: "info",
      title: "Scheduled intelligence run needs attention",
      body: message.slice(0, 300),
      sourceUrl: null,
      readAt: null,
      createdAt: capturedAt,
    });
    throw error;
  }
}
