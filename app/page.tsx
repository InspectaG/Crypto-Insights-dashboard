"use client";

import { useEffect, useMemo, useState } from "react";

type Bias = "bullish" | "bearish" | "neutral";

type Asset = {
  symbol: string;
  name: string;
  price: string;
  change: string;
  volume: string;
  bias: Bias;
  bars: number[];
};

const fallbackAssets: Asset[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    price: "$116,842",
    change: "+3.84%",
    volume: "$48.2B vol",
    bias: "bullish" as Bias,
    bars: [32, 42, 36, 51, 47, 60, 58, 72, 68, 84, 79, 92],
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    price: "$4,284",
    change: "+2.17%",
    volume: "$22.7B vol",
    bias: "bullish" as Bias,
    bars: [40, 45, 38, 49, 54, 51, 60, 64, 57, 67, 73, 76],
  },
  {
    symbol: "SOL",
    name: "Solana",
    price: "$188.41",
    change: "−1.26%",
    volume: "$5.8B vol",
    bias: "bearish" as Bias,
    bars: [78, 72, 81, 68, 73, 62, 66, 57, 61, 48, 52, 43],
  },
];

const signalProfiles: Record<
  string,
  { direction: string; confidence: number; horizon: string; invalidation: string }
> = {
  BTC: {
    direction: "ACCUMULATE",
    confidence: 78,
    horizon: "12–24 hour horizon",
    invalidation: "Signal weakens below $112,600 or if exchange inflows reverse positive.",
  },
  ETH: {
    direction: "WATCH LONG",
    confidence: 71,
    horizon: "8–16 hour horizon",
    invalidation: "Signal weakens if social velocity falls below baseline or ETH loses relative strength.",
  },
  SOL: {
    direction: "REDUCE RISK",
    confidence: 69,
    horizon: "4–12 hour horizon",
    invalidation: "Bearish pressure eases if spot volume confirms a reclaim above the local range.",
  },
};

const events = [
  {
    id: 1,
    time: "2m",
    source: "WHALE",
    asset: "BTC",
    bias: "bullish" as Bias,
    headline: "2,140 BTC moved off a major exchange",
    detail: "Large exchange outflow · $249.8M estimated value",
    score: 88,
  },
  {
    id: 2,
    time: "8m",
    source: "SOCIAL",
    asset: "ETH",
    bias: "bullish" as Bias,
    headline: "Developer narrative velocity accelerating",
    detail: "Mentions +41% · Positive sentiment 68%",
    score: 74,
  },
  {
    id: 3,
    time: "14m",
    source: "MARKET",
    asset: "SOL",
    bias: "bearish" as Bias,
    headline: "Perpetual funding diverges from spot demand",
    detail: "Crowded longs · Open interest +9.4% in 4h",
    score: 69,
  },
  {
    id: 4,
    time: "21m",
    source: "NEWS",
    asset: "BTC",
    bias: "neutral" as Bias,
    headline: "Macro headline adds short-term volatility risk",
    detail: "3 credible sources · Impact window 1–4h",
    score: 62,
  },
];

const filters: Array<{ label: string; value: "all" | Bias }> = [
  { label: "All events", value: "all" },
  { label: "Bullish", value: "bullish" },
  { label: "Bearish", value: "bearish" },
  { label: "Neutral", value: "neutral" },
];

