export type PaperSymbol = "BTC" | "ETH" | "SOL";
export type PaperSide = "BUY" | "SELL";

export type PaperPosition = {
  quantity: number;
  costBasis: number;
};

export type PaperTrade = {
  id: string;
  signalId: string;
  createdAt: string;
  symbol: PaperSymbol;
  side: PaperSide;
  quantity: number;
  marketPrice: number;
  grossValue: number;
  executionDrag: number;
  cashImpact: number;
  confidence: number;
  rationale: string;
  realizedPnl: number | null;
};

export type PaperAccount = {
  version: 1;
  createdAt: string;
  startingBalance: number;
  cash: number;
  dailyLimit: number;
  orderSize: number;
  riskLevel: number;
  minimumConfidence: number;
  executionDragBps: number;
  positions: Record<PaperSymbol, PaperPosition>;
  trades: PaperTrade[];
};

export type PaperPrices = Record<PaperSymbol, number>;

export type PaperResult =
  | { ok: true; account: PaperAccount; trade: PaperTrade }
  | { ok: false; account: PaperAccount; message: string };

const symbols: PaperSymbol[] = ["BTC", "ETH", "SOL"];

function emptyPositions(): Record<PaperSymbol, PaperPosition> {
  return {
    BTC: { quantity: 0, costBasis: 0 },
    ETH: { quantity: 0, costBasis: 0 },
    SOL: { quantity: 0, costBasis: 0 },
  };
}

export function createPaperAccount(
  startingBalance = 10_000,
  dailyLimit = 1_000,
  now = new Date(),
): PaperAccount {
  return {
    version: 1,
    createdAt: now.toISOString(),
    startingBalance,
    cash: startingBalance,
    dailyLimit,
    orderSize: Math.min(250, dailyLimit),
    riskLevel: 50,
    minimumConfidence: 65,
    executionDragBps: 30,
    positions: emptyPositions(),
    trades: [],
  };
}

export function isPaperAccount(value: unknown): value is PaperAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<PaperAccount>;
  return (
    account.version === 1 &&
    typeof account.cash === "number" &&
    typeof account.startingBalance === "number" &&
    typeof account.dailyLimit === "number" &&
    typeof account.orderSize === "number" &&
    typeof account.riskLevel === "number" &&
    typeof account.minimumConfidence === "number" &&
    typeof account.executionDragBps === "number" &&
    Array.isArray(account.trades) &&
    !!account.positions &&
    symbols.every((symbol) => {
      const position = account.positions?.[symbol];
      return !!position && typeof position.quantity === "number" && typeof position.costBasis === "number";
    })
  );
}

export function todayBuySpend(account: PaperAccount, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return account.trades
    .filter((trade) => trade.side === "BUY" && trade.createdAt.startsWith(today))
    .reduce((total, trade) => total + trade.grossValue, 0);
}

export function makeSignalId(
  symbol: PaperSymbol,
  side: PaperSide,
  now = new Date(),
) {
  const fifteenMinuteWindow = Math.floor(now.getTime() / (15 * 60 * 1_000));
  return `${symbol}-${side}-${fifteenMinuteWindow}`;
}

