"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import packageMetadata from "../package.json";
import {
  createPaperAccount,
  learningSummary,
  portfolioSnapshot,
  todayBuySpend,
  type PaperAccount,
  type PaperPrices,
  type PaperSide,
  type PaperSymbol,
} from "../lib/paper-trading";
import type { PaperSettingsDraft } from "../lib/paper-settings";
import { minimumConfidenceForRisk, riskLabel } from "../lib/risk-controls";

type Bias = "bullish" | "bearish" | "neutral";
type ConfidenceBand = "high" | "moderate" | "low";

type ConfidenceFactor = {
  label: string;
  value: number;
  color: string;
};

type SignalProfile = {
  direction: string;
  side: PaperSide;
  confidence: number;
  horizon: string;
  invalidation: string;
  factors: ConfidenceFactor[];
  modelNote: string;
};

type Asset = {
  symbol: PaperSymbol;
  name: string;
  price: string;
  change: string;
  volume: string;
  bias: Bias;
  bars: number[];
};

type FeedEvent = {
  id: string;
  source: "WHALE" | "SOCIAL" | "MARKET" | "NEWS";
  asset: PaperSymbol | "MARKET";
  bias: Bias;
  headline: string;
  detail: string;
  score: number;
  url: string | null;
  occurredAt: string;
};

type DashboardAlert = {
  id: string;
  severity: "info" | "watch" | "action";
  title: string;
  body: string;
  sourceUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

type ServerPerformance = {
  maxDrawdownPct: number;
  buyHoldReturnPct: number;
  alphaVsBtcPct: number;
  snapshots: number;
  executionCosts: number;
  benchmarkContributions: number;
};

type ValidationHorizon = {
  hours: 4 | 24;
  sample: number;
  hitRate: number;
  averageNetReturnPct: number;
};

type ValidationBand = {
  key: "low" | "moderate" | "high";
  label: string;
  range: string;
  sample: number;
  averageConfidence: number;
  hitRate: number;
  averageNetReturnPct: number;
};

type SignalValidation = {
  readiness: "collecting" | "review_ready";
  sampleTarget: number;
  highConfidenceTarget: number;
  primarySample: number;
  highConfidenceSample: number;
  maturedSignals: number;
  maturedEvaluations: number;
  coverageDays: number;
  roundTripCostBps: number;
  lastEvaluatedAt: string | null;
  horizons: ValidationHorizon[];
  bands: ValidationBand[];
};

type AutomationRun = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  signals: number;
  events: number;
  tradeId: string | null;
  error: string | null;
};

type Viewer = { id: "justin" | "gatcho"; email: string; displayName: string };

type ComparisonProfile = {
  id: "justin" | "gatcho";
  displayName: string;
  isViewer: boolean;
  equity: number;
  totalPnl: number;
  returnPct: number;
  realizedPnl: number;
  maxDrawdownPct: number;
  closedTrades: number;
  winRate: number;
  riskLevel: number;
  dailyLimit: number;
};

type CoinbaseConnection = {
  label: string;
  keyHint?: string;
  updatedAt?: string;
  verifiedAt?: string | null;
  configured: boolean;
  connected: boolean;
  mode: string;
  accountCount: number;
  permissions: { canView: boolean; canTrade: boolean; canTransfer: boolean; canReceive?: boolean };
  message: string;
};

