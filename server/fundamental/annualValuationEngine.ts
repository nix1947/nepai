import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import fs from 'fs';
import path from 'path';
import type {
  AnnualDissectorMetricRow,
  AnnualDissectorPeerRow,
  AnnualDissectorSection,
  AnnualReportAiDeepDive,
  AnnualReportDissector,
  AnnualReportForensics,
  CompanyFundamentalDetailResponse,
  CompanyValuationDossierResponse,
  FutureWorthScenario,
  HealthSignalStatus,
  IndustryAverageMetrics,
  QuarterlyStatementRecord,
  ReportMonitorStatus,
  ScreenedCompanyRow,
  SectorPeerBenchmark,
  SwotAndFutureWorth,
  ValuationHealthMetricContribution,
  ValuationHealthPillar,
  ValuationHealthScore,
  ValuationModelEstimate,
  ValuationSensitivityCell,
  ValuationUniverseCandidate,
  ValuationUniverseResponse,
} from '../../src/types/fundamental.ts';
import type { MarketStore } from '../marketStore.ts';
import { FundamentalVault } from './fundamentalVault.ts';
import {
  buildSectorPeerBenchmark,
  evaluateScreenerUniverse,
} from './investorScoringEngine.ts';
import { RegulatoryKnowledgeBase } from './regulatoryKnowledgeBase.ts';
import { getSectorThresholds } from './sectorMethodology.ts';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function clip(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toCr(v: number | null | undefined): number | null {
  return v !== null && v !== undefined && Number.isFinite(v) ? round2(v / 1e7) : null;
}

function cachePathFor(vault: FundamentalVault): string {
  return path.join(vault.vaultDir, 'annual-deep-dive-cache.json');
}

function loadDeepDiveCache(vault: FundamentalVault): Record<string, AnnualReportAiDeepDive> {
  try {
    const file = cachePathFor(vault);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, AnnualReportAiDeepDive>;
    }
    return {};
  } catch {
    return {};
  }
}

