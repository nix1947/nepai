import fs from 'fs';
import path from 'path';
import type {
  AnnualReportAiDeepDive,
  AnnualReportAiFyDistillation,
  AnnualReportPillarStatus,
  FiscalYearReportAnalysis,
  OutperformanceStatus,
  QuarterCode,
  QuarterlyStatementRecord,
  SectorGroup,
  StrategicOutlookBaselineMode,
  StrategicOutlookCompanyRow,
  StrategicOutlookHeatmapResponse,
  StrategicOutlookMetricComparison,
  StrategicOutlookQuadrant,
  StrategicOutlookSectorBenchmark,
} from '../../src/types/fundamental.ts';
import type { MarketStore } from '../marketStore.ts';
import { loadAllFundamentalAudits } from '../riskEngine.ts';
import { FundamentalVault } from './fundamentalVault.ts';
import { evaluateScreenerUniverse } from './investorScoringEngine.ts';
import {
  extractStartBsYear,
  getNepalFiscalYearCalendarContext,
  quarterOrderValue,
} from './nepalCalendar.ts';
import { RegulatoryKnowledgeBase } from './regulatoryKnowledgeBase.ts';
import { getSectorThresholds } from './sectorMethodology.ts';

interface DeepDiveCacheShape {
  [key: string]: AnnualReportAiDeepDive | AnnualReportAiFyDistillation;
}

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

function sanitizePct(v: number | null | undefined, min = -100, max = 120): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return round2(v);
}

function sanitizeMoneyCr(v: number | null | undefined): number | null {
  const cr = toCr(v);
  if (cr === null) return null;
  // Filter placeholder 1-rupee sentinel entries (e.g. 0.0000001 Cr)
  if (Math.abs(cr) > 0 && Math.abs(cr) < 0.005) return null;
  return cr;
}

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return vals.reduce((acc, v) => acc + v, 0) / vals.length;
}

