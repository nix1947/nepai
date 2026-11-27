import fs from 'fs';
import path from 'path';
import type {
  CompanyFinancialSnapshot,
} from '../financialScraper.ts';
import type { StockResearchResponse } from '../../src/types/market.ts';
import type {
  DataQualityFlag,
  GrowthComparisons,
  NormalizedFinancialMetrics,
  Q4FiscalYearPoint,
  Q4ThreeYearBenchmark,
  QuarterCode,
  QuarterlyStatementRecord,
  SectorGroup,
  StatementLineItem,
  TrackedMetric,
  ValidationStatus,
} from '../../src/types/fundamental.ts';
import {
  classifySectorGroup,
  computeFreshnessDays,
  computePeriodSortKey,
  extractStartBsYear,
  parseNepalPeriodLabel,
} from './nepalCalendar.ts';

function unavailable(unit: string, note?: string): TrackedMetric {
  return { value: null, unit, provenance: 'Unavailable', note };
}

function reported(value: number, unit: string, period?: string, source?: string): TrackedMetric {
  return { value, unit, provenance: 'Reported', period, source };
}

function calculated(value: number, unit: string, note?: string, period?: string): TrackedMetric {
  return { value, unit, provenance: 'Calculated', note, period };
}

export function createEmptyMetrics(): NormalizedFinancialMetrics {
  return {
    eps: unavailable('NPR'),
    netProfit: unavailable('NPR'),
    revenue: unavailable('NPR'),
    operatingProfit: unavailable('NPR'),
    ebit: unavailable('NPR'),
    netProfitMarginPct: unavailable('%'),
    roePct: unavailable('%'),
    roaPct: unavailable('%'),
    roicPct: unavailable('%'),
    bvps: unavailable('NPR'),
    netWorth: unavailable('NPR'),
    totalAssets: unavailable('NPR'),
    totalLiabilities: unavailable('NPR'),
    reserves: unavailable('NPR'),
    retainedEarnings: unavailable('NPR'),
    shareCapital: unavailable('NPR'),
    outstandingShares: unavailable('shares'),
    totalDebt: unavailable('NPR'),
    cashAndEquivalents: unavailable('NPR'),
    currentAssets: unavailable('NPR'),
    currentLiabilities: unavailable('NPR'),
    debtToEquity: unavailable('x'),
    operatingCashFlow: unavailable('NPR'),
    capex: unavailable('NPR'),
    freeCashFlow: unavailable('NPR'),
    ownerEarnings: unavailable('NPR'),
    depreciation: unavailable('NPR'),
    interestExpense: unavailable('NPR'),
    reportedPe: unavailable('x'),
    reportedPb: unavailable('x'),
    dividendYieldPct: unavailable('%'),
    payoutRatioPct: unavailable('%'),
    deposits: unavailable('NPR'),
    loans: unavailable('NPR'),
    nplPct: unavailable('%'),
    carPct: unavailable('%'),
    cdRatioPct: unavailable('%'),
    costOfFundsPct: unavailable('%'),
    netPremium: unavailable('NPR'),
    claimRatioPct: unavailable('%'),
    solvencyRatio: unavailable('x'),
    installedCapacityMw: unavailable('MW'),
  };
}

/**
 * Parses human text figures from verified research records (e.g. "Rs 4.10 crore", "Rs 120.5 million", "14.5%", "18.2x").
 * Never guesses when text is "Unavailable" or "N/A".
 */