function saveDeepDiveCache(
  vault: FundamentalVault,
  cache: Record<string, AnnualReportAiDeepDive>
): void {
  try {
    if (!fs.existsSync(vault.vaultDir)) fs.mkdirSync(vault.vaultDir, { recursive: true });
    fs.writeFileSync(cachePathFor(vault), JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // ignore disk cache write failure
  }
}

function getAiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add it in Settings > Secrets to run live Annual Report search deep-dive.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseJsonObjectSafe(rawText: string): Record<string, unknown> | null {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function strArr(v: unknown, limit = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, limit);
}

function strOrFallback(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function buildMultiModels(params: {
  summary: ScreenedCompanyRow;
  detail: CompanyFundamentalDetailResponse;
  forensics: AnnualReportForensics;
  peerBenchmark: SectorPeerBenchmark | null;
  benchmarkFdRatePct: number;
}): ValuationModelEstimate[] {
  const { summary, detail, forensics, peerBenchmark, benchmarkFdRatePct } = params;
  const km = summary.keyMetrics;
  const cfg = getSectorThresholds(summary.sectorGroup);
  const ltp = summary.market.ltp;

  const eps = km.eps;
  const bvps = km.bvps;
  const roe = km.roePct;
  const costOfEquityPct = Math.max(10.5, benchmarkFdRatePct + 5.5, cfg.defaultCostOfEquityPct);
  const keDec = costOfEquityPct / 100;

  const rawGrowth =
    km.epsCagr3yPct ??
    km.epsYoyPct ??
    km.netProfitYoyPct ??
    (roe !== null && roe > 0 ? Math.min(cfg.sustainableGrowthCapPct, roe * 0.45) : 6.0);
  const gSustPct = clip(rawGrowth, 2.5, cfg.sustainableGrowthCapPct);
  const gDec = Math.min(keDec - 0.02, gSustPct / 100);

  const calcUpside = (price: number | null): number | null =>
    price !== null && ltp !== null && ltp > 0 ? round1(((price - ltp) / ltp) * 100) : null;

  // 1. Justified P/B & Residual Income Valuation
  let justifiedPbPrice: number | null = null;
  let justifiedPbNote = 'Requires positive Book Value/Share and ROE.';
  if (bvps !== null && bvps > 0 && roe !== null) {
    const roeDec = roe / 100;
    const jPb = clip((roeDec - gDec) / Math.max(0.025, keDec - gDec), 0.45, 4.5);
    justifiedPbPrice = round1(bvps * jPb);
    justifiedPbNote = `Fair P/B of ${jPb.toFixed(2)}x implied by ${roe.toFixed(1)}% weighted ROE vs ${costOfEquityPct.toFixed(1)}% hurdle rate.`;
  }

  // 2. Earnings Power Value (EPV - Zero-Growth Steady State)
  let epvPrice: number | null = null;
  let epvNote = 'Requires positive annualized EPS.';
  if (eps !== null && eps > 0) {
    const capRate = Math.max(0.075, keDec - 0.025);
    epvPrice = round1(eps / capRate);
    epvNote = `Capitalizes normalized Rs ${eps.toFixed(2)} EPS at ${(capRate * 100).toFixed(1)}% conservative earnings yield.`;
  }

  // 3. Graham Defensive & Earnings Growth Pricing
  let grahamPrice: number | null = null;
  let grahamNote = 'Requires positive EPS (and BVPS for Graham Number).';
  if (eps !== null && eps > 0) {
    const rateScale = clip(5.5 / Math.max(4.0, benchmarkFdRatePct), 0.55, 1.05);
    const growthModel = eps * (8.5 + 1.5 * gSustPct) * rateScale;
    if (bvps !== null && bvps > 0) {
      const grahamNumber = Math.sqrt(22.5 * eps * bvps);
      grahamPrice = round1((growthModel + grahamNumber) / 2);
      grahamNote = `Blends classic Graham Number (Rs ${grahamNumber.toFixed(0)}) with Nepal-rate-scaled Earnings Growth price (Rs ${growthModel.toFixed(0)}).`;
    } else {
      grahamPrice = round1(growthModel);
      grahamNote = `Graham formula scaled by ${rateScale.toFixed(2)}x for ${benchmarkFdRatePct.toFixed(1)}% Nepal Bank FD rate.`;
    }
  }

  // 4. Owner Earnings / Retained Equity 10Y Compounder Model
  let compounderPrice: number | null = null;
  let compounderNote = 'Requires OCF/share or positive BVPS + ROE compounding power.';
  const latestSt = detail.statements[0];
  const fcf =
    latestSt?.metrics.freeCashFlow.value ??
    latestSt?.metrics.ownerEarnings.value ??
    latestSt?.metrics.operatingCashFlow.value;
  const shares = latestSt?.metrics.outstandingShares.value;
  if (cfg.usesIndustrialDebtAndEv && fcf !== null && fcf > 0 && shares !== null && shares > 0) {
    const fcfPerShare = fcf / shares;
    const wacc = (costOfEquityPct - 0.5) / 100;
    const g1 = gSustPct / 100;
    const gTerm = 0.04;
    let pv = 0;
    let cf = fcfPerShare;
    for (let yr = 1; yr <= 10; yr++) {
      cf *= 1 + (yr <= 5 ? g1 : (g1 + gTerm) / 2);
      pv += cf / Math.pow(1 + wacc, yr);
    }
    const tv = (cf * (1 + gTerm)) / Math.max(0.03, wacc - gTerm);
    compounderPrice = round1(pv + tv / Math.pow(1 + wacc, 10));
    compounderNote = `10-year DCF discounting Rs ${fcfPerShare.toFixed(2)}/sh cash flow at ${(wacc * 100).toFixed(1)}% WACC.`;
  } else if (bvps !== null && bvps > 0 && roe !== null && roe > 0) {
    // Project 5-year book compounding with 65% retention and discount back
    const retention = 0.65;
    const compGrowth = clip((roe / 100) * retention, 0.02, 0.14);
    const futureBvps5 = bvps * Math.pow(1 + compGrowth, 5);
    const exitPb = clip((roe / 100) / keDec, 0.8, 2.8);
    const futurePrice5 = futureBvps5 * exitPb;
    const divStream = eps !== null && eps > 0 ? eps * (1 - retention) * 3.8 : 0;
    compounderPrice = round1((futurePrice5 + divStream) / Math.pow(1 + keDec, 5));
    compounderNote = `Models 5Y retained-book compounding at ${(compGrowth * 100).toFixed(1)}%/yr + interim dividend stream discounted at ${costOfEquityPct.toFixed(1)}%.`;
  }

  // 5. Dividend & Reserve Bonus-Capacity Yield Model
  let reserveYieldPrice: number | null = null;
  let reserveYieldNote = 'Estimates sustainable payout/bonus capacity from Reserves + EPS vs FD rate.';
  if (eps !== null && eps > 0) {
    const resRatio = forensics.capitalStructure.reserveToCapitalRatio ?? 0.35;
    const bonusBonusMult = clip(1 + (resRatio - 0.5) * 0.18, 0.85, 1.28);
    const targetYield = Math.max(0.055, (benchmarkFdRatePct + 1.5) / 100);
    const sustainableDistributableEps = eps * 0.58; // sustainable payout + bonus capacity
    reserveYieldPrice = round1((sustainableDistributableEps / targetYield) * bonusBonusMult);
    reserveYieldNote = `Prices sustainable distributable EPS (58% payout/bonus headroom) at ${(targetYield * 100).toFixed(1)}% yield, adjusted ${bonusBonusMult.toFixed(2)}x for ${resRatio.toFixed(2)}x Reserve/Capital cushion.`;
  }

  // 6. Sector Peer Relative Fair Value
  let peerPrice: number | null = null;
  let peerNote = 'Requires sector peer average P/E or P/B benchmark.';
  if (peerBenchmark && peerBenchmark.averages.peerCountWithFundamentals >= 2) {
    const peerParts: number[] = [];
    if (eps !== null && eps > 0 && peerBenchmark.averages.avgPe !== null && peerBenchmark.averages.avgPe > 0) {
      peerParts.push(eps * Math.min(28, peerBenchmark.averages.avgPe));
    }
    if (bvps !== null && bvps > 0 && peerBenchmark.averages.avgPb !== null && peerBenchmark.averages.avgPb > 0) {
      peerParts.push(bvps * Math.min(4.0, peerBenchmark.averages.avgPb));
    }
    if (peerParts.length > 0) {
      peerPrice = round1(peerParts.reduce((a, b) => a + b, 0) / peerParts.length);
      peerNote = `Benchmarks ${summary.symbol} against ${peerBenchmark.averages.peerCountWithFundamentals} ${peerBenchmark.averages.sector} peers (avg P/E ${peerBenchmark.averages.avgPe?.toFixed(1) ?? '—'}x, P/B ${peerBenchmark.averages.avgPb?.toFixed(2) ?? '—'}x).`;
    }
  }

  const isFinancial =
    summary.sectorGroup === 'Banking' ||
    summary.sectorGroup === 'Microfinance' ||
    summary.sectorGroup === 'Insurance';

  const models: ValuationModelEstimate[] = [
    {
      id: 'justified_pb',
      name: 'Justified P/B & Residual Income',
      category: 'Intrinsic',
      price: justifiedPbPrice,
      upsidePct: calcUpside(justifiedPbPrice),
      weightPct: isFinancial ? 30 : 15,
      formula: 'BVPS × (ROE − g) ÷ (ke − g)',
      inputsSummary: `BVPS ${bvps?.toFixed(1) ?? '—'} · ROE ${roe?.toFixed(1) ?? '—'}% · g ${gSustPct.toFixed(1)}% · ke ${costOfEquityPct.toFixed(1)}%`,
      note: justifiedPbNote,
      available: justifiedPbPrice !== null && justifiedPbPrice > 0,
    },
    {
      id: 'graham',
      name: 'Graham Number & Rate-Scaled Growth',
      category: 'Intrinsic',
      price: grahamPrice,
      upsidePct: calcUpside(grahamPrice),
      weightPct: 20,
      formula: 'Avg[√(22.5×EPS×BVPS), EPS×(8.5+1.5g)×RateScale]',
      inputsSummary: `EPS ${eps?.toFixed(2) ?? '—'} · BVPS ${bvps?.toFixed(1) ?? '—'} · FD ${benchmarkFdRatePct.toFixed(1)}%`,
      note: grahamNote,
      available: grahamPrice !== null && grahamPrice > 0,
    },
    {
      id: 'epv',
      name: 'Earnings Power Value (EPV)',
      category: 'Earnings Power',
      price: epvPrice,
      upsidePct: calcUpside(epvPrice),
      weightPct: 15,
      formula: 'Normalized Annual EPS ÷ (ke − 2.5%)',
      inputsSummary: `EPS ${eps?.toFixed(2) ?? '—'} · Cap Rate ${Math.max(7.5, costOfEquityPct - 2.5).toFixed(1)}%`,
      note: epvNote,
      available: epvPrice !== null && epvPrice > 0,
    },
    {
      id: 'compounder_dcf',
      name: cfg.usesIndustrialDebtAndEv ? '10Y Owner-Earnings DCF' : '5Y Retained-Book Compounder',
      category: 'Intrinsic',
      price: compounderPrice,
      upsidePct: calcUpside(compounderPrice),
      weightPct: isFinancial ? 15 : 30,
      formula: cfg.usesIndustrialDebtAndEv ? 'Σ FCFₜ/(1+WACC)ᵗ + Terminal' : 'PV(BVPS₅ × Exit P/B + Dividends)',
      inputsSummary: `Growth ${gSustPct.toFixed(1)}% · Hurdle ${costOfEquityPct.toFixed(1)}%`,
      note: compounderNote,
      available: compounderPrice !== null && compounderPrice > 0,
    },
    {
      id: 'reserve_yield',
      name: 'Reserve & Bonus-Dividend Capacity',
      category: 'Dividend & Capital',
      price: reserveYieldPrice,
      upsidePct: calcUpside(reserveYieldPrice),
      weightPct: 10,
      formula: '(0.58 × EPS ÷ Target Yield) × Reserve Cushion',
      inputsSummary: `Reserve/Cap ${forensics.capitalStructure.reserveToCapitalRatio?.toFixed(2) ?? '—'}x · FD+1.5% Yield`,
      note: reserveYieldNote,
      available: reserveYieldPrice !== null && reserveYieldPrice > 0,
    },
    {
      id: 'peer_relative',
      name: 'Sector Peer Multiple Re-Rating',
      category: 'Relative',
      price: peerPrice,
      upsidePct: calcUpside(peerPrice),
      weightPct: 10,
      formula: 'Avg[EPS × Peer Avg P/E, BVPS × Peer Avg P/B]',
      inputsSummary: `Peer Avg P/E ${peerBenchmark?.averages.avgPe?.toFixed(1) ?? '—'}x · P/B ${peerBenchmark?.averages.avgPb?.toFixed(2) ?? '—'}x`,
      note: peerNote,
      available: peerPrice !== null && peerPrice > 0,
    },
  ];

  return models;
}

function buildForensics(params: {
  detail: CompanyFundamentalDetailResponse;
  annualWeightPct: number;
  kbEntry: ReturnType<RegulatoryKnowledgeBase['getCompanyEntry']>;
}): AnnualReportForensics {
  const { detail, annualWeightPct, kbEntry } = params;
  const statements = detail.statements;
  const latestSt = statements[0];

  const annuals = statements.filter((r) => r.quarter === 'Annual' || r.quarter === 'Q4');
  const annualSt: QuarterlyStatementRecord | null = annuals.length
    ? annuals.find((r) => r.fiscalYear === annuals[0].fiscalYear && r.quarter === 'Annual') ??
      annuals[0]
    : null;
  const interimSt: QuarterlyStatementRecord | null =
    statements.find((r) => r.quarter === 'Q1' || r.quarter === 'Q2' || r.quarter === 'Q3') ?? null;

  const annualEps = annualSt?.metrics.eps.value ?? null;
  const interimEps = interimSt?.metrics.eps.value ?? null;
  const annualRoePct = annualSt?.metrics.roePct.value ?? null;
  const interimRoePct = interimSt?.metrics.roePct.value ?? null;
  const annualBvps = annualSt?.metrics.bvps.value ?? null;
  const interimBvps = interimSt?.metrics.bvps.value ?? null;
  const annualNetProfitCr = toCr(annualSt?.metrics.netProfit.value);
  const interimNetProfitCr = toCr(interimSt?.metrics.netProfit.value);

  let flag: AnnualReportForensics['annualVsInterimDivergence']['flag'] = 'Interim Only';
  let epsRunRateDiffPct: number | null = null;
  let roeDiffPp: number | null = null;
  let explanation =
    'Only interim quarterly reports are currently indexed; full-year audited Annual/Q4 data will sharpen baseline confidence.';

  if (annualSt && interimSt) {
    if (annualEps !== null && interimEps !== null && Math.abs(annualEps) > 0.5) {
      epsRunRateDiffPct = round1(((interimEps - annualEps) / Math.abs(annualEps)) * 100);
    }
    if (annualRoePct !== null && interimRoePct !== null) {
      roeDiffPp = round2(interimRoePct - annualRoePct);
    }
    if (epsRunRateDiffPct !== null && epsRunRateDiffPct >= 18) {
      flag = 'Interim Elevated';
      explanation = `Latest interim annualized EPS (${interimEps?.toFixed(2)}) runs +${epsRunRateDiffPct.toFixed(1)}% above full-year ${annualSt.periodLabel} (${annualEps?.toFixed(2)}); 70% Annual weighting prevents extrapolating seasonal or one-off spikes.`;
    } else if (epsRunRateDiffPct !== null && epsRunRateDiffPct <= -18) {
      flag = 'Interim Soft';
      explanation = `Latest interim annualized EPS (${interimEps?.toFixed(2)}) is ${epsRunRateDiffPct.toFixed(1)}% below full-year ${annualSt.periodLabel} (${annualEps?.toFixed(2)}); inspect whether seasonal provisioning or cost timing depressed the quarter.`;
    } else {
      flag = 'Normal';
      explanation = `Interim quarter ${interimSt.periodLabel} aligns closely with full-year ${annualSt.periodLabel}, reinforcing earnings reliability under 70%/30% weighting.`;
    }
  } else if (annualSt && !interimSt) {
    flag = 'Annual Only';
    explanation = `Full-year ${annualSt.periodLabel} statement is available without a newer interim quarter; 100% anchored to full-year reported figures.`;
  }

  const refSt = annualRatioRef(annualWeightPct, annualSt, interimSt, latestSt);
  const shareCapitalCr = toCr(refSt?.metrics.shareCapital.value);
  const reservesCr = toCr(refSt?.metrics.reserves.value);
  const retainedEarningsCr = toCr(refSt?.metrics.retainedEarnings.value);
  const netWorthCr = toCr(refSt?.metrics.netWorth.value);
  const totalAssetsCr = toCr(refSt?.metrics.totalAssets.value);
  const totalDebtCr = toCr(refSt?.metrics.totalDebt.value);
  const cashCr = toCr(refSt?.metrics.cashAndEquivalents.value);
  const operatingCashFlowCr = toCr(refSt?.metrics.operatingCashFlow.value);
  const npCr = toCr(refSt?.metrics.netProfit.value);

  const reserveToCapitalRatio =
    shareCapitalCr !== null && shareCapitalCr > 0 && reservesCr !== null
      ? round2((reservesCr + Math.max(0, retainedEarningsCr ?? 0)) / shareCapitalCr)
      : null;

  const dividendBonusCapacityRating: AnnualReportForensics['capitalStructure']['dividendBonusCapacityRating'] =
    reserveToCapitalRatio === null
      ? 'Unavailable'
      : reserveToCapitalRatio >= 1.0
        ? 'High Bonus/Dividend Cushion'
        : reserveToCapitalRatio >= 0.45
          ? 'Moderate Cushion'
          : 'Tight Reserves';

  const netProfitToOcfPct =
    operatingCashFlowCr !== null && npCr !== null && npCr > 0
      ? round1((operatingCashFlowCr / npCr) * 100)
      : null;

  const creditRatingLabel = kbEntry?.creditRating.ratingGrade
    ? `${kbEntry.creditRating.ratingGrade}${kbEntry.creditRating.outlook !== 'Not Rated' ? ` (${kbEntry.creditRating.outlook})` : ''}`
    : null;

  return {
    annualWeightPct,
    interimWeightPct: 100 - annualWeightPct,
    hasAnnualReport: Boolean(annualSt),
    annualPeriodLabel: annualSt?.periodLabel ?? null,
    interimPeriodLabel: interimSt?.periodLabel ?? null,
    annualEps,
    interimEps,
    annualRoePct,
    interimRoePct,
    annualBvps,
    interimBvps,
    annualNetProfitCr,
    interimNetProfitCr,
    annualVsInterimDivergence: {
      epsRunRateDiffPct,
      roeDiffPp,
      flag,
      explanation,
    },
    capitalStructure: {
      shareCapitalCr,
      reservesCr,
      retainedEarningsCr,
      netWorthCr,
      totalAssetsCr,
      totalDebtCr,
      cashCr,
      reserveToCapitalRatio,
      dividendBonusCapacityRating,
      operatingCashFlowCr,
      netProfitToOcfPct,
      creditRatingLabel,
      regulatoryStanding: kbEntry?.regulatoryStanding ?? 'Unknown',
    },
    historicalPeriods: [...statements]
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, 12)
      .map((s) => ({
        periodLabel: s.periodLabel,
        fiscalYear: s.fiscalYear,
        quarter: s.quarter,
        isAnnual: s.quarter === 'Annual' || s.quarter === 'Q4',
        eps: s.metrics.eps.value,
        roePct: s.metrics.roePct.value,
        bvps: s.metrics.bvps.value,
        netProfitCr: toCr(s.metrics.netProfit.value),
        revenueCr: toCr(s.metrics.revenue.value),
        nplPct: s.metrics.nplPct.value,
        debtToEquity: s.metrics.debtToEquity.value,
      })),
  };
}

function annualRatioRef(
  annualWeightPct: number,
  annualSt: QuarterlyStatementRecord | null,
  interimSt: QuarterlyStatementRecord | null,
  fallback: QuarterlyStatementRecord | undefined
): QuarterlyStatementRecord | undefined {
  if (annualSt && interimSt) {
    return annualWeightPct >= 50 ? annualSt : interimSt;
  }
  return annualSt ?? interimSt ?? fallback;
}

function buildSensitivityGrid(params: {
  summary: ScreenedCompanyRow;
  benchmarkFdRatePct: number;
}): {
  keValues: number[];
  growthValues: number[];
  cells: ValuationSensitivityCell[][];
} {
  const { summary, benchmarkFdRatePct } = params;
  const cfg = getSectorThresholds(summary.sectorGroup);
  const km = summary.keyMetrics;
  const ltp = summary.market.ltp;
  const eps = km.eps;
  const bvps = km.bvps;
  const roe = km.roePct;

  const keValues = [9.5, 11.0, 12.5, 14.0, 15.5];
  const growthValues = [3, 5, 7, 9, 11];
  const isFinancial =
    summary.sectorGroup === 'Banking' ||
    summary.sectorGroup === 'Microfinance' ||
    summary.sectorGroup === 'Insurance';

  const cells: ValuationSensitivityCell[][] = keValues.map((kePct) =>
    growthValues.map((growthPct) => {
      const keDec = kePct / 100;
      const gDec = Math.min(keDec - 0.02, growthPct / 100);
      const parts: number[] = [];

      if (bvps !== null && bvps > 0 && roe !== null && roe > 0) {
        const roeDec = roe / 100;
        const jPb = clip((roeDec - gDec) / Math.max(0.025, keDec - gDec), 0.45, 4.5);
        parts.push(bvps * jPb);
      }
      if (eps !== null && eps > 0) {
        const rateScale = clip(5.5 / Math.max(4.0, benchmarkFdRatePct), 0.55, 1.05);
        const grahamGrowth = eps * (8.5 + 1.5 * growthPct) * rateScale * (12.0 / kePct);
        parts.push(grahamGrowth);
        if (!isFinancial) {
          const epv = eps / Math.max(0.05, keDec - gDec * 0.45);
          parts.push(epv);
        }
      }

      const fairValue =
        parts.length > 0 ? round1(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
      const mosPct =
        fairValue !== null && fairValue > 0 && ltp !== null && ltp > 0
          ? round1(((fairValue - ltp) / fairValue) * 100)
          : null;

      return { kePct, growthPct, fairValue, mosPct };
    })
  );

  return { keValues, growthValues, cells };
}

function buildFutureScenarios(params: {
  summary: ScreenedCompanyRow;
  compositeFairValue: number | null;
}): FutureWorthScenario[] {
  const { summary, compositeFairValue } = params;
  const km = summary.keyMetrics;
  const cfg = getSectorThresholds(summary.sectorGroup);
  const ltp = summary.market.ltp;

  const eps = km.eps;
  const bvps = km.bvps;
  const roe = km.roePct ?? cfg.minRoePct;
  const opGrowth =
    km.operatingProfitCagr3yPct ??
    km.operatingProfitYoyPct ??
    km.operatingProfitVsQ4Avg3yPct;
  const useOpFocus = Boolean(km.earningsQuality?.hasNonOperatingCaution) && opGrowth !== null;
  const baseGrowth = clip(
    (useOpFocus ? opGrowth : null) ??
      km.epsCagr3yPct ??
      km.epsYoyPct ??
      (roe > 0 ? roe * 0.48 : 7),
    3,
    cfg.sustainableGrowthCapPct
  );
  const anchorFair = compositeFairValue ?? (eps !== null && eps > 0 ? eps * 15 : bvps ? bvps * 1.5 : ltp);

  const horizons: Array<{ h: '1Y' | '3Y' | '5Y'; yrs: number }> = [
    { h: '1Y', yrs: 1 },
    { h: '3Y', yrs: 3 },
    { h: '5Y', yrs: 5 },
  ];

  return horizons.map(({ h, yrs }) => {
    if (anchorFair === null || anchorFair <= 0) {
      return {
        horizon: h,
        bearPrice: null,
        basePrice: null,
        bullPrice: null,
        bearCagrPct: null,
        baseCagrPct: null,
        bullCagrPct: null,
        assumptions: 'Insufficient positive earnings or book value anchor to project forward worth.',
      };
    }

    const gBear = Math.max(0.01, (baseGrowth * 0.45) / 100);
    const gBase = baseGrowth / 100;
    const gBull = Math.min(0.22, (baseGrowth * 1.35 + 2) / 100);

    // Price gradually converges from current LTP toward compounding fair value + multiple shift
    const conv = yrs === 1 ? 0.65 : yrs === 3 ? 0.9 : 1.0;
    const curOrFair = ltp && ltp > 0 ? ltp : anchorFair;

    const targetBear = anchorFair * 0.82 * Math.pow(1 + gBear, yrs);
    const targetBase = anchorFair * 1.0 * Math.pow(1 + gBase, yrs);
    const targetBull = anchorFair * 1.2 * Math.pow(1 + gBull, yrs);

    const bearPrice = round1(curOrFair * (1 - conv) + targetBear * conv);
    const basePrice = round1(curOrFair * (1 - conv) + targetBase * conv);
    const bullPrice = round1(curOrFair * (1 - conv) + targetBull * conv);

    const calcCagr = (target: number): number | null => {
      if (!ltp || ltp <= 0 || target <= 0) return null;
      return round1((Math.pow(target / ltp, 1 / yrs) - 1) * 100);
    };

    const basisLabel = useOpFocus ? 'Core Operating Profit growth' : 'EPS/BV growth';

    return {
      horizon: h,
      bearPrice,
      basePrice,
      bullPrice,
      bearCagrPct: calcCagr(bearPrice),
      baseCagrPct: calcCagr(basePrice),
      bullCagrPct: calcCagr(bullPrice),
      assumptions: `Bear: ${(gBear * 100).toFixed(1)}% ${basisLabel} & 0.82x fair-multiple · Base: ${(gBase * 100).toFixed(1)}% growth & 1.0x fair · Bull: ${(gBull * 100).toFixed(1)}% growth & 1.20x re-rating.`,
    };
  });
}

function buildSwotAndFutureWorth(params: {
  summary: ScreenedCompanyRow;
  compositeFairValue: number | null;
  fairValueLow: number | null;
  fairValueHigh: number | null;
  marginOfSafetyPct: number | null;
  entryZones: CompanyValuationDossierResponse['entryZones'];
  forensics: AnnualReportForensics;
  kbEntry: ReturnType<RegulatoryKnowledgeBase['getCompanyEntry']>;
  benchmarkFdRatePct: number;
}): SwotAndFutureWorth {
  const {
    summary,
    compositeFairValue,
    fairValueLow,
    fairValueHigh,
    marginOfSafetyPct,
    entryZones,
    forensics,
    kbEntry,
    benchmarkFdRatePct,
  } = params;

  const km = summary.keyMetrics;
  const cfg = getSectorThresholds(summary.sectorGroup);
  const cap = forensics.capitalStructure;
  const eySpread =
    km.earningsYieldPct !== null ? round2(km.earningsYieldPct - benchmarkFdRatePct) : null;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];
  const risks: string[] = [];

  // Strengths
  if ((km.roePct ?? 0) >= cfg.strongRoePct) {
    strengths.push(
      `High capital efficiency: ${km.roePct?.toFixed(1)}% ROE exceeds ${cfg.label} strong-moat threshold (${cfg.strongRoePct}%).`
    );
  } else if ((km.roePct ?? 0) >= cfg.minRoePct) {
    strengths.push(
      `Healthy profitability: ${km.roePct?.toFixed(1)}% ROE comfortably beats sector minimum (${cfg.minRoePct}%).`
    );
  }
  if (cap.reserveToCapitalRatio !== null && cap.reserveToCapitalRatio >= 0.85) {
    strengths.push(
      `Strong Reserve & Bonus Cushion (${cap.reserveToCapitalRatio.toFixed(2)}x paid-up capital; Rs ${cap.reservesCr?.toFixed(1) ?? '—'} Cr reserves) supporting future bonus shares and cash dividends.`
    );
  }
  if (forensics.hasAnnualReport) {
    strengths.push(
      `Full-year report verified (${forensics.annualPeriodLabel}), anchoring 70% of valuation and quality weights.`
    );
  }
  if ((km.epsYoyPct ?? 0) >= 10 || (km.epsCagr3yPct ?? 0) >= 10) {
    strengths.push(
      `Compounding earnings momentum (EPS YoY ${km.epsYoyPct !== null ? `${km.epsYoyPct.toFixed(1)}%` : '—'}, 3Y CAGR ${km.epsCagr3yPct !== null ? `${km.epsCagr3yPct.toFixed(1)}%` : '—'}).`
    );
  }
  if (cap.creditRatingLabel) {
    strengths.push(`External agency credit rating: ${cap.creditRatingLabel}.`);
  }
  if (km.nplPct !== null && cfg.maxNplPct !== null && km.nplPct <= 2.5) {
    strengths.push(`Clean loan-book asset quality with NPL at ${km.nplPct.toFixed(2)}% (sector ceiling ${cfg.maxNplPct}%).`);
  }
  if (strengths.length === 0) {
    strengths.push(
      `Active NEPSE listing with ${summary.passedInvestorCount}/9 legendary investor frameworks passing baseline checks.`
    );
  }

  // Weaknesses
  if (km.earningsQuality?.hasNonOperatingCaution && km.earningsQuality.cautionMessage) {
    weaknesses.push(km.earningsQuality.cautionMessage);
  }
  if ((km.roePct ?? 99) < cfg.minRoePct) {
    weaknesses.push(
      `Sub-hurdle ROE (${km.roePct !== null ? `${km.roePct.toFixed(1)}%` : 'Unavailable'}) below ${cfg.minRoePct}% ${cfg.label} threshold.`
    );
  }
  if (!forensics.hasAnnualReport) {
    weaknesses.push(
      `No full-year Q4/Annual statement indexed yet; valuation currently relies on interim quarterly run-rate (${forensics.interimPeriodLabel ?? 'Latest Qtr'}).`
    );
  }
  if (cap.reserveToCapitalRatio !== null && cap.reserveToCapitalRatio < 0.4) {
    weaknesses.push(
      `Thin Reserve-to-Capital ratio (${cap.reserveToCapitalRatio.toFixed(2)}x), limiting buffer for sustained bonus/cash payouts.`
    );
  }
  if (cap.operatingCashFlowCr === null) {
    weaknesses.push('Operating Cash Flow not itemized in financial summary; audit full AGM annual report cash statement before heavy sizing.');
  } else if (cap.netProfitToOcfPct !== null && cap.netProfitToOcfPct < 75) {
    weaknesses.push(`Cash conversion lag: OCF is only ${cap.netProfitToOcfPct.toFixed(0)}% of net profit.`);
  }
  if (forensics.annualVsInterimDivergence.flag === 'Interim Soft') {
    weaknesses.push(forensics.annualVsInterimDivergence.explanation);
  }
  if (weaknesses.length === 0) {
    weaknesses.push('No major structural balance-sheet weaknesses detected in reported ledger ratios.');
  }

  // Opportunities
  if (marginOfSafetyPct !== null && marginOfSafetyPct >= 10) {
    opportunities.push(
      `Valuation upside opportunity: LTP trades at a +${marginOfSafetyPct.toFixed(1)}% Margin of Safety below Rs ${compositeFairValue?.toFixed(0)} composite fair value.`
    );
  } else if (entryZones.buyZonePrice !== null) {
    opportunities.push(
      `Wait-for-dip pricing opportunity: target accumulation zone begins at ≤ Rs ${entryZones.buyZonePrice.toFixed(0)} (15% Margin of Safety).`
    );
  }
  if (eySpread !== null && eySpread >= 1.5) {
    opportunities.push(
      `Beats Nepal Bank FD (${benchmarkFdRatePct.toFixed(1)}%) by +${eySpread.toFixed(2)}% in earnings yield (${km.earningsYieldPct?.toFixed(2)}%), offering real fixed-income outperformance.`
    );
  }
  if ((summary.market.gap52hPct ?? 0) <= -15 && summary.scores.fundamentalQualityScore >= 55) {
    opportunities.push(
      `Pullback dislocation: price sits ${Math.abs(summary.market.gap52hPct ?? 0).toFixed(1)}% below its 52-week high despite healthy fundamental quality (${summary.scores.fundamentalQualityScore.toFixed(0)}/100).`
    );
  }
  if (kbEntry && kbEntry.tailwinds.length > 0) {
    opportunities.push(...kbEntry.tailwinds.slice(0, 2));
  }
  if (opportunities.length === 0) {
    opportunities.push(
      `Monitor upcoming Annual/Q4 filing and SEBON/NEPSE corporate actions for earnings-led re-rating catalysts.`
    );
  }

  // Risks
  if (km.earningsQuality?.hasNonOperatingCaution) {
    risks.push(
      `Earnings Quality Caution: headline Net Profit growth relies heavily on non-operating / disposal gains — rely on core Operating Profit growth (${km.earningsQuality.operatingGrowthBestPct !== null ? `${km.earningsQuality.operatingGrowthBestPct >= 0 ? '+' : ''}${km.earningsQuality.operatingGrowthBestPct.toFixed(1)}%` : 'N/A'}) instead.`
    );
  }
  if (marginOfSafetyPct !== null && marginOfSafetyPct < -15) {
    risks.push(
      `Valuation stretch risk: LTP trades ${Math.abs(marginOfSafetyPct).toFixed(1)}% above composite fair value (Rs ${compositeFairValue?.toFixed(0)}), compressing forward IRR.`
    );
  }
  if (km.nplPct !== null && cfg.maxNplPct !== null && km.nplPct > cfg.maxNplPct) {
    risks.push(`Credit deterioration risk: NPL (${km.nplPct.toFixed(2)}%) exceeds ${cfg.maxNplPct}% sector threshold.`);
  }
  if (km.debtToEquity !== null && cfg.maxDebtToEquity !== null && km.debtToEquity > cfg.maxDebtToEquity) {
    risks.push(`Leverage pressure: Debt/Equity (${km.debtToEquity.toFixed(2)}x) sits above ${cfg.maxDebtToEquity}x sector norm.`);
  }
  if (kbEntry?.lockInOverhangFlag) {
    risks.push(`Supply overhang alert: CDSC/SEBON lock-in expiry flag detected (${kbEntry.cdscStatus ?? 'verify unlock calendar'}).`);
  }
  if (kbEntry && kbEntry.riskFlags.length > 0) {
    risks.push(...kbEntry.riskFlags.slice(0, 2));
  }
  if (eySpread !== null && eySpread < -1.0) {
    risks.push(`Opportunity cost drag: earnings yield trails Nepal Bank FD (${benchmarkFdRatePct.toFixed(1)}%) by ${Math.abs(eySpread).toFixed(2)}%.`);
  }
  if (risks.length === 0) {
    risks.push('Standard NEPSE macro liquidity, NRB policy rate shifts, and quarterly earnings execution risk.');
  }

  // Considerable Investment Score (0-100)
  let convScore = summary.scores.overallScore * 0.45 + summary.scores.fundamentalQualityScore * 0.25;
  if (marginOfSafetyPct !== null) {
    convScore += clip((marginOfSafetyPct + 20) * 0.45, 0, 22);
  } else {
    convScore += 8;
  }
  if (forensics.hasAnnualReport) convScore += 5;
  if (cap.reserveToCapitalRatio !== null && cap.reserveToCapitalRatio >= 0.8) convScore += 4;
  if (eySpread !== null && eySpread > 1.5) convScore += 4;
  if (kbEntry?.regulatoryStanding === 'Alert' || kbEntry?.lockInOverhangFlag) convScore -= 10;
  if (km.earningsQuality?.hasNonOperatingCaution) convScore -= 6;
  convScore = round1(clip(convScore, 0, 100));

  let convictionTier: SwotAndFutureWorth['futureWorthVerdict']['convictionTier'] =
    'Hold / Wait for Entry Zone';
  let headline = 'Moderate quality; wait for better entry margin of safety';

  if (
    convScore >= 68 &&
    (marginOfSafetyPct === null || marginOfSafetyPct >= 5) &&
    kbEntry?.regulatoryStanding !== 'Alert'
  ) {
    convictionTier = 'Core Long-Term Allocation';
    headline = 'Worth a considerable long-term core position backed by valuation cushion & compounding quality';
  } else if (convScore >= 58 && (marginOfSafetyPct ?? -99) >= 12) {
    convictionTier = 'Opportunistic Value Allocation';
    headline = 'Attractive mispricing vs intrinsic worth; suitable for staggered accumulation';
  } else if (
    convScore < 42 ||
    summary.recommendation.verdict === 'AVOID' ||
    kbEntry?.regulatoryStanding === 'Alert'
  ) {
    convictionTier = 'Avoid / Capital Preservation';
    headline = 'Unfavorable risk-reward or regulatory/asset-quality overhang — protect capital';
  }

  const fairValueRangeLabel =
    fairValueLow !== null && fairValueHigh !== null
      ? `Rs ${fairValueLow.toFixed(0)} – Rs ${fairValueHigh.toFixed(0)}`
      : 'Unavailable';
  const idealEntryZoneLabel =
    entryZones.deepValuePrice !== null && entryZones.buyZonePrice !== null
      ? `Rs ${entryZones.deepValuePrice.toFixed(0)} – Rs ${entryZones.buyZonePrice.toFixed(0)}`
      : 'Awaiting fundamental inputs';

  const cautionSuffix = km.earningsQuality?.hasNonOperatingCaution
    ? ' Caution: non-operating profit boost detected, so growth projections focus on core Operating Profit.'
    : '';
  const rationale = `${summary.symbol} scores ${convScore.toFixed(1)}/100 for long-term capital commitment (${forensics.hasAnnualReport ? `${forensics.annualWeightPct}% Annual + ${forensics.interimWeightPct}% Interim weighted` : 'interim-quarter basis'}). Fair value clusters around ${fairValueRangeLabel}${marginOfSafetyPct !== null ? ` (${marginOfSafetyPct >= 0 ? `+${marginOfSafetyPct.toFixed(1)}% discount` : `${Math.abs(marginOfSafetyPct).toFixed(1)}% premium`} vs LTP)` : ''}, with ${cap.dividendBonusCapacityRating.toLowerCase()} for multi-year total return.${cautionSuffix}`;

  return {
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5),
    opportunities: opportunities.slice(0, 5),
    risks: risks.slice(0, 5),
    futureWorthVerdict: {
      convictionTier,
      considerableInvestmentScore: convScore,
      headline,
      rationale,
      fairValueRangeLabel,
      idealEntryZoneLabel,
      opportunityCostVsFdSpreadPct: eySpread,
    },
  };
}

