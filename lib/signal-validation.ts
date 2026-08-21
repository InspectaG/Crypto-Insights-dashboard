import type { PaperSide, PaperSymbol } from "./paper-trading";

export const validationHorizons = [4, 24] as const;
export const validationRoundTripCostBps = 60;
export const validationSampleTarget = 100;
export const validationHighConfidenceTarget = 30;

export type SignalEvaluation = {
  signalId: string;
  symbol: PaperSymbol;
  side: PaperSide;
  confidence: number;
  horizonHours: (typeof validationHorizons)[number];
  entryPrice: number;
  exitPrice: number;
  rawReturnPct: number;
  netReturnPct: number;
  correct: boolean;
  signalCreatedAt: string;
  evaluatedAt: string;
};

export type ValidationBand = {
  key: "low" | "moderate" | "high";
  label: string;
  range: string;
  sample: number;
  averageConfidence: number;
  hitRate: number;
  averageNetReturnPct: number;
};

function round(value: number, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function scoreSignalOutcome(input: {
  signalId: string;
  symbol: PaperSymbol;
  side: PaperSide;
  confidence: number;
  horizonHours: (typeof validationHorizons)[number];
  entryPrice: number;
  exitPrice: number;
  signalCreatedAt: string;
  evaluatedAt: string;
  roundTripCostBps?: number;
}): SignalEvaluation {
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    throw new Error("Signal validation requires a positive entry price");
  }
  if (!Number.isFinite(input.exitPrice) || input.exitPrice <= 0) {
    throw new Error("Signal validation requires a positive exit price");
  }
  const marketReturnPct = ((input.exitPrice - input.entryPrice) / input.entryPrice) * 100;
  const directionalReturnPct = input.side === "BUY" ? marketReturnPct : -marketReturnPct;
  const roundTripCostPct = (input.roundTripCostBps ?? validationRoundTripCostBps) / 100;
  const netReturnPct = directionalReturnPct - roundTripCostPct;
  return {
    signalId: input.signalId,
    symbol: input.symbol,
    side: input.side,
    confidence: input.confidence,
    horizonHours: input.horizonHours,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    rawReturnPct: round(directionalReturnPct),
    netReturnPct: round(netReturnPct),
    correct: netReturnPct > 0,
    signalCreatedAt: input.signalCreatedAt,
    evaluatedAt: input.evaluatedAt,
  };
}

function rate(records: SignalEvaluation[]) {
  if (!records.length) return 0;
  return (records.filter((record) => record.correct).length / records.length) * 100;
}

function average(records: SignalEvaluation[], select: (record: SignalEvaluation) => number) {
  if (!records.length) return 0;
  return records.reduce((sum, record) => sum + select(record), 0) / records.length;
}

function bandSummary(
  records: SignalEvaluation[],
  key: ValidationBand["key"],
  label: string,
  range: string,
  matches: (confidence: number) => boolean,
): ValidationBand {
  const matching = records.filter((record) => matches(record.confidence));
  return {
    key,
    label,
    range,
    sample: matching.length,
    averageConfidence: average(matching, (record) => record.confidence),
    hitRate: rate(matching),
    averageNetReturnPct: average(matching, (record) => record.netReturnPct),
  };
}

export function summarizeSignalValidation(records: SignalEvaluation[], now = new Date()) {
  const fourHour = records.filter((record) => record.horizonHours === 4);
  const twentyFourHour = records.filter((record) => record.horizonHours === 24);
  const primary = twentyFourHour;
  const bands = [
    bandSummary(primary, "low", "Low", "0–59", (confidence) => confidence < 60),
    bandSummary(primary, "moderate", "Moderate", "60–74", (confidence) => confidence >= 60 && confidence < 75),
    bandSummary(primary, "high", "High", "75–100", (confidence) => confidence >= 75),
  ];
  const highConfidenceSample = bands.find((band) => band.key === "high")?.sample ?? 0;
  const primarySample = primary.length;
  const createdTimes = records
    .map((record) => new Date(record.signalCreatedAt).getTime())
    .filter(Number.isFinite);
  const earliest = createdTimes.length ? Math.min(...createdTimes) : null;
  const lastEvaluatedAt = records
    .map((record) => record.evaluatedAt)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

  return {
    readiness:
      primarySample >= validationSampleTarget && highConfidenceSample >= validationHighConfidenceTarget
        ? "review_ready" as const
        : "collecting" as const,
    sampleTarget: validationSampleTarget,
    highConfidenceTarget: validationHighConfidenceTarget,
    primarySample,
    highConfidenceSample,
    maturedSignals: new Set(records.map((record) => record.signalId)).size,
    maturedEvaluations: records.length,
    coverageDays: earliest === null ? 0 : Math.max(0, (now.getTime() - earliest) / 86_400_000),
    roundTripCostBps: validationRoundTripCostBps,
    lastEvaluatedAt,
    horizons: [
      {
        hours: 4,
        sample: fourHour.length,
        hitRate: rate(fourHour),
        averageNetReturnPct: average(fourHour, (record) => record.netReturnPct),
      },
      {
        hours: 24,
        sample: twentyFourHour.length,
        hitRate: rate(twentyFourHour),
        averageNetReturnPct: average(twentyFourHour, (record) => record.netReturnPct),
      },
    ],
    bands,
  };
}
