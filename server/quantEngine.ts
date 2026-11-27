import type { PriceRow } from '../src/types/market.ts';
import type {
  BacktestResponse,
  DataQualityIssue,
  DataQualityReport,
  EntryConditionCheck,
  EntryTimingPlan,
  ExitManagementPlan,
  MarketRegimeLabel,
  MarketRegimeReport,
  MonteCarloStressSummary,
  NepseIndexPoint,
  PositionSizingPlan,
  QuantEngineConfig,
  QuantEngineResponse,
  QuantStockCandidate,
  RegimeConditionalStat,
  SectorRegimeStrength,
  SetupStatisticalSummary,
  SetupStrategyKind,
  SimulatedTradeRecord,
  StockIndicatorsSnapshot,
  SymbolDataQuality,
  TechnicalComponentScore,
  TradeClassification,
  WalkForwardFold,
} from '../src/types/quant.ts';
import {
  calcNepseBrokerFee,
  calcNepseBuyCost,
  calcNepseSellProceeds,
} from '../src/utils/nepseFees.ts';
import type { MarketStore } from './marketStore.ts';
import { loadAllFundamentalAudits } from './riskEngine.ts';
import { getNepseSector } from './sectors.ts';

export { calcNepseBrokerFee, calcNepseBuyCost, calcNepseSellProceeds };

export const DEFAULT_QUANT_CONFIG: QuantEngineConfig = {
  minAvgDailyTurnover: 1_000_000, // NPR 10 lakh
  minAvgDailyVolume: 1_500,
  minDaysHistory: 25,
  bullishBreadthMinPct: 55,
  bearishBreadthMaxPct: 40,
  weights: {
    trendStrength: 20,
    momentum: 20,
    relativeStrength: 15,
    volumeStrength: 20,
    breakoutStructure: 15,
    vwapBehavior: 10,
  },
  costs: {
    slippagePct: 0.35,
    cgtRate: 0.075,
    maxVolumeParticipationPct: 5,
  },
  backtest: {
    holdingDays: 15,
    stopAtrMult: 1.5,
    target1R: 1.5,
    target2R: 3.0,
    minSampleSize: 8,
    inSampleRatio: 0.6,
    walkForwardFolds: 3,
    breakoutVolMult: 1.5,
    vcpMaxBaseRangePct: 16,
    pullbackMaxSmaDistPct: 4.5,
  },
  risk: {
    portfolioValue: 500_000,
    riskPctPerTrade: 1.5,
    maxSingleStockPct: 20,
    maxSectorConcentrationPct: 35,
    maxPortfolioOpenRiskPct: 6,
    enforceTenKitta: false,
    allowBearishNewEntries: false,
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clip(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stdDev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  const variance = vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function downsideDev(vals: number[], mar = 0): number {
  if (vals.length < 2) return 0;
  const sq = vals.map((v) => (v < mar ? (v - mar) ** 2 : 0));
  return Math.sqrt(sq.reduce((a, b) => a + b, 0) / vals.length);
}

// SEBON fee functions imported & re-exported from ../src/utils/nepseFees.ts

function computeMonteCarloSequenceStress(
  trades: SimulatedTradeRecord[],
  initialEquityNpr: number,
  observedFinalEquityNpr: number,
  observedMaxDrawdownPct: number
): MonteCarloStressSummary | undefined {
  if (trades.length < 10 || initialEquityNpr <= 0) return undefined;
  const trials = 1000;
  const weight = 0.15;
  const baseReturns = trades.map((t) => t.netReturnPct);
  const n = baseReturns.length;

  // Deterministic Mulberry32 PRNG so audit outputs are reproducible per dataset
  let seed = 421947;
  const nextRand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const finalEquities: number[] = [];
  const maxDrawdowns: number[] = [];
  const maxLossStreaks: number[] = [];
  let profitableCount = 0;

  for (let tr = 0; tr < trials; tr++) {
    let eq = initialEquityNpr;
    let peak = eq;
    let maxDd = 0;
    let streak = 0;
    let worstStreak = 0;

    for (let i = 0; i < n; i++) {
      const r = baseReturns[Math.floor(nextRand() * n)];
      eq = eq * (1 + (r / 100) * weight);
      peak = Math.max(peak, eq);
      const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (dd > maxDd) maxDd = dd;
      if (r <= 0) {
        streak++;
        if (streak > worstStreak) worstStreak = streak;
      } else {
        streak = 0;
      }
    }

    finalEquities.push(Math.round(eq));
    maxDrawdowns.push(round2(maxDd));
    maxLossStreaks.push(worstStreak);
    if (eq > initialEquityNpr) profitableCount++;
  }

  finalEquities.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);
  maxLossStreaks.sort((a, b) => a - b);

  const pickPct = <T>(arr: T[], q: number) =>
    arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))))];

  return {
    trials,
    tradeCount: n,
    positionWeightPct: weight * 100,
    initialEquityNpr,
    observedFinalEquityNpr,
    observedMaxDrawdownPct,
    medianFinalEquityNpr: pickPct(finalEquities, 0.5),
    p5FinalEquityNpr: pickPct(finalEquities, 0.05),
    p95FinalEquityNpr: pickPct(finalEquities, 0.95),
    medianMaxDrawdownPct: pickPct(maxDrawdowns, 0.5),
    p95WorstDrawdownPct: pickPct(maxDrawdowns, 0.95),
    p99WorstDrawdownPct: pickPct(maxDrawdowns, 0.99),
    probabilityOfProfitPct: round1((profitableCount / trials) * 100),
    maxConsecutiveLossesP95: pickPct(maxLossStreaks, 0.95),
    methodologyNote:
      `1,000 deterministic bootstrap resamples (with replacement) from the ${n} actual historical simulated net trade returns (15% allocation weight per trade). Measures both outcome variance and sequence drawdown risk without fabricating synthetic trades.`,
  };
}

// Wilson score 95% confidence interval for binomial win rate
function wilsonCi95(wins: number, total: number): [number | null, number | null] {
  if (total <= 0) return [null, null];
  const z = 1.96;
  const p = wins / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denom;
  return [round1(clip((center - margin) * 100, 0, 100)), round1(clip((center + margin) * 100, 0, 100))];
}

function mergeConfig(partial?: Partial<QuantEngineConfig>): QuantEngineConfig {
  if (!partial) return DEFAULT_QUANT_CONFIG;
  return {
    ...DEFAULT_QUANT_CONFIG,
    ...partial,
    weights: { ...DEFAULT_QUANT_CONFIG.weights, ...(partial.weights || {}) },
    costs: { ...DEFAULT_QUANT_CONFIG.costs, ...(partial.costs || {}) },
    backtest: { ...DEFAULT_QUANT_CONFIG.backtest, ...(partial.backtest || {}) },
    risk: { ...DEFAULT_QUANT_CONFIG.risk, ...(partial.risk || {}) },
  };
}

// ---------------------------------------------------------------------------
// Causal Indicator Calculations (pure functions over prefix slice 0..idx)
// ---------------------------------------------------------------------------
function calcSma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function calcEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function calcRsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= 14; i++) {
    const chg = closes[i] - closes[i - 1];
    if (chg > 0) avgGain += chg;
    else avgLoss += -chg;
  }
  avgGain /= 14;
  avgLoss /= 14;
  for (let i = 15; i < closes.length; i++) {
    const chg = closes[i] - closes[i - 1];
    avgGain = (avgGain * 13 + (chg > 0 ? chg : 0)) / 14;
    avgLoss = (avgLoss * 13 + (chg < 0 ? -chg : 0)) / 14;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return round2(100 - 100 / (1 + rs));
}

function calcMacd(closes: number[]): { macd: number | null; signal: number | null; hist: number | null } {
  if (closes.length < 30) return { macd: null, signal: null, hist: null };
  const ema12 = calcEmaSeries(closes, 12);
  const ema26 = calcEmaSeries(closes, 26);
  const macdSeries = ema12.map((v, i) => v - ema26[i]);
  const sigSeries = calcEmaSeries(macdSeries, 9);
  const m = macdSeries[macdSeries.length - 1];
  const s = sigSeries[sigSeries.length - 1];
  return { macd: round2(m), signal: round2(s), hist: round2(m - s) };
}

function calcAtr14(bars: PriceRow[]): number | null {
  if (bars.length < 15) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close > 0 ? bars[i - 1].close : bars[i].prev_close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(Math.max(0, tr));
  }
  if (trs.length < 14) return null;
  let atr = mean(trs.slice(0, 14));
  for (let i = 14; i < trs.length; i++) {
    atr = (atr * 13 + trs[i]) / 14;
  }
  return round2(atr);
}

function calcAdx14(bars: PriceRow[]): number | null {
  if (bars.length < 29) return null;
  const trs: number[] = [];
  const plusDms: number[] = [];
  const minusDms: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const ph = bars[i - 1].high;
    const pl = bars[i - 1].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const upMove = h - ph;
    const dnMove = pl - l;
    plusDms.push(upMove > dnMove && upMove > 0 ? upMove : 0);
    minusDms.push(dnMove > upMove && dnMove > 0 ? dnMove : 0);
  }
  let tr14 = trs.slice(0, 14).reduce((a, b) => a + b, 0);
  let p14 = plusDms.slice(0, 14).reduce((a, b) => a + b, 0);
  let m14 = minusDms.slice(0, 14).reduce((a, b) => a + b, 0);
  const dxList: number[] = [];
  for (let i = 14; i < trs.length; i++) {
    if (i > 14) {
      tr14 = tr14 - tr14 / 14 + trs[i];
      p14 = p14 - p14 / 14 + plusDms[i];
      m14 = m14 - m14 / 14 + minusDms[i];
    }
    if (tr14 <= 0) continue;
    const pdi = (p14 / tr14) * 100;
    const mdi = (m14 / tr14) * 100;
    const sum = pdi + mdi;
    dxList.push(sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
  }
  if (dxList.length < 14) return null;
  let adx = mean(dxList.slice(0, 14));
  for (let i = 14; i < dxList.length; i++) {
    adx = (adx * 13 + dxList[i]) / 14;
  }
  return round1(adx);
}

function detectVcpStructure(bars: PriceRow[], maxBaseRangePct: number): {
  detected: boolean;
  contractions: number;
  dryUpRatio: number | null;
  baseHigh: number | null;
  baseLow: number | null;
} {
  if (bars.length < 21) {
    return { detected: false, contractions: 0, dryUpRatio: null, baseHigh: null, baseLow: null };
  }
  const win = bars.slice(-25, -1); // strictly prior to current bar to avoid self-distortion
  if (win.length < 18) {
    return { detected: false, contractions: 0, dryUpRatio: null, baseHigh: null, baseLow: null };
  }
  const s1 = win.slice(0, 8);
  const s2 = win.slice(8, 16);
  const s3 = win.slice(16);

  const rangePct = (seg: PriceRow[]): number => {
    const hi = Math.max(...seg.map((r) => r.high));
    const lo = Math.min(...seg.map((r) => (r.low > 0 ? r.low : r.close)));
    return lo > 0 ? ((hi - lo) / lo) * 100 : 99;
  };

  const r1 = rangePct(s1);
  const r2 = rangePct(s2);
  const r3 = rangePct(s3);
  const baseHigh = Math.max(...win.map((r) => r.high));
  const baseLow = Math.min(...win.map((r) => (r.low > 0 ? r.low : r.close)));
  const totalRange = baseLow > 0 ? ((baseHigh - baseLow) / baseLow) * 100 : 99;

  const avgVol20 = mean(win.map((r) => r.volume));
  const avgVol5 = mean(win.slice(-5).map((r) => r.volume));
  const dryUpRatio = avgVol20 > 0 ? round2(avgVol5 / avgVol20) : null;

  let contractions = 0;
  if (r2 < r1 * 0.92) contractions++;
  if (r3 < r2 * 0.92) contractions++;
  if (r3 < r1 * 0.72) contractions = Math.max(contractions, 2);

  const detected =
    totalRange <= maxBaseRangePct * 1.35 &&
    contractions >= 2 &&
    r3 <= 9.5 &&
    (dryUpRatio === null || dryUpRatio <= 0.95);

  return {
    detected,
    contractions,
    dryUpRatio,
    baseHigh: round2(baseHigh),
    baseLow: round2(baseLow),
  };
}