function healthStatusFromScore(score: number | null): HealthSignalStatus {
  if (score === null || !Number.isFinite(score)) return 'Unavailable';
  if (score >= 75) return 'Strong';
  if (score >= 58) return 'Solid';
  if (score >= 42) return 'Watch';
  return 'Fragile';
}

function pillarStatusFromScore(score: number): Exclude<HealthSignalStatus, 'Unavailable'> {
  if (score >= 75) return 'Strong';
  if (score >= 58) return 'Solid';
  if (score >= 42) return 'Watch';
  return 'Fragile';
}

function scoreHigherBetter(
  val: number | null | undefined,
  lowBad: number,
  midOk: number,
  highGood: number
): number | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  if (val >= highGood) {
    const extra = Math.min(10, ((val - highGood) / Math.max(1, Math.abs(highGood - midOk))) * 5);
    return round1(clip(85 + extra, 0, 100));
  }
  if (val >= midOk) {
    const ratio = (val - midOk) / Math.max(0.0001, highGood - midOk);
    return round1(60 + ratio * 25);
  }
  if (val >= lowBad) {
    const ratio = (val - lowBad) / Math.max(0.0001, midOk - lowBad);
    return round1(30 + ratio * 30);
  }
  const drop = Math.min(25, ((lowBad - val) / Math.max(1, Math.abs(midOk - lowBad))) * 20);
  return round1(clip(30 - drop, 5, 30));
}

