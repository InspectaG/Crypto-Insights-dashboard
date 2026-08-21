import type { PaperSymbol } from "../lib/paper-trading";
import type { MarketAsset } from "./types";

export const marketProducts: ReadonlyArray<{
  symbol: PaperSymbol;
  name: string;
  productId: `${PaperSymbol}-USD`;
  bars: number[];
}> = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    productId: "BTC-USD",
    bars: [32, 42, 36, 51, 47, 60, 58, 72, 68, 84, 79, 92],
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    productId: "ETH-USD",
    bars: [40, 45, 38, 49, 54, 51, 60, 64, 57, 67, 73, 76],
  },
  {
    symbol: "SOL",
    name: "Solana",
    productId: "SOL-USD",
    bars: [78, 72, 81, 68, 73, 62, 66, 57, 61, 48, 52, 43],
  },
];

type CoinbaseTicker = {
  price: string;
  bid: string;
  ask: string;
  time: string;
};

type CoinbaseStats = {
  open: string;
  volume: string;
  last: string;
};

export function formatMarketPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatMarketVolume(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B vol`;
  return `$${(value / 1_000_000).toFixed(1)}M vol`;
}

export function marketProduct(symbol: PaperSymbol) {
  return marketProducts.find((product) => product.symbol === symbol);
}

async function coinbaseJson<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.exchange.coinbase.com${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      "User-Agent": "GatchekSignals/0.2 (+https://crypto.gatchek.com)",
    },
  });

  if (!response.ok) {
    throw new Error(`Coinbase market feed returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function finitePositive(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function getAsset(product: (typeof marketProducts)[number]): Promise<MarketAsset> {
  const [ticker, stats] = await Promise.all([
    coinbaseJson<CoinbaseTicker>(`/products/${product.productId}/ticker`),
    coinbaseJson<CoinbaseStats>(`/products/${product.productId}/stats`),
  ]);
  const price = finitePositive(ticker.price);
  const bid = finitePositive(ticker.bid);
  const ask = finitePositive(ticker.ask);
  const open = finitePositive(stats.open);
  const statsLast = finitePositive(stats.last);
  const baseVolume = finitePositive(stats.volume);
  const observedAt = new Date(ticker.time);

  if (
    price === null || bid === null || ask === null || open === null ||
    statsLast === null || baseVolume === null || Number.isNaN(observedAt.getTime())
  ) {
    throw new Error(`Coinbase returned an invalid ${product.symbol} quote`);
  }

  const now = Date.now();
  const ageMs = now - observedAt.getTime();
  const priceVsStats = Math.abs(price - statsLast) / price;
  const outsideBook = price < bid * 0.995 || price > ask * 1.005;
  if (ask < bid || outsideBook || priceVsStats > 0.01 || ageMs < -60_000 || ageMs > 300_000) {
    throw new Error(`Coinbase returned an inconsistent ${product.symbol} quote`);
  }

  const changePct = ((price - open) / open) * 100;
  const volumeUsd = price * baseVolume;
  return {
    symbol: product.symbol,
    name: product.name,
    productId: product.productId,
    price,
    priceLabel: formatMarketPrice(price),
    changePct,
    changeLabel: `${changePct >= 0 ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%`,
    volumeUsd,
    volumeLabel: formatMarketVolume(volumeUsd),
    bias: changePct > 0.25 ? "bullish" : changePct < -0.25 ? "bearish" : "neutral",
    bars: product.bars,
    source: "Coinbase Exchange",
    observedAt: observedAt.toISOString(),
    status: "live",
  };
}

export async function fetchMarketData(): Promise<MarketAsset[]> {
  return Promise.all(marketProducts.map(getAsset));
}
