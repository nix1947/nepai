import type {
  SectorGroup,
  SectorRotationPhase,
  SectorRotationResponse,
  SectorRotationRow,
} from '../../src/types/fundamental.ts';
import type { MarketStore } from '../marketStore.ts';
import { getNepseSector } from '../sectors.ts';
import type { FundamentalVault } from './fundamentalVault.ts';
import { evaluateScreenerUniverse } from './investorScoringEngine.ts';
import { classifySectorGroup } from './nepalCalendar.ts';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function classifyPhase(
  shift5vs20: number,
  return5dPct: number | null,
  breadthPct: number
): SectorRotationPhase {
  const r5 = return5dPct ?? 0;
  if (shift5vs20 >= 0.35 && r5 >= 0) return 'Leading Inflow';
  if (shift5vs20 >= 0.15 || (shift5vs20 >= 0 && breadthPct >= 52)) {
    return 'Improving Accumulation';
  }
  if (shift5vs20 <= -0.35 && r5 < 0) return 'Lagging Outflow';
  if (shift5vs20 < 0 || r5 < 0) return 'Weakening Distribution';
  return 'Improving Accumulation';
}

export function computeSectorRotation(
  store: MarketStore,
  vault: FundamentalVault,
  options: { equityOnly?: boolean; benchmarkFdRatePct?: number } = {}
): SectorRotationResponse {
  const equityOnly = options.equityOnly !== false;
  const dates = store.getDates();
  if (dates.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      asOfDate: null,
      datesUsed: 0,
      totalTurnover1dCr: 0,
      totalTurnover5dAvgCr: 0,
      totalTurnover20dAvgCr: 0,
      sectors: [],
    };
  }

  const latestDate = dates[dates.length - 1];
  const d5Start = dates[Math.max(0, dates.length - 5)];
  const d20Start = dates[Math.max(0, dates.length - 20)];
  const d60Start = dates[Math.max(0, dates.length - 60)];

  const latestRows = store.getDayPrices(latestDate, equityOnly);
  const sum5 = store.rangeSummary(d5Start, latestDate, equityOnly);
  const sum20 = store.rangeSummary(d20Start, latestDate, equityOnly);
  const sum60 = store.rangeSummary(d60Start, latestDate, equityOnly);

  const days5 = Math.max(1, Math.min(5, dates.length));
  const days20 = Math.max(1, Math.min(20, dates.length));
  const days60 = Math.max(1, Math.min(60, dates.length));

  // Fundamental sector averages (ROE / Margin of Safety) from screener universe
  const evaluated = evaluateScreenerUniverse(store, vault, {
    equityOnly,
    benchmarkFdRatePct: options.benchmarkFdRatePct ?? 6.5,
  });

  interface SectorAcc {
    sector: string;
    sectorGroup: SectorGroup;
    stocksSet: Set<string>;
    advancers1d: number;
    decliners1d: number;
    turn1d: number;
    turn5Avg: number;
    turn20Avg: number;
    turn60Avg: number;
    weightedRet1dNum: number;
    weightedRet1dDen: number;
    weightedRet5dNum: number;
    weightedRet5dDen: number;
    weightedRet20dNum: number;
    weightedRet20dDen: number;
    roes: number[];
    moss: number[];
    movers: Array<{
      symbol: string;
      ltp: number;
      changePct: number;
      turnoverCr: number;
    }>;
  }

  const sectorMap = new Map<string, SectorAcc>();
  const ensureSector = (symbol: string, name?: string | null, rawSector?: string | null): SectorAcc => {
    const resolvedSector = rawSector || getNepseSector(symbol, name);
    let acc = sectorMap.get(resolvedSector);
    if (!acc) {
      const cls = classifySectorGroup(symbol, name, resolvedSector);
      acc = {
        sector: cls.sector,
        sectorGroup: cls.sectorGroup,
        stocksSet: new Set<string>(),
        advancers1d: 0,
        decliners1d: 0,
        turn1d: 0,
        turn5Avg: 0,
        turn20Avg: 0,
        turn60Avg: 0,
        weightedRet1dNum: 0,
        weightedRet1dDen: 0,
        weightedRet5dNum: 0,
        weightedRet5dDen: 0,
        weightedRet20dNum: 0,
        weightedRet20dDen: 0,
        roes: [],
        moss: [],
        movers: [],
      };
      sectorMap.set(resolvedSector, acc);
    }
    return acc;
  };

  for (const r of latestRows) {
    const acc = ensureSector(r.symbol, r.name);
    acc.stocksSet.add(r.symbol);
    if (r.diff > 0) acc.advancers1d++;
    else if (r.diff < 0) acc.decliners1d++;
    const turn = r.turnover || 0;
    acc.turn1d += turn;
    if (turn > 0 && r.diff_pct !== null && Number.isFinite(r.diff_pct)) {
      acc.weightedRet1dNum += r.diff_pct * turn;
      acc.weightedRet1dDen += turn;
    }
    acc.movers.push({
      symbol: r.symbol,
      ltp: r.ltp || r.close,
      changePct: round2(r.diff_pct ?? 0),
      turnoverCr: round2(turn / 1e7),
    });
  }

  for (const r of sum5) {
    const acc = ensureSector(r.symbol, r.name, r.sector);
    acc.stocksSet.add(r.symbol);
    const avgDaily = r.turnover / days5;
    acc.turn5Avg += avgDaily;
    if (r.change_pct !== null && r.turnover > 0) {
      acc.weightedRet5dNum += r.change_pct * r.turnover;
      acc.weightedRet5dDen += r.turnover;
    }
  }

  for (const r of sum20) {
    const acc = ensureSector(r.symbol, r.name, r.sector);
    acc.stocksSet.add(r.symbol);
    const avgDaily = r.turnover / days20;
    acc.turn20Avg += avgDaily;
    if (r.change_pct !== null && r.turnover > 0) {
      acc.weightedRet20dNum += r.change_pct * r.turnover;
      acc.weightedRet20dDen += r.turnover;
    }
  }

  for (const r of sum60) {
    const acc = ensureSector(r.symbol, r.name, r.sector);
    acc.stocksSet.add(r.symbol);
    acc.turn60Avg += r.turnover / days60;
  }

  for (const row of evaluated.rows) {
    if (!row.hasFundamentalData) continue;
    const acc = ensureSector(row.symbol, row.companyName, row.sector);
    if (row.keyMetrics.roePct !== null && Number.isFinite(row.keyMetrics.roePct)) {
      acc.roes.push(row.keyMetrics.roePct);
    }
    if (
      row.keyMetrics.marginOfSafetyPct !== null &&
      Number.isFinite(row.keyMetrics.marginOfSafetyPct)
    ) {
      acc.moss.push(row.keyMetrics.marginOfSafetyPct);
    }
  }

  const allAcc = Array.from(sectorMap.values());
  const totalTurn1d = allAcc.reduce((s, a) => s + a.turn1d, 0);
  const totalTurn5Avg = allAcc.reduce((s, a) => s + a.turn5Avg, 0);
  const totalTurn20Avg = allAcc.reduce((s, a) => s + a.turn20Avg, 0);
  const totalTurn60Avg = allAcc.reduce((s, a) => s + a.turn60Avg, 0);

  const sectors: SectorRotationRow[] = allAcc
    .filter((a) => a.stocksSet.size > 0)
    .map((a) => {
      const share1dPct = totalTurn1d > 0 ? round2((a.turn1d / totalTurn1d) * 100) : 0;
      const share5dPct = totalTurn5Avg > 0 ? round2((a.turn5Avg / totalTurn5Avg) * 100) : 0;
      const share20dPct = totalTurn20Avg > 0 ? round2((a.turn20Avg / totalTurn20Avg) * 100) : 0;
      const share60dPct = totalTurn60Avg > 0 ? round2((a.turn60Avg / totalTurn60Avg) * 100) : 0;
      const shareShift5vs20Pp = round2(share5dPct - share20dPct);
      const shareShift20vs60Pp = round2(share20dPct - share60dPct);

      const active1d = a.advancers1d + a.decliners1d;
      const breadthPct =
        active1d > 0 ? round1((a.advancers1d / active1d) * 100) : 50;

      const return1dPct =
        a.weightedRet1dDen > 0 ? round2(a.weightedRet1dNum / a.weightedRet1dDen) : null;
      const return5dPct =
        a.weightedRet5dDen > 0 ? round2(a.weightedRet5dNum / a.weightedRet5dDen) : null;
      const return20dPct =
        a.weightedRet20dDen > 0 ? round2(a.weightedRet20dNum / a.weightedRet20dDen) : null;

      const avgRoePct =
        a.roes.length > 0
          ? round2(a.roes.reduce((s, v) => s + v, 0) / a.roes.length)
          : null;
      const avgMosPct =
        a.moss.length > 0
          ? round2(a.moss.reduce((s, v) => s + v, 0) / a.moss.length)
          : null;

      const rotationPhase = classifyPhase(shareShift5vs20Pp, return5dPct, breadthPct);
      const topMovers = [...a.movers]
        .sort((x, y) => y.turnoverCr - x.turnoverCr)
        .slice(0, 3);

      return {
        sector: a.sector,
        sectorGroup: a.sectorGroup,
        stocksCount: a.stocksSet.size,
        advancers1d: a.advancers1d,
        decliners1d: a.decliners1d,
        breadthPct,
        turnover1dCr: round2(a.turn1d / 1e7),
        turnover5dAvgCr: round2(a.turn5Avg / 1e7),
        turnover20dAvgCr: round2(a.turn20Avg / 1e7),
        share1dPct,
        share5dPct,
        share20dPct,
        share60dPct,
        shareShift5vs20Pp,
        shareShift20vs60Pp,
        return1dPct,
        return5dPct,
        return20dPct,
        avgRoePct,
        avgMosPct,
        rotationPhase,
        topMovers,
      };
    })
    .sort((a, b) => b.share5dPct - a.share5dPct || b.turnover1dCr - a.turnover1dCr);

  return {
    generatedAt: new Date().toISOString(),
    asOfDate: latestDate,
    datesUsed: dates.length,
    totalTurnover1dCr: round2(totalTurn1d / 1e7),
    totalTurnover5dAvgCr: round2(totalTurn5Avg / 1e7),
    totalTurnover20dAvgCr: round2(totalTurn20Avg / 1e7),
    sectors,
  };
}
