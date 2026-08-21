export const dynamic = "force-dynamic";

type ProductConfig = {
  symbol: "BTC" | "ETH" | "SOL";
  name: string;
  productId: string;
  bars: number[];
};

type CoinbaseStats = {
  open: string;
  high: string;
  low: string;
  volume: string;
  last: string;
};

const products: ProductConfig[] = [
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

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1_000 ? 2 : 0,
    maximumFractionDigits: value < 1_000 ? 2 : 0,
  }).format(value);
}

function formatVolume(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B vol`;
  return `$${(value / 1_000_000).toFixed(1)}M vol`;
}

async function getAsset(product: ProductConfig) {
  const response = await fetch(
    `https://api.exchange.coinbase.com/products/${product.productId}/stats`,
    {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 30, cacheEverything: true },
    } as RequestInit,
  );

  if (!response.ok) throw new Error(`Market feed returned ${response.status}`);

  const stats = (await response.json()) as CoinbaseStats;
  const open = Number(stats.open);
  const last = Number(stats.last);
  const baseVolume = Number(stats.volume);

  if (![open, last, baseVolume].every(Number.isFinite) || open <= 0) {
    throw new Error("Market feed returned invalid values");
  }

  const change = ((last - open) / open) * 100;

  return {
    symbol: product.symbol,
    name: product.name,
    price: formatPrice(last),
    change: `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(2)}%`,
    volume: formatVolume(last * baseVolume),
    bias: change > 0.25 ? "bullish" : change < -0.25 ? "bearish" : "neutral",
    bars: product.bars,
  };
}

export async function GET() {
  try {
    const assets = await Promise.all(products.map(getAsset));
    return Response.json(
      { assets, source: "Coinbase Exchange", asOf: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } },
    );
  } catch {
    return Response.json(
      { error: "Market data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