function parseHumanNumeric(raw: string | undefined | null, kind: 'money' | 'ratio' | 'percent'): number | null {
  if (!raw) return null;
  const s = raw.trim();
  const lower = s.toLowerCase();
  if (
    !s ||
    lower === 'unavailable' ||
    lower === 'n/a' ||
    lower === 'na' ||
    lower === '-' ||
    lower === '--' ||
    lower.includes('not available') ||
    lower.includes('not disclosed')
  ) {
    return null;
  }

  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const base = Number(m[0]);
  if (!Number.isFinite(base)) return null;

  if (kind === 'money') {
    if (lower.includes('arab') || lower.includes('billion') || /\bbn\b/.test(lower)) {
      return base * 1_000_000_000;
    }
    if (lower.includes('crore') || /\bcr\b/.test(lower)) {
      return base * 10_000_000;
    }
    if (lower.includes('million') || /\bmn\b/.test(lower)) {
      return base * 1_000_000;
    }
    if (lower.includes('lakh')) {
      return base * 100_000;
    }
    if (lower.includes("'000") || lower.includes('thousand')) {
      return base * 1_000;
    }
  }
  return base;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Derives calculated ratios (Net Margin, ROIC, Debt/Equity, FCF, Owner Earnings, BVPS, etc.)
 * strictly from non-null reported line items without fabricating missing inputs.
 */
export function enrichDerivedMetrics(
  metrics: NormalizedFinancialMetrics,
  sectorGroup: SectorGroup,
  quarter: QuarterCode,
  periodLabel: string
): NormalizedFinancialMetrics {
  const m = { ...metrics };
  const isFinancial =
    sectorGroup === 'Banking' ||
    sectorGroup === 'Microfinance' ||
    sectorGroup === 'Insurance';

  // Annualization factor for single-quarter flow metrics when comparing against balance-sheet stock metrics
  // Note: In Nepal, Q1=3m, Q2=6m cumulative, Q3=9m cumulative, Q4/Annual=12m cumulative.
  const annualMult =
    quarter === 'Q1' ? 4 : quarter === 'Q2' ? 2 : quarter === 'Q3' ? 4 / 3 : 1;

  if (m.netWorth.value === null && m.totalAssets.value !== null && m.totalLiabilities.value !== null) {
    m.netWorth = calculated(
      m.totalAssets.value - m.totalLiabilities.value,
      'NPR',
      'Total Assets - Total Liabilities',
      periodLabel
    );
  }

  if (
    m.bvps.value === null &&
    m.netWorth.value !== null &&
    m.outstandingShares.value !== null &&
    m.outstandingShares.value > 0
  ) {
    m.bvps = calculated(
      round2(m.netWorth.value / m.outstandingShares.value),
      'NPR',
      'Net Worth / Outstanding Shares',
      periodLabel
    );
  }

  if (
    m.outstandingShares.value === null &&
    m.shareCapital.value !== null &&
    m.shareCapital.value > 0
  ) {
    // NEPSE standard par value is Rs 100 per share
    m.outstandingShares = calculated(
      Math.round(m.shareCapital.value / 100),
      'shares',
      'Derived from Share Capital / Rs 100 par value',
      periodLabel
    );
  }

  if (
    m.eps.value === null &&
    m.netProfit.value !== null &&
    m.outstandingShares.value !== null &&
    m.outstandingShares.value > 0
  ) {
    m.eps = calculated(
      round2((m.netProfit.value * annualMult) / m.outstandingShares.value),
      'NPR',
      `Annualized (${annualMult}x) Net Profit / Outstanding Shares`,
      periodLabel
    );
  }

  if (
    m.netProfitMarginPct.value === null &&
    m.netProfit.value !== null &&
    m.revenue.value !== null &&
    m.revenue.value > 0
  ) {
    m.netProfitMarginPct = calculated(
      round2((m.netProfit.value / m.revenue.value) * 100),
      '%',
      'Net Profit / Revenue',
      periodLabel
    );
  }

  if (
    m.roePct.value === null &&
    m.netProfit.value !== null &&
    m.netWorth.value !== null &&
    m.netWorth.value > 0
  ) {
    m.roePct = calculated(
      round2(((m.netProfit.value * annualMult) / m.netWorth.value) * 100),
      '%',
      'Annualized Net Profit / Total Equity',
      periodLabel
    );
  }

  if (
    m.roaPct.value === null &&
    m.netProfit.value !== null &&
    m.totalAssets.value !== null &&
    m.totalAssets.value > 0
  ) {
    m.roaPct = calculated(
      round2(((m.netProfit.value * annualMult) / m.totalAssets.value) * 100),
      '%',
      'Annualized Net Profit / Total Assets',
      periodLabel
    );
  }

  if (isFinancial) {
    // Explicitly mark industrial Debt/Equity & ROIC as not applicable for deposit/float institutions
    if (m.debtToEquity.provenance === 'Unavailable') {
      m.debtToEquity = {
        value: null,
        unit: 'x',
        provenance: 'Unavailable',
        note: 'Not applicable for deposit-taking/float financial institutions; evaluate CAR & NPL instead.',
      };
    }
    if (m.roicPct.provenance === 'Unavailable') {
      m.roicPct = {
        value: null,
        unit: '%',
        provenance: 'Unavailable',
        note: 'Industrial ROIC is inapplicable to BFIs/Insurers; ROE & ROA are used instead.',
      };
    }
  } else {
    if (
      m.debtToEquity.value === null &&
      m.totalDebt.value !== null &&
      m.netWorth.value !== null &&
      m.netWorth.value > 0
    ) {
      m.debtToEquity = calculated(
        round2(m.totalDebt.value / m.netWorth.value),
        'x',
        'Total Debt / Net Worth',
        periodLabel
      );
    }

    const ebitVal = m.ebit.value ?? m.operatingProfit.value;
    if (
      m.roicPct.value === null &&
      ebitVal !== null &&
      m.netWorth.value !== null
    ) {
      const investedCapital =
        m.netWorth.value + (m.totalDebt.value ?? 0) - (m.cashAndEquivalents.value ?? 0);
      if (investedCapital > 0) {
        const nopat = ebitVal * annualMult * 0.75; // 25% Nepal statutory corporate tax assumption
        m.roicPct = calculated(
          round2((nopat / investedCapital) * 100),
          '%',
          'NOPAT (25% tax) / (Equity + Debt - Cash)',
          periodLabel
        );
      }
    }

    if (
      m.freeCashFlow.value === null &&
      m.operatingCashFlow.value !== null
    ) {
      const capexVal = Math.abs(m.capex.value ?? 0);
      m.freeCashFlow = calculated(
        m.operatingCashFlow.value - capexVal,
        'NPR',
        m.capex.value !== null
          ? 'Operating Cash Flow - CapEx'
          : 'Operating Cash Flow (CapEx not separately itemized)',
        periodLabel
      );
    }

    if (m.ownerEarnings.value === null && m.netProfit.value !== null) {
      const depr = m.depreciation.value ?? 0;
      const capexVal = Math.abs(m.capex.value ?? depr);
      if (m.depreciation.value !== null || m.capex.value !== null) {
        m.ownerEarnings = calculated(
          m.netProfit.value + depr - capexVal,
          'NPR',
          'Net Profit + Depreciation - Maintenance CapEx',
          periodLabel
        );
      }
    }
  }

  return m;
}

/**
 * Validates internal accounting consistency and produces explicit quality flags.
 */
export function runAccountingValidation(
  record: QuarterlyStatementRecord
): { validationStatus: ValidationStatus; notes: string[]; flags: DataQualityFlag[] } {
  const m = record.metrics;
  const notes: string[] = [];
  const flags: DataQualityFlag[] = [];

  // 1. Balance sheet equation check: Assets vs Liabilities + Equity
  if (
    m.totalAssets.value !== null &&
    m.totalLiabilities.value !== null &&
    m.netWorth.value !== null &&
    m.totalAssets.value > 0
  ) {
    const rhs = m.totalLiabilities.value + m.netWorth.value;
    const diffPct = Math.abs(m.totalAssets.value - rhs) / m.totalAssets.value;
    if (diffPct > 0.03) {
      flags.push('inconsistent');
      notes.push(
        `Balance sheet check mismatch: Assets (${(m.totalAssets.value / 1e7).toFixed(2)} Cr) vs Liabilities + Equity (${(rhs / 1e7).toFixed(2)} Cr).`
      );
    } else {
      notes.push('Balance sheet identity (Assets ≈ Liabilities + Equity) verified.');
    }
  }

  // 2. Completeness check
  const corePresent = [
    m.eps.value !== null,
    m.netProfit.value !== null,
    m.revenue.value !== null,
    m.roePct.value !== null,
    m.bvps.value !== null,
  ].filter(Boolean).length;

  if (corePresent < 3) {
    flags.push('incomplete');
    notes.push(`Only ${corePresent}/5 core financial indicators reported.`);
  }

  if (m.operatingCashFlow.value === null) {
    notes.push('Operating Cash Flow not disclosed in summary statement.');
  }

  // 3. Freshness check (> 150 days old)
  const age = computeFreshnessDays(record.collectionDate);
  if (age !== null && age > 150) {
    flags.push('outdated');
    notes.push(`Collected ${age} days ago; due for fresh quarterly check.`);
  }

  // 4. Verification status
  if (record.validationStatus === 'Unverified') {
    flags.push('unverified');
  }

  let validationStatus = record.validationStatus;
  if (flags.includes('inconsistent')) validationStatus = 'Discrepancy';
  else if (flags.includes('incomplete') && validationStatus !== 'CrossChecked') {
    validationStatus = 'Incomplete';
  }

  return {
    validationStatus,
    notes,
    flags: Array.from(new Set(flags)),
  };
}

/**
 * Converts a raw ShareSansar snapshot (`data/financial/<SYMBOL>.json`) into one or more
 * normalized QuarterlyStatementRecord items (one per period column).
 */
export function normalizeShareSansarSnapshot(
  snapshot: CompanyFinancialSnapshot
): QuarterlyStatementRecord[] {
  const { sector, sectorGroup } = classifySectorGroup(
    snapshot.symbol,
    snapshot.companyName,
    snapshot.sector
  );

  const periods = snapshot.periods && snapshot.periods.length > 0 ? snapshot.periods : ['Latest'];
  const records: QuarterlyStatementRecord[] = [];

  for (let pIdx = 0; pIdx < periods.length; pIdx++) {
    const rawPeriod = periods[pIdx];
    const parsedPeriod = parseNepalPeriodLabel(rawPeriod);
    if (!parsedPeriod) continue;

    const metrics = createEmptyMetrics();
    const rawLineItems: StatementLineItem[] = [];

    let totalDebtAcc = 0;
    let hasDebtPart = false;
    let cashAcc = 0;
    let hasCashPart = false;

    for (const tab of snapshot.tabs || []) {
      const header0 = (tab.headers?.[0] || '').toLowerCase();
      const tabMultiplier =
        header0.includes("'000") || header0.includes('thousand')
          ? 1_000
          : header0.includes('crore')
            ? 10_000_000
            : header0.includes('lakh')
              ? 100_000
              : 1;

      // Determine column index matching this period inside tab.headers
      let colIdx = tab.headers.slice(1).findIndex((h) => h.trim() === rawPeriod.trim());
      if (colIdx === -1) colIdx = pIdx;

      for (const row of tab.rows || []) {
        if (row.isSectionHeader) continue;
        const val = row.numericValues?.[colIdx] ?? null;
        const rawStr = row.values?.[colIdx] ?? '';
        const pLower = row.particulars.toLowerCase();
        const isThousandRow = pLower.includes("'000") || tabMultiplier === 1_000;
        const isMoneyTab =
          tab.key.includes('balance') ||
          tab.key.includes('profit') ||
          tab.key.includes('cash') ||
          pLower.includes("(in rs '000'") ||
          pLower.includes('(rs. in');
        const mult = pLower.includes("'000") ? 1_000 : isMoneyTab ? tabMultiplier : 1;

        rawLineItems.push({
          tab: tab.title,
          section: row.section,
          particulars: row.particulars,
          rawValue: rawStr,
          numericValue: val !== null && isThousandRow && !pLower.includes('per share') ? val * 1_000 : val,
        });

        if (val === null) continue;

        // Match Key Metrics / Ratios vs Financial Statement rows
        if (
          pLower.includes('basic earnings per share') ||
          pLower === 'eps' ||
          pLower.includes('earnings per share')
        ) {
          metrics.eps = reported(val, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (
          pLower.includes('net worth per share') ||
          pLower.includes('book value per share')
        ) {
          metrics.bvps = reported(val, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('p/e ratio') || pLower === 'pe ratio') {
          metrics.reportedPe = reported(val, 'x', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('p/b') || pLower.includes('price to book')) {
          metrics.reportedPb = reported(val, 'x', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('return on equity') || pLower === 'roe') {
          metrics.roePct = reported(val, '%', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('return on assets') || pLower === 'roa') {
          metrics.roaPct = reported(val, '%', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('non-performing loan') || pLower.includes('npl')) {
          if (!pLower.includes('provision to total npl')) {
            metrics.nplPct = reported(val, '%', parsedPeriod.periodLabel, 'ShareSansar');
          }
        } else if (pLower.includes('capital fund to rwa') || pLower.includes('capital adequacy')) {
          metrics.carPct = reported(val, '%', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('credit to deposit') || pLower.includes('cd ratio')) {
          metrics.cdRatioPct = reported(val, '%', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('cost of funds')) {
          metrics.costOfFundsPct = reported(val, '%', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('no. of outstanding shares') || pLower.includes('outstanding shares')) {
          metrics.outstandingShares = reported(val, 'shares', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes("total shareholder's equity") || pLower === 'total equity' || pLower === 'net worth') {
          metrics.netWorth = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower === 'total assets') {
          metrics.totalAssets = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower === 'total liabilities') {
          metrics.totalLiabilities = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower === 'share capital' || pLower === 'paid up capital') {
          metrics.shareCapital = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower === 'reserves' || pLower.includes('reserve and surplus')) {
          metrics.reserves = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower === 'retained earnings') {
          metrics.retainedEarnings = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('cash and cash equivalent') || pLower.includes('due from nepal rastra bank')) {
          cashAcc += val * mult;
          hasCashPart = true;
        } else if (
          pLower === 'borrowing' ||
          pLower === 'borrowings' ||
          pLower.includes('long term debt') ||
          pLower.includes('short term debt') ||
          pLower.includes('debt securities issued') ||
          pLower.includes('subordinated liabilities')
        ) {
          totalDebtAcc += val * mult;
          hasDebtPart = true;
        } else if (pLower.includes('deposits from customers') || pLower === 'deposits') {
          metrics.deposits = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('loans and advances to customers')) {
          metrics.loans = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower === 'current assets' || pLower === 'total current assets') {
          metrics.currentAssets = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower === 'current liabilities' || pLower === 'total current liabilities') {
          metrics.currentLiabilities = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (
          pLower === 'profit for the period' ||
          pLower === 'net profit' ||
          pLower === 'profit/(loss) for the period'
        ) {
          metrics.netProfit = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower === 'operating profit' || pLower.includes('operating profit/')) {
          metrics.operatingProfit = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
          if (metrics.ebit.provenance === 'Unavailable') {
            metrics.ebit = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
          }
        } else if (
          pLower === 'total operating income' ||
          pLower === 'revenue' ||
          pLower.includes('revenue from operations') ||
          pLower.includes('income from sale of electricity') ||
          pLower.includes('net premium')
        ) {
          metrics.revenue = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
          if (pLower.includes('net premium')) {
            metrics.netPremium = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
          }
        } else if (pLower.includes('depreciation')) {
          metrics.depreciation = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower === 'interest expense' || pLower.includes('finance cost')) {
          metrics.interestExpense = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('operating cash flow') || pLower.includes('cash flow from operating')) {
          metrics.operatingCashFlow = reported(val * mult, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('capital expenditure') || pLower.includes('purchase of property')) {
          metrics.capex = reported(Math.abs(val * mult), 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('solvency')) {
          metrics.solvencyRatio = reported(val, 'x', parsedPeriod.periodLabel, 'ShareSansar');
        } else if (pLower.includes('dividend yield')) {
          metrics.dividendYieldPct = reported(val, '%', parsedPeriod.periodLabel, 'ShareSansar');
        }
      }
    }

    if (hasCashPart && metrics.cashAndEquivalents.provenance === 'Unavailable') {
      metrics.cashAndEquivalents = reported(cashAcc, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
    }
    if (hasDebtPart && metrics.totalDebt.provenance === 'Unavailable') {
      metrics.totalDebt = reported(totalDebtAcc, 'NPR', parsedPeriod.periodLabel, 'ShareSansar');
    }

    const enriched = enrichDerivedMetrics(
      metrics,
      sectorGroup,
      parsedPeriod.quarter,
      parsedPeriod.periodLabel
    );

    const rec: QuarterlyStatementRecord = {
      id: `${snapshot.symbol.toUpperCase()}:${parsedPeriod.fiscalYear}:${parsedPeriod.quarter}`,
      symbol: snapshot.symbol.toUpperCase(),
      companyName: snapshot.companyName || snapshot.symbol.toUpperCase(),
      sector,
      sectorGroup,
      fiscalYear: parsedPeriod.fiscalYear,
      quarter: parsedPeriod.quarter,
      periodLabel: parsedPeriod.periodLabel,
      sortKey: parsedPeriod.sortKey,
      publicationDate: null,
      collectionDate: snapshot.scrapedAt || new Date().toISOString(),
      dataSource: 'ShareSansar',
      sourceUrl: snapshot.sourceUrl || null,
      validationStatus: 'Verified',
      validationNotes: [],
      dataQualityFlags: [],
      metrics: enriched,
      lineItemsCount: rawLineItems.length,
      rawLineItems: rawLineItems.slice(0, 120),
    };

    const valResult = runAccountingValidation(rec);
    rec.validationStatus = valResult.validationStatus;
    rec.validationNotes = valResult.notes;
    rec.dataQualityFlags = valResult.flags;

    records.push(rec);
  }

  return records;
}

/**
 * Converts existing cached research audit records (`data/.fundamental-intel.json`)
 * into structured QuarterlyStatementRecord entries while preserving missing-field flags.
 */
export function normalizeCachedAuditRecord(
  audit: StockResearchResponse
): QuarterlyStatementRecord | null {
  const fm = audit.financialMetrics;
  const periodText = audit.reportingPeriod || fm?.reportingPeriod || '';
  const parsedPeriod = parseNepalPeriodLabel(periodText) ?? {
    fiscalYear: '2081/82',
    quarter: 'Q1' as QuarterCode,
    sortKey: computePeriodSortKey('2081/82', 'Q1'),
    periodLabel: periodText || 'Latest Reported',
  };

  const { sector, sectorGroup } = classifySectorGroup(
    audit.symbol,
    audit.companyName,
    audit.sector
  );
  const metrics = createEmptyMetrics();

  const setIf = (
    raw: string | undefined,
    kind: 'money' | 'ratio' | 'percent',
    unit: string,
    target: keyof NormalizedFinancialMetrics
  ) => {
    const val = parseHumanNumeric(raw, kind);
    if (val !== null) {
      metrics[target] = reported(val, unit, parsedPeriod.periodLabel, 'Cached Audit');
    }
  };

  setIf(fm?.eps, 'ratio', 'NPR', 'eps');
  setIf(fm?.netProfit, 'money', 'NPR', 'netProfit');
  setIf(fm?.revenue, 'money', 'NPR', 'revenue');
  setIf(fm?.netWorthPerShare, 'ratio', 'NPR', 'bvps');
  setIf(fm?.pe, 'ratio', 'x', 'reportedPe');
  setIf(fm?.pb, 'ratio', 'x', 'reportedPb');
  setIf(fm?.roe, 'percent', '%', 'roePct');
  setIf(fm?.roa, 'percent', '%', 'roaPct');
  setIf(fm?.reserves, 'money', 'NPR', 'reserves');
  setIf(fm?.retainedEarnings, 'money', 'NPR', 'retainedEarnings');
  setIf(fm?.totalAssets, 'money', 'NPR', 'totalAssets');
  setIf(fm?.totalLiabilities, 'money', 'NPR', 'totalLiabilities');
  setIf(fm?.deposits, 'money', 'NPR', 'deposits');
  setIf(fm?.loans, 'money', 'NPR', 'loans');
  setIf(fm?.npl, 'percent', '%', 'nplPct');
  setIf(fm?.car, 'percent', '%', 'carPct');
  setIf(fm?.cashFlow, 'money', 'NPR', 'operatingCashFlow');

  // Check sector-specific KPIs (e.g. Debt/Equity, Capacity MW, Solvency)
  for (const kpi of fm?.sectorSpecific || []) {
    const lbl = (kpi.label || '').toLowerCase();
    if (lbl.includes('debt') && lbl.includes('equity')) {
      const v = parseHumanNumeric(kpi.value, 'ratio');
      if (v !== null) metrics.debtToEquity = reported(v, 'x', parsedPeriod.periodLabel, 'Cached Audit');
    } else if (lbl.includes('mw') || lbl.includes('capacity')) {
      const v = parseHumanNumeric(kpi.value, 'ratio');
      if (v !== null) metrics.installedCapacityMw = reported(v, 'MW', parsedPeriod.periodLabel, 'Cached Audit');
    } else if (lbl.includes('solvency')) {
      const v = parseHumanNumeric(kpi.value, 'ratio');
      if (v !== null) metrics.solvencyRatio = reported(v, 'x', parsedPeriod.periodLabel, 'Cached Audit');
    }
  }

  const enriched = enrichDerivedMetrics(
    metrics,
    sectorGroup,
    parsedPeriod.quarter,
    parsedPeriod.periodLabel
  );

  const rec: QuarterlyStatementRecord = {
    id: `${audit.symbol.toUpperCase()}:${parsedPeriod.fiscalYear}:${parsedPeriod.quarter}`,
    symbol: audit.symbol.toUpperCase(),
    companyName: audit.companyName || audit.symbol.toUpperCase(),
    sector,
    sectorGroup,
    fiscalYear: parsedPeriod.fiscalYear,
    quarter: parsedPeriod.quarter,
    periodLabel: parsedPeriod.periodLabel,
    sortKey: parsedPeriod.sortKey,
    publicationDate:
      audit.publicationDate && audit.publicationDate !== 'Unavailable'
        ? audit.publicationDate
        : null,
    collectionDate: audit.retrievedAt || audit.generatedAt || new Date().toISOString(),
    dataSource: 'Cached Audit',
    sourceUrl: audit.sources?.[0]?.uri || null,
    validationStatus: audit.searchGrounded ? 'CrossChecked' : 'Unverified',
    validationNotes: [...(audit.limitations || [])],
    dataQualityFlags: audit.searchGrounded ? [] : ['unverified'],
    metrics: enriched,
    lineItemsCount: 0,
  };

  const valResult = runAccountingValidation(rec);
  rec.validationStatus = valResult.validationStatus;
  rec.validationNotes = Array.from(new Set([...rec.validationNotes, ...valResult.notes]));
  rec.dataQualityFlags = Array.from(new Set([...rec.dataQualityFlags, ...valResult.flags]));

  return rec;
}

function quarterAnnualMultiplier(q: QuarterCode): number {
  if (q === 'Q1') return 4;
  if (q === 'Q2') return 2;
  if (q === 'Q3') return 4 / 3;
  return 1;
}

function emptyQ4Benchmark(): Q4ThreeYearBenchmark {
  return {
    basisLabel: 'Awaiting Q4/Annual History',
    yearsCount: 0,
    yearsUsed: [],
    annualizedFactorApplied: 1,
    currentAnnualizedEps: null,
    currentAnnualizedNetProfitCr: null,
    currentAnnualizedRevenueCr: null,
    currentRoePct: null,
    currentNetMarginPct: null,
    currentBvps: null,
    currentOcfCr: null,
    currentNplPct: null,
    avgEps: null,
    avgNetProfitCr: null,
    avgRevenueCr: null,
    avgRoePct: null,
    avgNetMarginPct: null,
    avgBvps: null,
    avgOcfCr: null,
    avgNplPct: null,
    epsVsAvgPct: null,
    netProfitVsAvgPct: null,
    revenueVsAvgPct: null,
    roeVsAvgDeltaPp: null,
    marginVsAvgDeltaPp: null,
    bvpsVsAvgPct: null,
    nplVsAvgDeltaPp: null,
    historyPoints: [],
  };
}

/**
 * Computes up to a 3-fiscal-year 4th Quarter (Q4 / Annual) baseline average
 * and compares the latest period's annualized run-rate against that 3Y Q4 average.
 */
export function computeQ4ThreeYearBenchmark(
  recordsDesc: QuarterlyStatementRecord[]
): Q4ThreeYearBenchmark {
  if (recordsDesc.length === 0) return emptyQ4Benchmark();

  const latest = recordsDesc[0];
  const mult = quarterAnnualMultiplier(latest.quarter);

  // Pick at most one Q4/Annual record per fiscal year (prefer 'Q4' over 'Annual')
  const byFy = new Map<string, QuarterlyStatementRecord>();
  for (const r of recordsDesc) {
    if (r.quarter !== 'Q4' && r.quarter !== 'Annual') continue;
    const existing = byFy.get(r.fiscalYear);
    if (!existing || (existing.quarter === 'Annual' && r.quarter === 'Q4')) {
      byFy.set(r.fiscalYear, r);
    }
  }

  const q4ListDesc = Array.from(byFy.values())
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, 3);
  const q4Chrono = [...q4ListDesc].reverse();

  const toCr = (v: number | null, factor = 1): number | null =>
    v !== null && Number.isFinite(v) ? round2((v * factor) / 1e7) : null;

  const historyPoints: Q4FiscalYearPoint[] = q4Chrono.map((r) => ({
    fiscalYear: r.fiscalYear,
    quarter: r.quarter,
    periodLabel: r.periodLabel,
    eps: r.metrics.eps.value,
    netProfitCr: toCr(r.metrics.netProfit.value, 1),
    revenueCr: toCr(r.metrics.revenue.value, 1),
    roePct: r.metrics.roePct.value,
    netMarginPct: r.metrics.netProfitMarginPct.value,
    bvps: r.metrics.bvps.value,
    ocfCr: toCr(r.metrics.operatingCashFlow.value, 1),
    nplPct: r.metrics.nplPct.value,
  }));

  const mean = (vals: Array<number | null>): number | null => {
    const clean = vals.filter((v): v is number => v !== null && Number.isFinite(v));
    if (clean.length === 0) return null;
    return round2(clean.reduce((s, v) => s + v, 0) / clean.length);
  };

  const pctDiff = (cur: number | null, avg: number | null): number | null => {
    if (cur === null || avg === null || avg <= 0) return null;
    return round2(((cur - avg) / Math.abs(avg)) * 100);
  };

  const ppDiff = (cur: number | null, avg: number | null): number | null => {
    if (cur === null || avg === null) return null;
    return round2(cur - avg);
  };

  const currentAnnualizedEps = latest.metrics.eps.value;
  const currentAnnualizedNetProfitCr = toCr(latest.metrics.netProfit.value, mult);
  const currentAnnualizedRevenueCr = toCr(latest.metrics.revenue.value, mult);
  const currentRoePct = latest.metrics.roePct.value;
  const currentNetMarginPct = latest.metrics.netProfitMarginPct.value;
  const currentBvps = latest.metrics.bvps.value;
  const currentOcfCr = toCr(latest.metrics.operatingCashFlow.value, mult);
  const currentNplPct = latest.metrics.nplPct.value;

  const avgEps = mean(historyPoints.map((p) => p.eps));
  const avgNetProfitCr = mean(historyPoints.map((p) => p.netProfitCr));
  const avgRevenueCr = mean(historyPoints.map((p) => p.revenueCr));
  const avgRoePct = mean(historyPoints.map((p) => p.roePct));
  const avgNetMarginPct = mean(historyPoints.map((p) => p.netMarginPct));
  const avgBvps = mean(historyPoints.map((p) => p.bvps));
  const avgOcfCr = mean(historyPoints.map((p) => p.ocfCr));
  const avgNplPct = mean(historyPoints.map((p) => p.nplPct));

  const yearsCount = historyPoints.length;
  const yearsUsed = historyPoints.map((h) => h.fiscalYear);
  const basisLabel =
    yearsCount >= 3
      ? `3-Year Q4 Avg (${yearsUsed[0]}–${yearsUsed[yearsUsed.length - 1]})`
      : yearsCount === 2
        ? `2-Year Q4 Avg (${yearsUsed.join(', ')})`
        : yearsCount === 1
          ? `1-Year Q4 Baseline (${yearsUsed[0]})`
          : 'Awaiting Q4/Annual History';

  return {
    basisLabel,
    yearsCount,
    yearsUsed,
    annualizedFactorApplied: round2(mult),
    currentAnnualizedEps,
    currentAnnualizedNetProfitCr,
    currentAnnualizedRevenueCr,
    currentRoePct,
    currentNetMarginPct,
    currentBvps,
    currentOcfCr,
    currentNplPct,
    avgEps,
    avgNetProfitCr,
    avgRevenueCr,
    avgRoePct,
    avgNetMarginPct,
    avgBvps,
    avgOcfCr,
    avgNplPct,
    epsVsAvgPct: pctDiff(currentAnnualizedEps, avgEps),
    netProfitVsAvgPct: pctDiff(currentAnnualizedNetProfitCr, avgNetProfitCr),
    revenueVsAvgPct: pctDiff(currentAnnualizedRevenueCr, avgRevenueCr),
    roeVsAvgDeltaPp: ppDiff(currentRoePct, avgRoePct),
    marginVsAvgDeltaPp: ppDiff(currentNetMarginPct, avgNetMarginPct),
    bvpsVsAvgPct: pctDiff(currentBvps, avgBvps),
    nplVsAvgDeltaPp: ppDiff(currentNplPct, avgNplPct),
    historyPoints,
  };
}

/**
 * Computes QoQ, YoY, 3-Year CAGR, 5-Year CAGR, and 3-Year Q4 average benchmark
 * strictly from verified historical records.
 */
export function computeGrowthComparisons(
  recordsDesc: QuarterlyStatementRecord[]
): GrowthComparisons {
  const q4Benchmark = computeQ4ThreeYearBenchmark(recordsDesc);

  if (recordsDesc.length === 0) {
    return {
      epsQoqPct: null,
      epsYoyPct: null,
      epsCagr3yPct: null,
      epsCagr5yPct: null,
      netProfitQoqPct: null,
      netProfitYoyPct: null,
      netProfitCagr3yPct: null,
      netProfitCagr5yPct: null,
      revenueQoqPct: null,
      revenueYoyPct: null,
      revenueCagr3yPct: null,
      revenueCagr5yPct: null,
      bvpsYoyPct: null,
      bvpsCagr3yPct: null,
      bvpsCagr5yPct: null,
      periodsAvailable: 0,
      fiscalYearsAvailable: 0,
      q4Benchmark,
    };
  }

  const latest = recordsDesc[0];
  const prevQuarter = recordsDesc[1] ?? null;
  const latestBsYear = extractStartBsYear(latest.fiscalYear);

  const findYearsBack = (years: number): QuarterlyStatementRecord | null => {
    if (latestBsYear === null) return null;
    const targetYear = latestBsYear - years;
    // Prefer same quarter N years ago; fallback to Annual of that fiscal year
    const exactQ = recordsDesc.find(
      (r) => extractStartBsYear(r.fiscalYear) === targetYear && r.quarter === latest.quarter
    );
    if (exactQ) return exactQ;
    return (
      recordsDesc.find(
        (r) => extractStartBsYear(r.fiscalYear) === targetYear && r.quarter === 'Annual'
      ) ?? null
    );
  };

  const r1y = findYearsBack(1);
  const r3y = findYearsBack(3);
  const r5y = findYearsBack(5);

  const pctChange = (cur: number | null, prev: number | null): number | null => {
    if (cur === null || prev === null || prev <= 0) return null;
    return round2(((cur - prev) / Math.abs(prev)) * 100);
  };

  const cagr = (cur: number | null, past: number | null, years: number): number | null => {
    if (cur === null || past === null || cur <= 0 || past <= 0) return null;
    return round2((Math.pow(cur / past, 1 / years) - 1) * 100);
  };

  const uniqueYears = new Set(recordsDesc.map((r) => r.fiscalYear));

  return {
    epsQoqPct: pctChange(latest.metrics.eps.value, prevQuarter?.metrics.eps.value ?? null),
    epsYoyPct: pctChange(latest.metrics.eps.value, r1y?.metrics.eps.value ?? null),
    epsCagr3yPct: cagr(latest.metrics.eps.value, r3y?.metrics.eps.value ?? null, 3),
    epsCagr5yPct: cagr(latest.metrics.eps.value, r5y?.metrics.eps.value ?? null, 5),

    netProfitQoqPct: pctChange(
      latest.metrics.netProfit.value,
      prevQuarter?.metrics.netProfit.value ?? null
    ),
    netProfitYoyPct: pctChange(
      latest.metrics.netProfit.value,
      r1y?.metrics.netProfit.value ?? null
    ),
    netProfitCagr3yPct: cagr(
      latest.metrics.netProfit.value,
      r3y?.metrics.netProfit.value ?? null,
      3
    ),
    netProfitCagr5yPct: cagr(
      latest.metrics.netProfit.value,
      r5y?.metrics.netProfit.value ?? null,
      5
    ),

    revenueQoqPct: pctChange(
      latest.metrics.revenue.value,
      prevQuarter?.metrics.revenue.value ?? null
    ),
    revenueYoyPct: pctChange(
      latest.metrics.revenue.value,
      r1y?.metrics.revenue.value ?? null
    ),
    revenueCagr3yPct: cagr(
      latest.metrics.revenue.value,
      r3y?.metrics.revenue.value ?? null,
      3
    ),
    revenueCagr5yPct: cagr(
      latest.metrics.revenue.value,
      r5y?.metrics.revenue.value ?? null,
      5
    ),

    bvpsYoyPct: pctChange(latest.metrics.bvps.value, r1y?.metrics.bvps.value ?? null),
    bvpsCagr3yPct: cagr(latest.metrics.bvps.value, r3y?.metrics.bvps.value ?? null, 3),
    bvpsCagr5yPct: cagr(latest.metrics.bvps.value, r5y?.metrics.bvps.value ?? null, 5),

    periodsAvailable: recordsDesc.length,
    fiscalYearsAvailable: uniqueYears.size,
    q4Benchmark,
  };
}

export interface CompanyLedgerFile {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  updatedAt: string;
  records: QuarterlyStatementRecord[];
  officialSources: Array<{ title: string; uri: string; category: string }>;
}

/**
 * Structured multi-period fundamental repository stored in `data/financial/vault/`.
 */
export class FundamentalVault {
  private readonly dataDir: string;
  public readonly finDir: string;
  public readonly vaultDir: string;
  public readonly ledgersDir: string;
  private cache = new Map<string, CompanyLedgerFile>();
  private initialized = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.finDir = path.resolve(dataDir, 'financial');
    this.vaultDir = path.resolve(this.finDir, 'vault');
    this.ledgersDir = path.resolve(this.vaultDir, 'ledgers');
    if (!fs.existsSync(this.ledgersDir)) {
      fs.mkdirSync(this.ledgersDir, { recursive: true });
    }
  }

  public initIfNeeded(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.loadAllFromDisk();
    this.seedFromExistingDatasets();
  }

  private safeLedgerPath(symbol: string): string {
    const clean = symbol.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
    const p = path.resolve(this.ledgersDir, `${clean}.json`);
    if (!p.startsWith(this.ledgersDir + path.sep)) {
      throw new Error('Unsafe ledger path');
    }
    return p;
  }

  private loadAllFromDisk(): void {
    if (!fs.existsSync(this.ledgersDir)) return;
    const files = fs.readdirSync(this.ledgersDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(path.join(this.ledgersDir, file), 'utf8')
        ) as CompanyLedgerFile;
        if (parsed && parsed.symbol) {
          this.cache.set(parsed.symbol.toUpperCase(), parsed);
        }
      } catch {
        // skip corrupt ledger
      }
    }
  }

  /**
   * Imports existing ShareSansar `data/financial/*.json` and `data/.fundamental-intel.json`
   * into deduplicated multi-period ledgers without overwriting richer ShareSansar primary records.
   */
  public seedFromExistingDatasets(): void {
    // 1. Seed from `data/financial/*.json`
    if (fs.existsSync(this.finDir)) {
      const files = fs.readdirSync(this.finDir).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        try {
          const snap = JSON.parse(
            fs.readFileSync(path.join(this.finDir, f), 'utf8')
          ) as CompanyFinancialSnapshot;
          if (snap?.symbol && Array.isArray(snap.tabs)) {
            const recs = normalizeShareSansarSnapshot(snap);
            for (const rec of recs) {
              this.upsertStatementRecord(rec, []);
            }
          }
        } catch {
          // ignore
        }
      }
    }

    // 2. Seed from `data/.fundamental-intel.json`
    const intelPath = path.resolve(this.dataDir, '.fundamental-intel.json');
    if (fs.existsSync(intelPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(intelPath, 'utf8')) as Record<
          string,
          StockResearchResponse
        >;
        for (const audit of Object.values(raw)) {
          if (!audit?.symbol) continue;
          const rec = normalizeCachedAuditRecord(audit);
          if (rec) {
            this.upsertStatementRecord(
              rec,
              (audit.sources || []).map((s) => ({
                title: s.title,
                uri: s.uri,
                category: s.category || 'Financial Portal',
              }))
            );
          }
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * Deduplicates by (symbol, fiscalYear, quarter) and preserves historical records.
   * ShareSansar / ShareSansar + Official Search take precedence over Cached Audit when merging same period.
   */
  public upsertStatementRecord(
    record: QuarterlyStatementRecord,
    sources: Array<{ title: string; uri: string; category: string }> = []
  ): CompanyLedgerFile {
    const sym = record.symbol.toUpperCase();
    const existing = this.cache.get(sym) ?? {
      symbol: sym,
      companyName: record.companyName,
      sector: record.sector,
      sectorGroup: record.sectorGroup,
      updatedAt: new Date().toISOString(),
      records: [],
      officialSources: [],
    };

    const idx = existing.records.findIndex((r) => r.id === record.id);
    if (idx === -1) {
      existing.records.push(record);
    } else {
      const prev = existing.records[idx];
      const priority = (src: QuarterlyStatementRecord['dataSource']) =>
        src === 'ShareSansar + Official Search'
          ? 3
          : src === 'ShareSansar'
            ? 2
            : src === 'NEPSE/Official'
              ? 2
              : 1;

      if (priority(record.dataSource) >= priority(prev.dataSource)) {
        // Preserve any non-unavailable fields from previous record (e.g. OCF or publicationDate) if new doesn't have them
        const mergedMetrics = { ...record.metrics };
        for (const k of Object.keys(mergedMetrics) as Array<keyof NormalizedFinancialMetrics>) {
          if (mergedMetrics[k].value === null && prev.metrics[k]?.value !== null) {
            mergedMetrics[k] = prev.metrics[k];
          }
        }
        existing.records[idx] = {
          ...record,
          publicationDate: record.publicationDate || prev.publicationDate,
          metrics: mergedMetrics,
        };
      }
    }

    // Sort newest first
    existing.records.sort((a, b) => b.sortKey - a.sortKey);
    if (record.companyName && record.companyName !== sym) {
      existing.companyName = record.companyName;
    }
    existing.sector = record.sector;
    existing.sectorGroup = record.sectorGroup;
    existing.updatedAt = new Date().toISOString();

    if (sources.length > 0) {
      const seenUris = new Set(existing.officialSources.map((s) => s.uri));
      for (const s of sources) {
        if (s.uri && !seenUris.has(s.uri)) {
          seenUris.add(s.uri);
          existing.officialSources.push(s);
        }
      }
    }

    this.cache.set(sym, existing);
    try {
      fs.writeFileSync(
        this.safeLedgerPath(sym),
        JSON.stringify(existing, null, 2),
        'utf8'
      );
    } catch {
      // ignore write issues
    }
    return existing;
  }

  public getCompanyLedger(symbol: string): CompanyLedgerFile | null {
    this.initIfNeeded();
    return this.cache.get(symbol.trim().toUpperCase()) ?? null;
  }

  public getAllLedgers(): CompanyLedgerFile[] {
    this.initIfNeeded();
    return Array.from(this.cache.values());
  }

  public selectRecordForPeriod(
    ledger: CompanyLedgerFile,
    fiscalYear?: string,
    quarter?: QuarterCode
  ): QuarterlyStatementRecord | null {
    if (!ledger.records.length) return null;
    if (!fiscalYear && !quarter) return ledger.records[0];
    const match = ledger.records.find(
      (r) =>
        (!fiscalYear || r.fiscalYear === fiscalYear) &&
        (!quarter || r.quarter === quarter)
    );
    return match ?? null;
  }

  /**
   * Returns true if primary quarterly financial statement data for (symbol, fiscalYear, quarter)
   * already exists in the vault, so scraping can be skipped safely.
   */
  public hasQuarterData(
    symbol: string,
    fiscalYear: string,
    quarter: QuarterCode
  ): boolean {
    const ledger = this.getCompanyLedger(symbol);
    if (!ledger || ledger.records.length === 0) return false;
    return ledger.records.some(
      (r) =>
        r.fiscalYear === fiscalYear &&
        r.quarter === quarter &&
        r.dataSource !== 'Cached Audit' &&
        (r.metrics.eps.value !== null ||
          r.metrics.netProfit.value !== null ||
          r.metrics.netWorth.value !== null ||
          r.metrics.totalAssets.value !== null ||
          r.metrics.revenue.value !== null)
    );
  }

  /**
   * Builds and writes a consolidated long-format CSV (`data/financial/vault/quarterly_metrics.csv`)
   * combining all companies and all historical + upcoming quarters (1 row per Symbol × FiscalYear × Quarter).
   */
  public writeConsolidatedQuarterlyCsv(): string {
    this.initIfNeeded();
    const outPath = path.resolve(this.vaultDir, 'quarterly_metrics.csv');
    const headers = [
      'Symbol',
      'CompanyName',
      'Sector',
      'SectorGroup',
      'FiscalYear',
      'Quarter',
      'PeriodLabel',
      'SortKey',
      'EPS_NPR',
      'NetProfit_Cr',
      'Revenue_Cr',
      'NetMargin_Pct',
      'ROE_Pct',
      'ROA_Pct',
      'BVPS_NPR',
      'NetWorth_Cr',
      'TotalAssets_Cr',
      'DebtToEquity',
      'NPL_Pct',
      'CAR_Pct',
      'DataSource',
      'ValidationStatus',
      'CollectionDate',
    ];

    const toCr = (v: number | null) =>
      v !== null && Number.isFinite(v) ? (v / 10_000_000).toFixed(4) : '';
    const toNum = (v: number | null, digits = 2) =>
      v !== null && Number.isFinite(v) ? v.toFixed(digits) : '';

    const rows: Array<Array<string | number | null>> = [];
    const ledgers = this.getAllLedgers().sort((a, b) => a.symbol.localeCompare(b.symbol));
    for (const ledger of ledgers) {
      const sortedRecs = [...ledger.records].sort((a, b) => b.sortKey - a.sortKey);
      for (const r of sortedRecs) {
        const m = r.metrics;
        rows.push([
          r.symbol,
          r.companyName,
          r.sector,
          r.sectorGroup,
          r.fiscalYear,
          r.quarter,
          r.periodLabel,
          r.sortKey,
          toNum(m.eps.value),
          toCr(m.netProfit.value),
          toCr(m.revenue.value),
          toNum(m.netProfitMarginPct.value),
          toNum(m.roePct.value),
          toNum(m.roaPct.value),
          toNum(m.bvps.value),
          toCr(m.netWorth.value),
          toCr(m.totalAssets.value),
          toNum(m.debtToEquity.value),
          toNum(m.nplPct.value),
          toNum(m.carPct.value),
          r.dataSource,
          r.validationStatus,
          r.collectionDate,
        ]);
      }
    }

    const csv = buildSpreadsheetExport('csv', [
      {
        name: 'Quarterly Metrics',
        headers,
        rows,
      },
    ]);
    fs.writeFileSync(outPath, csv.body, 'utf8');
    return outPath;
  }
}

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function xmlEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates UTF-8 BOM CSV or Excel-compatible SpreadsheetML (.xls) XML workbook
 * from tabular sheet definitions.
 */
export function buildSpreadsheetExport(
  format: 'csv' | 'excel',
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Array<Array<string | number | null | undefined>>;
  }>
): { contentType: string; extension: string; body: string } {
  if (format === 'csv') {
    const primary = sheets[0];
    const lines = [
      primary.headers.map(csvCell).join(','),
      ...primary.rows.map((r) => r.map(csvCell).join(',')),
    ];
    // UTF-8 BOM ensures Microsoft Excel opens Nepali/Unicode text cleanly
    return {
      contentType: 'text/csv; charset=utf-8',
      extension: 'csv',
      body: '\uFEFF' + lines.join('\n') + '\n',
    };
  }

  const worksheetsXml = sheets
    .map((sheet) => {
      const safeName = sheet.name.replace(/[\\/*?:\[\]]/g, '').slice(0, 31) || 'Sheet';
      const headerRow = `<Row>${sheet.headers
        .map(
          (h) =>
            `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`
        )
        .join('')}</Row>`;
      const dataRows = sheet.rows
        .map(
          (row) =>
            `<Row>${row
              .map((cell) => {
                if (typeof cell === 'number' && Number.isFinite(cell)) {
                  return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
                }
                return `<Cell><Data ss:Type="String">${xmlEscape(cell ?? '')}</Data></Cell>`;
              })
              .join('')}</Row>`
        )
        .join('\n');
      return `<Worksheet ss:Name="${xmlEscape(safeName)}"><Table>${headerRow}\n${dataRows}</Table></Worksheet>`;
    })
    .join('\n');

  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${worksheetsXml}
</Workbook>`;

  return {
    contentType: 'application/vnd.ms-excel; charset=utf-8',
    extension: 'xls',
    body: workbook,
  };
}
