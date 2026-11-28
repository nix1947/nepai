import type {
  MasterLiquiditySnapshot,
  MasterScreenerPreset,
  MasterScreenerResponse,
  MasterScreenerRow,
  MasterTechnicalSnapshot,
  MasterTechnicalTrend,
  MasterTenXSnapshot,
  ReportMonitorStatus,
  ScreenedCompanyRow,
  SectorGroup,
  ValuationUniverseCandidate,
} from '../../src/types/fundamental.ts';
import type { PriceRow } from '../../src/types/market.ts';
import type { MarketStore } from '../marketStore.ts';
import { getValuationUniverseSummary } from './annualValuationEngine.ts';
import { FundamentalVault } from './fundamentalVault.ts';
import { evaluateHiddenGems } from './hiddenGemsEngine.ts';
import { evaluateScreenerUniverse } from './investorScoringEngine.ts';
import { RegulatoryKnowledgeBase } from './regulatoryKnowledgeBase.ts';
import { getSectorThresholds } from './sectorMethodology.ts';

function clip(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeWilderRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return round1(100 - 100 / (1 + rs));
}

function computeEma(values: number[], period = 20): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return round2(ema);
}

function analyzeTechnicalAndLiquidity(
  history: PriceRow[],
  row: ScreenedCompanyRow,
  turnoverRank: number | null
): {
  technical: MasterTechnicalSnapshot;
  liquidity: MasterLiquiditySnapshot;
} {
  const latest = history[history.length - 1] ?? null;
  const ltp = latest?.ltp || latest?.close || row.market.ltp || 0;
  const closes = history.map((h) => h.close || h.ltp).filter((c) => c > 0);
  const rsi14 = computeWilderRsi(closes, 14);
  const ema20 = computeEma(closes, 20);
  const aboveEma20 = ema20 !== null && ltp > 0 ? ltp >= ema20 : false;

  const vsD120Pct =
    latest?.d120 && latest.d120 > 0 && ltp > 0
      ? round1(((ltp - latest.d120) / latest.d120) * 100)
      : row.market.vsD120Pct;
  const vsD180Pct =
    latest?.d180 && latest.d180 > 0 && ltp > 0
      ? round1(((ltp - latest.d180) / latest.d180) * 100)
      : row.market.vsD180Pct;
  const goldenCross =
    latest?.d120 !== null &&
    latest?.d120 !== undefined &&
    latest?.d180 !== null &&
    latest?.d180 !== undefined &&
    latest.d120 > latest.d180;

  const vwapPct =
    latest?.vwap_pct !== null && latest?.vwap_pct !== undefined
      ? round1(latest.vwap_pct)
      : latest?.vwap && latest.vwap > 0 && ltp > 0
        ? round1(((ltp - latest.vwap) / latest.vwap) * 100)
        : null;

  const w52High = latest?.w52_high ?? row.market.w52High;
  const w52Low = latest?.w52_low ?? row.market.w52Low;
  const gap52hPct =
    w52High && w52High > 0 && ltp > 0
      ? round1(((ltp - w52High) / w52High) * 100)
      : row.market.gap52hPct;
  const pos52wPct =
    w52High && w52Low && w52High > w52Low && ltp > 0
      ? round1(clip(((ltp - w52Low) / (w52High - w52Low)) * 100, 0, 100))
      : null;

  const tail20 = history.slice(-20);
  const prior20 = history.slice(-21, -1);
  const prior20High = prior20.length >= 10 ? Math.max(...prior20.map((r) => r.high || r.close)) : null;

  const avgTurnover20 =
    tail20.length > 0
      ? tail20.reduce((s, r) => s + (r.turnover || 0), 0) / tail20.length
      : row.market.avgTurnoverN ?? 0;
  const avgVolume20 =
    tail20.length > 0 ? tail20.reduce((s, r) => s + (r.volume || 0), 0) / tail20.length : 0;

  const latestTurnover = latest?.turnover ?? row.market.turnover ?? 0;
  const latestVolume = latest?.volume ?? row.market.volume ?? 0;

  const turnoverSpikeMult =
    avgTurnover20 > 0 && latestTurnover > 0 ? round2(latestTurnover / avgTurnover20) : row.market.turnoverMultN;
  const volumeSpikeMult =
    avgVolume20 > 0 && latestVolume > 0 ? round2(latestVolume / avgVolume20) : null;

  const avgTicketNpr =
    latest && latest.trans > 0 && latestTurnover > 0
      ? Math.round(latestTurnover / latest.trans)
      : null;

  let upVol = 0;
  let downVol = 0;
  for (const r of tail20) {
    const chg = r.diff_pct ?? (r.prev_close > 0 ? ((r.close - r.prev_close) / r.prev_close) * 100 : 0);
    if (chg > 0) upVol += r.volume || 0;
    else if (chg < 0) downVol += r.volume || 0;
  }
  const upDownVolRatio =
    downVol > 0 ? round2(upVol / downVol) : upVol > 0 ? 3.0 : null;

  const breakout20d =
    prior20High !== null &&
    ltp > prior20High &&
    ((volumeSpikeMult ?? 1) >= 1.2 || (turnoverSpikeMult ?? 1) >= 1.2);

  const return5dPct =
    history.length >= 6 && history[history.length - 6].close > 0 && ltp > 0
      ? round1(((ltp - history[history.length - 6].close) / history[history.length - 6].close) * 100)
      : null;
  const return20dPct =
    history.length >= 20 && history[0] && tail20[0]?.close > 0 && ltp > 0
      ? round1(((ltp - tail20[0].close) / tail20[0].close) * 100)
      : row.market.periodReturnNPct;

  // Trend State classification
  let trendState: MasterTechnicalTrend = 'Base / Accumulation';
  if (aboveEma20 && (vsD120Pct ?? 0) > 0 && (vsD180Pct ?? 0) > 0 && (rsi14 ?? 50) >= 52) {
    trendState = 'Strong Uptrend';
  } else if ((aboveEma20 && (vsD120Pct ?? 0) >= 0) || (goldenCross && (return20dPct ?? 0) > 0)) {
    trendState = 'Uptrend';
  } else if (!aboveEma20 && (vsD180Pct ?? -1) >= 0 && (rsi14 ?? 50) >= 38 && (rsi14 ?? 50) <= 55) {
    trendState = 'Pullback in Uptrend';
  } else if (!aboveEma20 && (vsD120Pct ?? 0) < -3 && (return20dPct ?? 0) < -3) {
    trendState = 'Downtrend';
  }

  // Technical Score (0-100)
  let techScore = 38;
  if (aboveEma20) techScore += 14;
  if ((vsD120Pct ?? -99) > 0) techScore += 10;
  if ((vsD180Pct ?? -99) > 0) techScore += 8;
  if (goldenCross) techScore += 6;
  if (vwapPct !== null && vwapPct > 0) techScore += 5;
  if (rsi14 !== null) {
    if (rsi14 >= 50 && rsi14 <= 68) techScore += 12; // ideal momentum sweet spot
    else if (rsi14 >= 35 && rsi14 < 50 && (upDownVolRatio ?? 1) >= 1.15) techScore += 8; // constructive bounce zone
    else if (rsi14 > 68 && rsi14 <= 78) techScore += 6;
    else if (rsi14 < 30) techScore += 4; // deeply oversold reversal watch
  }
  if (breakout20d) techScore += 9;
  if ((upDownVolRatio ?? 0) >= 1.3) techScore += 6;
  if ((return20dPct ?? 0) > 4 && (return20dPct ?? 0) < 25) techScore += 4;
  if (trendState === 'Downtrend') techScore -= 12;
  techScore = round1(clip(techScore, 0, 100));

  const techSignals: string[] = [];
  if (breakout20d) techSignals.push('20D Volume Breakout');
  if (goldenCross) techSignals.push('D120 > D180 Cross');
  if (aboveEma20 && (vsD120Pct ?? -1) > 0) techSignals.push('Above EMA20 & D120');
  if (rsi14 !== null && rsi14 >= 52 && rsi14 <= 68) techSignals.push(`Bullish RSI ${rsi14.toFixed(0)}`);
  else if (rsi14 !== null && rsi14 <= 34) techSignals.push(`Oversold RSI ${rsi14.toFixed(0)}`);
  if (vwapPct !== null && vwapPct > 0.3) techSignals.push('Above VWAP');
  if (techSignals.length === 0 && pos52wPct !== null && pos52wPct <= 35) {
    techSignals.push('Near 52W Support Zone');
  }

  // Player / Institutional Liquidity Score (0-100)
  const latestTurnoverCr = round2(latestTurnover / 1e7);
  const avgTurnover20Cr = round2(avgTurnover20 / 1e7);
  let playerScore = 15;
  if (avgTurnover20Cr >= 5.0) playerScore += 30;
  else if (avgTurnover20Cr >= 2.0) playerScore += 24;
  else if (avgTurnover20Cr >= 0.75) playerScore += 17;
  else if (avgTurnover20Cr >= 0.25) playerScore += 10;

  if ((turnoverSpikeMult ?? 0) >= 2.2) playerScore += 22;
  else if ((turnoverSpikeMult ?? 0) >= 1.5) playerScore += 15;
  else if ((turnoverSpikeMult ?? 0) >= 1.15) playerScore += 8;

  if ((avgTicketNpr ?? 0) >= 220_000) playerScore += 16;
  else if ((avgTicketNpr ?? 0) >= 120_000) playerScore += 11;
  else if ((avgTicketNpr ?? 0) >= 70_000) playerScore += 6;

  if ((upDownVolRatio ?? 0) >= 1.45) playerScore += 15;
  else if ((upDownVolRatio ?? 0) >= 1.15) playerScore += 9;
  else if ((upDownVolRatio ?? 1) < 0.75) playerScore -= 6;

  if (turnoverRank !== null && turnoverRank <= 25) playerScore += 6;
  playerScore = round1(clip(playerScore, 0, 100));

  const accumulationFlag =
    (upDownVolRatio ?? 0) >= 1.25 &&
    ((turnoverSpikeMult ?? 0) >= 1.15 || (avgTicketNpr ?? 0) >= 120_000);

  let playerTier: MasterLiquiditySnapshot['playerTier'] = 'Thin Liquidity';
  if (avgTurnover20Cr >= 2.0 && ((avgTicketNpr ?? 0) >= 130_000 || (turnoverSpikeMult ?? 0) >= 1.6)) {
    playerTier = 'Institutional / HNI Flow';
  } else if (avgTurnover20Cr >= 0.75 || (turnoverRank !== null && turnoverRank <= 45)) {
    playerTier = 'Active High Liquidity';
  } else if (avgTurnover20Cr >= 0.2) {
    playerTier = 'Moderate Retail';
  }

  return {
    technical: {
      technicalScore: techScore,
      trendState,
      rsi14,
      ema20,
      aboveEma20,
      vsD120Pct,
      vsD180Pct,
      goldenCross,
      vwapPct,
      gap52hPct,
      pos52wPct,
      breakout20d,
      return5dPct,
      return20dPct,
      signals: techSignals.slice(0, 3),
    },
    liquidity: {
      playerInterestScore: playerScore,
      latestTurnoverCr,
      avgTurnover20Cr,
      turnoverSpikeMult,
      latestVolume,
      avgVolume20: Math.round(avgVolume20),
      volumeSpikeMult,
      avgTicketNpr,
      playerTier,
      upDownVolRatio,
      accumulationFlag,
      turnoverRank,
    },
  };
}

