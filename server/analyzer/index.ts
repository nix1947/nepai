import type { PriceRow } from '../../src/types/market.ts';
import type {
  AnalyzerConfig,
  AnalyzerResponse,
  AnalyzerScanResponse,
  AnalyzerScanRow,
  AnalyzerStrategyFilter,
  AnalyzerTimeframe,
  HtfBiasSummary,
  IntradayCapabilityItem,
  TimeframeBiasSnapshot,
} from '../../src/types/analyzer.ts';
import type { MarketStore } from '../marketStore.ts';
import { getNepseSector } from '../sectors.ts';
import {
  buildAnalyzerBars,
  mergeAnalyzerConfig,
  round2,
} from './config.ts';
import { detectImbalances } from './imbalance.ts';
import { detectLiquidityAndDraw } from './liquidity.ts';
import { detectOrderBlocks } from './orderblocks.ts';
import { analyzePremiumDiscount } from './premiumDiscount.ts';
import { detectPriceAction } from './priceAction.ts';
import { generateStrategySetups } from './strategies.ts';
import { detectMarketStructure } from './structure.ts';
import { detectAllSwings } from './swings.ts';
import { detectSupplyDemandZones, detectWyckoffExperimental } from './zones.ts';

export const EOD_INTRADAY_LIMITS: IntradayCapabilityItem[] = [
  {
    concept: 'Killzones (London / NY / Asian Sessions)',
    status: 'Not Available (EOD Only)',
    eodEquivalent: 'Weekly Open & Power of 3 Accumulation/Manipulation/Expansion phases',
  },
  {
    concept: 'ICT Silver Bullet (10–11 AM / 2–3 PM Windows)',
    status: 'Not Available (EOD Only)',
    eodEquivalent: 'Daily/Weekly Liquidity Sweep -> MSS + Displacement -> Discount FVG',
  },
  {
    concept: '5m / 15m / 1H Micro Entries',
    status: 'Not Available (EOD Only)',
    eodEquivalent: 'Daily EOD Candle Confirmation + Internal Swing Retest',
  },
  {
    concept: 'Intraday Opening Range / Session High-Low',
    status: 'Not Available (EOD Only)',
    eodEquivalent: 'PDH/PDL, PWH/PWL, PMH/PML, and 20/40/60-Day Dealing Ranges',
  },
];

function computeTfBiasSnapshot(
  dailyRowsUpToAsOf: PriceRow[],
  tf: AnalyzerTimeframe,
  cfg: AnalyzerConfig
): TimeframeBiasSnapshot {
  const bars = buildAnalyzerBars(dailyRowsUpToAsOf, tf, cfg.atrPeriod);
  if (bars.length < 4) {
    return {
      timeframe: tf,
      trend: 'Ranging',
      lastBreakKind: null,
      lastBreakDate: null,
      inDiscount: true,
      summary: `${tf}: Insufficient bars (${bars.length}) for structural swing bias.`,
    };
  }

  const tfCfg: AnalyzerConfig =
    tf === '1M'
      ? { ...cfg, swingLeft: 1, swingRight: 1, externalSwingLeft: 2, externalSwingRight: 2 }
      : tf === '1W'
        ? { ...cfg, swingLeft: 2, swingRight: 2, externalSwingLeft: 3, externalSwingRight: 3 }
        : cfg;

  const swings = detectAllSwings(bars, tfCfg);
  const { breaks, trendState } = detectMarketStructure(bars, swings, tfCfg);
  const lastBreak = breaks[breaks.length - 1] ?? null;

  const win = bars.slice(-Math.min(bars.length, 20));
  const hi = Math.max(...win.map((b) => b.high));
  const lo = Math.min(...win.map((b) => b.low));
  const close = bars[bars.length - 1].close;
  const inDiscount = hi > lo ? (close - lo) / (hi - lo) <= 0.52 : true;

  // Fallback bias when timeframe has too few confirmed swings (e.g. Monthly)
  let resolvedTrend = trendState;
  if (resolvedTrend === 'Ranging' && bars.length >= 3) {
    const first = bars[Math.max(0, bars.length - 6)].close;
    const chgPct = ((close - first) / Math.max(0.1, first)) * 100;
    if (chgPct >= 4) resolvedTrend = 'Bullish';
    else if (chgPct <= -4) resolvedTrend = 'Bearish';
  }

  return {
    timeframe: tf,
    trend: resolvedTrend,
    lastBreakKind: lastBreak?.kind ?? null,
    lastBreakDate: lastBreak?.date ?? null,
    inDiscount,
    summary: `${tf}: ${resolvedTrend}${lastBreak ? ` (last ${lastBreak.kind} ${lastBreak.date})` : ''} · ${inDiscount ? 'Discount half' : 'Premium half'}`,
  };
}

