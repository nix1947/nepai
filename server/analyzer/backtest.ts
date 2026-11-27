import type { PriceRow } from '../../src/types/market.ts';
import type {
  AnalyzerBacktestSummary,
  AnalyzerBacktestTrade,
  AnalyzerConfig,
  AnalyzerStrategyFilter,
  AnalyzerTimeframe,
} from '../../src/types/analyzer.ts';
import { calcNepseBuyCost, calcNepseSellProceeds } from '../../src/utils/nepseFees.ts';
import type { MarketStore } from '../marketStore.ts';
import { buildAnalyzerBars, mergeAnalyzerConfig, round2 } from './config.ts';
import { analyzeBars } from './index.ts';

export function runBacktestOnHistories(params: {
  symbolLabel: string | 'MARKET_COHORT';
  histories: Array<{ symbol: string; rows: PriceRow[] }>;
  tf?: AnalyzerTimeframe;
  strategy?: AnalyzerStrategyFilter;
  holdoutRatio?: number;
  minScore?: number;
  maxHoldBars?: number;
  config?: Partial<AnalyzerConfig>;
}): AnalyzerBacktestSummary {
  const tf: AnalyzerTimeframe = params.tf ?? '1D';
  const strategy: AnalyzerStrategyFilter = params.strategy ?? 'All';
  const holdoutRatio = Math.max(0.15, Math.min(0.6, params.holdoutRatio ?? 0.35));
  const minScore = params.minScore ?? 60;
  const maxHoldBars = params.maxHoldBars ?? (tf === '1M' ? 6 : tf === '1W' ? 12 : 22);
  const cfg = mergeAnalyzerConfig(params.config);

  const allTrades: AnalyzerBacktestTrade[] = [];
  let maxBarsObserved = 0;
  let holdoutStartDate: string | null = null;
  let holdoutEndDate: string | null = null;

  for (const item of params.histories) {
    const sorted = [...item.rows]
      .filter((r) => r.close > 0 && r.open > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const bars = buildAnalyzerBars(sorted, tf, cfg.atrPeriod);
    if (bars.length < 32) continue;
    maxBarsObserved = Math.max(maxBarsObserved, bars.length);

    const holdoutStartIdx = Math.max(22, Math.floor(bars.length * (1 - holdoutRatio)));
    const firstDate = bars[holdoutStartIdx]?.date;
    const lastDate = bars[bars.length - 1]?.date;
    if (firstDate && (!holdoutStartDate || firstDate < holdoutStartDate)) holdoutStartDate = firstDate;
    if (lastDate && (!holdoutEndDate || lastDate > holdoutEndDate)) holdoutEndDate = lastDate;

    let cooldownUntilIdx = -1;

    for (let i = holdoutStartIdx; i < bars.length - 2; i++) {
      if (i <= cooldownUntilIdx) continue;
      const signalBar = bars[i];
      if (signalBar.possibleCorpActionGap || signalBar.isUpperCircuit || signalBar.isLowerCircuit) {
        continue;
      }

      // Causal slice strictly up to signalBar.date
      const dailyPrefix = sorted.filter((r) => r.date <= signalBar.date);
      const res = analyzeBars({
        symbol: item.symbol,
        dailyRows: dailyPrefix,
        tf,
        strategy,
        asOfDate: signalBar.date,
        config: cfg,
      });

      const setup = res.topLongSetup;
      if (!setup || !setup.tradePlan.valid || setup.score < minScore) continue;

      // Enter causally at next bar open (t+1)
      const entryBar = bars[i + 1];
      if (entryBar.possibleCorpActionGap || entryBar.isUpperCircuit) continue;

      const entryPrice = entryBar.open;
      const stopLoss = setup.tradePlan.stopLoss;
      const target1 = setup.tradePlan.target1;
      const target2 = setup.tradePlan.target2;
      if (stopLoss >= entryPrice || target2 <= entryPrice) continue;

      const riskPerShare = Math.max(0.2, entryPrice - stopLoss);
      const simShares = Math.max(10, Math.round(50_000 / entryPrice));

      let exitIdx = Math.min(bars.length - 1, i + 1 + maxHoldBars);
      let exitPrice = bars[exitIdx].close;
      let exitReason: AnalyzerBacktestTrade['exitReason'] = 'Max Hold';
      let activeStop = stopLoss;
      let hitT1 = false;

      for (let j = i + 2; j <= Math.min(bars.length - 1, i + 1 + maxHoldBars); j++) {
        const b = bars[j];
        if (b.possibleCorpActionGap) {
          exitIdx = j - 1;
          exitPrice = bars[Math.max(i + 1, j - 1)].close;
          exitReason = hitT1 ? 'Target 1 + Trail' : 'Max Hold';
          break;
        }
        // Conservative worst-case intrabar ordering: check stop before target
        if (b.low <= activeStop) {
          exitIdx = j;
          exitPrice = Math.min(b.open, activeStop);
          exitReason = hitT1 ? 'Target 1 + Trail' : 'Stop Loss';
          break;
        }
        if (b.high >= target2) {
          exitIdx = j;
          exitPrice = target2;
          exitReason = 'Target 2';
          break;
        }
        if (!hitT1 && b.high >= target1) {
          hitT1 = true;
          activeStop = Math.max(activeStop, entryPrice * 1.006);
        }
      }

      const buyCost = calcNepseBuyCost(simShares, entryPrice, 0.2);
      const sellProc = calcNepseSellProceeds(simShares, exitPrice, buyCost.total, 0.2, 0.075);
      const grossReturnPct = round2(((exitPrice - entryPrice) / entryPrice) * 100);
      const netReturnPct = round2((sellProc.netProfit / Math.max(1, buyCost.total)) * 100);
      const rMultipleNet = round2((sellProc.netProfit / simShares) / riskPerShare);

      allTrades.push({
        id: `${item.symbol}-${signalBar.date}-${setup.id}`,
        setupName: setup.name,
        strategy: setup.strategy,
        grade: setup.grade,
        score: setup.score,
        signalDate: signalBar.date,
        entryDate: entryBar.date,
        exitDate: bars[exitIdx].date,
        entryPrice: round2(entryPrice),
        exitPrice: round2(exitPrice),
        stopLoss: round2(stopLoss),
        target2: round2(target2),
        exitReason,
        grossReturnPct,
        netReturnPct,
        rMultipleNet,
        holdingDays: Math.max(1, exitIdx - (i + 1)),
      });

      cooldownUntilIdx = exitIdx;
    }
  }

  allTrades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  const wins = allTrades.filter((t) => t.netReturnPct > 0);
  const losses = allTrades.filter((t) => t.netReturnPct <= 0);
  const totalSetups = allTrades.length;
  const gradeABSetups = allTrades.filter((t) => t.grade === 'A' || t.grade === 'B').length;

  let equity = 100_000;
  let peak = equity;
  let maxDd = 0;
  const equityCurve: AnalyzerBacktestSummary['equityCurve'] = [
    { index: 0, date: holdoutStartDate ?? '', equityNpr: equity, drawdownPct: 0 },
  ];

  allTrades.forEach((t, idx) => {
    const posWeight = 0.2;
    equity = equity * (1 + (t.netReturnPct / 100) * posWeight);
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDd = Math.max(maxDd, dd);
    equityCurve.push({
      index: idx + 1,
      date: t.exitDate,
      equityNpr: Math.round(equity),
      drawdownPct: round2(dd),
    });
  });

  const sumPos = wins.reduce((s, t) => s + t.netReturnPct, 0);
  const sumNeg = Math.abs(losses.reduce((s, t) => s + t.netReturnPct, 0));

  return {
    symbol: params.symbolLabel,
    tf,
    strategy,
    holdoutRatio,
    totalBars: maxBarsObserved,
    holdoutStartDate,
    holdoutEndDate,
    totalSetups,
    gradeABSetups,
    wins: wins.length,
    losses: losses.length,
    winRatePct: totalSetups > 0 ? round2((wins.length / totalSetups) * 100) : null,
    avgNetReturnPct:
      totalSetups > 0
        ? round2(allTrades.reduce((s, t) => s + t.netReturnPct, 0) / totalSetups)
        : null,
    avgRMultiple:
      totalSetups > 0
        ? round2(allTrades.reduce((s, t) => s + t.rMultipleNet, 0) / totalSetups)
        : null,
    expectancyR:
      totalSetups > 0
        ? round2(allTrades.reduce((s, t) => s + t.rMultipleNet, 0) / totalSetups)
        : null,
    profitFactor: sumNeg > 0 ? round2(sumPos / sumNeg) : sumPos > 0 ? 9.99 : null,
    maxDrawdownPct: round2(maxDd),
    equityCurve,
    sampleTrades: allTrades.slice(-25).reverse(),
    note: `Strict chronological hold-out validation (${Math.round(holdoutRatio * 100)}% trailing out-of-sample window) with causal t+1 open entries, conservative stop-first ordering, NEPSE fees + 0.2% slippage + 7.5% CGT. Past performance does not guarantee future results.`,
  };
}

export function runAnalyzerBacktest(
  store: MarketStore,
  params: {
    symbol?: string;
    tf?: AnalyzerTimeframe;
    strategy?: AnalyzerStrategyFilter;
    holdoutRatio?: number;
    equityOnly?: boolean;
    config?: Partial<AnalyzerConfig>;
  }
): AnalyzerBacktestSummary {
  const dates = store.getDates();
  const latest = dates[dates.length - 1];
  if (!latest) {
    return {
      symbol: params.symbol || 'MARKET_COHORT',
      tf: params.tf ?? '1D',
      strategy: params.strategy ?? 'All',
      holdoutRatio: params.holdoutRatio ?? 0.35,
      totalBars: 0,
      holdoutStartDate: null,
      holdoutEndDate: null,
      totalSetups: 0,
      gradeABSetups: 0,
      wins: 0,
      losses: 0,
      winRatePct: null,
      avgNetReturnPct: null,
      avgRMultiple: null,
      expectancyR: null,
      profitFactor: null,
      maxDrawdownPct: null,
      equityCurve: [],
      sampleTrades: [],
      note: 'No market data loaded.',
    };
  }

  if (params.symbol) {
    const clean = params.symbol.trim().toUpperCase();
    const rows = store.getSymbolHistory(clean);
    return runBacktestOnHistories({
      symbolLabel: clean,
      histories: [{ symbol: clean, rows }],
      tf: params.tf,
      strategy: params.strategy,
      holdoutRatio: params.holdoutRatio,
      config: params.config,
    });
  }

  // Market cohort hold-out backtest across top 15 liquid stocks
  const topLiquid = [...store.getDayPrices(latest, params.equityOnly !== false)]
    .filter((r) => r.close > 0 && r.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 15);

  const histories = topLiquid.map((r) => ({
    symbol: r.symbol,
    rows: store.getSymbolHistory(r.symbol),
  }));

  return runBacktestOnHistories({
    symbolLabel: 'MARKET_COHORT',
    histories,
    tf: params.tf,
    strategy: params.strategy,
    holdoutRatio: params.holdoutRatio,
    config: params.config,
  });
}
