import type { PaperSide, PaperSymbol } from "../lib/paper-trading";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}

export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  ASSETS: AssetFetcher;
  DB: D1Database;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  COINBASE_API_KEY_NAME?: string;
  COINBASE_API_PRIVATE_KEY?: string;
  COINBASE_PRIMARY_API_KEY_NAME?: string;
  COINBASE_PRIMARY_API_PRIVATE_KEY?: string;
  COINBASE_BROTHER_API_KEY_NAME?: string;
  COINBASE_BROTHER_API_PRIVATE_KEY?: string;
  ALERT_WEBHOOK_URL?: string;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export type MarketAsset = {
  symbol: PaperSymbol;
  name: string;
  price: number;
  priceLabel: string;
  changePct: number;
  changeLabel: string;
  volumeUsd: number;
  volumeLabel: string;
  bias: "bullish" | "bearish" | "neutral";
  bars: number[];
};

export type IntelligenceEvent = {
  id: string;
  source: "WHALE" | "SOCIAL" | "MARKET" | "NEWS";
  asset: PaperSymbol | "MARKET";
  bias: "bullish" | "bearish" | "neutral";
  headline: string;
  detail: string;
  score: number;
  url: string | null;
  occurredAt: string;
};

export type SignalFactor = {
  label: string;
  value: number;
  color: string;
};

export type LiveSignal = {
  symbol: PaperSymbol;
  direction: string;
  side: PaperSide;
  confidence: number;
  horizon: string;
  invalidation: string;
  factors: SignalFactor[];
  modelNote: string;
  rationale: string;
  createdAt: string;
};

export type AlertRecord = {
  id: string;
  kind: string;
  severity: "info" | "watch" | "action";
  title: string;
  body: string;
  sourceUrl: string | null;
  readAt: string | null;
  createdAt: string;
};
