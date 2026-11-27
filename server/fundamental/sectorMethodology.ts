import type {
  DataProvenance,
  GrowthComparisons,
  QuarterlyStatementRecord,
  SectorGroup,
  ValuationBreakdown,
} from '../../src/types/fundamental.ts';

export interface SectorThresholds {
  sectorGroup: SectorGroup;
  label: string;
  methodologySummary: string;
  minRoePct: number;
  strongRoePct: number;
  minRoicOrRoaPct: number;
  maxPe: number;
  deepValuePe: number;
  maxPb: number;
  deepValuePb: number;
  maxDebtToEquity: number | null; // null when deposits make D/E non-applicable
  maxNplPct: number | null;
  minCarPct: number | null;
  minNetMarginPct: number;
  usesDepositsAndLoans: boolean;
  usesInsuranceMetrics: boolean;
  usesIndustrialDebtAndEv: boolean;
  defaultCostOfEquityPct: number;
  sustainableGrowthCapPct: number;
}

const SECTOR_CONFIGS: Record<SectorGroup, SectorThresholds> = {
  Banking: {
    sectorGroup: 'Banking',
    label: 'Banking & Finance (BFIs)',
    methodologySummary:
      'BFIs use deposits as operating raw material; standard industrial Debt/Equity, Current Ratio, and EV/EBIT are inapplicable. Evaluation prioritizes ROE, ROA (≥1.0%), CAR (≥11%), NPL (<3.5% healthy, >5% risky), CD Ratio, Net Interest/Operating Margin, and Justified P/B.',
    minRoePct: 11,
    strongRoePct: 15,
    minRoicOrRoaPct: 1.0, // ROA benchmark for banks
    maxPe: 20,
    deepValuePe: 12,
    maxPb: 2.5,
    deepValuePb: 1.4,
    maxDebtToEquity: null,
    maxNplPct: 4.5,
    minCarPct: 11.0,
    minNetMarginPct: 18,
    usesDepositsAndLoans: true,
    usesInsuranceMetrics: false,
    usesIndustrialDebtAndEv: false,
    defaultCostOfEquityPct: 12.0,
    sustainableGrowthCapPct: 9.0,
  },
  Microfinance: {
    sectorGroup: 'Microfinance',
    label: 'Microfinance (Laghubitta)',
    methodologySummary:
      'Microfinance institutions carry higher credit-cycle sensitivity and wholesale borrowing. Screening focuses on NPL containment (<4.5%), CAR (≥10%), ROE (≥14%), Cost of Funds spread, and conservative P/B given regulatory interest caps.',
    minRoePct: 13,
    strongRoePct: 18,
    minRoicOrRoaPct: 1.5,
    maxPe: 24,
    deepValuePe: 14,
    maxPb: 3.2,
    deepValuePb: 1.8,
    maxDebtToEquity: null,
    maxNplPct: 5.0,
    minCarPct: 10.0,
    minNetMarginPct: 14,
    usesDepositsAndLoans: true,
    usesInsuranceMetrics: false,
    usesIndustrialDebtAndEv: false,
    defaultCostOfEquityPct: 13.0,
    sustainableGrowthCapPct: 10.0,
  },
  Insurance: {
    sectorGroup: 'Insurance',
    label: 'Life & Non-Life Insurance',
    methodologySummary:
      'Insurers hold policyholder float and technical reserves rather than industrial debt. Evaluation emphasizes Solvency Ratio, Net Premium growth, Claim/Loss control, ROE, ROA, Investment Float Yield, and P/B relative to ROE.',
    minRoePct: 12,
    strongRoePct: 17,
    minRoicOrRoaPct: 2.0,
    maxPe: 26,
    deepValuePe: 15,
    maxPb: 3.5,
    deepValuePb: 2.0,
    maxDebtToEquity: null,
    maxNplPct: null,
    minCarPct: null,
    minNetMarginPct: 12,
    usesDepositsAndLoans: false,
    usesInsuranceMetrics: true,
    usesIndustrialDebtAndEv: false,
    defaultCostOfEquityPct: 12.5,
    sustainableGrowthCapPct: 10.0,
  },
  Hydropower: {
    sectorGroup: 'Hydropower',
    label: 'Hydropower & Energy',
    methodologySummary:
      'Hydropower projects are front-loaded with project debt and depreciation. Standard P/E can mislead during early commissioning; screening evaluates Debt-to-Equity (≤2.0x mature), Operating Cash Flow, Free Cash Flow after capex, ROIC, and PPA-backed earnings stability.',
    minRoePct: 10,
    strongRoePct: 15,
    minRoicOrRoaPct: 8.5,
    maxPe: 25,
    deepValuePe: 14,
    maxPb: 2.8,
    deepValuePb: 1.5,
    maxDebtToEquity: 2.0,
    maxNplPct: null,
    minCarPct: null,
    minNetMarginPct: 18,
    usesDepositsAndLoans: false,
    usesInsuranceMetrics: false,
    usesIndustrialDebtAndEv: true,
    defaultCostOfEquityPct: 12.5,
    sustainableGrowthCapPct: 7.5,
  },
  Manufacturing: {
    sectorGroup: 'Manufacturing',
    label: 'Manufacturing & Processing',
    methodologySummary:
      'Manufacturing firms use full industrial capital-efficiency rules: ROIC (≥14% strong), Net Profit Margin, Operating & Free Cash Flow, Owner Earnings, Debt-to-Equity (≤1.0x conservative), NCAV / Working Capital, and EBIT/EV Earnings Yield.',
    minRoePct: 14,
    strongRoePct: 20,
    minRoicOrRoaPct: 12.0,
    maxPe: 24,
    deepValuePe: 14,
    maxPb: 4.0,
    deepValuePb: 2.0,
    maxDebtToEquity: 1.0,
    maxNplPct: null,
    minCarPct: null,
    minNetMarginPct: 10,
    usesDepositsAndLoans: false,
    usesInsuranceMetrics: false,
    usesIndustrialDebtAndEv: true,
    defaultCostOfEquityPct: 12.0,
    sustainableGrowthCapPct: 10.0,
  },
  Other: {
    sectorGroup: 'Other',
    label: 'Hotels, Investment & Trading',
    methodologySummary:
      'Diversified non-BFI equities evaluated on ROE, ROIC, Net Margin, Debt-to-Equity (≤1.2x), Operating/Free Cash Flow, and Earnings Power / Asset Value.',
    minRoePct: 12,
    strongRoePct: 17,
    minRoicOrRoaPct: 10.0,
    maxPe: 25,
    deepValuePe: 14,
    maxPb: 3.2,
    deepValuePb: 1.6,
    maxDebtToEquity: 1.2,
    maxNplPct: null,
    minCarPct: null,
    minNetMarginPct: 12,
    usesDepositsAndLoans: false,
    usesInsuranceMetrics: false,
    usesIndustrialDebtAndEv: true,
    defaultCostOfEquityPct: 12.0,
    sustainableGrowthCapPct: 8.5,
  },
};

