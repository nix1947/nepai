import type {
  CompanyFundamentalDetailResponse,
  ExplorerDecisionPillar,
  ExplorerDecisionPlaybook,
  ExplorerOverviewResponse,
  ExplorerTechnicalSummary,
  ReportMonitorStatus,
  ScreenedCompanyRow,
  SectorPeerBenchmark,
} from '../../src/types/fundamental.ts';
import { analyzeSymbolFromStore } from '../analyzer/index.ts';
import type { MarketStore } from '../marketStore.ts';
import { getNepseSector } from '../sectors.ts';
import type { FundamentalVault } from './fundamentalVault.ts';
import {
  buildSectorPeerBenchmark,
  evaluateScreenerUniverse,
} from './investorScoringEngine.ts';
import { classifySectorGroup } from './nepalCalendar.ts';

function clip(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pillarStatus(score: number): ExplorerDecisionPillar['status'] {
  if (score >= 70) return 'Strong';
  if (score >= 54) return 'Constructive';
  if (score >= 42) return 'Neutral';
  return 'Caution';
}

function sanitizeSourceLabel(text: string): string {
  return text.replace(/ShareSansar\s*/gi, 'NEPSE EOD ').trim();
}

export function buildExplorerOverview(params: {
  store: MarketStore;
  vault: FundamentalVault;
  symbol: string;
  equityOnly?: boolean;
  monitorStatusMap?: Map<string, ReportMonitorStatus>;
  benchmarkFdRatePct?: number;
}): ExplorerOverviewResponse {
  const {
    store,
    vault,
    symbol,
    equityOnly = false,
    monitorStatusMap,
    benchmarkFdRatePct = 6.5,
  } = params;

  const sym = symbol.trim().toUpperCase();
  const evaluated = evaluateScreenerUniverse(store, vault, {
    equityOnly,
    monitorStatusMap,
    benchmarkFdRatePct,
  });

  const fundamental: CompanyFundamentalDetailResponse | null =
    evaluated.bySymbol.get(sym) ?? null;
  const summaryRow: ScreenedCompanyRow | null =
    fundamental?.summary ??
    evaluated.rows.find((r) => r.symbol.toUpperCase() === sym) ??
    null;

  const sectorBenchmark: SectorPeerBenchmark | null = buildSectorPeerBenchmark(
    evaluated.rows,
    sym
  );

  const analyzer = analyzeSymbolFromStore(store, {
    symbol: sym,
    tf: '1D',
    strategy: 'All',
  });

  const technical: ExplorerTechnicalSummary | null = analyzer
    ? {
        asOfDate: analyzer.asOfDate,
        tf: '1D',
        trendState: analyzer.trendState,
        htfAlignmentLabel: analyzer.htfBias.alignmentLabel,
        monthlyTrend: analyzer.htfBias.monthly.trend,
        weeklyTrend: analyzer.htfBias.weekly.trend,
        dailyTrend: analyzer.htfBias.daily.trend,
        pctInRange: analyzer.premiumDiscount.pctInRange,
        zoneLabel: analyzer.premiumDiscount.zoneLabel,
        rangeLow: analyzer.premiumDiscount.rangeLow,
        rangeHigh: analyzer.premiumDiscount.rangeHigh,
        passesLiquidityFilter: analyzer.liquidityStats.passesLiquidityFilter,
        avgTurnover20Npr: analyzer.liquidityStats.avgTurnover20Npr,
        topSetup: analyzer.topLongSetup
          ? {
              name: analyzer.topLongSetup.name,
              strategy: analyzer.topLongSetup.strategy,
              grade: analyzer.topLongSetup.grade,
              score: analyzer.topLongSetup.score,
              entryLow: analyzer.topLongSetup.tradePlan.entryLow,
              entryHigh: analyzer.topLongSetup.tradePlan.entryHigh,
              entryMid: analyzer.topLongSetup.tradePlan.entryMid,
              stopLoss: analyzer.topLongSetup.tradePlan.stopLoss,
              target1: analyzer.topLongSetup.tradePlan.target1,
              target2: analyzer.topLongSetup.tradePlan.target2,
              rrT1: analyzer.topLongSetup.tradePlan.rrT1,
              rrT2: analyzer.topLongSetup.tradePlan.rrT2,
              explanation: analyzer.topLongSetup.explanation,
            }
          : null,
        bearishWarningsCount: analyzer.bearishExitWarnings.length,
        narrative: analyzer.narrative.map(sanitizeSourceLabel),
        warnings: analyzer.warnings.map(sanitizeSourceLabel),
      }
    : null;

  const fallbackMeta = classifySectorGroup(
    sym,
    summaryRow?.companyName || analyzer?.name,
    summaryRow?.sector || analyzer?.sector || getNepseSector(sym)
  );
  const companyName = summaryRow?.companyName || analyzer?.name || sym;
  const sector = summaryRow?.sector || analyzer?.sector || fallbackMeta.sector;
  const sectorGroup = summaryRow?.sectorGroup || fallbackMeta.sectorGroup;

  const decisionPlaybook = synthesizeDecisionPlaybook({
    symbol: sym,
    summaryRow,
    fundamental,
    sectorBenchmark,
    technical,
    benchmarkFdRatePct,
  });

  return {
    symbol: sym,
    companyName,
    sector,
    sectorGroup,
    hasFundamentalData: Boolean(fundamental),
    pendingSummary: fundamental ? null : summaryRow,
    fundamental,
    sectorBenchmark,
    technical,
    decisionPlaybook,
    benchmarkFdRatePct,
  };
}

function synthesizeDecisionPlaybook(params: {
  symbol: string;
  summaryRow: ScreenedCompanyRow | null;
  fundamental: CompanyFundamentalDetailResponse | null;
  sectorBenchmark: SectorPeerBenchmark | null;
  technical: ExplorerTechnicalSummary | null;
  benchmarkFdRatePct: number;
}): ExplorerDecisionPlaybook {
  const {
    symbol,
    summaryRow,
    fundamental,
    sectorBenchmark,
    technical,
    benchmarkFdRatePct,
  } = params;

  const avg = sectorBenchmark?.averages ?? null;

  // Compute technical score (0-100) from setup, HTF alignment, dealing range discount, and liquidity
  let techScore = 45;
  if (technical) {
    const setupPart = technical.topSetup ? technical.topSetup.score : 44;
    const htfPart =
      technical.htfAlignmentLabel === 'Full Bullish Alignment'
        ? 90
        : technical.htfAlignmentLabel === 'HTF Bullish / LTF Pullback'
          ? 74
          : technical.htfAlignmentLabel === 'Bearish Alignment'
            ? 25
            : 52;
    const rangeDiscountBonus =
      technical.pctInRange <= 35
        ? 78
        : technical.pctInRange <= 52
          ? 64
          : technical.pctInRange <= 75
            ? 48
            : 32;
    const liqBonus = technical.passesLiquidityFilter ? 6 : -8;
    const warnPenalty = technical.bearishWarningsCount > 0 ? -7 : 0;
    techScore = round1(
      clip(
        setupPart * 0.45 + htfPart * 0.35 + rangeDiscountBonus * 0.2 + liqBonus + warnPenalty,
        10,
        98
      )
    );
  }

  const techHeadline = technical
    ? technical.topSetup
      ? `Grade ${technical.topSetup.grade} ${technical.topSetup.name} (${technical.topSetup.rrT2.toFixed(1)}R) · ${technical.htfAlignmentLabel}`
      : `${technical.htfAlignmentLabel} · ${technical.zoneLabel} (${technical.pctInRange}% of range)`
    : 'No historical price bars loaded for structural scan.';

  if (!fundamental || !summaryRow) {
    const techPillar: ExplorerDecisionPillar = {
      key: 'technical',
      label: 'Technical Structure & Flow',
      score: techScore,
      status: pillarStatus(techScore),
      headline: techHeadline,
    };
    const bullPoints: string[] = [];
    const riskPoints: string[] = [
      'Quarterly financial statements have not been fetched for this security yet.',
    ];
    if (technical?.topSetup) {
      bullPoints.push(
        `Active Grade ${technical.topSetup.grade} long setup: ${technical.topSetup.name} targeting Rs ${technical.topSetup.target2.toFixed(1)} (1:${technical.topSetup.rrT2.toFixed(1)} R:R).`
      );
    }
    if (technical && !technical.passesLiquidityFilter) {
      riskPoints.push(
        `20d average turnover Rs ${(technical.avgTurnover20Npr / 1e5).toFixed(1)}L is below institutional comfort floor.`
      );
    }

    return {
      actionPosture: 'Technical Only (Pending Fundamentals)',
      confluenceScore: Math.round(techScore),
      summaryHeadline: `${symbol} shows ${technical?.htfAlignmentLabel || 'unrated price action'}; fetch latest quarterly financials to unlock intrinsic value and 3Y Q4 average checks.`,
      pillars: [
        {
          key: 'quality',
          label: 'Business Quality',
          score: 0,
          status: 'Neutral',
          headline: 'Pending quarterly ledger',
        },
        {
          key: 'valuation',
          label: 'Intrinsic Value & MoS',
          score: 0,
          status: 'Neutral',
          headline: 'Fetch statements for Fair Value',
        },
        {
          key: 'growth',
          label: '3Y Q4 Growth & Trend',
          score: 0,
          status: 'Neutral',
          headline: 'Awaiting multi-period disclosures',
        },
        techPillar,
      ],
      bullPoints,
      riskPoints,
      executionGuidance: technical?.topSetup
        ? `Technical structure favors watching NPR ${technical.topSetup.entryLow.toFixed(1)}–${technical.topSetup.entryHigh.toFixed(1)} with strict invalidation below NPR ${technical.topSetup.stopLoss.toFixed(1)} once fundamentals are verified.`
        : 'Fetch quarterly reports first to pair balance-sheet conviction with price levels.',
      fdSpreadPct: null,
      benchmarkFdRatePct,
    };
  }

  const km = summaryRow.keyMetrics;
  const q4 = fundamental.growth.q4Benchmark;
  const val = fundamental.valuation;
  const qualityScore = summaryRow.scores.fundamentalQualityScore;
  const valuationScore = summaryRow.scores.valuationAttractivenessScore;

  const eq = fundamental.growth.earningsQuality;
  const preferredQ4Pct =
    eq.hasNonOperatingCaution && q4.operatingProfitVsAvgPct !== null
      ? q4.operatingProfitVsAvgPct
      : q4.epsVsAvgPct ?? q4.operatingProfitVsAvgPct;

  // Blend model growth score with direct 3Y Q4 Average run-rate delta when Q4 history is available
  let growthScore = summaryRow.scores.growthScore;
  if (q4.yearsCount >= 1 && preferredQ4Pct !== null) {
    const q4DeltaScore = clip(55 + preferredQ4Pct * 1.1, 15, 95);
    growthScore = round1(summaryRow.scores.growthScore * 0.55 + q4DeltaScore * 0.45);
  }

  const confluenceScore = Math.round(
    clip(
      qualityScore * 0.30 +
        valuationScore * 0.28 +
        growthScore * 0.20 +
        techScore * 0.22,
      0,
      100
    )
  );

  const mos = val.marginOfSafetyPct;
  const fdSpreadPct =
    val.earningsYieldPct !== null
      ? round2(val.earningsYieldPct - benchmarkFdRatePct)
      : null;

  let actionPosture: ExplorerDecisionPlaybook['actionPosture'] =
    'Value Watchlist (Wait for Structure)';
  if (
    summaryRow.recommendation.verdict === 'AVOID' ||
    (qualityScore < 42 && techScore < 48)
  ) {
    actionPosture = 'Avoid / Capital Preservation';
  } else if (
    qualityScore >= 60 &&
    valuationScore >= 58 &&
    techScore >= 55 &&
    (mos === null || mos >= 8)
  ) {
    actionPosture = 'High-Conviction Buy';
  } else if (
    qualityScore >= 56 &&
    ((mos !== null && mos >= 5) || valuationScore >= 54)
  ) {
    actionPosture = 'Accumulate on Pullback';
  } else if (techScore >= 64 && (mos === null || mos < 0)) {
    actionPosture = 'Momentum Trade Only (Price > Fair Value)';
  } else if (qualityScore >= 55) {
    actionPosture = 'Value Watchlist (Wait for Structure)';
  }

  const roeVsSector =
    km.roePct !== null && avg?.avgRoePct !== null && avg?.avgRoePct !== undefined
      ? round2(km.roePct - avg.avgRoePct)
      : null;
  const qualityHeadline = [
    km.roePct !== null ? `ROE ${km.roePct.toFixed(1)}%` : null,
    roeVsSector !== null
      ? `(${roeVsSector >= 0 ? '+' : ''}${roeVsSector.toFixed(1)}pp vs sector)`
      : null,
    `${summaryRow.passedInvestorCount}/9 investor models`,
  ]
    .filter(Boolean)
    .join(' · ');

  const valHeadline =
    val.intrinsicValue !== null && val.currentPrice !== null
      ? `Fair Rs ${val.intrinsicValue.toFixed(0)} vs LTP ${val.currentPrice.toFixed(0)} (${mos !== null ? `${mos >= 0 ? '+' : ''}${mos.toFixed(1)}% MoS` : 'N/A'})`
      : km.pe !== null
        ? `P/E ${km.pe.toFixed(1)}x · P/B ${km.pb?.toFixed(2) ?? '—'}x`
        : 'Insufficient valuation inputs';

  const growthHeadline =
    eq.hasNonOperatingCaution && q4.operatingProfitVsAvgPct !== null && q4.yearsCount >= 1
      ? `Core Op. Profit ${q4.operatingProfitVsAvgPct >= 0 ? '+' : ''}${q4.operatingProfitVsAvgPct.toFixed(1)}% vs ${q4.yearsCount}Y Q4 Avg (One-Off Caution)`
      : q4.yearsCount >= 1 && q4.epsVsAvgPct !== null
        ? `Annualized EPS ${q4.epsVsAvgPct >= 0 ? '+' : ''}${q4.epsVsAvgPct.toFixed(1)}% vs ${q4.yearsCount}Y Q4 Avg${q4.operatingProfitVsAvgPct !== null ? ` · Op. Profit ${q4.operatingProfitVsAvgPct >= 0 ? '+' : ''}${q4.operatingProfitVsAvgPct.toFixed(1)}%` : ''}`
        : km.operatingProfitQoqPct !== null
          ? `Op. Profit QoQ ${km.operatingProfitQoqPct >= 0 ? '+' : ''}${km.operatingProfitQoqPct.toFixed(1)}% · Awaiting 3Y Q4`
          : km.epsQoqPct !== null
            ? `EPS QoQ ${km.epsQoqPct >= 0 ? '+' : ''}${km.epsQoqPct.toFixed(1)}% · Awaiting 3Y Q4`
            : `Growth Score ${growthScore.toFixed(0)}/100 · ${q4.basisLabel}`;

  const pillars: ExplorerDecisionPillar[] = [
    {
      key: 'quality',
      label: 'Business Quality',
      score: round1(qualityScore),
      status: pillarStatus(qualityScore),
      headline: qualityHeadline || 'Quality assessment ready',
    },
    {
      key: 'valuation',
      label: 'Intrinsic Value & MoS',
      score: round1(valuationScore),
      status: pillarStatus(valuationScore),
      headline: valHeadline,
    },
    {
      key: 'growth',
      label: '3Y Q4 Growth & Trend',
      score: round1(growthScore),
      status: pillarStatus(growthScore),
      headline: growthHeadline,
    },
    {
      key: 'technical',
      label: 'Technical Structure & Flow',
      score: round1(techScore),
      status: pillarStatus(techScore),
      headline: techHeadline,
    },
  ];

  const bullPoints: string[] = [];
  if (q4.yearsCount >= 1 && q4.epsVsAvgPct !== null && q4.epsVsAvgPct > 0) {
    bullPoints.push(
      `Current annualized EPS (Rs ${q4.currentAnnualizedEps?.toFixed(2)}) runs +${q4.epsVsAvgPct.toFixed(1)}% ahead of its ${q4.yearsCount}-Year Q4 average (Rs ${q4.avgEps?.toFixed(2)}).`
    );
  }
  if (mos !== null && mos >= 10 && val.intrinsicValue !== null) {
    bullPoints.push(
      `Trades at a +${mos.toFixed(1)}% Margin of Safety below sector-model intrinsic value (Rs ${val.intrinsicValue.toFixed(1)}).`
    );
  }
  if (roeVsSector !== null && roeVsSector > 1) {
    bullPoints.push(
      `Capital efficiency outperforms ${sectorBenchmark?.averages.sector} peer average ROE (${km.roePct?.toFixed(1)}% vs ${avg?.avgRoePct?.toFixed(1)}%).`
    );
  }
  if (fdSpreadPct !== null && fdSpreadPct > 1) {
    bullPoints.push(
      `Earnings Yield (${val.earningsYieldPct?.toFixed(2)}%) beats Nepal ${benchmarkFdRatePct.toFixed(1)}% FD benchmark by +${fdSpreadPct.toFixed(2)}pp.`
    );
  }
  if (technical?.topSetup) {
    bullPoints.push(
      `Chart confirms Grade ${technical.topSetup.grade} ${technical.topSetup.name} with 1:${technical.topSetup.rrT2.toFixed(1)} R:R toward Rs ${technical.topSetup.target2.toFixed(1)}.`
    );
  }
  for (const s of summaryRow.recommendation.strengths) {
    if (bullPoints.length >= 5) break;
    if (!bullPoints.some((b) => b.slice(0, 24) === s.slice(0, 24))) {
      bullPoints.push(s);
    }
  }

  const riskPoints: string[] = [];
  if (eq.hasNonOperatingCaution && eq.cautionMessage) {
    riskPoints.push(eq.cautionMessage);
  }
  if (q4.yearsCount >= 1 && q4.epsVsAvgPct !== null && q4.epsVsAvgPct < -5) {
    riskPoints.push(
      `Annualized EPS is trailing its ${q4.yearsCount}-Year Q4 baseline by ${q4.epsVsAvgPct.toFixed(1)}% (Rs ${q4.currentAnnualizedEps?.toFixed(2)} vs Rs ${q4.avgEps?.toFixed(2)}).`
    );
  }
  if (mos !== null && mos < 0 && val.intrinsicValue !== null) {
    riskPoints.push(
      `LTP trades ${Math.abs(mos).toFixed(1)}% above estimated fair value (Rs ${val.intrinsicValue.toFixed(1)}), narrowing valuation cushion.`
    );
  }
  if (technical && !technical.passesLiquidityFilter) {
    riskPoints.push(
      `Thin liquidity: 20d avg turnover Rs ${(technical.avgTurnover20Npr / 1e5).toFixed(1)}L increases exit slippage risk.`
    );
  }
  if (technical && technical.bearishWarningsCount > 0) {
    riskPoints.push(
      `${technical.bearishWarningsCount} bearish structural exit warning(s) active on daily timeframe.`
    );
  }
  for (const r of summaryRow.recommendation.downsideRisks) {
    if (riskPoints.length >= 5) break;
    if (!riskPoints.includes(r)) riskPoints.push(r);
  }

  const executionGuidance = (() => {
    const setupPart = technical?.topSetup
      ? `Ideal technical entry sits near NPR ${technical.topSetup.entryLow.toFixed(1)}–${technical.topSetup.entryHigh.toFixed(1)} with stop loss at NPR ${technical.topSetup.stopLoss.toFixed(1)} and Target 1 / 2 at NPR ${technical.topSetup.target1.toFixed(1)} / ${technical.topSetup.target2.toFixed(1)}.`
      : technical
        ? `Dealing range is ${technical.zoneLabel} (${technical.pctInRange}% of NPR ${technical.rangeLow.toFixed(0)}–${technical.rangeHigh.toFixed(0)}); wait for a Discount pullback or structural BOS before sizing up.`
        : 'Verify EOD liquidity and chart structure before executing.';
    const fairPart =
      val.intrinsicValue !== null
        ? `Fundamental fair value anchors at NPR ${val.intrinsicValue.toFixed(1)} (${val.intrinsicValueLow?.toFixed(0)}–${val.intrinsicValueHigh?.toFixed(0)} band).`
        : '';
    return `${fairPart} ${setupPart}`.trim();
  })();

  const summaryHeadline = `${symbol} ranks #${sectorBenchmark?.rankInSector ?? '—'} of ${sectorBenchmark?.rankedTotal || '—'} in ${sectorBenchmark?.averages.sector || summaryRow.sector} with ${confluenceScore}/100 360° Confluence (${summaryRow.passedInvestorCount}/9 investor models · ${technical?.htfAlignmentLabel || 'Technical pending'}).`;

  return {
    actionPosture,
    confluenceScore,
    summaryHeadline,
    pillars,
    bullPoints,
    riskPoints,
    executionGuidance,
    fdSpreadPct,
    benchmarkFdRatePct,
  };
}
