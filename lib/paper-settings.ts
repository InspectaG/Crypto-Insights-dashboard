import type { PaperAccount } from "./paper-trading.ts";
import { minimumConfidenceForRisk } from "./risk-controls.ts";

export type PaperSettingsDraft = {
  startingCash: number;
  dailyLimit: number;
  orderSize: number;
  riskLevel: number;
  autoPaperEnabled: boolean;
};

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function paperStartingCashSettingKey(userId: string) {
  return `paper_starting_cash:${userId}`;
}

export function normalizePaperSettings(
  input: Record<string, unknown>,
  account: PaperAccount,
) {
  const dailyLimit = boundedNumber(input.dailyLimit, account.dailyLimit, 1, 10_000_000);
  const orderSize = boundedNumber(input.orderSize, account.orderSize, 1, dailyLimit);
  const riskLevel = Math.round(boundedNumber(input.riskLevel, account.riskLevel, 0, 100));
  const startingCash = boundedNumber(input.startingCash, account.startingBalance, 100, 10_000_000);

  return {
    startingCash,
    dailyLimit,
    orderSize,
    riskLevel,
    minimumConfidence: minimumConfidenceForRisk(riskLevel),
  };
}
