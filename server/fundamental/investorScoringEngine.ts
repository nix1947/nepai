import type {
  CompanyFundamentalDetailResponse,
  CompositeScores,
  ConsensusMatch,
  ConsensusTag,
  DataProvenance,
  GreenblattRankInfo,
  GrowthComparisons,
  InvestorCriterionResult,
  InvestorId,
  InvestorScoreResult,
  MarketOverlay,
  QuarterCode,
  QuarterlyStatementRecord,
  RankingCategory,
  RecommendationVerdict,
  ReportMonitorStatus,
  ReportWeightingInfo,
  ScreenedCompanyRow,
  SectorPeerBenchmark,
  SectorPeerSnapshot,
  StockRecommendationExplanation,
  ValuationBreakdown,
} from '../../src/types/fundamental.ts';
import type { MarketStore } from '../marketStore.ts';
import { computeFreshnessDays, classifySectorGroup, extractStartBsYear } from './nepalCalendar.ts';
import { computeGrowthComparisons, FundamentalVault, type CompanyLedgerFile } from './fundamentalVault.ts';
import { computeSectorValuation, getSectorThresholds, type SectorThresholds } from './sectorMethodology.ts';

function clip(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function blendOpt(
  annualVal: number | null | undefined,
  interimVal: number | null | undefined,
  annualRatio: number,
  decimals = 2
): number | null {
  const aOk = annualVal !== null && annualVal !== undefined && Number.isFinite(annualVal);
  const iOk = interimVal !== null && interimVal !== undefined && Number.isFinite(interimVal);
  if (aOk && iOk) {
    const raw = annualVal * annualRatio + interimVal * (1 - annualRatio);
    const factor = Math.pow(10, decimals);
    return Math.round(raw * factor) / factor;
  }
  if (aOk) return annualVal;
  if (iOk) return interimVal;
  return null;
}

function pickLatestAnnualRecord(records: QuarterlyStatementRecord[]): QuarterlyStatementRecord | null {
  const annuals = records.filter((r) => r.quarter === 'Annual' || r.quarter === 'Q4');
  if (annuals.length === 0) return null;
  const topFy = annuals[0].fiscalYear;
  return annuals.find((r) => r.fiscalYear === topFy && r.quarter === 'Annual') ?? annuals[0];
}

function pickLatestInterimRecord(records: QuarterlyStatementRecord[]): QuarterlyStatementRecord | null {
  return records.find((r) => r.quarter === 'Q1' || r.quarter === 'Q2' || r.quarter === 'Q3') ?? null;
}

interface CriterionSpec {
  key: string;
  label: string;
  weight: number;
  actualValue: number | null;
  actualDisplay: string;
  thresholdDisplay: string;
  provenance: DataProvenance;
  evaluate: (v: number) => { ratio: number; passed: boolean; explanation: string };
  unavailableReason: string;
}

function buildInvestorResult(
  investorId: InvestorId,
  investorName: string,
  philosophy: string,
  specs: CriterionSpec[],
  summaryBuilder: (score: number, passedCount: number, availCount: number, coverage: number) => string
): InvestorScoreResult {
  let totalWeight = 0;
  let availableWeight = 0;
  let earnedAvailable = 0;
  let passedCount = 0;
  let availCount = 0;

  const criteria: InvestorCriterionResult[] = specs.map((spec) => {
    totalWeight += spec.weight;
    if (spec.actualValue === null || !Number.isFinite(spec.actualValue)) {
      return {
        key: spec.key,
        label: spec.label,
        weight: spec.weight,
        earnedPoints: 0,
        status: 'unavailable',
        actualDisplay: 'Unavailable',
        thresholdDisplay: spec.thresholdDisplay,
        provenance: 'Unavailable',
        explanation: spec.unavailableReason,
      };
    }

    availCount++;
    availableWeight += spec.weight;
    const res = spec.evaluate(spec.actualValue);
    const pts = round1(spec.weight * clip(res.ratio, 0, 1));
    earnedAvailable += pts;
    if (res.passed) passedCount++;

    return {
      key: spec.key,
      label: spec.label,
      weight: spec.weight,
      earnedPoints: pts,
      status: res.passed ? 'passed' : 'failed',
      actualDisplay: spec.actualDisplay,
      thresholdDisplay: spec.thresholdDisplay,
      provenance: spec.provenance,
      explanation: res.explanation,
    };
  });

  const dataCoveragePct = totalWeight > 0 ? round1((availableWeight / totalWeight) * 100) : 0;
  const rawWeightedScore =
    availableWeight > 0 ? round1((earnedAvailable / availableWeight) * 100) : 0;

  // Penalize confidence proportionally if coverage < 60% so sparse records cannot top rankings
  const coverageMultiplier =
    dataCoveragePct >= 75 ? 1 : dataCoveragePct >= 45 ? 0.85 + ((dataCoveragePct - 45) / 30) * 0.15 : dataCoveragePct / 60;
  const score = round1(clip(rawWeightedScore * coverageMultiplier, 0, 100));
  const qualified = score >= 62 && dataCoveragePct >= 50;

  return {
    investorId,
    investorName,
    philosophy,
    score,
    rawWeightedScore,
    dataCoveragePct,
    qualified,
    summary: summaryBuilder(score, passedCount, availCount, dataCoveragePct),
    criteria,
  };
}

function fmtPct(v: number | null): string {
  return v !== null && Number.isFinite(v) ? `${v.toFixed(2)}%` : 'Unavailable';
}

function fmtNum(v: number | null, suffix = ''): string {
  return v !== null && Number.isFinite(v) ? `${v.toFixed(2)}${suffix}` : 'Unavailable';
}

function fmtCrore(v: number | null): string {
  return v !== null && Number.isFinite(v) ? `Rs ${(v / 1e7).toFixed(2)} Cr` : 'Unavailable';
}

function evaluateNineInvestors(params: {
  record: QuarterlyStatementRecord;
  growth: GrowthComparisons;
  valuation: ValuationBreakdown;
  market: MarketOverlay;
  thresholds: SectorThresholds;
  benchmarkFdRatePct: number;
  greenblattPreRank: { eyRank: number | null; roicRank: number | null; total: number; eyScore: number | null; roicScore: number | null };
}): Record<InvestorId, InvestorScoreResult> {
  const { record, growth, valuation, market, thresholds, benchmarkFdRatePct, greenblattPreRank } = params;
  const m = record.metrics;
  const isFinancial =
    thresholds.sectorGroup === 'Banking' ||
    thresholds.sectorGroup === 'Microfinance' ||
    thresholds.sectorGroup === 'Insurance';

  const eps = m.eps.value;
  const roe = m.roePct.value;
  const roa = m.roaPct.value;
  const roic = m.roicPct.value;
  const roicOrRoe = isFinancial ? roe : roic ?? roe;
  const roicOrRoeProv = isFinancial ? m.roePct.provenance : roic !== null ? m.roicPct.provenance : m.roePct.provenance;
  const netMargin = m.netProfitMarginPct.value;
  const pe = valuation.livePe;
  const pb = valuation.livePb;
  const peg = valuation.livePeg;
  const mos = valuation.marginOfSafetyPct;
  const ey = valuation.earningsYieldPct;
  const de = m.debtToEquity.value;
  const npl = m.nplPct.value;
  const car = m.carPct.value;
  const epsGrowthBest =
    growth.epsCagr3yPct ?? growth.epsYoyPct ?? growth.q4Benchmark.epsVsAvgPct;
  const revGrowthBest =
    growth.revenueCagr3yPct ?? growth.revenueYoyPct ?? growth.q4Benchmark.revenueVsAvgPct;
  const ocfOrOe = m.ownerEarnings.value ?? m.freeCashFlow.value ?? m.operatingCashFlow.value;

  const reservesRatio =
    m.reserves.value !== null && m.shareCapital.value !== null && m.shareCapital.value > 0
      ? round2((m.reserves.value + (m.retainedEarnings.value ?? 0)) / m.shareCapital.value)
      : null;

  // Balance sheet safety metric tailored per sector
  const safetyValue = isFinancial
    ? npl !== null
      ? Math.max(0, 10 - npl) // higher is safer (NPL < 4.5% => > 5.5)
      : car !== null
        ? car
        : m.solvencyRatio.value
    : de;

  const safetyThresholdDisplay = isFinancial
    ? thresholds.maxNplPct !== null
      ? `NPL ≤ ${thresholds.maxNplPct}%${thresholds.minCarPct ? ` · CAR ≥ ${thresholds.minCarPct}%` : ''}`
      : 'Solvency ≥ 1.5x'
    : `Debt/Equity ≤ ${thresholds.maxDebtToEquity ?? 1.2}x`;

  const safetyActualDisplay = isFinancial
    ? npl !== null
      ? `NPL ${npl.toFixed(2)}%${car !== null ? ` · CAR ${car.toFixed(2)}%` : ''}`
      : car !== null
        ? `CAR ${car.toFixed(2)}%`
        : m.solvencyRatio.value !== null
          ? `Solvency ${m.solvencyRatio.value.toFixed(2)}x`
          : 'Unavailable'
    : de !== null
      ? `${de.toFixed(2)}x`
      : 'Unavailable';

  const evalSafety = (val: number) => {
    if (isFinancial) {
      if (npl !== null) {
        const maxNpl = thresholds.maxNplPct ?? 4.5;
        const passed = npl <= maxNpl && (car === null || car >= (thresholds.minCarPct ?? 10));
        const ratio = npl <= 2.0 ? 1 : npl <= maxNpl ? 0.75 : Math.max(0, 1 - (npl - maxNpl) / 4);
        return {
          ratio: passed ? ratio : ratio * 0.65,
          passed,
          explanation: passed
            ? `Asset quality within regulatory band (NPL ${npl.toFixed(2)}% ≤ ${maxNpl}%).`
            : `Elevated credit/capital pressure (NPL ${npl.toFixed(2)}% vs ${maxNpl}% limit).`,
        };
      }
      if (car !== null) {
        const minCar = thresholds.minCarPct ?? 10.5;
        const passed = val >= minCar;
        return {
          ratio: passed ? clip((val - minCar + 2) / 5, 0.7, 1) : clip(val / minCar, 0, 0.6),
          passed,
          explanation: passed
            ? `Capital Adequacy (${val.toFixed(2)}%) exceeds ${minCar}% floor.`
            : `CAR (${val.toFixed(2)}%) below ${minCar}% minimum.`,
        };
      }
      const passed = val >= 1.5;
      return {
        ratio: clip(val / 2, 0, 1),
        passed,
        explanation: passed ? `Solvency ${val.toFixed(2)}x shows strong claims buffer.` : `Solvency ${val.toFixed(2)}x is tight.`,
      };
    }
    const maxDe = thresholds.maxDebtToEquity ?? 1.2;
    const passed = val <= maxDe;
    const ratio = val <= maxDe * 0.5 ? 1 : val <= maxDe ? 0.8 : Math.max(0, 1 - (val - maxDe) / maxDe);
    return {
      ratio,
      passed,
      explanation: passed
        ? `Conservative leverage (${val.toFixed(2)}x ≤ ${maxDe.toFixed(1)}x sector limit).`
        : `Debt-to-Equity (${val.toFixed(2)}x) exceeds ${maxDe.toFixed(1)}x threshold.`,
    };
  };

  // 1. WARREN BUFFETT
  const buffett = buildInvestorResult(
    'buffett',
    'Warren Buffett',
    'Durable Economic Moat, High ROE/ROIC, Owner Earnings & Margin of Safety',
    [
      {
        key: 'moat_roe',
        label: isFinancial ? 'Durable ROE Moat' : 'ROIC / ROE Capital Efficiency',
        weight: 25,
        actualValue: roicOrRoe,
        actualDisplay: fmtPct(roicOrRoe),
        thresholdDisplay: `≥ ${thresholds.minRoePct}% (${thresholds.strongRoePct}% strong)`,
        provenance: roicOrRoeProv,
        unavailableReason: 'ROE/ROIC unavailable from reported statements.',
        evaluate: (v) => {
          const passed = v >= thresholds.minRoePct;
          const ratio = v >= thresholds.strongRoePct ? 1 : v >= thresholds.minRoePct ? 0.75 : clip(v / thresholds.minRoePct, 0, 0.55);
          return {
            ratio,
            passed,
            explanation: passed
              ? `Sustains ${v.toFixed(1)}% return on capital, above ${thresholds.minRoePct}% sector hurdle.`
              : `${v.toFixed(1)}% falls below ${thresholds.minRoePct}% durable moat threshold.`,
          };
        },
      },
      {
        key: 'earnings_predictability',
        label: 'Positive EPS & Earnings Predictability',
        weight: 20,
        actualValue: eps,
        actualDisplay: eps !== null ? `Rs ${eps.toFixed(2)}${epsGrowthBest !== null ? ` (${epsGrowthBest >= 0 ? '+' : ''}${epsGrowthBest.toFixed(1)}%)` : ''}` : 'Unavailable',
        thresholdDisplay: 'EPS > 0 & stable/growing',
        provenance: m.eps.provenance,
        unavailableReason: 'EPS not disclosed.',
        evaluate: (v) => {
          const gOk = epsGrowthBest === null || epsGrowthBest >= -5;
          const passed = v > 0 && gOk;
          const ratio = v <= 0 ? 0 : epsGrowthBest !== null && epsGrowthBest >= 5 ? 1 : gOk ? 0.75 : 0.4;
          return {
            ratio,
            passed,
            explanation: passed
              ? `Positive earning power (EPS Rs ${v.toFixed(2)}) supporting compounding.`
              : `Weak or contracting EPS trajectory (Rs ${v.toFixed(2)}).`,
          };
        },
      },
      {
        key: 'owner_earnings',
        label: isFinancial ? 'Asset Productivity (ROA) & Reserves' : 'Owner Earnings / Cash Conversion',
        weight: 15,
        actualValue: isFinancial ? roa : ocfOrOe,
        actualDisplay: isFinancial ? fmtPct(roa) : fmtCrore(ocfOrOe),
        thresholdDisplay: isFinancial ? `ROA ≥ ${thresholds.minRoicOrRoaPct}%` : 'Positive OCF / FCF',
        provenance: isFinancial ? m.roaPct.provenance : m.operatingCashFlow.provenance,
        unavailableReason: isFinancial ? 'ROA not disclosed.' : 'Cash flow statement not yet disclosed.',
        evaluate: (v) => {
          if (isFinancial) {
            const passed = v >= thresholds.minRoicOrRoaPct;
            return {
              ratio: clip(v / (thresholds.minRoicOrRoaPct * 1.4), 0, 1),
              passed,
              explanation: passed
                ? `ROA ${v.toFixed(2)}% confirms healthy balance-sheet profitability.`
                : `ROA ${v.toFixed(2)}% below ${thresholds.minRoicOrRoaPct}% quality floor.`,
            };
          }
          const passed = v > 0;
          return {
            ratio: passed ? 1 : 0.1,
            passed,
            explanation: passed
              ? `Generates positive cash/owner earnings (${fmtCrore(v)}).`
              : `Negative cash flow (${fmtCrore(v)}) weakens owner earnings.`,
          };
        },
      },
      {
        key: 'balance_sheet',
        label: 'Conservative Leverage / Credit Safety',
        weight: 15,
        actualValue: safetyValue,
        actualDisplay: safetyActualDisplay,
        thresholdDisplay: safetyThresholdDisplay,
        provenance: isFinancial ? m.nplPct.provenance : m.debtToEquity.provenance,
        unavailableReason: 'Leverage / credit quality metrics unavailable.',
        evaluate: evalSafety,
      },
      {
        key: 'margin_of_safety',
        label: 'Intrinsic Value & Margin of Safety',
        weight: 25,
        actualValue: mos,
        actualDisplay: fmtPct(mos),
        thresholdDisplay: 'MoS ≥ 15% (25%+ ideal)',
        provenance: valuation.provenance,
        unavailableReason: 'Insufficient data to compute intrinsic Margin of Safety.',
        evaluate: (v) => {
          const passed = v >= 15;
          const ratio = v >= 30 ? 1 : v >= 15 ? 0.75 + ((v - 15) / 15) * 0.25 : v > 0 ? 0.45 : 0.1;
          return {
            ratio,
            passed,
            explanation: passed
              ? `Trades at ${v.toFixed(1)}% discount to estimated intrinsic value (Rs ${valuation.intrinsicValue}).`
              : v >= 0
                ? `Only ${v.toFixed(1)}% Margin of Safety; narrow discount to intrinsic value.`
                : `Trades ${Math.abs(v).toFixed(1)}% above estimated intrinsic value.`,
          };
        },
      },
    ],
    (score, p, a, cov) =>
      `Buffett quality-value score ${score}/100 (${p}/${a} available checks passed, ${cov}% data coverage). Focuses on durable ROE/ROIC moat, conservative balance sheet, and discount to intrinsic value.`
  );

  // 2. CHARLIE MUNGER
  const munger = buildInvestorResult(
    'munger',
    'Charlie Munger',
    'Wonderful Business Quality, High ROIC, Margins & Rational Capital Allocation',
    [
      {
        key: 'high_roic',
        label: isFinancial ? 'High ROE Quality' : 'High Return on Invested Capital',
        weight: 30,
        actualValue: roicOrRoe,
        actualDisplay: fmtPct(roicOrRoe),
        thresholdDisplay: `≥ ${thresholds.strongRoePct}%`,
        provenance: roicOrRoeProv,
        unavailableReason: 'ROIC/ROE unavailable.',
        evaluate: (v) => {
          const passed = v >= thresholds.minRoePct;
          const ratio = v >= thresholds.strongRoePct ? 1 : v >= thresholds.minRoePct ? 0.72 : clip(v / thresholds.minRoePct, 0, 0.5);
          return {
            ratio,
            passed,
            explanation: passed
              ? `${v.toFixed(1)}% return on capital reflects a superior business model.`
              : `${v.toFixed(1)}% capital return is mediocre relative to cost of equity.`,
          };
        },
      },
      {
        key: 'margins',
        label: 'Sustainable Net Profit Margin',
        weight: 25,
        actualValue: netMargin,
        actualDisplay: fmtPct(netMargin),
        thresholdDisplay: `≥ ${thresholds.minNetMarginPct}%`,
        provenance: m.netProfitMarginPct.provenance,
        unavailableReason: 'Revenue or Net Profit unavailable to derive margin.',
        evaluate: (v) => {
          const passed = v >= thresholds.minNetMarginPct;
          const ratio = v >= thresholds.minNetMarginPct * 1.3 ? 1 : passed ? 0.8 : clip(v / thresholds.minNetMarginPct, 0, 0.5);
          return {
            ratio,
            passed,
            explanation: passed
              ? `Healthy ${v.toFixed(1)}% net margin indicates pricing power and cost discipline.`
              : `Thin ${v.toFixed(1)}% margin leaves little buffer against cost inflation.`,
          };
        },
      },
      {
        key: 'capital_allocation',
        label: 'Reserves & Retained Capital Strength',
        weight: 20,
        actualValue: reservesRatio,
        actualDisplay: reservesRatio !== null ? `${reservesRatio.toFixed(2)}x Share Capital` : 'Unavailable',
        thresholdDisplay: '≥ 0.40x Share Capital',
        provenance: m.reserves.provenance,
        unavailableReason: 'Reserves or Share Capital not disclosed.',
        evaluate: (v) => {
          const passed = v >= 0.4;
          const ratio = v >= 1.0 ? 1 : v >= 0.4 ? 0.75 : clip(v / 0.4, 0, 0.5);
          return {
            ratio,
            passed,
            explanation: passed
              ? `Accumulated reserves (${v.toFixed(2)}x paid-up capital) show disciplined retained compounding.`
              : `Low reserves (${v.toFixed(2)}x capital) limit internal reinvestment buffer.`,
          };
        },
      },
      {
        key: 'low_fragility',
        label: 'Balance Sheet Resilience',
        weight: 15,
        actualValue: safetyValue,
        actualDisplay: safetyActualDisplay,
        thresholdDisplay: safetyThresholdDisplay,
        provenance: isFinancial ? m.nplPct.provenance : m.debtToEquity.provenance,
        unavailableReason: 'Balance sheet safety data unavailable.',
        evaluate: evalSafety,
      },
      {
        key: 'fair_price',
        label: 'Fair Price for Wonderful Business (P/E)',
        weight: 10,
        actualValue: pe,
        actualDisplay: fmtNum(pe, 'x'),
        thresholdDisplay: `≤ ${thresholds.maxPe}x`,
        provenance: m.eps.provenance,
        unavailableReason: 'P/E unavailable.',
        evaluate: (v) => {
          const passed = v > 0 && v <= thresholds.maxPe;
          return {
            ratio: v <= 0 ? 0 : passed ? 1 : clip(thresholds.maxPe / v, 0.2, 0.7),
            passed,
            explanation: passed
              ? `P/E ${v.toFixed(1)}x is reasonable for a high-quality compounder.`
              : `P/E ${v.toFixed(1)}x demands steep perfection.`,
          };
        },
      },
    ],
    (score, p, a, cov) =>
      `Munger business-quality score ${score}/100 (${p}/${a} checks passed, ${cov}% coverage). Emphasizes high ROIC/ROE, strong margins, reserve compounding, and paying a fair price.`
  );

  // 3. BENJAMIN GRAHAM
  const grahamProduct = pe !== null && pb !== null && pe > 0 && pb > 0 ? round2(pe * pb) : null;
  const grahamMaxProd = isFinancial ? 36 : 22.5;
  const graham = buildInvestorResult(
    'graham',
    'Benjamin Graham',
    'Defensive Value, Balance-Sheet Safety, Conservative Multiples & Margin of Safety',
    [
      {
        key: 'earnings_stability',
        label: 'Positive Earnings & Stability',
        weight: 20,
        actualValue: eps,
        actualDisplay: eps !== null ? `Rs ${eps.toFixed(2)}` : 'Unavailable',
        thresholdDisplay: 'EPS > 0',
        provenance: m.eps.provenance,
        unavailableReason: 'EPS unavailable.',
        evaluate: (v) => {
          const passed = v > 0;
          return {
            ratio: passed ? (v >= 15 ? 1 : 0.75) : 0,
            passed,
            explanation: passed ? `Positive EPS (Rs ${v.toFixed(2)}) meets defensive earnings test.` : `Negative/zero EPS fails defensive safety.`,
          };
        },
      },
      {
        key: 'balance_sheet_strength',
        label: isFinancial ? 'Capital Adequacy & NPL Cushion' : 'Current Ratio / Conservative Debt',
        weight: 20,
        actualValue:
          !isFinancial && m.currentAssets.value !== null && m.currentLiabilities.value !== null && m.currentLiabilities.value > 0
            ? round2(m.currentAssets.value / m.currentLiabilities.value)
            : safetyValue,
        actualDisplay:
          !isFinancial && m.currentAssets.value !== null && m.currentLiabilities.value !== null && m.currentLiabilities.value > 0
            ? `Current Ratio ${(m.currentAssets.value / m.currentLiabilities.value).toFixed(2)}x`
            : safetyActualDisplay,
        thresholdDisplay: !isFinancial && m.currentAssets.value !== null ? 'Current Ratio ≥ 1.5x' : safetyThresholdDisplay,
        provenance: isFinancial ? m.carPct.provenance : m.debtToEquity.provenance,
        unavailableReason: 'Balance-sheet solvency metrics unavailable.',
        evaluate: (v) => {
          if (!isFinancial && m.currentAssets.value !== null && m.currentLiabilities.value !== null && m.currentLiabilities.value > 0) {
            const passed = v >= 1.5;
            return {
              ratio: v >= 2.0 ? 1 : passed ? 0.8 : clip(v / 1.5, 0, 0.55),
              passed,
              explanation: passed
                ? `Current Ratio ${v.toFixed(2)}x provides defensive liquidity cushion.`
                : `Current Ratio ${v.toFixed(2)}x below Graham's 1.5x buffer.`,
            };
          }
          return evalSafety(v);
        },
      },
      {
        key: 'conservative_pe',
        label: 'Conservative P/E Valuation',
        weight: 20,
        actualValue: pe,
        actualDisplay: fmtNum(pe, 'x'),
        thresholdDisplay: `≤ ${thresholds.deepValuePe + 3}x`,
        provenance: m.eps.provenance,
        unavailableReason: 'P/E unavailable.',
        evaluate: (v) => {
          const cap = thresholds.deepValuePe + 3;
          const passed = v > 0 && v <= cap;
          const ratio = v <= 0 ? 0 : v <= thresholds.deepValuePe ? 1 : passed ? 0.8 : clip(cap / v, 0, 0.5);
          return {
            ratio,
            passed,
            explanation: passed
              ? `P/E ${v.toFixed(1)}x satisfies conservative defensive multiple (≤ ${cap}x).`
              : `P/E ${v.toFixed(1)}x exceeds defensive value limit.`,
          };
        },
      },
      {
        key: 'graham_pb_ncav',
        label: 'Graham Number (P/E × P/B) & NCAV Support',
        weight: 20,
        actualValue: grahamProduct,
        actualDisplay:
          grahamProduct !== null
            ? `${grahamProduct.toFixed(1)} (P/B ${pb?.toFixed(2)}x)${valuation.ncavPerShare !== null ? ` · NCAV Rs ${valuation.ncavPerShare}` : ''}`
            : 'Unavailable',
        thresholdDisplay: `P/E × P/B ≤ ${grahamMaxProd}`,
        provenance: 'Calculated',
        unavailableReason: 'Both P/E and P/B required for Graham multiplier.',
        evaluate: (v) => {
          const ncavDiscount =
            valuation.ncavPerShare !== null && market.ltp !== null && valuation.ncavPerShare > market.ltp;
          const passed = v <= grahamMaxProd || ncavDiscount;
          const ratio = ncavDiscount ? 1 : v <= grahamMaxProd ? 1 : clip(grahamMaxProd / v, 0.1, 0.65);
          return {
            ratio,
            passed,
            explanation: passed
              ? `P/E × P/B = ${v.toFixed(1)} within ${grahamMaxProd} defensive ceiling.`
              : `P/E × P/B = ${v.toFixed(1)} exceeds ${grahamMaxProd} defensive value band.`,
          };
        },
      },
      {
        key: 'graham_mos',
        label: 'Margin of Safety (Intrinsic Discount)',
        weight: 20,
        actualValue: mos,
        actualDisplay: fmtPct(mos),
        thresholdDisplay: '≥ 20% Margin of Safety',
        provenance: valuation.provenance,
        unavailableReason: 'Intrinsic value unavailable.',
        evaluate: (v) => {
          const passed = v >= 20;
          return {
            ratio: v >= 33 ? 1 : v >= 20 ? 0.8 : v > 0 ? 0.4 : 0,
            passed,
            explanation: passed
              ? `${v.toFixed(1)}% Margin of Safety offers Graham downside cushion.`
              : `Insufficient Margin of Safety (${v.toFixed(1)}%) for defensive entry.`,
          };
        },
      },
    ],
    (score, p, a, cov) =>
      `Graham defensive-value score ${score}/100 (${p}/${a} checks passed, ${cov}% coverage). Enforces conservative P/E × P/B, solvency cushion, and Margin of Safety.`
  );

  // 4. PETER LYNCH
  const lynch = buildInvestorResult(
    'lynch',
    'Peter Lynch',
    'GARP (Growth at a Reasonable Price), PEG Ratio & Earnings Expansion',
    [
      {
        key: 'peg_ratio',
        label: 'PEG Ratio (P/E ÷ EPS Growth)',
        weight: 30,
        actualValue: peg,
        actualDisplay: peg !== null ? `${peg.toFixed(2)}x` : 'Unavailable',
        thresholdDisplay: '≤ 1.25x (≤ 1.0 ideal)',
        provenance: 'Calculated',
        unavailableReason: 'Requires positive P/E and historical YoY/3Y EPS growth rate.',
        evaluate: (v) => {
          const passed = v > 0 && v <= 1.25;
          const ratio = v <= 0 ? 0 : v <= 0.85 ? 1 : v <= 1.25 ? 0.82 : clip(1.25 / v, 0.1, 0.55);
          return {
            ratio,
            passed,
            explanation: passed
              ? `PEG of ${v.toFixed(2)}x signals attractive GARP pricing.`
              : `PEG of ${v.toFixed(2)}x suggests growth is already priced in.`,
          };
        },
      },
      {
        key: 'growth_consistency',
        label: 'Earnings Growth Rate (YoY / 3Y CAGR)',
        weight: 25,
        actualValue: epsGrowthBest,
        actualDisplay: fmtPct(epsGrowthBest),
        thresholdDisplay: '10% – 35% sustainable growth',
        provenance: 'Calculated',
        unavailableReason: 'Multi-period EPS history needed for growth rate.',
        evaluate: (v) => {
          const passed = v >= 10;
          const ratio = v >= 15 && v <= 40 ? 1 : v >= 10 ? 0.8 : v > 0 ? 0.45 : 0;
          return {
            ratio,
            passed,
            explanation: passed
              ? `EPS growing at ${v.toFixed(1)}%, matching Lynch stalwart/fast-grower pace.`
              : `EPS growth (${v.toFixed(1)}%) below 10% GARP threshold.`,
          };
        },
      },
      {
        key: 'reasonable_pe',
        label: 'Reasonable P/E Band',
        weight: 20,
        actualValue: pe,
        actualDisplay: fmtNum(pe, 'x'),
        thresholdDisplay: `≤ ${thresholds.maxPe}x`,
        provenance: m.eps.provenance,
        unavailableReason: 'P/E unavailable.',
        evaluate: (v) => {
          const passed = v > 0 && v <= thresholds.maxPe;
          return {
            ratio: v <= 0 ? 0 : v <= thresholds.deepValuePe + 4 ? 1 : passed ? 0.78 : clip(thresholds.maxPe / v, 0.15, 0.55),
            passed,
            explanation: passed
              ? `P/E ${v.toFixed(1)}x avoids overpaying for growth.`
              : `P/E ${v.toFixed(1)}x is stretched for GARP.`,
          };
        },
      },
      {
        key: 'debt_check',
        label: 'Manageable Debt / Asset Quality',
        weight: 15,
        actualValue: safetyValue,
        actualDisplay: safetyActualDisplay,
        thresholdDisplay: safetyThresholdDisplay,
        provenance: isFinancial ? m.nplPct.provenance : m.debtToEquity.provenance,
        unavailableReason: 'Leverage / credit metrics unavailable.',
        evaluate: evalSafety,
      },
      {
        key: 'net_margin',
        label: 'Operating Margin Support',
        weight: 10,
        actualValue: netMargin,
        actualDisplay: fmtPct(netMargin),
        thresholdDisplay: `≥ ${thresholds.minNetMarginPct}%`,
        provenance: m.netProfitMarginPct.provenance,
        unavailableReason: 'Profit margin unavailable.',
        evaluate: (v) => {
          const passed = v >= thresholds.minNetMarginPct;
          return {
            ratio: passed ? 1 : clip(v / thresholds.minNetMarginPct, 0, 0.6),
            passed,
            explanation: passed ? `Net margin ${v.toFixed(1)}% supports earnings scalability.` : `Sub-threshold net margin (${v.toFixed(1)}%).`,
          };
        },
      },
    ],
    (score, p, a, cov) =>
      `Lynch GARP score ${score}/100 (${p}/${a} checks passed, ${cov}% coverage). Evaluates PEG ratio, EPS growth momentum, reasonable multiples, and balance-sheet discipline.`
  );

  // 5. HOWARD MARKS
  const yieldSpreadOverFd =
    valuation.earningsYieldPct !== null
      ? round2(valuation.earningsYieldPct - benchmarkFdRatePct)
      : null;

  const marks = buildInvestorResult(
    'marks',
    'Howard Marks',
    'Second-Level Risk Control, Cycle Position, Downside Protection & Risk-Adjusted Return',
    [
      {
        key: 'downside_mos',
        label: 'Downside Protection (Margin of Safety)',
        weight: 25,
        actualValue: mos,
        actualDisplay: fmtPct(mos),
        thresholdDisplay: '≥ 15% Margin of Safety',
        provenance: valuation.provenance,
        unavailableReason: 'Intrinsic valuation unavailable.',
        evaluate: (v) => {
          const passed = v >= 15;
          return {
            ratio: v >= 28 ? 1 : v >= 15 ? 0.8 : v > 0 ? 0.45 : 0.1,
            passed,
            explanation: passed
              ? `${v.toFixed(1)}% discount to intrinsic value provides asymmetric downside protection.`
              : `Thin or negative Margin of Safety (${v.toFixed(1)}%) increases price risk.`,
          };
        },
      },
      {
        key: 'balance_sheet_risk',
        label: 'Leverage & Credit Cycle Fragility',
        weight: 25,
        actualValue: safetyValue,
        actualDisplay: safetyActualDisplay,
        thresholdDisplay: safetyThresholdDisplay,
        provenance: isFinancial ? m.nplPct.provenance : m.debtToEquity.provenance,
        unavailableReason: 'Leverage / credit quality unavailable.',
        evaluate: evalSafety,
      },
      {
        key: 'price_vs_cycle',
        label: 'Price Cycle Risk (vs. 52-Week High & MA120)',
        weight: 20,
        actualValue: market.gap52hPct,
        actualDisplay:
          market.gap52hPct !== null
            ? `${market.gap52hPct.toFixed(1)}% vs 52W High${market.vsD120Pct !== null ? ` · ${market.vsD120Pct >= 0 ? '+' : ''}${market.vsD120Pct.toFixed(1)}% vs MA120` : ''}`
            : 'Unavailable',
        thresholdDisplay: 'Not overextended near cycle euphoria',
        provenance: 'Reported',
        unavailableReason: '52-week price range unavailable from market store.',
        evaluate: (gap) => {
          // Howard Marks favors buying away from euphoric peaks when fundamentals hold
          const absGap = Math.abs(gap);
          const passed = absGap >= 10 && absGap <= 45;
          const ratio = absGap >= 15 && absGap <= 40 ? 1 : absGap >= 5 ? 0.75 : 0.45;
          return {
            ratio,
            passed,
            explanation: passed
              ? `Trading ${absGap.toFixed(1)}% below 52W high avoids peak-cycle euphoria.`
              : absGap < 10
                ? `Near 52W high (${absGap.toFixed(1)}% off); heightened price-cycle sensitivity.`
                : `Deeply depressed (${absGap.toFixed(1)}% off peak); verify business risk vs price risk.`,
          };
        },
      },
      {
        key: 'business_risk',
        label: 'Business Resilience (Profitability & Margin)',
        weight: 15,
        actualValue: roe,
        actualDisplay: fmtPct(roe),
        thresholdDisplay: `ROE ≥ ${thresholds.minRoePct}%`,
        provenance: m.roePct.provenance,
        unavailableReason: 'ROE unavailable.',
        evaluate: (v) => {
          const passed = v >= thresholds.minRoePct;
          return {
            ratio: v >= thresholds.strongRoePct ? 1 : passed ? 0.78 : clip(v / thresholds.minRoePct, 0, 0.5),
            passed,
            explanation: passed
              ? `Business ROE (${v.toFixed(1)}%) separates healthy fundamentals from temporary price swings.`
              : `Sub-par ROE (${v.toFixed(1)}%) signals fundamental business risk.`,
          };
        },
      },
      {
        key: 'risk_adjusted_yield',
        label: 'Earnings Yield Spread vs. Nepal Bank FD',
        weight: 15,
        actualValue: yieldSpreadOverFd,
        actualDisplay:
          yieldSpreadOverFd !== null
            ? `${yieldSpreadOverFd >= 0 ? '+' : ''}${yieldSpreadOverFd.toFixed(2)}% vs ${benchmarkFdRatePct.toFixed(1)}% FD`
            : 'Unavailable',
        thresholdDisplay: 'Earnings Yield > Bank FD Rate',
        provenance: 'Calculated',
        unavailableReason: 'Earnings yield unavailable.',
        evaluate: (spread) => {
          const passed = spread > 0;
          const ratio = spread >= 2.5 ? 1 : spread > 0 ? 0.75 : clip((spread + 3) / 3, 0, 0.4);
          return {
            ratio,
            passed,
            explanation: passed
              ? `Earnings yield compensates +${spread.toFixed(2)}% above Nepal Bank FD benchmark.`
              : `Earnings yield trails ${benchmarkFdRatePct.toFixed(1)}% fixed-deposit alternative.`,
          };
        },
      },
    ],
    (score, p, a, cov) =>
      `Howard Marks risk-control score ${score}/100 (${p}/${a} checks passed, ${cov}% coverage). Separates fundamental business risk from cycle price risk and tests yield vs Nepal FD rates.`
  );

  // 6. PHILIP FISHER
  const fisher = buildInvestorResult(
    'fisher',
    'Philip Fisher',
    'Scuttlebutt Long-Term Revenue/EPS Compounding, Margins & Reinvestment',
    [
      {
        key: 'sales_growth',
        label: 'Long-Term Revenue Growth (YoY / 3Y CAGR)',
        weight: 30,
        actualValue: revGrowthBest,
        actualDisplay: fmtPct(revGrowthBest),
        thresholdDisplay: '≥ 10% revenue growth',
        provenance: 'Calculated',
        unavailableReason: 'Multi-period revenue history unavailable for growth check.',
        evaluate: (v) => {
          const passed = v >= 10;
          const ratio = v >= 18 ? 1 : passed ? 0.78 : v > 0 ? 0.45 : 0;
          return {
            ratio,
            passed,
            explanation: passed
              ? `Revenue expanding at ${v.toFixed(1)}%, showing market demand and scale.`
              : `Revenue growth (${v.toFixed(1)}%) below Fisher's 10% expansion threshold.`,
          };
        },
      },
      {
        key: 'eps_growth',
        label: 'Profit & EPS Compounding',
        weight: 25,
        actualValue: epsGrowthBest,
        actualDisplay: fmtPct(epsGrowthBest),
        thresholdDisplay: '≥ 12% EPS growth',
        provenance: 'Calculated',
        unavailableReason: 'Multi-period EPS history unavailable.',
        evaluate: (v) => {
          const passed = v >= 12;
          const ratio = v >= 20 ? 1 : passed ? 0.8 : v > 0 ? 0.45 : 0;
          return {
            ratio,
            passed,
            explanation: passed
              ? `EPS compounding at ${v.toFixed(1)}% translates top-line growth to shareholders.`
              : `EPS growth (${v.toFixed(1)}%) trails Fisher compounding target.`,
          };
        },
      },
      {
        key: 'margin_strength',
        label: 'Profit Margin Quality',
        weight: 20,
        actualValue: netMargin,
        actualDisplay: fmtPct(netMargin),
        thresholdDisplay: `≥ ${thresholds.minNetMarginPct}%`,
        provenance: m.netProfitMarginPct.provenance,
        unavailableReason: 'Net Profit Margin unavailable.',
        evaluate: (v) => {
          const passed = v >= thresholds.minNetMarginPct;
          return {
            ratio: v >= thresholds.minNetMarginPct * 1.25 ? 1 : passed ? 0.78 : clip(v / thresholds.minNetMarginPct, 0, 0.5),
            passed,
            explanation: passed
              ? `Durable ${v.toFixed(1)}% margin reflects competitive positioning.`
              : `Margin (${v.toFixed(1)}%) lacks wide profitability buffer.`,
          };
        },
      },
      {
        key: 'reinvestment_roe',
        label: 'Reinvestment Efficiency (ROE / ROIC)',
        weight: 15,
        actualValue: roicOrRoe,
        actualDisplay: fmtPct(roicOrRoe),
        thresholdDisplay: `≥ ${thresholds.minRoePct}%`,
        provenance: roicOrRoeProv,
        unavailableReason: 'ROE/ROIC unavailable.',
        evaluate: (v) => {
          const passed = v >= thresholds.minRoePct;
          return {
            ratio: v >= thresholds.strongRoePct ? 1 : passed ? 0.78 : clip(v / thresholds.minRoePct, 0, 0.5),
            passed,
            explanation: passed
              ? `High ${v.toFixed(1)}% return ensures retained capital compounds effectively.`
              : `Low ${v.toFixed(1)}% capital efficiency limits internal compounding.`,
          };
        },
      },
      {
        key: 'reserves_buffer',
        label: 'Balance Sheet Expansion Capacity (Reserves)',
        weight: 10,
        actualValue: reservesRatio,
        actualDisplay: reservesRatio !== null ? `${reservesRatio.toFixed(2)}x Capital` : 'Unavailable',
        thresholdDisplay: '≥ 0.35x Share Capital',
        provenance: m.reserves.provenance,
        unavailableReason: 'Reserves unavailable.',
        evaluate: (v) => {
          const passed = v >= 0.35;
          return {
            ratio: v >= 0.8 ? 1 : passed ? 0.8 : clip(v / 0.35, 0, 0.5),
            passed,
            explanation: passed ? `Reserves (${v.toFixed(2)}x capital) fund organic growth without dilution.` : `Modest reserve buffer (${v.toFixed(2)}x).`,
          };
        },
      },
    ],
    (score, p, a, cov) =>
      `Fisher growth-quality score ${score}/100 (${p}/${a} checks passed, ${cov}% coverage). Measures multi-period revenue/EPS expansion, margin durability, and reinvestment return.`
  );

  // 7. JOEL GREENBLATT (Magic Formula: Earnings Yield + ROIC/ROE cross-sectional ranks)
  const greenblatt = buildInvestorResult(
    'greenblatt',
    'Joel Greenblatt',
    'Magic Formula: High Earnings Yield (EBIT/EV) + High Return on Capital (ROIC)',
    [
      {
        key: 'magic_earnings_yield',
        label: `Earnings Yield (${valuation.earningsYieldBasis.split(' ')[0]})`,
        weight: 50,
        actualValue: ey,
        actualDisplay:
          ey !== null
            ? `${ey.toFixed(2)}%${greenblattPreRank.eyRank ? ` (Rank #${greenblattPreRank.eyRank}/${greenblattPreRank.total})` : ''}`
            : 'Unavailable',
        thresholdDisplay: `> ${(benchmarkFdRatePct + 1).toFixed(1)}% & Top Half Magic Rank`,
        provenance: 'Calculated',
        unavailableReason: 'Earnings yield requires positive EBIT/EV or EPS/Price.',
        evaluate: (v) => {
          const pctScore = greenblattPreRank.eyScore ?? clip((v / 12) * 100, 0, 100);
          const passed = v > benchmarkFdRatePct && pctScore >= 50;
          return {
            ratio: clip(pctScore / 100, 0, 1),
            passed,
            explanation: `Earnings Yield ${v.toFixed(2)}% (${valuation.earningsYieldBasis})${greenblattPreRank.eyRank ? ` ranks #${greenblattPreRank.eyRank} of ${greenblattPreRank.total} evaluated companies` : ''}.`,
          };
        },
      },
      {
        key: 'magic_roic',
        label: isFinancial ? 'Sector-Adjusted Return on Equity (ROE)' : 'Return on Invested Capital (ROIC)',
        weight: 50,
        actualValue: roicOrRoe,
        actualDisplay:
          roicOrRoe !== null
            ? `${roicOrRoe.toFixed(2)}%${greenblattPreRank.roicRank ? ` (Rank #${greenblattPreRank.roicRank}/${greenblattPreRank.total})` : ''}`
            : 'Unavailable',
        thresholdDisplay: `≥ ${thresholds.minRoePct}% & Top Half Magic Rank`,
        provenance: roicOrRoeProv,
        unavailableReason: 'ROIC/ROE unavailable.',
        evaluate: (v) => {
          const pctScore = greenblattPreRank.roicScore ?? clip((v / thresholds.strongRoePct) * 100, 0, 100);
          const passed = v >= thresholds.minRoePct && pctScore >= 50;
          return {
            ratio: clip(pctScore / 100, 0, 1),
            passed,
            explanation: `${isFinancial ? 'ROE' : 'ROIC'} of ${v.toFixed(2)}%${greenblattPreRank.roicRank ? ` ranks #${greenblattPreRank.roicRank} of ${greenblattPreRank.total} companies` : ''}.`,
          };
        },
      },
    ],
    (score, p, a, cov) =>
      `Greenblatt Magic Formula score ${score}/100 (${p}/${a} factors top-ranked, ${cov}% coverage). Combines independent Earnings Yield and ROIC/ROE universe ranks.`
  );

  // 8. JOHN TEMPLETON
  const templeton = buildInvestorResult(
    'templeton',
    'John Templeton',
    'Contrarian Deep Value at Point of Maximum Pessimism Without Value Traps',
    [
      {
        key: 'contrarian_pe',
        label: 'Deep-Value P/E Multiple',
        weight: 30,
        actualValue: pe,
        actualDisplay: fmtNum(pe, 'x'),
        thresholdDisplay: `≤ ${thresholds.deepValuePe + 2}x`,
        provenance: m.eps.provenance,
        unavailableReason: 'P/E unavailable.',
        evaluate: (v) => {
          const cap = thresholds.deepValuePe + 2;
          const passed = v > 0 && v <= cap;
          const ratio = v <= 0 ? 0 : v <= thresholds.deepValuePe ? 1 : passed ? 0.8 : clip(cap / v, 0.1, 0.55);
          return {
            ratio,
            passed,
            explanation: passed
              ? `Bargain P/E (${v.toFixed(1)}x) reflects market pessimism vs earnings.`
              : `P/E (${v.toFixed(1)}x) is not at contrarian bargain levels.`,
          };
        },
      },
      {
        key: 'pessimism_pullback',
        label: 'Market Pessimism / Drawdown from 52W High',
        weight: 20,
        actualValue: market.gap52hPct !== null ? Math.abs(market.gap52hPct) : null,
        actualDisplay: market.gap52hPct !== null ? `${market.gap52hPct.toFixed(1)}% vs 52W High` : 'Unavailable',
        thresholdDisplay: '≥ 15% below 52W High',
        provenance: 'Reported',
        unavailableReason: '52-week price data unavailable.',
        evaluate: (drop) => {
          const passed = drop >= 15;
          const ratio = drop >= 25 ? 1 : drop >= 15 ? 0.8 : clip(drop / 15, 0.2, 0.6);
          return {
            ratio,
            passed,
            explanation: passed
              ? `Down ${drop.toFixed(1)}% from 52W high — classic contrarian sentiment discount.`
              : `Only ${drop.toFixed(1)}% off 52W high; limited contrarian pessimism.`,
          };
        },
      },
      {
        key: 'value_trap_filter',
        label: 'Value-Trap Avoidance (Solvency & Asset Quality)',
        weight: 25,
        actualValue: safetyValue,
        actualDisplay: safetyActualDisplay,
        thresholdDisplay: safetyThresholdDisplay,
        provenance: isFinancial ? m.nplPct.provenance : m.debtToEquity.provenance,
        unavailableReason: 'Balance-sheet survival metrics unavailable.',
        evaluate: evalSafety,
      },
      {
        key: 'recovery_earning_power',
        label: 'Normalized Earning Power & P/B Discount',
        weight: 25,
        actualValue: pb,
        actualDisplay: pb !== null ? `P/B ${pb.toFixed(2)}x · ROE ${roe !== null ? `${roe.toFixed(1)}%` : 'N/A'}` : 'Unavailable',
        thresholdDisplay: `P/B ≤ ${thresholds.deepValuePb + 0.4}x & ROE > 8%`,
        provenance: m.bvps.provenance,
        unavailableReason: 'P/B unavailable.',
        evaluate: (v) => {
          const cap = thresholds.deepValuePb + 0.4;
          const roeOk = roe === null || roe >= 8;
          const passed = v > 0 && v <= cap && roeOk;
          const ratio = !roeOk ? 0.3 : v <= thresholds.deepValuePb ? 1 : v <= cap ? 0.8 : clip(cap / v, 0.15, 0.55);
          return {
            ratio,
            passed,
            explanation: passed
              ? `P/B ${v.toFixed(2)}x with intact ROE confirms genuine value rather than structural decay.`
              : `Elevated P/B (${v.toFixed(2)}x) or weak ROE reduces contrarian recovery upside.`,
          };
        },
      },
    ],
    (score, p, a, cov) =>
      `Templeton contrarian score ${score}/100 (${p}/${a} checks passed, ${cov}% coverage). Hunts deep-value discounts amid 52-week pessimism while filtering out distressed value traps.`
  );

  // 9. MOHNISH PABRAI (Dhandho)
  const pabrai = buildInvestorResult(
    'pabrai',
    'Mohnish Pabrai',
    'Dhandho Framework: Heads I Win, Tails I Don’t Lose Much — Asymmetric Risk/Reward',
    [
      {
        key: 'dhandho_mos',
        label: 'Asymmetric Margin of Safety',
        weight: 30,
        actualValue: mos,
        actualDisplay: fmtPct(mos),
        thresholdDisplay: '≥ 25% Margin of Safety',
        provenance: valuation.provenance,
        unavailableReason: 'Intrinsic valuation unavailable.',
        evaluate: (v) => {
          const passed = v >= 25;
          const ratio = v >= 35 ? 1 : v >= 25 ? 0.82 : v >= 10 ? 0.48 : 0.1;
          return {
            ratio,
            passed,
            explanation: passed
              ? `Dhandho asymmetry: ${v.toFixed(1)}% discount to intrinsic value.`
              : `Margin of Safety (${v.toFixed(1)}%) below 25% Dhandho requirement.`,
          };
        },
      },
      {
        key: 'capital_preservation',
        label: 'Downside Capital Preservation (Low Debt / NPL)',
        weight: 25,
        actualValue: safetyValue,
        actualDisplay: safetyActualDisplay,
        thresholdDisplay: safetyThresholdDisplay,
        provenance: isFinancial ? m.nplPct.provenance : m.debtToEquity.provenance,
        unavailableReason: 'Downside balance-sheet risk metrics unavailable.',
        evaluate: evalSafety,
      },
      {
        key: 'predictable_cash_engine',
        label: 'Simple, Predictable ROE & Cash Generation',
        weight: 25,
        actualValue: roicOrRoe,
        actualDisplay: fmtPct(roicOrRoe),
        thresholdDisplay: `≥ ${thresholds.minRoePct}%`,
        provenance: roicOrRoeProv,
        unavailableReason: 'ROE/ROIC unavailable.',
        evaluate: (v) => {
          const passed = v >= thresholds.minRoePct;
          return {
            ratio: v >= thresholds.strongRoePct ? 1 : passed ? 0.8 : clip(v / thresholds.minRoePct, 0, 0.5),
            passed,
            explanation: passed
              ? `Consistent ${v.toFixed(1)}% return on capital indicates a durable core franchise.`
              : `Return on capital (${v.toFixed(1)}%) lacks Dhandho compounding punch.`,
          };
        },
      },
      {
        key: 'low_valuation_entry',
        label: 'Low Multiple / Earnings Yield Entry',
        weight: 20,
        actualValue: ey,
        actualDisplay: fmtPct(ey),
        thresholdDisplay: `Earnings Yield ≥ ${(benchmarkFdRatePct + 2).toFixed(1)}%`,
        provenance: 'Calculated',
        unavailableReason: 'Earnings yield unavailable.',
        evaluate: (v) => {
          const target = benchmarkFdRatePct + 2;
          const passed = v >= target;
          return {
            ratio: v >= target + 3 ? 1 : passed ? 0.82 : clip(v / target, 0.1, 0.6),
            passed,
            explanation: passed
              ? `${v.toFixed(2)}% earnings yield clears ${target.toFixed(1)}% hurdle for low-risk entry.`
              : `${v.toFixed(2)}% earnings yield offers thin valuation cushion.`,
          };
        },
      },
    ],
    (score, p, a, cov) =>
      `Pabrai Dhandho score ${score}/100 (${p}/${a} checks passed, ${cov}% coverage). Prioritizes asymmetric Margin of Safety, low downside fragility, and high earnings yield.`
  );

  return {
    buffett,
    munger,
    graham,
    lynch,
    marks,
    fisher,
    greenblatt,
    templeton,
    pabrai,
  };
}

function computeCompositeScores(
  inv: Record<InvestorId, InvestorScoreResult>,
  valuation: ValuationBreakdown
): CompositeScores {
  const fundamentalQualityScore = round1(
    inv.buffett.score * 0.35 + inv.munger.score * 0.35 + inv.fisher.score * 0.30
  );
  const valueScore = round1(
    inv.graham.score * 0.35 +
      inv.greenblatt.score * 0.30 +
      inv.templeton.score * 0.20 +
      inv.pabrai.score * 0.15
  );
  const growthScore = round1(inv.fisher.score * 0.55 + inv.lynch.score * 0.45);
  const riskManagementScore = round1(
    inv.marks.score * 0.50 + inv.graham.score * 0.25 + inv.pabrai.score * 0.25
  );
  const mosBonus =
    valuation.marginOfSafetyPct !== null
      ? clip((valuation.marginOfSafetyPct + 15) * 1.6, 0, 100)
      : valueScore;
  const valuationAttractivenessScore = round1(
    valueScore * 0.65 + mosBonus * 0.35
  );
  const longTermCompoundingScore = round1(
    inv.buffett.score * 0.35 +
      inv.munger.score * 0.30 +
      inv.fisher.score * 0.20 +
      inv.lynch.score * 0.15
  );
  const overallScore = round1(
    fundamentalQualityScore * 0.30 +
      valuationAttractivenessScore * 0.25 +
      riskManagementScore * 0.25 +
      growthScore * 0.20
  );

  return {
    fundamentalQualityScore,
    valueScore,
    growthScore,
    riskManagementScore,
    valuationAttractivenessScore,
    longTermCompoundingScore,
    overallScore,
  };
}

function buildConsensusMatches(inv: Record<InvestorId, InvestorScoreResult>): ConsensusMatch[] {
  const pair = (
    id: ConsensusTag,
    label: string,
    theme: string,
    a: InvestorScoreResult,
    b: InvestorScoreResult,
    reasonIfPass: string
  ): ConsensusMatch => {
    const combinedScore = round1((a.score + b.score) / 2);
    const qualified = a.qualified && b.qualified;
    return {
      id,
      label,
      theme,
      investors: [a.investorName, b.investorName],
      combinedScore,
      qualified,
      reason: qualified
        ? reasonIfPass
        : `Requires both ${a.investorName} (${a.score}) and ${b.investorName} (${b.score}) to score ≥ 62 with ≥ 50% data coverage.`,
    };
  };

  return [
    pair(
      'buffett_munger',
      'Buffett + Munger',
      'Quality Compounders',
      inv.buffett,
      inv.munger,
      'Combines durable ROE/ROIC moat, high net margins, and rational reserve compounding at a disciplined price.'
    ),
    pair(
      'graham_marks',
      'Graham + Howard Marks',
      'Defensive Value Opportunities',
      inv.graham,
      inv.marks,
      'Pairs balance-sheet solvency and conservative multiples with cycle-aware downside risk protection.'
    ),
    pair(
      'lynch_fisher',
      'Lynch + Fisher',
      'Sustainable Growth',
      inv.lynch,
      inv.fisher,
      'Delivers multi-period revenue/EPS expansion at an attractive GARP PEG valuation.'
    ),
    pair(
      'greenblatt_graham',
      'Greenblatt + Graham',
      'Valuation & Capital Efficiency',
      inv.greenblatt,
      inv.graham,
      'High Magic Formula Earnings Yield and ROIC/ROE backed by defensive balance-sheet metrics.'
    ),
    pair(
      'buffett_pabrai',
      'Buffett + Pabrai',
      'Quality with Downside Protection',
      inv.buffett,
      inv.pabrai,
      'High-quality capital-efficient franchise trading with asymmetric Dhandho Margin of Safety.'
    ),
    pair(
      'marks_templeton',
      'Howard Marks + Templeton',
      'Contrarian Risk/Reward',
      inv.marks,
      inv.templeton,
      'Deep contrarian valuation discount with cycle downside checks to avoid value traps.'
    ),
  ];
}

function buildRecommendation(params: {
  record: QuarterlyStatementRecord | null;
  valuation: ValuationBreakdown | null;
  scores: CompositeScores;
  inv: Record<InvestorId, InvestorScoreResult>;
  consensus: ConsensusMatch[];
  market: MarketOverlay;
}): StockRecommendationExplanation {
  const { record, valuation, scores, inv, consensus, market } = params;
  if (!record || !valuation) {
    return {
      verdict: 'INSUFFICIENT DATA',
      whyQualifies: 'Quarterly or annual financial statements have not been collected yet for this security.',
      passedPhilosophies: [],
      supportingMetrics: [],
      strengths: [],
      weaknesses: [],
      downsideRisks: ['No verified financial disclosure loaded in the Fundamental Vault.'],
      missingOrUnverified: ['Balance Sheet, Profit & Loss, and Key Ratios pending collection.'],
    };
  }

  const passedList = Object.values(inv).filter((x) => x.qualified);
  const passedNames = passedList.map((x) => `${x.investorName} (${x.score}/100)`);
  const passedConsensus = consensus.filter((c) => c.qualified).map((c) => `${c.label} (${c.theme})`);

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const res of Object.values(inv)) {
    for (const c of res.criteria) {
      if (c.status === 'passed' && c.earnedPoints >= c.weight * 0.8 && strengths.length < 6) {
        if (!strengths.some((s) => s.includes(c.label))) {
          strengths.push(`${c.label}: ${c.explanation}`);
        }
      } else if (c.status === 'failed' && weaknesses.length < 6) {
        if (!weaknesses.some((w) => w.includes(c.label))) {
          weaknesses.push(`${c.label}: ${c.explanation}`);
        }
      }
    }
  }

  const m = record.metrics;
  const supportingMetrics: string[] = [];
  if (m.eps.value !== null) supportingMetrics.push(`EPS Rs ${m.eps.value.toFixed(2)} (${m.eps.provenance})`);
  if (m.roePct.value !== null) supportingMetrics.push(`ROE ${m.roePct.value.toFixed(2)}% (${m.roePct.provenance})`);
  if (m.roicPct.value !== null) supportingMetrics.push(`ROIC ${m.roicPct.value.toFixed(2)}% (${m.roicPct.provenance})`);
  if (valuation.livePe !== null) supportingMetrics.push(`P/E ${valuation.livePe.toFixed(2)}x`);
  if (valuation.livePb !== null) supportingMetrics.push(`P/B ${valuation.livePb.toFixed(2)}x`);
  if (valuation.marginOfSafetyPct !== null) {
    supportingMetrics.push(
      `Intrinsic Est. Rs ${valuation.intrinsicValue?.toFixed(1)} (MoS ${valuation.marginOfSafetyPct.toFixed(1)}%)`
    );
  }
  if (m.nplPct.value !== null) supportingMetrics.push(`NPL ${m.nplPct.value.toFixed(2)}%`);
  if (m.carPct.value !== null) supportingMetrics.push(`CAR ${m.carPct.value.toFixed(2)}%`);
  if (m.debtToEquity.value !== null) supportingMetrics.push(`D/E ${m.debtToEquity.value.toFixed(2)}x`);

  const downsideRisks: string[] = [...weaknesses.slice(0, 3)];
  if (record.dataQualityFlags.includes('inconsistent')) {
    downsideRisks.unshift('Accounting consistency discrepancy flagged between Balance Sheet totals.');
  }
  if (record.dataQualityFlags.includes('outdated')) {
    downsideRisks.push('Financial statement is outdated (>150 days since collection); verify newer quarterly filings.');
  }
  if (market.liquidityTier === 'Low') {
    downsideRisks.push('Low secondary-market liquidity increases execution slippage risk.');
  }
  if (downsideRisks.length === 0) {
    downsideRisks.push('Monitor upcoming quarterly margin stability and NRB/SEBON regulatory directives.');
  }

  const missingOrUnverified: string[] = [
    ...record.validationNotes.filter((n) => n.toLowerCase().includes('not') || n.toLowerCase().includes('only') || n.toLowerCase().includes('mismatch')),
    ...valuation.limitations,
  ];

  let verdict: RecommendationVerdict = 'WATCHLIST';
  const avgCoverage =
    Object.values(inv).reduce((s, r) => s + r.dataCoveragePct, 0) / 9;

  if (avgCoverage < 40) {
    verdict = 'INSUFFICIENT DATA';
  } else if (
    scores.overallScore >= 72 &&
    passedList.length >= 5 &&
    (valuation.marginOfSafetyPct ?? 0) >= 15 &&
    scores.riskManagementScore >= 60
  ) {
    verdict = 'STRONG BUY';
  } else if (scores.overallScore >= 64 && passedList.length >= 3 && scores.riskManagementScore >= 52) {
    verdict = 'BUY';
  } else if (scores.fundamentalQualityScore >= 62 && scores.overallScore >= 54) {
    verdict = 'ACCUMULATE';
  } else if (scores.riskManagementScore < 42 || scores.overallScore < 40) {
    verdict = 'AVOID';
  } else if (scores.overallScore >= 48) {
    verdict = 'HOLD';
  }

  const whyQualifies =
    passedList.length > 0
      ? `Scores ${scores.overallScore}/100 overall and passes ${passedList.length}/9 investor models (${passedConsensus.length > 0 ? `Consensus: ${passedConsensus.join(', ')}` : passedNames.slice(0, 3).join(', ')}). Fundamental Quality (${scores.fundamentalQualityScore}/100) and Valuation Attractiveness (${scores.valuationAttractivenessScore}/100) are anchored in ${record.periodLabel} disclosures.`
      : `Scores ${scores.overallScore}/100 overall with ${passedList.length}/9 investor models passing qualification thresholds on ${record.periodLabel} disclosures. ${weaknesses[0] || 'Limited valuation discount or missing multi-year history constrains conviction.'}`;

  return {
    verdict,
    whyQualifies,
    passedPhilosophies: passedNames,
    supportingMetrics,
    strengths,
    weaknesses,
    downsideRisks,
    missingOrUnverified: Array.from(new Set(missingOrUnverified)),
  };
}

export interface EvaluatedUniverseResult {
  marketDate: string | null;
  annualWeightPct: number;
  rows: ScreenedCompanyRow[];
  bySymbol: Map<string, CompanyFundamentalDetailResponse>;
}

/**
 * Evaluates the full NEPSE equity universe by combining MarketStore price/turnover/momentum
 * with FundamentalVault multi-period financial ledgers across all 9 investor frameworks.
 * Defaults to 70% Annual/Q4 Report weight and 30% Quarterly/Interim Report weight when both exist.
 */
export function evaluateScreenerUniverse(
  store: MarketStore,
  vault: FundamentalVault,
  options: {
    equityOnly?: boolean;
    fiscalYear?: string;
    quarter?: QuarterCode;
    monitorStatusMap?: Map<string, ReportMonitorStatus>;
    benchmarkFdRatePct?: number;
    annualWeightPct?: number;
  } = {}
): EvaluatedUniverseResult {
  vault.initIfNeeded();
  const equityOnly = options.equityOnly !== false;
  const rawWeight =
    options.annualWeightPct !== undefined && Number.isFinite(options.annualWeightPct)
      ? options.annualWeightPct
      : 70;
  const annualWeightPct = Math.round(clip(rawWeight, 0, 100));
  const annualRatio = annualWeightPct / 100;
  const interimWeightPct = 100 - annualWeightPct;
  const isCustomPeriod = Boolean(options.fiscalYear || options.quarter);
  const dates = store.getDates();
  const marketDate = dates[dates.length - 1] ?? null;
  const pulse = marketDate ? store.getMarketPulse(marketDate, equityOnly, { nDays: 20 }) : null;
  const pulseMap = new Map((pulse?.rows || []).map((r) => [r.symbol.toUpperCase(), r]));

  // Pull momentum scores from turnoverDirection for last 20 sessions
  const momentumMap = new Map<string, number>();
  if (dates.length >= 2) {
    const start20 = dates[Math.max(0, dates.length - 20)];
    const dir = store.turnoverDirection(start20, marketDate!, 100, false, equityOnly);
    for (const r of dir.all) {
      if (r.momentum_score !== undefined) {
        momentumMap.set(r.symbol.toUpperCase(), r.momentum_score);
      }
    }
  }

  const benchmarkFdRatePct = options.benchmarkFdRatePct ?? 6.5;
  const ledgers = vault.getAllLedgers();
  const ledgerMap = new Map<string, CompanyLedgerFile>(
    ledgers.map((l) => [l.symbol.toUpperCase(), l])
  );

  // Union of market symbols + fundamental vault symbols
  const allSymbols = new Set<string>([
    ...Array.from(pulseMap.keys()),
    ...Array.from(ledgerMap.keys()),
  ]);

  // First pass: prepare valuation & market overlay for every symbol with fundamental data
  // so Greenblatt Magic Formula can rank Earnings Yield and ROIC cross-sectionally.
  interface PreEval {
    symbol: string;
    companyName: string;
    sector: string;
    sectorGroup: ReturnType<typeof classifySectorGroup>['sectorGroup'];
    ledger: CompanyLedgerFile | null;
    record: QuarterlyStatementRecord | null;
    annualRecord: QuarterlyStatementRecord | null;
    interimRecord: QuarterlyStatementRecord | null;
    prevRecord: QuarterlyStatementRecord | null;
    yoyRecord: QuarterlyStatementRecord | null;
    trendRecords: QuarterlyStatementRecord[];
    growth: GrowthComparisons;
    annualGrowth: GrowthComparisons | null;
    interimGrowth: GrowthComparisons | null;
    valuation: ValuationBreakdown | null;
    annualValuation: ValuationBreakdown | null;
    interimValuation: ValuationBreakdown | null;
    market: MarketOverlay;
    thresholds: SectorThresholds;
    roicOrRoe: number | null;
    earningsYield: number | null;
  }

  const preList: PreEval[] = [];

  for (const sym of allSymbols) {
    const pRow = pulseMap.get(sym);
    const ledger = ledgerMap.get(sym) ?? null;
    if (equityOnly && pulseMap.size > 0 && !pRow && !ledger) continue;

    const record = ledger
      ? vault.selectRecordForPeriod(ledger, options.fiscalYear, options.quarter)
      : null;

    const annualRecord =
      ledger && !isCustomPeriod ? pickLatestAnnualRecord(ledger.records) : null;
    const interimRecord =
      ledger && !isCustomPeriod ? pickLatestInterimRecord(ledger.records) : null;

    const recIdx =
      record && ledger ? ledger.records.findIndex((r) => r.id === record.id) : -1;
    const recordsFromIdx = ledger && recIdx >= 0 ? ledger.records.slice(recIdx) : [];
    const prevRecord = recordsFromIdx.length > 1 ? recordsFromIdx[1] : null;
    const latestBsYear = record ? extractStartBsYear(record.fiscalYear) : null;
    const yoyRecord =
      record && latestBsYear !== null
        ? recordsFromIdx.find(
            (r) =>
              extractStartBsYear(r.fiscalYear) === latestBsYear - 1 &&
              r.quarter === record.quarter
          ) ??
          recordsFromIdx.find(
            (r) =>
              extractStartBsYear(r.fiscalYear) === latestBsYear - 1 && r.quarter === 'Annual'
          ) ??
          null
        : null;
    const trendRecords = recordsFromIdx.slice(0, 12).reverse();

    const { sector, sectorGroup } = record
      ? { sector: record.sector, sectorGroup: record.sectorGroup }
      : classifySectorGroup(sym, pRow?.name || ledger?.companyName, ledger?.sector);

    const thresholds = getSectorThresholds(sectorGroup);
    const growth = computeGrowthComparisons(recordsFromIdx);

    // Compute 20d return from MarketStore history
    let periodReturnNPct: number | null = null;
    if (pRow && marketDate) {
      const hist = store.getSymbolHistory(sym, marketDate, 20);
      if (hist.length >= 2) {
        const base = hist[0].prev_close > 0 ? hist[0].prev_close : hist[0].close;
        if (base > 0) periodReturnNPct = round2(((pRow.close - base) / base) * 100);
      }
    }

    const avgTurn =
      pRow && pRow.turnover_vs_avg_n > 0 ? pRow.turnover / pRow.turnover_vs_avg_n : null;

    const liquidityTier: MarketOverlay['liquidityTier'] = !pRow
      ? 'Unavailable'
      : pRow.turnover >= 20_000_000
        ? 'High'
        : pRow.turnover >= 3_000_000
          ? 'Moderate'
          : 'Low';

    const market: MarketOverlay = {
      date: marketDate,
      ltp: pRow ? pRow.ltp || pRow.close : null,
      changePct: pRow ? pRow.diff_pct ?? 0 : null,
      turnover: pRow ? pRow.turnover : null,
      volume: pRow ? pRow.volume : null,
      avgTurnoverN: avgTurn,
      turnoverMultN: pRow ? pRow.turnover_vs_avg_n : null,
      periodReturnNPct,
      vsD120Pct: pRow ? pRow.vs_d120_pct : null,
      vsD180Pct: pRow ? pRow.vs_d180_pct : null,
      w52High: pRow ? pRow.w52_high : null,
      w52Low: pRow ? pRow.w52_low : null,
      gap52hPct: pRow ? pRow.gap_52h_pct : null,
      momentumScore: momentumMap.get(sym) ?? null,
      liquidityTier,
    };

    const hasDualReports = Boolean(!isCustomPeriod && annualRecord && interimRecord);

    const annualIdx =
      hasDualReports && ledger && annualRecord
        ? ledger.records.findIndex((r) => r.id === annualRecord.id)
        : -1;
    const annualGrowth =
      hasDualReports && ledger && annualIdx >= 0
        ? computeGrowthComparisons(ledger.records.slice(annualIdx))
        : null;
    const annualValuation =
      hasDualReports && annualRecord && annualGrowth
        ? computeSectorValuation({
            record: annualRecord,
            growth: annualGrowth,
            currentPrice: market.ltp,
            benchmarkFdRatePct,
          })
        : null;

    const interimIdx =
      hasDualReports && ledger && interimRecord
        ? ledger.records.findIndex((r) => r.id === interimRecord.id)
        : -1;
    const interimGrowth =
      hasDualReports && ledger && interimIdx >= 0
        ? computeGrowthComparisons(ledger.records.slice(interimIdx))
        : null;
    const interimValuation =
      hasDualReports && interimRecord && interimGrowth
        ? computeSectorValuation({
            record: interimRecord,
            growth: interimGrowth,
            currentPrice: market.ltp,
            benchmarkFdRatePct,
          })
        : null;

    const valuation = record
      ? computeSectorValuation({
          record,
          growth,
          currentPrice: market.ltp,
          benchmarkFdRatePct,
        })
      : null;

    const isFin =
      sectorGroup === 'Banking' ||
      sectorGroup === 'Microfinance' ||
      sectorGroup === 'Insurance';
    const extractRoicOrRoe = (rec: QuarterlyStatementRecord | null): number | null =>
      rec
        ? isFin
          ? rec.metrics.roePct.value
          : rec.metrics.roicPct.value ?? rec.metrics.roePct.value
        : null;

    const roicOrRoe = hasDualReports
      ? blendOpt(extractRoicOrRoe(annualRecord), extractRoicOrRoe(interimRecord), annualRatio, 2)
      : extractRoicOrRoe(record);

    const earningsYield = hasDualReports
      ? blendOpt(
          annualValuation?.earningsYieldPct ?? null,
          interimValuation?.earningsYieldPct ?? null,
          annualRatio,
          2
        )
      : valuation?.earningsYieldPct ?? null;

    preList.push({
      symbol: sym,
      companyName: ledger?.companyName || pRow?.name || sym,
      sector,
      sectorGroup,
      ledger,
      record,
      annualRecord,
      interimRecord,
      prevRecord,
      yoyRecord,
      trendRecords,
      growth,
      annualGrowth,
      interimGrowth,
      valuation,
      annualValuation,
      interimValuation,
      market,
      thresholds,
      roicOrRoe,
      earningsYield,
    });
  }

  // Greenblatt cross-sectional rankings across companies with both Earnings Yield & ROIC/ROE
  const magicCandidates = preList.filter(
    (x) => x.earningsYield !== null && x.roicOrRoe !== null
  );
  const eySorted = [...magicCandidates].sort((a, b) => (b.earningsYield ?? -999) - (a.earningsYield ?? -999));
  const roicSorted = [...magicCandidates].sort((a, b) => (b.roicOrRoe ?? -999) - (a.roicOrRoe ?? -999));

  const eyRankMap = new Map<string, number>();
  const roicRankMap = new Map<string, number>();
  eySorted.forEach((x, idx) => eyRankMap.set(x.symbol, idx + 1));
  roicSorted.forEach((x, idx) => roicRankMap.set(x.symbol, idx + 1));
  const totalMagic = magicCandidates.length;

  const rows: ScreenedCompanyRow[] = [];
  const bySymbol = new Map<string, CompanyFundamentalDetailResponse>();

  for (const item of preList) {
    const reportingStatus: ReportMonitorStatus =
      options.monitorStatusMap?.get(item.symbol) ??
      (item.record ? 'Published' : 'Pending');

    if (!item.record || !item.valuation) {
      const emptyScores: CompositeScores = {
        fundamentalQualityScore: 0,
        valueScore: 0,
        growthScore: 0,
        riskManagementScore: 0,
        valuationAttractivenessScore: 0,
        longTermCompoundingScore: 0,
        overallScore: 0,
      };
      const emptyInv: Record<InvestorId, number> = {
        buffett: 0,
        munger: 0,
        graham: 0,
        lynch: 0,
        marks: 0,
        fisher: 0,
        greenblatt: 0,
        templeton: 0,
        pabrai: 0,
      };
      const rec = buildRecommendation({
        record: null,
        valuation: null,
        scores: emptyScores,
        inv: {} as Record<InvestorId, InvestorScoreResult>,
        consensus: [],
        market: item.market,
      });

      const row: ScreenedCompanyRow = {
        symbol: item.symbol,
        companyName: item.companyName,
        sector: item.sector,
        sectorGroup: item.sectorGroup,
        reportingStatus,
        hasFundamentalData: false,
        latestPeriod: {
          fiscalYear: null,
          quarter: null,
          periodLabel: 'Pending Collection',
          publicationDate: null,
          collectionDate: null,
          dataSource: 'Pending',
          validationStatus: 'Incomplete',
          freshnessDays: null,
          dataQualityFlags: ['incomplete', 'unverified'],
        },
        keyMetrics: {
          eps: null,
          netProfitCr: null,
          revenueCr: null,
          netMarginPct: null,
          roePct: null,
          roaPct: null,
          roicPct: null,
          pe: null,
          pb: null,
          peg: null,
          bvps: null,
          debtToEquity: null,
          nplPct: null,
          carPct: null,
          ocfCr: null,
          fcfCr: null,
          intrinsicValue: null,
          intrinsicValueLow: null,
          intrinsicValueHigh: null,
          marginOfSafetyPct: null,
          earningsYieldPct: null,
          epsQoqPct: null,
          epsYoyPct: null,
          epsCagr3yPct: null,
          epsCagr5yPct: null,
          netProfitQoqPct: null,
          netProfitYoyPct: null,
          netProfitCagr3yPct: null,
          revenueQoqPct: null,
          revenueYoyPct: null,
          revenueCagr3yPct: null,
          bvpsYoyPct: null,
          prevPeriodLabel: null,
          prevEps: null,
          prevNetProfitCr: null,
          prevRevenueCr: null,
          prevRoePct: null,
          roeQoqDeltaPct: null,
          prevNplPct: null,
          nplQoqDeltaPct: null,
          yoyPeriodLabel: null,
          yoyEps: null,
          yoyNetProfitCr: null,
          yoyRevenueCr: null,
          epsVsQ4Avg3yPct: null,
          netProfitVsQ4Avg3yPct: null,
          revenueVsQ4Avg3yPct: null,
          roeVsQ4Avg3yDelta: null,
          q4AvgEps3y: null,
          q4AvgNetProfitCr3y: null,
          q4AvgRevenueCr3y: null,
          q4AvgYearsCount: 0,
          periodsAvailable: 0,
          trends: {
            periods: [],
            eps: [],
            revenueCr: [],
            netProfitCr: [],
          },
        },
        market: item.market,
        scores: emptyScores,
        investorScores: emptyInv,
        passedInvestorCount: 0,
        passedInvestors: [],
        consensusMatches: [],
        rankingQualifiers: [],
        greenblatt: {
          earningsYieldPct: null,
          roicOrRoePct: null,
          roicMetricLabel: item.thresholds.usesIndustrialDebtAndEv ? 'ROIC' : 'ROE',
          earningsYieldRank: null,
          roicRank: null,
          combinedRank: null,
          totalRanked: totalMagic,
        },
        reportWeighting: {
          annualWeightPct,
          interimWeightPct,
          basis: 'pending',
          annualPeriodLabel: null,
          interimPeriodLabel: null,
          annualOverallScore: null,
          interimOverallScore: null,
          hasAnnualReport: false,
        },
        recommendation: rec,
      };
      rows.push(row);
      continue;
    }

    const eyRank = eyRankMap.get(item.symbol) ?? null;
    const roicRank = roicRankMap.get(item.symbol) ?? null;
    const eyScore =
      eyRank !== null && totalMagic > 1
        ? ((totalMagic - eyRank) / (totalMagic - 1)) * 100
        : eyRank === 1
          ? 85
          : null;
    const roicScore =
      roicRank !== null && totalMagic > 1
        ? ((totalMagic - roicRank) / (totalMagic - 1)) * 100
        : roicRank === 1
          ? 85
          : null;

    const hasDualReports = Boolean(
      !isCustomPeriod &&
        item.annualRecord &&
        item.interimRecord &&
        item.annualValuation &&
        item.interimValuation &&
        item.annualGrowth &&
        item.interimGrowth
    );

    const greenblattPreRank = {
      eyRank,
      roicRank,
      total: totalMagic,
      eyScore,
      roicScore,
    };

    let invDetails: Record<InvestorId, InvestorScoreResult>;
    let scores: CompositeScores;
    let effectiveValuation: ValuationBreakdown;
    let effectiveRecord: QuarterlyStatementRecord;
    let reportWeighting: ReportWeightingInfo;

    if (
      hasDualReports &&
      item.annualRecord &&
      item.interimRecord &&
      item.annualValuation &&
      item.interimValuation &&
      item.annualGrowth &&
      item.interimGrowth
    ) {
      const annualInv = evaluateNineInvestors({
        record: item.annualRecord,
        growth: item.annualGrowth,
        valuation: item.annualValuation,
        market: item.market,
        thresholds: item.thresholds,
        benchmarkFdRatePct,
        greenblattPreRank,
      });
      const interimInv = evaluateNineInvestors({
        record: item.interimRecord,
        growth: item.interimGrowth,
        valuation: item.interimValuation,
        market: item.market,
        thresholds: item.thresholds,
        benchmarkFdRatePct,
        greenblattPreRank,
      });
      const annualScores = computeCompositeScores(annualInv, item.annualValuation);
      const interimScores = computeCompositeScores(interimInv, item.interimValuation);

      const baseInv = annualRatio >= 0.5 ? annualInv : interimInv;
      invDetails = { ...baseInv };
      for (const k of Object.keys(baseInv) as InvestorId[]) {
        const blendedScore = round1(
          annualInv[k].score * annualRatio + interimInv[k].score * (1 - annualRatio)
        );
        const blendedCov = round1(
          annualInv[k].dataCoveragePct * annualRatio +
            interimInv[k].dataCoveragePct * (1 - annualRatio)
        );
        invDetails[k] = {
          ...baseInv[k],
          score: blendedScore,
          dataCoveragePct: blendedCov,
          qualified: blendedScore >= 62 && blendedCov >= 50,
          summary: `${baseInv[k].summary} [Weighted ${annualWeightPct}% Annual (${item.annualRecord.periodLabel}: ${annualInv[k].score}) + ${interimWeightPct}% Interim (${item.interimRecord.periodLabel}: ${interimInv[k].score})]`,
        };
      }

      scores = {
        fundamentalQualityScore: round1(
          annualScores.fundamentalQualityScore * annualRatio +
            interimScores.fundamentalQualityScore * (1 - annualRatio)
        ),
        valueScore: round1(
          annualScores.valueScore * annualRatio + interimScores.valueScore * (1 - annualRatio)
        ),
        growthScore: round1(
          annualScores.growthScore * annualRatio + interimScores.growthScore * (1 - annualRatio)
        ),
        riskManagementScore: round1(
          annualScores.riskManagementScore * annualRatio +
            interimScores.riskManagementScore * (1 - annualRatio)
        ),
        valuationAttractivenessScore: round1(
          annualScores.valuationAttractivenessScore * annualRatio +
            interimScores.valuationAttractivenessScore * (1 - annualRatio)
        ),
        longTermCompoundingScore: round1(
          annualScores.longTermCompoundingScore * annualRatio +
            interimScores.longTermCompoundingScore * (1 - annualRatio)
        ),
        overallScore: round1(
          annualScores.overallScore * annualRatio + interimScores.overallScore * (1 - annualRatio)
        ),
      };

      effectiveRecord = annualRatio >= 0.5 ? item.annualRecord : item.interimRecord;
      const baseVal = annualRatio >= 0.5 ? item.annualValuation : item.interimValuation;
      effectiveValuation = {
        ...baseVal,
        intrinsicValue: blendOpt(
          item.annualValuation.intrinsicValue,
          item.interimValuation.intrinsicValue,
          annualRatio,
          2
        ),
        intrinsicValueLow: blendOpt(
          item.annualValuation.intrinsicValueLow,
          item.interimValuation.intrinsicValueLow,
          annualRatio,
          2
        ),
        intrinsicValueHigh: blendOpt(
          item.annualValuation.intrinsicValueHigh,
          item.interimValuation.intrinsicValueHigh,
          annualRatio,
          2
        ),
        marginOfSafetyPct: blendOpt(
          item.annualValuation.marginOfSafetyPct,
          item.interimValuation.marginOfSafetyPct,
          annualRatio,
          1
        ),
        livePe: blendOpt(item.annualValuation.livePe, item.interimValuation.livePe, annualRatio, 2),
        livePb: blendOpt(item.annualValuation.livePb, item.interimValuation.livePb, annualRatio, 2),
        livePeg: blendOpt(
          item.annualValuation.livePeg,
          item.interimValuation.livePeg,
          annualRatio,
          2
        ),
        earningsYieldPct: blendOpt(
          item.annualValuation.earningsYieldPct,
          item.interimValuation.earningsYieldPct,
          annualRatio,
          2
        ),
      };

      reportWeighting = {
        annualWeightPct,
        interimWeightPct,
        basis: 'blended',
        annualPeriodLabel: item.annualRecord.periodLabel,
        interimPeriodLabel: item.interimRecord.periodLabel,
        annualOverallScore: annualScores.overallScore,
        interimOverallScore: interimScores.overallScore,
        hasAnnualReport: true,
      };
    } else {
      invDetails = evaluateNineInvestors({
        record: item.record,
        growth: item.growth,
        valuation: item.valuation,
        market: item.market,
        thresholds: item.thresholds,
        benchmarkFdRatePct,
        greenblattPreRank,
      });
      scores = computeCompositeScores(invDetails, item.valuation);
      effectiveRecord = item.record;
      effectiveValuation = item.valuation;

      const isAnnualRec =
        item.record.quarter === 'Annual' || item.record.quarter === 'Q4';
      const ledgerHasAnnual = Boolean(
        item.ledger && pickLatestAnnualRecord(item.ledger.records)
      );
      reportWeighting = {
        annualWeightPct,
        interimWeightPct,
        basis: isCustomPeriod
          ? 'custom_period'
          : isAnnualRec
            ? 'annual_only'
            : 'quarterly_only',
        annualPeriodLabel: isAnnualRec
          ? item.record.periodLabel
          : item.annualRecord?.periodLabel ?? null,
        interimPeriodLabel: !isAnnualRec
          ? item.record.periodLabel
          : item.interimRecord?.periodLabel ?? null,
        annualOverallScore: isAnnualRec ? scores.overallScore : null,
        interimOverallScore: !isAnnualRec ? scores.overallScore : null,
        hasAnnualReport: isCustomPeriod ? ledgerHasAnnual : isAnnualRec,
      };
    }

    const consensus = buildConsensusMatches(invDetails);
    const passedInvestors = (Object.keys(invDetails) as InvestorId[]).filter(
      (k) => invDetails[k].qualified
    );

    const investorScores: Record<InvestorId, number> = {
      buffett: invDetails.buffett.score,
      munger: invDetails.munger.score,
      graham: invDetails.graham.score,
      lynch: invDetails.lynch.score,
      marks: invDetails.marks.score,
      fisher: invDetails.fisher.score,
      greenblatt: invDetails.greenblatt.score,
      templeton: invDetails.templeton.score,
      pabrai: invDetails.pabrai.score,
    };

    const rankingQualifiers: RankingCategory[] = [];
    if (scores.overallScore >= 58) rankingQualifiers.push('overall_top');
    if (scores.fundamentalQualityScore >= 60) rankingQualifiers.push('fundamentally_strong');
    if (scores.growthScore >= 58) rankingQualifiers.push('high_growth');
    if (
      scores.valuationAttractivenessScore >= 58 ||
      (effectiveValuation.marginOfSafetyPct ?? -100) >= 15
    ) {
      rankingQualifiers.push('undervalued');
    }
    if (
      invDetails.graham.score >= 58 &&
      invDetails.marks.score >= 58
    ) {
      rankingQualifiers.push('defensive_value');
    }
    if (
      scores.fundamentalQualityScore >= 55 &&
      (item.market.liquidityTier === 'High' || (item.market.turnoverMultN ?? 0) >= 1.2)
    ) {
      rankingQualifiers.push('high_turnover_fundamental');
    }
    if (
      scores.fundamentalQualityScore >= 55 &&
      ((item.market.momentumScore ?? 0) >= 52 || (item.market.periodReturnNPct ?? -99) > 1.5)
    ) {
      rankingQualifiers.push('positive_momentum_fundamental');
    }
    if (
      scores.longTermCompoundingScore >= 60 ||
      consensus.some((c) => c.id === 'buffett_munger' && c.qualified)
    ) {
      rankingQualifiers.push('quality_compounders');
    }

    const recommendation = buildRecommendation({
      record: effectiveRecord,
      valuation: effectiveValuation,
      scores,
      inv: invDetails,
      consensus,
      market: item.market,
    });
    if (reportWeighting.basis === 'blended') {
      recommendation.whyQualifies = `${recommendation.whyQualifies} Weighted ${annualWeightPct}% Annual (${reportWeighting.annualPeriodLabel}: ${reportWeighting.annualOverallScore}/100) + ${interimWeightPct}% Interim (${reportWeighting.interimPeriodLabel}: ${reportWeighting.interimOverallScore}/100).`;
    }

    const m = item.record.metrics;
    const mA = item.annualRecord?.metrics;
    const mI = item.interimRecord?.metrics;
    const metricVal = (
      getter: (mm: QuarterlyStatementRecord['metrics']) => number | null
    ): number | null =>
      hasDualReports && mA && mI
        ? blendOpt(getter(mA), getter(mI), annualRatio, 2)
        : getter(m);

    const freshnessDays = computeFreshnessDays(item.record.collectionDate);

    const row: ScreenedCompanyRow = {
      symbol: item.symbol,
      companyName: item.companyName,
      sector: item.sector,
      sectorGroup: item.sectorGroup,
      reportingStatus,
      hasFundamentalData: true,
      latestPeriod: {
        fiscalYear: item.record.fiscalYear,
        quarter: item.record.quarter,
        periodLabel: item.record.periodLabel,
        publicationDate: item.record.publicationDate,
        collectionDate: item.record.collectionDate,
        dataSource: item.record.dataSource,
        validationStatus: item.record.validationStatus,
        freshnessDays,
        dataQualityFlags: item.record.dataQualityFlags,
      },
      keyMetrics: {
        eps: metricVal((x) => x.eps.value),
        netProfitCr: m.netProfit.value !== null ? round2(m.netProfit.value / 1e7) : null,
        revenueCr: m.revenue.value !== null ? round2(m.revenue.value / 1e7) : null,
        netMarginPct: metricVal((x) => x.netProfitMarginPct.value),
        roePct: metricVal((x) => x.roePct.value),
        roaPct: metricVal((x) => x.roaPct.value),
        roicPct: metricVal((x) => x.roicPct.value),
        pe: effectiveValuation.livePe,
        pb: effectiveValuation.livePb,
        peg: effectiveValuation.livePeg,
        bvps: metricVal((x) => x.bvps.value),
        debtToEquity: metricVal((x) => x.debtToEquity.value),
        nplPct: metricVal((x) => x.nplPct.value),
        carPct: metricVal((x) => x.carPct.value),
        ocfCr: m.operatingCashFlow.value !== null ? round2(m.operatingCashFlow.value / 1e7) : null,
        fcfCr: m.freeCashFlow.value !== null ? round2(m.freeCashFlow.value / 1e7) : null,
        intrinsicValue: effectiveValuation.intrinsicValue,
        intrinsicValueLow: effectiveValuation.intrinsicValueLow,
        intrinsicValueHigh: effectiveValuation.intrinsicValueHigh,
        marginOfSafetyPct: effectiveValuation.marginOfSafetyPct,
        earningsYieldPct: effectiveValuation.earningsYieldPct,
        epsQoqPct: item.growth.epsQoqPct,
        epsYoyPct: item.growth.epsYoyPct,
        epsCagr3yPct: item.growth.epsCagr3yPct,
        epsCagr5yPct: item.growth.epsCagr5yPct,
        netProfitQoqPct: item.growth.netProfitQoqPct,
        netProfitYoyPct: item.growth.netProfitYoyPct,
        netProfitCagr3yPct: item.growth.netProfitCagr3yPct,
        revenueQoqPct: item.growth.revenueQoqPct,
        revenueYoyPct: item.growth.revenueYoyPct,
        revenueCagr3yPct: item.growth.revenueCagr3yPct,
        bvpsYoyPct: item.growth.bvpsYoyPct,
        prevPeriodLabel: item.prevRecord?.periodLabel ?? null,
        prevEps: item.prevRecord?.metrics.eps.value ?? null,
        prevNetProfitCr:
          item.prevRecord?.metrics.netProfit.value !== null &&
          item.prevRecord?.metrics.netProfit.value !== undefined
            ? round2(item.prevRecord.metrics.netProfit.value / 1e7)
            : null,
        prevRevenueCr:
          item.prevRecord?.metrics.revenue.value !== null &&
          item.prevRecord?.metrics.revenue.value !== undefined
            ? round2(item.prevRecord.metrics.revenue.value / 1e7)
            : null,
        prevRoePct: item.prevRecord?.metrics.roePct.value ?? null,
        roeQoqDeltaPct:
          m.roePct.value !== null &&
          item.prevRecord?.metrics.roePct.value !== null &&
          item.prevRecord?.metrics.roePct.value !== undefined
            ? round2(m.roePct.value - item.prevRecord.metrics.roePct.value)
            : null,
        prevNplPct: item.prevRecord?.metrics.nplPct.value ?? null,
        nplQoqDeltaPct:
          m.nplPct.value !== null &&
          item.prevRecord?.metrics.nplPct.value !== null &&
          item.prevRecord?.metrics.nplPct.value !== undefined
            ? round2(m.nplPct.value - item.prevRecord.metrics.nplPct.value)
            : null,
        yoyPeriodLabel: item.yoyRecord?.periodLabel ?? null,
        yoyEps: item.yoyRecord?.metrics.eps.value ?? null,
        yoyNetProfitCr:
          item.yoyRecord?.metrics.netProfit.value !== null &&
          item.yoyRecord?.metrics.netProfit.value !== undefined
            ? round2(item.yoyRecord.metrics.netProfit.value / 1e7)
            : null,
        yoyRevenueCr:
          item.yoyRecord?.metrics.revenue.value !== null &&
          item.yoyRecord?.metrics.revenue.value !== undefined
            ? round2(item.yoyRecord.metrics.revenue.value / 1e7)
            : null,
        epsVsQ4Avg3yPct: item.growth.q4Benchmark.epsVsAvgPct,
        netProfitVsQ4Avg3yPct: item.growth.q4Benchmark.netProfitVsAvgPct,
        revenueVsQ4Avg3yPct: item.growth.q4Benchmark.revenueVsAvgPct,
        roeVsQ4Avg3yDelta: item.growth.q4Benchmark.roeVsAvgDeltaPp,
        q4AvgEps3y: item.growth.q4Benchmark.avgEps,
        q4AvgNetProfitCr3y: item.growth.q4Benchmark.avgNetProfitCr,
        q4AvgRevenueCr3y: item.growth.q4Benchmark.avgRevenueCr,
        q4AvgYearsCount: item.growth.q4Benchmark.yearsCount,
        periodsAvailable: item.growth.periodsAvailable,
        trends: {
          periods: item.trendRecords.map((r) => r.periodLabel),
          eps: item.trendRecords.map((r) => r.metrics.eps.value),
          revenueCr: item.trendRecords.map((r) =>
            r.metrics.revenue.value !== null ? round2(r.metrics.revenue.value / 1e7) : null
          ),
          netProfitCr: item.trendRecords.map((r) =>
            r.metrics.netProfit.value !== null ? round2(r.metrics.netProfit.value / 1e7) : null
          ),
        },
      },
      market: item.market,
      scores,
      investorScores,
      passedInvestorCount: passedInvestors.length,
      passedInvestors,
      consensusMatches: consensus,
      rankingQualifiers,
      greenblatt: {
        earningsYieldPct: item.earningsYield,
        roicOrRoePct: item.roicOrRoe,
        roicMetricLabel: item.thresholds.usesIndustrialDebtAndEv ? 'ROIC' : 'ROE',
        earningsYieldRank: eyRank,
        roicRank,
        combinedRank: eyRank !== null && roicRank !== null ? eyRank + roicRank : null,
        totalRanked: totalMagic,
      },
      reportWeighting,
      recommendation,
    };

    rows.push(row);
    bySymbol.set(item.symbol, {
      summary: row,
      valuation: effectiveValuation,
      growth: item.growth,
      investorDetails: invDetails,
      statements: item.ledger!.records,
      officialSources: item.ledger!.officialSources,
    });
  }

  // Sort evaluated stocks first by overallScore descending, then pending by turnover
  rows.sort((a, b) => {
    if (a.hasFundamentalData !== b.hasFundamentalData) {
      return a.hasFundamentalData ? -1 : 1;
    }
    if (b.scores.overallScore !== a.scores.overallScore) {
      return b.scores.overallScore - a.scores.overallScore;
    }
    return (b.market.turnover ?? 0) - (a.market.turnover ?? 0);
  });

  return {
    marketDate,
    annualWeightPct,
    rows,
    bySymbol,
  };
}

/**
 * Computes peer averages and sector ranking for a single symbol inside its NEPSE sector
 * (or sectorGroup fallback when a sector has fewer than 2 fundamental peers).
 */
export function buildSectorPeerBenchmark(
  rows: ScreenedCompanyRow[],
  symbol: string
): SectorPeerBenchmark | null {
  const sym = symbol.trim().toUpperCase();
  const target = rows.find((r) => r.symbol.toUpperCase() === sym);
  if (!target) return null;

  const sameSectorAll = rows.filter((r) => r.sector === target.sector);
  const sameSectorFund = sameSectorAll.filter((r) => r.hasFundamentalData);

  const peerScopeAll =
    sameSectorFund.length >= 2
      ? sameSectorAll
      : rows.filter((r) => r.sectorGroup === target.sectorGroup);
  const peerScopeFund = peerScopeAll.filter((r) => r.hasFundamentalData);

  const mean = (vals: Array<number | null | undefined>): number | null => {
    const clean = vals.filter(
      (v): v is number => v !== null && v !== undefined && Number.isFinite(v)
    );
    if (clean.length === 0) return null;
    return round2(clean.reduce((s, v) => s + v, 0) / clean.length);
  };

  const ranked = [...peerScopeFund].sort(
    (a, b) =>
      b.scores.overallScore - a.scores.overallScore ||
      b.passedInvestorCount - a.passedInvestorCount
  );
  const targetRankIdx = ranked.findIndex((r) => r.symbol.toUpperCase() === sym);

  const topList = ranked.slice(0, 6);
  if (
    targetRankIdx >= 6 &&
    ranked[targetRankIdx] &&
    !topList.some((r) => r.symbol.toUpperCase() === sym)
  ) {
    topList.push(ranked[targetRankIdx]);
  }

  const toSnap = (r: ScreenedCompanyRow): SectorPeerSnapshot => ({
    symbol: r.symbol,
    companyName: r.companyName,
    ltp: r.market.ltp,
    changePct: r.market.changePct,
    overallScore: r.scores.overallScore,
    verdict: r.recommendation.verdict,
    eps: r.keyMetrics.eps,
    roePct: r.keyMetrics.roePct,
    pe: r.keyMetrics.pe,
    pb: r.keyMetrics.pb,
    marginOfSafetyPct: r.keyMetrics.marginOfSafetyPct,
    epsVsQ4Avg3yPct: r.keyMetrics.epsVsQ4Avg3yPct,
    passedInvestorCount: r.passedInvestorCount,
  });

  return {
    rankInSector: targetRankIdx >= 0 ? targetRankIdx + 1 : null,
    rankedTotal: ranked.length,
    averages: {
      sector: target.sector,
      sectorGroup: target.sectorGroup,
      peerCountWithFundamentals: peerScopeFund.length,
      totalSectorPeers: peerScopeAll.length,
      avgOverallScore: mean(peerScopeFund.map((r) => r.scores.overallScore)),
      avgEps: mean(peerScopeFund.map((r) => r.keyMetrics.eps)),
      avgRoePct: mean(peerScopeFund.map((r) => r.keyMetrics.roePct)),
      avgPe: mean(
        peerScopeFund.map((r) =>
          r.keyMetrics.pe !== null && r.keyMetrics.pe > 0 && r.keyMetrics.pe <= 150
            ? r.keyMetrics.pe
            : null
        )
      ),
      avgPb: mean(
        peerScopeFund.map((r) =>
          r.keyMetrics.pb !== null && r.keyMetrics.pb > 0 && r.keyMetrics.pb <= 30
            ? r.keyMetrics.pb
            : null
        )
      ),
      avgNetMarginPct: mean(peerScopeFund.map((r) => r.keyMetrics.netMarginPct)),
      avgMosPct: mean(peerScopeFund.map((r) => r.keyMetrics.marginOfSafetyPct)),
      avgNplPct: mean(peerScopeFund.map((r) => r.keyMetrics.nplPct)),
    },
    topPeers: topList.map(toSnap),
  };
}