function scoreLowerBetter(
  val: number | null | undefined,
  bestGood: number,
  midOk: number,
  highBad: number
): number | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  if (val <= bestGood) {
    const extra = Math.min(10, ((bestGood - val) / Math.max(0.5, Math.abs(midOk - bestGood))) * 5);
    return round1(clip(85 + extra, 0, 100));
  }
  if (val <= midOk) {
    const ratio = (midOk - val) / Math.max(0.0001, midOk - bestGood);
    return round1(60 + ratio * 25);
  }
  if (val <= highBad) {
    const ratio = (highBad - val) / Math.max(0.0001, highBad - midOk);
    return round1(30 + ratio * 30);
  }
  const drop = Math.min(25, ((val - highBad) / Math.max(1, Math.abs(highBad - midOk))) * 20);
  return round1(clip(30 - drop, 5, 30));
}

function computeWeightedScore(
  items: Array<{ score: number | null; weight: number }>,
  fallbackScore = 50
): number {
  const valid = items.filter(
    (it): it is { score: number; weight: number } =>
      it.score !== null && Number.isFinite(it.score) && it.weight > 0
  );
  if (valid.length === 0) return fallbackScore;
  const totalW = valid.reduce((s, it) => s + it.weight, 0);
  const sum = valid.reduce((s, it) => s + it.score * it.weight, 0);
  return round1(clip(sum / Math.max(1, totalW), 0, 100));
}

function findAnnualAndInterimLedgers(detail: CompanyFundamentalDetailResponse): {
  annualSt: QuarterlyStatementRecord | null;
  interimSt: QuarterlyStatementRecord | null;
} {
  const annuals = detail.statements.filter((r) => r.quarter === 'Annual' || r.quarter === 'Q4');
  const annualSt: QuarterlyStatementRecord | null = annuals.length
    ? annuals.find((r) => r.fiscalYear === annuals[0].fiscalYear && r.quarter === 'Annual') ??
      annuals[0]
    : null;
  const interimSt: QuarterlyStatementRecord | null =
    detail.statements.find((r) => r.quarter === 'Q1' || r.quarter === 'Q2' || r.quarter === 'Q3') ??
    null;
  return { annualSt, interimSt };
}