function buildTenXSnapshot(params: {
  row: ScreenedCompanyRow;
  valCand: ValuationUniverseCandidate | undefined;
  marketCapCr: number | null;
  liquidity: MasterLiquiditySnapshot;
  technical: MasterTechnicalSnapshot;
  reserveToCapitalRatio: number | null;
  lockInOverhangFlag: boolean;
  hasTailwinds: boolean;
}): MasterTenXSnapshot {
  const {
    row,
    valCand,
    marketCapCr,
    liquidity,
    technical,
    reserveToCapitalRatio,
    lockInOverhangFlag,
    hasTailwinds,
  } = params;
  const km = row.keyMetrics;
  const cfg = getSectorThresholds(row.sectorGroup);
  const ltp = row.market.ltp;

  const catalysts: string[] = [];
  let score = 0;

  // 1. Small/Mid Cap Size Runway (max 24)
  if (marketCapCr !== null && marketCapCr > 0) {
    if (marketCapCr <= 700) {
      score += 24;
      catalysts.push(`Small-Cap Runway (Rs ${marketCapCr.toFixed(0)} Cr)`);
    } else if (marketCapCr <= 1800) {
      score += 18;
      catalysts.push(`Mid-Cap Expansion Base (Rs ${marketCapCr.toFixed(0)} Cr)`);
    } else if (marketCapCr <= 3800) {
      score += 11;
    } else {
      score += 4;
    }
  } else {
    score += 10;
  }

  // 2. Earnings Growth & Inflection (max 24)
  const epsG = km.epsCagr3yPct ?? km.epsYoyPct ?? 0;
  const revG = km.revenueCagr3yPct ?? km.revenueYoyPct ?? 0;
  if (epsG >= 22 || revG >= 20) {
    score += 22;
    catalysts.push(`High Compounding (${epsG >= 22 ? `EPS +${epsG.toFixed(0)}%` : `Rev +${revG.toFixed(0)}%`})`);
  } else if (epsG >= 12 || revG >= 12) {
    score += 15;
    catalysts.push('Double-Digit Earnings Growth');
  } else if ((km.epsVsQ4Avg3yPct ?? 0) >= 15) {
    score += 13;
    catalysts.push(`Beating 3Y Q4 Baseline (+${km.epsVsQ4Avg3yPct?.toFixed(0)}%)`);
  } else if ((km.eps ?? 0) > 0 && (km.roePct ?? 0) >= cfg.strongRoePct) {
    score += 11;
  }

  // 3. Capital Efficiency + Bonus Reinvestment Cushion (max 20)
  if ((km.roePct ?? 0) >= cfg.strongRoePct) {
    score += 12;
    catalysts.push(`High ROE Moat (${km.roePct?.toFixed(1)}%)`);
  } else if ((km.roePct ?? 0) >= cfg.minRoePct) {
    score += 7;
  }
  if ((reserveToCapitalRatio ?? 0) >= 0.85) {
    score += 8;
    catalysts.push(`Bonus/Reserve Cushion (${reserveToCapitalRatio?.toFixed(2)}x)`);
  } else if ((reserveToCapitalRatio ?? 0) >= 0.45) {
    score += 4;
  }

  // 4. Entry Margin of Safety & Valuation Re-rating Runway (max 18)
  const mos = valCand?.marginOfSafetyPct ?? km.marginOfSafetyPct;
  if (mos !== null && mos >= 20) {
    score += 18;
    catalysts.push(`Deep Value Entry (+${mos.toFixed(0)}% MoS)`);
  } else if (mos !== null && mos >= 8) {
    score += 13;
    catalysts.push(`Attractive MoS (+${mos.toFixed(0)}%)`);
  } else if (mos !== null && mos >= 0) {
    score += 8;
  } else if ((km.pb ?? 99) <= cfg.deepValuePb) {
    score += 9;
  }

  // 5. Sector Scaling & Technical Accumulation Tailwinds (max 14)
  if (
    row.sectorGroup === 'Hydropower' ||
    row.sectorGroup === 'Manufacturing' ||
    row.sectorGroup === 'Microfinance' ||
    row.sectorGroup === 'Other'
  ) {
    score += 5;
  } else {
    score += 2;
  }
  if (liquidity.accumulationFlag || technical.breakout20d) {
    score += 6;
    catalysts.push('Smart Money Accumulation');
  } else if (technical.technicalScore >= 60) {
    score += 3;
  }
  if (hasTailwinds) score += 3;
  if (lockInOverhangFlag) score -= 12;
  if ((km.eps ?? 0) <= 0) score -= 14;

  score = round1(clip(score, 0, 100));

  // Project 5Y Bull target price & multiple using conservative-to-bull compounding
  let bull5yPrice: number | null = null;
  let bull5yMultiple: number | null = null;
  let bull5yCagrPct: number | null = null;
  const anchorFair = valCand?.compositeFairValue ?? km.intrinsicValue;
  if (anchorFair && anchorFair > 0 && ltp && ltp > 0) {
    const roe = km.roePct ?? cfg.minRoePct;
    const baseG = clip(km.epsCagr3yPct ?? km.epsYoyPct ?? (roe > 0 ? roe * 0.48 : 8), 4, cfg.sustainableGrowthCapPct);
    const gBull = Math.min(0.24, (baseG * 1.35 + 2) / 100);
    bull5yPrice = round1(anchorFair * 1.2 * Math.pow(1 + gBull, 5));
    bull5yMultiple = round2(bull5yPrice / ltp);
    bull5yCagrPct = round1((Math.pow(bull5yPrice / ltp, 1 / 5) - 1) * 100);
  }

  const tier: MasterTenXSnapshot['tier'] =
    score >= 70
      ? 'High 10x Runway'
      : score >= 55
        ? 'Emerging Multi-Bagger'
        : score >= 40
          ? 'Steady Compounder'
          : 'Mature / Low Runway';

  return {
    tenXScore: score,
    tier,
    marketCapCr,
    bull5yPrice,
    bull5yMultiple,
    bull5yCagrPct,
    catalysts: catalysts.slice(0, 4),
  };
}