export default function Home() {
  const [filter, setFilter] = useState<"all" | Bias>("all");
  const [activeAsset, setActiveAsset] = useState("BTC");
  const [assetData, setAssetData] = useState(fallbackAssets);
  const [marketSource, setMarketSource] = useState<"live" | "fallback">("fallback");

  useEffect(() => {
    const controller = new AbortController();

    async function loadMarket() {
      try {
        const response = await fetch("/api/market", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { assets?: Asset[] };
        if (payload.assets?.length === fallbackAssets.length) {
          setAssetData(payload.assets);
          setMarketSource("live");
        }
      } catch {
        // The deterministic preview data remains visible if the upstream feed is unavailable.
      }
    }

    loadMarket();
    const refresh = window.setInterval(loadMarket, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(refresh);
    };
  }, []);

  const visibleEvents = useMemo(
    () => events.filter((event) => filter === "all" || event.bias === filter),
    [filter],
  );
  const activeProfile = signalProfiles[activeAsset];

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Gatchek Signals home">
          <span className="brandMark">G</span>
          <span>
            GATCHEK <b>/ SIGNALS</b>
          </span>
        </a>
        <div className="topbarRight">
          <span className="demoPill">
            {marketSource === "live" ? "LIVE PRICES · SIMULATED SIGNALS" : "SIMULATED MVP DATA"}
          </span>
          <span className="status"><i /> SYSTEM ONLINE</span>
          <button className="avatar" aria-label="Open account menu">JG</button>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">INTELLIGENCE DESK · 15 MINUTE HORIZON</p>
          <h1>Market pulse</h1>
          <p className="heroCopy">
            Evidence-weighted crypto signals from price action, news, social
            momentum, and whale activity.
          </p>
        </div>
        <div className="marketRegime">
          <span>MARKET REGIME</span>
          <strong><i /> RISK-ON</strong>
          <small>Confidence 72%</small>
        </div>
      </section>

      <section className="assetGrid" aria-label="Asset overview">
        {assetData.map((asset) => (
          <button
            className={`assetCard ${activeAsset === asset.symbol ? "active" : ""}`}
            key={asset.symbol}
            onClick={() => setActiveAsset(asset.symbol)}
            aria-pressed={activeAsset === asset.symbol}
          >
            <div className="assetHead">
              <div className={`coin coin-${asset.symbol.toLowerCase()}`}>{asset.symbol[0]}</div>
              <div>
                <strong>{asset.symbol}</strong>
                <span>{asset.name}</span>
              </div>
              <span className={`change ${asset.bias}`}>{asset.change}</span>
            </div>
            <div className="assetBody">
              <div>
                <strong className="price">{asset.price}</strong>
                <span className="volume">{asset.volume}</span>
              </div>
              <div className={`spark ${asset.bias}`} aria-hidden="true">
                {asset.bars.map((height, index) => (
                  <i key={index} style={{ height: `${height}%` }} />
                ))}
              </div>
            </div>
          </button>
        ))}
      </section>

      <section className="dashboardGrid">
        <article className="panel signalPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">HIGHEST CONVICTION</p>
              <h2>{activeAsset} signal</h2>
            </div>
            <span className="liveBadge"><i /> ACTIVE</span>
          </div>

          <div className="signalCore">
            <div className="signalDirection">
              <span>BIAS</span>
              <strong>{activeProfile.direction}</strong>
              <small>{activeProfile.horizon}</small>
            </div>
            <div className="confidenceDial">
              <div className="dialValue">{activeProfile.confidence}<span>%</span></div>
              <small>CONFIDENCE</small>
            </div>
          </div>

          <div className="evidenceList">
            <div>
              <span className="evidenceIcon bullish">W</span>
              <p><strong>Whale accumulation</strong><small>Large net exchange outflows</small></p>
              <b>+22</b>
            </div>
            <div>
              <span className="evidenceIcon bullish">M</span>
              <p><strong>Momentum confirmation</strong><small>Volume-backed breakout structure</small></p>
              <b>+18</b>
            </div>
            <div>
              <span className="evidenceIcon neutral">N</span>
              <p><strong>News environment</strong><small>Constructive, no major catalyst</small></p>
              <b>+7</b>
            </div>
            <div>
              <span className="evidenceIcon bearish">R</span>
              <p><strong>Derivatives risk</strong><small>Funding approaching elevated range</small></p>
              <b>−9</b>
            </div>
          </div>

          <div className="riskCallout">
            <span>INVALIDATION</span>
            <p>{activeProfile.invalidation}</p>
          </div>
        </article>

        <aside className="panel scorePanel">
          <div className="panelHeader compact">
            <div>
              <p className="eyebrow">COMPOSITE SCORE</p>
              <h2>Signal anatomy</h2>
            </div>
            <span className="scoreNumber">72<span>/100</span></span>
          </div>
          <div className="scoreBars">
            {[
              ["Market momentum", 84, "#63e6be"],
              ["Whale flow", 76, "#7aa2ff"],
              ["Social velocity", 68, "#c084fc"],
              ["News sentiment", 61, "#f6c65b"],
            ].map(([label, value, color]) => (
              <div className="scoreRow" key={label}>
                <div><span>{label}</span><b>{value}</b></div>
                <div className="track"><i style={{ width: `${value}%`, background: color }} /></div>
              </div>
            ))}
          </div>
          <div className="regimeNote">
            <span>MODEL NOTE</span>
            <p>Three independent sources agree. Confidence is reduced by elevated leverage.</p>
          </div>
        </aside>
      </section>

      <section className="panel feedPanel">
        <div className="panelHeader feedHeader">
          <div>
            <p className="eyebrow">CORROBORATING EVENTS</p>
            <h2>Signal feed</h2>
          </div>
          <div className="filters" aria-label="Filter events">
            {filters.map((item) => (
              <button
                className={filter === item.value ? "selected" : ""}
                key={item.value}
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="eventTable" role="table" aria-label="Market signal events">
          <div className="eventRow eventLabels" role="row">
            <span>TIME</span><span>SOURCE</span><span>EVENT</span><span>IMPACT</span>
          </div>
          {visibleEvents.map((event) => (
            <div className="eventRow" role="row" key={event.id}>
              <span className="eventTime">{event.time}</span>
              <span><b className={`sourceTag source-${event.source.toLowerCase()}`}>{event.source}</b></span>
              <span className="eventCopy">
                <strong>{event.headline}</strong>
                <small>{event.asset} · {event.detail}</small>
              </span>
              <span className={`impact ${event.bias}`}><i /> {event.score}</span>
            </div>
          ))}
          {visibleEvents.length === 0 && <p className="emptyState">No events match this filter.</p>}
        </div>
      </section>

      <footer>
        <p>Decision support only. Signals are experimental and are not financial advice or a guarantee of returns.</p>
        <span>GATCHEK SIGNAL ENGINE · PRIVATE MVP</span>
      </footer>
    </main>
  );
}