// ---------------------------------------------------------------------------
// 1. Data Quality & Validation Engine
// ---------------------------------------------------------------------------
function validateMarketData(
  store: MarketStore,
  datesUpTo: string[],
  asOfDate: string,
  equityOnly: boolean
): {
  report: DataQualityReport;
  qualityBySymbol: Map<string, SymbolDataQuality>;
  anomalousBarKeys: Set<string>;
} {
  const qualityBySymbol = new Map<string, SymbolDataQuality>();
  const anomalousBarKeys = new Set<string>();
  const issues: DataQualityIssue[] = [];

  const counts = {
    missingRecords: 0,
    duplicateEntries: 0,
    stalePrices: 0,
    anomalousValues: 0,
    corporateActionSuspects: 0,
    missingReferenceFields: 0,
    illiquidExcluded: 0,
  };

  const allSymbolsSeen = new Set<string>();
  const histBySym = new Map<string, PriceRow[]>();

  for (const d of datesUpTo) {
    const dayRows = store.getDayPrices(d, false);
    const seenOnDay = new Set<string>();
    for (const r of dayRows) {
      if (equityOnly && (/\d/.test(r.symbol) || r.close < 50)) continue;
      allSymbolsSeen.add(r.symbol);
      if (seenOnDay.has(r.symbol)) {
        counts.duplicateEntries++;
        if (issues.length < 150) {
          issues.push({
            symbol: r.symbol,
            date: d,
            category: 'duplicate_entry',
            severity: 'error',
            detail: `Duplicate symbol row found on ${d}.`,
          });
        }
        continue;
      }
      seenOnDay.add(r.symbol);
      let list = histBySym.get(r.symbol);
      if (!list) {
        list = [];
        histBySym.set(r.symbol, list);
      }
      list.push(r);
    }
  }

  const totalSessions = datesUpTo.length;
  const recentWindowDates = datesUpTo.slice(-Math.min(20, totalSessions));
  let validCount = 0;
  let warningCount = 0;
  let excludedCount = 0;

  for (const sym of Array.from(allSymbolsSeen).sort()) {
    const bars = histBySym.get(sym) || [];
    const lastBar = bars[bars.length - 1];
    const reasons: string[] = [];
    let staleConsecutive = 0;
    let anomalousBars = 0;
    let corpSuspects = 0;

    // Count stale streak from most recent bar backward
    for (let i = bars.length - 1; i >= 0; i--) {
      const b = bars[i];
      if (b.volume <= 0 || (b.high === b.low && b.close === b.prev_close && b.trans <= 1)) {
        staleConsecutive++;
      } else {
        break;
      }
    }
    if (staleConsecutive >= 3) {
      counts.stalePrices++;
      reasons.push(`Stale trading activity (${staleConsecutive} consecutive zero/flat sessions)`);
      if (issues.length < 150) {
        issues.push({
          symbol: sym,
          date: lastBar?.date || asOfDate,
          category: 'stale_price',
          severity: staleConsecutive >= 5 ? 'error' : 'warning',
          detail: `${staleConsecutive} consecutive sessions with zero volume or frozen price.`,
        });
      }
    }

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (
        b.close <= 0 ||
        b.open <= 0 ||
        b.high < b.low ||
        b.close > b.high * 1.005 ||
        b.close < b.low * 0.995 ||
        b.volume < 0 ||
        b.turnover < 0
      ) {
        anomalousBars++;
        anomalousBarKeys.add(`${sym}::${b.date}`);
        counts.anomalousValues++;
        if (issues.length < 150) {
          issues.push({
            symbol: sym,
            date: b.date,
            category: 'anomalous_ohlc',
            severity: 'error',
            detail: `OHLC integrity failure on ${b.date} (O:${b.open} H:${b.high} L:${b.low} C:${b.close}).`,
          });
        }
      }

      if (i > 0) {
        const prev = bars[i - 1].close;
        if (prev > 0 && b.close > 0) {
          const ret = (b.close / prev - 1) * 100;
          if (ret < -12.5 || ret > 12.5) {
            corpSuspects++;
            anomalousBarKeys.add(`${sym}::${b.date}`);
            counts.corporateActionSuspects++;
            if (issues.length < 150) {
              issues.push({
                symbol: sym,
                date: b.date,
                category: 'corporate_action_suspect',
                severity: 'warning',
                detail: `Single-session price jump of ${ret.toFixed(1)}% exceeds NEPSE ±10% circuit limit — possible unadjusted bonus/right/split event. Excluded from return compounding without look-ahead adjustment.`,
              });
            }
          }
        }
      }
    }

    const recentBarsCount = bars.filter((b) => recentWindowDates.includes(b.date)).length;
    const missingRecent = recentWindowDates.length - recentBarsCount;
    if (missingRecent >= 4) {
      counts.missingRecords++;
      reasons.push(`Missing ${missingRecent} of last ${recentWindowDates.length} market sessions`);
    }

    if (lastBar && (lastBar.d120 === null || lastBar.w52_high === null)) {
      counts.missingReferenceFields++;
    }

    const presentOnAsOf = lastBar?.date === asOfDate;
    if (!presentOnAsOf) {
      reasons.push(`Did not trade / absent on ${asOfDate} (last traded ${lastBar?.date || 'never'})`);
    }
    if (corpSuspects > 0) {
      reasons.push(`${corpSuspects} potential unadjusted corporate-action jump(s) detected`);
    }
    if (anomalousBars > 0) {
      reasons.push(`${anomalousBars} anomalous OHLC bar(s)`);
    }

    const vwapSource: SymbolDataQuality['vwapSource'] = !lastBar
      ? 'Unavailable'
      : lastBar.vwap !== null && lastBar.vwap > 0
        ? 'ShareSansar EOD VWAP'
        : lastBar.volume > 0 && lastBar.turnover > 0
          ? 'OHLCV-Derived Approximation'
          : 'Unavailable';

    let status: SymbolDataQuality['status'] = 'Valid';
    if (!presentOnAsOf || staleConsecutive >= 5 || (lastBar?.close ?? 0) <= 0) {
      status = 'Excluded';
      excludedCount++;
    } else if (reasons.length > 0) {
      status = 'Warning';
      warningCount++;
    } else {
      validCount++;
    }

    qualityBySymbol.set(sym, {
      symbol: sym,
      status,
      totalSessionsPresent: bars.length,
      expectedSessions: totalSessions,
      missingSessions: Math.max(0, totalSessions - bars.length),
      staleConsecutiveDays: staleConsecutive,
      anomalousBarCount: anomalousBars,
      corporateActionSuspectCount: corpSuspects,
      vwapSource,
      reasons,
    });
  }

  const penalty =
    allSymbolsSeen.size > 0
      ? ((counts.anomalousValues * 1.5 +
          counts.duplicateEntries * 2 +
          counts.stalePrices * 0.7 +
          counts.corporateActionSuspects * 0.5 +
          counts.missingRecords * 0.4) /
          Math.max(1, allSymbolsSeen.size)) *
        12
      : 0;
  const overallQualityScore = round1(clip(100 - penalty, 25, 100));

  return {
    report: {
      asOfDate,
      totalSessionsInStore: totalSessions,
      dateRange: {
        start: datesUpTo[0] || '',
        end: asOfDate,
      },
      totalSymbolsSeen: allSymbolsSeen.size,
      validSymbolsCount: validCount,
      warningSymbolsCount: warningCount,
      excludedSymbolsCount: excludedCount,
      overallQualityScore,
      issueCounts: counts,
      flaggedIssues: issues.slice(0, 80),
      auditNote:
        'All quality checks run strictly on dates <= asOfDate without retroactive look-ahead adjustments. Potential bonus/right-share price gaps >12.5% are flagged and quarantined from return statistics.',
    },
    qualityBySymbol,
    anomalousBarKeys,
  };
}

// ---------------------------------------------------------------------------
// 2. Causal NEPSE Composite Proxy & Market Regime Detection Engine
// ---------------------------------------------------------------------------
function buildCausalMarketRegimeSeries(
  store: MarketStore,
  datesUpTo: string[],
  equityOnly: boolean,
  anomalousBarKeys: Set<string>,
  config: QuantEngineConfig
): {
  series: NepseIndexPoint[];
  regimeByDate: Map<string, MarketRegimeLabel>;
  latestRegime: MarketRegimeReport;
} {
  let eqIdx = 2000;
  let twIdx = 2000;
  let peakEq = 2000;

  const series: NepseIndexPoint[] = [];
  const eqValues: number[] = [];
  const dailyReturns: number[] = [];
  const dailyTurnovers: number[] = [];
  const dailyVolumes: number[] = [];
  const regimeByDate = new Map<string, MarketRegimeLabel>();

  // Rolling symbol closes to compute causal % > SMA20 / SMA50 across market
  const symCloses = new Map<string, number[]>();

  let latestBreadth20 = 50;
  let latestBreadth50 = 50;
  let latestBreadth120 = 50;
  let latestBreadth180 = 50;
  let latestAdv = 0;
  let latestDec = 0;
  let latestUnch = 0;
  let latestTurn = 0;
  let latestVol = 0;
  let latestSma20Slope: number | null = null;
  let latestSma50Slope: number | null = null;

  for (let di = 0; di < datesUpTo.length; di++) {
    const d = datesUpTo[di];
    const rows = store.getDayPrices(d, equityOnly);
    const rets: number[] = [];
    let twNum = 0;
    let twDen = 0;
    let adv = 0;
    let dec = 0;
    let unch = 0;
    let turnSum = 0;
    let volSum = 0;
    let above20 = 0;
    let elig20 = 0;
    let above50 = 0;
    let elig50 = 0;
    let above120 = 0;
    let elig120 = 0;
    let above180 = 0;
    let elig180 = 0;

    for (const r of rows) {
      turnSum += r.turnover || 0;
      volSum += r.volume || 0;
      if (r.diff > 0) adv++;
      else if (r.diff < 0) dec++;
      else unch++;

      if (!anomalousBarKeys.has(`${r.symbol}::${d}`) && r.prev_close > 0 && r.close > 0) {
        const ret = (r.close - r.prev_close) / r.prev_close;
        if (Math.abs(ret) <= 0.115) {
          rets.push(ret);
          const w = Math.max(r.turnover, 1);
          twNum += ret * w;
          twDen += w;
        }
      }

      let histC = symCloses.get(r.symbol);
      if (!histC) {
        histC = [];
        symCloses.set(r.symbol, histC);
      }
      if (r.close > 0) histC.push(r.close);

      const s20 = calcSma(histC, 20);
      if (s20 !== null) {
        elig20++;
        if (r.close > s20) above20++;
      }
      const s50 = calcSma(histC, 50);
      if (s50 !== null) {
        elig50++;
        if (r.close > s50) above50++;
      }
      if (r.d120 && r.d120 > 0) {
        elig120++;
        if (r.close > r.d120) above120++;
      }
      if (r.d180 && r.d180 > 0) {
        elig180++;
        if (r.close > r.d180) above180++;
      }
    }

    const eqRet = rets.length > 0 ? mean(rets) : 0;
    const twRet = twDen > 0 ? twNum / twDen : eqRet;
    if (di > 0) {
      eqIdx = eqIdx * (1 + eqRet);
      twIdx = twIdx * (1 + twRet);
    }
    peakEq = Math.max(peakEq, eqIdx);
    const ddPct = peakEq > 0 ? round2(((eqIdx - peakEq) / peakEq) * 100) : 0;

    eqValues.push(eqIdx);
    dailyReturns.push(eqRet * 100);
    dailyTurnovers.push(turnSum);
    dailyVolumes.push(volSum);

    const sma20 = calcSma(eqValues, 20);
    const sma50 = calcSma(eqValues, 50);
    const sma200 = calcSma(eqValues, 200);
    const adRatio = dec > 0 ? round2(adv / dec) : adv > 0 ? adv : 1;

    const b20 = elig20 > 0 ? (above20 / elig20) * 100 : (adv / Math.max(1, adv + dec)) * 100;
    const b50 = elig50 > 0 ? (above50 / elig50) * 100 : b20;
    const b120 = elig120 > 0 ? (above120 / elig120) * 100 : b50;
    const b180 = elig180 > 0 ? (above180 / elig180) * 100 : b120;

    const prevSeries5 = series.length >= 5 ? series[series.length - 5] : null;
    const prevSeries10 = series.length >= 10 ? series[series.length - 10] : null;
    const s20Slope =
      sma20 !== null && prevSeries5?.sma20 ? round2(((sma20 - prevSeries5.sma20) / prevSeries5.sma20) * 100) : null;
    const s50Slope =
      sma50 !== null && prevSeries10?.sma50 ? round2(((sma50 - prevSeries10.sma50) / prevSeries10.sma50) * 100) : null;

    // Causal regime score at date d
    let score = 0;
    if (sma20 !== null && eqIdx > sma20) score += 20;
    else if (sma20 === null && eqRet > 0) score += 10;

    if (sma50 !== null && eqIdx > sma50) score += 20;
    else if (sma50 === null && b120 >= 50) score += 10;

    if (s20Slope !== null && s20Slope > 0) score += 10;
    if (s50Slope !== null && s50Slope > 0) score += 10;

    score += clip((b20 / 100) * 20, 0, 20);
    score += clip((b120 / 100) * 10, 0, 10);

    const avgTurn20 = mean(dailyTurnovers.slice(-20));
    const turnRatio = avgTurn20 > 0 ? turnSum / avgTurn20 : 1;
    score += turnRatio >= 1.1 ? 10 : turnRatio >= 0.85 ? 5 : 2;

    const regime: MarketRegimeLabel =
      score >= 62 && b20 >= config.bullishBreadthMinPct - 10
        ? 'Bullish'
        : score <= 42 || b20 <= config.bearishBreadthMaxPct - 5
          ? 'Bearish'
          : 'Neutral';

    regimeByDate.set(d, regime);

    series.push({
      date: d,
      equalWeightedIndex: round2(eqIdx),
      turnoverWeightedIndex: round2(twIdx),
      sma20: sma20 !== null ? round2(sma20) : null,
      sma50: sma50 !== null ? round2(sma50) : null,
      sma200: sma200 !== null ? round2(sma200) : null,
      adRatio,
      advancers: adv,
      decliners: dec,
      totalTurnover: turnSum,
      drawdownPct: ddPct,
    });

    if (di === datesUpTo.length - 1) {
      latestBreadth20 = round1(b20);
      latestBreadth50 = round1(b50);
      latestBreadth120 = round1(b120);
      latestBreadth180 = round1(b180);
      latestAdv = adv;
      latestDec = dec;
      latestUnch = unch;
      latestTurn = turnSum;
      latestVol = volSum;
      latestSma20Slope = s20Slope;
      latestSma50Slope = s50Slope;
    }
  }

  const lastPt = series[series.length - 1];
  const asOfDate = lastPt?.date || '';
  const avgTurn20 = mean(dailyTurnovers.slice(-20));
  const avgVol20 = mean(dailyVolumes.slice(-20));
  const vol20d = round2(stdDev(dailyReturns.slice(-20)) * Math.sqrt(252));
  const maxDd = series.length > 0 ? Math.min(...series.map((s) => s.drawdownPct)) : 0;

  // Sector strength over last 20 sessions
  const sectorRows = computeSectorStrength(store, datesUpTo, equityOnly, eqValues);

  // Final regime score on latest day
  const latestRegimeLabel = regimeByDate.get(asOfDate) || 'Neutral';
  let regimeScore = 50;
  if (lastPt) {
    let sc = 0;
    if (lastPt.sma20 !== null && lastPt.equalWeightedIndex > lastPt.sma20) sc += 18;
    if (lastPt.sma50 !== null && lastPt.equalWeightedIndex > lastPt.sma50) sc += 18;
    if (lastPt.sma200 !== null && lastPt.equalWeightedIndex > lastPt.sma200) sc += 10;
    if (latestSma20Slope !== null && latestSma20Slope > 0) sc += 8;
    if (latestSma50Slope !== null && latestSma50Slope > 0) sc += 8;
    sc += (latestBreadth20 / 100) * 16;
    sc += (latestBreadth120 / 100) * 10;
    const tRatio = avgTurn20 > 0 ? latestTurn / avgTurn20 : 1;
    sc += clip((tRatio - 0.5) * 12, 0, 12);
    if (lastPt.sma200 === null) {
      // Normalize out of 90 when <200 sessions loaded so scale remains 0-100 without fabricating SMA200
      sc = (sc / 90) * 100;
    }
    regimeScore = round1(clip(sc, 0, 100));
  }

  const finalRegime: MarketRegimeLabel =
    regimeScore >= 62 && latestBreadth20 >= config.bullishBreadthMinPct - 5
      ? 'Bullish'
      : regimeScore <= 42 || latestBreadth20 <= config.bearishBreadthMaxPct
        ? 'Bearish'
        : 'Neutral';

  if (asOfDate) regimeByDate.set(asOfDate, finalRegime);

  const [expMin, expMax, expTarget] =
    finalRegime === 'Bullish'
      ? [70, 100, 85]
      : finalRegime === 'Neutral'
        ? [35, 60, 45]
        : [0, 25, 15];

  const rationale: string[] = [];
  if (lastPt?.sma20) {
    rationale.push(
      `Derived NEPSE Proxy (${lastPt.equalWeightedIndex.toFixed(1)}) is ${
        lastPt.equalWeightedIndex >= lastPt.sma20 ? 'above' : 'below'
      } its 20-day SMA (${lastPt.sma20.toFixed(1)})${
        latestSma20Slope !== null ? ` with ${latestSma20Slope >= 0 ? 'rising' : 'falling'} 5d slope (${latestSma20Slope}%)` : ''
      }.`
    );
  }
  if (lastPt?.sma50) {
    rationale.push(
      `Proxy is ${lastPt.equalWeightedIndex >= lastPt.sma50 ? 'above' : 'below'} its 50-day SMA (${lastPt.sma50.toFixed(1)}).`
    );
  }
  rationale.push(
    lastPt?.sma200
      ? `Proxy is ${lastPt.equalWeightedIndex >= lastPt.sma200 ? 'above' : 'below'} its 200-day SMA (${lastPt.sma200.toFixed(1)}).`
      : `SMA(200) requires 200 sessions (${datesUpTo.length} loaded); using ShareSansar MA120/MA180 breadth (${latestBreadth120}% > MA120, ${latestBreadth180}% > MA180) as long-term proxy.`
  );
  rationale.push(
    `Breadth: ${latestBreadth20}% of equities above SMA20, A/D ratio ${lastPt?.adRatio ?? 1} (${latestAdv} advancers / ${latestDec} decliners).`
  );
  rationale.push(
    `Turnover is ${avgTurn20 > 0 ? (latestTurn / avgTurn20).toFixed(2) : '1.00'}x its 20-day average; 20d annualized proxy volatility is ${vol20d.toFixed(1)}% (drawdown ${lastPt?.drawdownPct ?? 0}%).`
  );

  return {
    series,
    regimeByDate,
    latestRegime: {
      asOfDate,
      regime: finalRegime,
      regimeScore,
      recommendedExposureMinPct: expMin,
      recommendedExposureMaxPct: expMax,
      recommendedExposureTargetPct: expTarget,
      indexProxyLabel: 'Derived Equal-Weighted NEPSE Equity Proxy (Base = 2,000 at start of CSV dataset)',
      indexCurrent: lastPt?.equalWeightedIndex ?? 2000,
      sma20: lastPt?.sma20 ?? null,
      sma50: lastPt?.sma50 ?? null,
      sma200: lastPt?.sma200 ?? null,
      sma200Available: lastPt?.sma200 !== null && lastPt?.sma200 !== undefined,
      sma20SlopePct: latestSma20Slope,
      sma50SlopePct: latestSma50Slope,
      breadthAboveSma20Pct: latestBreadth20,
      breadthAboveSma50Pct: latestBreadth50,
      breadthAboveMa120Pct: latestBreadth120,
      breadthAboveMa180Pct: latestBreadth180,
      adRatio: lastPt?.adRatio ?? 1,
      advancers: latestAdv,
      decliners: latestDec,
      unchanged: latestUnch,
      marketTurnover: latestTurn,
      marketTurnoverAvg20: round1(avgTurn20),
      turnoverVsAvg20: avgTurn20 > 0 ? round2(latestTurn / avgTurn20) : 1,
      marketVolume: latestVol,
      marketVolumeAvg20: Math.round(avgVol20),
      volatility20dPct: vol20d,
      maxDrawdownWindowPct: round2(maxDd),
      currentDrawdownPct: lastPt?.drawdownPct ?? 0,
      topSectors: sectorRows.slice(0, 5),
      weakSectors: [...sectorRows].reverse().slice(0, 4),
      rationale,
      series,
    },
  };
}