export function computeMasterScreener(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  opts: {
    equityOnly?: boolean;
    benchmarkFdRatePct?: number;
    annualWeightPct?: number;
    monitorStatusMap?: Map<string, ReportMonitorStatus>;
  } = {}
): MasterScreenerResponse {
  const equityOnly = opts.equityOnly !== false;
  const benchmarkFdRatePct = opts.benchmarkFdRatePct ?? 6.5;
  const annualWeightPct = Math.round(
    clip(
      opts.annualWeightPct !== undefined && Number.isFinite(opts.annualWeightPct)
        ? opts.annualWeightPct
        : 70,
      0,
      100
    )
  );

  const kbMap = kb.getAllCompanyEntries();
  const evaluated = evaluateScreenerUniverse(store, vault, {
    equityOnly,
    benchmarkFdRatePct,
    annualWeightPct,
    monitorStatusMap: opts.monitorStatusMap,
    kbMap,
  });

  const valUniverse = getValuationUniverseSummary(store, vault, kb, {
    equityOnly,
    benchmarkFdRatePct,
    annualWeightPct,
    monitorStatusMap: opts.monitorStatusMap,
  });
  const valMap = new Map(valUniverse.candidates.map((c) => [c.symbol, c]));

  const gemsResp = evaluateHiddenGems(store, vault, kb, {
    equityOnly,
    benchmarkFdRatePct,
    annualWeightPct,
    monitorStatusMap: opts.monitorStatusMap,
  });
  const gemMap = new Map(gemsResp.gems.map((g) => [g.symbol, g]));

  const marketDate = evaluated.marketDate;

  const turnoverRanked = [...evaluated.rows]
    .filter((r) => (r.market.turnover ?? 0) > 0)
    .sort((a, b) => (b.market.turnover ?? 0) - (a.market.turnover ?? 0));
  const turnoverRankMap = new Map<string, number>();
  turnoverRanked.forEach((r, idx) => turnoverRankMap.set(r.symbol, idx + 1));

  const rows: MasterScreenerRow[] = [];
  const sectorSet = new Set<string>();
  const sectorGroupSet = new Set<SectorGroup>();

  for (const row of evaluated.rows) {
    const history = marketDate ? store.getSymbolHistory(row.symbol, marketDate, 120) : [];
    const turnoverRank = turnoverRankMap.get(row.symbol) ?? null;
    const { technical, liquidity } = analyzeTechnicalAndLiquidity(history, row, turnoverRank);

    const valCand = valMap.get(row.symbol);
    const gemCand = gemMap.get(row.symbol);
    const kbEntry = kbMap.get(row.symbol) ?? null;
    const detail = evaluated.bySymbol.get(row.symbol);

    const km = row.keyMetrics;
    const compositeFairValue = valCand?.compositeFairValue ?? km.intrinsicValue;
    const marginOfSafetyPct = valCand?.marginOfSafetyPct ?? km.marginOfSafetyPct;
    const buyZonePrice = compositeFairValue ? round1(compositeFairValue * 0.85) : null;
    const inBuyZone =
      buyZonePrice !== null && row.market.ltp !== null && row.market.ltp > 0 && row.market.ltp <= buyZonePrice;

    const fdSpreadPct =
      km.earningsYieldPct !== null ? round2(km.earningsYieldPct - benchmarkFdRatePct) : null;

    const reserveToCapitalRatio = valCand?.reserveToCapitalRatio ?? (() => {
      const st = detail?.statements[0];
      if (!st) return null;
      const cap = st.metrics.shareCapital.value;
      const res = st.metrics.reserves.value;
      const ret = st.metrics.retainedEarnings.value ?? 0;
      if (cap && cap > 0 && res !== null) return round2((res + Math.max(0, ret)) / cap);
      return null;
    })();

    const marketCapCr = detail?.valuation.marketCap
      ? round1(detail.valuation.marketCap / 1e7)
      : null;

    const tenX = buildTenXSnapshot({
      row,
      valCand,
      marketCapCr,
      liquidity,
      technical,
      reserveToCapitalRatio,
      lockInOverhangFlag: kbEntry?.lockInOverhangFlag ?? false,
      hasTailwinds: (kbEntry?.tailwinds.length ?? 0) > 0,
    });

    // Earnings Power & Growth Momentum Score (0-100)
    let earnScore = 15;
    if ((km.eps ?? 0) >= 30) earnScore += 20;
    else if ((km.eps ?? 0) >= 18) earnScore += 15;
    else if ((km.eps ?? 0) > 0) earnScore += 8;

    if ((km.roePct ?? 0) >= 18) earnScore += 16;
    else if ((km.roePct ?? 0) >= 13) earnScore += 11;
    else if ((km.roePct ?? 0) >= 8) earnScore += 6;

    if ((fdSpreadPct ?? -99) >= 1.0) earnScore += 12;
    else if ((fdSpreadPct ?? -99) >= 0) earnScore += 7;

    if ((km.netMarginPct ?? 0) >= 22) earnScore += 8;
    else if ((km.netMarginPct ?? 0) >= 12) earnScore += 4;

    if ((km.epsCagr3yPct ?? 0) >= 15) earnScore += 14;
    else if ((km.epsCagr3yPct ?? 0) >= 6) earnScore += 8;
    if ((km.epsYoyPct ?? 0) >= 15) earnScore += 12;
    else if ((km.epsYoyPct ?? 0) > 0) earnScore += 6;
    else if ((km.epsQoqPct ?? 0) >= 8) earnScore += 8;
    if ((km.revenueCagr3yPct ?? km.revenueYoyPct ?? 0) >= 12) earnScore += 8;
    if ((km.epsVsQ4Avg3yPct ?? 0) >= 10) earnScore += 8;
    if ((km.eps ?? 0) <= 0) earnScore = 8;
    earnScore = round1(clip(earnScore, 0, 100));

    // Unified Master Confluence Score (0-100)
    const valComponent = valCand?.valuationHealthScore ?? row.scores.valuationAttractivenessScore;
    const fundComponent = row.scores.overallScore;
    const masterScore = round1(
      clip(
        valComponent * 0.28 +
          fundComponent * 0.27 +
          technical.technicalScore * 0.23 +
          liquidity.playerInterestScore * 0.22,
        0,
        100
      )
    );

    const actionTags: string[] = [];
    if (row.comingQuarterOutlook.direction === 'Blow Up') actionTags.push('Next Qtr Blow-Up');
    else if (row.comingQuarterOutlook.direction === 'Blow Down') actionTags.push('Next Qtr Blow-Down');
    if (liquidity.playerTier === 'Institutional / HNI Flow') actionTags.push('High Player Flow');
    if (inBuyZone) actionTags.push('In Buy Zone');
    if (row.reportWeighting.hasAnnualReport) actionTags.push('Annual Verified');
    if ((gemCand?.hiddenGemScore ?? 0) >= 65) actionTags.push('Annual Gem');
    if (technical.breakout20d) actionTags.push('20D Breakout');
    if (tenX.tenXScore >= 65) actionTags.push('10x Runway');
    if ((fdSpreadPct ?? -99) >= 1.5) actionTags.push('Beats FD');

    sectorSet.add(row.sector);
    sectorGroupSet.add(row.sectorGroup);

    rows.push({
      symbol: row.symbol,
      companyName: row.companyName,
      sector: row.sector,
      sectorGroup: row.sectorGroup,
      ltp: row.market.ltp,
      changePct: row.market.changePct,
      hasFundamentalData: row.hasFundamentalData,
      hasAnnualReport: row.reportWeighting.hasAnnualReport,
      annualPeriodLabel: row.reportWeighting.annualPeriodLabel,
      masterScore,
      technical,
      liquidity,
      tenX,
      valuation: {
        compositeFairValue,
        marginOfSafetyPct,
        pricingVerdict: valCand?.pricingVerdict ?? 'Insufficient Data',
        inBuyZone,
        buyZonePrice,
        pe: km.pe,
        pb: km.pb,
        peg: km.peg,
        earningsYieldPct: km.earningsYieldPct,
        fdSpreadPct,
        valuationHealthScore: valCand?.valuationHealthScore ?? null,
        healthBand: valCand?.healthBand ?? null,
        safetyScore: valCand?.safetyScore ?? null,
        growthScore: valCand?.growthScore ?? null,
      },
      fundamentals: {
        overallScore: row.scores.overallScore,
        qualityScore: row.scores.fundamentalQualityScore,
        passedInvestorCount: row.passedInvestorCount,
        verdict: row.recommendation.verdict,
        roePct: km.roePct,
        netMarginPct: km.netMarginPct,
        reserveToCapitalRatio,
        nplPct: km.nplPct,
        debtToEquity: km.debtToEquity,
        carPct: km.carPct,
        creditRatingLabel: valCand?.creditRatingLabel ?? null,
        regulatoryStanding: kbEntry?.regulatoryStanding ?? 'Unknown',
        lockInOverhangFlag: kbEntry?.lockInOverhangFlag ?? false,
      },
      earnings: {
        eps: km.eps,
        bvps: km.bvps,
        epsYoyPct: km.epsYoyPct,
        epsCagr3yPct: km.epsCagr3yPct,
        revenueGrowthPct: km.revenueCagr3yPct ?? km.revenueYoyPct,
        netProfitYoyPct: km.netProfitYoyPct,
        epsVsQ4Avg3yPct: km.epsVsQ4Avg3yPct,
        earningsMomentumScore: earnScore,
      },
      gems: {
        hiddenGemScore: gemCand?.hiddenGemScore ?? null,
        convictionTier: gemCand?.convictionTier ?? null,
        archetypes: gemCand?.archetypes ?? [],
        whyGem: gemCand?.whyHiddenGem ?? [],
      },
      comingQuarterOutlook: row.comingQuarterOutlook,
      actionTags: actionTags.slice(0, 5),
    });
  }

  rows.sort((a, b) => b.masterScore - a.masterScore || b.liquidity.playerInterestScore - a.liquidity.playerInterestScore);

  const presetCounts: Record<MasterScreenerPreset, number> = {
    master_all: rows.length,
    player_liquidity: rows.filter(
      (r) => r.liquidity.playerInterestScore >= 55 || r.liquidity.avgTurnover20Cr >= 1.0
    ).length,
    best_valuation: rows.filter(
      (r) => (r.valuation.marginOfSafetyPct ?? -999) >= 8 || r.valuation.inBuyZone
    ).length,
    annual_gems: rows.filter(
      (r) =>
        r.hasAnnualReport ||
        (r.gems.hiddenGemScore ?? 0) >= 58 ||
        (r.fundamentals.reserveToCapitalRatio ?? 0) >= 0.75
    ).length,
    fundamental_titans: rows.filter(
      (r) =>
        r.hasFundamentalData &&
        r.fundamentals.overallScore >= 58 &&
        r.fundamentals.passedInvestorCount >= 3
    ).length,
    earnings_accelerators: rows.filter(
      (r) =>
        (r.earnings.epsYoyPct ?? -999) >= 10 ||
        (r.earnings.epsCagr3yPct ?? -999) >= 10 ||
        r.earnings.earningsMomentumScore >= 60
    ).length,
    technical_breakouts: rows.filter(
      (r) =>
        r.technical.breakout20d ||
        r.technical.trendState === 'Strong Uptrend' ||
        r.technical.trendState === 'Uptrend'
    ).length,
    future_10x: rows.filter((r) => r.tenX.tenXScore >= 55).length,
    coming_qtr_blowup: rows.filter(
      (r) =>
        r.hasFundamentalData &&
        (r.comingQuarterOutlook.direction === 'Blow Up' ||
          r.comingQuarterOutlook.direction === 'Moderate Upside')
    ).length,
    coming_qtr_blowdown: rows.filter(
      (r) =>
        r.hasFundamentalData &&
        (r.comingQuarterOutlook.direction === 'Blow Down' ||
          r.comingQuarterOutlook.direction === 'Downside Risk')
    ).length,
  };

  return {
    generatedAt: new Date().toISOString(),
    marketDate,
    annualWeightPct,
    benchmarkFdRatePct,
    totalSymbols: rows.length,
    presetCounts,
    sectors: Array.from(sectorSet).sort(),
    sectorGroups: Array.from(sectorGroupSet).sort() as SectorGroup[],
    rows,
  };
}