export function executePaperTrade(
  account: PaperAccount,
  order: {
    symbol: PaperSymbol;
    side: PaperSide;
    grossValue: number;
    marketPrice: number;
    confidence: number;
    rationale: string;
    signalId?: string;
  },
  now = new Date(),
): PaperResult {
  const signalId = order.signalId ?? makeSignalId(order.symbol, order.side, now);
  const grossValue = Math.round(order.grossValue * 100) / 100;

  if (!Number.isFinite(grossValue) || grossValue <= 0) {
    return { ok: false, account, message: "Enter a paper order larger than $0." };
  }
  if (!Number.isFinite(order.marketPrice) || order.marketPrice <= 0) {
    return { ok: false, account, message: "A valid market price is required." };
  }
  if (order.confidence < account.minimumConfidence) {
    return {
      ok: false,
      account,
      message: `Signal confidence ${order.confidence}% is below the ${account.minimumConfidence}% paper threshold.`,
    };
  }
  if (account.trades.some((trade) => trade.signalId === signalId)) {
    return { ok: false, account, message: "This signal was already paper-traded in the current 15-minute window." };
  }

  const executionDragRate = account.executionDragBps / 10_000;
  const positions = {
    ...account.positions,
    [order.symbol]: { ...account.positions[order.symbol] },
  };
  const current = positions[order.symbol];

  if (order.side === "BUY") {
    const spentToday = todayBuySpend(account, now);
    if (spentToday + grossValue > account.dailyLimit + 0.001) {
      const remaining = Math.max(0, account.dailyLimit - spentToday);
      return {
        ok: false,
        account,
        message: `Daily paper-buy limit reached. $${remaining.toFixed(2)} remains today.`,
      };
    }
    if (grossValue > account.cash + 0.001) {
      return { ok: false, account, message: "The paper account does not have enough cash for this order." };
    }

    const executionDrag = grossValue * executionDragRate;
    const quantity = (grossValue - executionDrag) / order.marketPrice;
    current.quantity += quantity;
    current.costBasis += grossValue;

    const trade: PaperTrade = {
      id: `${signalId}-${account.trades.length + 1}`,
      signalId,
      createdAt: now.toISOString(),
      symbol: order.symbol,
      side: order.side,
      quantity,
      marketPrice: order.marketPrice,
      grossValue,
      executionDrag,
      cashImpact: -grossValue,
      confidence: order.confidence,
      rationale: order.rationale,
      realizedPnl: null,
    };

    return {
      ok: true,
      trade,
      account: {
        ...account,
        cash: account.cash - grossValue,
        positions,
        trades: [trade, ...account.trades],
      },
    };
  }

  if (current.quantity <= 0) {
    return { ok: false, account, message: `There is no ${order.symbol} paper position to sell.` };
  }

  const desiredQuantity = grossValue / order.marketPrice;
  const quantity = Math.min(current.quantity, desiredQuantity);
  const grossProceeds = quantity * order.marketPrice;
  const executionDrag = grossProceeds * executionDragRate;
  const netProceeds = grossProceeds - executionDrag;
  const costRemoved = current.costBasis * (quantity / current.quantity);
  const realizedPnl = netProceeds - costRemoved;

  current.quantity = Math.max(0, current.quantity - quantity);
  current.costBasis = Math.max(0, current.costBasis - costRemoved);
  if (current.quantity < 0.0000000001) {
    current.quantity = 0;
    current.costBasis = 0;
  }

  const trade: PaperTrade = {
    id: `${signalId}-${account.trades.length + 1}`,
    signalId,
    createdAt: now.toISOString(),
    symbol: order.symbol,
    side: order.side,
    quantity,
    marketPrice: order.marketPrice,
    grossValue: grossProceeds,
    executionDrag,
    cashImpact: netProceeds,
    confidence: order.confidence,
    rationale: order.rationale,
    realizedPnl,
  };

  return {
    ok: true,
    trade,
    account: {
      ...account,
      cash: account.cash + netProceeds,
      positions,
      trades: [trade, ...account.trades],
    },
  };
}

export function portfolioSnapshot(account: PaperAccount, prices: PaperPrices) {
  let marketValue = 0;
  let costBasis = 0;

  for (const symbol of symbols) {
    const position = account.positions[symbol];
    marketValue += position.quantity * prices[symbol];
    costBasis += position.costBasis;
  }

  const equity = account.cash + marketValue;
  const realizedPnl = account.trades.reduce(
    (total, trade) => total + (trade.realizedPnl ?? 0),
    0,
  );

  return {
    equity,
    marketValue,
    costBasis,
    unrealizedPnl: marketValue - costBasis,
    realizedPnl,
    totalPnl: equity - account.startingBalance,
    returnPct:
      account.startingBalance > 0
        ? ((equity - account.startingBalance) / account.startingBalance) * 100
        : 0,
  };
}

export function learningSummary(account: PaperAccount) {
  const closedTrades = account.trades.filter(
    (trade): trade is PaperTrade & { realizedPnl: number } => trade.realizedPnl !== null,
  );
  const wins = closedTrades.filter((trade) => trade.realizedPnl > 0);
  const losses = closedTrades.filter((trade) => trade.realizedPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.realizedPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.realizedPnl, 0));
  const winRate = closedTrades.length ? (wins.length / closedTrades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const sampleTarget = 10;
  const highConfidence = closedTrades.filter((trade) => trade.confidence >= 75);
  const highConfidenceWins = highConfidence.filter((trade) => trade.realizedPnl > 0).length;
  const highConfidenceWinRate = highConfidence.length
    ? (highConfidenceWins / highConfidence.length) * 100
    : 0;

  let recommendation = `Collect ${sampleTarget - closedTrades.length} more closed paper trades before changing the confidence threshold.`;
  if (closedTrades.length >= sampleTarget) {
    if (highConfidence.length >= 4 && highConfidenceWinRate >= winRate + 10) {
      recommendation = "Higher-confidence trades are materially stronger. Test raising the entry threshold by 5 points for the next sample.";
    } else if (winRate < 45) {
      recommendation = "The current sample is losing more often than it wins. Pause expansion and review the weakest evidence source before the next run.";
    } else {
      recommendation = "The sample does not justify a threshold change yet. Keep the current rules fixed for another 10 closed trades.";
    }
  }

  return {
    closedTrades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    profitFactor,
    sampleTarget,
    highConfidenceTrades: highConfidence.length,
    highConfidenceWinRate,
    recommendation,
  };
}
