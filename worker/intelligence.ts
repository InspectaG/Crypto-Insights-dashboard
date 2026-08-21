import type { PaperSymbol } from "../lib/paper-trading";
import type { IntelligenceEvent, LiveSignal, MarketAsset } from "./types";

const products: Array<{
  symbol: PaperSymbol;
  name: string;
  productId: string;
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

type CoinbaseStats = {
  open: string;
  volume: string;
  last: string;
};

type FeedItem = {
  title: string;
  link: string | null;
  publishedAt: string;
};

const positiveWords = [
  "adoption", "approval", "approved", "breakout", "bull", "growth", "inflow",
  "launch", "partnership", "rally", "record", "surge", "upgrade", "wins",
];
const negativeWords = [
  "ban", "bear", "breach", "crash", "decline", "exploit", "hack", "lawsuit",
  "liquidation", "outflow", "risk", "scam", "selloff", "stolen", "warning",
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

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

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseFeed(xml: string, limit = 8): FeedItem[] {
  const rssItems = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const atomItems = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  return [...rssItems, ...atomItems].slice(0, limit).map((block) => {
    const linkTag = tag(block, "link");
    const linkAttribute = block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
    const rawDate = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    const published = new Date(rawDate);
    return {
      title: tag(block, "title").slice(0, 240),
      link: linkTag || linkAttribute,
      publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(),
    };
  }).filter((item) => item.title);
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sentiment(text: string) {
  const normalized = text.toLowerCase();
  const positive = positiveWords.filter((word) => normalized.includes(word)).length;
  const negative = negativeWords.filter((word) => normalized.includes(word)).length;
  return clamp(positive - negative, -2, 2);
}

function detectAsset(text: string): PaperSymbol | "MARKET" {
  const normalized = ` ${text.toLowerCase()} `;
  if (/\b(bitcoin|btc)\b/.test(normalized)) return "BTC";
  if (/\b(ethereum|ether|eth)\b/.test(normalized)) return "ETH";
  if (/\b(solana|sol)\b/.test(normalized)) return "SOL";
  return "MARKET";
}

function biasFromSentiment(value: number): IntelligenceEvent["bias"] {
  return value > 0 ? "bullish" : value < 0 ? "bearish" : "neutral";
}

export async function fetchMarketData(): Promise<MarketAsset[]> {
  return Promise.all(products.map(async (product) => {
    const response = await fetch(
      `https://api.exchange.coinbase.com/products/${product.productId}/stats`,
      {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        cf: { cacheTtl: 30, cacheEverything: true },
      } as RequestInit,
    );
    if (!response.ok) throw new Error(`Coinbase market feed returned ${response.status}`);
    const stats = await response.json() as CoinbaseStats;
    const open = Number(stats.open);
    const price = Number(stats.last);
    const baseVolume = Number(stats.volume);
    if (![open, price, baseVolume].every(Number.isFinite) || open <= 0 || price <= 0) {
      throw new Error("Coinbase market feed returned invalid values");
    }
    const changePct = ((price - open) / open) * 100;
    const volumeUsd = price * baseVolume;
    return {
      symbol: product.symbol,
      name: product.name,
      price,
      priceLabel: formatPrice(price),
      changePct,
      changeLabel: `${changePct >= 0 ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%`,
      volumeUsd,
      volumeLabel: formatVolume(volumeUsd),
      bias: changePct > 0.25 ? "bullish" : changePct < -0.25 ? "bearish" : "neutral",
      bars: product.bars,
    } satisfies MarketAsset;
  }));
}

async function fetchFeed(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/atom+xml, text/xml",
      "User-Agent": "GatchekSignals/0.1 (+https://crypto.gatchek.com)",
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  } as RequestInit);
  if (!response.ok) throw new Error(`Feed returned ${response.status}`);
  return parseFeed(await response.text());
}

async function fetchNewsEvents(): Promise<IntelligenceEvent[]> {
  const feeds = await Promise.allSettled([
    fetchFeed("https://www.coindesk.com/arc/outboundfeeds/rss/"),
    fetchFeed("https://cointelegraph.com/rss"),
  ]);
  const sourceNames = ["CoinDesk", "Cointelegraph"];
  return feeds.flatMap((result, sourceIndex) => {
    if (result.status !== "fulfilled") return [];
    return result.value.slice(0, 5).map((item) => {
      const score = sentiment(item.title);
      return {
        id: `news:${stableId(item.link ?? item.title)}`,
        source: "NEWS",
        asset: detectAsset(item.title),
        bias: biasFromSentiment(score),
        headline: item.title,
        detail: `${sourceNames[sourceIndex]} · linked source`,
        score: clamp(58 + Math.abs(score) * 10, 0, 100),
        url: item.link,
        occurredAt: item.publishedAt,
      } satisfies IntelligenceEvent;
    });
  });
}

async function fetchSocialEvents(): Promise<IntelligenceEvent[]> {
  const items = await fetchFeed("https://www.reddit.com/r/CryptoCurrency/new/.rss");
  return items.slice(0, 8).map((item) => {
    const score = sentiment(item.title);
    return {
      id: `social:${stableId(item.link ?? item.title)}`,
      source: "SOCIAL",
      asset: detectAsset(item.title),
      bias: biasFromSentiment(score),
      headline: item.title,
      detail: "Reddit r/CryptoCurrency · public post",
      score: clamp(48 + Math.abs(score) * 9, 0, 100),
      url: item.link,
      occurredAt: item.publishedAt,
    } satisfies IntelligenceEvent;
  });
}

async function fetchWhaleEvents(btcPrice: number): Promise<IntelligenceEvent[]> {
  const response = await fetch("https://blockchain.info/unconfirmed-transactions?format=json", {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 60, cacheEverything: true },
  } as RequestInit);
  if (!response.ok) throw new Error(`Blockchain feed returned ${response.status}`);
  const payload = await response.json() as {
    txs?: Array<{ hash: string; time: number; out?: Array<{ value?: number }> }>;
  };
  return (payload.txs ?? [])
    .map((transaction) => {
      const btc = (transaction.out ?? []).reduce((sum, output) => sum + Number(output.value ?? 0), 0) / 100_000_000;
      return { transaction, btc, usd: btc * btcPrice };
    })
    .filter(({ btc }) => btc >= 100)
    .sort((left, right) => right.usd - left.usd)
    .slice(0, 5)
    .map(({ transaction, btc, usd }) => ({
      id: `whale:${transaction.hash}`,
      source: "WHALE",
      asset: "BTC",
      bias: "neutral",
      headline: `${btc.toLocaleString("en-US", { maximumFractionDigits: 0 })} BTC moved on-chain`,
      detail: `$${(usd / 1_000_000).toFixed(1)}M estimated value · direction unclassified`,
      score: clamp(Math.round(60 + Math.log10(Math.max(1, usd / 1_000_000)) * 12), 0, 95),
      url: `https://www.blockchain.com/explorer/transactions/btc/${transaction.hash}`,
      occurredAt: new Date(transaction.time * 1_000).toISOString(),
    }));
}