function computeSectorStrength(
  store: MarketStore,
  datesUpTo: string[],
  equityOnly: boolean,
  marketSeries: number[]
): SectorRegimeStrength[] {
  if (datesUpTo.length === 0) return [];
  const latestDay = datesUpTo[datesUpTo.length - 1];
  const d20Start = datesUpTo[Math.max(0, datesUpTo.length - 20)];
  const d5Start = datesUpTo[Math.max(0, datesUpTo.length - 5)];

  const mkt20Ret =
    marketSeries.length >= 20 && marketSeries[marketSeries.length - 20] > 0
      ? (marketSeries[marketSeries.length - 1] / marketSeries[marketSeries.length - 20] - 1) * 100
      : null;

  const latestRows = store.getDayPrices(latestDay, equityOnly);
  const totalMarketTurn = latestRows.reduce((s, r) => s + (r.turnover || 0), 0);

  const buckets = new Map<
    string,
    {
      count: number;
      turn: number;
      ret20s: number[];
      ret5s: number[];
      aboveSma20: number;
      eligSma20: number;
    }
  >();

  for (const r of latestRows) {
    const sec = getNepseSector(r.symbol, r.name);
    let b = buckets.get(sec);
    if (!b) {
      b = { count: 0, turn: 0, ret20s: [], ret5s: [], aboveSma20: 0, eligSma20: 0 };
      buckets.set(sec, b);
    }
    b.count++;
    b.turn += r.turnover || 0;

    const hist = store.getSymbolHistory(r.symbol, latestDay);
    const closes = hist.map((h) => h.close);
    const sma20 = calcSma(closes, 20);
    if (sma20 !== null) {
      b.eligSma20++;
      if (r.close > sma20) b.aboveSma20++;
    }
    const bar20 = hist.find((h) => h.date >= d20Start);
    if (bar20 && bar20.prev_close > 0 && Math.abs(r.close / bar20.prev_close - 1) < 0.8) {
      b.ret20s.push((r.close / bar20.prev_close - 1) * 100);
    }
    const bar5 = hist.find((h) => h.date >= d5Start);
    if (bar5 && bar5.prev_close > 0 && Math.abs(r.close / bar5.prev_close - 1) < 0.5) {
      b.ret5s.push((r.close / bar5.prev_close - 1) * 100);
    }
  }

  return Array.from(buckets.entries())
    .map(([sector, b]) => {
      const r20 = b.ret20s.length > 0 ? round2(mean(b.ret20s)) : null;
      const r5 = b.ret5s.length > 0 ? round2(mean(b.ret5s)) : null;
      const breadth = b.eligSma20 > 0 ? round1((b.aboveSma20 / b.eligSma20) * 100) : 50;
      const rsVsMkt = r20 !== null && mkt20Ret !== null ? round2(r20 - mkt20Ret) : null;
      const regime: MarketRegimeLabel =
        breadth >= 58 && (rsVsMkt ?? 0) >= 0 ? 'Bullish' : breadth <= 38 && (rsVsMkt ?? 0) < 0 ? 'Bearish' : 'Neutral';
      return {
        sector,
        stockCount: b.count,
        return20dPct: r20,
        return5dPct: r5,
        breadthAboveSma20Pct: breadth,
        turnoverSharePct: totalMarketTurn > 0 ? round2((b.turn / totalMarketTurn) * 100) : 0,
        relativeStrengthVsMarket: rsVsMkt,
        regime,
      };
    })
    .sort((a, b) => (b.relativeStrengthVsMarket ?? -999) - (a.relativeStrengthVsMarket ?? -999));
}

