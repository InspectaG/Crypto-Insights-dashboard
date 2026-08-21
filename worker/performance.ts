import { learningSummary, portfolioSnapshot, type PaperAccount, type PaperPrices } from "../lib/paper-trading";
import { summarizeSignalValidation } from "../lib/signal-validation";
import { getPaperCashFlows, getPortfolioHistory, getSignalEvaluations } from "./store";
import type { D1Database } from "./types";

export async function buildPerformance(db: D1Database, accountId: string, account: PaperAccount, prices: PaperPrices) {
  const portfolio = portfolioSnapshot(account, prices);
  const learning = learningSummary(account);
  const [history, cashFlows] = await Promise.all([
    getPortfolioHistory(db, accountId),
    getPaperCashFlows(db, accountId),
  ]);
  const deposits = cashFlows.filter((flow) => flow.kind === "deposit");
  const drawdownSeries = [
    ...history,
    { equity: portfolio.equity, btc_price: prices.BTC, captured_at: new Date().toISOString() },
  ];
  let performanceIndex = 100;
  let peak = performanceIndex;
  let maxDrawdownPct = 0;
  for (let index = 1; index < drawdownSeries.length; index += 1) {
    const previous = drawdownSeries[index - 1];
    const point = drawdownSeries[index];
    const externalCash = deposits
      .filter((flow) => flow.created_at > previous.captured_at && flow.created_at <= point.captured_at)
      .reduce((sum, flow) => sum + flow.amount, 0);
    if (previous.equity > 0) {
      performanceIndex *= Math.max(0, (point.equity - externalCash) / previous.equity);
    }
    peak = Math.max(peak, performanceIndex);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - performanceIndex) / peak) * 100);
  }
  const hasResetFlow = cashFlows.some((flow) => flow.kind === "reset");
  const baselineAmount = hasResetFlow
    ? 0
    : Math.max(0, account.startingBalance - deposits.reduce((sum, flow) => sum + flow.amount, 0));
  const benchmarkFlows = [
    ...(baselineAmount > 0 ? [{ amount: baselineAmount, created_at: account.createdAt }] : []),
    ...cashFlows,
  ];
  const buyHoldEquity = benchmarkFlows.reduce((total, flow) => {
    const flowPrice = history.find((point) => point.captured_at >= flow.created_at && point.btc_price > 0)?.btc_price
      ?? prices.BTC;
    return total + (flowPrice > 0 ? flow.amount * (prices.BTC / flowPrice) : flow.amount);
  }, 0) || account.startingBalance;
  const buyHoldReturnPct = account.startingBalance > 0
    ? ((buyHoldEquity - account.startingBalance) / account.startingBalance) * 100
    : 0;
  return {
    ...portfolio,
    ...learning,
    maxDrawdownPct,
    buyHoldEquity,
    buyHoldReturnPct,
    alphaVsBtcPct: portfolio.returnPct - buyHoldReturnPct,
    snapshots: history.length,
    executionCosts: account.trades.reduce((sum, trade) => sum + trade.executionDrag, 0),
    benchmarkContributions: benchmarkFlows.reduce((sum, flow) => sum + flow.amount, 0),
  };
}

export async function buildSignalValidation(db: D1Database) {
  return summarizeSignalValidation(await getSignalEvaluations(db));
}