function computeValuationHealthScore(params: {
  detail: CompanyFundamentalDetailResponse;
  forensics: AnnualReportForensics;
  marginOfSafetyPct: number | null;
  kbEntry: ReturnType<RegulatoryKnowledgeBase['getCompanyEntry']>;
  benchmarkFdRatePct: number;
  industryAverages?: IndustryAverageMetrics | null;
}): ValuationHealthScore {
  const { detail, forensics, marginOfSafetyPct, kbEntry, benchmarkFdRatePct, industryAverages } =
    params;
  const summary = detail.summary;
  const km = summary.keyMetrics;
  const cfg = getSectorThresholds(summary.sectorGroup);
  const cap = forensics.capitalStructure;
  const { annualSt } = findAnnualAndInterimLedgers(detail);

  const annualSourceTag = forensics.hasAnnualReport
    ? `${forensics.annualWeightPct}% Annual (${forensics.annualPeriodLabel})`
    : `Interim (${forensics.interimPeriodLabel ?? summary.latestPeriod.periodLabel})`;

  const isFinancialBfi =
    summary.sectorGroup === 'Banking' || summary.sectorGroup === 'Microfinance';
  const isInsurance = summary.sectorGroup === 'Insurance';

  const opGrowthVal =
    km.operatingProfitCagr3yPct ?? km.operatingProfitYoyPct ?? km.operatingProfitVsQ4Avg3yPct;
  const epsGrowthVal =
    km.earningsQuality?.hasNonOperatingCaution && opGrowthVal !== null
      ? opGrowthVal
      : km.epsCagr3yPct ?? km.epsYoyPct ?? km.epsVsQ4Avg3yPct;
  const revGrowthVal = km.revenueCagr3yPct ?? km.revenueYoyPct;
  const profitGrowthVal =
    opGrowthVal ?? km.netProfitCagr3yPct ?? km.netProfitYoyPct;
  const eySpread =
    km.earningsYieldPct !== null ? round2(km.earningsYieldPct - benchmarkFdRatePct) : null;

  // 1. Safety Metrics (Reserve cushion, Asset Quality/Leverage, CAR/Solvency, Annual Stability)
  const reserveScore = scoreHigherBetter(cap.reserveToCapitalRatio, 0.25, 0.55, 1.1);
  const annualReserveRatio =
    annualSt &&
    annualSt.metrics.shareCapital.value &&
    annualSt.metrics.shareCapital.value > 0 &&
    annualSt.metrics.reserves.value !== null
      ? round2(
          (annualSt.metrics.reserves.value +
            Math.max(0, annualSt.metrics.retainedEarnings.value ?? 0)) /
            annualSt.metrics.shareCapital.value
        )
      : null;

  const assetQualityVal = isFinancialBfi
    ? km.nplPct
    : isInsurance
      ? detail.statements[0]?.metrics.solvencyRatio.value ?? null
      : km.debtToEquity;
  const annualAssetQualityVal = isFinancialBfi
    ? annualSt?.metrics.nplPct.value ?? null
    : isInsurance
      ? annualSt?.metrics.solvencyRatio.value ?? null
      : annualSt?.metrics.debtToEquity.value ?? null;

  const assetQualityScore = isFinancialBfi
    ? scoreLowerBetter(km.nplPct, 1.2, 2.8, cfg.maxNplPct ?? 4.8)
    : isInsurance
      ? scoreHigherBetter(assetQualityVal, 1.0, 1.5, 2.2)
      : scoreLowerBetter(km.debtToEquity, 0.4, 1.0, cfg.maxDebtToEquity ?? 2.0);

  const carVal = km.carPct;
  const carOrRatingScore = (() => {
    let base: number | null = null;
    if (isFinancialBfi && carVal !== null) {
      base = scoreHigherBetter(carVal, 9.5, 11.5, 14.0);
    } else if (kbEntry?.creditRating.ratingGrade) {
      const g = kbEntry.creditRating.ratingGrade.toUpperCase();
      if (g.includes('AAA') || g.includes('AA') || g.includes('A+') || g.includes('A ')) base = 88;
      else if (g.includes('A-') || g.includes('BBB')) base = 70;
      else if (g.includes('BB')) base = 48;
      else base = 35;
    } else if (kbEntry) {
      base =
        kbEntry.regulatoryStanding === 'Positive' || kbEntry.regulatoryStanding === 'Clean'
          ? 74
          : kbEntry.regulatoryStanding === 'Watch'
            ? 45
            : kbEntry.regulatoryStanding === 'Alert'
              ? 20
              : 55;
    }
    if (kbEntry?.lockInOverhangFlag && base !== null) {
      base = Math.max(15, base - 15);
    }
    return base;
  })();

  const ocfScore = scoreHigherBetter(cap.netProfitToOcfPct, 40, 80, 115);

  // 2. Earnings Quality & Annual Verification
  const roeScore = scoreHigherBetter(km.roePct, cfg.minRoePct * 0.65, cfg.minRoePct, cfg.strongRoePct);
  const netMarginScore = scoreHigherBetter(
    km.netMarginPct,
    cfg.minNetMarginPct * 0.5,
    cfg.minNetMarginPct,
    cfg.minNetMarginPct * 1.85
  );
  const annualStabilityScore = (() => {
    if (!forensics.hasAnnualReport) return 45;
    if (forensics.annualVsInterimDivergence.flag === 'Normal') return 88;
    if (forensics.annualVsInterimDivergence.flag === 'Annual Only') return 84;
    if (forensics.annualVsInterimDivergence.flag === 'Interim Elevated') return 66;
    return 54;
  })();

  // 3. Growth Potential & Reinvestment
  const epsGrowthScore = scoreHigherBetter(epsGrowthVal, -8, 6, 18);
  const revGrowthScore = scoreHigherBetter(revGrowthVal, -5, 7, 18);
  const profitGrowthScore = scoreHigherBetter(profitGrowthVal, -10, 6, 18);
  const reinvestmentRate =
    km.roePct !== null && km.roePct > 0
      ? round1(km.roePct * (cap.reserveToCapitalRatio && cap.reserveToCapitalRatio >= 0.8 ? 0.65 : 0.55))
      : null;
  const reinvestmentScore = scoreHigherBetter(reinvestmentRate, 3.5, 7.5, 13.0);

  // 4. Valuation Cushion & Yield Spread
  const mosScore = scoreHigherBetter(marginOfSafetyPct, -20, 5, 25);
  const fdSpreadScore = scoreHigherBetter(eySpread, -2.0, 1.0, 4.5);
  const peerMultipleDiscountPct = (() => {
    const diffs: number[] = [];
    if (km.pe && km.pe > 0 && industryAverages?.pe && industryAverages.pe > 0) {
      diffs.push(((industryAverages.pe - km.pe) / industryAverages.pe) * 100);
    }
    if (km.pb && km.pb > 0 && industryAverages?.pb && industryAverages.pb > 0) {
      diffs.push(((industryAverages.pb - km.pb) / industryAverages.pb) * 100);
    }
    return diffs.length > 0 ? round1(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null;
  })();
  const peerMultipleScore = scoreHigherBetter(peerMultipleDiscountPct, -25, 0, 25);

  const safetyPillarScore = computeWeightedScore([
    { score: reserveScore, weight: 32 },
    { score: assetQualityScore, weight: 38 },
    { score: carOrRatingScore, weight: 18 },
    { score: ocfScore, weight: 12 },
  ]);

  const qualityPillarScore = computeWeightedScore([
    { score: roeScore, weight: 45 },
    { score: netMarginScore, weight: 30 },
    { score: annualStabilityScore, weight: 25 },
  ]);

  const growthPillarScore = computeWeightedScore([
    { score: epsGrowthScore, weight: 38 },
    { score: revGrowthScore, weight: 24 },
    { score: profitGrowthScore, weight: 20 },
    { score: reinvestmentScore, weight: 18 },
  ]);

  const valuationPillarScore = computeWeightedScore([
    { score: mosScore, weight: 52 },
    { score: fdSpreadScore, weight: 30 },
    { score: peerMultipleScore, weight: 18 },
  ]);

  // Consolidated Safety (combines balance-sheet safety + earnings quality) & Growth & Valuation
  const safetyScore = round1(safetyPillarScore * 0.65 + qualityPillarScore * 0.35);
  const growthScore = growthPillarScore;
  const valuationCushionScore = valuationPillarScore;

  const overallScore = round1(
    safetyPillarScore * 0.3 +
      qualityPillarScore * 0.2 +
      growthPillarScore * 0.25 +
      valuationPillarScore * 0.25
  );

  const band: ValuationHealthScore['band'] =
    overallScore >= 75
      ? 'Fortress Value'
      : overallScore >= 60
        ? 'Healthy Compounder'
        : overallScore >= 45
          ? 'Balanced / Watch'
          : 'Elevated Risk';

  const metricsBreakdown: ValuationHealthMetricContribution[] = [
    {
      key: 'reserveToCapitalRatio',
      label: 'Reserve / Paid-Up Capital Cushion',
      pillar: 'safety',
      unit: 'x',
      companyValue: cap.reserveToCapitalRatio,
      annualReportValue: annualReserveRatio,
      industryAverage: industryAverages?.reserveToCapitalRatio ?? null,
      weightPct: 12,
      score: reserveScore,
      status: healthStatusFromScore(reserveScore),
      higherIsBetter: true,
      sourceBasis: annualSourceTag,
      note: 'Measures accumulated reserves & retained earnings backing each Rs 100 of paid-up equity.',
    },
    {
      key: isFinancialBfi ? 'nplPct' : isInsurance ? 'solvencyRatio' : 'debtToEquity',
      label: isFinancialBfi
        ? 'Non-Performing Loans (NPL %)'
        : isInsurance
          ? 'Insurance Solvency Ratio'
          : 'Debt-to-Equity Leverage',
      pillar: 'safety',
      unit: isFinancialBfi ? '%' : 'x',
      companyValue: assetQualityVal,
      annualReportValue: annualAssetQualityVal,
      industryAverage: isFinancialBfi
        ? industryAverages?.nplPct ?? null
        : isInsurance
          ? null
          : industryAverages?.debtToEquity ?? null,
      weightPct: 14,
      score: assetQualityScore,
      status: healthStatusFromScore(assetQualityScore),
      higherIsBetter: isInsurance,
      sourceBasis: annualSourceTag,
      note: isFinancialBfi
        ? 'NRB asset-quality indicator; lower NPL preserves capital and dividend distribution capacity.'
        : isInsurance
          ? 'NIA policyholder solvency coverage cushion.'
          : 'Balance-sheet leverage vs equity net worth.',
    },
    {
      key: 'roePct',
      label: 'Return on Equity (ROE)',
      pillar: 'quality',
      unit: '%',
      companyValue: km.roePct,
      annualReportValue: annualSt?.metrics.roePct.value ?? null,
      industryAverage: industryAverages?.roePct ?? null,
      weightPct: 14,
      score: roeScore,
      status: healthStatusFromScore(roeScore),
      higherIsBetter: true,
      sourceBasis: annualSourceTag,
      note: `Weighted profitability on shareholder equity vs ${cfg.label} strong threshold (${cfg.strongRoePct}%).`,
    },
    {
      key: 'netMarginPct',
      label: 'Net Profit Margin',
      pillar: 'quality',
      unit: '%',
      companyValue: km.netMarginPct,
      annualReportValue: annualSt?.metrics.netProfitMarginPct.value ?? null,
      industryAverage: industryAverages?.netMarginPct ?? null,
      weightPct: 8,
      score: netMarginScore,
      status: healthStatusFromScore(netMarginScore),
      higherIsBetter: true,
      sourceBasis: annualSourceTag,
      note: 'Bottom-line operating efficiency retained per Rs 100 of core revenue.',
    },
    {
      key: 'ocfToProfitPct',
      label: 'OCF / Net Profit Cash Conversion',
      pillar: 'quality',
      unit: '%',
      companyValue: cap.netProfitToOcfPct,
      annualReportValue:
        annualSt &&
        annualSt.metrics.operatingCashFlow.value !== null &&
        annualSt.metrics.netProfit.value &&
        annualSt.metrics.netProfit.value > 0
          ? round1((annualSt.metrics.operatingCashFlow.value / annualSt.metrics.netProfit.value) * 100)
          : null,
      industryAverage: industryAverages?.ocfToProfitPct ?? null,
      weightPct: 6,
      score: ocfScore,
      status: healthStatusFromScore(ocfScore),
      higherIsBetter: true,
      sourceBasis: annualSourceTag,
      note: 'Verifies whether reported annual net profits convert into real operating cash flow.',
    },
    {
      key: 'epsGrowthPct',
      label: 'EPS Compounding (3Y CAGR / YoY)',
      pillar: 'growth',
      unit: '%',
      companyValue: epsGrowthVal,
      annualReportValue: km.epsCagr3yPct ?? km.epsYoyPct ?? null,
      industryAverage: industryAverages?.epsGrowthPct ?? null,
      weightPct: 14,
      score: epsGrowthScore,
      status: healthStatusFromScore(epsGrowthScore),
      higherIsBetter: true,
      sourceBasis: 'Multi-Year Annual + Q4 Trend',
      note: 'Per-share earnings expansion after accounting for bonus/rights equity dilution.',
    },
    {
      key: 'revenueGrowthPct',
      label: 'Revenue / Core Income Growth',
      pillar: 'growth',
      unit: '%',
      companyValue: revGrowthVal,
      annualReportValue: km.revenueCagr3yPct ?? km.revenueYoyPct ?? null,
      industryAverage: industryAverages?.revenueGrowthPct ?? null,
      weightPct: 10,
      score: revGrowthScore,
      status: healthStatusFromScore(revGrowthScore),
      higherIsBetter: true,
      sourceBasis: 'Multi-Year Annual + Q4 Trend',
      note: 'Top-line franchise growth validating organic market demand.',
    },
    {
      key: 'marginOfSafetyPct',
      label: 'Composite Margin of Safety vs LTP',
      pillar: 'valuation',
      unit: '%',
      companyValue: marginOfSafetyPct,
      annualReportValue: marginOfSafetyPct,
      industryAverage: industryAverages?.marginOfSafetyPct ?? null,
      weightPct: 14,
      score: mosScore,
      status: healthStatusFromScore(mosScore),
      higherIsBetter: true,
      sourceBasis: '6-Model Intrinsic Blend',
      note: 'Discount between current NEPSE LTP and 6-model intrinsic fair value.',
    },
    {
      key: 'earningsYieldSpread',
      label: `Earnings Yield Spread vs ${benchmarkFdRatePct.toFixed(1)}% FD`,
      pillar: 'valuation',
      unit: '%',
      companyValue: eySpread,
      annualReportValue: eySpread,
      industryAverage:
        industryAverages?.earningsYieldPct !== null &&
        industryAverages?.earningsYieldPct !== undefined
          ? round2(industryAverages.earningsYieldPct - benchmarkFdRatePct)
          : null,
      weightPct: 8,
      score: fdSpreadScore,
      status: healthStatusFromScore(fdSpreadScore),
      higherIsBetter: true,
      sourceBasis: 'Weighted EPS ÷ LTP vs FD',
      note: 'Excess earnings yield earned over Nepal commercial bank fixed deposit rates.',
    },
  ];

  const nonNullMetrics = metricsBreakdown.filter((m) => m.score !== null).length;
  const dataCoveragePct = round1((nonNullMetrics / metricsBreakdown.length) * 100);

  const pillars: ValuationHealthPillar[] = [
    {
      id: 'safety',
      label: 'Balance Sheet & Reserve Safety',
      weightPct: 30,
      score: safetyPillarScore,
      status: pillarStatusFromScore(safetyPillarScore),
      summary: `Reserve/Capital ${cap.reserveToCapitalRatio !== null ? `${cap.reserveToCapitalRatio.toFixed(2)}x` : '—'} · ${
        isFinancialBfi
          ? `NPL ${km.nplPct !== null ? `${km.nplPct.toFixed(2)}%` : '—'}`
          : isInsurance
            ? `Solvency ${assetQualityVal !== null ? `${assetQualityVal.toFixed(2)}x` : '—'}`
            : `D/E ${km.debtToEquity !== null ? `${km.debtToEquity.toFixed(2)}x` : '—'}`
      }`,
    },
    {
      id: 'quality',
      label: 'Earnings Quality & Annual Backing',
      weightPct: 20,
      score: qualityPillarScore,
      status: pillarStatusFromScore(qualityPillarScore),
      summary: `ROE ${km.roePct !== null ? `${km.roePct.toFixed(1)}%` : '—'} · Margin ${km.netMarginPct !== null ? `${km.netMarginPct.toFixed(1)}%` : '—'} · ${forensics.annualVsInterimDivergence.flag}`,
    },
    {
      id: 'growth',
      label: 'Growth Potential & Compounding',
      weightPct: 25,
      score: growthPillarScore,
      status: pillarStatusFromScore(growthPillarScore),
      summary: `EPS Growth ${epsGrowthVal !== null ? `${epsGrowthVal >= 0 ? '+' : ''}${epsGrowthVal.toFixed(1)}%` : '—'} · Rev Growth ${revGrowthVal !== null ? `${revGrowthVal >= 0 ? '+' : ''}${revGrowthVal.toFixed(1)}%` : '—'}`,
    },
    {
      id: 'valuation',
      label: 'Pricing Margin & Yield Cushion',
      weightPct: 25,
      score: valuationPillarScore,
      status: pillarStatusFromScore(valuationPillarScore),
      summary: `MoS ${marginOfSafetyPct !== null ? `${marginOfSafetyPct >= 0 ? '+' : ''}${marginOfSafetyPct.toFixed(1)}%` : '—'} · FD Spread ${eySpread !== null ? `${eySpread >= 0 ? '+' : ''}${eySpread.toFixed(2)}%` : '—'}`,
    },
  ];

  const headline =
    band === 'Fortress Value'
      ? `High balance-sheet resilience (${safetyScore.toFixed(0)}/100 safety) paired with ${growthScore.toFixed(0)}/100 growth & attractive pricing cushion.`
      : band === 'Healthy Compounder'
        ? `Constructive annual fundamentals (${safetyScore.toFixed(0)}/100 safety, ${growthScore.toFixed(0)}/100 growth) with balanced risk-reward.`
        : band === 'Balanced / Watch'
          ? `Mixed financial safety (${safetyScore.toFixed(0)}/100) or modest growth (${growthScore.toFixed(0)}/100); rely on Buy Zone entry discipline.`
          : `Elevated balance-sheet, earnings, or valuation stretch risk (${overallScore.toFixed(0)}/100) — review weak pillars before allocating capital.`;

  const dataBasisNote = forensics.hasAnnualReport
    ? `Weighted ${forensics.annualWeightPct}% Annual (${forensics.annualPeriodLabel}) + ${forensics.interimWeightPct}% Interim (${forensics.interimPeriodLabel ?? 'None'}) · ${nonNullMetrics}/${metricsBreakdown.length} metrics verified`
    : `Interim basis only (${forensics.interimPeriodLabel ?? summary.latestPeriod.periodLabel}) · ${nonNullMetrics}/${metricsBreakdown.length} metrics verified`;

  return {
    overallScore,
    safetyScore,
    growthScore,
    valuationCushionScore,
    band,
    annualWeightPct: forensics.annualWeightPct,
    hasAnnualReport: forensics.hasAnnualReport,
    annualPeriodLabel: forensics.annualPeriodLabel,
    interimPeriodLabel: forensics.interimPeriodLabel,
    dataCoveragePct,
    dataBasisNote,
    headline,
    pillars,
    metricsBreakdown,
  };
}

function buildAnnualReportDissector(params: {
  targetDetail: CompanyFundamentalDetailResponse;
  targetForensics: AnnualReportForensics;
  targetCompositeFairValue: number | null;
  targetMosPct: number | null;
  evaluated: ReturnType<typeof evaluateScreenerUniverse>;
  kb: RegulatoryKnowledgeBase;
  annualWeightPct: number;
  benchmarkFdRatePct: number;
}): {
  dissector: AnnualReportDissector;
  targetHealthScore: ValuationHealthScore;
} {
  const {
    targetDetail,
    targetForensics,
    targetCompositeFairValue,
    targetMosPct,
    evaluated,
    kb,
    annualWeightPct,
    benchmarkFdRatePct,
  } = params;

  const targetRow = targetDetail.summary;
  const targetSym = targetRow.symbol.toUpperCase();

  const sameSectorFund = evaluated.rows.filter(
    (r) => r.hasFundamentalData && r.sector === targetRow.sector
  );
  const useExactSector = sameSectorFund.length >= 2;
  const peerRows = useExactSector
    ? sameSectorFund
    : evaluated.rows.filter(
        (r) => r.hasFundamentalData && r.sectorGroup === targetRow.sectorGroup
      );

  interface PeerBundle {
    row: ScreenedCompanyRow;
    detail: CompanyFundamentalDetailResponse;
    forensics: AnnualReportForensics;
    health: ValuationHealthScore;
    mosPct: number | null;
    epsGrowthPct: number | null;
    revGrowthPct: number | null;
    carPct: number | null;
    ocfToProfitPct: number | null;
  }

  const bundles: PeerBundle[] = [];
  for (const row of peerRows) {
    const detail = evaluated.bySymbol.get(row.symbol);
    if (!detail) continue;
    const isTarget = row.symbol.toUpperCase() === targetSym;
    const kbEntry = kb.getCompanyEntry(row.symbol);
    const forensics = isTarget
      ? targetForensics
      : buildForensics({ detail, annualWeightPct, kbEntry });

    let compositeFair: number | null = isTarget ? targetCompositeFairValue : detail.valuation.intrinsicValue;
    let mosPct: number | null = isTarget ? targetMosPct : row.keyMetrics.marginOfSafetyPct;
    if (!isTarget) {
      const models = buildMultiModels({
        summary: row,
        detail,
        forensics,
        peerBenchmark: null,
        benchmarkFdRatePct,
      });
      const avail = models.filter((m) => m.available && m.price !== null && m.price > 0);
      if (avail.length > 0) {
        const tw = avail.reduce((s, m) => s + m.weightPct, 0);
        compositeFair = round1(avail.reduce((s, m) => s + (m.price ?? 0) * m.weightPct, 0) / Math.max(1, tw));
        mosPct =
          compositeFair > 0 && row.market.ltp && row.market.ltp > 0
            ? round1(((compositeFair - row.market.ltp) / compositeFair) * 100)
            : null;
      }
    }

    const health = computeValuationHealthScore({
      detail,
      forensics,
      marginOfSafetyPct: mosPct,
      kbEntry,
      benchmarkFdRatePct,
    });

    bundles.push({
      row,
      detail,
      forensics,
      health,
      mosPct,
      epsGrowthPct: row.keyMetrics.epsCagr3yPct ?? row.keyMetrics.epsYoyPct ?? null,
      revGrowthPct: row.keyMetrics.revenueCagr3yPct ?? row.keyMetrics.revenueYoyPct ?? null,
      carPct: row.keyMetrics.carPct,
      ocfToProfitPct: forensics.capitalStructure.netProfitToOcfPct,
    });
  }

  const cleanNums = (vals: Array<number | null | undefined>): number[] =>
    vals.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));

  const mean = (vals: Array<number | null | undefined>): number | null => {
    const clean = cleanNums(vals);
    if (clean.length === 0) return null;
    return round2(clean.reduce((a, b) => a + b, 0) / clean.length);
  };

  const median = (vals: Array<number | null | undefined>): number | null => {
    const clean = cleanNums(vals).sort((a, b) => a - b);
    if (clean.length === 0) return null;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 === 1
      ? round2(clean[mid])
      : round2((clean[mid - 1] + clean[mid]) / 2);
  };

  const topQuartile = (
    vals: Array<number | null | undefined>,
    higherIsBetter: boolean
  ): number | null => {
    const clean = cleanNums(vals).sort((a, b) => (higherIsBetter ? b - a : a - b));
    if (clean.length === 0) return null;
    const idx = Math.max(0, Math.min(clean.length - 1, Math.floor(clean.length * 0.25)));
    return round2(clean[idx]);
  };

  const peFilter = (v: number | null) => (v !== null && v > 0 && v <= 150 ? v : null);
  const pbFilter = (v: number | null) => (v !== null && v > 0 && v <= 30 ? v : null);

  const industryAverages: IndustryAverageMetrics = {
    sector: targetRow.sector,
    sectorGroup: targetRow.sectorGroup,
    peerCount: bundles.length,
    annualVerifiedPeerCount: bundles.filter((b) => b.forensics.hasAnnualReport).length,
    healthScore: mean(bundles.map((b) => b.health.overallScore)),
    safetyScore: mean(bundles.map((b) => b.health.safetyScore)),
    growthScore: mean(bundles.map((b) => b.health.growthScore)),
    eps: mean(bundles.map((b) => b.row.keyMetrics.eps)),
    roePct: mean(bundles.map((b) => b.row.keyMetrics.roePct)),
    roaPct: mean(bundles.map((b) => b.row.keyMetrics.roaPct)),
    netMarginPct: mean(bundles.map((b) => b.row.keyMetrics.netMarginPct)),
    bvps: mean(bundles.map((b) => b.row.keyMetrics.bvps)),
    pe: mean(bundles.map((b) => peFilter(b.row.keyMetrics.pe))),
    pb: mean(bundles.map((b) => pbFilter(b.row.keyMetrics.pb))),
    earningsYieldPct: mean(bundles.map((b) => b.row.keyMetrics.earningsYieldPct)),
    marginOfSafetyPct: mean(bundles.map((b) => b.mosPct)),
    epsGrowthPct: mean(bundles.map((b) => b.epsGrowthPct)),
    revenueGrowthPct: mean(bundles.map((b) => b.revGrowthPct)),
    reserveToCapitalRatio: mean(bundles.map((b) => b.forensics.capitalStructure.reserveToCapitalRatio)),
    nplPct: mean(bundles.map((b) => b.row.keyMetrics.nplPct)),
    debtToEquity: mean(bundles.map((b) => b.row.keyMetrics.debtToEquity)),
    carPct: mean(bundles.map((b) => b.carPct)),
    ocfToProfitPct: mean(bundles.map((b) => b.ocfToProfitPct)),
  };

  // Recompute target health score WITH populated industry averages so relative multiple & benchmark columns are populated
  const targetHealthScore = computeValuationHealthScore({
    detail: targetDetail,
    forensics: targetForensics,
    marginOfSafetyPct: targetMosPct,
    kbEntry: kb.getCompanyEntry(targetSym),
    benchmarkFdRatePct,
    industryAverages,
  });

  // Update target bundle in peerMatrix so ranks & values align 1:1
  const targetBundle = bundles.find((b) => b.row.symbol.toUpperCase() === targetSym);
  if (targetBundle) {
    targetBundle.health = targetHealthScore;
  }

  const { annualSt, interimSt } = findAnnualAndInterimLedgers(targetDetail);

  const makeRow = (spec: {
    key: string;
    label: string;
    unit: string;
    higherIsBetter: boolean;
    companyValue: number | null;
    annualReportValue: number | null;
    interimValue: number | null;
    peerValues: Array<number | null | undefined>;
    industryAvgOverride?: number | null;
  }): AnnualDissectorMetricRow => {
    const clean = cleanNums(spec.peerValues);
    const indAvg = spec.industryAvgOverride !== undefined ? spec.industryAvgOverride : mean(clean);
    const indMed = median(clean);
    const topQ = topQuartile(clean, spec.higherIsBetter);

    let deltaVsIndustry: number | null = null;
    let isBetterVsIndustry: boolean | null = null;
    let verdict: AnnualDissectorMetricRow['verdict'] = 'Unavailable';

    if (spec.companyValue !== null && Number.isFinite(spec.companyValue)) {
      if (indAvg !== null && Number.isFinite(indAvg)) {
        deltaVsIndustry = round2(spec.companyValue - indAvg);
        const relTol = Math.max(0.25, Math.abs(indAvg) * 0.05);
        if (Math.abs(deltaVsIndustry) <= relTol) {
          verdict = 'In Line';
          isBetterVsIndustry = spec.higherIsBetter ? deltaVsIndustry >= 0 : deltaVsIndustry <= 0;
        } else {
          isBetterVsIndustry = spec.higherIsBetter ? deltaVsIndustry > 0 : deltaVsIndustry < 0;
          verdict = isBetterVsIndustry ? 'Outperforming' : 'Lagging';
        }
      } else {
        verdict = 'In Line';
      }
    }

    let percentileInIndustry: number | null = null;
    if (spec.companyValue !== null && clean.length >= 2) {
      const beaten = clean.filter((v) =>
        spec.higherIsBetter ? spec.companyValue! >= v : spec.companyValue! <= v
      ).length;
      percentileInIndustry = round1((beaten / clean.length) * 100);
    }

    return {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      higherIsBetter: spec.higherIsBetter,
      companyValue: spec.companyValue !== null ? round2(spec.companyValue) : null,
      annualReportValue: spec.annualReportValue !== null ? round2(spec.annualReportValue) : null,
      interimValue: spec.interimValue !== null ? round2(spec.interimValue) : null,
      industryAverage: indAvg,
      industryMedian: indMed,
      topQuartileValue: topQ,
      deltaVsIndustry,
      isBetterVsIndustry,
      percentileInIndustry,
      verdict,
    };
  };

  const km = targetRow.keyMetrics;
  const targetReserve = targetForensics.capitalStructure.reserveToCapitalRatio;
  const annualReserve =
    annualSt &&
    annualSt.metrics.shareCapital.value &&
    annualSt.metrics.shareCapital.value > 0 &&
    annualSt.metrics.reserves.value !== null
      ? (annualSt.metrics.reserves.value +
          Math.max(0, annualSt.metrics.retainedEarnings.value ?? 0)) /
        annualSt.metrics.shareCapital.value
      : null;
  const interimReserve =
    interimSt &&
    interimSt.metrics.shareCapital.value &&
    interimSt.metrics.shareCapital.value > 0 &&
    interimSt.metrics.reserves.value !== null
      ? (interimSt.metrics.reserves.value +
          Math.max(0, interimSt.metrics.retainedEarnings.value ?? 0)) /
        interimSt.metrics.shareCapital.value
      : null;

  const isFinancialBfi =
    targetRow.sectorGroup === 'Banking' || targetRow.sectorGroup === 'Microfinance';

  const sections: AnnualDissectorSection[] = [
    {
      id: 'profitability',
      title: 'Profitability & Return Efficiency',
      subtitle: 'Dissects earnings yield on equity, assets, and core operating margins against sector peers.',
      metrics: [
        makeRow({
          key: 'roePct',
          label: 'Return on Equity (ROE)',
          unit: '%',
          higherIsBetter: true,
          companyValue: km.roePct,
          annualReportValue: annualSt?.metrics.roePct.value ?? null,
          interimValue: interimSt?.metrics.roePct.value ?? null,
          peerValues: bundles.map((b) => b.row.keyMetrics.roePct),
          industryAvgOverride: industryAverages.roePct,
        }),
        makeRow({
          key: 'roaPct',
          label: 'Return on Assets (ROA)',
          unit: '%',
          higherIsBetter: true,
          companyValue: km.roaPct,
          annualReportValue: annualSt?.metrics.roaPct.value ?? null,
          interimValue: interimSt?.metrics.roaPct.value ?? null,
          peerValues: bundles.map((b) => b.row.keyMetrics.roaPct),
          industryAvgOverride: industryAverages.roaPct,
        }),
        makeRow({
          key: 'netMarginPct',
          label: 'Net Profit Margin',
          unit: '%',
          higherIsBetter: true,
          companyValue: km.netMarginPct,
          annualReportValue: annualSt?.metrics.netProfitMarginPct.value ?? null,
          interimValue: interimSt?.metrics.netProfitMarginPct.value ?? null,
          peerValues: bundles.map((b) => b.row.keyMetrics.netMarginPct),
          industryAvgOverride: industryAverages.netMarginPct,
        }),
        makeRow({
          key: 'eps',
          label: 'Earnings Per Share (EPS)',
          unit: 'Rs',
          higherIsBetter: true,
          companyValue: km.eps,
          annualReportValue: annualSt?.metrics.eps.value ?? null,
          interimValue: interimSt?.metrics.eps.value ?? null,
          peerValues: bundles.map((b) => b.row.keyMetrics.eps),
          industryAvgOverride: industryAverages.eps,
        }),
      ],
    },
    {
      id: 'growth',
      title: 'Growth & Earnings Compounding',
      subtitle: 'Compares multi-year EPS, revenue, net profit, and equity book expansion rates.',
      metrics: [
        makeRow({
          key: 'epsGrowthPct',
          label: 'EPS Growth (3Y CAGR / YoY)',
          unit: '%',
          higherIsBetter: true,
          companyValue: km.epsCagr3yPct ?? km.epsYoyPct ?? null,
          annualReportValue: km.epsCagr3yPct ?? null,
          interimValue: km.epsYoyPct ?? null,
          peerValues: bundles.map((b) => b.epsGrowthPct),
          industryAvgOverride: industryAverages.epsGrowthPct,
        }),
        makeRow({
          key: 'revenueGrowthPct',
          label: 'Revenue / Core Income Growth',
          unit: '%',
          higherIsBetter: true,
          companyValue: km.revenueCagr3yPct ?? km.revenueYoyPct ?? null,
          annualReportValue: km.revenueCagr3yPct ?? null,
          interimValue: km.revenueYoyPct ?? null,
          peerValues: bundles.map((b) => b.revGrowthPct),
          industryAvgOverride: industryAverages.revenueGrowthPct,
        }),
        makeRow({
          key: 'netProfitYoyPct',
          label: 'Net Profit YoY Growth',
          unit: '%',
          higherIsBetter: true,
          companyValue: km.netProfitYoyPct,
          annualReportValue: km.netProfitCagr3yPct ?? null,
          interimValue: km.netProfitYoyPct ?? null,
          peerValues: bundles.map((b) => b.row.keyMetrics.netProfitYoyPct),
        }),
        makeRow({
          key: 'bvpsYoyPct',
          label: 'Book Value / Share YoY Growth',
          unit: '%',
          higherIsBetter: true,
          companyValue: km.bvpsYoyPct,
          annualReportValue: targetDetail.growth.bvpsCagr3yPct ?? null,
          interimValue: km.bvpsYoyPct ?? null,
          peerValues: bundles.map((b) => b.row.keyMetrics.bvpsYoyPct),
        }),
      ],
    },
    {
      id: 'capital_solvency',
      title: 'Capital Cushion, Reserves & Solvency',
      subtitle: 'Audits paid-up capital reserve backing, asset quality, capital adequacy, and cash conversion.',
      metrics: [
        makeRow({
          key: 'reserveToCapitalRatio',
          label: 'Reserves & Retained / Paid-Up Capital',
          unit: 'x',
          higherIsBetter: true,
          companyValue: targetReserve,
          annualReportValue: annualReserve,
          interimValue: interimReserve,
          peerValues: bundles.map((b) => b.forensics.capitalStructure.reserveToCapitalRatio),
          industryAvgOverride: industryAverages.reserveToCapitalRatio,
        }),
        makeRow({
          key: 'bvps',
          label: 'Book Value Per Share (BVPS)',
          unit: 'Rs',
          higherIsBetter: true,
          companyValue: km.bvps,
          annualReportValue: annualSt?.metrics.bvps.value ?? null,
          interimValue: interimSt?.metrics.bvps.value ?? null,
          peerValues: bundles.map((b) => b.row.keyMetrics.bvps),
          industryAvgOverride: industryAverages.bvps,
        }),
        ...(isFinancialBfi
          ? [
              makeRow({
                key: 'nplPct',
                label: 'Non-Performing Loans (NPL)',
                unit: '%',
                higherIsBetter: false,
                companyValue: km.nplPct,
                annualReportValue: annualSt?.metrics.nplPct.value ?? null,
                interimValue: interimSt?.metrics.nplPct.value ?? null,
                peerValues: bundles.map((b) => b.row.keyMetrics.nplPct),
                industryAvgOverride: industryAverages.nplPct,
              }),
              makeRow({
                key: 'carPct',
                label: 'Capital Adequacy Ratio (CAR)',
                unit: '%',
                higherIsBetter: true,
                companyValue: km.carPct,
                annualReportValue: annualSt?.metrics.carPct.value ?? null,
                interimValue: interimSt?.metrics.carPct.value ?? null,
                peerValues: bundles.map((b) => b.carPct),
                industryAvgOverride: industryAverages.carPct,
              }),
            ]
          : [
              makeRow({
                key: 'debtToEquity',
                label: 'Debt-to-Equity Ratio',
                unit: 'x',
                higherIsBetter: false,
                companyValue: km.debtToEquity,
                annualReportValue: annualSt?.metrics.debtToEquity.value ?? null,
                interimValue: interimSt?.metrics.debtToEquity.value ?? null,
                peerValues: bundles.map((b) => b.row.keyMetrics.debtToEquity),
                industryAvgOverride: industryAverages.debtToEquity,
              }),
              makeRow({
                key: 'ocfToProfitPct',
                label: 'OCF / Net Profit Conversion',
                unit: '%',
                higherIsBetter: true,
                companyValue: targetForensics.capitalStructure.netProfitToOcfPct,
                annualReportValue:
                  annualSt &&
                  annualSt.metrics.operatingCashFlow.value !== null &&
                  annualSt.metrics.netProfit.value &&
                  annualSt.metrics.netProfit.value > 0
                    ? (annualSt.metrics.operatingCashFlow.value /
                        annualSt.metrics.netProfit.value) *
                      100
                    : null,
                interimValue:
                  interimSt &&
                  interimSt.metrics.operatingCashFlow.value !== null &&
                  interimSt.metrics.netProfit.value &&
                  interimSt.metrics.netProfit.value > 0
                    ? (interimSt.metrics.operatingCashFlow.value /
                        interimSt.metrics.netProfit.value) *
                      100
                    : null,
                peerValues: bundles.map((b) => b.ocfToProfitPct),
                industryAvgOverride: industryAverages.ocfToProfitPct,
              }),
            ]),
      ],
    },
    {
      id: 'valuation',
      title: 'Valuation Multiples & Margin of Safety',
      subtitle: 'Prices current market multiples against industry peers and composite intrinsic worth.',
      metrics: [
        makeRow({
          key: 'pe',
          label: 'Price / Earnings (P/E)',
          unit: 'x',
          higherIsBetter: false,
          companyValue: km.pe,
          annualReportValue:
            targetRow.market.ltp && annualSt?.metrics.eps.value && annualSt.metrics.eps.value > 0
              ? targetRow.market.ltp / annualSt.metrics.eps.value
              : null,
          interimValue:
            targetRow.market.ltp && interimSt?.metrics.eps.value && interimSt.metrics.eps.value > 0
              ? targetRow.market.ltp / interimSt.metrics.eps.value
              : null,
          peerValues: bundles.map((b) => peFilter(b.row.keyMetrics.pe)),
          industryAvgOverride: industryAverages.pe,
        }),
        makeRow({
          key: 'pb',
          label: 'Price / Book Value (P/B)',
          unit: 'x',
          higherIsBetter: false,
          companyValue: km.pb,
          annualReportValue:
            targetRow.market.ltp && annualSt?.metrics.bvps.value && annualSt.metrics.bvps.value > 0
              ? targetRow.market.ltp / annualSt.metrics.bvps.value
              : null,
          interimValue:
            targetRow.market.ltp &&
            interimSt?.metrics.bvps.value &&
            interimSt.metrics.bvps.value > 0
              ? targetRow.market.ltp / interimSt.metrics.bvps.value
              : null,
          peerValues: bundles.map((b) => pbFilter(b.row.keyMetrics.pb)),
          industryAvgOverride: industryAverages.pb,
        }),
        makeRow({
          key: 'earningsYieldPct',
          label: 'Earnings Yield (1/PE)',
          unit: '%',
          higherIsBetter: true,
          companyValue: km.earningsYieldPct,
          annualReportValue:
            targetRow.market.ltp && annualSt?.metrics.eps.value && annualSt.metrics.eps.value > 0
              ? (annualSt.metrics.eps.value / targetRow.market.ltp) * 100
              : null,
          interimValue:
            targetRow.market.ltp && interimSt?.metrics.eps.value && interimSt.metrics.eps.value > 0
              ? (interimSt.metrics.eps.value / targetRow.market.ltp) * 100
              : null,
          peerValues: bundles.map((b) => b.row.keyMetrics.earningsYieldPct),
          industryAvgOverride: industryAverages.earningsYieldPct,
        }),
        makeRow({
          key: 'marginOfSafetyPct',
          label: 'Composite Margin of Safety',
          unit: '%',
          higherIsBetter: true,
          companyValue: targetMosPct,
          annualReportValue: targetMosPct,
          interimValue: null,
          peerValues: bundles.map((b) => b.mosPct),
          industryAvgOverride: industryAverages.marginOfSafetyPct,
        }),
      ],
    },
  ];

  const sortedBundles = [...bundles].sort(
    (a, b) =>
      b.health.overallScore - a.health.overallScore ||
      (b.mosPct ?? -999) - (a.mosPct ?? -999)
  );
  const rankIdx = sortedBundles.findIndex((b) => b.row.symbol.toUpperCase() === targetSym);

  const peerMatrix: AnnualDissectorPeerRow[] = sortedBundles.map((b) => ({
    symbol: b.row.symbol,
    companyName: b.row.companyName,
    isTarget: b.row.symbol.toUpperCase() === targetSym,
    hasAnnualReport: b.forensics.hasAnnualReport,
    annualPeriodLabel: b.forensics.annualPeriodLabel,
    ltp: b.row.market.ltp,
    healthScore: b.health.overallScore,
    healthBand: b.health.band,
    safetyScore: b.health.safetyScore,
    growthScore: b.health.growthScore,
    eps: b.row.keyMetrics.eps,
    roePct: b.row.keyMetrics.roePct,
    netMarginPct: b.row.keyMetrics.netMarginPct,
    pe: b.row.keyMetrics.pe,
    pb: b.row.keyMetrics.pb,
    reserveToCapitalRatio: b.forensics.capitalStructure.reserveToCapitalRatio,
    epsGrowthPct: b.epsGrowthPct,
    marginOfSafetyPct: b.mosPct,
    nplPct: b.row.keyMetrics.nplPct,
    debtToEquity: b.row.keyMetrics.debtToEquity,
  }));

  return {
    targetHealthScore,
    dissector: {
      sector: targetRow.sector,
      sectorGroup: targetRow.sectorGroup,
      scopeLabel: useExactSector
        ? `${targetRow.sector} Industry (${bundles.length} peers)`
        : `${targetRow.sectorGroup} Sector Group (${bundles.length} peers)`,
      peerCount: bundles.length,
      annualVerifiedPeerCount: industryAverages.annualVerifiedPeerCount,
      companyRankByHealth: rankIdx >= 0 ? rankIdx + 1 : null,
      annualWeightPct,
      industryAverages,
      sections,
      peerMatrix,
    },
  };
}

