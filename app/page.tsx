"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPaperAccount,
  executePaperTrade,
  isPaperAccount,
  learningSummary,
  portfolioSnapshot,
  todayBuySpend,
  type PaperPrices,
  type PaperSide,
  type PaperSymbol,
} from "../lib/paper-trading";

type Bias = "bullish" | "bearish" | "neutral";

type Asset = {
  symbol: PaperSymbol;
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
  PaperSymbol,
  { direction: string; side: PaperSide; confidence: number; horizon: string; invalidation: string }
> = {
  BTC: {
    direction: "ACCUMULATE",
    side: "BUY",
    confidence: 78,
    horizon: "12–24 hour horizon",
    invalidation: "Signal weakens below $112,600 or if exchange inflows reverse positive.",
  },
  ETH: {
    direction: "WATCH LONG",
    side: "BUY",
    confidence: 71,
    horizon: "8–16 hour horizon",
    invalidation: "Signal weakens if social velocity falls below baseline or ETH loses relative strength.",
  },
  SOL: {
    direction: "REDUCE RISK",
    side: "SELL",
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

const paperSymbols: PaperSymbol[] = ["BTC", "ETH", "SOL"];
const PAPER_STORAGE_KEY = "gatchek-paper-account-v1";

function numberFromPrice(price: string) {
  return Number(price.replace(/[^0-9.]/g, ""));
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
}

export default function Home() {
  const [filter, setFilter] = useState<"all" | Bias>("all");
  const [activeAsset, setActiveAsset] = useState<PaperSymbol>("BTC");
  const [assetData, setAssetData] = useState(fallbackAssets);
  const [marketSource, setMarketSource] = useState<"live" | "fallback">("fallback");
  const [paperAccount, setPaperAccount] = useState(() => createPaperAccount());
  const [paperReady, setPaperReady] = useState(false);
  const [paperSide, setPaperSide] = useState<PaperSide>("BUY");
  const [fundAmount, setFundAmount] = useState(10_000);
  const [fundDailyLimit, setFundDailyLimit] = useState(1_000);
  const [paperMessage, setPaperMessage] = useState(
    "Forward test is ready. No real orders or money are involved.",
  );

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

  useEffect(() => {
    const hydratePaperAccount = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(PAPER_STORAGE_KEY);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (isPaperAccount(parsed)) {
            setPaperAccount(parsed);
            setFundAmount(parsed.startingBalance);
            setFundDailyLimit(parsed.dailyLimit);
          }
        }
      } catch {
        // Corrupt or unavailable storage should never prevent the dashboard from loading.
      } finally {
        setPaperReady(true);
      }
    }, 0);

    return () => window.clearTimeout(hydratePaperAccount);
  }, []);

  useEffect(() => {
    if (!paperReady) return;
    window.localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(paperAccount));
  }, [paperAccount, paperReady]);

  const visibleEvents = useMemo(
    () => events.filter((event) => filter === "all" || event.bias === filter),
    [filter],
  );
  const activeProfile = signalProfiles[activeAsset];
  const paperPrices = useMemo(
    () =>
      Object.fromEntries(
        assetData.map((asset) => [asset.symbol, numberFromPrice(asset.price)]),
      ) as PaperPrices,
    [assetData],
  );
  const portfolio = useMemo(
    () => portfolioSnapshot(paperAccount, paperPrices),
    [paperAccount, paperPrices],
  );
  const learning = useMemo(() => learningSummary(paperAccount), [paperAccount]);
  const spentToday = todayBuySpend(paperAccount);
  const dailyRemaining = Math.max(0, paperAccount.dailyLimit - spentToday);
  const openPositions = paperSymbols.filter(
    (symbol) => paperAccount.positions[symbol].quantity > 0,
  );

  function selectAsset(symbol: PaperSymbol) {
    setActiveAsset(symbol);
    setPaperSide(signalProfiles[symbol].side);
  }

  function runPaperTrade() {
    const result = executePaperTrade(paperAccount, {
      symbol: activeAsset,
      side: paperSide,
      grossValue: paperAccount.orderSize,
      marketPrice: paperPrices[activeAsset],
      confidence: activeProfile.confidence,
      rationale: `${activeProfile.direction} · ${activeProfile.horizon}`,
    });

    if (!result.ok) {
      setPaperMessage(result.message);
      return;
    }

    setPaperAccount(result.account);
    setPaperMessage(
      `${result.trade.side} simulated for ${result.trade.symbol} at ${money(result.trade.marketPrice)}.`,
    );
  }

  function resetPaperAccount() {
    const startingBalance = Math.max(100, Number(fundAmount) || 0);
    const dailyLimit = Math.min(
      startingBalance,
      Math.max(10, Number(fundDailyLimit) || 0),
    );
    setPaperAccount(createPaperAccount(startingBalance, dailyLimit));
    setFundAmount(startingBalance);
    setFundDailyLimit(dailyLimit);
    setPaperMessage(`New ${money(startingBalance)} paper account funded. Previous simulated history was cleared.`);
  }

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
            onClick={() => selectAsset(asset.symbol)}
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

      <section className="paperSection" id="paper">
        <div className="paperTitleRow">
          <div>
            <p className="eyebrow">FORWARD TEST · PAPER MONEY ONLY</p>
            <h2>Paper trading lab</h2>
            <p>
              Simulate signal-driven orders, enforce a daily buy limit, and measure
              what the strategy would have earned or lost without touching Coinbase.
            </p>
          </div>
          <span className="paperBadge">NO REAL FUNDS</span>
        </div>

        <div className="paperMetrics" aria-label="Paper portfolio summary">
          <article>
            <span>EQUITY</span>
            <strong>{money(portfolio.equity)}</strong>
            <small className={portfolio.totalPnl >= 0 ? "positive" : "negative"}>
              {signedMoney(portfolio.totalPnl)} all time
            </small>
          </article>
          <article>
            <span>TOTAL RETURN</span>
            <strong className={portfolio.returnPct >= 0 ? "positive" : "negative"}>
              {portfolio.returnPct >= 0 ? "+" : ""}{portfolio.returnPct.toFixed(2)}%
            </strong>
            <small>mark-to-market</small>
          </article>
          <article>
            <span>AVAILABLE CASH</span>
            <strong>{money(paperAccount.cash)}</strong>
            <small>{money(portfolio.marketValue)} invested</small>
          </article>
          <article>
            <span>DAILY BUY BUDGET</span>
            <strong>{money(dailyRemaining)}</strong>
            <small>{money(spentToday)} of {money(paperAccount.dailyLimit)} used</small>
            <div className="budgetTrack" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (spentToday / paperAccount.dailyLimit) * 100)}%` }} />
            </div>
          </article>
        </div>

        <div className="paperGrid">
          <article className="panel paperAccountPanel">
            <div className="paperControls">
              <div className="paperFunding">
                <div className="subhead">
                  <div>
                    <p className="eyebrow">ACCOUNT SANDBOX</p>
                    <h3>Funding & guardrails</h3>
                  </div>
                  <button className="ghostButton" type="button" onClick={resetPaperAccount}>
                    Reset & fund
                  </button>
                </div>
                <div className="fieldGrid">
                  <label>
                    <span>Starting cash</span>
                    <span className="moneyInput"><i>$</i><input
                      aria-label="Paper starting cash"
                      min="100"
                      step="100"
                      type="number"
                      value={fundAmount}
                      onChange={(event) => setFundAmount(Number(event.target.value))}
                    /></span>
                  </label>
                  <label>
                    <span>Daily buy limit</span>
                    <span className="moneyInput"><i>$</i><input
                      aria-label="Paper daily buy limit"
                      min="10"
                      step="50"
                      type="number"
                      value={fundDailyLimit}
                      onChange={(event) => setFundDailyLimit(Number(event.target.value))}
                    /></span>
                  </label>
                  <label>
                    <span>Order size</span>
                    <span className="moneyInput"><i>$</i><input
                      aria-label="Paper order size"
                      min="1"
                      step="25"
                      type="number"
                      value={paperAccount.orderSize}
                      onChange={(event) => setPaperAccount((account) => ({
                        ...account,
                        orderSize: Math.max(0, Number(event.target.value)),
                      }))}
                    /></span>
                  </label>
                  <label>
                    <span>Min confidence</span>
                    <span className="percentInput"><input
                      aria-label="Minimum signal confidence"
                      max="100"
                      min="1"
                      type="number"
                      value={paperAccount.minimumConfidence}
                      onChange={(event) => setPaperAccount((account) => ({
                        ...account,
                        minimumConfidence: Math.min(100, Math.max(1, Number(event.target.value))),
                      }))}
                    /><i>%</i></span>
                  </label>
                </div>
                <p className="guardrailNote">
                  Buys stop automatically at the daily limit. Results include a conservative
                  {" "}{(paperAccount.executionDragBps / 100).toFixed(2)}% execution drag.
                </p>
              </div>

              <div className="orderTicket">
                <div className="subhead">
                  <div>
                    <p className="eyebrow">ACTIVE SIGNAL</p>
                    <h3>{activeAsset} paper ticket</h3>
                  </div>
                  <span className={`confidenceChip ${activeProfile.confidence >= paperAccount.minimumConfidence ? "pass" : "blocked"}`}>
                    {activeProfile.confidence}% CONF
                  </span>
                </div>
                <div className="sideToggle" aria-label="Paper order side">
                  <button
                    className={paperSide === "BUY" ? "selected buy" : ""}
                    type="button"
                    onClick={() => setPaperSide("BUY")}
                    aria-pressed={paperSide === "BUY"}
                  >BUY</button>
                  <button
                    className={paperSide === "SELL" ? "selected sell" : ""}
                    type="button"
                    onClick={() => setPaperSide("SELL")}
                    aria-pressed={paperSide === "SELL"}
                  >SELL</button>
                </div>
                <dl className="ticketFacts">
                  <div><dt>Market price</dt><dd>{money(paperPrices[activeAsset])}</dd></div>
                  <div><dt>Model bias</dt><dd>{activeProfile.direction}</dd></div>
                  <div><dt>Notional</dt><dd>{money(paperAccount.orderSize)}</dd></div>
                </dl>
                <button className="paperTradeButton" type="button" onClick={runPaperTrade}>
                  Simulate {paperSide.toLowerCase()} order
                </button>
                <p className="paperMessage" role="status">{paperMessage}</p>
              </div>
            </div>

            <div className="paperTables">
              <div>
                <div className="tableTitle"><h3>Open positions</h3><span>{openPositions.length} ACTIVE</span></div>
                <div className="miniTable positionsTable" role="table" aria-label="Open paper positions">
                  <div className="miniRow miniLabels" role="row">
                    <span>ASSET</span><span>QUANTITY</span><span>VALUE</span><span>UNREALIZED</span>
                  </div>
                  {openPositions.map((symbol) => {
                    const position = paperAccount.positions[symbol];
                    const value = position.quantity * paperPrices[symbol];
                    const unrealized = value - position.costBasis;
                    return (
                      <div className="miniRow" role="row" key={symbol}>
                        <strong>{symbol}</strong>
                        <span>{position.quantity.toFixed(symbol === "SOL" ? 3 : 6)}</span>
                        <span>{money(value)}</span>
                        <span className={unrealized >= 0 ? "positive" : "negative"}>{signedMoney(unrealized)}</span>
                      </div>
                    );
                  })}
                  {openPositions.length === 0 && (
                    <p className="paperEmpty">No positions yet. Run a qualifying paper buy to start the forward test.</p>
                  )}
                </div>
              </div>

              <div>
                <div className="tableTitle"><h3>Recent simulations</h3><span>{paperAccount.trades.length} TOTAL</span></div>
                <div className="miniTable tradesTable" role="table" aria-label="Recent paper trades">
                  <div className="miniRow miniLabels" role="row">
                    <span>ORDER</span><span>NOTIONAL</span><span>PRICE</span><span>OUTCOME</span>
                  </div>
                  {paperAccount.trades.slice(0, 4).map((trade) => (
                    <div className="miniRow" role="row" key={trade.id}>
                      <strong className={trade.side === "BUY" ? "positive" : "negative"}>{trade.side} {trade.symbol}</strong>
                      <span>{money(trade.grossValue)}</span>
                      <span>{money(trade.marketPrice)}</span>
                      <span className={(trade.realizedPnl ?? 0) >= 0 ? "positive" : "negative"}>
                        {trade.realizedPnl === null ? "OPEN" : signedMoney(trade.realizedPnl)}
                      </span>
                    </div>
                  ))}
                  {paperAccount.trades.length === 0 && (
                    <p className="paperEmpty">Completed simulations will appear here with realized outcomes.</p>
                  )}
                </div>
              </div>
            </div>
          </article>

          <aside className="panel learningPanel">
            <div className="panelHeader compact">
              <div>
                <p className="eyebrow">CONTROLLED LEARNING LOOP</p>
                <h2>Strategy review</h2>
              </div>
              <span className="learningState">OBSERVE</span>
            </div>
            <div className="learningScore">
              <strong>{learning.closedTrades}<span>/{learning.sampleTarget}</span></strong>
              <p>closed trades before the first rule review</p>
            </div>
            <div className="learningStats">
              <div><span>Win rate</span><strong>{learning.closedTrades ? `${learning.winRate.toFixed(0)}%` : "—"}</strong></div>
              <div><span>Profit factor</span><strong>{learning.profitFactor === Infinity ? "∞" : learning.profitFactor ? learning.profitFactor.toFixed(2) : "—"}</strong></div>
              <div><span>Realized P/L</span><strong className={portfolio.realizedPnl >= 0 ? "positive" : "negative"}>{signedMoney(portfolio.realizedPnl)}</strong></div>
              <div><span>Unrealized P/L</span><strong className={portfolio.unrealizedPnl >= 0 ? "positive" : "negative"}>{signedMoney(portfolio.unrealizedPnl)}</strong></div>
            </div>
            <div className="recommendationCard">
              <span>NEXT EXPERIMENT</span>
              <p>{learning.recommendation}</p>
            </div>
            <div className="learningGuardrail">
              <strong>Human review stays in the loop</strong>
              <p>
                The learner measures outcomes and proposes one testable change at a time.
                It never rewrites the live strategy or unlocks real trading on its own.
              </p>
            </div>
            <small className="localNote">
              MVP ledger is stored in this browser. Shared, cross-device history will move to an authenticated database next.
            </small>
          </aside>
        </div>
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
