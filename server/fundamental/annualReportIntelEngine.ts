import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import type {
  AnnualReportAiDeepDive,
  AnnualReportAiFyDistillation,
  AnnualReportIngestResponse,
  AnnualReportIntelligenceResponse,
  AnnualReportPillarAssessment,
  AnnualReportPillarId,
  AnnualReportPillarStatus,
  AnnualReportUniverseCandidate,
  AnnualReportUniverseResponse,
  AnnualTrendPoint,
  CompanyKnowledgeBaseEntry,
  ComparisonMetricDeltaRow,
  FiscalYearComparisonMatrix,
  FiscalYearMetricSnapshot,
  FiscalYearReportAnalysis,
  FiscalYearYoYDeltas,
  NepalFiscalYearContext,
  QuarterCode,
  QuarterlyStatementRecord,
  SectorGroup,
} from '../../src/types/fundamental.ts';
import type { StockResearchResponse } from '../../src/types/market.ts';
import { getSavedFinancials } from '../financialScraper.ts';
import type { MarketStore } from '../marketStore.ts';
import { loadAllFundamentalAudits, loadMacroSnapshot } from '../riskEngine.ts';
import { buildCompanyValuationDossier } from './annualValuationEngine.ts';
import { FundamentalVault } from './fundamentalVault.ts';
import { evaluateScreenerUniverse } from './investorScoringEngine.ts';
import {
  extractStartBsYear,
  getNepalFiscalYearCalendarContext,
  normalizeFiscalYear,
  quarterOrderValue,
} from './nepalCalendar.ts';
import { RegulatoryKnowledgeBase } from './regulatoryKnowledgeBase.ts';
import { getSectorThresholds } from './sectorMethodology.ts';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toCr(v: number | null | undefined): number | null {
  return v !== null && v !== undefined && Number.isFinite(v) ? round2(v / 1e7) : null;
}

function pctChange(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || !Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (Math.abs(prev) < 1e-9) return null;
  return round1(((curr - prev) / Math.abs(prev)) * 100);
}

function ppDelta(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || !Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  return round2(curr - prev);
}

function fmtRs(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'Unavailable';
  return `Rs ${v.toFixed(digits)}`;
}

function fmtCr(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'Unavailable';
  return `Rs ${v.toFixed(2)} Cr`;
}

function fmtPct(v: number | null | undefined, signed = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'Unavailable';
  const sign = signed && v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function fmtX(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'Unavailable';
  return `${v.toFixed(2)}x`;
}

function cachePathFor(vault: FundamentalVault): string {
  return path.join(vault.vaultDir, 'annual-deep-dive-cache.json');
}

interface DeepDiveCacheShape {
  [key: string]: AnnualReportAiDeepDive | AnnualReportAiFyDistillation;
}

function loadRawCache(vault: FundamentalVault): DeepDiveCacheShape {
  try {
    const file = cachePathFor(vault);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as DeepDiveCacheShape)
      : {};
  } catch {
    return {};
  }
}

