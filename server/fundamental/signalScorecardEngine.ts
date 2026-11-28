import type {
  SignalScorecardCohort,
  SignalScorecardHorizonStats,
  SignalScorecardResponse,
} from '../../src/types/fundamental.ts';
import type { PriceRow } from '../../src/types/market.ts';
import type { MarketStore } from '../marketStore.ts';
import type { FundamentalVault } from './fundamentalVault.ts';
import { evaluateScreenerUniverse } from './investorScoringEngine.ts';
import type { RegulatoryKnowledgeBase } from './regulatoryKnowledgeBase.ts';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? round2(sorted[mid])
    : round2((sorted[mid - 1] + sorted[mid]) / 2);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function computeHorizonStats(
  horizonDays: 5 | 10 | 20,
  returnsPct: number[],
  baselineMedianPct: number | null
): SignalScorecardHorizonStats {
  if (returnsPct.length === 0) {
    return {
      horizonDays,
      samples: 0,
      winRatePct: null,
      avgReturnPct: null,
      medianReturnPct: null,
      excessVsBaselinePct: null,
      bestReturnPct: null,
      worstReturnPct: null,
      profitFactor: null,
    };
  }

  let wins = 0;
  let grossGain = 0;
  let grossLoss = 0;
  let sum = 0;
  let best = -Infinity;
  let worst = Infinity;

  for (const r of returnsPct) {
    sum += r;
    if (r > 0) {
      wins++;
      grossGain += r;
    } else if (r < 0) {
      grossLoss += Math.abs(r);
    }
    if (r > best) best = r;
    if (r < worst) worst = r;
  }

  const avg = round2(sum / returnsPct.length);
  const med = median(returnsPct);
  const winRatePct = round1((wins / returnsPct.length) * 100);
  const excessVsBaselinePct =
    baselineMedianPct !== null && med !== null
      ? round2(med - baselineMedianPct)
      : baselineMedianPct !== null
        ? round2(avg - baselineMedianPct)
        : null;
  const profitFactor =
    grossLoss > 0
      ? round2(grossGain / grossLoss)
      : grossGain > 0
        ? 99
        : null;

  return {
    horizonDays,
    samples: returnsPct.length,
    winRatePct,
    avgReturnPct: avg,
    medianReturnPct: med,
    excessVsBaselinePct,
    bestReturnPct: Number.isFinite(best) ? round2(best) : null,
    worstReturnPct: Number.isFinite(worst) ? round2(worst) : null,
    profitFactor,
  };
}

interface CohortDef {
  id: string;
  name: string;
  category: SignalScorecardCohort['category'];
  description: string;
  match: (ctx: {
    row: PriceRow;
    hist20: PriceRow[];
    rankByTurnover: number;
    isFundamentalLeader: boolean;
  }) => boolean;
}