function buildHtfBias(dailyRowsUpToAsOf: PriceRow[], cfg: AnalyzerConfig): HtfBiasSummary {
  const monthly = computeTfBiasSnapshot(dailyRowsUpToAsOf, '1M', cfg);
  const weekly = computeTfBiasSnapshot(dailyRowsUpToAsOf, '1W', cfg);
  const daily = computeTfBiasSnapshot(dailyRowsUpToAsOf, '1D', cfg);

  const bullCount = [monthly, weekly, daily].filter((t) => t.trend === 'Bullish').length;
  const bearCount = [monthly, weekly, daily].filter((t) => t.trend === 'Bearish').length;

  let alignmentLabel: HtfBiasSummary['alignmentLabel'] = 'Mixed / Transitional';
  let alignmentScore0to100 = 50;

  if (bullCount === 3 || (monthly.trend === 'Bullish' && weekly.trend === 'Bullish' && daily.trend === 'Bullish')) {
    alignmentLabel = 'Full Bullish Alignment';
    alignmentScore0to100 = 92;
  } else if ((monthly.trend === 'Bullish' || weekly.trend === 'Bullish') && daily.trend !== 'Bullish') {
    alignmentLabel = 'HTF Bullish / LTF Pullback';
    alignmentScore0to100 = 76;
  } else if (bearCount >= 2 && daily.trend === 'Bearish') {
    alignmentLabel = 'Bearish Alignment';
    alignmentScore0to100 = 24;
  } else if (bullCount >= 2) {
    alignmentLabel = 'Full Bullish Alignment';
    alignmentScore0to100 = 80;
  }

  return {
    monthly,
    weekly,
    daily,
    alignmentLabel,
    alignmentScore0to100,
  };
}