function loadRawCache(vault: FundamentalVault): DeepDiveCacheShape {
  try {
    const file = path.join(vault.vaultDir, 'annual-deep-dive-cache.json');
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as DeepDiveCacheShape)
      : {};
  } catch {
    return {};
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

function getAiDistillationsForSymbol(
  cache: DeepDiveCacheShape,
  symbol: string
): { byFy: Map<string, AnnualReportAiFyDistillation>; legacy: AnnualReportAiDeepDive | null } {
  const upper = symbol.toUpperCase();
  const prefix = `${upper}:`;
  const byFy = new Map<string, AnnualReportAiFyDistillation>();
  for (const [k, v] of Object.entries(cache)) {
    if (k.startsWith(prefix) && isFyDistillation(v)) {
      byFy.set(v.fiscalYear, v);
    }
  }
  const legacyRaw = cache[upper];
  const legacy =
    legacyRaw && typeof legacyRaw === 'object' && 'managementGuidanceAndCatalysts' in legacyRaw
      ? (legacyRaw as AnnualReportAiDeepDive)
      : null;
  return { byFy, legacy };
}

function quarterBasisFor(q: QuarterCode): FiscalYearReportAnalysis['basis'] {
  if (q === 'Annual') return 'Audited Annual';
  if (q === 'Q4') return 'Q4 Full-Year Unaudited';
  return 'Interim Quarterly';
}

function scoreQualitativeTone(notes: string[]): number {
  if (notes.length === 0) return 0;
  const text = notes.join(' ').toLowerCase();
  const positives = (
    text.match(
      /\b(strong|disciplined|improved|expanding|expansion|healthy|prudent|compliant|unqualified|clean|resilient|digital|growth|record|leading|upgraded|surplus|efficiency)\b/g
    ) || []
  ).length;
  const negatives = (
    text.match(
      /\b(weak|deteriorat|decline|drop|qualified|penalty|non-compliance|shortfall|loss|high npl|elevated risk|concern|compressed|underperform|overhang|deficit)\b/g
    ) || []
  ).length;
  return clip((positives - negatives) * 2.5, -8, 10);
}

function pctDiff(curr: number | null, base: number | null): number | null {
  if (curr === null || base === null || !Number.isFinite(curr) || !Number.isFinite(base)) return null;
  if (Math.abs(base) < 0.05) return null;
  return round1(clip(((curr - base) / Math.abs(base)) * 100, -150, 250));
}

function statusFromScore(score: number): AnnualReportPillarStatus {
  if (score >= 70) return 'Strong';
  if (score >= 54) return 'Solid';
  if (score >= 38) return 'Watch';
  return 'Fragile';
}

const MGMT_THRESHOLD = 56;
const GROWTH_THRESHOLD = 56;

/**
 * Categorizes all indexed NEPSE companies by Management Quality & Growth Potential
 * extracted from annual reports, AI distillations, and historical ledger series,
 * and measures whether each company is currently outperforming its historical averages.
 */
export function buildStrategicOutlookHeatmap(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  opts: { equityOnly?: boolean; benchmarkFdRatePct?: number; now?: Date } = {}
): StrategicOutlookHeatmapResponse {
  const equityOnly = opts.equityOnly !== false;
  const evaluated = evaluateScreenerUniverse(store, vault, {
    equityOnly,
    benchmarkFdRatePct: opts.benchmarkFdRatePct ?? 6.5,
    now: opts.now,
  });
  const cache = loadRawCache(vault);
  const allAudits = loadAllFundamentalAudits(store);
  const fiscalContext = getNepalFiscalYearCalendarContext(opts.now);

  // Pre-pass: gather clean latest annual/FY representative metrics per sector for fallback baselines
  interface PreparedCompany {
    row: (typeof evaluated.rows)[number];
    fysDesc: Array<{
      fy: string;
      sortYear: number;
      rec: QuarterlyStatementRecord;
      roePct: number | null;
      roaPct: number | null;
      netMarginPct: number | null;
      eps: number | null;
      netProfitCr: number | null;
      revenueCr: number | null;
    }>;
    chosen: QuarterlyStatementRecord;
    aiByFy: Map<string, AnnualReportAiFyDistillation>;
    legacyAi: AnnualReportAiDeepDive | null;
    recommendedAnnualFy: string | null;
  }

  const prepared: PreparedCompany[] = [];
  const sectorStats = new Map<
    string,
    { roes: number[]; margins: number[]; roas: number[]; reserveRatios: number[]; epsList: number[] }
  >();

  for (const row of evaluated.rows) {
    const ledger = vault.getCompanyLedger(row.symbol);
    if (!ledger || ledger.records.length === 0) continue;

    const byFy = new Map<string, QuarterlyStatementRecord>();
    for (const rec of ledger.records) {
      const prev = byFy.get(rec.fiscalYear);
      if (!prev || quarterOrderValue(rec.quarter) > quarterOrderValue(prev.quarter)) {
        byFy.set(rec.fiscalYear, rec);
      }
    }

    const fysDesc = Array.from(byFy.entries())
      .map(([fy, rec]) => ({
        fy,
        sortYear: extractStartBsYear(fy) ?? 0,
        rec,
        roePct: sanitizePct(rec.metrics.roePct.value, -100, 120),
        roaPct: sanitizePct(rec.metrics.roaPct.value, -50, 50),
        netMarginPct: sanitizePct(rec.metrics.netProfitMarginPct.value, -150, 95),
        eps:
          rec.metrics.eps.value !== null && Number.isFinite(rec.metrics.eps.value)
            ? round2(rec.metrics.eps.value)
            : null,
        netProfitCr: sanitizeMoneyCr(rec.metrics.netProfit.value),
        revenueCr: sanitizeMoneyCr(rec.metrics.revenue.value),
      }))
      .sort((a, b) => b.sortYear - a.sortYear);

    if (fysDesc.length === 0) continue;

    const { byFy: aiByFy, legacy: legacyAi } = getAiDistillationsForSymbol(cache, row.symbol);

    // Choose representative Annual FY honoring Nepal Poush-end cutoff
    const latestCompletedItem = fysDesc.find((f) => f.fy === fiscalContext.latestCompletedFy) ?? null;
    const olderAudited = fysDesc.find(
      (f) =>
        f.sortYear < fiscalContext.currentStartBs &&
        f.fy !== fiscalContext.latestCompletedFy &&
        (f.rec.quarter === 'Annual' || aiByFy.has(f.fy))
    );
    const olderAny = fysDesc.find(
      (f) => f.sortYear < fiscalContext.currentStartBs && f.fy !== fiscalContext.latestCompletedFy
    );

    let chosenItem = fysDesc[0];
    let recommendedAnnualFy: string | null = null;
    if (
      latestCompletedItem &&
      (latestCompletedItem.rec.quarter === 'Annual' ||
        aiByFy.has(latestCompletedItem.fy) ||
        fiscalContext.poushEndPassed)
    ) {
      chosenItem = latestCompletedItem;
      recommendedAnnualFy = latestCompletedItem.fy;
    } else if (!fiscalContext.poushEndPassed && (olderAudited || olderAny)) {
      chosenItem = olderAudited ?? olderAny!;
      recommendedAnnualFy = chosenItem.fy;
    } else {
      const completedFirst = fysDesc.find((f) => f.sortYear < fiscalContext.currentStartBs);
      chosenItem = completedFirst ?? fysDesc[0];
      recommendedAnnualFy = chosenItem.fy;
    }

    // Also inspect latest operating record (which may be current interim FY if newer than chosen annual fallback)
    const activeItem = fysDesc[0];
    const cleanRoe = activeItem.roePct ?? chosenItem.roePct;
    const cleanMargin = activeItem.netMarginPct ?? chosenItem.netMarginPct;
    const cleanRoa = activeItem.roaPct ?? chosenItem.roaPct;
    const scCr = sanitizeMoneyCr(chosenItem.rec.metrics.shareCapital.value);
    const resCr = sanitizeMoneyCr(chosenItem.rec.metrics.reserves.value);
    const resRatio =
      scCr !== null && resCr !== null && scCr > 0 ? round2(resCr / scCr) : null;

    const bucket = sectorStats.get(row.sector) ?? {
      roes: [],
      margins: [],
      roas: [],
      reserveRatios: [],
      epsList: [],
    };
    if (cleanRoe !== null) bucket.roes.push(cleanRoe);
    if (cleanMargin !== null) bucket.margins.push(cleanMargin);
    if (cleanRoa !== null) bucket.roas.push(cleanRoa);
    if (resRatio !== null) bucket.reserveRatios.push(resRatio);
    if (activeItem.eps !== null && Math.abs(activeItem.eps) < 500) bucket.epsList.push(activeItem.eps);
    sectorStats.set(row.sector, bucket);

    prepared.push({
      row,
      fysDesc,
      chosen: chosenItem.rec,
      aiByFy,
      legacyAi,
      recommendedAnnualFy,
    });
  }

  // Build clean sector baselines
  const sectorAvgMap = new Map<
    string,
    { roe: number | null; margin: number | null; roa: number | null; reserveRatio: number | null; eps: number | null }
  >();
  for (const [sec, s] of sectorStats.entries()) {
    sectorAvgMap.set(sec, {
      roe: mean(s.roes) !== null ? round2(mean(s.roes)!) : null,
      margin: mean(s.margins) !== null ? round2(mean(s.margins)!) : null,
      roa: mean(s.roas) !== null ? round2(mean(s.roas)!) : null,
      reserveRatio: mean(s.reserveRatios) !== null ? round2(mean(s.reserveRatios)!) : null,
      eps: mean(s.epsList) !== null ? round2(mean(s.epsList)!) : null,
    });
  }

  const outRows: StrategicOutlookCompanyRow[] = [];
  const quadrantCounts: Record<StrategicOutlookQuadrant, number> = {
    Compounders: 0,
    'Scaling & Turnaround': 0,
    'Resilient Stewards': 0,
    'Restructuring Watch': 0,
  };
  const outperformanceCounts: Record<OutperformanceStatus, number> = {
    Outperforming: 0,
    'In-Line': 0,
    Lagging: 0,
  };

  let multiFyCompanies = 0;
  let aiDistilledCompanies = 0;
  const sectorSet = new Set<string>();

  for (const item of prepared) {
    const { row, fysDesc, chosen, aiByFy, legacyAi, recommendedAnnualFy } = item;
    const cfg = getSectorThresholds(row.sectorGroup);
    const isBfi = row.sectorGroup === 'Banking' || row.sectorGroup === 'Microfinance';
    const isInsurer = row.sectorGroup === 'Insurance';
    const kbEntry = kb.getCompanyEntry(row.symbol);
    const auditCache = allAudits[row.symbol] ?? null;
    const aiFy =
      (recommendedAnnualFy ? aiByFy.get(recommendedAnnualFy) : undefined) ??
      aiByFy.values().next().value ??
      null;
    const hasAi = aiByFy.size > 0 || legacyAi !== null;
    if (hasAi) aiDistilledCompanies++;

    // Current evaluation item = newest period available on ledger (e.g. current FY or latest completed FY)
    const latestEntry = fysDesc[0];
    const m = chosen.metrics;
    const latestM = latestEntry.rec.metrics;

    const currentRoe = latestEntry.roePct ?? sanitizePct(m.roePct.value, -100, 120);
    const currentRoa = latestEntry.roaPct ?? sanitizePct(m.roaPct.value, -50, 50);
    const currentMargin = latestEntry.netMarginPct ?? sanitizePct(m.netProfitMarginPct.value, -150, 95);
    const currentEps = latestEntry.eps ?? (m.eps.value !== null ? round2(m.eps.value) : null);
    const currentNetProfitCr = latestEntry.netProfitCr ?? sanitizeMoneyCr(m.netProfit.value);
    const currentRevenueCr = latestEntry.revenueCr ?? sanitizeMoneyCr(m.revenue.value);

    const shareCapitalCr = sanitizeMoneyCr(latestM.shareCapital.value ?? m.shareCapital.value);
    const reservesCr = sanitizeMoneyCr(latestM.reserves.value ?? m.reserves.value);
    const reserveRatio =
      shareCapitalCr !== null && reservesCr !== null && shareCapitalCr > 0
        ? round2(reservesCr / shareCapitalCr)
        : null;

    const nplPct = sanitizePct(latestM.nplPct.value ?? m.nplPct.value, 0, 100);
    const carPct = sanitizePct(latestM.carPct.value ?? m.carPct.value, 0, 60);
    const debtToEquity =
      latestM.debtToEquity.value ?? m.debtToEquity.value ?? null;
    const ocfCr = sanitizeMoneyCr(latestM.operatingCashFlow.value ?? m.operatingCashFlow.value);
    const cdRatioPct = sanitizePct(latestM.cdRatioPct.value ?? m.cdRatioPct.value, 0, 130);
    const claimRatioPct = sanitizePct(latestM.claimRatioPct.value ?? m.claimRatioPct.value, 0, 200);
    const solvencyRatio = latestM.solvencyRatio.value ?? m.solvencyRatio.value ?? null;

    // ------------------------------------------------------------------
    // 1. MANAGEMENT QUALITY SCORE (0..100) from Annual Report metrics & notes
    // ------------------------------------------------------------------
    let mgmtScore = 0;
    const mgmtEvidence: string[] = [];

    // a) ROE vs Sector Hurdle (0..34 pts)
    if (currentRoe !== null) {
      const roePts = clip(
        ((currentRoe - Math.max(0, cfg.minRoePct - 5)) / Math.max(8, cfg.strongRoePct - (cfg.minRoePct - 5))) *
          34,
        0,
        34
      );
      mgmtScore += roePts;
      mgmtEvidence.push(
        `ROE at ${currentRoe.toFixed(1)}% vs ${cfg.strongRoePct}% ${row.sectorGroup} quality hurdle.`
      );
    } else {
      mgmtScore += 14;
    }

    // b) Capital Retention & Reserves Buffer (0..22 pts)
    if (reserveRatio !== null) {
      const resPts = clip((reserveRatio / 1.2) * 22, 2, 22);
      mgmtScore += resPts;
      mgmtEvidence.push(
        `Reserves / Paid-Up Capital at ${reserveRatio.toFixed(2)}x (${reservesCr !== null ? `Rs ${reservesCr.toFixed(1)} Cr` : 'verified'}).`
      );
    } else {
      mgmtScore += 10;
    }

    // c) Risk Stewardship & Balance Sheet Discipline (0..24 pts)
    if (isBfi) {
      let bfiPts = 12;
      if (nplPct !== null) {
        const maxNpl = cfg.maxNplPct ?? 4.5;
        bfiPts = nplPct <= 1.5 ? 16 : nplPct <= maxNpl ? 12 : Math.max(2, 12 - (nplPct - maxNpl) * 2.5);
        mgmtEvidence.push(`Asset quality: NPL ${nplPct.toFixed(2)}% (sector ceiling ${maxNpl}%).`);
      }
      if (carPct !== null) {
        const minCar = cfg.minCarPct ?? 11;
        bfiPts += carPct >= minCar + 2 ? 8 : carPct >= minCar ? 6 : 2;
        mgmtEvidence.push(`Capital adequacy (CAR): ${carPct.toFixed(1)}% vs ${minCar}% floor.`);
      } else {
        bfiPts += 4;
      }
      mgmtScore += clip(bfiPts, 0, 24);
    } else if (isInsurer) {
      let insPts = 12;
      if (claimRatioPct !== null) {
        insPts = claimRatioPct <= 55 ? 14 : claimRatioPct <= 70 ? 10 : 4;
        mgmtEvidence.push(`Underwriting claim ratio at ${claimRatioPct.toFixed(1)}%.`);
      }
      if (solvencyRatio !== null) {
        insPts += solvencyRatio >= 2.0 ? 10 : solvencyRatio >= 1.5 ? 7 : 3;
      } else {
        insPts += 5;
      }
      mgmtScore += clip(insPts, 0, 24);
    } else {
      let corpPts = 12;
      if (debtToEquity !== null) {
        const maxDe = cfg.maxDebtToEquity ?? 1.5;
        corpPts = debtToEquity <= 0.6 ? 15 : debtToEquity <= maxDe ? 11 : Math.max(2, 11 - (debtToEquity - maxDe) * 4);
        mgmtEvidence.push(`Leverage Debt/Equity at ${debtToEquity.toFixed(2)}x (comfort ≤ ${maxDe}x).`);
      }
      if (ocfCr !== null && currentNetProfitCr !== null && currentNetProfitCr > 0) {
        const ratio = ocfCr / currentNetProfitCr;
        corpPts += ratio >= 0.9 ? 9 : ratio >= 0.6 ? 6 : 2;
        mgmtEvidence.push(`Cash conversion OCF/PAT at ${(ratio * 100).toFixed(0)}%.`);
      } else if (currentMargin !== null) {
        corpPts += currentMargin >= 18 ? 8 : currentMargin >= 10 ? 5 : 2;
      }
      mgmtScore += clip(corpPts, 0, 24);
    }

    // d) Governance, Disclosure & Regulatory Standing + AI Management Assessment (0..20 pts)
    let govPts = chosen.validationStatus === 'Verified' || chosen.validationStatus === 'CrossChecked' ? 10 : 6;
    if (kbEntry?.regulatoryStanding === 'Clean') govPts += 5;
    else if (kbEntry?.regulatoryStanding === 'Watch') govPts += 2;
    else if (kbEntry?.regulatoryStanding === 'Alert') govPts -= 6;
    else govPts += 3;

    const ratingGrade = kbEntry?.creditRating?.ratingGrade;
    if (ratingGrade && /^(AAA|AA|A)/i.test(ratingGrade.replace(/\[.*?\]\s*/, ''))) {
      govPts += 5;
      mgmtEvidence.push(`Credit rating ${ratingGrade} (${kbEntry?.creditRating?.outlook ?? 'Stable'}).`);
    } else if (ratingGrade) {
      govPts += 2;
    } else {
      govPts += 2;
    }

    const aiMgmtNotes = aiFy?.managementQualityNotes ?? legacyAi?.auditorAndGovernanceFindings ?? [];
    if (aiMgmtNotes.length > 0) {
      govPts += scoreQualitativeTone(aiMgmtNotes) * 0.5;
      mgmtEvidence.unshift(aiMgmtNotes[0]);
    }
    mgmtScore = round1(clip(mgmtScore + govPts, 0, 100));

    // ------------------------------------------------------------------
    // 2. GROWTH POTENTIAL SCORE (0..100) from Annual Report metrics & catalysts
    // ------------------------------------------------------------------
    let growthScore = 0;
    const growthEvidence: string[] = [];

    // Prior-FY records strictly older than latestEntry (for YoY & multi-FY historical average)
    const priorFys = fysDesc.slice(1);
    const priorValidRoes = priorFys.map((p) => p.roePct).filter((v): v is number => v !== null);
    const priorValidMargins = priorFys.map((p) => p.netMarginPct).filter((v): v is number => v !== null);
    const priorValidRoas = priorFys.map((p) => p.roaPct).filter((v): v is number => v !== null);
    const priorValidEps = priorFys
      .map((p) => p.eps)
      .filter((v): v is number => v !== null && Math.abs(v) < 500);
    const priorValidNp = priorFys.map((p) => p.netProfitCr).filter((v): v is number => v !== null);
    const priorValidRev = priorFys.map((p) => p.revenueCr).filter((v): v is number => v !== null);

    const hasSelfMultiFy =
      fysDesc.length >= 2 &&
      (priorValidRoes.length > 0 ||
        priorValidNp.length > 0 ||
        priorValidEps.length > 0 ||
        priorValidMargins.length > 0);

    if (hasSelfMultiFy) multiFyCompanies++;

    const prevFy = fysDesc.length >= 2 ? fysDesc[1] : null;
    const npYoY = prevFy ? pctDiff(currentNetProfitCr, prevFy.netProfitCr) : null;
    const revYoY = prevFy ? pctDiff(currentRevenueCr, prevFy.revenueCr) : null;
    const epsYoY = prevFy ? pctDiff(currentEps, prevFy.eps) : null;

    // a) Earnings & Top-Line Expansion / Reinvestment Compounding Runway (0..42 pts)
    const growthSignals: number[] = [];
    if (npYoY !== null) {
      growthSignals.push(clip(20 + npYoY * 0.45, 0, 42));
      growthEvidence.push(
        `Net profit ${npYoY >= 0 ? 'grew' : 'contracted'} ${npYoY >= 0 ? '+' : ''}${npYoY.toFixed(1)}% vs FY ${prevFy!.fy}.`
      );
    }
    if (revYoY !== null) {
      growthSignals.push(clip(20 + revYoY * 0.45, 0, 42));
      growthEvidence.push(
        `Revenue ${revYoY >= 0 ? 'expanded' : 'softened'} ${revYoY >= 0 ? '+' : ''}${revYoY.toFixed(1)}% vs FY ${prevFy!.fy}.`
      );
    }
    if (epsYoY !== null) {
      growthSignals.push(clip(20 + epsYoY * 0.45, 0, 42));
    }

    if (growthSignals.length > 0) {
      growthScore += mean(growthSignals)!;
    } else {
      // Single-FY sustainable growth / reinvestment proxy: ROE + Margin + positive EPS
      let baseGrowth = 16;
      if (currentRoe !== null) {
        baseGrowth += clip((currentRoe - 5) * 0.9, -8, 16);
      }
      if (currentMargin !== null) {
        baseGrowth += clip(currentMargin * 0.35, -4, 10);
      }
      if (currentEps !== null && currentEps <= 0) {
        baseGrowth -= 8;
      }
      growthScore += clip(baseGrowth, 4, 42);
      if (currentRoe !== null && currentEps !== null) {
        growthEvidence.push(
          `Sustainable compounding proxy: ${currentRoe.toFixed(1)}% ROE with Rs ${currentEps.toFixed(1)} EPS.`
        );
      }
    }

    // b) Forward Operational Headroom & Valuation Rerating Potential (0..30 pts)
    let headroomPts = 12;
    const mos = row.keyMetrics.marginOfSafetyPct;
    if (mos !== null) {
      headroomPts += mos >= 20 ? 10 : mos >= 5 ? 6 : mos >= -15 ? 2 : -3;
      if (mos >= 10) {
        growthEvidence.push(`Valuation Margin of Safety at +${mos.toFixed(1)}% offers rerating upside.`);
      }
    }
    if (isBfi && cdRatioPct !== null) {
      headroomPts += cdRatioPct < 82 ? 8 : cdRatioPct < 88 ? 4 : 0;
      if (cdRatioPct < 84) {
        growthEvidence.push(`BFI lending headroom: CD ratio at ${cdRatioPct.toFixed(1)}% (< 90% NRB ceiling).`);
      }
    } else if (reserveRatio !== null) {
      headroomPts += reserveRatio >= 0.9 ? 7 : reserveRatio >= 0.4 ? 4 : 1;
    } else {
      headroomPts += 3;
    }
    // Coming-quarter catalyst score contribution
    if (row.comingQuarterOutlook?.direction === 'Blow Up') {
      headroomPts += 4;
      growthEvidence.push(row.comingQuarterOutlook.headline);
    } else if (row.comingQuarterOutlook?.direction === 'Blow Down') {
      headroomPts -= 4;
    }
    growthScore += clip(headroomPts, 0, 30);

    // c) Strategic Plans, Business Opportunities & Sector Tailwinds (0..28 pts)
    let stratPts = 14;
    const aiGrowthNotes = [
      ...(aiFy?.growthHighlights ?? []),
      ...(aiFy?.upcomingBusinessPlans ?? []),
      ...(aiFy?.businessOpportunities ?? []),
      ...(legacyAi?.managementGuidanceAndCatalysts ?? []),
      ...(legacyAi?.annualReportOpportunities ?? []),
    ];
    if (aiGrowthNotes.length > 0) {
      stratPts += 8 + scoreQualitativeTone(aiGrowthNotes) * 0.6;
      growthEvidence.unshift(aiGrowthNotes[0]);
    } else if (auditCache?.catalysts?.length) {
      stratPts += 6;
      growthEvidence.push(auditCache.catalysts[0].headline);
    }
    if (row.scores.overallScore >= 68) stratPts += 4;
    else if (row.scores.overallScore < 45) stratPts -= 4;

    growthScore = round1(clip(growthScore + stratPts, 0, 100));

    // ------------------------------------------------------------------
    // 3. HISTORICAL OUTPERFORMANCE VS HISTORICAL AVERAGES
    // ------------------------------------------------------------------
    const secBase = sectorAvgMap.get(row.sector) ?? {
      roe: cfg.minRoePct,
      margin: 15,
      roa: 1.5,
      reserveRatio: 0.6,
      eps: 15,
    };

    let baselineMode: StrategicOutlookBaselineMode = hasSelfMultiFy ? 'self-multi-fy' : 'sector-baseline';
    let baselineLabel = hasSelfMultiFy
      ? `${fysDesc.length}-FY Self Historical Avg`
      : `${row.sector} Sector Avg Baseline`;

    const histRoeAvg = hasSelfMultiFy
      ? priorValidRoes.length > 0
        ? round2(mean(priorValidRoes)!)
        : null
      : secBase.roe;
    const histMarginAvg = hasSelfMultiFy
      ? priorValidMargins.length > 0
        ? round2(mean(priorValidMargins)!)
        : null
      : secBase.margin;
    const histRoaAvg = hasSelfMultiFy
      ? priorValidRoas.length > 0
        ? round2(mean(priorValidRoas)!)
        : null
      : secBase.roa;
    const histEpsAvg = hasSelfMultiFy
      ? priorValidEps.length > 0
        ? round2(mean(priorValidEps)!)
        : null
      : secBase.eps;
    const histNpAvg =
      hasSelfMultiFy && priorValidNp.length > 0 ? round2(mean(priorValidNp)!) : null;
    const histRevAvg =
      hasSelfMultiFy && priorValidRev.length > 0 ? round2(mean(priorValidRev)!) : null;

    const comparisons: StrategicOutlookMetricComparison[] = [];
    const normalizedOutperfSignals: number[] = [];

    // ROE vs Historical Avg (in pp)
    if (currentRoe !== null && histRoeAvg !== null) {
      const diffPp = round2(currentRoe - histRoeAvg);
      comparisons.push({
        key: 'roePct',
        label: 'Return on Equity (ROE)',
        unit: '%',
        currentVal: currentRoe,
        historicalAvgVal: histRoeAvg,
        deltaVal: diffPp,
        deltaDisplay: `${diffPp >= 0 ? '+' : ''}${diffPp.toFixed(2)} pp`,
        outperforming: Math.abs(diffPp) < 0.75 ? null : diffPp > 0,
      });
      // +/- 10 pp ROE maps to +/- 50 score points
      normalizedOutperfSignals.push(clip(diffPp * 5, -60, 60));
    }

    // Net Margin vs Historical Avg (in pp)
    if (currentMargin !== null && histMarginAvg !== null) {
      const diffPp = round2(currentMargin - histMarginAvg);
      comparisons.push({
        key: 'netMarginPct',
        label: 'Net Profit Margin',
        unit: '%',
        currentVal: currentMargin,
        historicalAvgVal: histMarginAvg,
        deltaVal: diffPp,
        deltaDisplay: `${diffPp >= 0 ? '+' : ''}${diffPp.toFixed(2)} pp`,
        outperforming: Math.abs(diffPp) < 0.75 ? null : diffPp > 0,
      });
      normalizedOutperfSignals.push(clip(diffPp * 3.2, -50, 50));
    }

    // ROA vs Historical Avg (in pp)
    if (currentRoa !== null && histRoaAvg !== null) {
      const diffPp = round2(currentRoa - histRoaAvg);
      comparisons.push({
        key: 'roaPct',
        label: 'Return on Assets (ROA)',
        unit: '%',
        currentVal: currentRoa,
        historicalAvgVal: histRoaAvg,
        deltaVal: diffPp,
        deltaDisplay: `${diffPp >= 0 ? '+' : ''}${diffPp.toFixed(2)} pp`,
        outperforming: Math.abs(diffPp) < 0.15 ? null : diffPp > 0,
      });
      normalizedOutperfSignals.push(clip(diffPp * 20, -45, 45));
    }

    // EPS vs Historical Avg (%)
    if (currentEps !== null && histEpsAvg !== null && Math.abs(histEpsAvg) >= 1) {
      const pct = pctDiff(currentEps, histEpsAvg);
      if (pct !== null) {
        comparisons.push({
          key: 'eps',
          label: 'Earnings Per Share (EPS)',
          unit: 'Rs',
          currentVal: currentEps,
          historicalAvgVal: histEpsAvg,
          deltaVal: pct,
          deltaDisplay: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
          outperforming: Math.abs(pct) < 4 ? null : pct > 0,
        });
        normalizedOutperfSignals.push(clip(pct * 0.9, -65, 65));
      }
    }

    // Net Profit vs Historical Avg (when multi-FY exists)
    if (currentNetProfitCr !== null && histNpAvg !== null) {
      const pct = pctDiff(currentNetProfitCr, histNpAvg);
      if (pct !== null) {
        comparisons.push({
          key: 'netProfitCr',
          label: 'Net Profit',
          unit: 'Cr',
          currentVal: currentNetProfitCr,
          historicalAvgVal: histNpAvg,
          deltaVal: pct,
          deltaDisplay: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
          outperforming: Math.abs(pct) < 4 ? null : pct > 0,
        });
        normalizedOutperfSignals.push(clip(pct * 0.9, -65, 65));
      }
    }

    // Revenue vs Historical Avg (when multi-FY exists)
    if (currentRevenueCr !== null && histRevAvg !== null) {
      const pct = pctDiff(currentRevenueCr, histRevAvg);
      if (pct !== null) {
        comparisons.push({
          key: 'revenueCr',
          label: 'Top-Line Revenue',
          unit: 'Cr',
          currentVal: currentRevenueCr,
          historicalAvgVal: histRevAvg,
          deltaVal: pct,
          deltaDisplay: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
          outperforming: Math.abs(pct) < 4 ? null : pct > 0,
        });
        normalizedOutperfSignals.push(clip(pct * 0.65, -45, 45));
      }
    }

    const rawOutperf = mean(normalizedOutperfSignals);
    const outperformanceScore = round1(
      clip(rawOutperf !== null ? rawOutperf * 1.45 : (mgmtScore + growthScore) / 2 - 55, -100, 100)
    );
    const outperformanceStatus: OutperformanceStatus =
      outperformanceScore >= 6 ? 'Outperforming' : outperformanceScore <= -6 ? 'Lagging' : 'In-Line';

    const roeComp = comparisons.find((c) => c.key === 'roePct');
    const epsComp = comparisons.find((c) => c.key === 'eps');
    const marginComp = comparisons.find((c) => c.key === 'netMarginPct');
    const primaryDeltaLabel = roeComp
      ? `ROE ${roeComp.deltaDisplay}`
      : epsComp
        ? `EPS ${epsComp.deltaDisplay}`
        : marginComp
          ? `Margin ${marginComp.deltaDisplay}`
          : `${outperformanceScore >= 0 ? '+' : ''}${outperformanceScore.toFixed(0)} idx`;

    // ------------------------------------------------------------------
    // 4. QUADRANT CATEGORIZATION (Management Quality x Growth Potential)
    // ------------------------------------------------------------------
    let quadrant: StrategicOutlookQuadrant;
    if (mgmtScore >= MGMT_THRESHOLD && growthScore >= GROWTH_THRESHOLD) {
      quadrant = 'Compounders';
    } else if (mgmtScore < MGMT_THRESHOLD && growthScore >= GROWTH_THRESHOLD) {
      quadrant = 'Scaling & Turnaround';
    } else if (mgmtScore >= MGMT_THRESHOLD && growthScore < GROWTH_THRESHOLD) {
      quadrant = 'Resilient Stewards';
    } else {
      quadrant = 'Restructuring Watch';
    }

    quadrantCounts[quadrant]++;
    outperformanceCounts[outperformanceStatus]++;
    sectorSet.add(row.sector);

    const mgmtStatus = statusFromScore(mgmtScore);
    const growthStatus = statusFromScore(growthScore);
    const strategicCompositeScore = round1(
      mgmtScore * 0.45 + growthScore * 0.45 + clip(50 + outperformanceScore * 0.4, 0, 100) * 0.1
    );

    const managementHeadline =
      aiMgmtNotes[0] ||
      (mgmtStatus === 'Strong'
        ? `Strong stewardship (${currentRoe !== null ? `${currentRoe.toFixed(1)}% ROE` : 'healthy ratios'}) and disciplined balance sheet.`
        : mgmtStatus === 'Fragile'
          ? `Governance or return pressure requires close scrutiny (${nplPct !== null && isBfi ? `${nplPct.toFixed(2)}% NPL` : 'low ROE'}).`
          : `Steady capital allocation with room for ROE and reserve compounding.`);

    const growthHeadline =
      aiGrowthNotes[0] ||
      (growthStatus === 'Strong'
        ? `Above-trend expansion and forward catalyst visibility across ${row.sector}.`
        : growthStatus === 'Fragile'
          ? `Muted earnings velocity or contraction relative to sector runway.`
          : `Moderate growth trajectory supported by core ${row.sector} operations.`);

    const auditedFyCount = fysDesc.filter((f) => f.rec.quarter === 'Annual').length;
    const businessDirectionSummary =
      aiFy?.businessDirection ||
      legacyAi?.futureWorthOutlook ||
      `${row.companyName} sits in ${quadrant} (${outperformanceStatus.toLowerCase()} vs ${baselineLabel}).`;

    const upcomingPlans = (
      aiFy?.upcomingBusinessPlans ??
      legacyAi?.managementGuidanceAndCatalysts ??
      auditCache?.catalysts?.map((c) => c.headline) ??
      []
    ).slice(0, 4);

    outRows.push({
      symbol: row.symbol,
      companyName: row.companyName,
      sector: row.sector,
      sectorGroup: row.sectorGroup,
      ltp: row.market.ltp,
      changePct: row.market.changePct,
      latestFy: latestEntry.fy,
      recommendedAnnualFy,
      latestBasis: quarterBasisFor(chosen.quarter),
      totalFyCount: fysDesc.length,
      auditedFyCount,
      aiDistilledFyCount: aiByFy.size,
      hasAiDistillation: hasAi,
      managementQualityScore: mgmtScore,
      managementStatus: mgmtStatus,
      managementHeadline,
      managementEvidence: mgmtEvidence.slice(0, 5),
      growthPotentialScore: growthScore,
      growthStatus,
      growthHeadline,
      growthEvidence: growthEvidence.slice(0, 5),
      strategicCompositeScore,
      quadrant,
      baselineMode,
      baselineLabel,
      historicalPeriodCount: fysDesc.length,
      outperformanceScore,
      outperformanceStatus,
      primaryDeltaLabel,
      historicalComparisons: comparisons,
      roePct: currentRoe,
      histRoePct: histRoeAvg,
      netMarginPct: currentMargin,
      histNetMarginPct: histMarginAvg,
      roaPct: currentRoa,
      eps: currentEps,
      netProfitCr: currentNetProfitCr,
      revenueCr: currentRevenueCr,
      reserveRatio,
      nplPct,
      carPct,
      debtToEquity,
      creditRatingLabel: kbEntry?.creditRating?.ratingGrade
        ? `${kbEntry.creditRating.ratingGrade} (${kbEntry.creditRating.outlook})`
        : null,
      regulatoryStanding: kbEntry?.regulatoryStanding ?? 'Unknown',
      marginOfSafetyPct: mos,
      businessDirectionSummary,
      upcomingPlans,
    });
  }

  // Sort default: Outperforming + Strategic Composite descending
  outRows.sort(
    (a, b) =>
      b.outperformanceScore - a.outperformanceScore ||
      b.strategicCompositeScore - a.strategicCompositeScore ||
      a.symbol.localeCompare(b.symbol)
  );

  // Sector benchmarks rollup
  const sectorGroups = new Map<string, StrategicOutlookCompanyRow[]>();
  for (const r of outRows) {
    const arr = sectorGroups.get(r.sector) ?? [];
    arr.push(r);
    sectorGroups.set(r.sector, arr);
  }

  const sectorBenchmarks: StrategicOutlookSectorBenchmark[] = Array.from(sectorGroups.entries())
    .map(([sector, rows]) => {
      const roes = rows.map((r) => r.roePct).filter((v): v is number => v !== null);
      const margins = rows.map((r) => r.netMarginPct).filter((v): v is number => v !== null);
      return {
        sector,
        sectorGroup: rows[0].sectorGroup,
        count: rows.length,
        avgManagementScore: round1(mean(rows.map((r) => r.managementQualityScore)) ?? 0),
        avgGrowthScore: round1(mean(rows.map((r) => r.growthPotentialScore)) ?? 0),
        avgOutperformanceScore: round1(mean(rows.map((r) => r.outperformanceScore)) ?? 0),
        outperformingCount: rows.filter((r) => r.outperformanceStatus === 'Outperforming').length,
        laggingCount: rows.filter((r) => r.outperformanceStatus === 'Lagging').length,
        avgRoePct: roes.length > 0 ? round2(mean(roes)!) : null,
        avgNetMarginPct: margins.length > 0 ? round2(mean(margins)!) : null,
      };
    })
    .sort((a, b) => b.avgOutperformanceScore - a.avgOutperformanceScore);

  const dates = store.getDates();
  return {
    generatedAt: new Date().toISOString(),
    marketDate: dates[dates.length - 1] ?? null,
    fiscalContext,
    managementThreshold: MGMT_THRESHOLD,
    growthThreshold: GROWTH_THRESHOLD,
    totalCompanies: outRows.length,
    multiFyCompanies,
    aiDistilledCompanies,
    quadrantCounts,
    outperformanceCounts,
    sectors: Array.from(sectorSet).sort(),
    sectorBenchmarks,
    rows: outRows,
  };
}