export function computeSignalScorecard(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase | null,
  options: { equityOnly?: boolean } = {}
): SignalScorecardResponse {
  const equityOnly = options.equityOnly !== false;
  const dates = store.getDates();
  const horizons: Array<5 | 10 | 20> = [5, 10, 20];

  const evaluated = evaluateScreenerUniverse(store, vault, {
    equityOnly,
    kbMap: kb?.getAllCompanyEntries(),
  });
  const fundamentalLeaders = new Set<string>(
    evaluated.rows
      .filter(
        (r) =>
          r.hasFundamentalData &&
          (r.scores.overallScore >= 60 || (r.keyMetrics.epsVsQ4Avg3yPct ?? -999) >= 5)
      )
      .map((r) => r.symbol.toUpperCase())
  );

  const cohortDefs: CohortDef[] = [
    {
      id: 'turnover_surge',
      name: 'Turnover Acceleration (>=2x 20D Avg + Green)',
      category: 'Momentum & Flow',
      description:
        'Stocks trading at least 2.0x their trailing 20-day average turnover while closing positive in the upper half of the daily range.',
      match: ({ row, hist20 }) => {
        if (hist20.length < 5 || row.turnover < 5_000_000) return false;
        const prior = hist20.slice(0, -1);
        const avgTurn = prior.length > 0 ? mean(prior.map((h) => h.turnover)) : row.turnover;
        const rng = row.high - row.low;
        const closePos = rng > 0 ? (row.close - row.low) / rng : 0.5;
        return avgTurn > 0 && row.turnover >= avgTurn * 2 && (row.diff_pct ?? 0) > 0 && closePos >= 0.5;
      },
    },
    {
      id: 'stealth_accumulation',
      name: 'Stealth Accumulation (Vol 1.4x-3.0x + Tight Upper Close)',
      category: 'Smart Money',
      description:
        'Elevated participation (1.4x-3.0x 20D avg volume) with controlled price gain (|chg| <= 2.5%) and close in top 35% of bar.',
      match: ({ row, hist20 }) => {
        if (hist20.length < 5 || row.turnover < 3_000_000) return false;
        const prior = hist20.slice(0, -1);
        const avgVol = prior.length > 0 ? mean(prior.map((h) => h.volume)) : row.volume;
        const rng = row.high - row.low;
        const closePos = rng > 0 ? (row.close - row.low) / rng : 0.5;
        return (
          avgVol > 0 &&
          row.volume >= avgVol * 1.4 &&
          row.volume <= avgVol * 3.0 &&
          Math.abs(row.diff_pct ?? 0) <= 2.5 &&
          closePos >= 0.65
        );
      },
    },
    {
      id: 'liquidity_leaders',
      name: 'Top-15 Turnover Leaders Above VWAP',
      category: 'Momentum & Flow',
      description:
        'Institutional bellwethers ranking in the daily Top 15 by NEPSE turnover while closing positive and at/above VWAP.',
      match: ({ row, rankByTurnover }) =>
        rankByTurnover <= 15 && (row.diff_pct ?? 0) > 0 && (row.vwap_pct ?? 0) >= 0,
    },
    {
      id: 'uptrend_pullback',
      name: 'Uptrend Discount Pullback (>MA120 & Lower 45% Range)',
      category: 'Technical Setup',
      description:
        'Primary uptrend stocks (Close > 120-day MA) pulling back into the lower 45% of their trailing 20-day dealing range without heavy breakdown.',
      match: ({ row, hist20 }) => {
        if (hist20.length < 10 || !row.d120 || row.d120 <= 0) return false;
        if (row.close <= row.d120 || row.turnover < 2_500_000) return false;
        const hi20 = Math.max(...hist20.map((h) => h.high));
        const lo20 = Math.min(...hist20.map((h) => h.low));
        if (hi20 <= lo20) return false;
        const pos20 = (row.close - lo20) / (hi20 - lo20);
        return pos20 <= 0.45 && (row.diff_pct ?? 0) >= -1.8;
      },
    },
    {
      id: 'fundamental_q4_leaders',
      name: 'Fundamental Quality & 3Y Q4 Earnings Leaders',
      category: 'Fundamental',
      description:
        'Companies with Overall Fundamental Score >= 60 or annualized EPS beating their 3-Year Q4 historical average.',
      match: ({ row, isFundamentalLeader }) =>
        isFundamentalLeader && row.turnover >= 1_000_000,
    },
  ];

  const emptyHorizonMap = (): Record<'5' | '10' | '20', SignalScorecardHorizonStats> => ({
    '5': computeHorizonStats(5, [], null),
    '10': computeHorizonStats(10, [], null),
    '20': computeHorizonStats(20, [], null),
  });

  if (dates.length < 10) {
    return {
      generatedAt: new Date().toISOString(),
      asOfDate: dates[dates.length - 1] ?? null,
      totalSessionsAnalyzed: dates.length,
      evaluationCheckpoints: 0,
      baselineByHorizon: emptyHorizonMap(),
      cohorts: cohortDefs.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        description: c.description,
        currentCandidates: [],
        statsByHorizon: emptyHorizonMap(),
      })),
    };
  }

  // Build quick lookup: date -> symbol -> close
  const closeByDateSym = new Map<string, Map<string, number>>();
  for (const d of dates) {
    const map = new Map<string, number>();
    for (const r of store.getDayPrices(d, equityOnly)) {
      if (r.close > 0) map.set(r.symbol, r.close);
    }
    closeByDateSym.set(d, map);
  }

  // Determine causal historical checkpoints across loaded sessions
  const minStartIdx = Math.min(Math.max(5, Math.floor(dates.length * 0.18)), dates.length - 6);
  const maxEndIdx = dates.length - 6; // ensures at least 5D forward exists
  const span = Math.max(1, maxEndIdx - minStartIdx + 1);
  const step = Math.max(1, Math.floor(span / 16));
  const checkpointIndices: number[] = [];
  for (let i = minStartIdx; i <= maxEndIdx; i += step) {
    checkpointIndices.push(i);
  }

  const baselineReturns: Record<5 | 10 | 20, number[]> = { 5: [], 10: [], 20: [] };
  const cohortReturns: Record<string, Record<5 | 10 | 20, number[]>> = {};
  for (const c of cohortDefs) {
    cohortReturns[c.id] = { 5: [], 10: [], 20: [] };
  }

  for (const tIdx of checkpointIndices) {
    const tDate = dates[tIdx];
    const dayRows = [...store.getDayPrices(tDate, equityOnly)]
      .filter((r) => r.close >= 50 && r.turnover > 0)
      .sort((a, b) => b.turnover - a.turnover);

    for (let idx = 0; idx < dayRows.length; idx++) {
      const row = dayRows[idx];
      const rankByTurnover = idx + 1;
      const hist20 = store.getSymbolHistory(row.symbol, tDate, 21);
      const isFundamentalLeader = fundamentalLeaders.has(row.symbol.toUpperCase());

      // Pre-check which horizons exist for this checkpoint
      const fwdByH: Partial<Record<5 | 10 | 20, number>> = {};
      for (const h of horizons) {
        if (tIdx + h < dates.length) {
          const futDate = dates[tIdx + h];
          const futClose = closeByDateSym.get(futDate)?.get(row.symbol);
          if (futClose && futClose > 0 && row.close > 0) {
            const ret = ((futClose / row.close) - 1) * 100;
            fwdByH[h] = ret;
            baselineReturns[h].push(ret);
          }
        }
      }

      if (Object.keys(fwdByH).length === 0) continue;

      for (const c of cohortDefs) {
        if (c.match({ row, hist20, rankByTurnover, isFundamentalLeader })) {
          for (const h of horizons) {
            const ret = fwdByH[h];
            if (ret !== undefined) {
              cohortReturns[c.id][h].push(ret);
            }
          }
        }
      }
    }
  }

  const baselineMedian: Record<5 | 10 | 20, number | null> = {
    5: median(baselineReturns[5]),
    10: median(baselineReturns[10]),
    20: median(baselineReturns[20]),
  };

  const baselineByHorizon: Record<'5' | '10' | '20', SignalScorecardHorizonStats> = {
    '5': computeHorizonStats(5, baselineReturns[5], null),
    '10': computeHorizonStats(10, baselineReturns[10], null),
    '20': computeHorizonStats(20, baselineReturns[20], null),
  };

  // Current candidates on latest date
  const latestDate = dates[dates.length - 1];
  const latestRows = [...store.getDayPrices(latestDate, equityOnly)]
    .filter((r) => r.close >= 50 && r.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover);
  const currentCandidatesByCohort: Record<string, string[]> = {};
  for (const c of cohortDefs) currentCandidatesByCohort[c.id] = [];

  for (let idx = 0; idx < latestRows.length; idx++) {
    const row = latestRows[idx];
    const rankByTurnover = idx + 1;
    const hist20 = store.getSymbolHistory(row.symbol, latestDate, 21);
    const isFundamentalLeader = fundamentalLeaders.has(row.symbol.toUpperCase());
    for (const c of cohortDefs) {
      if (
        currentCandidatesByCohort[c.id].length < 10 &&
        c.match({ row, hist20, rankByTurnover, isFundamentalLeader })
      ) {
        currentCandidatesByCohort[c.id].push(row.symbol);
      }
    }
  }

  const cohorts: SignalScorecardCohort[] = cohortDefs.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    description: c.description,
    currentCandidates: currentCandidatesByCohort[c.id],
    statsByHorizon: {
      '5': computeHorizonStats(5, cohortReturns[c.id][5], baselineMedian[5]),
      '10': computeHorizonStats(10, cohortReturns[c.id][10], baselineMedian[10]),
      '20': computeHorizonStats(20, cohortReturns[c.id][20], baselineMedian[20]),
    },
  }));

  return {
    generatedAt: new Date().toISOString(),
    asOfDate: latestDate,
    totalSessionsAnalyzed: dates.length,
    evaluationCheckpoints: checkpointIndices.length,
    baselineByHorizon,
    cohorts,
  };
}