export async function fetchIntelligence(market: MarketAsset[]) {
  const btcPrice = market.find((asset) => asset.symbol === "BTC")?.price ?? 0;
  const [news, social, whales] = await Promise.allSettled([
    fetchNewsEvents(),
    fetchSocialEvents(),
    fetchWhaleEvents(btcPrice),
  ]);
  const events: IntelligenceEvent[] = market.map((asset) => ({
    id: `market:${asset.symbol}:${Math.floor(Date.now() / 900_000)}`,
    source: "MARKET",
    asset: asset.symbol,
    bias: asset.bias,
    headline: `${asset.symbol} 24-hour momentum is ${asset.bias}`,
    detail: `${asset.changeLabel} · ${asset.volumeLabel} · Coinbase Exchange`,
    score: clamp(Math.round(55 + Math.abs(asset.changePct) * 7), 0, 95),
    url: `https://www.coinbase.com/advanced-trade/spot/${asset.symbol}-USD`,
    occurredAt: new Date().toISOString(),
  }));
  if (news.status === "fulfilled") events.push(...news.value);
  if (social.status === "fulfilled") events.push(...social.value);
  if (whales.status === "fulfilled") events.push(...whales.value);
  return events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function averageBias(events: IntelligenceEvent[], source: IntelligenceEvent["source"]) {
  const matching = events.filter((event) => event.source === source);
  if (!matching.length) return 0;
  const total = matching.reduce((sum, event) => {
    if (event.bias === "bullish") return sum + 1;
    if (event.bias === "bearish") return sum - 1;
    return sum;
  }, 0);
  return total / matching.length;
}

export function buildSignals(market: MarketAsset[], events: IntelligenceEvent[]): LiveSignal[] {
  const createdAt = new Date().toISOString();
  return market.map((asset) => {
    const relevant = events.filter((event) => event.asset === asset.symbol || event.asset === "MARKET");
    const newsBias = averageBias(relevant, "NEWS");
    const socialBias = averageBias(relevant, "SOCIAL");
    const whaleEvents = relevant.filter((event) => event.source === "WHALE");
    const marketDirection = Math.sign(asset.changePct);
    const netDirection = asset.changePct * 1.8 + newsBias * 1.4 + socialBias + (asset.symbol === "BTC" ? 0 : 0);
    const side = netDirection >= 0 ? "BUY" : "SELL";
    const directionSign = side === "BUY" ? 1 : -1;
    const opinions = [marketDirection, Math.sign(newsBias), Math.sign(socialBias)].filter((value) => value !== 0);
    const aligned = opinions.filter((value) => value === directionSign).length;
    const contradictions = opinions.filter((value) => value !== directionSign).length;
    const agreement = opinions.length ? aligned / opinions.length : 0;
    const confidence = clamp(
      Math.round(38 + opinions.length * 5 + agreement * 15 + Math.min(10, Math.abs(netDirection) * 2) - contradictions * 6),
      45,
      91,
    );
    const newsCount = relevant.filter((event) => event.source === "NEWS").length;
    const socialCount = relevant.filter((event) => event.source === "SOCIAL").length;
    const factors = [
      { label: "Market momentum", value: clamp(Math.round(55 + Math.abs(asset.changePct) * 8), 45, 95), color: "#63e6be" },
      { label: "Whale activity", value: asset.symbol === "BTC" ? clamp(50 + whaleEvents.length * 8, 45, 90) : 50, color: "#7aa2ff" },
      { label: "Social velocity", value: clamp(48 + socialCount * 5 + Math.round(Math.abs(socialBias) * 12), 45, 90), color: "#c084fc" },
      { label: "News sentiment", value: clamp(52 + newsCount * 4 + Math.round(Math.abs(newsBias) * 12), 45, 90), color: "#f6c65b" },
    ];
    const direction = confidence < 60 || opinions.length < 2
      ? "WATCH"
      : side === "BUY"
        ? confidence >= 75 ? "ACCUMULATE" : "WATCH LONG"
        : confidence >= 75 ? "REDUCE RISK" : "WATCH SHORT";
    const modelNote = `${aligned} of ${Math.max(1, opinions.length)} directional sources align. ${contradictions ? `${contradictions} source${contradictions === 1 ? "" : "s"} contradict the signal.` : "No directional source currently contradicts it."}`;
    return {
      symbol: asset.symbol,
      direction,
      side,
      confidence,
      horizon: "4–24 hour horizon",
      invalidation: "Re-evaluate if 24-hour momentum changes sign or two evidence sources disagree.",
      factors,
      modelNote,
      rationale: modelNote,
      createdAt,
    } satisfies LiveSignal;
  });
}