export function buildCompanyValuationDossier(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  symbol: string,
  opts: {
    equityOnly?: boolean;
    benchmarkFdRatePct?: number;
    annualWeightPct?: number;
    monitorStatusMap?: Map<string, ReportMonitorStatus>;
  } = {}
): CompanyValuationDossierResponse | null {
  const sym = symbol.trim().toUpperCase();
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

  const evaluated = evaluateScreenerUniverse(store, vault, {
    equityOnly,
    benchmarkFdRatePct,
    annualWeightPct,
    monitorStatusMap: opts.monitorStatusMap,
  });

  const detail = evaluated.bySymbol.get(sym);
  if (!detail) return null;

  const kbEntry = kb.getCompanyEntry(sym);
  const peerBenchmark = buildSectorPeerBenchmark(evaluated.rows, sym);
  const forensics = buildForensics({ detail, annualWeightPct, kbEntry });
  const models = buildMultiModels({
    summary: detail.summary,
    detail,
    forensics,
    peerBenchmark,
    benchmarkFdRatePct,
  });

  const availableModels = models.filter((m) => m.available && m.price !== null && m.price > 0);
  let compositeFairValue: number | null = detail.valuation.intrinsicValue;
  let fairValueLow: number | null = detail.valuation.intrinsicValueLow;
  let fairValueHigh: number | null = detail.valuation.intrinsicValueHigh;

  if (availableModels.length > 0) {
    const totalW = availableModels.reduce((s, m) => s + m.weightPct, 0);
    const weighted = availableModels.reduce(
      (s, m) => s + (m.price ?? 0) * m.weightPct,
      0
    );
    compositeFairValue = round1(weighted / Math.max(1, totalW));
    const prices = availableModels.map((m) => m.price as number).sort((a, b) => a - b);
    fairValueLow = round1(prices[0] * 0.92);
    fairValueHigh = round1(prices[prices.length - 1] * 1.05);
  }

  const ltp = detail.summary.market.ltp;
  const marginOfSafetyPct =
    compositeFairValue !== null && compositeFairValue > 0 && ltp !== null && ltp > 0
      ? round1(((compositeFairValue - ltp) / compositeFairValue) * 100)
      : null;

  let pricingVerdict: CompanyValuationDossierResponse['pricingVerdict'] = 'Insufficient Data';
  if (marginOfSafetyPct !== null) {
    if (marginOfSafetyPct >= 22) pricingVerdict = 'Deeply Undervalued';
    else if (marginOfSafetyPct >= 8) pricingVerdict = 'Undervalued / Attractive';
    else if (marginOfSafetyPct >= -12) pricingVerdict = 'Fairly Valued';
    else pricingVerdict = 'Richly Priced';
  }

  const entryZones = {
    deepValuePrice: compositeFairValue ? round1(compositeFairValue * 0.75) : null,
    buyZonePrice: compositeFairValue ? round1(compositeFairValue * 0.85) : null,
    fairValuePrice: compositeFairValue,
    trimZonePrice: compositeFairValue ? round1(compositeFairValue * 1.2) : null,
  };

  const { dissector, targetHealthScore } = buildAnnualReportDissector({
    targetDetail: detail,
    targetForensics: forensics,
    targetCompositeFairValue: compositeFairValue,
    targetMosPct: marginOfSafetyPct,
    evaluated,
    kb,
    annualWeightPct,
    benchmarkFdRatePct,
  });

  const scenarios = buildFutureScenarios({
    summary: detail.summary,
    compositeFairValue,
  });
  const sensitivityGrid = buildSensitivityGrid({
    summary: detail.summary,
    benchmarkFdRatePct,
  });
  const swot = buildSwotAndFutureWorth({
    summary: detail.summary,
    compositeFairValue,
    fairValueLow,
    fairValueHigh,
    marginOfSafetyPct,
    entryZones,
    forensics,
    kbEntry,
    benchmarkFdRatePct,
  });

  const cache = loadDeepDiveCache(vault);
  const aiDeepDive = cache[sym] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    marketDate: evaluated.marketDate,
    annualWeightPct,
    benchmarkFdRatePct,
    summary: detail.summary,
    valuation: detail.valuation,
    compositeFairValue,
    fairValueLow,
    fairValueHigh,
    marginOfSafetyPct,
    pricingVerdict,
    entryZones,
    valuationHealthScore: targetHealthScore,
    annualReportDissector: dissector,
    models,
    scenarios,
    sensitivityGrid,
    forensics,
    swot,
    kbEntry,
    peerBenchmark,
    aiDeepDive,
  };
}