export function analyzeBars(params: {
  symbol: string;
  name?: string;
  sector?: string;
  dailyRows: PriceRow[];
  tf?: AnalyzerTimeframe;
  strategy?: AnalyzerStrategyFilter;
  asOfDate?: string;
  config?: Partial<AnalyzerConfig>;
}): AnalyzerResponse {
  const tf: AnalyzerTimeframe = params.tf ?? '1D';
  const strategy: AnalyzerStrategyFilter = params.strategy ?? 'All';
  const cfg = mergeAnalyzerConfig(params.config);

  const sortedDaily = [...params.dailyRows]
    .filter((r) => r.close > 0 && r.open > 0 && r.high > 0 && r.low > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const availableDates = sortedDaily.map((r) => r.date);
  const asOfDate =
    params.asOfDate && availableDates.some((d) => d <= params.asOfDate!)
      ? params.asOfDate
      : availableDates[availableDates.length - 1] ?? '';

  // Strict zero-look-ahead boundary: slice ALL daily rows strictly <= asOfDate BEFORE resampling or detecting
  const dailyUpToAsOf = asOfDate
    ? sortedDaily.filter((r) => r.date <= asOfDate)
    : sortedDaily;

  const activeCfg: AnalyzerConfig =
    tf === '1M'
      ? { ...cfg, swingLeft: 1, swingRight: 1, externalSwingLeft: 2, externalSwingRight: 2 }
      : tf === '1W'
        ? { ...cfg, swingLeft: 2, swingRight: 2, externalSwingLeft: 3, externalSwingRight: 3 }
        : cfg;

  const bars = buildAnalyzerBars(dailyUpToAsOf, tf, activeCfg.atrPeriod);
  const htfBias = buildHtfBias(dailyUpToAsOf, cfg);

  const swings = detectAllSwings(bars, activeCfg);
  const { displacements, breaks, trendState } = detectMarketStructure(bars, swings, activeCfg);
  const imbalances = detectImbalances(bars, activeCfg);
  const orderBlocks = detectOrderBlocks(bars, breaks, displacements, imbalances);
  const { levels: liquidityLevels, drawOnLiquidity } = detectLiquidityAndDraw(
    bars,
    dailyUpToAsOf,
    swings,
    activeCfg
  );
  const premiumDiscount = analyzePremiumDiscount(bars, dailyUpToAsOf, swings, trendState);
  const priceAction = detectPriceAction(bars, swings, activeCfg);
  const supplyDemandZones = detectSupplyDemandZones(bars);
  const wyckoff = detectWyckoffExperimental(bars);

  const tail20Daily = dailyUpToAsOf.slice(-20);
  const latestDaily = dailyUpToAsOf[dailyUpToAsOf.length - 1];
  const avgTurnover20Npr =
    tail20Daily.length > 0
      ? tail20Daily.reduce((s, r) => s + (r.turnover || 0), 0) / tail20Daily.length
      : 0;
  const avgVolume20 =
    tail20Daily.length > 0
      ? tail20Daily.reduce((s, r) => s + (r.volume || 0), 0) / tail20Daily.length
      : 0;

  const setups = generateStrategySetups({
    bars,
    strategyFilter: strategy,
    htfBias,
    trendState,
    breaks,
    displacements,
    imbalances,
    orderBlocks,
    liquidityLevels,
    drawOnLiquidity,
    premiumDiscount,
    candlePatterns: priceAction.candlePatterns,
    srZones: priceAction.srZones,
    chartPatterns: priceAction.chartPatterns,
    breakoutEvents: priceAction.breakoutEvents,
    supplyDemandZones,
    wyckoff,
    avgTurnover20Npr,
    cfg: activeCfg,
  });

  const longSetups = setups.filter((s) => s.direction === 'long');
  const bearishExitWarnings = setups.filter((s) => s.direction === 'short_warning');
  const topLongSetup = longSetups[0] ?? null;

  const circuitLockedBarsCount = bars.filter((b) => b.isUpperCircuit || b.isLowerCircuit).length;
  const corpActionGapCount = bars.filter((b) => b.possibleCorpActionGap).length;
  const passesLiquidityFilter = avgTurnover20Npr >= activeCfg.minDailyTurnoverNpr;

  const lastBar = bars[bars.length - 1];
  const warnings: string[] = [
    'End-of-Day Data Limit: All detections use EOD ShareSansar sessions; intraday killzones, Silver Bullet windows, and 5m/15m entries are unavailable.',
    'NEPSE Long-Only Market: Retail investors cannot short-sell equities; bearish setups act strictly as exit / take-profit alerts for held longs.',
  ];
  if (lastBar?.isUpperCircuit || lastBar?.isLowerCircuit) {
    warnings.push(
      `Circuit Lock Alert (${lastBar.date}): Latest session closed locked at ±10% circuit (${lastBar.diff_pct?.toFixed(2)}%); execution fills may experience queue delays.`
    );
  }
  if (corpActionGapCount > 0) {
    warnings.push(
      `${corpActionGapCount} probable bonus/right adjustment gap(s) detected (>11% overnight dislocation) — flagged and excluded from Fair Value Gaps.`
    );
  }
  if (!passesLiquidityFilter) {
    warnings.push(
      `Thin Liquidity Caution: 20d avg turnover Rs ${(avgTurnover20Npr / 1e5).toFixed(1)}L is below Rs ${(activeCfg.minDailyTurnoverNpr / 1e5).toFixed(0)}L institutional comfort floor.`
    );
  }

  const lastBreak = breaks[breaks.length - 1];
  const activeFvgCount = imbalances.filter(
    (f) => f.kind === 'FVG' && f.status !== 'filled' && f.status !== 'inverted'
  ).length;
  const freshObCount = orderBlocks.filter((o) => o.status === 'fresh' && o.kind === 'OB').length;

  const narrative: string[] = [
    `${params.symbol} (${tf}) shows ${trendState} internal/external market structure with ${htfBias.alignmentLabel} across Monthly (${htfBias.monthly.trend}), Weekly (${htfBias.weekly.trend}), and Daily (${htfBias.daily.trend}).`,
    `Price sits at ${premiumDiscount.pctInRange}% of the ${premiumDiscount.rangeLookbackBars}-bar dealing range (${round2(premiumDiscount.rangeLow)}–${round2(premiumDiscount.rangeHigh)}), placing it in ${premiumDiscount.zoneLabel}.`,
    lastBreak
      ? `Most recent confirmed structure event: ${lastBreak.description}`
      : 'No recent confirmed structure shift within the active window.',
    `Active resting imbalances & POIs: ${activeFvgCount} unmitigated/partial FVG(s), ${freshObCount} fresh Order Block(s), ${priceAction.srZones.length} multi-touch S/R zone(s).`,
    topLongSetup
      ? `Highest-scoring long setup: ${topLongSetup.name} (Grade ${topLongSetup.grade} · ${topLongSetup.score}/100), entry NPR ${topLongSetup.tradePlan.entryLow.toFixed(1)}–${topLongSetup.tradePlan.entryHigh.toFixed(1)}, stop NPR ${topLongSetup.tradePlan.stopLoss.toFixed(1)}, Target 2 NPR ${topLongSetup.tradePlan.target2.toFixed(1)} (1:${topLongSetup.tradePlan.rrT2}).`
      : 'No valid high-conviction long setup is currently active under the selected strategy and filters.',
  ];

  const resolvedName =
    params.name || latestDaily?.name || params.symbol;
  const resolvedSector =
    params.sector || getNepseSector(params.symbol, resolvedName);

  return {
    symbol: params.symbol.toUpperCase(),
    name: resolvedName,
    sector: resolvedSector,
    tf,
    strategy,
    asOfDate,
    availableDates,
    configUsed: activeCfg,
    bars,
    htfBias,
    swings,
    structureBreaks: breaks,
    trendState,
    displacements,
    imbalances,
    orderBlocks,
    liquidityLevels,
    drawOnLiquidity,
    premiumDiscount,
    candlePatterns: priceAction.candlePatterns,
    srZones: priceAction.srZones,
    trendlines: priceAction.trendlines,
    chartPatterns: priceAction.chartPatterns,
    breakoutEvents: priceAction.breakoutEvents,
    vsaSignals: priceAction.vsaSignals,
    supplyDemandZones,
    wyckoff,
    setups,
    topLongSetup,
    bearishExitWarnings,
    narrative,
    warnings,
    eodLimits: EOD_INTRADAY_LIMITS,
    liquidityStats: {
      latestTurnoverNpr: round2(latestDaily?.turnover ?? 0),
      avgTurnover20Npr: round2(avgTurnover20Npr),
      avgVolume20: Math.round(avgVolume20),
      passesLiquidityFilter,
      circuitLockedBarsCount,
      corpActionGapCount,
    },
    disclaimer: 'Educational analysis on end-of-day data. Not investment advice.',
  };
}

export function analyzeSymbolFromStore(
  store: MarketStore,
  params: {
    symbol: string;
    tf?: AnalyzerTimeframe;
    strategy?: AnalyzerStrategyFilter;
    asOf?: string;
    config?: Partial<AnalyzerConfig>;
  }
): AnalyzerResponse | null {
  const sym = params.symbol.trim().toUpperCase();
  const history = store.getSymbolHistory(sym, params.asOf);
  if (history.length === 0) return null;
  const last = history[history.length - 1];
  return analyzeBars({
    symbol: sym,
    name: last.name,
    dailyRows: history,
    tf: params.tf ?? '1D',
    strategy: params.strategy ?? 'All',
    asOfDate: params.asOf,
    config: params.config,
  });
}

export function scanAnalyzerMarket(
  store: MarketStore,
  params: {
    tf?: AnalyzerTimeframe;
    strategy?: AnalyzerStrategyFilter;
    asOf?: string;
    minGrade?: 'A' | 'B' | 'C';
    equityOnly?: boolean;
    config?: Partial<AnalyzerConfig>;
  }
): AnalyzerScanResponse {
  const dates = store.getDates();
  const asOfDate =
    params.asOf && dates.includes(params.asOf) ? params.asOf : dates[dates.length - 1] ?? '';
  const tf: AnalyzerTimeframe = params.tf ?? '1D';
  const strategy: AnalyzerStrategyFilter = params.strategy ?? 'All';
  const minGrade = params.minGrade ?? 'B';
  const minScore = minGrade === 'A' ? 75 : minGrade === 'B' ? 60 : 45;

  if (!asOfDate) {
    return {
      asOfDate: '',
      tf,
      strategy,
      minGrade,
      scannedSymbols: 0,
      qualifyingCount: 0,
      rows: [],
      warnings: ['No EOD market sessions loaded.'],
    };
  }

  const dayRows = store.getDayPrices(asOfDate, params.equityOnly !== false);
  const liquidCandidates = [...dayRows]
    .filter((r) => r.close > 0 && r.turnover >= 500_000)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 95);

  const outRows: AnalyzerScanRow[] = [];
  for (const r of liquidCandidates) {
    const history = store.getSymbolHistory(r.symbol, asOfDate);
    if (history.length < 25) continue;

    const analysis = analyzeBars({
      symbol: r.symbol,
      name: r.name,
      dailyRows: history,
      tf,
      strategy,
      asOfDate,
      config: params.config,
    });

    const top = analysis.topLongSetup;
    if (!top || !top.tradePlan.valid || top.score < minScore) continue;

    outRows.push({
      symbol: analysis.symbol,
      name: analysis.name,
      sector: analysis.sector,
      asOfDate: analysis.asOfDate,
      tf,
      close: r.close,
      avgTurnover20Npr: analysis.liquidityStats.avgTurnover20Npr,
      setupName: top.name,
      strategy: top.strategy,
      grade: top.grade,
      score: top.score,
      entryMid: top.tradePlan.entryMid,
      stopLoss: top.tradePlan.stopLoss,
      target1: top.tradePlan.target1,
      target2: top.tradePlan.target2,
      rrT2: top.tradePlan.rrT2,
      htfAlignment: analysis.htfBias.alignmentLabel,
      hasBearishWarning: analysis.bearishExitWarnings.length > 0,
      tags: top.tags,
    });
  }

  outRows.sort((a, b) => b.score - a.score || b.avgTurnover20Npr - a.avgTurnover20Npr);

  return {
    asOfDate,
    tf,
    strategy,
    minGrade,
    scannedSymbols: liquidCandidates.length,
    qualifyingCount: outRows.length,
    rows: outRows,
    warnings: [
      `Scanned top ${liquidCandidates.length} active NEPSE symbols by turnover on ${asOfDate} (${tf} · ${strategy}) for Grade >= ${minGrade} long setups.`,
    ],
  };
}