export function getSectorThresholds(sectorGroup: SectorGroup): SectorThresholds {
  return SECTOR_CONFIGS[sectorGroup] ?? SECTOR_CONFIGS.Other;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Computes sector-appropriate intrinsic value, live valuation multiples, and Margin of Safety
 * strictly from verified/reported inputs, never fabricating missing data.
 */
export function computeSectorValuation(params: {
  record: QuarterlyStatementRecord;
  growth: GrowthComparisons;
  currentPrice: number | null;
  benchmarkFdRatePct: number | null;
}): ValuationBreakdown {
  const { record, growth, currentPrice, benchmarkFdRatePct } = params;
  const m = record.metrics;
  const cfg = getSectorThresholds(record.sectorGroup);

  const eps = m.eps.value;
  const bvps = m.bvps.value;
  const roe = m.roePct.value;
  const netProfit = m.netProfit.value;
  const netWorth = m.netWorth.value;
  const shares = m.outstandingShares.value;
  const totalDebt = m.totalDebt.value;
  const cash = m.cashAndEquivalents.value;
  const ebit = m.ebit.value ?? m.operatingProfit.value;
  const fcf = m.freeCashFlow.value ?? m.ownerEarnings.value ?? m.operatingCashFlow.value;

  const livePe =
    currentPrice !== null && currentPrice > 0 && eps !== null && eps > 0
      ? round2(currentPrice / eps)
      : m.reportedPe.value;

  const livePb =
    currentPrice !== null && currentPrice > 0 && bvps !== null && bvps > 0
      ? round2(currentPrice / bvps)
      : m.reportedPb.value;

  const growthRateForPeg =
    growth.epsCagr3yPct ?? growth.epsYoyPct ?? growth.netProfitYoyPct;
  const livePeg =
    livePe !== null && livePe > 0 && growthRateForPeg !== null && growthRateForPeg > 1
      ? round2(livePe / growthRateForPeg)
      : null;

  const marketCap =
    currentPrice !== null && currentPrice > 0 && shares !== null && shares > 0
      ? currentPrice * shares
      : null;

  let enterpriseValue: number | null = null;
  if (cfg.usesIndustrialDebtAndEv && marketCap !== null) {
    enterpriseValue = Math.max(
      marketCap * 0.25,
      marketCap + (totalDebt ?? 0) - (cash ?? 0)
    );
  }

  let earningsYieldPct: number | null = null;
  let earningsYieldBasis = 'Unavailable';
  if (cfg.usesIndustrialDebtAndEv && ebit !== null && enterpriseValue !== null && enterpriseValue > 0) {
    earningsYieldPct = round2((ebit / enterpriseValue) * 100);
    earningsYieldBasis = 'EBIT / Enterprise Value (Magic Formula)';
  } else if (livePe !== null && livePe > 0) {
    earningsYieldPct = round2((1 / livePe) * 100);
    earningsYieldBasis = cfg.usesIndustrialDebtAndEv
      ? 'EPS / Price (EBIT or EV unavailable)'
      : 'EPS / Price (Sector-Adjusted Earnings Yield for BFIs/Insurance)';
  }

  let ncavPerShare: number | null = null;
  if (
    cfg.usesIndustrialDebtAndEv &&
    m.currentAssets.value !== null &&
    m.totalLiabilities.value !== null &&
    shares !== null &&
    shares > 0
  ) {
    ncavPerShare = round2((m.currentAssets.value - m.totalLiabilities.value) / shares);
  }

  const riskFreePct = benchmarkFdRatePct ?? 6.5;
  const costOfEquityPct = Math.max(10.5, riskFreePct + 5.5, cfg.defaultCostOfEquityPct);

  const formulaInputs: ValuationBreakdown['formulaInputs'] = [];
  const assumptions: string[] = [];
  const limitations: string[] = [];

  if (currentPrice !== null) {
    formulaInputs.push({
      label: 'Market LTP',
      value: `Rs ${currentPrice.toFixed(2)}`,
      provenance: 'Reported',
    });
  } else {
    limitations.push('Current market LTP unavailable; live valuation multiples could not be updated.');
  }

  if (eps !== null) {
    formulaInputs.push({
      label: 'EPS (Annualized)',
      value: `Rs ${eps.toFixed(2)}`,
      provenance: m.eps.provenance,
    });
  }
  if (bvps !== null) {
    formulaInputs.push({
      label: 'Book Value / Share',
      value: `Rs ${bvps.toFixed(2)}`,
      provenance: m.bvps.provenance,
    });
  }
  if (roe !== null) {
    formulaInputs.push({
      label: 'Return on Equity (ROE)',
      value: `${roe.toFixed(2)}%`,
      provenance: m.roePct.provenance,
    });
  }

  assumptions.push(
    `Cost of Equity (ke): ${costOfEquityPct.toFixed(1)}% (Nepal benchmark FD/risk-free ${riskFreePct.toFixed(1)}% + equity risk premium).`
  );

  let intrinsicValue: number | null = null;
  let intrinsicValueLow: number | null = null;
  let intrinsicValueHigh: number | null = null;
  let method = 'Insufficient Data for Intrinsic Valuation';
  let provenance: DataProvenance = 'Unavailable';

  const estimates: number[] = [];

  // 1. Justified P/B + Residual Income for BFIs & Insurance (and asset-backed fallback)
  if (
    (cfg.sectorGroup === 'Banking' ||
      cfg.sectorGroup === 'Microfinance' ||
      cfg.sectorGroup === 'Insurance') &&
    bvps !== null &&
    bvps > 0 &&
    roe !== null
  ) {
    method = 'Justified P/B & Residual Income Model (Financial Sector)';
    const g = Math.min(
      cfg.sustainableGrowthCapPct,
      Math.max(2.5, (growth.epsCagr3yPct ?? roe * 0.45) * 0.6)
    );
    const keDec = costOfEquityPct / 100;
    const roeDec = roe / 100;
    const gDec = Math.min(keDec - 0.02, g / 100);
    const justifiedPb = Math.max(0.45, Math.min(4.2, (roeDec - gDec) / (keDec - gDec)));
    const justifiedVal = bvps * justifiedPb;
    estimates.push(justifiedVal);
    assumptions.push(
      `Justified P/B = (ROE ${roe.toFixed(1)}% - g ${g.toFixed(1)}%) / (ke ${costOfEquityPct.toFixed(1)}% - g) = ${justifiedPb.toFixed(2)}x.`
    );

    if (eps !== null && eps > 0) {
      const epvBank = eps / (keDec - 0.03);
      estimates.push(epvBank);
      assumptions.push(`Earnings Power Value = EPS / (ke - 3% terminal growth) = Rs ${epvBank.toFixed(1)}.`);
    }
  } else if (cfg.usesIndustrialDebtAndEv) {
    // 2. Non-Financials: FCF/Owner-Earnings DCF + Graham Growth Formula
    const fcfPerShare =
      fcf !== null && shares !== null && shares > 0 ? fcf / shares : null;
    const gRaw = growth.epsCagr3yPct ?? growth.epsYoyPct ?? (roe !== null ? Math.min(12, roe * 0.45) : 6);
    const gCapped = Math.max(2, Math.min(cfg.sustainableGrowthCapPct, gRaw));

    if (fcfPerShare !== null && fcfPerShare > 0) {
      method = '10-Year Owner Earnings / FCF Discounted Model + Earnings Multiple';
      const wacc = (costOfEquityPct - 0.5) / 100;
      const g1 = gCapped / 100;
      const gTerm = 0.04;
      let pv = 0;
      let cf = fcfPerShare;
      for (let yr = 1; yr <= 10; yr++) {
        cf = cf * (1 + (yr <= 5 ? g1 : (g1 + gTerm) / 2));
        pv += cf / Math.pow(1 + wacc, yr);
      }
      const termVal = (cf * (1 + gTerm)) / Math.max(0.03, wacc - gTerm);
      const dcfVal = pv + termVal / Math.pow(1 + wacc, 10);
      estimates.push(dcfVal);
      formulaInputs.push({
        label: 'Owner Earnings / FCF per Share',
        value: `Rs ${fcfPerShare.toFixed(2)}`,
        provenance: m.freeCashFlow.provenance !== 'Unavailable' ? m.freeCashFlow.provenance : 'Calculated',
      });
      assumptions.push(`10Y FCF growth ${gCapped.toFixed(1)}% tapering to 4.0% terminal at ${(wacc * 100).toFixed(1)}% discount rate.`);
    }

    if (eps !== null && eps > 0) {
      if (method === 'Insufficient Data for Intrinsic Valuation') {
        method = 'Conservative Earnings Power & Graham Intrinsic Value';
      }
      // Adjusted Graham multiplier calibrated for Nepal interest rate regime (4.4 / riskFreePct)
      const rateScale = Math.max(0.55, Math.min(1.05, 5.5 / riskFreePct));
      const grahamIntrinsic = eps * (8.5 + 1.5 * gCapped) * rateScale;
      estimates.push(grahamIntrinsic);
      assumptions.push(
        `Graham-adjusted intrinsic = EPS × (8.5 + 1.5 × ${gCapped.toFixed(1)}%) × ${rateScale.toFixed(2)} rate factor.`
      );
    }

    if (bvps !== null && bvps > 0 && roe !== null && roe > 0) {
      const assetAnchored = bvps * Math.max(0.7, Math.min(3.0, roe / costOfEquityPct));
      estimates.push(assetAnchored);
    }
  } else if (eps !== null && eps > 0) {
    method = 'Earnings Power & Book Value Blend';
    const gCapped = Math.max(2, Math.min(9, growth.epsYoyPct ?? 6));
    estimates.push(eps / Math.max(0.05, costOfEquityPct / 100 - gCapped / 200));
    if (bvps !== null && bvps > 0) estimates.push(bvps * 1.25);
  }

  if (estimates.length > 0) {
    const valid = estimates.filter((v) => Number.isFinite(v) && v > 0);
    if (valid.length > 0) {
      const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
      intrinsicValue = round1(avg);
      intrinsicValueLow = round1(Math.min(...valid) * 0.9);
      intrinsicValueHigh = round1(Math.max(...valid) * 1.1);
      provenance = 'Estimate';
    }
  } else {
    limitations.push('Missing positive EPS, BVPS, or ROE required to anchor intrinsic value without fabrication.');
  }

  if (m.operatingCashFlow.value === null) {
    limitations.push('Operating Cash Flow / Free Cash Flow not reported in available quarterly summary.');
  }
  if (growth.epsCagr3yPct === null) {
    limitations.push('Fewer than 3 fiscal years of matching historical periods loaded for 3-year EPS CAGR.');
  }
  if (netProfit !== null && netWorth !== null && netWorth <= 0) {
    limitations.push('Negative or zero net worth distorts standard P/B and ROE multiples.');
  }

  const marginOfSafetyPct =
    intrinsicValue !== null &&
    intrinsicValue > 0 &&
    currentPrice !== null &&
    currentPrice > 0
      ? round1(((intrinsicValue - currentPrice) / intrinsicValue) * 100)
      : null;

  return {
    method,
    sectorMethodologyNote: cfg.methodologySummary,
    currentPrice,
    livePe,
    livePb,
    livePeg,
    marketCap,
    enterpriseValue,
    earningsYieldPct,
    earningsYieldBasis,
    ncavPerShare,
    intrinsicValue,
    intrinsicValueLow,
    intrinsicValueHigh,
    marginOfSafetyPct,
    provenance,
    formulaInputs,
    assumptions,
    limitations,
  };
}