export function getValuationUniverseSummary(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  opts: {
    equityOnly?: boolean;
    benchmarkFdRatePct?: number;
    annualWeightPct?: number;
    monitorStatusMap?: Map<string, ReportMonitorStatus>;
  } = {}
): ValuationUniverseResponse {
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

  const evaluated = evaluateScreenerUniverse(store, vault, {
    equityOnly,
    benchmarkFdRatePct,
    annualWeightPct,
    monitorStatusMap: opts.monitorStatusMap,
  });

  const aiCache = loadDeepDiveCache(vault);
  const candidates: ValuationUniverseCandidate[] = [];
  let withAnnualReports = 0;
  let undervaluedCount = 0;
  let coreAllocationCount = 0;

  for (const row of evaluated.rows) {
    if (!row.hasFundamentalData) continue;
    const detail = evaluated.bySymbol.get(row.symbol);
    if (!detail) continue;

    const kbEntry = kb.getCompanyEntry(row.symbol);
    const forensics = buildForensics({ detail, annualWeightPct, kbEntry });
    const models = buildMultiModels({
      summary: row,
      detail,
      forensics,
      peerBenchmark: null,
      benchmarkFdRatePct,
    });

    const availableModels = models.filter((m) => m.available && m.price !== null && m.price > 0);
    let compositeFairValue = detail.valuation.intrinsicValue;
    if (availableModels.length > 0) {
      const totalW = availableModels.reduce((s, m) => s + m.weightPct, 0);
      const weighted = availableModels.reduce((s, m) => s + (m.price ?? 0) * m.weightPct, 0);
      compositeFairValue = round1(weighted / Math.max(1, totalW));
    }
    const ltp = row.market.ltp;
    const marginOfSafetyPct =
      compositeFairValue !== null && compositeFairValue > 0 && ltp !== null && ltp > 0
        ? round1(((compositeFairValue - ltp) / compositeFairValue) * 100)
        : null;

    let pricingVerdict: CompanyValuationDossierResponse['pricingVerdict'] = 'Insufficient Data';
    if (marginOfSafetyPct !== null) {
      if (marginOfSafetyPct >= 22) pricingVerdict = 'Deeply Undervalued';
      else if (marginOfSafetyPct >= 8) pricingVerdict = 'Undervalued / Attractive';
      else if (marginOfSafetyPct >= -12) pricingVerdict = 'Fairly Valued';
      else pricingVerdict = 'Richly Priced';
    }

    const entryZones = {
      deepValuePrice: compositeFairValue ? round1(compositeFairValue * 0.75) : null,
      buyZonePrice: compositeFairValue ? round1(compositeFairValue * 0.85) : null,
      fairValuePrice: compositeFairValue,
      trimZonePrice: compositeFairValue ? round1(compositeFairValue * 1.2) : null,
    };

    const swot = buildSwotAndFutureWorth({
      summary: row,
      compositeFairValue,
      fairValueLow: compositeFairValue ? round1(compositeFairValue * 0.85) : null,
      fairValueHigh: compositeFairValue ? round1(compositeFairValue * 1.15) : null,
      marginOfSafetyPct,
      entryZones,
      forensics,
      kbEntry,
      benchmarkFdRatePct,
    });

    const health = computeValuationHealthScore({
      detail,
      forensics,
      marginOfSafetyPct,
      kbEntry,
      benchmarkFdRatePct,
    });

    if (row.reportWeighting.hasAnnualReport) withAnnualReports++;
    if (marginOfSafetyPct !== null && marginOfSafetyPct >= 8) undervaluedCount++;
    if (swot.futureWorthVerdict.convictionTier === 'Core Long-Term Allocation') {
      coreAllocationCount++;
    }

    candidates.push({
      symbol: row.symbol,
      companyName: row.companyName,
      sector: row.sector,
      sectorGroup: row.sectorGroup,
      ltp,
      compositeFairValue,
      marginOfSafetyPct,
      pricingVerdict,
      considerableInvestmentScore: swot.futureWorthVerdict.considerableInvestmentScore,
      convictionTier: swot.futureWorthVerdict.convictionTier,
      valuationHealthScore: health.overallScore,
      healthBand: health.band,
      safetyScore: health.safetyScore,
      growthScore: health.growthScore,
      hasAnnualReport: row.reportWeighting.hasAnnualReport,
      reportBasis: row.reportWeighting.basis,
      reserveToCapitalRatio: forensics.capitalStructure.reserveToCapitalRatio,
      overallScore: row.scores.overallScore,
      roePct: row.keyMetrics.roePct,
      pe: row.keyMetrics.pe,
      pb: row.keyMetrics.pb,
      creditRatingLabel: forensics.capitalStructure.creditRatingLabel,
      hasAiDeepDive: Boolean(aiCache[row.symbol]),
    });
  }

  candidates.sort(
    (a, b) =>
      b.considerableInvestmentScore - a.considerableInvestmentScore ||
      (b.marginOfSafetyPct ?? -999) - (a.marginOfSafetyPct ?? -999)
  );

  return {
    generatedAt: new Date().toISOString(),
    marketDate: evaluated.marketDate,
    annualWeightPct,
    benchmarkFdRatePct,
    totalEvaluated: candidates.length,
    withAnnualReports,
    undervaluedCount,
    coreAllocationCount,
    candidates,
  };
}