// ---------------------------------------------------------------------------
// 3. Causal Setup Detector (used both for live scan at asOf & historical backtest)
// ---------------------------------------------------------------------------
function detectCausalSetupAtIndex(
  bars: PriceRow[],
  idx: number,
  marketReturn20Pct: number,
  sectorStrengthScore: number, // -10 to +10
  regimeAtDate: MarketRegimeLabel,
  config: QuantEngineConfig
): {
  setupType: SetupStrategyKind;
  setupStatus: 'Confirmed' | 'Forming / Watch' | 'None';
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  triggerPrice: number | null;
  invalidationLevel: number | null;
  confirmationConditions: EntryConditionCheck[];
  supportingReasons: string[];
  rejectionReasons: string[];
  atr14: number;
  sma20: number | null;
  sma50: number | null;
  rvol: number;
  resistance20: number | null;
  support20: number | null;
  vcp: ReturnType<typeof detectVcpStructure>;
} {
  const slice = bars.slice(0, idx + 1);
  const t = slice[slice.length - 1];
  const closes = slice.map((b) => b.close);
  const sma20 = calcSma(closes, 20);
  const sma50 = calcSma(closes, 50);
  const prevSma20 = slice.length >= 25 ? calcSma(closes.slice(0, -5), 20) : null;
  const prevSma50 = slice.length >= 60 ? calcSma(closes.slice(0, -10), 50) : null;
  const sma50Rising = sma50 !== null && prevSma50 !== null ? sma50 > prevSma50 : sma20 !== null && prevSma20 !== null ? sma20 > prevSma20 : false;

  const atr14 = calcAtr14(slice) ?? Math.max(t.high - t.low, t.close * 0.02);
  const prior20 = slice.slice(-21, -1);
  const avgVol20 = prior20.length > 0 ? mean(prior20.map((b) => b.volume)) : t.volume;
  const rvol = avgVol20 > 0 ? t.volume / avgVol20 : 1;
  const resistance20 = prior20.length > 0 ? Math.max(...prior20.map((b) => b.high)) : null;
  const support20 = prior20.length > 0 ? Math.min(...prior20.map((b) => (b.low > 0 ? b.low : b.close))) : null;

  const base20 = slice.slice(-20);
  const baseStart = base20[0]?.prev_close > 0 ? base20[0].prev_close : base20[0]?.close ?? t.close;
  const stock20Ret = baseStart > 0 ? (t.close / baseStart - 1) * 100 : 0;
  const rsImproving = stock20Ret >= marketReturn20Pct;

  const vcp = detectVcpStructure(slice, config.backtest.vcpMaxBaseRangePct);
  const vwapPrice = t.vwap && t.vwap > 0 ? t.vwap : t.volume > 0 ? t.turnover / t.volume : t.close;
  const aboveVwap = t.close >= vwapPrice;

  const closePos = t.high > t.low ? (t.close - t.low) / (t.high - t.low) : 0.5;
  const trendMa = sma50 ?? sma20;
  const healthyTrend = trendMa !== null && t.close >= trendMa * 0.98;

  // 1) Check VCP Breakout / VCP Coil
  if (vcp.detected && vcp.baseHigh && vcp.baseLow) {
    const brokeOut = t.close > vcp.baseHigh && t.diff > 0;
    const coiledNearPivot = !brokeOut && t.close >= vcp.baseHigh * 0.96 && t.close <= vcp.baseHigh;
    const volConfirmed = rvol >= Math.max(1.3, config.backtest.breakoutVolMult * 0.9);
    const conditions: EntryConditionCheck[] = [
      {
        label: 'Progressive range contraction (VCP)',
        passed: vcp.contractions >= 2,
        detail: `${vcp.contractions} volatility contractions detected; base NPR ${vcp.baseLow}–${vcp.baseHigh}`,
      },
      {
        label: 'Volume dry-up inside tight coil',
        passed: (vcp.dryUpRatio ?? 1) <= 0.95,
        detail: `Pre-breakout 5d vol is ${vcp.dryUpRatio !== null ? `${vcp.dryUpRatio.toFixed(2)}x` : 'N/A'} of 20d avg`,
      },
      {
        label: 'Breakout close above pivot resistance',
        passed: brokeOut,
        detail: brokeOut
          ? `Closed NPR ${t.close} above pivot NPR ${vcp.baseHigh}`
          : `Closed NPR ${t.close} (${(((vcp.baseHigh - t.close) / vcp.baseHigh) * 100).toFixed(1)}% below pivot ${vcp.baseHigh})`,
      },
      {
        label: 'Breakout volume expansion (>= 1.35x)',
        passed: volConfirmed,
        detail: `Relative Volume ${rvol.toFixed(2)}x vs 20d avg`,
      },
      {
        label: 'Healthy trend & market/sector backdrop',
        passed: healthyTrend && regimeAtDate !== 'Bearish',
        detail: `Trend ${healthyTrend ? 'intact' : 'weak'}, Market Regime: ${regimeAtDate}`,
      },
    ];

    const confirmed = brokeOut && volConfirmed && healthyTrend;
    if (confirmed || coiledNearPivot) {
      const inv = round2(Math.max(vcp.baseLow * 0.99, t.close - config.backtest.stopAtrMult * atr14));
      return {
        setupType: 'VCP',
        setupStatus: confirmed ? 'Confirmed' : 'Forming / Watch',
        entryZoneLow: round2(vcp.baseHigh),
        entryZoneHigh: round2(vcp.baseHigh * 1.03),
        triggerPrice: round2(vcp.baseHigh * 1.002),
        invalidationLevel: inv,
        confirmationConditions: conditions,
        supportingReasons: conditions.filter((c) => c.passed).map((c) => `${c.label}: ${c.detail}`),
        rejectionReasons: conditions.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`),
        atr14,
        sma20,
        sma50,
        rvol,
        resistance20,
        support20,
        vcp,
      };
    }
  }

  // 2) Check Resistance Breakout
  if (resistance20 !== null && resistance20 > 0) {
    const brokeRes = t.close > resistance20 && t.diff > 0;
    const nearRes = !brokeRes && t.close >= resistance20 * 0.97 && t.diff >= 0;
    const volConfirm = rvol >= config.backtest.breakoutVolMult;
    if (brokeRes || (nearRes && rsImproving && rvol >= 1.15)) {
      const conditions: EntryConditionCheck[] = [
        {
          label: 'Close above 20-day resistance',
          passed: brokeRes,
          detail: `Close NPR ${t.close} vs 20d Resistance NPR ${round2(resistance20)}`,
        },
        {
          label: `Relative Volume >= ${config.backtest.breakoutVolMult.toFixed(1)}x 20d average`,
          passed: volConfirm,
          detail: `RVOL = ${rvol.toFixed(2)}x`,
        },
        {
          label: 'Relative strength outperforming NEPSE proxy',
          passed: rsImproving,
          detail: `20d return ${stock20Ret.toFixed(1)}% vs market proxy ${marketReturn20Pct.toFixed(1)}%`,
        },
        {
          label: 'Strong close above VWAP',
          passed: aboveVwap && closePos >= 0.55,
          detail: `Close position ${(closePos * 100).toFixed(0)}% of bar; ${aboveVwap ? 'above' : 'below'} VWAP`,
        },
        {
          label: 'Market & sector regime supportive',
          passed: regimeAtDate !== 'Bearish' && sectorStrengthScore >= -2,
          detail: `Regime: ${regimeAtDate}`,
        },
      ];

      const confirmed = brokeRes && volConfirm && rsImproving && aboveVwap;
      const inv = round2(Math.max((support20 ?? resistance20 * 0.93), t.close - config.backtest.stopAtrMult * atr14));
      return {
        setupType: 'Breakout',
        setupStatus: confirmed ? 'Confirmed' : 'Forming / Watch',
        entryZoneLow: round2(resistance20),
        entryZoneHigh: round2(resistance20 * 1.035),
        triggerPrice: round2(resistance20 * 1.002),
        invalidationLevel: inv,
        confirmationConditions: conditions,
        supportingReasons: conditions.filter((c) => c.passed).map((c) => `${c.label}: ${c.detail}`),
        rejectionReasons: conditions.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`),
        atr14,
        sma20,
        sma50,
        rvol,
        resistance20,
        support20,
        vcp,
      };
    }
  }

  // 3) Check Trend Pullback
  const anchorMa = sma50 ?? sma20;
  if (anchorMa !== null && anchorMa > 0 && t.close >= anchorMa * 0.99) {
    const pullTarget = sma20 ?? anchorMa;
    const distToSupportPct = ((t.close - pullTarget) / pullTarget) * 100;
    const nearSupport = distToSupportPct >= -2.5 && distToSupportPct <= config.backtest.pullbackMaxSmaDistPct;
    const prev3 = slice.slice(-4, -1);
    const pullbackVolQuiet =
      prev3.length > 0 && avgVol20 > 0 ? mean(prev3.map((b) => b.volume)) <= avgVol20 * 1.05 : true;
    const prevBar = slice.length >= 2 ? slice[slice.length - 2] : null;
    const reversalConfirmed =
      t.diff > 0 &&
      closePos >= 0.55 &&
      aboveVwap &&
      (prevBar ? t.close > prevBar.close : true);

    if (nearSupport && (sma50Rising || (sma20 !== null && t.close > sma20))) {
      const conditions: EntryConditionCheck[] = [
        {
          label: 'Primary trend intact (above rising 50d/20d SMA)',
          passed: sma50Rising && t.close >= anchorMa,
          detail: `Close NPR ${t.close} vs Anchor SMA NPR ${round2(anchorMa)} (${sma50Rising ? 'rising' : 'flat/falling'})`,
        },
        {
          label: `Controlled pullback near support (<= ${config.backtest.pullbackMaxSmaDistPct}%)`,
          passed: nearSupport,
          detail: `${distToSupportPct.toFixed(1)}% from support SMA NPR ${round2(pullTarget)}`,
        },
        {
          label: 'Reduced selling pressure during pullback',
          passed: pullbackVolQuiet,
          detail: pullbackVolQuiet ? 'Prior 3d pullback volume stayed below/near 20d avg' : 'Heavy selling volume during pullback',
        },
        {
          label: 'Reversal confirmation bar (up close > VWAP & top half)',
          passed: reversalConfirmed,
          detail: reversalConfirmed ? `Up +${(t.diff_pct ?? 0).toFixed(2)}% closing at ${(closePos * 100).toFixed(0)}% of range` : 'Awaiting bullish reversal confirmation candle',
        },
        {
          label: 'Market regime not Bearish',
          passed: regimeAtDate !== 'Bearish',
          detail: `Regime: ${regimeAtDate}`,
        },
      ];

      const confirmed = sma50Rising && nearSupport && pullbackVolQuiet && reversalConfirmed;
      const swingLow3 = Math.min(...slice.slice(-5).map((b) => (b.low > 0 ? b.low : b.close)));
      const inv = round2(Math.min(swingLow3 * 0.99, t.close - config.backtest.stopAtrMult * atr14));
      return {
        setupType: 'Trend Pullback',
        setupStatus: confirmed ? 'Confirmed' : 'Forming / Watch',
        entryZoneLow: round2(pullTarget * 0.99),
        entryZoneHigh: round2(pullTarget * 1.03),
        triggerPrice: round2(prevBar ? Math.max(t.close, prevBar.high) : t.close),
        invalidationLevel: inv,
        confirmationConditions: conditions,
        supportingReasons: conditions.filter((c) => c.passed).map((c) => `${c.label}: ${c.detail}`),
        rejectionReasons: conditions.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`),
        atr14,
        sma20,
        sma50,
        rvol,
        resistance20,
        support20,
        vcp,
      };
    }
  }

  return {
    setupType: 'None',
    setupStatus: 'None',
    entryZoneLow: null,
    entryZoneHigh: null,
    triggerPrice: null,
    invalidationLevel: round2(t.close - config.backtest.stopAtrMult * atr14),
    confirmationConditions: [],
    supportingReasons: [],
    rejectionReasons: ['No active Breakout, VCP, or Trend Pullback trigger detected on this session.'],
    atr14,
    sma20,
    sma50,
    rvol,
    resistance20,
    support20,
    vcp,
  };
}

// ---------------------------------------------------------------------------
// 4. Historical Statistical Advantage & Walk-Forward Backtesting Engine
// ---------------------------------------------------------------------------
function summarizeTrades(
  setupType: Exclude<SetupStrategyKind, 'None'>,
  trades: SimulatedTradeRecord[],
  minSampleSize: number,
  startingCapital: number
): SetupStatisticalSummary {
  const n = trades.length;
  if (n === 0) {
    return {
      setupType,
      sampleSize: 0,
      wins: 0,
      losses: 0,
      historicalWinRatePct: null,
      winRateCi95LowPct: null,
      winRateCi95HighPct: null,
      avgWinGrossPct: null,
      avgLossGrossPct: null,
      avgWinNetPct: null,
      avgLossNetPct: null,
      grossExpectancyPct: null,
      netExpectancyPct: null,
      netExpectancyR: null,
      profitFactor: null,
      maxDrawdownPct: null,
      sharpeRatio: null,
      sortinoRatio: null,
      avgHoldingDays: null,
      inSampleNetExpectancyPct: null,
      outOfSampleSampleSize: 0,
      outOfSampleWinRatePct: null,
      outOfSampleNetExpectancyPct: null,
      outOfSampleProfitFactor: null,
      overfittingRisk: 'Insufficient Sample',
      statisticallyFavorable: false,
      reliabilityLabel: 'Insufficient Sample',
      reliabilityNotes: ['No historical occurrences matched strict causal rules inside the loaded CSV window.'],
      byRegime: (['Bullish', 'Neutral', 'Bearish'] as MarketRegimeLabel[]).map((regime) => ({
        regime,
        sampleSize: 0,
        winRatePct: null,
        netExpectancyPct: null,
        profitFactor: null,
      })),
    };
  }

  const winsArr = trades.filter((t) => t.netReturnPct > 0);
  const lossesArr = trades.filter((t) => t.netReturnPct <= 0);
  const wins = winsArr.length;
  const losses = lossesArr.length;
  const winRate = wins / n;
  const [ciLow, ciHigh] = wilsonCi95(wins, n);

  const avgWinGross = winsArr.length > 0 ? round2(mean(winsArr.map((t) => t.grossReturnPct))) : 0;
  const avgLossGross = lossesArr.length > 0 ? round2(mean(lossesArr.map((t) => t.grossReturnPct))) : 0;
  const avgWinNet = winsArr.length > 0 ? round2(mean(winsArr.map((t) => t.netReturnPct))) : 0;
  const avgLossNet = lossesArr.length > 0 ? round2(mean(lossesArr.map((t) => t.netReturnPct))) : 0;

  const grossExpectancy = round2(mean(trades.map((t) => t.grossReturnPct)));
  const netExpectancy = round2(mean(trades.map((t) => t.netReturnPct)));
  const netExpectancyR = round2(mean(trades.map((t) => t.rMultipleNet)));

  const sumWinsNet = winsArr.reduce((s, t) => s + t.netReturnPct, 0);
  const sumLossNetAbs = Math.abs(lossesArr.reduce((s, t) => s + t.netReturnPct, 0));
  const profitFactor =
    sumLossNetAbs > 0 ? round2(sumWinsNet / sumLossNetAbs) : sumWinsNet > 0 ? 9.99 : 0;

  // Trade-sequence equity curve for drawdown & Sharpe/Sortino
  let eq = startingCapital;
  let peak = eq;
  let maxDd = 0;
  const netRets = trades.map((t) => t.netReturnPct);
  const avgHold = Math.max(1, mean(trades.map((t) => t.holdingDays)));
  const tradesPerYear = 250 / avgHold;

  for (const tr of trades) {
    eq = eq * (1 + (tr.netReturnPct / 100) * 0.15); // 15% position allocation assumption for portfolio curve
    peak = Math.max(peak, eq);
    const dd = peak > 0 ? ((eq - peak) / peak) * 100 : 0;
    if (dd < maxDd) maxDd = dd;
  }

  const sd = stdDev(netRets);
  const dsd = downsideDev(netRets, 0);
  const sharpe = sd > 0 ? round2((mean(netRets) / sd) * Math.sqrt(tradesPerYear)) : null;
  const sortino = dsd > 0 ? round2((mean(netRets) / dsd) * Math.sqrt(tradesPerYear)) : null;

  const isTrades = trades.filter((t) => !t.isOutOfSample);
  const oosTrades = trades.filter((t) => t.isOutOfSample);
  const isNetExp = isTrades.length > 0 ? round2(mean(isTrades.map((t) => t.netReturnPct))) : null;
  const oosWinRate =
    oosTrades.length > 0 ? round1((oosTrades.filter((t) => t.netReturnPct > 0).length / oosTrades.length) * 100) : null;
  const oosNetExp = oosTrades.length > 0 ? round2(mean(oosTrades.map((t) => t.netReturnPct))) : null;
  const oosWinSum = oosTrades.filter((t) => t.netReturnPct > 0).reduce((s, t) => s + t.netReturnPct, 0);
  const oosLossSum = Math.abs(oosTrades.filter((t) => t.netReturnPct <= 0).reduce((s, t) => s + t.netReturnPct, 0));
  const oosPf =
    oosTrades.length > 0
      ? oosLossSum > 0
        ? round2(oosWinSum / oosLossSum)
        : oosWinSum > 0
          ? 9.99
          : 0
      : null;

  let overfittingRisk: SetupStatisticalSummary['overfittingRisk'] = 'Low';
  if (n < minSampleSize || oosTrades.length < 3) {
    overfittingRisk = 'Insufficient Sample';
  } else if ((isNetExp ?? 0) > 0.5 && (oosNetExp ?? 0) < -0.5) {
    overfittingRisk = 'High';
  } else if (isNetExp !== null && oosNetExp !== null && oosNetExp < isNetExp * 0.4) {
    overfittingRisk = 'Moderate';
  }

  const byRegime: RegimeConditionalStat[] = (['Bullish', 'Neutral', 'Bearish'] as MarketRegimeLabel[]).map(
    (regime) => {
      const sub = trades.filter((t) => t.regimeAtEntry === regime);
      if (sub.length === 0) {
        return { regime, sampleSize: 0, winRatePct: null, netExpectancyPct: null, profitFactor: null };
      }
      const w = sub.filter((t) => t.netReturnPct > 0).reduce((s, t) => s + t.netReturnPct, 0);
      const l = Math.abs(sub.filter((t) => t.netReturnPct <= 0).reduce((s, t) => s + t.netReturnPct, 0));
      return {
        regime,
        sampleSize: sub.length,
        winRatePct: round1((sub.filter((t) => t.netReturnPct > 0).length / sub.length) * 100),
        netExpectancyPct: round2(mean(sub.map((t) => t.netReturnPct))),
        profitFactor: l > 0 ? round2(w / l) : w > 0 ? 9.99 : 0,
      };
    }
  );

  const notes: string[] = [];
  if (n < minSampleSize) {
    notes.push(`Sample size N=${n} is below minimum threshold (${minSampleSize}); statistical edge is not yet reliable.`);
  }
  if (netExpectancy <= 0) {
    notes.push(`Net expectancy after NEPSE fees, CGT & slippage is non-positive (${netExpectancy}%). High win rate alone cannot justify negative expectancy.`);
  }
  if (profitFactor < 1.15) {
    notes.push(`Net profit factor (${profitFactor}) is below 1.15 hurdle.`);
  }
  if (oosTrades.length >= 3 && (oosNetExp ?? 0) <= 0) {
    notes.push(`Out-of-sample net expectancy (${oosNetExp}%) failed to hold positive — caution for overfitting or regime shift.`);
  }
  if (notes.length === 0) {
    notes.push(
      `Positive net expectancy (+${netExpectancy}% / +${netExpectancyR}R), Profit Factor ${profitFactor}, and OOS expectancy ${oosNetExp !== null ? `+${oosNetExp}%` : 'N/A'} across N=${n} causal historical trades.`
    );
  }

  const statisticallyFavorable =
    n >= minSampleSize &&
    netExpectancy > 0 &&
    profitFactor >= 1.15 &&
    (oosTrades.length < 3 || (oosNetExp ?? 0) > -0.25);

  const reliabilityLabel: SetupStatisticalSummary['reliabilityLabel'] =
    n < minSampleSize
      ? 'Insufficient Sample'
      : netExpectancy <= 0
        ? 'Negative Expectancy'
        : statisticallyFavorable
          ? 'Statistically Validated'
          : 'Marginal / Unproven';

  return {
    setupType,
    sampleSize: n,
    wins,
    losses,
    historicalWinRatePct: round1(winRate * 100),
    winRateCi95LowPct: ciLow,
    winRateCi95HighPct: ciHigh,
    avgWinGrossPct: avgWinGross,
    avgLossGrossPct: avgLossGross,
    avgWinNetPct: avgWinNet,
    avgLossNetPct: avgLossNet,
    grossExpectancyPct: grossExpectancy,
    netExpectancyPct: netExpectancy,
    netExpectancyR,
    profitFactor,
    maxDrawdownPct: round2(maxDd),
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    avgHoldingDays: round1(avgHold),
    inSampleNetExpectancyPct: isNetExp,
    outOfSampleSampleSize: oosTrades.length,
    outOfSampleWinRatePct: oosWinRate,
    outOfSampleNetExpectancyPct: oosNetExp,
    outOfSampleProfitFactor: oosPf,
    overfittingRisk,
    statisticallyFavorable,
    reliabilityLabel,
    reliabilityNotes: notes,
    byRegime,
  };
}

export function runQuantBacktest(
  store: MarketStore,
  asOfDate: string,
  equityOnly: boolean,
  configInput?: Partial<QuantEngineConfig>,
  precomputed?: {
    datesUpTo: string[];
    regimeByDate: Map<string, MarketRegimeLabel>;
    indexSeries: NepseIndexPoint[];
    anomalousBarKeys: Set<string>;
  }
): {
  backtest: BacktestResponse;
  tradesBySymbol: Map<string, SimulatedTradeRecord[]>;
} {
  const config = mergeConfig(configInput);
  const allDates = store.getDates();
  const datesUpTo = precomputed?.datesUpTo ?? allDates.filter((d) => d <= asOfDate);

  let anomalousBarKeys = precomputed?.anomalousBarKeys;
  let regimeByDate = precomputed?.regimeByDate;
  let indexSeries = precomputed?.indexSeries;

  if (!anomalousBarKeys || !regimeByDate || !indexSeries) {
    const val = validateMarketData(store, datesUpTo, asOfDate, equityOnly);
    anomalousBarKeys = val.anomalousBarKeys;
    const reg = buildCausalMarketRegimeSeries(store, datesUpTo, equityOnly, anomalousBarKeys, config);
    regimeByDate = reg.regimeByDate;
    indexSeries = reg.series;
  }

  const splitIdx = Math.max(
    22,
    Math.min(datesUpTo.length - 5, Math.floor(datesUpTo.length * config.backtest.inSampleRatio))
  );
  const oosStartDate = datesUpTo[splitIdx] || asOfDate;

  const marketRet20ByDate = new Map<string, number>();
  for (let i = 0; i < indexSeries.length; i++) {
    const base = indexSeries[Math.max(0, i - 19)].equalWeightedIndex;
    const cur = indexSeries[i].equalWeightedIndex;
    marketRet20ByDate.set(indexSeries[i].date, base > 0 ? (cur / base - 1) * 100 : 0);
  }

  // Collect all symbols active historically (prevents survivorship bias!)
  const allSymbols = new Set<string>();
  for (const d of datesUpTo) {
    for (const r of store.getDayPrices(d, equityOnly)) {
      allSymbols.add(r.symbol);
    }
  }

  const allTrades: SimulatedTradeRecord[] = [];
  const tradesBySymbol = new Map<string, SimulatedTradeRecord[]>();

  for (const sym of allSymbols) {
    const bars = store.getSymbolHistory(sym, asOfDate);
    if (bars.length < Math.max(24, config.minDaysHistory)) continue;

    let idx = 21;
    while (idx < bars.length - 2) {
      const sigBar = bars[idx];
      if (anomalousBarKeys.has(`${sym}::${sigBar.date}`)) {
        idx++;
        continue;
      }

      // Liquidity filter strictly using bars <= idx (no look-ahead)
      const recent20 = bars.slice(Math.max(0, idx - 19), idx + 1);
      const avgTurn20 = mean(recent20.map((b) => b.turnover));
      const avgVol20 = mean(recent20.map((b) => b.volume));
      if (avgTurn20 < config.minAvgDailyTurnover || avgVol20 < config.minAvgDailyVolume) {
        idx++;
        continue;
      }

      const regimeAtEntry = regimeByDate.get(sigBar.date) || 'Neutral';
      const mktRet20 = marketRet20ByDate.get(sigBar.date) ?? 0;

      const setup = detectCausalSetupAtIndex(bars, idx, mktRet20, 0, regimeAtEntry, config);
      if (setup.setupType === 'None' || setup.setupStatus !== 'Confirmed') {
        idx++;
        continue;
      }

      // Entry occurs on next trading bar (t+1 open if valid, else close) to prevent look-ahead
      const entryBar = bars[idx + 1];
      if (anomalousBarKeys.has(`${sym}::${entryBar.date}`) || entryBar.volume <= 0) {
        idx++;
        continue;
      }
      const rawEntry = entryBar.open > 0 ? entryBar.open : entryBar.close;
      if (rawEntry <= 0) {
        idx++;
        continue;
      }

      const stopLoss =
        setup.invalidationLevel && setup.invalidationLevel < rawEntry * 0.985
          ? setup.invalidationLevel
          : round2(rawEntry - config.backtest.stopAtrMult * setup.atr14);
      const riskPerShare = rawEntry - stopLoss;
      if (riskPerShare <= 0 || riskPerShare / rawEntry > 0.22) {
        idx++;
        continue;
      }

      const target1 = round2(rawEntry + riskPerShare * config.backtest.target1R);
      const target2 = round2(rawEntry + riskPerShare * config.backtest.target2R);

      // Compute position size respecting liquidity cap (5% of 20d avg vol) & portfolio risk
      const riskCap = config.risk.portfolioValue * (config.risk.riskPctPerTrade / 100);
      const maxPosShares = Math.floor(
        (config.risk.portfolioValue * (config.risk.maxSingleStockPct / 100)) / rawEntry
      );
      const maxLiqShares = Math.max(10, Math.floor(avgVol20 * (config.costs.maxVolumeParticipationPct / 100)));
      const shares = Math.max(10, Math.min(Math.floor(riskCap / riskPerShare), maxPosShares, maxLiqShares));

      const buy = calcNepseBuyCost(shares, rawEntry, config.costs.slippagePct);

      // Simulate day-by-day forward bars strictly from idx+1 onwards
      let activeStop = stopLoss;
      let partialBooked = false;
      let partialShares = 0;
      let partialNetProceeds = 0;
      let partialFeeAndTax = 0;
      let partialGrossSum = 0;
      let peakClose = entryBar.close;
      let exitIdx = Math.min(bars.length - 1, idx + config.backtest.holdingDays);
      let exitPrice = bars[exitIdx].close;
      let exitReason: SimulatedTradeRecord['exitReason'] = 'Max Hold Exit';

      for (let j = idx + 1; j <= Math.min(bars.length - 1, idx + config.backtest.holdingDays); j++) {
        const b = bars[j];
        if (anomalousBarKeys.has(`${sym}::${b.date}`)) {
          exitIdx = j;
          exitPrice = b.prev_close > 0 ? b.prev_close : rawEntry;
          exitReason = 'Max Hold Exit';
          break;
        }

        peakClose = Math.max(peakClose, b.close);

        // Conservative assumption: if low breaches stopLoss on same bar, stop triggers first
        if (b.low > 0 && b.low <= activeStop) {
          exitIdx = j;
          exitPrice = b.open > 0 && b.open < activeStop ? b.open : activeStop;
          exitReason = partialBooked ? 'Trailing Stop' : 'Initial Stop-Loss';
          break;
        }

        if (b.high >= target2) {
          exitIdx = j;
          exitPrice = target2;
          exitReason = 'Target 2';
          break;
        }

        if (!partialBooked && b.high >= target1 && shares >= 2) {
          partialBooked = true;
          partialShares = Math.floor(shares / 2);
          const partBuyCost = (buy.total * partialShares) / shares;
          const partSell = calcNepseSellProceeds(
            partialShares,
            target1,
            partBuyCost,
            config.costs.slippagePct,
            config.costs.cgtRate
          );
          partialNetProceeds = partSell.netReceivable;
          partialFeeAndTax = partSell.fee + partSell.cgt;
          partialGrossSum = partialShares * target1;
          activeStop = Math.max(activeStop, round2(rawEntry * 1.005)); // move stop to breakeven
        }

        // Trailing stop after T1 or significant profit
        if (partialBooked) {
          const trailCandidate = round2(peakClose - setup.atr14 * 1.4);
          if (trailCandidate > activeStop) activeStop = trailCandidate;
        }

        // MA breakdown exit if partial booked and closes decisively below SMA50 on volume
        const sma50Now = calcSma(bars.slice(0, j + 1).map((x) => x.close), 50);
        if (j > idx + 2 && sma50Now !== null && b.close < sma50Now && b.volume > avgVol20 * 1.2) {
          exitIdx = j;
          exitPrice = b.close;
          exitReason = 'MA Breakdown';
          break;
        }

        if (j === Math.min(bars.length - 1, idx + config.backtest.holdingDays)) {
          exitIdx = j;
          exitPrice = b.close;
          exitReason = partialBooked ? 'Target 1 + Trail' : 'Max Hold Exit';
        }
      }

      const remShares = shares - partialShares;
      const remBuyCost = (buy.total * remShares) / shares;
      const remSell = calcNepseSellProceeds(
        remShares,
        exitPrice,
        remBuyCost,
        config.costs.slippagePct,
        config.costs.cgtRate
      );

      const totalNetReceivable = partialNetProceeds + remSell.netReceivable;
      const netProfit = totalNetReceivable - buy.total;
      const netReturnPct = buy.total > 0 ? round2((netProfit / buy.total) * 100) : 0;
      const blendedGrossExit =
        (partialGrossSum + remShares * exitPrice) / Math.max(1, shares);
      const grossReturnPct = round2(((blendedGrossExit - rawEntry) / rawEntry) * 100);
      const rMultipleNet = round2(netProfit / Math.max(1, shares * riskPerShare));

      const rec: SimulatedTradeRecord = {
        id: `${sym}-${sigBar.date}-${setup.setupType}`,
        symbol: sym,
        sector: getNepseSector(sym, sigBar.name),
        setupType: setup.setupType,
        regimeAtEntry,
        signalDate: sigBar.date,
        entryDate: entryBar.date,
        exitDate: bars[exitIdx].date,
        entryPrice: round2(rawEntry),
        exitPrice: round2(blendedGrossExit),
        stopLoss,
        target1,
        target2,
        sharesSimulated: shares,
        grossReturnPct,
        netReturnPct,
        rMultipleNet,
        holdingDays: Math.max(1, exitIdx - (idx + 1) + 1),
        exitReason,
        isOutOfSample: sigBar.date >= oosStartDate,
        costsNpr: round2(buy.fee + partialFeeAndTax + remSell.fee + remSell.cgt),
      };

      allTrades.push(rec);
      let symList = tradesBySymbol.get(sym);
      if (!symList) {
        symList = [];
        tradesBySymbol.set(sym, symList);
      }
      symList.push(rec);

      // Advance past exit bar to prevent overlapping signals on the same position
      idx = exitIdx + 1;
    }
  }

  allTrades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  const setupTypes: Array<Exclude<SetupStrategyKind, 'None'>> = ['Breakout', 'VCP', 'Trend Pullback'];
  const setupSummaries = setupTypes.map((st) =>
    summarizeTrades(
      st,
      allTrades.filter((t) => t.setupType === st),
      config.backtest.minSampleSize,
      config.risk.portfolioValue
    )
  );

  // Build walk-forward folds across dates
  const foldCount = Math.max(2, Math.min(5, config.backtest.walkForwardFolds));
  const walkForwardFolds: WalkForwardFold[] = [];
  if (datesUpTo.length >= 40) {
    const usableStart = 20;
    const span = datesUpTo.length - usableStart;
    const step = Math.max(8, Math.floor(span / (foldCount + 1)));
    for (let f = 0; f < foldCount; f++) {
      const trainEndIdx = Math.min(datesUpTo.length - 6, usableStart + step * (f + 1));
      const testStartIdx = trainEndIdx + 1;
      const testEndIdx = Math.min(datesUpTo.length - 1, testStartIdx + step - 1);
      if (testStartIdx >= datesUpTo.length) break;

      const trainStart = datesUpTo[0];
      const trainEnd = datesUpTo[trainEndIdx];
      const testStart = datesUpTo[testStartIdx];
      const testEnd = datesUpTo[testEndIdx];

      const trTrades = allTrades.filter((t) => t.entryDate >= trainStart && t.entryDate <= trainEnd);
      const teTrades = allTrades.filter((t) => t.entryDate >= testStart && t.entryDate <= testEnd);

      const teWins = teTrades.filter((t) => t.netReturnPct > 0).reduce((s, t) => s + t.netReturnPct, 0);
      const teLosses = Math.abs(teTrades.filter((t) => t.netReturnPct <= 0).reduce((s, t) => s + t.netReturnPct, 0));

      walkForwardFolds.push({
        foldIndex: f + 1,
        trainStart,
        trainEnd,
        testStart,
        testEnd,
        trainTrades: trTrades.length,
        trainWinRatePct:
          trTrades.length > 0
            ? round1((trTrades.filter((t) => t.netReturnPct > 0).length / trTrades.length) * 100)
            : null,
        trainNetExpectancyPct: trTrades.length > 0 ? round2(mean(trTrades.map((t) => t.netReturnPct))) : null,
        testTrades: teTrades.length,
        testWinRatePct:
          teTrades.length > 0
            ? round1((teTrades.filter((t) => t.netReturnPct > 0).length / teTrades.length) * 100)
            : null,
        testNetExpectancyPct: teTrades.length > 0 ? round2(mean(teTrades.map((t) => t.netReturnPct))) : null,
        testProfitFactor:
          teTrades.length > 0 ? (teLosses > 0 ? round2(teWins / teLosses) : teWins > 0 ? 9.99 : 0) : null,
      });
    }
  }

  // Equity curve across all simulated trades
  let eq = config.risk.portfolioValue;
  let peak = eq;
  let worstDdAbs = 0;
  const equityCurve = allTrades.map((tr, i) => {
    eq = eq * (1 + (tr.netReturnPct / 100) * 0.15);
    peak = Math.max(peak, eq);
    const dd = peak > 0 ? round2(((eq - peak) / peak) * 100) : 0;
    worstDdAbs = Math.max(worstDdAbs, Math.abs(dd));
    return {
      tradeIndex: i + 1,
      date: tr.exitDate,
      equityNpr: Math.round(eq),
      drawdownPct: dd,
      isOutOfSample: tr.isOutOfSample,
    };
  });

  const monteCarlo = computeMonteCarloSequenceStress(
    allTrades,
    config.risk.portfolioValue,
    Math.round(eq),
    round2(worstDdAbs)
  );

  return {
    backtest: {
      generatedAt: new Date().toISOString(),
      asOfDate,
      configUsed: config,
      totalSignalsTested: allTrades.length,
      setupSummaries,
      walkForwardFolds,
      equityCurve,
      monteCarlo,
      recentTrades: [...allTrades].reverse().slice(0, 80),
      methodologySafeguards: [
        'No Look-Ahead Bias: Signals on day t only inspect prices/indicators <= t; entries execute on t+1 open with slippage.',
        'No Survivorship Bias: All equities present on historical CSV dates are evaluated at their historical timestamp.',
        'Realistic NEPSE Friction: SEBON broker commission slabs (0.24%–0.36%), 0.015% SEBON fee, NPR 25 DP fee per side, CGT (7.5%/5%), and slippage.',
        'Liquidity Cap: Simulated position size capped at 5% of 20-day average daily volume and max single-stock portfolio exposure.',
        'Corporate-Action Guard: Sudden single-day gaps >12.5% (outside NEPSE ±10% circuit limit) are quarantined from simulated compounding.',
        'Out-of-Sample & Walk-Forward Validation: In-sample (60%) vs Out-of-sample (40%) split plus rolling walk-forward folds.',
      ],
      limitations: [
        `Loaded dataset spans ${datesUpTo.length} NEPSE sessions (${datesUpTo[0] || 'N/A'} → ${asOfDate}). Multi-year statistical validation improves as more historical ShareSansar sessions are backfilled.`,
        'ShareSansar EOD CSV provides daily OHLCV and official daily VWAP (or OHLCV-derived fallback); intraday order-book depth and bid-ask spreads are not available.',
        'Historical win rate and expectancy reflect past behavior over this dataset and NEVER guarantee future probabilities.',
      ],
    },
    tradesBySymbol,
  };
}

// ---------------------------------------------------------------------------
// 5. Full Quantitative Analysis Orchestrator
// ---------------------------------------------------------------------------
export function runQuantAnalysis(
  store: MarketStore,
  opts?: {
    asOf?: string;
    equityOnly?: boolean;
    config?: Partial<QuantEngineConfig>;
  }
): QuantEngineResponse {
  const allDates = store.getDates();
  const equityOnly = opts?.equityOnly !== false;
  const config = mergeConfig(opts?.config);
  const asOfDate =
    opts?.asOf && allDates.includes(opts.asOf) ? opts.asOf : allDates[allDates.length - 1] || '';

  if (!asOfDate) {
    throw new Error('No ShareSansar trading sessions loaded in data directory.');
  }

  const datesUpTo = allDates.filter((d) => d <= asOfDate);
  const { report: dataQuality, qualityBySymbol, anomalousBarKeys } = validateMarketData(
    store,
    datesUpTo,
    asOfDate,
    equityOnly
  );
  const { series: indexSeries, regimeByDate, latestRegime } = buildCausalMarketRegimeSeries(
    store,
    datesUpTo,
    equityOnly,
    anomalousBarKeys,
    config
  );
  const { backtest, tradesBySymbol } = runQuantBacktest(store, asOfDate, equityOnly, config, {
    datesUpTo,
    regimeByDate,
    indexSeries,
    anomalousBarKeys,
  });

  const audits = loadAllFundamentalAudits(store);
  const setupMap = new Map<Exclude<SetupStrategyKind, 'None'>, SetupStatisticalSummary>();
  for (const s of backtest.setupSummaries) setupMap.set(s.setupType, s);

  const sectorScoreMap = new Map<string, number>();
  for (const sec of latestRegime.topSectors.concat(latestRegime.weakSectors)) {
    sectorScoreMap.set(sec.sector, sec.relativeStrengthVsMarket ?? 0);
  }

  const marketRet20Pct =
    indexSeries.length >= 20 && indexSeries[indexSeries.length - 20].equalWeightedIndex > 0
      ? (indexSeries[indexSeries.length - 1].equalWeightedIndex /
          indexSeries[indexSeries.length - 20].equalWeightedIndex -
          1) *
        100
      : 0;

  // Normalize custom weights so total weight always equals 100
  const wSum = Math.max(
    1,
    config.weights.trendStrength +
      config.weights.momentum +
      config.weights.relativeStrength +
      config.weights.volumeStrength +
      config.weights.breakoutStructure +
      config.weights.vwapBehavior
  );
  const nw = {
    trendStrength: (config.weights.trendStrength / wSum) * 100,
    momentum: (config.weights.momentum / wSum) * 100,
    relativeStrength: (config.weights.relativeStrength / wSum) * 100,
    volumeStrength: (config.weights.volumeStrength / wSum) * 100,
    breakoutStructure: (config.weights.breakoutStructure / wSum) * 100,
    vwapBehavior: (config.weights.vwapBehavior / wSum) * 100,
  };

  // First pass: collect 20d returns for cross-sectional RS percentile
  const allSyms = Array.from(qualityBySymbol.keys());
  const ret20BySym = new Map<string, number>();
  for (const sym of allSyms) {
    const hist = store.getSymbolHistory(sym, asOfDate);
    if (hist.length >= 5) {
      const s20 = hist.slice(-20);
      const b0 = s20[0].prev_close > 0 ? s20[0].prev_close : s20[0].close;
      if (b0 > 0) ret20BySym.set(sym, (hist[hist.length - 1].close / b0 - 1) * 100);
    }
  }
  const sortedRets = Array.from(ret20BySym.values()).sort((a, b) => a - b);

  const candidates: QuantStockCandidate[] = [];
  const excludedStocks: QuantStockCandidate[] = [];

  for (const sym of allSyms) {
    const dq = qualityBySymbol.get(sym)!;
    const bars = store.getSymbolHistory(sym, asOfDate);
    if (bars.length === 0) continue;
    const last = bars[bars.length - 1];
    const name = last.name || sym;
    const sector = getNepseSector(sym, name);

    const closes = bars.map((b) => b.close);
    const slice20 = bars.slice(-20);
    const slice60 = bars.slice(-60);
    const avgTurn20 = mean(slice20.map((b) => b.turnover));
    const avgVol20 = mean(slice20.map((b) => b.volume));
    const sma20 = calcSma(closes, 20);
    const sma50 = calcSma(closes, 50);
    const ema20Arr = calcEmaSeries(closes, 20);
    const ema20 = ema20Arr.length > 0 ? round2(ema20Arr[ema20Arr.length - 1]) : null;
    const prevSma20 = closes.length >= 25 ? calcSma(closes.slice(0, -5), 20) : null;
    const prevSma50 = closes.length >= 60 ? calcSma(closes.slice(0, -10), 50) : null;
    const sma20SlopePct =
      sma20 !== null && prevSma20 ? round2(((sma20 - prevSma20) / prevSma20) * 100) : null;
    const sma50SlopePct =
      sma50 !== null && prevSma50 ? round2(((sma50 - prevSma50) / prevSma50) * 100) : null;

    const rsi14 = calcRsi14(closes);
    const macdObj = calcMacd(closes);
    const atr14 = calcAtr14(bars);
    const atrPct = atr14 !== null && last.close > 0 ? round2((atr14 / last.close) * 100) : null;
    const adx14 = calcAdx14(bars);

    const vwap =
      last.vwap && last.vwap > 0
        ? round2(last.vwap)
        : last.volume > 0 && last.turnover > 0
          ? round2(last.turnover / last.volume)
          : null;
    const vwapPct =
      last.vwap_pct !== null
        ? last.vwap_pct
        : vwap !== null && vwap > 0
          ? round2(((last.close - vwap) / vwap) * 100)
          : null;
    const prevVwap =
      bars.length >= 4
        ? bars[bars.length - 4].vwap ??
          (bars[bars.length - 4].volume > 0 ? bars[bars.length - 4].turnover / bars[bars.length - 4].volume : null)
        : null;
    const vwapRising = vwap !== null && prevVwap !== null ? vwap > prevVwap : null;

    const r10Base = bars.length >= 10 ? bars[bars.length - 10].prev_close || bars[bars.length - 10].close : 0;
    const ret10d = r10Base > 0 ? round2((last.close / r10Base - 1) * 100) : null;
    const ret20d = ret20BySym.has(sym) ? round2(ret20BySym.get(sym)!) : null;
    const r60Base = slice60[0]?.prev_close > 0 ? slice60[0].prev_close : slice60[0]?.close ?? 0;
    const ret60d = bars.length >= 30 && r60Base > 0 ? round2((last.close / r60Base - 1) * 100) : null;

    const rsVsNepse20d = ret20d !== null ? round2(ret20d - marketRet20Pct) : null;
    let rsPercentile = 50;
    if (ret20d !== null && sortedRets.length > 1) {
      const rank = sortedRets.filter((v) => v <= ret20d).length;
      rsPercentile = round1((rank / sortedRets.length) * 100);
    }

    const upVol20 = slice20.filter((b) => b.diff > 0).reduce((s, b) => s + b.volume, 0);
    const dnVol20 = slice20.filter((b) => b.diff < 0).reduce((s, b) => s + b.volume, 0);
    const upDownVolRatio20 = round2(upVol20 / Math.max(1, dnVol20));

    const rvol = avgVol20 > 0 ? round2(last.volume / avgVol20) : 1;
    const gap52HighPct =
      last.w52_high && last.w52_high > 0 ? round2(((last.w52_high - last.close) / last.w52_high) * 100) : null;

    const secStrength = sectorScoreMap.get(sector) ?? 0;
    const setupRes = detectCausalSetupAtIndex(
      bars,
      bars.length - 1,
      marketRet20Pct,
      secStrength,
      latestRegime.regime,
      config
    );

    const accumPattern: StockIndicatorsSnapshot['accumulationPattern'] =
      upDownVolRatio20 >= 1.35 && (vwapPct ?? 0) >= 0
        ? 'Accumulation'
        : upDownVolRatio20 <= 0.78 || ((last.diff_pct ?? 0) < -1 && rvol >= 1.3)
          ? 'Distribution'
          : 'Neutral';

    const indicators: StockIndicatorsSnapshot = {
      close: last.close,
      open: last.open,
      high: last.high,
      low: last.low,
      prevClose: last.prev_close,
      dayChangePct: last.diff_pct ?? 0,
      volume: last.volume,
      turnover: last.turnover,
      trans: last.trans,
      avgTurnover20: round1(avgTurn20),
      avgVolume20: Math.round(avgVol20),
      relativeVolume: rvol,
      sma20: sma20 !== null ? round2(sma20) : null,
      sma50: sma50 !== null ? round2(sma50) : null,
      ema20,
      ma120: last.d120,
      ma180: last.d180,
      sma20SlopePct,
      sma50SlopePct,
      rsi14,
      macd: macdObj.macd,
      macdSignal: macdObj.signal,
      macdHist: macdObj.hist,
      atr14,
      atrPct,
      adx14,
      vwap,
      vwapSource: dq.vwapSource,
      vwapPct,
      vwapRising,
      return10dPct: ret10d,
      return20dPct: ret20d,
      return60dPct: ret60d,
      rsVsNepse20dPct: rsVsNepse20d,
      rsPercentile,
      upDownVolRatio20,
      w52High: last.w52_high,
      w52Low: last.w52_low,
      gap52HighPct,
      resistance20: setupRes.resistance20 !== null ? round2(setupRes.resistance20) : null,
      support20: setupRes.support20 !== null ? round2(setupRes.support20) : null,
      vcpDetected: setupRes.vcp.detected,
      vcpContractions: setupRes.vcp.contractions,
      vcpDryUpRatio: setupRes.vcp.dryUpRatio,
      accumulationPattern: accumPattern,
    };

    // ---------------------------------------------------------------- 6-Component Score (0-100)
    // 1. Trend Strength (20%)
    let trendRaw = 0;
    if (sma20 !== null && last.close > sma20) trendRaw += 25;
    if (sma50 !== null && last.close > sma50) trendRaw += 25;
    if (sma20 !== null && sma50 !== null && sma20 > sma50) trendRaw += 15;
    if (last.d120 && last.close > last.d120) trendRaw += 15;
    if (last.d180 && last.close > last.d180) trendRaw += 10;
    if ((sma20SlopePct ?? 0) > 0) trendRaw += 10;
    trendRaw = round1(clip(trendRaw, 0, 100));

    // 2. Momentum (20%)
    let momRaw = 0;
    if (rsi14 !== null) {
      if (rsi14 >= 52 && rsi14 <= 72) momRaw += 35;
      else if (rsi14 > 72 && rsi14 <= 80) momRaw += 22;
      else if (rsi14 >= 45 && rsi14 < 52) momRaw += 18;
    } else momRaw += 15;
    if (macdObj.macd !== null && macdObj.signal !== null) {
      if (macdObj.macd > macdObj.signal) momRaw += 20;
      if ((macdObj.hist ?? 0) > 0) momRaw += 10;
    }
    if ((ret20d ?? 0) > 0) momRaw += clip((ret20d ?? 0) * 1.8, 0, 20);
    const closePos = last.high > last.low ? (last.close - last.low) / (last.high - last.low) : 0.5;
    momRaw += closePos * 15;
    momRaw = round1(clip(momRaw, 0, 100));

    // 3. Relative Strength (15%)
    let rsRaw = rsPercentile * 0.65;
    if ((rsVsNepse20d ?? -1) > 0) rsRaw += clip((rsVsNepse20d ?? 0) * 2.5, 0, 25);
    if (secStrength > 0) rsRaw += 10;
    rsRaw = round1(clip(rsRaw, 0, 100));

    // 4. Volume Strength (20%)
    let volRaw = 0;
    volRaw += clip((rvol / 2.2) * 45, 0, 45);
    volRaw += clip((upDownVolRatio20 / 2.0) * 35, 0, 35);
    const avgTxSize = last.trans > 0 ? last.turnover / last.trans : last.turnover;
    const blockPenalty = last.trans < 12 && avgTxSize > 500_000 ? -20 : 0;
    if (last.trans >= 40) volRaw += 20;
    else if (last.trans >= 15) volRaw += 10;
    volRaw = round1(clip(volRaw + blockPenalty, 0, 100));

    // 5. Breakout Structure (15%)
    let brkRaw = 0;
    if (setupRes.vcp.detected) brkRaw += 40;
    if (setupRes.setupType === 'Breakout' && setupRes.setupStatus === 'Confirmed') brkRaw += 45;
    else if (setupRes.setupType === 'Trend Pullback' && setupRes.setupStatus === 'Confirmed') brkRaw += 35;
    if (gap52HighPct !== null) {
      if (gap52HighPct <= 5) brkRaw += 35;
      else if (gap52HighPct <= 12) brkRaw += 20;
      else if (gap52HighPct <= 22) brkRaw += 10;
    }
    if (setupRes.resistance20 && last.close >= setupRes.resistance20 * 0.97) brkRaw += 20;
    brkRaw = round1(clip(brkRaw, 0, 100));

    // 6. VWAP Behavior (10%)
    let vwapRaw = 0;
    if (vwapPct !== null) {
      if (vwapPct > 0) vwapRaw += 45 + clip(vwapPct * 10, 0, 20);
      else if (vwapPct > -0.5) vwapRaw += 25;
    }
    if (vwapRising) vwapRaw += 20;
    const recentAboveVwap = bars
      .slice(-5)
      .filter((b) => (b.vwap && b.vwap > 0 ? b.close >= b.vwap : true)).length;
    vwapRaw += (recentAboveVwap / Math.max(1, Math.min(5, bars.length))) * 15;
    vwapRaw = round1(clip(vwapRaw, 0, 100));

    const scoreBreakdown: TechnicalComponentScore[] = [
      {
        key: 'trendStrength',
        label: 'Trend Strength',
        weightPct: round1(nw.trendStrength),
        rawScore0to100: trendRaw,
        weightedPoints: round2((trendRaw * nw.trendStrength) / 100),
        metrics: { SMA20: indicators.sma20, SMA50: indicators.sma50, MA120: indicators.ma120 },
        explanation: `Close vs SMA20/SMA50/MA120/MA180 alignment and slope (${sma20SlopePct ?? 0}% 5d slope).`,
      },
      {
        key: 'momentum',
        label: 'Momentum',
        weightPct: round1(nw.momentum),
        rawScore0to100: momRaw,
        weightedPoints: round2((momRaw * nw.momentum) / 100),
        metrics: { 'RSI(14)': rsi14, 'MACD Hist': macdObj.hist, '20d Ret%': ret20d },
        explanation: `RSI(14)=${rsi14 ?? 'N/A'}, MACD histogram=${macdObj.hist ?? 'N/A'}, intraday close strength ${(closePos * 100).toFixed(0)}%.`,
      },
      {
        key: 'relativeStrength',
        label: 'Relative Strength',
        weightPct: round1(nw.relativeStrength),
        rawScore0to100: rsRaw,
        weightedPoints: round2((rsRaw * nw.relativeStrength) / 100),
        metrics: { 'RS %ile': rsPercentile, 'vs NEPSE 20d': rsVsNepse20d },
        explanation: `Ranks at ${rsPercentile}th percentile across NEPSE (${rsVsNepse20d !== null ? `${rsVsNepse20d >= 0 ? '+' : ''}${rsVsNepse20d}%` : 'N/A'} vs proxy).`,
      },
      {
        key: 'volumeStrength',
        label: 'Volume Strength',
        weightPct: round1(nw.volumeStrength),
        rawScore0to100: volRaw,
        weightedPoints: round2((volRaw * nw.volumeStrength) / 100),
        metrics: { RVOL: `${rvol}x`, 'Up/Dn Vol': `${upDownVolRatio20}x`, Trades: last.trans },
        explanation: `Relative Volume ${rvol}x 20d avg, Up/Down Vol ${upDownVolRatio20}x across ${last.trans} trades.`,
      },
      {
        key: 'breakoutStructure',
        label: 'Breakout Structure',
        weightPct: round1(nw.breakoutStructure),
        rawScore0to100: brkRaw,
        weightedPoints: round2((brkRaw * nw.breakoutStructure) / 100),
        metrics: { VCP: setupRes.vcp.detected ? 'Yes' : 'No', 'Gap 52W High': gap52HighPct },
        explanation: `${setupRes.vcp.detected ? 'VCP volatility contraction detected' : 'Base/resistance check'}; ${gap52HighPct !== null ? `${gap52HighPct}% below 52w high` : '52w high N/A'}.`,
      },
      {
        key: 'vwapBehavior',
        label: 'VWAP Behaviour',
        weightPct: round1(nw.vwapBehavior),
        rawScore0to100: vwapRaw,
        weightedPoints: round2((vwapRaw * nw.vwapBehavior) / 100),
        metrics: { 'vs VWAP%': vwapPct, Source: dq.vwapSource },
        explanation: `${vwapPct !== null ? `${vwapPct >= 0 ? '+' : ''}${vwapPct}% vs ${dq.vwapSource}` : 'VWAP unavailable'}.`,
      },
    ];

    const technicalScore = round1(
      clip(scoreBreakdown.reduce((s, c) => s + c.weightedPoints, 0), 0, 100)
    );

    const patternTags: string[] = [];
    if (sma20 && sma50 && last.close > sma20 && sma20 > sma50) patternTags.push('Strong Uptrend');
    if (setupRes.vcp.detected) patternTags.push(`VCP (${setupRes.vcp.contractions} contractions)`);
    if (setupRes.setupType === 'Breakout') patternTags.push(`Resistance Breakout (${setupRes.setupStatus})`);
    if (setupRes.setupType === 'Trend Pullback') patternTags.push(`Trend Pullback (${setupRes.setupStatus})`);
    if (rsPercentile >= 80) patternTags.push('RS Leader (Top 20%)');
    if (accumPattern === 'Accumulation') patternTags.push('Volume Accumulation');
    if (accumPattern === 'Distribution') patternTags.push('Distribution Warning');

    // Fundamental audit attachment (if available in .fundamental-intel.json; never fabricated)
    const audit = audits[sym];
    const fundamentalStatus: QuantStockCandidate['fundamentalStatus'] = audit
      ? {
          hasAudit: true,
          dataStatus: audit.dataStatus,
          reportingPeriod: audit.reportingPeriod || 'Unavailable',
          publicationDate: audit.publicationDate || 'Unavailable',
          recommendation: audit.recommendation,
          riskScore: audit.riskScore,
          opportunityScore: audit.opportunityScore,
          redFlags: audit.fundamentalRedFlags || [],
        }
      : {
          hasAudit: false,
          dataStatus: 'Unavailable',
          reportingPeriod: 'Unavailable — Price/Volume EOD Only',
          publicationDate: 'Unavailable',
          recommendation: null,
          riskScore: null,
          opportunityScore: null,
          redFlags: [],
        };

    // Exclusion checks
    const exclusionReasons: string[] = [...dq.reasons];
    if (avgTurn20 < config.minAvgDailyTurnover) {
      exclusionReasons.push(
        `Illiquid: 20d avg turnover NPR ${(avgTurn20 / 1e5).toFixed(1)} lakh < minimum ${(config.minAvgDailyTurnover / 1e5).toFixed(1)} lakh`
      );
    }
    if (avgVol20 < config.minAvgDailyVolume) {
      exclusionReasons.push(
        `Thin volume: 20d avg volume ${Math.round(avgVol20)} shares < minimum ${config.minAvgDailyVolume}`
      );
    }
    if (bars.length < config.minDaysHistory) {
      exclusionReasons.push(`Insufficient history: ${bars.length} sessions < minimum ${config.minDaysHistory}`);
    }

    const isExcluded =
      dq.status === 'Excluded' ||
      avgTurn20 < config.minAvgDailyTurnover ||
      avgVol20 < config.minAvgDailyVolume ||
      bars.length < config.minDaysHistory;

    const updatedDq: SymbolDataQuality = isExcluded
      ? { ...dq, status: 'Excluded', reasons: exclusionReasons }
      : dq;

    // Statistical validation & Sizing
    const setupStats =
      setupRes.setupType !== 'None' ? setupMap.get(setupRes.setupType) ?? null : null;
    const stockHistTrades = (tradesBySymbol.get(sym) || []).filter(
      (tr) => setupRes.setupType === 'None' || tr.setupType === setupRes.setupType
    );
    const stockHistWins = stockHistTrades.filter((tr) => tr.netReturnPct > 0).length;
    const stockHistWinRate =
      stockHistTrades.length > 0 ? round1((stockHistWins / stockHistTrades.length) * 100) : null;
    const stockHistExp =
      stockHistTrades.length > 0 ? round2(mean(stockHistTrades.map((tr) => tr.netReturnPct))) : null;

    // Build Exit & Position Sizing Plans
    const plannedEntry =
      setupRes.setupStatus === 'Confirmed'
        ? last.close
        : setupRes.triggerPrice && setupRes.triggerPrice > last.close
          ? setupRes.triggerPrice
          : last.close;
    const stopLoss =
      setupRes.invalidationLevel && setupRes.invalidationLevel < plannedEntry * 0.985
        ? setupRes.invalidationLevel
        : round2(Math.max(1, plannedEntry - config.backtest.stopAtrMult * setupRes.atr14));
    const riskPerShare = Math.max(0.5, plannedEntry - stopLoss);
    const target1 = round2(plannedEntry + riskPerShare * config.backtest.target1R);
    const target2 = round2(plannedEntry + riskPerShare * config.backtest.target2R);
    const trailStop = round2(Math.max(stopLoss, last.close - 1.5 * setupRes.atr14));

    const exitPlan: ExitManagementPlan = {
      initialStopLoss: stopLoss,
      stopDistancePct: round2((riskPerShare / plannedEntry) * 100),
      target1,
      target2,
      partialProfitRule: `Book 50% at Target 1 (NPR ${target1}, +${config.backtest.target1R}R) and move stop-loss to breakeven (NPR ${round2(plannedEntry * 1.006)}).`,
      trailingStopLevel: trailStop,
      trailingStopRule: `Trail remaining 50% at max(breakeven, Close - 1.5×ATR14 = NPR ${trailStop}) or below rising 20d EMA.`,
      maBreakdownRule: sma50
        ? `Exit if daily close drops below rising 50d SMA (NPR ${round2(sma50)}) on >= 1.2x average volume.`
        : `Exit if daily close breaks below 20d SMA (NPR ${round2(sma20 ?? stopLoss)}) on heavy volume.`,
      regimeAlertRule: `If NEPSE Market Regime shifts to Bearish, tighten trailing stop to 1.0×ATR and reduce exposure toward ${latestRegime.recommendedExposureMaxPct}%.`,
      invalidationRule: `Setup thesis is immediately invalidated if price closes below NPR ${stopLoss}.`,
      neverWidenStopPolicy: 'STRICT RULE: Never widen an initial stop-loss downward to accommodate a losing position.',
    };

    const riskCap = config.risk.portfolioValue * (config.risk.riskPctPerTrade / 100);
    const rawQty = Math.floor(riskCap / riskPerShare);
    const maxSingleAllocNpr = config.risk.portfolioValue * (config.risk.maxSingleStockPct / 100);
    const maxAllocQty = Math.floor(maxSingleAllocNpr / (plannedEntry * 1.005));
    const maxLiqQty = Math.max(
      10,
      Math.floor(avgVol20 * (config.costs.maxVolumeParticipationPct / 100))
    );
    const maxCapitalQty = Math.floor((config.risk.portfolioValue - 25) / (plannedEntry * 1.005));

    let finalQty = Math.max(0, Math.min(rawQty, maxAllocQty, maxLiqQty, maxCapitalQty));
    if (config.risk.enforceTenKitta && finalQty >= 10) {
      finalQty = Math.floor(finalQty / 10) * 10;
    }

    let cappingReason: string | null = null;
    if (finalQty < rawQty) {
      if (maxLiqQty <= maxAllocQty && maxLiqQty <= maxCapitalQty) {
        cappingReason = `Capped by liquidity (${config.costs.maxVolumeParticipationPct}% of 20d avg volume = ${maxLiqQty} shares)`;
      } else if (maxAllocQty <= maxCapitalQty) {
        cappingReason = `Capped by ${config.risk.maxSingleStockPct}% single-stock exposure limit`;
      } else {
        cappingReason = 'Capped by available portfolio value';
      }
    }

    const buyCost = calcNepseBuyCost(finalQty, plannedEntry, 0);
    const stopSell = calcNepseSellProceeds(finalQty, stopLoss, buyCost.total, config.costs.slippagePct, config.costs.cgtRate);
    const t1Sell = calcNepseSellProceeds(finalQty, target1, buyCost.total, config.costs.slippagePct, config.costs.cgtRate);
    const t2Sell = calcNepseSellProceeds(finalQty, target2, buyCost.total, config.costs.slippagePct, config.costs.cgtRate);
    const netLossAtStop = Math.max(0, buyCost.total - stopSell.netReceivable);

    const positionSizing: PositionSizingPlan = {
      portfolioValue: config.risk.portfolioValue,
      riskPct: config.risk.riskPctPerTrade,
      riskCapitalNpr: round2(riskCap),
      plannedEntry: round2(plannedEntry),
      stopLoss,
      riskPerShare: round2(riskPerShare),
      rawQuantity: rawQty,
      finalQuantity: finalQty,
      cappingReason,
      investmentAmountNpr: round2(finalQty * plannedEntry),
      estimatedBuyFeeNpr: round2(buyCost.fee),
      totalCashRequiredNpr: round2(buyCost.total),
      portfolioAllocationPct:
        config.risk.portfolioValue > 0 ? round2((buyCost.total / config.risk.portfolioValue) * 100) : 0,
      maxAcceptableLossNetNpr: round2(netLossAtStop),
      grossRiskReward: round2((target1 - plannedEntry) / riskPerShare),
      netRiskRewardT1: netLossAtStop > 0 ? round2(t1Sell.netProfit / netLossAtStop) : 0,
      netRiskRewardT2: netLossAtStop > 0 ? round2(t2Sell.netProfit / netLossAtStop) : 0,
      liquidityDaysToExit: avgVol20 > 0 ? Math.round((finalQty / avgVol20) * 1000) / 1000 : 0,
      priceLimitNotice: `NEPSE daily ±10% circuit band around NPR ${last.close}: [NPR ${round2(last.close * 0.9)}, NPR ${round2(last.close * 1.1)}].`,
    };

    // ---------------------------------------------------------------- Guardrailed Classification Gate
    let classification: TradeClassification = 'WATCHLIST';
    let classificationReason = '';

    const hasSevereFundamentalRisk =
      fundamentalStatus.hasAudit &&
      (fundamentalStatus.recommendation === 'AVOID' || (fundamentalStatus.riskScore ?? 0) >= 72);
    const setupStatOk = Boolean(setupStats && setupStats.statisticallyFavorable);
    const bearishBlocked = latestRegime.regime === 'Bearish' && !config.risk.allowBearishNewEntries;

    if (isExcluded) {
      classification = 'REJECT';
      classificationReason = `Rejected due to data/liquidity constraints: ${exclusionReasons[0]}.`;
    } else if (hasSevereFundamentalRisk) {
      classification = 'REJECT';
      classificationReason = `Rejected due to high fundamental risk audit (${fundamentalStatus.riskScore}/100, ${fundamentalStatus.recommendation}).`;
    } else if (
      accumPattern === 'Distribution' &&
      ((sma50 && last.close < sma50) || (sma20 && last.close < sma20)) &&
      technicalScore < 42
    ) {
      classification = 'SELL';
      classificationReason = `Bearish trend breakdown below moving averages with distribution volume (Up/Dn ${upDownVolRatio20}x).`;
    } else if (accumPattern === 'Distribution' && (rsi14 ?? 50) > 72 && technicalScore < 55) {
      classification = 'REDUCE';
      classificationReason = `Overextended momentum with distribution warning — consider tightening stops or reducing size.`;
    } else if (
      setupRes.setupType !== 'None' &&
      setupRes.setupStatus === 'Confirmed' &&
      setupStatOk &&
      !bearishBlocked &&
      finalQty > 0 &&
      positionSizing.netRiskRewardT1 >= 1.1 &&
      technicalScore >= 72
    ) {
      classification = 'STRONG BUY CANDIDATE';
      classificationReason = `Confirmed ${setupRes.setupType} in ${latestRegime.regime} regime, statistically validated cohort (+${setupStats?.netExpectancyPct}% net expectancy), strong 6-factor score (${technicalScore}/100), and valid liquidity/risk sizing.`;
    } else if (
      setupRes.setupType !== 'None' &&
      setupRes.setupStatus === 'Confirmed' &&
      setupStatOk &&
      !bearishBlocked &&
      finalQty > 0 &&
      technicalScore >= 58
    ) {
      classification = 'BUY CANDIDATE';
      classificationReason = `Confirmed ${setupRes.setupType} passing statistical edge validation (+${setupStats?.netExpectancyPct}% net expectancy, PF ${setupStats?.profitFactor}) and liquidity checks.`;
    } else if (setupRes.setupType !== 'None' || technicalScore >= 62) {
      classification = 'WAIT FOR CONFIRMATION';
      const whyWait: string[] = [];
      if (setupRes.setupStatus !== 'Confirmed') whyWait.push('entry trigger not yet confirmed');
      if (bearishBlocked) whyWait.push('Market Regime is Bearish (new breakouts restricted)');
      if (setupStats && !setupStats.statisticallyFavorable) {
        whyWait.push(`setup statistical validation is ${setupStats.reliabilityLabel}`);
      }
      if (finalQty <= 0) whyWait.push('position size is 0 under risk/liquidity caps');
      if (technicalScore < 58 && setupRes.setupStatus === 'Confirmed') {
        whyWait.push(`technical score (${technicalScore}/100) below BUY threshold (58)`);
      }
      if (whyWait.length === 0) whyWait.push('awaiting volume/price confirmation');
      classificationReason = `Technical score is ${technicalScore}/100, but high technical strength alone does NOT trigger a BUY: ${whyWait.join('; ')}.`;
    } else if (technicalScore >= 52 && sma20 && last.close >= sma20) {
      classification = 'HOLD';
      classificationReason = `Constructive trend above 20d SMA (score ${technicalScore}/100) without a fresh low-risk entry pivot.`;
    } else if (technicalScore >= 42) {
      classification = 'WATCHLIST';
      classificationReason = `Moderate technical structure (${technicalScore}/100); monitor for VCP contraction or volume-backed breakout.`;
    } else {
      classification = 'REJECT';
      classificationReason = `Weak technical structure (${technicalScore}/100) and no statistical edge setup.`;
    }

    const estConfLabel = setupStats
      ? setupStats.statisticallyFavorable
        ? `Historical cohort positive (+${setupStats.netExpectancyPct}% net exp, 95% WR CI ${setupStats.winRateCi95LowPct ?? '?'}%–${setupStats.winRateCi95HighPct ?? '?'}%); future outcomes remain uncertain.`
        : `Historical cohort ${setupStats.reliabilityLabel} (N=${setupStats.sampleSize}); do NOT treat win rate as a forecast.`
      : 'No active setup cohort matched; technical score reflects current price/volume posture only.';

    const candidate: QuantStockCandidate = {
      symbol: sym,
      name,
      sector,
      asOfDate,
      dataTimestamp: `${asOfDate} ShareSansar EOD`,
      dataQuality: updatedDq,
      fundamentalStatus,
      indicators,
      technicalScore,
      scoreBreakdown,
      patternTags,
      setupType: setupRes.setupType,
      classification,
      classificationReason,
      entryPlan: {
        setupType: setupRes.setupType,
        setupStatus: setupRes.setupStatus,
        entryZoneLow: setupRes.entryZoneLow,
        entryZoneHigh: setupRes.entryZoneHigh,
        triggerPrice: setupRes.triggerPrice,
        invalidationLevel: setupRes.invalidationLevel,
        confirmationConditions: setupRes.confirmationConditions,
        supportingReasons: setupRes.supportingReasons,
        rejectionReasons: setupRes.rejectionReasons,
      },
      exitPlan: isExcluded ? null : exitPlan,
      positionSizing: isExcluded ? null : positionSizing,
      setupStats,
      stockHistoricalOccurrences: stockHistTrades.length,
      stockHistoricalWinRatePct: stockHistWinRate,
      stockHistoricalNetExpectancyPct: stockHistExp,
      estimatedModelConfidenceLabel: estConfLabel,
      fiveQuestionsSummary: {
        hasStatisticalAdvantage: setupStats
          ? `${setupStats.setupType} cohort across NEPSE: N=${setupStats.sampleSize} trades, ${setupStats.historicalWinRatePct ?? 'N/A'}% historical win rate (95% CI ${setupStats.winRateCi95LowPct ?? '?'}–${setupStats.winRateCi95HighPct ?? '?'}%), net expectancy ${setupStats.netExpectancyPct !== null ? `${setupStats.netExpectancyPct >= 0 ? '+' : ''}${setupStats.netExpectancyPct}%` : 'N/A'}, Profit Factor ${setupStats.profitFactor ?? 'N/A'} (${setupStats.reliabilityLabel}).`
          : `No active Breakout/VCP/Pullback setup triggered today (${stockHistTrades.length} past simulated trades for ${sym}).`,
        isMarketFavorable: `NEPSE Regime is ${latestRegime.regime} (${latestRegime.regimeScore}/100; ${latestRegime.breadthAboveSma20Pct}% > SMA20). Recommended equity exposure: ${latestRegime.recommendedExposureMinPct}%–${latestRegime.recommendedExposureMaxPct}%.`,
        isEntryValid:
          setupRes.setupType !== 'None'
            ? `${setupRes.setupType} (${setupRes.setupStatus}): Entry zone NPR ${setupRes.entryZoneLow}–${setupRes.entryZoneHigh}, invalidation below NPR ${setupRes.invalidationLevel}.`
            : `No valid entry trigger today; wait for a clean Breakout, VCP pivot, or Pullback reversal.`,
        allocationAndMaxLoss: isExcluded
          ? 'Excluded from allocation due to liquidity or data-quality constraints.'
          : `${finalQty} shares (Investment ~NPR ${Math.round(buyCost.total).toLocaleString('en-US')}, ${positionSizing.portfolioAllocationPct}% of portfolio). Max net loss at stop (incl. fees/slippage): NPR ${Math.round(netLossAtStop).toLocaleString('en-US')}.`,
        exitTriggers: `Initial stop NPR ${stopLoss}; Target 1 NPR ${target1} (50% partial); Target 2 NPR ${target2}; trailing stop NPR ${trailStop}; or close below anchor SMA on >=1.2x volume.`,
      },
    };

    if (isExcluded) excludedStocks.push(candidate);
    else candidates.push(candidate);
  }

  candidates.sort((a, b) => {
    const rankOrder: Record<TradeClassification, number> = {
      'STRONG BUY CANDIDATE': 0,
      'BUY CANDIDATE': 1,
      'WAIT FOR CONFIRMATION': 2,
      HOLD: 3,
      WATCHLIST: 4,
      REDUCE: 5,
      SELL: 6,
      REJECT: 7,
    };
    const rDiff = rankOrder[a.classification] - rankOrder[b.classification];
    if (rDiff !== 0) return rDiff;
    return b.technicalScore - a.technicalScore;
  });

  const topOpportunities = candidates
    .filter(
      (c) =>
        c.classification === 'STRONG BUY CANDIDATE' ||
        c.classification === 'BUY CANDIDATE' ||
        c.classification === 'WAIT FOR CONFIRMATION'
    )
    .slice(0, 25);

  const breakoutWatchlist = candidates
    .filter((c) => c.setupType === 'Breakout')
    .sort((a, b) => b.technicalScore - a.technicalScore)
    .slice(0, 30);

  const vcpWatchlist = candidates
    .filter((c) => c.setupType === 'VCP' || c.indicators.vcpDetected)
    .sort((a, b) => b.technicalScore - a.technicalScore)
    .slice(0, 30);

  const pullbackWatchlist = candidates
    .filter((c) => c.setupType === 'Trend Pullback')
    .sort((a, b) => b.technicalScore - a.technicalScore)
    .slice(0, 30);

  const relativeStrengthLeaders = [...candidates]
    .sort((a, b) => b.indicators.rsPercentile - a.indicators.rsPercentile || b.technicalScore - a.technicalScore)
    .slice(0, 40);

  const accumulationLeaders = candidates
    .filter((c) => c.indicators.accumulationPattern === 'Accumulation')
    .sort((a, b) => b.indicators.upDownVolRatio20 - a.indicators.upDownVolRatio20)
    .slice(0, 30);

  const distributionWarnings = candidates
    .filter((c) => c.indicators.accumulationPattern === 'Distribution')
    .sort((a, b) => a.indicators.upDownVolRatio20 - b.indicators.upDownVolRatio20)
    .slice(0, 30);

  return {
    generatedAt: new Date().toISOString(),
    asOfDate,
    dataTimestamp: `${asOfDate} ShareSansar EOD`,
    config,
    dataQuality,
    marketRegime: latestRegime,
    candidates,
    excludedStocks,
    topOpportunities,
    breakoutWatchlist,
    vcpWatchlist,
    pullbackWatchlist,
    relativeStrengthLeaders,
    accumulationLeaders,
    distributionWarnings,
    backtestSummary: backtest,
  };
}
