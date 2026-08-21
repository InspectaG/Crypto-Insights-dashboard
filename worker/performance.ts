import { learningSummary, portfolioSnapshot, type PaperAccount, type PaperPrices } from "../lib/paper-trading";
import { getPortfolioHistory } from "./store";
import type { D1Database } from "./types";

export async function buildPerformance(db: D1Database, accountId: string, account: PaperAccount, prices: PaperPrices) {
  const portfolio = portfolioSnapshot(account, prices);
  const learning = learningSummary(account);
  const history = await getPortfolioHistory(db, accountId);
  let peak = account.startingBalance;
  let maxDrawdownPct = 0;
  for (const point of history) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }
  const firstBtcPrice = history.find((point) => point.btc_price > 0)?.btc_price ?? prices.BTC;
  const buyHoldEquity = firstBtcPrice > 0
    ? account.startingBalance * (prices.BTC / firstBtcPrice)
    : account.startingBalance;
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
  };
}