function saveRawCache(vault: FundamentalVault, cache: DeepDiveCacheShape): void {
  try {
    if (!fs.existsSync(vault.vaultDir)) fs.mkdirSync(vault.vaultDir, { recursive: true });
    fs.writeFileSync(cachePathFor(vault), JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // ignore disk cache write failure
  }
}

function isFyDistillation(v: unknown): v is AnnualReportAiFyDistillation {
  return Boolean(
    v &&
      typeof v === 'object' &&
      'fiscalYear' in v &&
      'managementQualityNotes' in v &&
      'upcomingBusinessPlans' in v
  );
}

function getAiFyDistillation(
  cache: DeepDiveCacheShape,
  symbol: string,
  fiscalYear: string
): AnnualReportAiFyDistillation | null {
  const key = `${symbol.toUpperCase()}:${fiscalYear}`;
  const entry = cache[key];
  return isFyDistillation(entry) ? entry : null;
}

function getLegacyDeepDive(
  cache: DeepDiveCacheShape,
  symbol: string
): AnnualReportAiDeepDive | null {
  const entry = cache[symbol.toUpperCase()];
  if (entry && typeof entry === 'object' && 'managementGuidanceAndCatalysts' in entry) {
    return entry as AnnualReportAiDeepDive;
  }
  return null;
}

function countAiDistilledFysForSymbol(cache: DeepDiveCacheShape, symbol: string): number {
  const prefix = `${symbol.toUpperCase()}:`;
  let count = 0;
  for (const [k, v] of Object.entries(cache)) {
    if (k.startsWith(prefix) && isFyDistillation(v)) count++;
  }
  if (count === 0 && getLegacyDeepDive(cache, symbol)) count = 1;
  return count;
}

function getAiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add it in Settings > Secrets to distill annual reports with live AI search.'
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

function quarterBasisFor(q: QuarterCode): FiscalYearReportAnalysis['basis'] {
  if (q === 'Annual') return 'Audited Annual';
  if (q === 'Q4') return 'Q4 Full-Year Unaudited';
  return 'Interim Quarterly';
}

interface AnnualTargetResolution {
  fiscalContext: NepalFiscalYearContext;
  recommendedAnnualFy: string | null;
  aiDistillTargetFy: string;
  currentInterimFy: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
}

function resolveNepalAnnualTarget(params: {
  recordsByFy: Map<string, QuarterlyStatementRecord[]>;
  cache: DeepDiveCacheShape;
  symbol: string;
  now?: Date;
}): AnnualTargetResolution {
  const { recordsByFy, cache, symbol, now } = params;
  const fiscalContext = getNepalFiscalYearCalendarContext(now);
  const {
    currentFy,
    currentStartBs,
    latestCompletedFy,
    previousCompletedFy,
    poushEndApproxDate,
    poushEndPassed,
    daysUntilPoushEnd,
  } = fiscalContext;

  const repForFy = (fy: string): QuarterlyStatementRecord | null => {
    const arr = recordsByFy.get(fy);
    if (!arr || arr.length === 0) return null;
    return [...arr].sort((a, b) => quarterOrderValue(b.quarter) - quarterOrderValue(a.quarter))[0];
  };

  const currentInterimFy = recordsByFy.has(currentFy) ? currentFy : null;
  const latestCompRec = repForFy(latestCompletedFy);
  const latestCompAi = getAiFyDistillation(cache, symbol, latestCompletedFy);

  // Completed FYs strictly older than currentFy (from both statement records and ingested/AI distillations)
  const completedFySet = new Set<string>();
  for (const fy of recordsByFy.keys()) {
    const y = extractStartBsYear(fy);
    if (y !== null && y < currentStartBs) completedFySet.add(fy);
  }
  const cachePrefix = `${symbol.toUpperCase()}:`;
  for (const [k, v] of Object.entries(cache)) {
    if (!k.startsWith(cachePrefix) || !isFyDistillation(v)) continue;
    const y = extractStartBsYear(v.fiscalYear);
    if (y !== null && y < currentStartBs) completedFySet.add(v.fiscalYear);
  }

  const completedFysDesc = Array.from(completedFySet).sort(
    (a, b) => (extractStartBsYear(b) ?? 0) - (extractStartBsYear(a) ?? 0)
  );

  const olderFysDesc = completedFysDesc.filter((fy) => fy !== latestCompletedFy);
  const olderAuditedFy =
    olderFysDesc.find(
      (fy) =>
        repForFy(fy)?.quarter === 'Annual' || Boolean(getAiFyDistillation(cache, symbol, fy))
    ) ?? null;
  const olderPreferredFy = olderAuditedFy ?? olderFysDesc[0] ?? null;
  const prevCompAi = getAiFyDistillation(cache, symbol, previousCompletedFy);

  // Rule:
  // 1) If latestCompletedFy (e.g. 2082/83) has an Audited Annual statement or an ingested/AI Annual distillation, use it.
  // 2) If Poush end has passed (e.g. after ~Jan 14, 2027), latestCompletedFy (2082/83) Annual Report period has closed,
  //    so target latestCompletedFy (2082/83) even if Q4/AI is used.
  // 3) Before Poush end, if latestCompletedFy does NOT have an Audited Annual report on file,
  //    fall back to the previous FY (2081/82 or newest completed FY < 2082/83).
  if (latestCompRec?.quarter === 'Annual' || latestCompAi) {
    return {
      fiscalContext,
      recommendedAnnualFy: latestCompletedFy,
      aiDistillTargetFy: latestCompletedFy,
      currentInterimFy,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  if (poushEndPassed && latestCompRec) {
    return {
      fiscalContext,
      recommendedAnnualFy: latestCompletedFy,
      aiDistillTargetFy: latestCompletedFy,
      currentInterimFy,
      fallbackUsed: false,
      fallbackReason: null,
    };
  }

  if (poushEndPassed) {
    // Poush end passed, but neither 2082/83 statements nor AI cache exists locally; target latestCompletedFy for AI distillation
    const recFy = olderPreferredFy ?? (prevCompAi ? previousCompletedFy : null);
    return {
      fiscalContext,
      recommendedAnnualFy: recFy,
      aiDistillTargetFy: latestCompletedFy,
      currentInterimFy,
      fallbackUsed: recFy !== null && recFy !== latestCompletedFy,
      fallbackReason:
        recFy && recFy !== latestCompletedFy
          ? `FY ${latestCompletedFy} statements are not yet indexed locally; showing ${recFy} while targeting FY ${latestCompletedFy} for AI distillation.`
          : null,
    };
  }

  // Before Poush end AND 2082/83 Annual Report is not yet audited/available
  const fallbackFy = olderPreferredFy ?? (prevCompAi ? previousCompletedFy : null);
  const aiTarget = olderPreferredFy ?? previousCompletedFy;
  const latestStatusNote = latestCompRec
    ? `only unaudited ${latestCompRec.quarter} data is indexed for FY ${latestCompletedFy}`
    : `no audited FY ${latestCompletedFy} Annual Report is available`;

  return {
    fiscalContext,
    recommendedAnnualFy: fallbackFy,
    aiDistillTargetFy: aiTarget,
    currentInterimFy,
    fallbackUsed: true,
    fallbackReason: `Current Nepal FY is ${currentFy} and Poush end (~${poushEndApproxDate}, ${daysUntilPoushEnd}d remaining) has not crossed; ${latestStatusNote}. Defaulting Annual Report analysis & AI distillation to previous FY ${aiTarget}.`,
  };
}

function extractSnapshot(rec: QuarterlyStatementRecord): FiscalYearMetricSnapshot {
  const m = rec.metrics;
  return {
    revenueCr: toCr(m.revenue.value),
    netProfitCr: toCr(m.netProfit.value),
    operatingProfitCr: toCr(m.operatingProfit.value),
    eps: m.eps.value !== null ? round2(m.eps.value) : null,
    bvps: m.bvps.value !== null ? round2(m.bvps.value) : null,
    netWorthCr: toCr(m.netWorth.value),
    reservesCr: toCr(m.reserves.value),
    retainedEarningsCr: toCr(m.retainedEarnings.value),
    shareCapitalCr: toCr(m.shareCapital.value),
    totalAssetsCr: toCr(m.totalAssets.value),
    totalLiabilitiesCr: toCr(m.totalLiabilities.value),
    totalDebtCr: toCr(m.totalDebt.value),
    cashCr: toCr(m.cashAndEquivalents.value),
    debtToEquity: m.debtToEquity.value !== null ? round2(m.debtToEquity.value) : null,
    operatingCashFlowCr: toCr(m.operatingCashFlow.value),
    freeCashFlowCr: toCr(m.freeCashFlow.value),
    roePct: m.roePct.value !== null ? round2(m.roePct.value) : null,
    roaPct: m.roaPct.value !== null ? round2(m.roaPct.value) : null,
    roicPct: m.roicPct.value !== null ? round2(m.roicPct.value) : null,
    netMarginPct: m.netProfitMarginPct.value !== null ? round2(m.netProfitMarginPct.value) : null,
    reportedPe: m.reportedPe.value !== null ? round2(m.reportedPe.value) : null,
    reportedPb: m.reportedPb.value !== null ? round2(m.reportedPb.value) : null,
    dividendYieldPct: m.dividendYieldPct.value !== null ? round2(m.dividendYieldPct.value) : null,
    payoutRatioPct: m.payoutRatioPct.value !== null ? round2(m.payoutRatioPct.value) : null,
    depositsCr: toCr(m.deposits.value),
    loansCr: toCr(m.loans.value),
    nplPct: m.nplPct.value !== null ? round2(m.nplPct.value) : null,
    carPct: m.carPct.value !== null ? round2(m.carPct.value) : null,
    cdRatioPct: m.cdRatioPct.value !== null ? round2(m.cdRatioPct.value) : null,
    costOfFundsPct: m.costOfFundsPct.value !== null ? round2(m.costOfFundsPct.value) : null,
    netPremiumCr: toCr(m.netPremium.value),
    claimRatioPct: m.claimRatioPct.value !== null ? round2(m.claimRatioPct.value) : null,
    solvencyRatio: m.solvencyRatio.value !== null ? round2(m.solvencyRatio.value) : null,
    installedCapacityMw:
      m.installedCapacityMw.value !== null ? round2(m.installedCapacityMw.value) : null,
  };
}

function buildEightPillarsForFy(params: {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  rec: QuarterlyStatementRecord;
  snap: FiscalYearMetricSnapshot;
  yoy: FiscalYearYoYDeltas;
  isLatest: boolean;
  basis: FiscalYearReportAnalysis['basis'];
  kbEntry: CompanyKnowledgeBaseEntry | null;
  auditCache: StockResearchResponse | null;
  aiFy: AnnualReportAiFyDistillation | null;
  legacyAi: AnnualReportAiDeepDive | null;
  benchmarkFdRatePct: number;
  ltp: number | null;
  marginOfSafetyPct: number | null;
}): Record<AnnualReportPillarId, AnnualReportPillarAssessment> {
  const {
    symbol,
    companyName,
    sector,
    sectorGroup,
    rec,
    snap,
    yoy,
    isLatest,
    basis,
    kbEntry,
    auditCache,
    aiFy,
    legacyAi,
    benchmarkFdRatePct,
    ltp,
    marginOfSafetyPct,
  } = params;

  const cfg = getSectorThresholds(sectorGroup);
  const isBfi = sectorGroup === 'Banking' || sectorGroup === 'Microfinance';
  const isInsurer = sectorGroup === 'Insurance';
  const reserveRatio =
    snap.reservesCr !== null && snap.shareCapitalCr !== null && snap.shareCapitalCr > 0
      ? round2(snap.reservesCr / snap.shareCapitalCr)
      : null;

  const useLegacyAi = isLatest && !aiFy && legacyAi;

  // 1. Management Quality
  const mgmtFindings: string[] = [];
  if (aiFy?.managementQualityNotes.length) {
    mgmtFindings.push(...aiFy.managementQualityNotes);
  }
  if (aiFy?.auditorAndGovernanceNotes.length) {
    mgmtFindings.push(...aiFy.auditorAndGovernanceNotes);
  }
  if (useLegacyAi && legacyAi.auditorAndGovernanceFindings.length) {
    mgmtFindings.push(...legacyAi.auditorAndGovernanceFindings);
  }
  if (snap.roePct !== null) {
    mgmtFindings.push(
      snap.roePct >= cfg.strongRoePct
        ? `Capital deployment generated ${snap.roePct.toFixed(1)}% ROE, outperforming the ${cfg.strongRoePct}% sector quality hurdle.`
        : snap.roePct >= cfg.minRoePct
          ? `ROE of ${snap.roePct.toFixed(1)}% clears the minimum ${cfg.minRoePct}% threshold but leaves room for capital efficiency gains.`
          : `Sub-hurdle ROE of ${snap.roePct.toFixed(1)}% (below ${cfg.minRoePct}% sector bar) signals muted return on shareholders' equity.`
    );
  }
  if (reserveRatio !== null) {
    mgmtFindings.push(
      reserveRatio >= 0.85
        ? `Strong internal capital retention with Reserves/Paid-Up Capital at ${reserveRatio.toFixed(2)}x (${fmtCr(snap.reservesCr)} reserves).`
        : `Reserves stand at ${reserveRatio.toFixed(2)}x of paid-up capital (${fmtCr(snap.reservesCr)}), constraining aggressive bonus/dividend payouts.`
    );
  }
  if (isBfi && snap.carPct !== null) {
    mgmtFindings.push(
      `Regulatory capital stewardship shows CAR at ${snap.carPct.toFixed(1)}% with NPL at ${fmtPct(snap.nplPct)}.`
    );
  }
  if (kbEntry) {
    const ratingGrade = kbEntry.creditRating?.ratingGrade;
    mgmtFindings.push(
      `Regulatory KB standing is "${kbEntry.regulatoryStanding}"${ratingGrade ? ` (${ratingGrade}, Outlook: ${kbEntry.creditRating.outlook})` : ''}.`
    );
  }
  if (rec.validationStatus === 'Verified' || rec.validationStatus === 'CrossChecked') {
    mgmtFindings.push(`Financial statement disclosure status is ${rec.validationStatus} with transparent balance-sheet reconciliation.`);
  } else {
    mgmtFindings.push(`Disclosure status is marked ${rec.validationStatus}; verify full audited notes and AGM annexures.`);
  }
  if (mgmtFindings.length === 0) {
    mgmtFindings.push(`Governance and capital allocation baseline awaits full ${rec.fiscalYear} disclosure line items.`);
  }

  let mgmtStatus: AnnualReportPillarStatus = 'Solid';
  if (
    kbEntry?.regulatoryStanding === 'Alert' ||
    (isBfi && cfg.maxNplPct !== null && snap.nplPct !== null && snap.nplPct > cfg.maxNplPct) ||
    (snap.roePct !== null && snap.roePct < 5)
  ) {
    mgmtStatus = 'Fragile';
  } else if (
    (snap.roePct !== null && snap.roePct >= cfg.strongRoePct) &&
    (reserveRatio === null || reserveRatio >= 0.6) &&
    kbEntry?.regulatoryStanding !== 'Watch'
  ) {
    mgmtStatus = 'Strong';
  } else if (
    (snap.roePct !== null && snap.roePct < cfg.minRoePct) ||
    kbEntry?.regulatoryStanding === 'Watch' ||
    rec.validationStatus === 'Unverified'
  ) {
    mgmtStatus = 'Watch';
  }

  const mgmtSummary =
    aiFy?.managementQualityNotes[0] ||
    (mgmtStatus === 'Strong'
      ? `Leadership demonstrates disciplined capital allocation (${fmtPct(snap.roePct)} ROE) and sound governance standing.`
      : mgmtStatus === 'Fragile'
        ? `Capital efficiency or regulatory asset-quality pressure warrants heightened governance scrutiny.`
        : `Execution and capital allocation remain functional, though return metrics or disclosure verification leave room for improvement.`);

  // 2. Growth
  const growthFindings: string[] = [];
  if (aiFy?.growthHighlights.length) {
    growthFindings.push(...aiFy.growthHighlights);
  }
  if (yoy.revenueYoYPct !== null) {
    growthFindings.push(
      `Top-line revenue ${yoy.revenueYoYPct >= 0 ? 'expanded' : 'contracted'} ${fmtPct(yoy.revenueYoYPct, true)} YoY vs FY ${yoy.priorFiscalYear} to ${fmtCr(snap.revenueCr)}.`
    );
  } else if (snap.revenueCr !== null) {
    growthFindings.push(`Recorded ${fmtCr(snap.revenueCr)} in top-line revenue for ${rec.periodLabel}.`);
  }
  if (yoy.netProfitYoYPct !== null) {
    growthFindings.push(
      `Net profit ${yoy.netProfitYoYPct >= 0 ? 'grew' : 'declined'} ${fmtPct(yoy.netProfitYoYPct, true)} YoY to ${fmtCr(snap.netProfitCr)}.`
    );
  } else if (snap.netProfitCr !== null) {
    growthFindings.push(`Bottom-line net profit stood at ${fmtCr(snap.netProfitCr)} (${fmtPct(snap.netMarginPct)} net margin).`);
  }
  if (yoy.epsYoYPct !== null) {
    growthFindings.push(`EPS shifted ${fmtPct(yoy.epsYoYPct, true)} YoY to ${fmtRs(snap.eps, 2)}.`);
  } else if (snap.eps !== null) {
    growthFindings.push(`Annualized/reported EPS stands at ${fmtRs(snap.eps, 2)} on ${fmtRs(snap.bvps, 1)} BVPS.`);
  }
  if (yoy.assetsYoYPct !== null) {
    growthFindings.push(
      `Balance sheet scale ${yoy.assetsYoYPct >= 0 ? 'grew' : 'shrank'} ${fmtPct(yoy.assetsYoYPct, true)} YoY to ${fmtCr(snap.totalAssetsCr)} in total assets.`
    );
  } else if (isBfi && snap.loansCr !== null && snap.depositsCr !== null) {
    growthFindings.push(
      `Core banking book holds ${fmtCr(snap.depositsCr)} in deposits and ${fmtCr(snap.loansCr)} in loans & advances.`
    );
  } else if (isInsurer && snap.netPremiumCr !== null) {
    growthFindings.push(`Underwriting scale reached ${fmtCr(snap.netPremiumCr)} in net premium.`);
  } else if (snap.installedCapacityMw !== null) {
    growthFindings.push(`Operating generation footprint stands at ${snap.installedCapacityMw.toFixed(1)} MW.`);
  }

  let growthStatus: AnnualReportPillarStatus = 'Solid';
  if ((yoy.netProfitYoYPct !== null && yoy.netProfitYoYPct >= 15) || (yoy.epsYoYPct !== null && yoy.epsYoYPct >= 12)) {
    growthStatus = 'Strong';
  } else if (
    (yoy.netProfitYoYPct !== null && yoy.netProfitYoYPct < -10) ||
    (yoy.revenueYoYPct !== null && yoy.revenueYoYPct < -10) ||
    (snap.netProfitCr !== null && snap.netProfitCr <= 0)
  ) {
    growthStatus = 'Fragile';
  } else if (
    (yoy.netProfitYoYPct !== null && yoy.netProfitYoYPct < 0) ||
    (yoy.epsYoYPct !== null && yoy.epsYoYPct < 0)
  ) {
    growthStatus = 'Watch';
  }

  const growthSummary =
    aiFy?.growthHighlights[0] ||
    (yoy.netProfitYoYPct !== null
      ? `Net profit ${yoy.netProfitYoYPct >= 0 ? 'rose' : 'fell'} ${fmtPct(yoy.netProfitYoYPct, true)} YoY alongside ${fmtPct(yoy.revenueYoYPct, true)} revenue change.`
      : `${rec.periodLabel} baseline captures ${fmtCr(snap.revenueCr)} revenue, ${fmtCr(snap.netProfitCr)} profit, and ${fmtRs(snap.eps, 2)} EPS.`);

  // 3. Business Opportunities
  const oppFindings: string[] = [];
  if (aiFy?.businessOpportunities.length) {
    oppFindings.push(...aiFy.businessOpportunities);
  } else if (useLegacyAi && legacyAi.annualReportOpportunities.length) {
    oppFindings.push(...legacyAi.annualReportOpportunities);
  }
  if (auditCache?.opportunityBreakdown?.length) {
    for (const o of auditCache.opportunityBreakdown.slice(0, 2)) {
      if (o.evidence) oppFindings.push(`${o.factor}: ${o.evidence}`);
    }
  }
  if (isBfi && snap.cdRatioPct !== null && snap.cdRatioPct < 84) {
    oppFindings.push(
      `CD ratio of ${snap.cdRatioPct.toFixed(1)}% sits well under the 90% NRB ceiling, providing ample liquidity headroom for credit expansion.`
    );
  }
  if (isBfi && snap.costOfFundsPct !== null && snap.costOfFundsPct <= 6.0) {
    oppFindings.push(
      `Low cost of funds (${snap.costOfFundsPct.toFixed(2)}%) supports net interest spread resilience as credit demand recovers.`
    );
  }
  if (reserveRatio !== null && reserveRatio >= 0.8) {
    oppFindings.push(
      `Substantial reserve cushion (${reserveRatio.toFixed(2)}x paid-up capital) supports self-funded growth or bonus capitalization without diluting shareholders.`
    );
  }
  if (isLatest && marginOfSafetyPct !== null && marginOfSafetyPct >= 10) {
    oppFindings.push(
      `Valuation rerating upside: current price offers a +${marginOfSafetyPct.toFixed(1)}% Margin of Safety against composite intrinsic value.`
    );
  }
  const kbRatingGrade = kbEntry?.creditRating?.ratingGrade;
  if (kbRatingGrade && /^(AAA|AA|A)/i.test(kbRatingGrade.replace(/\[.*?\]\s*/, ''))) {
    oppFindings.push(
      `Investment-grade credit profile (${kbRatingGrade}) enables lower-cost institutional funding and partner confidence.`
    );
  }
  if (oppFindings.length === 0) {
    oppFindings.push(
      `Core ${sector} market positioning and NEPSE interest-rate normalization (${benchmarkFdRatePct.toFixed(1)}% FD benchmark) offer cyclical recovery optionality.`
    );
  }

  const oppStatus: AnnualReportPillarStatus =
    oppFindings.length >= 3 || (isLatest && (marginOfSafetyPct ?? 0) >= 15) ? 'Strong' : 'Solid';

  const oppSummary =
    oppFindings[0] ||
    `Operational headroom and ${sector} industry positioning underpin medium-term expansion opportunities.`;

  // 4. Risks
  const riskFindings: string[] = [];
  if (aiFy?.keyRisks.length) {
    riskFindings.push(...aiFy.keyRisks);
  } else if (useLegacyAi && legacyAi.annualReportRisks.length) {
    riskFindings.push(...legacyAi.annualReportRisks);
  }
  if (auditCache?.fundamentalRedFlags?.length) {
    riskFindings.push(...auditCache.fundamentalRedFlags.slice(0, 3));
  }
  if (auditCache?.governanceRegulatoryFlags?.length) {
    riskFindings.push(...auditCache.governanceRegulatoryFlags.slice(0, 2));
  }
  if (isBfi && snap.nplPct !== null && snap.nplPct > 3.5) {
    riskFindings.push(
      `Asset-quality credit risk: NPL ratio at ${snap.nplPct.toFixed(2)}% increases provisioning pressure and constrains distributable profit.`
    );
  }
  if (!isBfi && !isInsurer && cfg.maxDebtToEquity !== null && snap.debtToEquity !== null && snap.debtToEquity > cfg.maxDebtToEquity) {
    riskFindings.push(
      `Financial leverage risk: Debt-to-Equity of ${snap.debtToEquity.toFixed(2)}x exceeds the ${cfg.maxDebtToEquity.toFixed(1)}x sector comfort band.`
    );
  }
  if (isInsurer && snap.claimRatioPct !== null && snap.claimRatioPct > 65) {
    riskFindings.push(
      `Underwriting loss risk: Claim ratio of ${snap.claimRatioPct.toFixed(1)}% pressures combined operating profitability.`
    );
  }
  if (kbEntry?.lockInOverhangFlag) {
    riskFindings.push(`Supply overhang risk: Promoter/anchor share lock-in expiry overhang flagged in Regulatory KB.`);
  }
  if (isLatest && snap.reportedPe !== null && snap.reportedPe > 0 && 100 / snap.reportedPe < benchmarkFdRatePct) {
    riskFindings.push(
      `Valuation compression risk: Earnings yield (${(100 / snap.reportedPe).toFixed(1)}%) trails the ${benchmarkFdRatePct.toFixed(1)}% risk-free bank FD rate.`
    );
  }
  if (riskFindings.length === 0) {
    riskFindings.push(`Sector-wide regulatory shifts, interest-rate cycles, and credit/demand cyclicality in ${sector}.`);
  }

  let riskStatus: AnnualReportPillarStatus = 'Solid';
  if (
    (isBfi && cfg.maxNplPct !== null && snap.nplPct !== null && snap.nplPct > cfg.maxNplPct) ||
    (!isBfi && !isInsurer && cfg.maxDebtToEquity !== null && snap.debtToEquity !== null && snap.debtToEquity > cfg.maxDebtToEquity * 1.3) ||
    kbEntry?.regulatoryStanding === 'Alert'
  ) {
    riskStatus = 'Fragile';
  } else if (riskFindings.length >= 2 || (isBfi && (snap.nplPct ?? 0) > 3.0)) {
    riskStatus = 'Watch';
  }

  const riskSummary =
    riskFindings[0] || `Monitor sector cyclicality, leverage, and regulatory compliance across ${rec.fiscalYear}.`;

  // 5. Weaknesses
  const weakFindings: string[] = [];
  if (aiFy?.weaknesses.length) {
    weakFindings.push(...aiFy.weaknesses);
  } else if (useLegacyAi && legacyAi.annualReportWeaknesses.length) {
    weakFindings.push(...legacyAi.annualReportWeaknesses);
  }
  if (snap.roePct !== null && snap.roePct < cfg.minRoePct) {
    weakFindings.push(
      `Low return on equity (${snap.roePct.toFixed(1)}% vs ${cfg.minRoePct}% sector threshold) highlights muted capital productivity.`
    );
  }
  if (snap.netMarginPct !== null && snap.netMarginPct < 10 && !isInsurer) {
    weakFindings.push(
      `Thin net profit margin (${snap.netMarginPct.toFixed(1)}%) leaves limited buffer against revenue or cost shocks.`
    );
  }
  if (!isBfi && !isInsurer && snap.operatingCashFlowCr === null) {
    weakFindings.push(`Operating cash flow is not disclosed in summary statements, limiting cash-conversion verification.`);
  } else if (
    snap.operatingCashFlowCr !== null &&
    snap.netProfitCr !== null &&
    snap.netProfitCr > 0 &&
    snap.operatingCashFlowCr < snap.netProfitCr * 0.65
  ) {
    weakFindings.push(
      `Cash conversion lag: OCF (${fmtCr(snap.operatingCashFlowCr)}) trails reported net profit (${fmtCr(snap.netProfitCr)}).`
    );
  }
  if (reserveRatio !== null && reserveRatio < 0.35) {
    weakFindings.push(
      `Thin reserve buffer (${reserveRatio.toFixed(2)}x paid-up capital) limits internal reinvestment and dividend consistency.`
    );
  }
  if (yoy.epsYoYPct !== null && yoy.epsYoYPct < -5) {
    weakFindings.push(`EPS contracted ${fmtPct(yoy.epsYoYPct, true)} YoY, reflecting either margin pressure or equity dilution.`);
  }
  if (weakFindings.length === 0) {
    weakFindings.push(`No acute structural balance-sheet weakness surfaced in available ${rec.fiscalYear} disclosures; continue monitoring margin & cash conversion.`);
  }

  const weakStatus: AnnualReportPillarStatus =
    weakFindings.length >= 3 || (snap.netProfitCr !== null && snap.netProfitCr <= 0)
      ? 'Fragile'
      : weakFindings.length >= 2 || (snap.roePct !== null && snap.roePct < cfg.minRoePct)
        ? 'Watch'
        : 'Solid';

  const weakSummary =
    weakFindings[0] || `Structural profile shows manageable limitations within ${sector} norms.`;

  // 6. Uncertainties
  const uncFindings: string[] = [];
  if (aiFy?.uncertainties.length) {
    uncFindings.push(...aiFy.uncertainties);
  }
  if (basis !== 'Audited Annual') {
    uncFindings.push(
      `Audited Annual Report reconciliation pending: ${rec.fiscalYear} figures currently rely on ${rec.periodLabel} (${basis}) disclosures, so year-end provisions, tax adjustments, and auditor notes remain subject to final AGM audit.`
    );
  }
  if (rec.dataQualityFlags.includes('incomplete') || rec.dataQualityFlags.includes('unverified')) {
    uncFindings.push(
      `Data completeness caveat (${rec.dataQualityFlags.join(', ')}): missing cash-flow or line-item schedules require verification against full annual financial footnotes.`
    );
  }
  if (auditCache?.limitations?.length) {
    uncFindings.push(...auditCache.limitations.slice(0, 2));
  }
  if (isBfi) {
    uncFindings.push(
      `NRB monetary-policy, provisioning, and dividend-cap circulars alongside borrower recovery cycles create forward earnings uncertainty.`
    );
  } else if (sectorGroup === 'Hydropower') {
    uncFindings.push(
      `Hydrology seasonality, NEA transmission evacuation, and monsoon generation variance introduce year-to-year revenue uncertainty.`
    );
  } else {
    uncFindings.push(
      `Domestic credit conditions, input-cost inflation, and regulatory policy adjustments may alter near-term demand and margin realization.`
    );
  }

  const uncStatus: AnnualReportPillarStatus =
    basis !== 'Audited Annual' || rec.dataQualityFlags.length > 0 ? 'Watch' : 'Solid';

  const uncSummary =
    uncFindings[0] || `Forward outlook remains subject to macro conditions and full audited disclosure updates.`;

  // 7. Upcoming Business Plans
  const planFindings: string[] = [];
  if (aiFy?.upcomingBusinessPlans.length) {
    planFindings.push(...aiFy.upcomingBusinessPlans);
  } else if (useLegacyAi && legacyAi.managementGuidanceAndCatalysts.length) {
    planFindings.push(...legacyAi.managementGuidanceAndCatalysts);
  }
  if (aiFy?.dividendAndBonusDeclared.length) {
    planFindings.push(...aiFy.dividendAndBonusDeclared);
  } else if (useLegacyAi && legacyAi.dividendAndBonusHistory.length) {
    planFindings.push(...legacyAi.dividendAndBonusHistory);
  }
  if (auditCache?.catalysts?.length) {
    planFindings.push(
      ...auditCache.catalysts
        .slice(0, 3)
        .map((c) => `${c.headline}${c.timeframe ? ` (${c.timeframe})` : ''}`)
    );
  }
  if (planFindings.length === 0) {
    if (isBfi) {
      planFindings.push(
        `Focus on digital banking expansion, selective SME/retail loan book growth (CD ratio ${fmtPct(snap.cdRatioPct)}), and NPL recovery drives.`
      );
    } else if (sectorGroup === 'Hydropower') {
      planFindings.push(
        `Priority on plant availability optimization, PPA revenue collection, and debt deleveraging or pipeline project commissioning.`
      );
    } else {
      planFindings.push(
        `Operational capacity utilization, working-capital discipline, and margin defense initiatives; run AI Distillation to extract exact AGM CapEx & project announcements.`
      );
    }
  }

  const planStatus: AnnualReportPillarStatus =
    aiFy?.upcomingBusinessPlans.length || useLegacyAi ? 'Strong' : 'Watch';

  const planSummary =
    planFindings[0] ||
    `Strategic expansion and capital deployment plans derived from available disclosures and sector catalysts.`;

  // 8. Business Direction
  const dirFindings: string[] = [];
  if (aiFy?.businessDirection) {
    dirFindings.push(aiFy.businessDirection);
  } else if (useLegacyAi && legacyAi.futureWorthOutlook) {
    dirFindings.push(legacyAi.futureWorthOutlook);
  }
  if (yoy.assetsYoYPct !== null && yoy.netProfitYoYPct !== null) {
    if (yoy.netProfitYoYPct > yoy.assetsYoYPct && yoy.netProfitYoYPct > 0) {
      dirFindings.push(
        `Profitability-led trajectory: bottom-line profit (+${yoy.netProfitYoYPct.toFixed(1)}%) outpaced balance-sheet expansion (+${yoy.assetsYoYPct.toFixed(1)}%), indicating improving operating leverage.`
      );
    } else if (yoy.assetsYoYPct > 10 && yoy.netProfitYoYPct < 0) {
      dirFindings.push(
        `Expansion-heavy phase: asset base expanded +${yoy.assetsYoYPct.toFixed(1)}% while net profit softened (${yoy.netProfitYoYPct.toFixed(1)}%), typical of gestation/investment cycles.`
      );
    }
  }
  if (reserveRatio !== null && reserveRatio >= 1.0 && (snap.roePct ?? 0) >= cfg.minRoePct) {
    dirFindings.push(
      `Positioned as a balance-sheet compounder backed by ${reserveRatio.toFixed(2)}x reserves-to-capital and sustainable internal compounding.`
    );
  } else {
    dirFindings.push(
      `${companyName} is navigating ${sector} market cycles with emphasis on core balance-sheet stability${ltp !== null ? ` at LTP Rs ${ltp.toFixed(0)}` : ''}.`
    );
  }

  const dirStatus: AnnualReportPillarStatus =
    aiFy?.businessDirection ? 'Strong' : mgmtStatus === 'Strong' ? 'Strong' : 'Solid';

  const dirSummary =
    aiFy?.businessDirection ||
    (useLegacyAi ? legacyAi.futureWorthOutlook : dirFindings[0]);

  const metricPack = {
    managementQuality: [
      { label: 'ROE', value: fmtPct(snap.roePct) },
      { label: 'Reserve / Capital', value: fmtX(reserveRatio) },
      {
        label: isBfi ? 'CAR / NPL' : 'Disclosure Status',
        value: isBfi ? `${fmtPct(snap.carPct)} / ${fmtPct(snap.nplPct)}` : rec.validationStatus,
      },
    ],
    growth: [
      { label: 'Revenue', value: fmtCr(snap.revenueCr), note: yoy.revenueYoYPct !== null ? `YoY ${fmtPct(yoy.revenueYoYPct, true)}` : undefined },
      { label: 'Net Profit', value: fmtCr(snap.netProfitCr), note: yoy.netProfitYoYPct !== null ? `YoY ${fmtPct(yoy.netProfitYoYPct, true)}` : undefined },
      { label: 'EPS', value: fmtRs(snap.eps, 2), note: yoy.epsYoYPct !== null ? `YoY ${fmtPct(yoy.epsYoYPct, true)}` : undefined },
    ],
    businessOpportunities: [
      { label: 'Margin of Safety', value: isLatest ? fmtPct(marginOfSafetyPct, true) : 'Historical FY' },
      { label: 'Reserves', value: fmtCr(snap.reservesCr) },
      {
        label: isBfi ? 'CD Ratio' : 'ROIC / ROA',
        value: isBfi ? fmtPct(snap.cdRatioPct) : fmtPct(snap.roicPct ?? snap.roaPct),
      },
    ],
    risks: [
      { label: isBfi ? 'NPL %' : 'Debt / Equity', value: isBfi ? fmtPct(snap.nplPct) : fmtX(snap.debtToEquity) },
      { label: 'Total Liabilities', value: fmtCr(snap.totalLiabilitiesCr) },
      { label: 'Reg. Standing', value: kbEntry?.regulatoryStanding ?? 'Unindexed' },
    ],
    weaknesses: [
      { label: 'Net Margin', value: fmtPct(snap.netMarginPct) },
      { label: 'OCF', value: fmtCr(snap.operatingCashFlowCr) },
      { label: 'ROA', value: fmtPct(snap.roaPct) },
    ],
    uncertainties: [
      { label: 'Report Basis', value: basis },
      { label: 'Data Source', value: rec.dataSource },
      { label: 'Flags', value: rec.dataQualityFlags.length ? rec.dataQualityFlags.join(', ') : 'None' },
    ],
    upcomingBusinessPlans: [
      { label: 'Total Assets', value: fmtCr(snap.totalAssetsCr) },
      { label: 'Retained Earnings', value: fmtCr(snap.retainedEarningsCr) },
      { label: 'AI Plan Distilled', value: aiFy ? `Yes (${aiFy.fiscalYear})` : 'On-demand' },
    ],
    businessDirection: [
      { label: 'Net Worth', value: fmtCr(snap.netWorthCr) },
      { label: 'BVPS', value: fmtRs(snap.bvps, 1) },
      { label: 'Sector Group', value: sectorGroup },
    ],
  };

  return {
    managementQuality: {
      id: 'managementQuality',
      title: 'Management Quality',
      subtitle: 'Credibility, capital allocation, governance & execution',
      status: mgmtStatus,
      summary: mgmtSummary,
      findings: mgmtFindings.slice(0, 6),
      keyMetrics: metricPack.managementQuality,
    },
    growth: {
      id: 'growth',
      title: 'Growth',
      subtitle: 'Revenue, profit, EPS, assets & operational expansion',
      status: growthStatus,
      summary: growthSummary,
      findings: growthFindings.slice(0, 6),
      keyMetrics: metricPack.growth,
    },
    businessOpportunities: {
      id: 'businessOpportunities',
      title: 'Business Opportunities',
      subtitle: 'Expansion avenues, competitive advantages & industry trends',
      status: oppStatus,
      summary: oppSummary,
      findings: oppFindings.slice(0, 6),
      keyMetrics: metricPack.businessOpportunities,
    },
    risks: {
      id: 'risks',
      title: 'Risks',
      subtitle: 'Financial, operational, market, regulatory & competitive risks',
      status: riskStatus,
      summary: riskSummary,
      findings: riskFindings.slice(0, 6),
      keyMetrics: metricPack.risks,
    },
    weaknesses: {
      id: 'weaknesses',
      title: 'Weaknesses',
      subtitle: 'Operational inefficiencies, financial constraints & structural gaps',
      status: weakStatus,
      summary: weakSummary,
      findings: weakFindings.slice(0, 6),
      keyMetrics: metricPack.weaknesses,
    },
    uncertainties: {
      id: 'uncertainties',
      title: 'Uncertainties',
      subtitle: 'Unresolved issues, pending audits & forward sensitivities',
      status: uncStatus,
      summary: uncSummary,
      findings: uncFindings.slice(0, 6),
      keyMetrics: metricPack.uncertainties,
    },
    upcomingBusinessPlans: {
      id: 'upcomingBusinessPlans',
      title: 'Upcoming Business Plans',
      subtitle: 'Planned CapEx, expansion projects, dividends & strategic initiatives',
      status: planStatus,
      summary: planSummary,
      findings: planFindings.slice(0, 6),
      keyMetrics: metricPack.upcomingBusinessPlans,
    },
    businessDirection: {
      id: 'businessDirection',
      title: 'Business Direction',
      subtitle: 'Long-term vision, strategic priorities & transformation posture',
      status: dirStatus,
      summary: dirSummary,
      findings: dirFindings.slice(0, 6),
      keyMetrics: metricPack.businessDirection,
    },
  };
}

function buildComparisonMatrix(
  fiscalYearsDesc: FiscalYearReportAnalysis[],
  sectorGroup: SectorGroup,
  preferredLatestFy?: string | null
): FiscalYearComparisonMatrix | null {
  if (fiscalYearsDesc.length === 0) return null;
  const preferredIdx = preferredLatestFy
    ? fiscalYearsDesc.findIndex((f) => f.fiscalYear === preferredLatestFy)
    : 0;
  const startIdx = preferredIdx >= 0 ? preferredIdx : 0;
  const latest = fiscalYearsDesc[startIdx];
  const prior = startIdx + 1 < fiscalYearsDesc.length ? fiscalYearsDesc[startIdx + 1] : null;
  const isBfi = sectorGroup === 'Banking' || sectorGroup === 'Microfinance';
  const isInsurer = sectorGroup === 'Insurance';

  if (!prior) {
    return {
      latestFy: latest.fiscalYear,
      priorFy: null,
      hasMultiYearComparison: false,
      headlineSummary: `Only FY ${latest.fiscalYear} (${latest.periodLabel}) is currently indexed in the vault for ${latest.metrics.revenueCr !== null ? 'this company' : 'analysis'}. Scrape or run AI Distillation on prior fiscal years to unlock YoY structural comparison.`,
      metricDeltas: [],
      managementPerformanceShift: {
        status: 'Single-FY Only',
        summary: `Single fiscal year (${latest.fiscalYear}) on file; prior-year baseline required for multi-year management trend assessment.`,
        points: [
          `Current ROE sits at ${fmtPct(latest.metrics.roePct)} with Net Worth of ${fmtCr(latest.metrics.netWorthCr)}.`,
          latest.aiDistillation?.strategicComparisonVsPriorFy[0] ||
            'Run AI Distillation on this FY to extract management commentary comparing current execution against the previous AGM cycle.',
        ],
      },
      strategyAndDirectionShifts: latest.aiDistillation?.strategicComparisonVsPriorFy ?? [
        `Current posture reflects ${latest.pillars.businessDirection.summary}`,
      ],
      progressAgainstPriorPlans: latest.pillars.upcomingBusinessPlans.findings.slice(0, 3),
      emergingOpportunities: latest.pillars.businessOpportunities.findings.slice(0, 3),
      emergingRisksAndWeaknesses: [
        ...latest.pillars.risks.findings.slice(0, 2),
        ...latest.pillars.weaknesses.findings.slice(0, 1),
      ],
      efficiencyAndCapitalTrend: [
        `Net Profit Margin: ${fmtPct(latest.metrics.netMarginPct)} · ROA: ${fmtPct(latest.metrics.roaPct)}`,
        `Reserves: ${fmtCr(latest.metrics.reservesCr)} · Total Assets: ${fmtCr(latest.metrics.totalAssetsCr)}`,
      ],
    };
  }

  const lm = latest.metrics;
  const pm = prior.metrics;

  const makeDelta = (
    key: string,
    label: string,
    unit: string,
    latestVal: number | null,
    priorVal: number | null,
    higherIsBetter: boolean,
    isPointMetric = false
  ): ComparisonMetricDeltaRow => {
    const absDelta =
      latestVal !== null && priorVal !== null ? round2(latestVal - priorVal) : null;
    const pctDelta = isPointMetric ? null : pctChange(latestVal, priorVal);
    let direction: ComparisonMetricDeltaRow['direction'] = 'unavailable';
    let interpretation = 'Awaiting comparable figure in both fiscal years.';

    if (absDelta !== null) {
      const thresh = unit === '%' ? 0.25 : unit === 'x' ? 0.05 : 0.01;
      if (Math.abs(absDelta) < thresh) {
        direction = 'neutral';
        interpretation = `Flat vs FY ${prior.fiscalYear}.`;
      } else {
        const isUp = absDelta > 0;
        const good = higherIsBetter ? isUp : !isUp;
        direction = good ? 'improved' : 'deteriorated';
        const deltaStr = isPointMetric
          ? `${absDelta >= 0 ? '+' : ''}${absDelta.toFixed(2)}${unit === '%' ? ' pp' : unit}`
          : `${absDelta >= 0 ? '+' : ''}${absDelta.toFixed(2)} ${unit} (${fmtPct(pctDelta, true)})`;
        interpretation = `${good ? 'Improved' : 'Softened'} by ${deltaStr} vs FY ${prior.fiscalYear}.`;
      }
    }

    return {
      key,
      label,
      unit,
      latestVal,
      priorVal,
      absDelta,
      pctDelta,
      direction,
      interpretation,
    };
  };

  const metricDeltas: ComparisonMetricDeltaRow[] = [
    makeDelta('revenueCr', 'Revenue', 'Cr', lm.revenueCr, pm.revenueCr, true),
    makeDelta('netProfitCr', 'Net Profit', 'Cr', lm.netProfitCr, pm.netProfitCr, true),
    makeDelta('eps', 'EPS', 'Rs', lm.eps, pm.eps, true),
    makeDelta('bvps', 'BVPS', 'Rs', lm.bvps, pm.bvps, true),
    makeDelta('netWorthCr', 'Net Worth', 'Cr', lm.netWorthCr, pm.netWorthCr, true),
    makeDelta('totalAssetsCr', 'Total Assets', 'Cr', lm.totalAssetsCr, pm.totalAssetsCr, true),
    makeDelta('reservesCr', 'Reserves', 'Cr', lm.reservesCr, pm.reservesCr, true),
    makeDelta('roePct', 'ROE', '%', lm.roePct, pm.roePct, true, true),
    makeDelta('roaPct', 'ROA', '%', lm.roaPct, pm.roaPct, true, true),
    makeDelta('netMarginPct', 'Net Margin', '%', lm.netMarginPct, pm.netMarginPct, true, true),
  ];

  if (isBfi) {
    metricDeltas.push(
      makeDelta('depositsCr', 'Deposits', 'Cr', lm.depositsCr, pm.depositsCr, true),
      makeDelta('loansCr', 'Loans & Advances', 'Cr', lm.loansCr, pm.loansCr, true),
      makeDelta('nplPct', 'NPL Ratio', '%', lm.nplPct, pm.nplPct, false, true),
      makeDelta('carPct', 'Capital Adequacy (CAR)', '%', lm.carPct, pm.carPct, true, true)
    );
  } else if (isInsurer) {
    metricDeltas.push(
      makeDelta('netPremiumCr', 'Net Premium', 'Cr', lm.netPremiumCr, pm.netPremiumCr, true),
      makeDelta('claimRatioPct', 'Claim Ratio', '%', lm.claimRatioPct, pm.claimRatioPct, false, true),
      makeDelta('solvencyRatio', 'Solvency Ratio', 'x', lm.solvencyRatio, pm.solvencyRatio, true, true)
    );
  } else {
    metricDeltas.push(
      makeDelta('debtToEquity', 'Debt / Equity', 'x', lm.debtToEquity, pm.debtToEquity, false, true),
      makeDelta('totalDebtCr', 'Total Debt', 'Cr', lm.totalDebtCr, pm.totalDebtCr, false)
    );
  }

  const improvedCount = metricDeltas.filter((d) => d.direction === 'improved').length;
  const deterioratedCount = metricDeltas.filter((d) => d.direction === 'deteriorated').length;

  let mgmtShiftStatus: FiscalYearComparisonMatrix['managementPerformanceShift']['status'] = 'Stable';
  const roeDiff = ppDelta(lm.roePct, pm.roePct);
  const marginDiff = ppDelta(lm.netMarginPct, pm.netMarginPct);

  if (
    (roeDiff !== null && roeDiff >= 1.5) ||
    (improvedCount >= deterioratedCount + 2 && (roeDiff ?? 0) >= 0)
  ) {
    mgmtShiftStatus = 'Improving';
  } else if (
    (roeDiff !== null && roeDiff <= -1.5) ||
    deterioratedCount >= improvedCount + 2
  ) {
    mgmtShiftStatus = 'Deteriorating';
  }

  const mgmtPoints: string[] = [];
  if (roeDiff !== null) {
    mgmtPoints.push(
      `ROE moved ${roeDiff >= 0 ? '+' : ''}${roeDiff.toFixed(2)} pp (${fmtPct(pm.roePct)} → ${fmtPct(lm.roePct)}).`
    );
  }
  if (marginDiff !== null) {
    mgmtPoints.push(
      `Net margin shifted ${marginDiff >= 0 ? '+' : ''}${marginDiff.toFixed(2)} pp (${fmtPct(pm.netMarginPct)} → ${fmtPct(lm.netMarginPct)}).`
    );
  }
  const resPct = pctChange(lm.reservesCr, pm.reservesCr);
  if (resPct !== null) {
    mgmtPoints.push(`Reserve buffer changed ${fmtPct(resPct, true)} (${fmtCr(pm.reservesCr)} → ${fmtCr(lm.reservesCr)}).`);
  }
  if (isBfi && lm.nplPct !== null && pm.nplPct !== null) {
    const nplD = round2(lm.nplPct - pm.nplPct);
    mgmtPoints.push(
      `Asset quality (NPL) shifted ${nplD >= 0 ? '+' : ''}${nplD.toFixed(2)} pp (${pm.nplPct.toFixed(2)}% → ${lm.nplPct.toFixed(2)}%).`
    );
  }

  const strategyShifts: string[] = [
    ...(latest.aiDistillation?.strategicComparisonVsPriorFy ?? []),
  ];
  if (strategyShifts.length === 0) {
    const assetsPct = pctChange(lm.totalAssetsCr, pm.totalAssetsCr);
    const revPct = pctChange(lm.revenueCr, pm.revenueCr);
    if (assetsPct !== null && revPct !== null) {
      strategyShifts.push(
        assetsPct > revPct + 5
          ? `Balance sheet expanded faster (+${assetsPct.toFixed(1)}%) than revenue (${fmtPct(revPct, true)}), pointing to asset-base buildout or capital retention ahead of earnings realization.`
          : `Revenue trajectory (${fmtPct(revPct, true)}) matched or outpaced asset growth (${fmtPct(assetsPct, true)}), showing tighter asset utilization.`
      );
    }
    if (isBfi && lm.cdRatioPct !== null && pm.cdRatioPct !== null) {
      strategyShifts.push(
        `Credit-to-deposit deployment moved from ${pm.cdRatioPct.toFixed(1)}% to ${lm.cdRatioPct.toFixed(1)}%, reflecting ${lm.cdRatioPct > pm.cdRatioPct ? 'more aggressive lending deployment' : 'defensive liquidity preservation'}.`
      );
    }
  }

  const progressPlans: string[] = [];
  const profitPct = pctChange(lm.netProfitCr, pm.netProfitCr);
  if (profitPct !== null) {
    progressPlans.push(
      `Earnings delivery: Net profit moved ${fmtPct(profitPct, true)} from ${fmtCr(pm.netProfitCr)} in FY ${prior.fiscalYear} to ${fmtCr(lm.netProfitCr)} in FY ${latest.fiscalYear}.`
    );
  }
  const nwPct = pctChange(lm.netWorthCr, pm.netWorthCr);
  if (nwPct !== null) {
    progressPlans.push(
      `Equity compounding: Shareholder net worth moved ${fmtPct(nwPct, true)} to ${fmtCr(lm.netWorthCr)}.`
    );
  }
  if (latest.aiDistillation?.upcomingBusinessPlans.length) {
    progressPlans.push(...latest.aiDistillation.upcomingBusinessPlans.slice(0, 2));
  }

  const emergingOpportunities: string[] = [];
  if (lm.roePct !== null && pm.roePct !== null && lm.roePct > pm.roePct) {
    emergingOpportunities.push(`Expanding ROE (${pm.roePct.toFixed(1)}% → ${lm.roePct.toFixed(1)}%) strengthens compounding capacity.`);
  }
  if (isBfi && lm.nplPct !== null && pm.nplPct !== null && lm.nplPct < pm.nplPct) {
    emergingOpportunities.push(`Declining NPL (${pm.nplPct.toFixed(2)}% → ${lm.nplPct.toFixed(2)}%) unlocks provisioning write-back tailwinds.`);
  }
  emergingOpportunities.push(...latest.pillars.businessOpportunities.findings.slice(0, 2));

  const emergingRisks: string[] = [];
  if (isBfi && lm.nplPct !== null && pm.nplPct !== null && lm.nplPct > pm.nplPct + 0.3) {
    emergingRisks.push(`Rising NPL (${pm.nplPct.toFixed(2)}% → ${lm.nplPct.toFixed(2)}%) elevates credit-cost risk vs prior FY.`);
  }
  if (!isBfi && !isInsurer && lm.debtToEquity !== null && pm.debtToEquity !== null && lm.debtToEquity > pm.debtToEquity + 0.15) {
    emergingRisks.push(`Higher leverage (Debt/Equity ${pm.debtToEquity.toFixed(2)}x → ${lm.debtToEquity.toFixed(2)}x) increases interest sensitivity.`);
  }
  if (lm.netMarginPct !== null && pm.netMarginPct !== null && lm.netMarginPct < pm.netMarginPct - 1.5) {
    emergingRisks.push(`Margin compression (${pm.netMarginPct.toFixed(1)}% → ${lm.netMarginPct.toFixed(1)}%) weakens operational buffer.`);
  }
  if (emergingRisks.length === 0) {
    emergingRisks.push(...latest.pillars.risks.findings.slice(0, 2));
  }

  const efficiencyTrend: string[] = [];
  if (lm.roaPct !== null && pm.roaPct !== null) {
    efficiencyTrend.push(`Return on Assets shifted from ${pm.roaPct.toFixed(2)}% to ${lm.roaPct.toFixed(2)}%.`);
  }
  if (lm.eps !== null && pm.eps !== null) {
    efficiencyTrend.push(`Per-share earnings moved from ${fmtRs(pm.eps, 2)} to ${fmtRs(lm.eps, 2)}.`);
  }
  if (lm.bvps !== null && pm.bvps !== null) {
    efficiencyTrend.push(`Book value per share progressed from ${fmtRs(pm.bvps, 1)} to ${fmtRs(lm.bvps, 1)}.`);
  }

  return {
    latestFy: latest.fiscalYear,
    priorFy: prior.fiscalYear,
    hasMultiYearComparison: true,
    headlineSummary: `Comparing FY ${latest.fiscalYear} (${latest.basis}) against FY ${prior.fiscalYear} (${prior.basis}): ${improvedCount} tracked metrics improved while ${deterioratedCount} softened.`,
    metricDeltas,
    managementPerformanceShift: {
      status: mgmtShiftStatus,
      summary:
        mgmtShiftStatus === 'Improving'
          ? `Management execution strengthened vs FY ${prior.fiscalYear}, reflected across return ratios and capital retention.`
          : mgmtShiftStatus === 'Deteriorating'
            ? `Key profitability or risk indicators softened compared with FY ${prior.fiscalYear}.`
            : `Overall management execution held broadly steady relative to FY ${prior.fiscalYear}.`,
      points: mgmtPoints,
    },
    strategyAndDirectionShifts: strategyShifts.slice(0, 4),
    progressAgainstPriorPlans: progressPlans.slice(0, 4),
    emergingOpportunities: emergingOpportunities.slice(0, 4),
    emergingRisksAndWeaknesses: emergingRisks.slice(0, 4),
    efficiencyAndCapitalTrend: efficiencyTrend.slice(0, 4),
  };
}

export function getAnnualReportUniverse(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  opts: { equityOnly?: boolean; now?: Date } = {}
): AnnualReportUniverseResponse {
  const equityOnly = opts.equityOnly !== false;
  const evaluated = evaluateScreenerUniverse(store, vault, { equityOnly, now: opts.now });
  const cache = loadRawCache(vault);
  const fiscalContext = getNepalFiscalYearCalendarContext(opts.now);

  const candidates: AnnualReportUniverseCandidate[] = [];
  const sectorSet = new Set<string>();
  let multiFyCount = 0;
  let auditedAnnualCount = 0;
  let aiDistilledCount = 0;

  for (const row of evaluated.rows) {
    const ledger = vault.getCompanyLedger(row.symbol);
    if (!ledger || ledger.records.length === 0) continue;

    const recordsByFy = new Map<string, QuarterlyStatementRecord[]>();
    for (const rec of ledger.records) {
      const arr = recordsByFy.get(rec.fiscalYear) ?? [];
      arr.push(rec);
      recordsByFy.set(rec.fiscalYear, arr);
    }

    const byFy = new Map<string, QuarterlyStatementRecord>();
    for (const rec of ledger.records) {
      const prev = byFy.get(rec.fiscalYear);
      if (!prev || quarterOrderValue(rec.quarter) > quarterOrderValue(prev.quarter)) {
        byFy.set(rec.fiscalYear, rec);
      }
    }

    const resolution = resolveNepalAnnualTarget({
      recordsByFy,
      cache,
      symbol: row.symbol,
      now: opts.now,
    });

    const fysDesc = Array.from(byFy.values()).sort(
      (a, b) => (extractStartBsYear(b.fiscalYear) ?? 0) - (extractStartBsYear(a.fiscalYear) ?? 0)
    );
    const chosenRec =
      (resolution.recommendedAnnualFy ? byFy.get(resolution.recommendedAnnualFy) : null) ??
      fysDesc[0] ??
      null;
    const auditedFys = fysDesc.filter((r) => r.quarter === 'Annual').length;
    const aiFys = countAiDistilledFysForSymbol(cache, row.symbol);
    const kbEntry = kb.getCompanyEntry(row.symbol);

    if (fysDesc.length > 1) multiFyCount++;
    if (auditedFys > 0) auditedAnnualCount++;
    if (aiFys > 0) aiDistilledCount++;
    sectorSet.add(row.sector);

    candidates.push({
      symbol: row.symbol,
      companyName: row.companyName,
      sector: row.sector,
      sectorGroup: row.sectorGroup,
      ltp: row.market.ltp,
      latestFy: resolution.recommendedAnnualFy ?? chosenRec?.fiscalYear ?? null,
      aiDistillTargetFy: resolution.aiDistillTargetFy,
      currentInterimFy: resolution.currentInterimFy,
      fallbackUsed: resolution.fallbackUsed,
      latestBasis: chosenRec ? quarterBasisFor(chosenRec.quarter) : null,
      totalFyCount: fysDesc.length,
      auditedFyCount: auditedFys,
      aiDistilledFyCount: aiFys,
      eps: row.keyMetrics.eps,
      roePct: row.keyMetrics.roePct,
      netProfitCr: chosenRec ? toCr(chosenRec.metrics.netProfit.value) : null,
      revenueCr: chosenRec ? toCr(chosenRec.metrics.revenue.value) : null,
      creditRatingLabel: kbEntry?.creditRating?.ratingGrade
        ? `${kbEntry.creditRating.ratingGrade} (${kbEntry.creditRating.outlook})`
        : null,
      regulatoryStanding: kbEntry?.regulatoryStanding ?? 'Unknown',
      healthScore: Math.round(row.scores.overallScore),
    });
  }

  candidates.sort(
    (a, b) =>
      b.auditedFyCount - a.auditedFyCount ||
      b.totalFyCount - a.totalFyCount ||
      (b.healthScore ?? 0) - (a.healthScore ?? 0) ||
      a.symbol.localeCompare(b.symbol)
  );

  return {
    generatedAt: new Date().toISOString(),
    fiscalContext,
    totalCompanies: candidates.length,
    multiFyCount,
    auditedAnnualCount,
    aiDistilledCount,
    sectors: Array.from(sectorSet).sort(),
    candidates,
  };
}

function buildSyntheticAiFyAnalysis(params: {
  sym: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  aiFy: AnnualReportAiFyDistillation;
  isLatest: boolean;
  kbEntry: CompanyKnowledgeBaseEntry | null;
}): FiscalYearReportAnalysis {
  const { sym, companyName, sector, sectorGroup, aiFy, isLatest, kbEntry } = params;
  const sortYear = extractStartBsYear(aiFy.fiscalYear) ?? 0;
  const emptyMetrics: FiscalYearMetricSnapshot = {
    revenueCr: null,
    netProfitCr: null,
    operatingProfitCr: null,
    eps: null,
    bvps: null,
    netWorthCr: null,
    reservesCr: null,
    retainedEarningsCr: null,
    shareCapitalCr: null,
    totalAssetsCr: null,
    totalLiabilitiesCr: null,
    totalDebtCr: null,
    cashCr: null,
    debtToEquity: null,
    operatingCashFlowCr: null,
    freeCashFlowCr: null,
    roePct: null,
    roaPct: null,
    roicPct: null,
    netMarginPct: null,
    reportedPe: null,
    reportedPb: null,
    dividendYieldPct: null,
    payoutRatioPct: null,
    depositsCr: null,
    loansCr: null,
    nplPct: null,
    carPct: null,
    cdRatioPct: null,
    costOfFundsPct: null,
    netPremiumCr: null,
    claimRatioPct: null,
    solvencyRatio: null,
    installedCapacityMw: null,
  };

  const makePillar = (
    id: AnnualReportPillarId,
    title: string,
    subtitle: string,
    summary: string,
    findings: string[],
    status: AnnualReportPillarStatus = 'Solid'
  ): AnnualReportPillarAssessment => ({
    id,
    title,
    subtitle,
    status,
    summary,
    findings: findings.length > 0 ? findings : [`AI distillation synthesized for ${sym} FY ${aiFy.fiscalYear}.`],
    keyMetrics: [
      { label: 'Distillation Basis', value: aiFy.reportBasisLabel },
      { label: 'Credit Rating', value: kbEntry?.creditRating?.ratingGrade ?? 'Check KB' },
    ],
  });

  const pillars: Record<AnnualReportPillarId, AnnualReportPillarAssessment> = {
    managementQuality: makePillar(
      'managementQuality',
      'Management Quality & Governance',
      `Credibility, capital allocation & AGM discipline (${companyName})`,
      aiFy.managementQualityNotes[0] || `Evaluated via AI AGM & Annual Report distillation for FY ${aiFy.fiscalYear}.`,
      aiFy.managementQualityNotes
    ),
    growth: makePillar(
      'growth',
      'Growth Trajectory & Scale',
      'Revenue, profit, EPS & balance-sheet expansion',
      aiFy.growthHighlights[0] || `Annual report growth highlights for FY ${aiFy.fiscalYear}.`,
      aiFy.growthHighlights
    ),
    businessOpportunities: makePillar(
      'businessOpportunities',
      'Business Opportunities & Tailwinds',
      `Expansion vectors & competitive moat in ${sector}`,
      aiFy.businessOpportunities[0] || `Strategic opportunities identified for ${sym}.`,
      aiFy.businessOpportunities
    ),
    risks: makePillar(
      'risks',
      'Risks & Regulatory Exposure',
      'Financial, operational, market & compliance risks',
      aiFy.keyRisks[0] || 'Key risk factors disclosed in FY annual report & credit rating rationale.',
      aiFy.keyRisks,
      aiFy.keyRisks.length >= 3 ? 'Watch' : 'Solid'
    ),
    weaknesses: makePillar(
      'weaknesses',
      'Structural Weaknesses & Constraints',
      'Balance-sheet friction & operating bottlenecks',
      aiFy.weaknesses[0] || 'Structural considerations from FY disclosures.',
      aiFy.weaknesses,
      'Watch'
    ),
    uncertainties: makePillar(
      'uncertainties',
      'Forward Uncertainties & Sensitivities',
      'Macro rates, policy directives & unresolved cycles',
      aiFy.uncertainties[0] || 'Forward uncertainties tracked into the next AGM cycle.',
      aiFy.uncertainties,
      'Watch'
    ),
    upcomingBusinessPlans: makePillar(
      'upcomingBusinessPlans',
      'Upcoming Business Plans & CapEx',
      'AGM resolutions, planned expansion & capital priorities',
      aiFy.upcomingBusinessPlans[0] || `Capital allocation & dividend announcements for FY ${aiFy.fiscalYear}.`,
      [...aiFy.upcomingBusinessPlans, ...aiFy.dividendAndBonusDeclared]
    ),
    businessDirection: makePillar(
      'businessDirection',
      'Long-Term Business Direction',
      `Multi-year strategic orientation (${sectorGroup})`,
      aiFy.businessDirection,
      [aiFy.businessDirection, ...aiFy.strategicComparisonVsPriorFy]
    ),
  };

  return {
    fiscalYear: aiFy.fiscalYear,
    sortYear,
    isLatest,
    basis: 'Audited Annual',
    quarter: 'Annual',
    periodLabel: `Annual FY ${aiFy.fiscalYear} (AI Distilled)`,
    publicationDate: null,
    collectionDate: aiFy.generatedAt.slice(0, 10),
    dataSource: `AI Annual Distillation (${aiFy.model})`,
    sourceUrl: aiFy.citations[0]?.uri ?? null,
    validationStatus: 'Verified',
    validationNotes: ['Distilled from grounded AGM & Annual Report search disclosures.'],
    dataQualityFlags: [],
    metrics: emptyMetrics,
    yoyDeltas: {
      priorFiscalYear: null,
      revenueYoYPct: null,
      netProfitYoYPct: null,
      epsYoYPct: null,
      bvpsYoYPct: null,
      netWorthYoYPct: null,
      assetsYoYPct: null,
      roeDeltaPp: null,
      roaDeltaPp: null,
      netMarginDeltaPp: null,
      nplDeltaPp: null,
      carDeltaPp: null,
      debtToEquityDelta: null,
    },
    executiveSummary: aiFy.executiveSummary,
    pillars,
    lineItemHighlights: [],
    quarterHistoryInFy: [],
    aiDistillation: aiFy,
  };
}

export function buildAnnualReportIntelligence(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  symbol: string,
  opts: { equityOnly?: boolean; benchmarkFdRatePct?: number; now?: Date } = {}
): AnnualReportIntelligenceResponse | null {
  const sym = symbol.trim().toUpperCase();
  const ledger = vault.getCompanyLedger(sym);
  if (!ledger || ledger.records.length === 0) return null;

  const benchmarkFdRatePct = opts.benchmarkFdRatePct ?? 6.5;
  const dossier = buildCompanyValuationDossier(store, vault, kb, sym, {
    equityOnly: opts.equityOnly,
    benchmarkFdRatePct,
    annualWeightPct: 70,
  });

  const kbEntry = kb.getCompanyEntry(sym);
  const allAudits = loadAllFundamentalAudits(store);
  const auditCache = allAudits[sym] ?? null;
  const savedRaw = getSavedFinancials(store.dataDir, sym);
  const rawCache = loadRawCache(vault);
  const legacyDeepDive = getLegacyDeepDive(rawCache, sym);

  // Group all statements by fiscal year
  const recordsByFy = new Map<string, QuarterlyStatementRecord[]>();
  for (const rec of ledger.records) {
    const arr = recordsByFy.get(rec.fiscalYear) ?? [];
    arr.push(rec);
    recordsByFy.set(rec.fiscalYear, arr);
  }

  const resolution = resolveNepalAnnualTarget({
    recordsByFy,
    cache: rawCache,
    symbol: sym,
    now: opts.now,
  });

  // Sort FYs newest first
  const fyKeysDesc = Array.from(recordsByFy.keys()).sort(
    (a, b) => (extractStartBsYear(b) ?? 0) - (extractStartBsYear(a) ?? 0)
  );

  // Prepare representative record per FY first so we can compute YoY deltas chronologically
  const repsChrono = [...fyKeysDesc].reverse().map((fy) => {
    const recs = [...(recordsByFy.get(fy) ?? [])].sort(
      (a, b) => quarterOrderValue(b.quarter) - quarterOrderValue(a.quarter)
    );
    return {
      fy,
      sortYear: extractStartBsYear(fy) ?? 0,
      rep: recs[0],
      allRecsDesc: recs,
    };
  });

  const defaultAnnualFy =
    resolution.recommendedAnnualFy ??
    fyKeysDesc.find((fy) => fy !== resolution.fiscalContext.currentFy) ??
    fyKeysDesc[0] ??
    null;

  const fiscalYearsChrono: FiscalYearReportAnalysis[] = repsChrono.map((item) => {
    const rec = item.rep;
    const isLatest = item.fy === defaultAnnualFy;
    const basis = quarterBasisFor(rec.quarter);
    const snap = extractSnapshot(rec);
    const fyIdx = repsChrono.findIndex((r) => r.fy === item.fy);
    const prevItem = fyIdx > 0 ? repsChrono[fyIdx - 1] : null;
    const prevSnap = prevItem ? extractSnapshot(prevItem.rep) : null;

    const yoyDeltas: FiscalYearYoYDeltas = {
      priorFiscalYear: prevItem?.fy ?? null,
      revenueYoYPct: prevSnap ? pctChange(snap.revenueCr, prevSnap.revenueCr) : null,
      netProfitYoYPct: prevSnap ? pctChange(snap.netProfitCr, prevSnap.netProfitCr) : null,
      epsYoYPct: prevSnap ? pctChange(snap.eps, prevSnap.eps) : null,
      bvpsYoYPct: prevSnap ? pctChange(snap.bvps, prevSnap.bvps) : null,
      netWorthYoYPct: prevSnap ? pctChange(snap.netWorthCr, prevSnap.netWorthCr) : null,
      assetsYoYPct: prevSnap ? pctChange(snap.totalAssetsCr, prevSnap.totalAssetsCr) : null,
      roeDeltaPp: prevSnap ? ppDelta(snap.roePct, prevSnap.roePct) : null,
      roaDeltaPp: prevSnap ? ppDelta(snap.roaPct, prevSnap.roaPct) : null,
      netMarginDeltaPp: prevSnap ? ppDelta(snap.netMarginPct, prevSnap.netMarginPct) : null,
      nplDeltaPp: prevSnap ? ppDelta(snap.nplPct, prevSnap.nplPct) : null,
      carDeltaPp: prevSnap ? ppDelta(snap.carPct, prevSnap.carPct) : null,
      debtToEquityDelta: prevSnap ? ppDelta(snap.debtToEquity, prevSnap.debtToEquity) : null,
    };

    const aiFy = getAiFyDistillation(rawCache, sym, item.fy);

    const pillars = buildEightPillarsForFy({
      symbol: sym,
      companyName: ledger.companyName,
      sector: ledger.sector,
      sectorGroup: ledger.sectorGroup,
      rec,
      snap,
      yoy: yoyDeltas,
      isLatest,
      basis,
      kbEntry,
      auditCache,
      aiFy,
      legacyAi: legacyDeepDive,
      benchmarkFdRatePct,
      ltp: dossier?.summary.market.ltp ?? null,
      marginOfSafetyPct: dossier?.marginOfSafetyPct ?? null,
    });

    const lineHighlights: Array<{ section: string; particulars: string; rawValue: string }> = [];
    if (rec.rawLineItems && rec.rawLineItems.length > 0) {
      for (const li of rec.rawLineItems.slice(0, 35)) {
        lineHighlights.push({
          section: `${li.tab} · ${li.section}`,
          particulars: li.particulars,
          rawValue: li.rawValue,
        });
      }
    } else if (isLatest && savedRaw?.tabs?.length) {
      for (const tab of savedRaw.tabs) {
        for (const row of tab.rows) {
          if (row.isSectionHeader || !row.particulars) continue;
          const val = row.values[0] || '';
          if (!val) continue;
          lineHighlights.push({
            section: `${tab.title}${row.section ? ` · ${row.section}` : ''}`,
            particulars: row.particulars,
            rawValue: val,
          });
          if (lineHighlights.length >= 35) break;
        }
        if (lineHighlights.length >= 35) break;
      }
    }

    const executiveSummary =
      aiFy?.executiveSummary ||
      (isLatest && legacyDeepDive?.executiveSummary) ||
      `FY ${item.fy} (${basis} via ${rec.periodLabel}) reflects ${fmtCr(snap.revenueCr)} revenue, ${fmtCr(snap.netProfitCr)} net profit, ${fmtRs(snap.eps, 2)} EPS, and ${fmtPct(snap.roePct)} ROE.${
        yoyDeltas.netProfitYoYPct !== null
          ? ` Net profit changed ${fmtPct(yoyDeltas.netProfitYoYPct, true)} vs FY ${yoyDeltas.priorFiscalYear}.`
          : ''
      }`;

    return {
      fiscalYear: item.fy,
      sortYear: item.sortYear,
      isLatest,
      basis,
      quarter: rec.quarter,
      periodLabel: rec.periodLabel,
      publicationDate: rec.publicationDate,
      collectionDate: rec.collectionDate,
      dataSource: rec.dataSource,
      sourceUrl: rec.sourceUrl,
      validationStatus: rec.validationStatus,
      validationNotes: rec.validationNotes,
      dataQualityFlags: rec.dataQualityFlags,
      metrics: snap,
      yoyDeltas,
      executiveSummary,
      pillars,
      lineItemHighlights: lineHighlights,
      quarterHistoryInFy: item.allRecsDesc.map((qRec) => ({
        periodLabel: qRec.periodLabel,
        quarter: qRec.quarter,
        eps: qRec.metrics.eps.value !== null ? round2(qRec.metrics.eps.value) : null,
        netProfitCr: toCr(qRec.metrics.netProfit.value),
        revenueCr: toCr(qRec.metrics.revenue.value),
        roePct: qRec.metrics.roePct.value !== null ? round2(qRec.metrics.roePct.value) : null,
        bvps: qRec.metrics.bvps.value !== null ? round2(qRec.metrics.bvps.value) : null,
      })),
      aiDistillation: aiFy,
    };
  });

  // Materialize any AI-distilled FYs (e.g. previous FY 2081/82 distilled before Poush end) not present in raw CSV/JSON records
  const aiOnlyPrefix = `${sym}:`;
  for (const [cacheKey, cacheVal] of Object.entries(rawCache)) {
    if (!cacheKey.startsWith(aiOnlyPrefix) || !isFyDistillation(cacheVal)) continue;
    if (recordsByFy.has(cacheVal.fiscalYear)) continue;
    fiscalYearsChrono.push(
      buildSyntheticAiFyAnalysis({
        sym,
        companyName: dossier?.summary.companyName ?? ledger.companyName,
        sector: dossier?.summary.sector ?? ledger.sector,
        sectorGroup: dossier?.summary.sectorGroup ?? ledger.sectorGroup,
        aiFy: cacheVal,
        isLatest: cacheVal.fiscalYear === resolution.recommendedAnnualFy,
        kbEntry,
      })
    );
  }

  fiscalYearsChrono.sort((a, b) => a.sortYear - b.sortYear);
  // Only build trend points for periods with quantitative statement metrics
  const trendSeries: AnnualTrendPoint[] = fiscalYearsChrono
    .filter((fy) => fy.quarterHistoryInFy.length > 0)
    .map((fy) => ({
      fiscalYear: fy.fiscalYear,
      sortYear: fy.sortYear,
      basis: fy.basis,
      periodLabel: fy.periodLabel,
      revenueCr: fy.metrics.revenueCr,
      netProfitCr: fy.metrics.netProfitCr,
      revenueYoYPct: fy.yoyDeltas.revenueYoYPct,
      netProfitYoYPct: fy.yoyDeltas.netProfitYoYPct,
      eps: fy.metrics.eps,
      bvps: fy.metrics.bvps,
      netWorthCr: fy.metrics.netWorthCr,
      reservesCr: fy.metrics.reservesCr,
      totalAssetsCr: fy.metrics.totalAssetsCr,
      totalDebtCr: fy.metrics.totalDebtCr,
      debtToEquity: fy.metrics.debtToEquity,
      roePct: fy.metrics.roePct,
      roaPct: fy.metrics.roaPct,
      netMarginPct: fy.metrics.netMarginPct,
      roicPct: fy.metrics.roicPct,
      depositsCr: fy.metrics.depositsCr,
      loansCr: fy.metrics.loansCr,
      carPct: fy.metrics.carPct,
      nplPct: fy.metrics.nplPct,
      netPremiumCr: fy.metrics.netPremiumCr,
      claimRatioPct: fy.metrics.claimRatioPct,
      solvencyRatio: fy.metrics.solvencyRatio,
    }));

  const fiscalYearsDesc = [...fiscalYearsChrono].reverse();
  const auditedCount = fiscalYearsDesc.filter((f) => f.basis === 'Audited Annual').length;
  const preferredLatestFy =
    resolution.recommendedAnnualFy ??
    fiscalYearsDesc.find((f) => f.fiscalYear !== resolution.fiscalContext.currentFy)?.fiscalYear ??
    fiscalYearsDesc[0]?.fiscalYear ??
    null;
  const comparison = buildComparisonMatrix(
    fiscalYearsDesc,
    ledger.sectorGroup,
    preferredLatestFy
  );
  const macro = loadMacroSnapshot(store);
  void macro;

  return {
    generatedAt: new Date().toISOString(),
    marketDate: dossier?.marketDate ?? store.getDates().slice(-1)[0] ?? null,
    symbol: sym,
    companyName: dossier?.summary.companyName ?? ledger.companyName,
    sector: dossier?.summary.sector ?? ledger.sector,
    sectorGroup: dossier?.summary.sectorGroup ?? ledger.sectorGroup,
    ltp: dossier?.summary.market.ltp ?? null,
    changePct: dossier?.summary.market.changePct ?? null,
    compositeFairValue: dossier?.compositeFairValue ?? null,
    marginOfSafetyPct: dossier?.marginOfSafetyPct ?? null,
    pricingVerdict: dossier?.pricingVerdict ?? 'Insufficient Data',
    valuationHealthScore: dossier?.valuationHealthScore ?? null,
    kbEntry,
    fiscalContext: resolution.fiscalContext,
    recommendedAnnualFy: resolution.recommendedAnnualFy,
    aiDistillTargetFy: resolution.aiDistillTargetFy,
    currentInterimFy: resolution.currentInterimFy,
    fallbackUsed: resolution.fallbackUsed,
    fallbackReason: resolution.fallbackReason,
    hasAuditedAnnual: auditedCount > 0,
    auditedFyCount: auditedCount,
    totalFyCount: fiscalYearsDesc.length,
    latestFy: preferredLatestFy,
    fiscalYears: fiscalYearsDesc,
    comparison,
    trendSeries,
    legacyDeepDive,
  };
}

export async function distillAnnualReportWithAi(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  symbol: string,
  fiscalYear?: string,
  force = false,
  now?: Date
): Promise<AnnualReportAiFyDistillation> {
  const sym = symbol.trim().toUpperCase();
  const intel = buildAnnualReportIntelligence(store, vault, kb, sym, { now });
  if (!intel || intel.fiscalYears.length === 0) {
    throw new Error(`No fundamental ledger found for ${sym}.`);
  }

  const requestedFy = fiscalYear?.trim() || null;
  const targetFy =
    requestedFy ||
    intel.aiDistillTargetFy ||
    intel.recommendedAnnualFy ||
    intel.fiscalContext.previousCompletedFy;
  const targetFyObj =
    intel.fiscalYears.find((f) => f.fiscalYear === targetFy) ??
    intel.fiscalYears.find((f) => f.fiscalYear === intel.recommendedAnnualFy) ??
    intel.fiscalYears[0];

  const cache = loadRawCache(vault);
  const cacheKey = `${sym}:${targetFy}`;
  if (!force) {
    const existing = cache[cacheKey];
    if (isFyDistillation(existing)) {
      return { ...existing, cached: true };
    }
  }

  const ai = getAiClient();
  const m = targetFyObj.metrics;
  const priorFyObj = intel.fiscalYears.find((f) => f.fiscalYear === targetFyObj.yoyDeltas.priorFiscalYear);
  const contextDiffersFromTarget = targetFyObj.fiscalYear !== targetFy;

  const prompt = `Conduct an institutional-grade Annual Report & AGM Disclosure Distillation for NEPSE-listed company ${sym} (${intel.companyName}, sector: ${intel.sector}), specifically targeting Fiscal Year ${targetFy}.
${
  intel.fallbackUsed && targetFy === intel.aiDistillTargetFy
    ? `IMPORTANT NEPAL FISCAL CALENDAR CONTEXT: Current Nepal FY is ${intel.fiscalContext.currentFy} and Poush end (~${intel.fiscalContext.poushEndApproxDate}) has not yet passed, so FY ${intel.fiscalContext.latestCompletedFy} audited Annual Report may not be published yet. Therefore distill the prior completed FY ${targetFy} Audited Annual Report & AGM Disclosures.`
    : ''
}
Focus strictly on verified Annual Report disclosures, Board of Directors' Report, Chairman's Statement, Auditor's Report, AGM resolutions, CapEx/expansion plans, and ICRA Nepal / CARE Ratings Nepal / NRB / NIA / SEBON / NEPSE filings for FY ${targetFy} (and how they compare with the prior FY).

Stored vault reference for ${sym} (${contextDiffersFromTarget ? `latest indexed interim/statement is ${targetFyObj.periodLabel}; use strictly as run-rate context while retrieving FY ${targetFy} Annual Report figures` : `FY ${targetFy}, indexed as ${targetFyObj.periodLabel}`}):
- Revenue: ${fmtCr(m.revenueCr)}, Net Profit: ${fmtCr(m.netProfitCr)}, EPS: ${fmtRs(m.eps, 2)}, BVPS: ${fmtRs(m.bvps, 1)}
- ROE: ${fmtPct(m.roePct)}, ROA: ${fmtPct(m.roaPct)}, Net Worth: ${fmtCr(m.netWorthCr)}, Reserves: ${fmtCr(m.reservesCr)}
- Total Assets: ${fmtCr(m.totalAssetsCr)}, Debt/Equity: ${fmtX(m.debtToEquity)}, NPL: ${fmtPct(m.nplPct)}, CAR: ${fmtPct(m.carPct)}
${priorFyObj ? `- Prior FY (${priorFyObj.fiscalYear}) on file: Revenue ${fmtCr(priorFyObj.metrics.revenueCr)}, Net Profit ${fmtCr(priorFyObj.metrics.netProfitCr)}, EPS ${fmtRs(priorFyObj.metrics.eps, 2)}, ROE ${fmtPct(priorFyObj.metrics.roePct)}` : ''}
- Credit Rating on file: ${intel.kbEntry?.creditRating?.ratingGrade ? `${intel.kbEntry.creditRating.ratingGrade} (${intel.kbEntry.creditRating.outlook})` : 'Not indexed'}

Respond strictly with ONE valid JSON object matching this exact schema (no markdown commentary outside JSON):
{
  "reportBasisLabel": "e.g. FY ${targetFy} Audited Annual Report & AGM Disclosures (or Interim if audited report unavailable)",
  "executiveSummary": "3-sentence structured synthesis of FY ${targetFy} performance, strategic position, and key takeaways",
  "managementQualityNotes": ["3-4 points assessing management credibility, capital allocation, corporate governance, transparency, and execution"],
  "growthHighlights": ["3-4 points on revenue, profit, EPS, asset, and operational growth in FY ${targetFy}"],
  "businessOpportunities": ["3-4 points on new markets, products, services, competitive advantages, and sector trends"],
  "keyRisks": ["3-4 points covering financial, operational, market, regulatory, and competitive risks"],
  "weaknesses": ["2-4 points on structural challenges, operational inefficiencies, or financial weaknesses"],
  "uncertainties": ["2-4 points on unresolved issues, macro/policy sensitivities, or forward uncertainties"],
  "upcomingBusinessPlans": ["3-4 points on planned investments, CapEx, new projects, branch/capacity expansion, or diversification"],
  "businessDirection": "2-3 sentence summary of long-term vision, strategic priorities, and transformation trajectory",
  "strategicComparisonVsPriorFy": ["3-4 concrete comparisons vs the preceding FY: shifts in strategy, progress against prior plans, management execution change, and emerging risks/opportunities"],
  "auditorAndGovernanceNotes": ["2-3 points on auditor opinion, contingent liabilities, NRB/NIA/SEBON compliance, or promoter lock-in"],
  "dividendAndBonusDeclared": ["1-3 points on bonus share and cash dividend declared for FY ${targetFy} and surrounding years"]
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
    throw new Error(`Gemini returned an unparseable response for ${sym} FY ${targetFy}. Please retry.`);
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

  const result: AnnualReportAiFyDistillation = {
    symbol: sym,
    fiscalYear: targetFy,
    generatedAt: new Date().toISOString(),
    model: usedModel,
    cached: false,
    reportBasisLabel: strOrFallback(parsed.reportBasisLabel, `FY ${targetFy} Annual Report Distillation`),
    executiveSummary: strOrFallback(
      parsed.executiveSummary,
      `Annual report distillation completed for ${sym} FY ${targetFy}.`
    ),
    managementQualityNotes: strArr(parsed.managementQualityNotes, 5),
    growthHighlights: strArr(parsed.growthHighlights, 5),
    businessOpportunities: strArr(parsed.businessOpportunities, 5),
    keyRisks: strArr(parsed.keyRisks, 5),
    weaknesses: strArr(parsed.weaknesses, 5),
    uncertainties: strArr(parsed.uncertainties, 5),
    upcomingBusinessPlans: strArr(parsed.upcomingBusinessPlans, 5),
    businessDirection: strOrFallback(
      parsed.businessDirection,
      `Focused on sustainable balance-sheet compounding and operational execution in ${intel.sector}.`
    ),
    strategicComparisonVsPriorFy: strArr(parsed.strategicComparisonVsPriorFy, 5),
    auditorAndGovernanceNotes: strArr(parsed.auditorAndGovernanceNotes, 4),
    dividendAndBonusDeclared: strArr(parsed.dividendAndBonusDeclared, 4),
    citations: citations.slice(0, 10),
  };

  cache[cacheKey] = result;
  saveRawCache(vault, cache);
  return result;
}

function validatePublicHttpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid report URL. Provide a valid https:// or http:// link.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('Private/local network URLs are not permitted.');
  }
  return parsed.toString();
}

function summarizePlainTextIntoDistillation(params: {
  symbol: string;
  companyName: string;
  sector: string;
  targetFy: string;
  sourceLabel: string;
  sourceUrl: string | null;
  textContent: string;
}): AnnualReportAiFyDistillation {
  const { symbol, companyName, sector, targetFy, sourceLabel, sourceUrl, textContent } = params;
  const sentences = textContent
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 320);

  const pickMatching = (re: RegExp, fallback: string[]): string[] => {
    const hits = sentences.filter((s) => re.test(s)).slice(0, 4);
    return hits.length > 0 ? hits : fallback;
  };

  return {
    symbol,
    fiscalYear: targetFy,
    generatedAt: new Date().toISOString(),
    model: 'document-ingest-parser',
    cached: false,
    reportBasisLabel: `FY ${targetFy} User-Supplied Report (${sourceLabel})`,
    executiveSummary:
      sentences.slice(0, 3).join(' ') ||
      `FY ${targetFy} report document (${sourceLabel}) saved and indexed into the vault & Regulatory Knowledge Base for ${symbol} (${companyName}).`,
    managementQualityNotes: pickMatching(
      /\b(board|management|governance|auditor|director|agm|compliance)\b/i,
      [`Source document (${sourceLabel}) archived for FY ${targetFy} governance review.`]
    ),
    growthHighlights: pickMatching(
      /\b(revenue|profit|eps|growth|deposit|loan|premium|increase|assets|net worth)\b/i,
      [`Financial highlights preserved from ${sourceLabel} for FY ${targetFy}.`]
    ),
    businessOpportunities: pickMatching(
      /\b(opportunit|expansion|digital|capacity|branch|project|market share|new)\b/i,
      [`Expansion & sector positioning in ${sector} documented in FY ${targetFy} filing.`]
    ),
    keyRisks: pickMatching(
      /\b(risk|npl|provision|claim|interest|regulatory|challenge|pressure)\b/i,
      [`Monitor disclosures in saved ${sourceLabel} for credit, liquidity & regulatory risks.`]
    ),
    weaknesses: pickMatching(
      /\b(weakness|decline|decrease|loss|shortfall|constraint|cost)\b/i,
      ['Review margin and cost trends inside the attached FY report document.']
    ),
    uncertainties: pickMatching(
      /\b(uncertain|outlook|guidance|policy|nrb|sebon|monsoon|tariff)\b/i,
      ['Policy, interest-rate, and macro cycle sensitivities apply into upcoming quarters.']
    ),
    upcomingBusinessPlans: pickMatching(
      /\b(plan|capex|pipeline|invest|upcoming|strategy|target|project)\b/i,
      [`FY ${targetFy} strategic initiatives archived from ${sourceLabel}.`]
    ),
    businessDirection:
      sentences.find((s) => /\b(vision|mission|long-term|strategy|direction|focus)\b/i.test(s)) ||
      `Saved ${sourceLabel} indexed for ${symbol} FY ${targetFy} strategic tracking in ${sector}.`,
    strategicComparisonVsPriorFy: [
      `User-provided FY ${targetFy} disclosure (${sourceLabel}) added for multi-year comparison.`,
    ],
    auditorAndGovernanceNotes: pickMatching(/\b(audit|opinion|qualified|compliance|sebon|nrb)\b/i, [
      `Document archived locally for governance verification (${sourceLabel}).`,
    ]),
    dividendAndBonusDeclared: pickMatching(/\b(dividend|bonus|cash dividend|book close|agm)\b/i, [
      `Check dividend/bonus resolutions inside saved FY ${targetFy} report.`,
    ]),
    citations: sourceUrl ? [{ title: `${symbol} FY ${targetFy} Report`, uri: sourceUrl }] : [],
  };
}

export async function ingestAndDistillAnnualReport(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  input: {
    symbol: string;
    fiscalYear?: string;
    reportUrl?: string;
    fileName?: string;
    mimeType?: string;
    fileBase64?: string;
    rawText?: string;
    now?: Date;
  }
): Promise<AnnualReportIngestResponse> {
  vault.initIfNeeded();
  const sym = input.symbol.trim().toUpperCase();
  const intel = buildAnnualReportIntelligence(store, vault, kb, sym, { now: input.now });
  const cal = getNepalFiscalYearCalendarContext(input.now);
  const targetFy = normalizeFiscalYear(
    input.fiscalYear?.trim() || intel?.aiDistillTargetFy || cal.previousCompletedFy
  );

  const ledger = vault.getCompanyLedger(sym);
  const dates = store.getDates();
  const latestDate = dates[dates.length - 1];
  const marketRow = latestDate
    ? store.getDayPrices(latestDate, false).find((r) => r.symbol.toUpperCase() === sym)
    : undefined;
  const companyName = intel?.companyName || ledger?.companyName || marketRow?.name || sym;
  const sector = intel?.sector || ledger?.sector || 'Other';
  const sectorGroup = intel?.sectorGroup || ledger?.sectorGroup || 'Other';

  let buffer: Buffer | null = null;
  let mimeType = (input.mimeType || '').trim().toLowerCase();
  let sourceUrl: string | null = null;
  let sourceType: 'url' | 'upload' = 'upload';
  let sourceLabel = input.fileName?.trim() || 'Uploaded Report';
  let extractedText = (input.rawText || '').trim();

  if (input.reportUrl && input.reportUrl.trim()) {
    sourceType = 'url';
    sourceUrl = validatePublicHttpUrl(input.reportUrl);
    sourceLabel = sourceUrl;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res: Response;
    try {
      res = await fetch(sourceUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/pdf,text/html,application/xhtml+xml,text/plain,*/*;q=0.8',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`Failed to download report URL (HTTP ${res.status}).`);
    }
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const arrBuf = await res.arrayBuffer();
    if (arrBuf.byteLength > 15 * 1024 * 1024) {
      throw new Error('Downloaded report exceeds the 15 MB size limit.');
    }
    buffer = Buffer.from(arrBuf);
    mimeType = contentType.split(';')[0].trim() || mimeType;
    if (!mimeType) {
      mimeType = sourceUrl.toLowerCase().includes('.pdf') ? 'application/pdf' : 'text/html';
    }
  } else if (input.fileBase64 && input.fileBase64.trim()) {
    const cleaned = input.fileBase64.includes(',')
      ? input.fileBase64.split(',').slice(1).join(',')
      : input.fileBase64;
    buffer = Buffer.from(cleaned, 'base64');
    if (buffer.byteLength > 15 * 1024 * 1024) {
      throw new Error('Uploaded file exceeds the 15 MB size limit.');
    }
    if (!mimeType && input.fileName?.toLowerCase().endsWith('.pdf')) {
      mimeType = 'application/pdf';
    }
  } else if (extractedText) {
    buffer = Buffer.from(extractedText, 'utf8');
    mimeType = mimeType || 'text/plain';
  } else {
    throw new Error('Provide either a public report URL or upload a PDF/text annual report file.');
  }

  const isPdf =
    mimeType === 'application/pdf' ||
    (buffer !== null && buffer.subarray(0, 5).toString('ascii') === '%PDF-');

  if (!isPdf && buffer && !extractedText) {
    const rawStr = buffer.toString('utf8');
    if (mimeType.includes('html') || /<html|<body|<div|<table/i.test(rawStr.slice(0, 500))) {
      const $ = cheerio.load(rawStr);
      $('script, style, noscript, nav, header, footer').remove();
      extractedText = $('body').text().replace(/\s+/g, ' ').trim();
    } else {
      extractedText = rawStr.trim();
    }
  }

  // Persist downloaded/uploaded artifact into vault/ingested-reports
  const ingestDir = path.join(vault.vaultDir, 'ingested-reports');
  if (!fs.existsSync(ingestDir)) fs.mkdirSync(ingestDir, { recursive: true });
  const ext = isPdf
    ? 'pdf'
    : mimeType.includes('html')
      ? 'html'
      : mimeType.includes('json')
        ? 'json'
        : mimeType.includes('csv')
          ? 'csv'
          : 'txt';
  const safeFy = targetFy.replace(/[^0-9A-Za-z_-]/g, '-');
  const savedFilePath = path.join(ingestDir, `${sym}_${safeFy}.${ext}`);
  if (buffer) {
    fs.writeFileSync(savedFilePath, buffer);
  }

  // Distill using Gemini if API key is set, else parse locally
  let distillation: AnnualReportAiFyDistillation;
  let aiDistilled = false;
  const hasGeminiKey = Boolean((process.env.GEMINI_API_KEY || '').trim());

  if (hasGeminiKey) {
    const ai = getAiClient();
    const instructionPrompt = `Conduct an institutional-grade Annual Report & AGM Disclosure Distillation for NEPSE-listed company ${sym} (${companyName}, sector: ${sector}) for Fiscal Year ${targetFy} using the user-supplied report (${sourceLabel}).
Extract concrete verified findings strictly from the provided document. Respond ONLY with ONE valid JSON object matching this exact schema:
{
  "reportBasisLabel": "FY ${targetFy} Supplied Annual Report (${isPdf ? 'PDF' : 'Document'})",
  "executiveSummary": "3-sentence structured synthesis of FY ${targetFy} performance, strategic position, and key takeaways",
  "managementQualityNotes": ["3-4 points assessing management credibility, capital allocation, corporate governance, and execution"],
  "growthHighlights": ["3-4 points on revenue, profit, EPS, asset, and operational growth in FY ${targetFy}"],
  "businessOpportunities": ["3-4 points on new markets, products, expansion opportunities, and competitive advantages"],
  "keyRisks": ["3-4 points covering financial, operational, market, regulatory, and competitive risks"],
  "weaknesses": ["2-4 points on structural challenges or financial weaknesses"],
  "uncertainties": ["2-4 points on unresolved issues or forward uncertainties"],
  "upcomingBusinessPlans": ["3-4 points on planned investments, CapEx, new projects, or diversification"],
  "businessDirection": "2-3 sentence summary of long-term vision and strategic direction",
  "strategicComparisonVsPriorFy": ["2-4 comparisons or changes vs prior FY noted in the report"],
  "auditorAndGovernanceNotes": ["2-3 points on auditor opinion, compliance, or contingent liabilities"],
  "dividendAndBonusDeclared": ["1-3 points on bonus share and cash dividend declared for FY ${targetFy}"]
}`;

    const contents: unknown =
      isPdf && buffer
        ? [
            { text: instructionPrompt },
            { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
          ]
        : `${instructionPrompt}\n\n--- REPORT CONTENT (TRUNCATED TO 45,000 CHARS) ---\n${extractedText.slice(0, 45000)}`;

    const runCall = async (model: string): Promise<GenerateContentResponse> => {
      return ai.models.generateContent({
        model,
        contents: contents as Parameters<typeof ai.models.generateContent>[0]['contents'],
      });
    };

    let response: GenerateContentResponse;
    let usedModel = PRIMARY_MODEL;
    try {
      response = await runCall(PRIMARY_MODEL);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('NOT_FOUND')) {
        usedModel = FALLBACK_MODEL;
        response = await runCall(FALLBACK_MODEL);
      } else {
        throw err;
      }
    }

    const parsed = parseJsonObjectSafe(response.text ?? '');
    if (parsed) {
      aiDistilled = true;
      distillation = {
        symbol: sym,
        fiscalYear: targetFy,
        generatedAt: new Date().toISOString(),
        model: usedModel,
        cached: false,
        reportBasisLabel: strOrFallback(
          parsed.reportBasisLabel,
          `FY ${targetFy} Ingested Annual Report`
        ),
        executiveSummary: strOrFallback(
          parsed.executiveSummary,
          `Distilled FY ${targetFy} annual report from ${sourceLabel}.`
        ),
        managementQualityNotes: strArr(parsed.managementQualityNotes, 5),
        growthHighlights: strArr(parsed.growthHighlights, 5),
        businessOpportunities: strArr(parsed.businessOpportunities, 5),
        keyRisks: strArr(parsed.keyRisks, 5),
        weaknesses: strArr(parsed.weaknesses, 5),
        uncertainties: strArr(parsed.uncertainties, 5),
        upcomingBusinessPlans: strArr(parsed.upcomingBusinessPlans, 5),
        businessDirection: strOrFallback(
          parsed.businessDirection,
          `Long-term strategic trajectory extracted for ${sym} FY ${targetFy}.`
        ),
        strategicComparisonVsPriorFy: strArr(parsed.strategicComparisonVsPriorFy, 5),
        auditorAndGovernanceNotes: strArr(parsed.auditorAndGovernanceNotes, 4),
        dividendAndBonusDeclared: strArr(parsed.dividendAndBonusDeclared, 4),
        citations: sourceUrl
          ? [{ title: `${sym} FY ${targetFy} Report`, uri: sourceUrl }]
          : [],
      };
    } else {
      distillation = summarizePlainTextIntoDistillation({
        symbol: sym,
        companyName,
        sector,
        targetFy,
        sourceLabel,
        sourceUrl,
        textContent: extractedText,
      });
    }
  } else {
    distillation = summarizePlainTextIntoDistillation({
      symbol: sym,
      companyName,
      sector,
      targetFy,
      sourceLabel,
      sourceUrl,
      textContent: extractedText,
    });
  }

  // Save to FY distillation cache so buildAnnualReportIntelligence materializes it immediately
  const cache = loadRawCache(vault);
  cache[`${sym}:${targetFy}`] = distillation;
  saveRawCache(vault, cache);

  // Update Regulatory Knowledge Base
  kb.recordAnnualReportIngestion({
    symbol: sym,
    companyName,
    sector,
    sectorGroup,
    fiscalYear: targetFy,
    sourceLabel: sourceType === 'url' ? 'External URL Download' : sourceLabel,
    sourceUrl,
    summary: distillation.executiveSummary,
    tailwinds: [...distillation.growthHighlights.slice(0, 2), ...distillation.upcomingBusinessPlans.slice(0, 1)],
    riskFlags: distillation.keyRisks.slice(0, 2),
    dividends: distillation.dividendAndBonusDeclared,
  });

  return {
    symbol: sym,
    fiscalYear: targetFy,
    sourceType,
    sourceUrl,
    savedFilePath: path.relative(process.cwd(), savedFilePath),
    kbUpdated: true,
    aiDistilled,
    message: aiDistilled
      ? `Saved ${sourceType === 'url' ? 'downloaded report' : sourceLabel}, updated Regulatory Knowledge Base, and distilled FY ${targetFy} with AI.`
      : `Saved ${sourceType === 'url' ? 'downloaded report' : sourceLabel} and updated Regulatory Knowledge Base for FY ${targetFy}.`,
    distillation,
  };
}