export async function runAnnualReportDeepDive(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  symbol: string,
  force = false,
  benchmarkFdRatePct = 6.5
): Promise<AnnualReportAiDeepDive> {
  const sym = symbol.trim().toUpperCase();
  const cache = loadDeepDiveCache(vault);
  if (!force && cache[sym]) {
    return { ...cache[sym], cached: true };
  }

  const dossier = buildCompanyValuationDossier(store, vault, kb, sym, {
    benchmarkFdRatePct,
    annualWeightPct: 70,
  });
  if (!dossier) {
    throw new Error(`No fundamental ledger found for ${sym}`);
  }

  const ai = getAiClient();
  const km = dossier.summary.keyMetrics;
  const cap = dossier.forensics.capitalStructure;

  const prompt = `Perform a forensic Annual Report & AGM disclosure deep-dive for NEPSE-listed company ${sym} (${dossier.summary.companyName}, sector: ${dossier.summary.sector}).
Focus 70%+ on audited Annual Report / AGM disclosures, Board Report management guidance, auditor remarks, capacity/project/branch expansion pipeline, multi-year bonus + cash dividend announcements, ICRA Nepal / CARE Ratings Nepal rating rationales, and NRB / NIA / SEBON / NEPSE / CDSC regulatory filings.

Verified metrics already on file (DO NOT contradict or invent fake replacements):
- Market LTP: ${dossier.summary.market.ltp !== null ? `Rs ${dossier.summary.market.ltp}` : 'Unavailable'}
- Composite Intrinsic Value Estimate: ${dossier.compositeFairValue !== null ? `Rs ${dossier.compositeFairValue}` : 'Unavailable'}
- 70/30 Blended EPS: ${km.eps ?? 'Unavailable'}, ROE: ${km.roePct ?? 'Unavailable'}%, BVPS: ${km.bvps ?? 'Unavailable'}
- Reserve/Capital Ratio: ${cap.reserveToCapitalRatio ?? 'Unavailable'}x, Paid-Up Capital: ${cap.shareCapitalCr ?? 'Unavailable'} Cr, Reserves: ${cap.reservesCr ?? 'Unavailable'} Cr
- Annual Period on file: ${dossier.forensics.annualPeriodLabel ?? 'None indexed yet'}, Latest Interim: ${dossier.forensics.interimPeriodLabel ?? 'None'}
- Known Credit Rating: ${cap.creditRatingLabel ?? 'Not indexed'}

Respond strictly with ONE valid JSON object matching this exact schema (no markdown commentary outside JSON):
{
  "annualReportYear": "Latest audited fiscal year found via search (e.g. FY 2081/82 or 2082/83) or null",
  "executiveSummary": "2-3 sentence synthesis of the company's latest annual report quality, strategic moat, and pricing relative to worth",
  "managementGuidanceAndCatalysts": ["3-5 concrete findings from Annual Report / Board Report / AGM guidance / expansion projects"],
  "auditorAndGovernanceFindings": ["2-4 findings on auditor report, contingent liabilities, promoter lock-in, or NRB/NIA/SEBON compliance"],
  "dividendAndBonusHistory": ["2-4 recent fiscal year bonus share + cash dividend announcements"],
  "annualReportStrengths": ["3-4 core fundamental strengths verified in annual disclosures"],
  "annualReportWeaknesses": ["2-4 structural or financial weaknesses found in annual reports"],
  "annualReportOpportunities": ["3-4 concrete future growth or re-rating opportunities"],
  "annualReportRisks": ["3-4 downside risks highlighted in annual reports or rating rationales"],
  "futureWorthOutlook": "2-3 sentence assessment of 3-to-5 year earnings compounding potential and future worth",
  "considerableInvestmentVerdict": "1-2 sentence direct capital-allocation verdict on whether it warrants a considerable long-term investment at current LTP"
}`;

  const callModel = async (model: string): Promise<GenerateContentResponse> => {
    return ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
  };

  let response: GenerateContentResponse;
  let usedModel = PRIMARY_MODEL;
  try {
    response = await callModel(PRIMARY_MODEL);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('NOT_FOUND')) {
      usedModel = FALLBACK_MODEL;
      response = await callModel(FALLBACK_MODEL);
    } else {
      throw err;
    }
  }

  const parsed = parseJsonObjectSafe(response.text ?? '');
  if (!parsed) {
    throw new Error('Gemini returned an unparseable annual report response. Please retry.');
  }

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const citations: Array<{ title: string; uri: string }> = [];
  const seenUris = new Set<string>();
  for (const ch of chunks) {
    const uri = ch?.web?.uri;
    const title = ch?.web?.title || uri;
    if (uri && title && !seenUris.has(uri)) {
      seenUris.add(uri);
      citations.push({ title, uri });
    }
  }

  const result: AnnualReportAiDeepDive = {
    symbol: sym,
    generatedAt: new Date().toISOString(),
    model: usedModel,
    cached: false,
    annualReportYear:
      typeof parsed.annualReportYear === 'string' && parsed.annualReportYear.trim()
        ? parsed.annualReportYear.trim()
        : null,
    executiveSummary: strOrFallback(
      parsed.executiveSummary,
      `Annual report research synthesized for ${sym}.`
    ),
    managementGuidanceAndCatalysts: strArr(parsed.managementGuidanceAndCatalysts, 5),
    auditorAndGovernanceFindings: strArr(parsed.auditorAndGovernanceFindings, 5),
    dividendAndBonusHistory: strArr(parsed.dividendAndBonusHistory, 5),
    annualReportStrengths: strArr(parsed.annualReportStrengths, 5),
    annualReportWeaknesses: strArr(parsed.annualReportWeaknesses, 5),
    annualReportOpportunities: strArr(parsed.annualReportOpportunities, 5),
    annualReportRisks: strArr(parsed.annualReportRisks, 5),
    futureWorthOutlook: strOrFallback(
      parsed.futureWorthOutlook,
      'Review multi-year ROE and reserve retention trends alongside AGM expansion guidance.'
    ),
    considerableInvestmentVerdict: strOrFallback(
      parsed.considerableInvestmentVerdict,
      'Evaluate allocation size against Margin of Safety and regulatory standing.'
    ),
    citations: citations.slice(0, 10),
  };

  cache[sym] = result;
  saveDeepDiveCache(vault, cache);
  return result;
}