type CoinbaseStatus = {
  configured: boolean;
  connected: boolean;
  mode: string;
  accountCount: number;
  permissions: { canView: boolean; canTrade: boolean; canTransfer: boolean; canReceive?: boolean };
  realTradingEnabled: false;
  killSwitch: true;
  message: string;
  connections?: CoinbaseConnection[];
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

const signalProfiles: Record<PaperSymbol, SignalProfile> = {
  BTC: {
    direction: "ACCUMULATE",
    side: "BUY",
    confidence: 78,
    horizon: "12–24 hour horizon",
    invalidation: "Signal weakens below $112,600 or if exchange inflows reverse positive.",
    factors: [
      { label: "Market momentum", value: 84, color: "#63e6be" },
      { label: "Whale flow", value: 88, color: "#7aa2ff" },
      { label: "Social velocity", value: 68, color: "#c084fc" },
      { label: "News sentiment", value: 61, color: "#f6c65b" },
    ],
    modelNote: "Three independent sources agree. Elevated leverage keeps this below very-high confidence.",
  },
  ETH: {
    direction: "WATCH LONG",
    side: "BUY",
    confidence: 71,
    horizon: "8–16 hour horizon",
    invalidation: "Signal weakens if social velocity falls below baseline or ETH loses relative strength.",
    factors: [
      { label: "Market momentum", value: 76, color: "#63e6be" },
      { label: "Whale flow", value: 58, color: "#7aa2ff" },
      { label: "Social velocity", value: 83, color: "#c084fc" },
      { label: "News sentiment", value: 70, color: "#f6c65b" },
    ],
    modelNote: "Social and price signals agree, but whale confirmation is still mixed.",
  },
  SOL: {
    direction: "REDUCE RISK",
    side: "SELL",
    confidence: 69,
    horizon: "4–12 hour horizon",
    invalidation: "Bearish pressure eases if spot volume confirms a reclaim above the local range.",
    factors: [
      { label: "Market momentum", value: 72, color: "#63e6be" },
      { label: "Whale flow", value: 63, color: "#7aa2ff" },
      { label: "Social velocity", value: 61, color: "#c084fc" },
      { label: "News sentiment", value: 76, color: "#f6c65b" },
    ],
    modelNote: "Risk signals lean bearish, though source agreement is only moderate.",
  },
};

const fallbackEvents: FeedEvent[] = [
  {
    id: "fallback-1",
    source: "WHALE",
    asset: "BTC",
    bias: "bullish" as Bias,
    headline: "2,140 BTC moved off a major exchange",
    detail: "Large exchange outflow · $249.8M estimated value",
    score: 88,
    url: null,
    occurredAt: new Date().toISOString(),
  },
  {
    id: "fallback-2",
    source: "SOCIAL",
    asset: "ETH",
    bias: "bullish" as Bias,
    headline: "Developer narrative velocity accelerating",
    detail: "Mentions +41% · Positive sentiment 68%",
    score: 74,
    url: null,
    occurredAt: new Date().toISOString(),
  },
  {
    id: "fallback-3",
    source: "MARKET",
    asset: "SOL",
    bias: "bearish" as Bias,
    headline: "Perpetual funding diverges from spot demand",
    detail: "Crowded longs · Open interest +9.4% in 4h",
    score: 69,
    url: null,
    occurredAt: new Date().toISOString(),
  },
  {
    id: "fallback-4",
    source: "NEWS",
    asset: "BTC",
    bias: "neutral" as Bias,
    headline: "Macro headline adds short-term volatility risk",
    detail: "3 credible sources · Impact window 1–4h",
    score: 62,
    url: null,
    occurredAt: new Date().toISOString(),
  },
];

const filters: Array<{ label: string; value: "all" | Bias }> = [
  { label: "All events", value: "all" },
  { label: "Bullish", value: "bullish" },
  { label: "Bearish", value: "bearish" },
  { label: "Neutral", value: "neutral" },
];

const paperSymbols: PaperSymbol[] = ["BTC", "ETH", "SOL"];
function numberFromPrice(price: string) {
  return Number(price.replace(/[^0-9.]/g, ""));
}

function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
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

function confidenceBand(value: number): ConfidenceBand {
  if (value >= 75) return "high";
  if (value >= 60) return "moderate";
  return "low";
}

function confidenceMeaning(band: ConfidenceBand) {
  if (band === "high") return "Multiple independent sources align with limited contradiction.";
  if (band === "moderate") return "The evidence leans one way, but meaningful uncertainty remains.";
  return "The evidence is weak or conflicting; treat this as watch-only.";
}

export default function Home() {
  const [filter, setFilter] = useState<"all" | Bias>("all");
  const [activeAsset, setActiveAsset] = useState<PaperSymbol>("BTC");
  const [assetData, setAssetData] = useState(fallbackAssets);
  const [marketSource, setMarketSource] = useState<"live" | "fallback">("fallback");
  const [paperAccount, setPaperAccount] = useState(() => createPaperAccount());
  const [viewer, setViewer] = useState<Viewer>({ id: "justin", email: "gatchek@gmail.com", displayName: "Justin" });
  const [comparison, setComparison] = useState<ComparisonProfile[]>([]);
  const [paperReady, setPaperReady] = useState(false);
  const [profiles, setProfiles] = useState(signalProfiles);
  const [feedEvents, setFeedEvents] = useState(fallbackEvents);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [serverPerformance, setServerPerformance] = useState<ServerPerformance>({
    maxDrawdownPct: 0,
    buyHoldReturnPct: 0,
    alphaVsBtcPct: 0,
    snapshots: 0,
    executionCosts: 0,
    benchmarkContributions: 0,
  });
  const [validation, setValidation] = useState<SignalValidation>({
    readiness: "collecting",
    sampleTarget: 100,
    highConfidenceTarget: 30,
    primarySample: 0,
    highConfidenceSample: 0,
    maturedSignals: 0,
    maturedEvaluations: 0,
    coverageDays: 0,
    roundTripCostBps: 60,
    lastEvaluatedAt: null,
    horizons: [
      { hours: 4, sample: 0, hitRate: 0, averageNetReturnPct: 0 },
      { hours: 24, sample: 0, hitRate: 0, averageNetReturnPct: 0 },
    ],
    bands: [
      { key: "low", label: "Low", range: "0–59", sample: 0, averageConfidence: 0, hitRate: 0, averageNetReturnPct: 0 },
      { key: "moderate", label: "Moderate", range: "60–74", sample: 0, averageConfidence: 0, hitRate: 0, averageNetReturnPct: 0 },
      { key: "high", label: "High", range: "75–100", sample: 0, averageConfidence: 0, hitRate: 0, averageNetReturnPct: 0 },
    ],
  });
  const [automation, setAutomation] = useState<AutomationRun | null>(null);
  const [autoPaperEnabled, setAutoPaperEnabled] = useState(true);
  const [coinbase, setCoinbase] = useState<CoinbaseStatus>({
    configured: false,
    connected: false,
    mode: "disconnected",
    accountCount: 0,
    permissions: { canView: false, canTrade: false, canTransfer: false },
    realTradingEnabled: false,
    killSwitch: true,
    message: "Read-only credentials have not been connected yet.",
  });
  const [syncing, setSyncing] = useState(false);
  const [paperSide, setPaperSide] = useState<PaperSide>("BUY");
  const [fundAmount, setFundAmount] = useState(10_000);
  const [depositAmount, setDepositAmount] = useState(1_000);
  const [oneTimeOrder, setOneTimeOrder] = useState(250);
  const [paperMessage, setPaperMessage] = useState(
    "Forward test is ready. No real orders or money are involved.",
  );
  const [paperSettingsStatus, setPaperSettingsStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");

  const syncControlPlane = useCallback(async (showProgress = false) => {
    if (showProgress) setSyncing(true);
    try {
      const response = await fetch("/api/control-plane", { credentials: "same-origin" });
      const payload = await response.json() as {
        error?: string;
        user?: Viewer;
        paperAccount?: PaperAccount;
        market?: Array<{
          symbol: PaperSymbol; name: string; priceLabel: string; changeLabel: string;
          volumeLabel: string; bias: Bias; bars: number[];
        }>;
        signals?: Array<SignalProfile & { symbol: PaperSymbol }>;
        events?: FeedEvent[];
        alerts?: DashboardAlert[];
        performance?: ServerPerformance;
        validation?: SignalValidation;
        automation?: AutomationRun | null;
        settings?: { autoPaperEnabled?: boolean; paperStartingCash?: number };
        coinbase?: CoinbaseStatus;
        comparison?: ComparisonProfile[];
      };
      if (!response.ok) throw new Error(payload.error ?? "Dashboard sync failed");
      if (payload.paperAccount) {
        setPaperAccount(payload.paperAccount);
        setFundAmount(payload.settings?.paperStartingCash ?? payload.paperAccount.startingBalance);
      }
      if (payload.user) setViewer(payload.user);
      if (payload.comparison) setComparison(payload.comparison);
      if (payload.market?.length) {
        setAssetData(payload.market.map((asset) => ({
          symbol: asset.symbol,
          name: asset.name,
          price: asset.priceLabel,
          change: asset.changeLabel,
          volume: asset.volumeLabel,
          bias: asset.bias,
          bars: asset.bars,
        })));
        setMarketSource("live");
      }
      if (payload.signals?.length) {
        const nextProfiles: Record<PaperSymbol, SignalProfile> = { ...signalProfiles };
        for (const signal of payload.signals) nextProfiles[signal.symbol] = signal;
        setProfiles(nextProfiles);
      }
      if (payload.events?.length) setFeedEvents(payload.events);
      if (payload.alerts) setAlerts(payload.alerts);
      if (payload.performance) setServerPerformance(payload.performance);
      if (payload.validation) setValidation(payload.validation);
      if (payload.automation !== undefined) setAutomation(payload.automation);
      if (payload.settings?.autoPaperEnabled !== undefined) setAutoPaperEnabled(payload.settings.autoPaperEnabled);
      setPaperSettingsStatus("saved");
      if (payload.coinbase) setCoinbase(payload.coinbase);
      setPaperReady(true);
    } catch (error) {
      setPaperMessage(error instanceof Error ? error.message : "Dashboard sync failed");
      setPaperReady(true);
    } finally {
      if (showProgress) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void syncControlPlane(), 0);
    const refresh = window.setInterval(() => void syncControlPlane(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(refresh);
    };
  }, [syncControlPlane]);

  const visibleEvents = useMemo(
    () => feedEvents.filter((event) => filter === "all" || event.bias === filter),
    [feedEvents, filter],
  );
  const activeProfile = profiles[activeAsset];
  const activeConfidenceBand = confidenceBand(activeProfile.confidence);
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
  const unreadAlerts = alerts.filter((alert) => !alert.readAt);
  const coinbaseConnections = coinbase.connections ?? [{
    label: "Coinbase",
    configured: coinbase.configured,
    connected: coinbase.connected,
    mode: coinbase.mode,
    accountCount: coinbase.accountCount,
    permissions: coinbase.permissions,
    message: coinbase.message,
  }];
  const fourHourValidation = validation.horizons.find((item) => item.hours === 4);
  const twentyFourHourValidation = validation.horizons.find((item) => item.hours === 24);

  function selectAsset(symbol: PaperSymbol) {
    setActiveAsset(symbol);
    setPaperSide(profiles[symbol].side);
  }

  async function runPaperTrade() {
    setSyncing(true);
    try {
      const response = await fetch("/api/paper/trade", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: activeAsset, side: paperSide, grossValue: oneTimeOrder }),
      });
      const result = await response.json() as { error?: string; paperAccount?: PaperAccount; trade?: { side: string; symbol: string; marketPrice: number } };
      if (!response.ok || !result.paperAccount || !result.trade) throw new Error(result.error ?? "Paper order failed");
      setPaperAccount(result.paperAccount);
      setPaperMessage(`${result.trade.side} simulated for ${result.trade.symbol} at ${money(result.trade.marketPrice)}.`);
      await syncControlPlane();
    } catch (error) {
      setPaperMessage(error instanceof Error ? error.message : "Paper order failed");
    } finally {
      setSyncing(false);
    }
  }

  const persistPaperSettings = useCallback(async (settings: PaperSettingsDraft) => {
    const response = await fetch("/api/paper/settings", {
      method: "PATCH",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Settings update failed");
  }, []);

  useEffect(() => {
    if (!paperReady) return;
    const settings: PaperSettingsDraft = {
      startingCash: fundAmount,
      dailyLimit: paperAccount.dailyLimit,
      orderSize: paperAccount.orderSize,
      riskLevel: paperAccount.riskLevel,
      autoPaperEnabled,
    };
    const timer = window.setTimeout(() => {
      setPaperSettingsStatus("saving");
      void persistPaperSettings(settings)
        .then(() => setPaperSettingsStatus("saved"))
        .catch((error) => {
          setPaperSettingsStatus("error");
          setPaperMessage(error instanceof Error ? error.message : "Settings update failed");
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    autoPaperEnabled,
    fundAmount,
    paperAccount.dailyLimit,
    paperAccount.orderSize,
    paperAccount.riskLevel,
    paperReady,
    persistPaperSettings,
  ]);

  async function resetPaperAccount() {
    const startingBalance = Math.max(100, Number(fundAmount) || 0);
    const dailyLimit = Math.max(1, Number(paperAccount.dailyLimit) || 0);
    setSyncing(true);
    try {
      const response = await fetch("/api/paper/reset", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startingBalance, dailyLimit }),
      });
      const result = await response.json() as { error?: string; paperAccount?: PaperAccount };
      if (!response.ok || !result.paperAccount) throw new Error(result.error ?? "Reset failed");
      setPaperAccount(result.paperAccount);
      setPaperMessage(`New ${money(startingBalance)} shared paper account funded. Previous simulated history was cleared.`);
      await syncControlPlane();
    } catch (error) {
      setPaperMessage(error instanceof Error ? error.message : "Reset failed");
    } finally {
      setSyncing(false);
    }
  }

  async function depositPaperCash() {
    const amount = Math.max(1, Number(depositAmount) || 0);
    setSyncing(true);
    try {
      const response = await fetch("/api/paper/deposit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const result = await response.json() as { error?: string; paperAccount?: PaperAccount };
      if (!response.ok || !result.paperAccount) throw new Error(result.error ?? "Deposit failed");
      setPaperAccount(result.paperAccount);
      setPaperMessage(`${money(amount)} added once to ${viewer.displayName}'s paper cash without clearing history.`);
      await syncControlPlane();
    } catch (error) {
      setPaperMessage(error instanceof Error ? error.message : "Deposit failed");
    } finally {
      setSyncing(false);
    }
  }

  async function runNow() {
    setSyncing(true);
    setPaperMessage("Refreshing live evidence and evaluating one guarded paper decision…");
    try {
      const response = await fetch("/api/automation/run", { method: "POST", credentials: "same-origin" });
      const result = await response.json() as { error?: string; tradeId?: string | null };
      if (!response.ok) throw new Error(result.error ?? "Automation run failed");
      setPaperMessage(result.tradeId ? "Scheduled logic completed and placed one paper trade." : "Scheduled logic completed; no qualifying paper trade was placed.");
      await syncControlPlane();
    } catch (error) {
      setPaperMessage(error instanceof Error ? error.message : "Automation run failed");
    } finally {
      setSyncing(false);
    }
  }

  async function markAlertsRead() {
    await fetch("/api/alerts/read", { method: "POST", credentials: "same-origin" });
    setAlerts((current) => current.map((alert) => ({ ...alert, readAt: alert.readAt ?? new Date().toISOString() })));
  }

  function toggleAutoPaper(enabled: boolean) {
    setAutoPaperEnabled(enabled);
  }

  async function enableBrowserAlerts() {
    if (!("Notification" in window)) {
      setPaperMessage("This browser does not support desktop notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    setPaperMessage(permission === "granted" ? "Browser alerts enabled on this device." : "Browser notification permission was not granted.");
    if (permission === "granted" && unreadAlerts[0]) {
      new Notification(unreadAlerts[0].title, { body: unreadAlerts[0].body });
    }
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
            {marketSource === "live" ? "LIVE SOURCES · PAPER ONLY" : "CONNECTING LIVE SOURCES"}
          </span>
          <span className="status"><i /> SYSTEM ONLINE</span>
          {/* Full-page navigation avoids an unreliable client-router transition on the hosted build. */}
          <a className="settingsLink" href="/settings">SETTINGS</a>
          <span className="viewerName">{viewer.displayName}</span>
          <button className="avatar" aria-label={`${viewer.displayName} account`}>
            {viewer.displayName.slice(0, 2).toUpperCase()}
          </button>
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
              <div className="assetBadges">
                <span className={`change ${asset.bias}`}>{asset.change}</span>
                <span className={`assetConfidence ${confidenceBand(profiles[asset.symbol].confidence)}`}>
                  {profiles[asset.symbol].confidence}% CONF
                </span>
              </div>
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
              <small>MODEL CONFIDENCE</small>
              <b className={activeConfidenceBand}>{activeConfidenceBand.toUpperCase()}</b>
            </div>
          </div>

          <div className="confidenceMeaning">
            <span>WHAT THIS RATE MEANS</span>
            <p>{confidenceMeaning(activeConfidenceBand)}</p>
          </div>

          <div className="evidenceList">
            {activeProfile.factors.map((factor) => (
              <div key={factor.label}>
                <span className={`evidenceIcon ${factor.value >= 65 ? "bullish" : "neutral"}`}>{factor.label[0]}</span>
                <p><strong>{factor.label}</strong><small>Current source-normalized evidence score</small></p>
                <b>{factor.value}</b>
              </div>
            ))}
          </div>

          <div className="riskCallout">
            <span>INVALIDATION</span>
            <p>{activeProfile.invalidation}</p>
          </div>
        </article>

        <aside className="panel scorePanel">
          <div className="panelHeader compact">
            <div>
              <p className="eyebrow">EXPERIMENTAL MODEL SCORE</p>
              <h2>Confidence anatomy</h2>
            </div>
            <span className={`scoreNumber ${activeConfidenceBand}`}>
              {activeProfile.confidence}<span>/100</span>
            </span>
          </div>
          <div className="scoreBars">
            {activeProfile.factors.map((factor) => (
              <div className="scoreRow" key={factor.label}>
                <div><span>{factor.label}</span><b>{factor.value}</b></div>
                <div className="track"><i style={{ width: `${factor.value}%`, background: factor.color }} /></div>
              </div>
            ))}
          </div>
          <div className="regimeNote">
            <span>MODEL NOTE</span>
            <p>{activeProfile.modelNote}</p>
          </div>
          <div className="confidenceScale" aria-label="Confidence scale">
            <div className={activeConfidenceBand === "high" ? "active high" : "high"}>
              <strong>HIGH</strong><span>75–100</span>
            </div>
            <div className={activeConfidenceBand === "moderate" ? "active moderate" : "moderate"}>
              <strong>MODERATE</strong><span>60–74</span>
            </div>
            <div className={activeConfidenceBand === "low" ? "active low" : "low"}>
              <strong>LOW</strong><span>0–59</span>
            </div>
          </div>
          <p className="confidenceDisclaimer">
            Confidence measures evidence agreement—not the probability of profit. Paper outcomes will be used to calibrate it.
          </p>
        </aside>
      </section>

      <section className="paperSection" id="paper">
        <div className="paperTitleRow">
          <div>
            <p className="eyebrow">FORWARD TEST · PAPER MONEY ONLY</p>
            <h2>{viewer.displayName}&apos;s paper trading lab</h2>
            <p>
              Simulate signal-driven orders, enforce a daily buy limit, and measure
              what the strategy would have earned or lost without touching Coinbase.
            </p>
          </div>
          <span className="paperBadge">PRIVATE LEDGER · NO REAL FUNDS</span>
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

        <div className="comparisonPanel panel" aria-label="Paper performance comparison">
          <div className="comparisonIntro">
            <p className="eyebrow">BROTHER VS BROTHER</p>
            <h3>Performance comparison</h3>
            <p>Results are visible to both of you; controls, alerts, positions, and Coinbase details stay private to each user.</p>
          </div>
          <div className="comparisonGrid">
            {comparison.map((profile) => (
              <article className={profile.isViewer ? "you" : ""} key={profile.id}>
                <div className="comparisonName">
                  <strong>{profile.displayName}</strong>
                  {profile.isViewer && <span>YOU</span>}
                </div>
                <b className={profile.returnPct >= 0 ? "positive" : "negative"}>
                  {profile.returnPct >= 0 ? "+" : ""}{profile.returnPct.toFixed(2)}%
                </b>
                <small>{money(profile.equity)} equity · {signedMoney(profile.totalPnl)} P/L</small>
                <dl>
                  <div><dt>Win rate</dt><dd>{profile.closedTrades ? `${profile.winRate.toFixed(0)}%` : "—"}</dd></div>
                  <div><dt>Drawdown</dt><dd>−{profile.maxDrawdownPct.toFixed(2)}%</dd></div>
                  <div><dt>Risk</dt><dd>{riskLabel(profile.riskLevel)}</dd></div>
                  <div><dt>Daily cap</dt><dd>{money(profile.dailyLimit)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </div>

        <div className="paperGrid">
          <article className="panel paperAccountPanel">
            <div className="paperControls">
              <div className="paperFunding">
                <div className="subhead">
                  <div>
                    <p className="eyebrow">{viewer.displayName.toUpperCase()} · PRIVATE CONTROLS</p>
                    <h3>Risk, funding & guardrails</h3>
                  </div>
                  <button className="ghostButton" type="button" onClick={resetPaperAccount}>
                    Reset & fund
                  </button>
                </div>
                <div className="riskSlider">
                  <div><span>Risk tolerance</span><strong>{paperAccount.riskLevel}/100 · {riskLabel(paperAccount.riskLevel)}</strong></div>
                  <input
                    aria-label="Paper risk tolerance"
                    max="100"
                    min="0"
                    type="range"
                    value={paperAccount.riskLevel}
                    onChange={(event) => {
                      const riskLevel = Number(event.target.value);
                      setPaperAccount((account) => ({
                        ...account,
                        riskLevel,
                        minimumConfidence: minimumConfidenceForRisk(riskLevel),
                      }));
                    }}
                  />
                  <small>Higher risk permits lower-confidence paper signals. It never changes the real-money lock.</small>
                </div>
                <div className="riskSlider dailySlider">
                  <div><span>Daily investment cap</span><strong>{money(paperAccount.dailyLimit)}/day</strong></div>
                  <input
                    aria-label="Daily paper investment cap"
                    max={Math.max(10_000, paperAccount.startingBalance)}
                    min="1"
                    step="1"
                    type="range"
                    value={Math.min(Math.max(10_000, paperAccount.startingBalance), paperAccount.dailyLimit)}
                    onChange={(event) => setPaperAccount((account) => ({ ...account, dailyLimit: Number(event.target.value) }))}
                  />
                  <small>Paper buys stop automatically when your personal daily cap is exhausted; the minimum is $1/day.</small>
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
                      min="1"
                      step="1"
                      type="number"
                      value={paperAccount.dailyLimit}
                      onChange={(event) => setPaperAccount((account) => ({ ...account, dailyLimit: Math.max(1, Number(event.target.value)) }))}
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
                        orderSize: Math.max(1, Number(event.target.value)),
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
                      readOnly
                      value={paperAccount.minimumConfidence}
                    /><i>%</i></span>
                  </label>
                </div>
                <p className={`autoSaveNote ${paperSettingsStatus}`} aria-live="polite">
                  {paperSettingsStatus === "saving" && "Saving your paper settings…"}
                  {paperSettingsStatus === "saved" && `Saved for ${viewer.displayName}. Starting cash applies when you choose Reset & fund.`}
                  {paperSettingsStatus === "error" && "Settings could not be saved. Try changing a value again."}
                  {paperSettingsStatus === "loading" && "Loading your saved paper settings…"}
                </p>
                <div className="depositRow">
                  <div><strong>One-time paper cash injection</strong><small>Add funds without resetting performance history.</small></div>
                  <span className="moneyInput"><i>$</i><input aria-label="One-time paper deposit" min="1" step="100" type="number" value={depositAmount} onChange={(event) => setDepositAmount(Number(event.target.value))} /></span>
                  <button className="ghostButton" disabled={syncing} type="button" onClick={() => void depositPaperCash()}>Add once</button>
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
                  <div><dt>Default order</dt><dd>{money(paperAccount.orderSize)}</dd></div>
                </dl>
                <label className="oneTimeOrder">
                  <span>This one-time paper order</span>
                  <span className="moneyInput"><i>$</i><input aria-label="One-time paper order amount" min="1" step="25" type="number" value={oneTimeOrder} onChange={(event) => setOneTimeOrder(Number(event.target.value))} /></span>
                </label>
                <button className="paperTradeButton" disabled={syncing || !paperReady} type="button" onClick={() => void runPaperTrade()}>
                  {syncing ? "Working…" : `Simulate ${paperSide.toLowerCase()} order`}
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
              <div><span>High-conf hit rate</span><strong>{learning.highConfidenceTrades ? `${learning.highConfidenceWinRate.toFixed(0)}%` : "—"}</strong></div>
              <div><span>High-conf sample</span><strong>{learning.highConfidenceTrades}</strong></div>
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
              Your ledger is isolated by authenticated user in Cloudflare D1; only aggregate comparison metrics are shared.
            </small>
          </aside>
        </div>
      </section>

      <section className="validationSection" aria-labelledby="validation-title">
        <div className="paperTitleRow validationTitle">
          <div>
            <p className="eyebrow">FORWARD VALIDATION · NO LOOK-AHEAD</p>
            <h2 id="validation-title">Signal evidence scorecard</h2>
            <p>
              Every recorded call is automatically checked after 4 and 24 hours.
              Results are net of a {(validation.roundTripCostBps / 100).toFixed(2)}% round-trip cost assumption.
            </p>
          </div>
          <span className={`statePill ${validation.readiness === "review_ready" ? "safe" : "observe"}`}>
            {validation.readiness === "review_ready" ? "REVIEW READY" : "COLLECTING"}
          </span>
        </div>

        <div className="validationMetrics">
          <article>
            <span>24H SAMPLE</span>
            <strong>{validation.primarySample}<small>/{validation.sampleTarget}</small></strong>
            <p>Minimum mature calls before a strategy review</p>
          </article>
          <article>
            <span>4H HIT RATE</span>
            <strong>{fourHourValidation?.sample ? `${fourHourValidation.hitRate.toFixed(1)}%` : "—"}</strong>
            <p>{fourHourValidation?.sample ?? 0} cost-adjusted outcomes</p>
          </article>
          <article>
            <span>24H HIT RATE</span>
            <strong>{twentyFourHourValidation?.sample ? `${twentyFourHourValidation.hitRate.toFixed(1)}%` : "—"}</strong>
            <p>{twentyFourHourValidation?.sample ?? 0} cost-adjusted outcomes</p>
          </article>
          <article>
            <span>24H NET EDGE</span>
            <strong className={(twentyFourHourValidation?.averageNetReturnPct ?? 0) >= 0 ? "positive" : "negative"}>
              {twentyFourHourValidation?.sample
                ? `${(twentyFourHourValidation.averageNetReturnPct ?? 0) >= 0 ? "+" : ""}${twentyFourHourValidation.averageNetReturnPct.toFixed(2)}%`
                : "—"}
            </strong>
            <p>Average directional return after assumed costs</p>
          </article>
        </div>

        <div className="validationGrid">
          <article className="panel calibrationPanel">
            <div className="operationHead">
              <div><p className="eyebrow">CONFIDENCE CALIBRATION</p><h3>Does stronger evidence perform better?</h3></div>
              <span>{validation.highConfidenceSample}/{validation.highConfidenceTarget} HIGH-CONF</span>
            </div>
            <div className="calibrationTable" role="table" aria-label="24-hour confidence calibration">
              <div className="calibrationRow calibrationLabels" role="row">
                <span>BAND</span><span>SAMPLE</span><span>HIT RATE</span><span>NET EDGE</span>
              </div>
              {validation.bands.map((band) => (
                <div className="calibrationRow" role="row" key={band.key}>
                  <strong className={band.key}>{band.label}<small>{band.range}</small></strong>
                  <span>{band.sample}</span>
                  <span>{band.sample ? `${band.hitRate.toFixed(1)}%` : "—"}</span>
                  <span className={band.averageNetReturnPct >= 0 ? "positive" : "negative"}>
                    {band.sample ? `${band.averageNetReturnPct >= 0 ? "+" : ""}${band.averageNetReturnPct.toFixed(2)}%` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel validationMethod">
            <p className="eyebrow">VALIDATION RULES</p>
            <h3>What counts as a correct call</h3>
            <ul>
              <li><strong>Frozen prediction</strong><span>The side and confidence are stored before the outcome exists.</span></li>
              <li><strong>Two horizons</strong><span>Each call matures independently at 4 hours and 24 hours.</span></li>
              <li><strong>Costs included</strong><span>A call must beat {(validation.roundTripCostBps / 100).toFixed(2)}% assumed round-trip drag to count as correct.</span></li>
              <li><strong>Sample gate</strong><span>No model change before {validation.sampleTarget} mature 24-hour calls, including {validation.highConfidenceTarget} high-confidence calls.</span></li>
            </ul>
            <p className="validationFootnote">
              Confidence is evidence agreement—not a guaranteed probability of profit. Historical news, social, and whale data are not reconstructed; this is an honest walk-forward test of the full live signal.
            </p>
          </article>
        </div>
      </section>

      <section className="operationsSection" aria-labelledby="operations-title">
        <div className="paperTitleRow operationsTitle">
          <div>
            <p className="eyebrow">AUTOMATION · MEASUREMENT · SAFETY</p>
            <h2 id="operations-title">Control room</h2>
            <p>The worker refreshes evidence every 15 minutes, records decisions, and keeps real trading locked.</p>
          </div>
          <button className="ghostButton" disabled={syncing} type="button" onClick={() => void syncControlPlane(true)}>
            {syncing ? "Syncing…" : "Refresh dashboard"}
          </button>
        </div>

        <div className="operationsGrid">
          <article className="panel operationCard">
            <div className="operationHead">
              <div><p className="eyebrow">15-MINUTE WORKER</p><h3>Paper autopilot</h3></div>
              <span className={`statePill ${autoPaperEnabled ? "safe" : "off"}`}>{autoPaperEnabled ? "ENABLED" : "PAUSED"}</span>
            </div>
            <div className="switchRow">
              <span><strong>{viewer.displayName}&apos;s automatic paper buys and sells</strong><small>Buys stop at the daily cap; sells are limited to held positions</small></span>
              <input aria-label="Automatic paper decisions" checked={autoPaperEnabled} type="checkbox" onChange={(event) => toggleAutoPaper(event.target.checked)} />
            </div>
            <dl className="operationFacts">
              <div><dt>Last status</dt><dd>{automation?.status ?? "INITIALIZING"}</dd></div>
              <div><dt>Last run</dt><dd>{automation ? relativeTime(automation.startedAt) : "—"}</dd></div>
              <div><dt>Evidence</dt><dd>{automation ? `${automation.events} events / ${automation.signals} signals` : "—"}</dd></div>
            </dl>
            <button className="paperTradeButton" disabled={syncing} type="button" onClick={() => void runNow()}>
              {syncing ? "Running…" : "Run intelligence cycle now"}
            </button>
          </article>

          <article className="panel operationCard">
            <div className="operationHead">
              <div><p className="eyebrow">CALIBRATION</p><h3>Performance benchmark</h3></div>
              <span className="statePill observe">OBSERVE</span>
            </div>
            <div className="benchmarkGrid">
              <div><span>Strategy return</span><strong className={portfolio.returnPct >= 0 ? "positive" : "negative"}>{portfolio.returnPct >= 0 ? "+" : ""}{portfolio.returnPct.toFixed(2)}%</strong></div>
              <div><span>BTC hold</span><strong>{serverPerformance.buyHoldReturnPct >= 0 ? "+" : ""}{serverPerformance.buyHoldReturnPct.toFixed(2)}%</strong></div>
              <div><span>Alpha vs BTC</span><strong className={serverPerformance.alphaVsBtcPct >= 0 ? "positive" : "negative"}>{serverPerformance.alphaVsBtcPct >= 0 ? "+" : ""}{serverPerformance.alphaVsBtcPct.toFixed(2)}%</strong></div>
              <div><span>Max drawdown</span><strong className="negative">−{serverPerformance.maxDrawdownPct.toFixed(2)}%</strong></div>
              <div><span>Execution costs</span><strong>{money(serverPerformance.executionCosts)}</strong></div>
              <div><span>Portfolio samples</span><strong>{serverPerformance.snapshots}</strong></div>
            </div>
            <p className="operationNote">BTC hold uses the same contribution timing as the paper account. Confidence calibration remains observational until the sample gate is met.</p>
          </article>

          <article className="panel operationCard alertsCard">
            <div className="operationHead">
              <div><p className="eyebrow">PERSISTENT ALERTS</p><h3>Decision inbox</h3></div>
              <span className={`statePill ${unreadAlerts.length ? "action" : "safe"}`}>{unreadAlerts.length} UNREAD</span>
            </div>
            <div className="alertList">
              {alerts.slice(0, 3).map((alert) => (
                <div className={alert.readAt ? "read" : ""} key={alert.id}>
                  <i className={alert.severity} />
                  <p><strong>{alert.title}</strong><small>{alert.body}</small></p>
                  <time>{relativeTime(alert.createdAt)}</time>
                </div>
              ))}
              {!alerts.length && <p className="paperEmpty">The first scheduled signal or paper decision will appear here.</p>}
            </div>
            <div className="buttonPair">
              <button className="ghostButton" type="button" onClick={() => void enableBrowserAlerts()}>Enable browser alerts</button>
              <button className="ghostButton" disabled={!unreadAlerts.length} type="button" onClick={() => void markAlertsRead()}>Mark read</button>
            </div>
          </article>

          <article className="panel operationCard coinbaseCard">
            <div className="operationHead">
              <div><p className="eyebrow">COINBASE SAFETY GATE</p><h3>Account hooks</h3></div>
              <span className="statePill locked">TRADING LOCKED</span>
            </div>
            <div className="connectionList">
              {coinbaseConnections.map((connection) => (
                <div key={connection.label}>
                  <span className={`connectionDot ${connection.connected ? "connected" : ""}`} />
                  <p><strong>{connection.label}</strong><small>{connection.message}</small></p>
                  <b>{connection.mode.replaceAll("_", " ").toUpperCase()}</b>
                </div>
              ))}
            </div>
            <div className="safetyLock">
              <strong>Kill switch ON · daily real-money limit $0</strong>
              <p>Only read-only account validation exists. There is no real-order route in this build.</p>
            </div>
            <a className="manageConnection" href="/settings">Open Coinbase settings →</a>
          </article>
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
            <span>TIME</span><span>SOURCE</span><span>EVENT</span><span>EVIDENCE</span>
          </div>
          {visibleEvents.map((event) => (
            <div className="eventRow" role="row" key={event.id}>
              <span className="eventTime">{relativeTime(event.occurredAt)}</span>
              <span><b className={`sourceTag source-${event.source.toLowerCase()}`}>{event.source}</b></span>
              <span className="eventCopy">
                {event.url ? <a href={event.url} rel="noreferrer" target="_blank">{event.headline}</a> : <strong>{event.headline}</strong>}
                <small>{event.asset} · {event.detail}</small>
              </span>
              <span className={`impact ${event.bias}`}><i /> {event.score}/100</span>
            </div>
          ))}
          {visibleEvents.length === 0 && <p className="emptyState">No events match this filter.</p>}
        </div>
      </section>

      <footer>
        <p>Decision support only. Signals are experimental and are not financial advice or a guarantee of returns.</p>
        <span className="appVersion" aria-label="Application version">
          GATCHEK SIGNAL ENGINE · v{packageMetadata.version}
        </span>
      </footer>
    </main>
  );
}
