import type {
  CompanyKnowledgeBaseEntry,
  HiddenGemArchetype,
  HiddenGemCandidate,
  HiddenGemsResponse,
  ReportMonitorStatus,
  ScreenedCompanyRow,
} from '../../src/types/fundamental.ts';
import type { MarketStore } from '../marketStore.ts';
import { FundamentalVault } from './fundamentalVault.ts';
import { evaluateScreenerUniverse } from './investorScoringEngine.ts';
import { RegulatoryKnowledgeBase } from './regulatoryKnowledgeBase.ts';
import { getSectorThresholds } from './sectorMethodology.ts';

function clip(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isInvestmentGradeRating(grade: string | null): boolean {
  if (!grade) return false;
  const g = grade.toUpperCase();
  return (
    /\bAAA\b/.test(g) ||
    /\bAA[+-]?\b/.test(g) ||
    /\bA[+-]?\b/.test(g) ||
    /\bBBB\+\b/.test(g) ||
    /\bBBB\b/.test(g)
  );
}

function ratingTierBonus(grade: string | null): number {
  if (!grade) return 0;
  const g = grade.toUpperCase();
  if (/\bAAA\b|\bAA[+-]?\b/.test(g)) return 5;
  if (/\bA[+-]?\b/.test(g)) return 4;
  if (/\bBBB[+-]?\b/.test(g)) return 2.5;
  if (/\bBB[+-]?\b/.test(g)) return 0.5;
  if (/\b[CD]\b|\bB[+-]?\b/.test(g)) return -2;
  return 0;
}

export interface HiddenGemsQueryOptions {
  equityOnly?: boolean;
  benchmarkFdRatePct?: number;
  annualWeightPct?: number;
  monitorStatusMap?: Map<string, ReportMonitorStatus>;
  archetype?: HiddenGemArchetype | 'all';
  sector?: string;
  search?: string;
  minScore?: number | null;
  minMos?: number | null;
  maxPe?: number | null;
  maxPb?: number | null;
  minRoe?: number | null;
  maxNpl?: number | null;
  beatsFdOnly?: boolean;
  onlyWithKb?: boolean;
  investmentGradeOnly?: boolean;
  excludeAlertsAndLockIn?: boolean;
  requireAnnualReport?: boolean;
}

export function evaluateHiddenGems(
  store: MarketStore,
  vault: FundamentalVault,
  kb: RegulatoryKnowledgeBase,
  opts: HiddenGemsQueryOptions = {}
): HiddenGemsResponse {
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
    monitorStatusMap: opts.monitorStatusMap,
    benchmarkFdRatePct,
    annualWeightPct,
  });

  // Compute cross-sectional turnover ranking from latest NEPSE session
  const turnoverRanked = [...evaluated.rows]
    .filter((r) => (r.market.turnover ?? 0) > 0)
    .sort((a, b) => (b.market.turnover ?? 0) - (a.market.turnover ?? 0));
  const turnoverRankMap = new Map<string, number>();
  turnoverRanked.forEach((r, idx) => turnoverRankMap.set(r.symbol, idx + 1));
  const totalRankedByTurnover = turnoverRanked.length;

  const kbMap = kb.getAllCompanyEntries();
  const kbSummary = kb.getSummary();
  const kbResp = kb.queryKnowledgeBase();

  const archetypeCounts: Record<HiddenGemArchetype, number> = {
    undiscovered_quality: 0,
    deep_value_mos: 0,
    earnings_inflection: 0,
    clean_bfi_yield: 0,
    insurance_float: 0,
    kb_tailwind: 0,
  };

  const candidates: HiddenGemCandidate[] = [];
  let totalEvaluated = 0;

  for (const row of evaluated.rows) {
    if (!row.hasFundamentalData || row.market.ltp === null) continue;
    totalEvaluated++;

    const km = row.keyMetrics;
    const mk = row.market;
    const thresholds = getSectorThresholds(row.sectorGroup);
    const kbEntry: CompanyKnowledgeBaseEntry | null = kbMap.get(row.symbol) ?? null;
    const relatedNotices = kbResp.notices.filter((n) => n.symbols.includes(row.symbol));

    const turnoverRank = turnoverRankMap.get(row.symbol) ?? null;
    const earningsYieldSpreadPct =
      km.earningsYieldPct !== null ? round1(km.earningsYieldPct - benchmarkFdRatePct) : null;

    // 1. Valuation Mispricing (max 30)
    let valScore = 0;
    if (km.marginOfSafetyPct !== null) {
      if (km.marginOfSafetyPct >= 25) valScore += 14;
      else if (km.marginOfSafetyPct >= 10) valScore += 11;
      else if (km.marginOfSafetyPct >= 0) valScore += 8;
      else if (km.marginOfSafetyPct >= -20) valScore += 4.5;
      else if (km.marginOfSafetyPct >= -35) valScore += 2;
    }
    if (km.pe !== null && km.pe > 0) {
      if (km.pe <= thresholds.deepValuePe) valScore += 8;
      else if (km.pe <= thresholds.maxPe) valScore += 5;
      else if (km.pe <= thresholds.maxPe * 1.2) valScore += 2.5;
    }
    if (km.pb !== null && km.pb > 0) {
      if (km.pb <= thresholds.deepValuePb) valScore += 5;
      else if (km.pb <= thresholds.maxPb) valScore += 3;
    }
    if (earningsYieldSpreadPct !== null) {
      if (earningsYieldSpreadPct >= 2.0) valScore += 4;
      else if (earningsYieldSpreadPct > 0) valScore += 2.5;
      else if (earningsYieldSpreadPct >= -1.0) valScore += 1;
    }
    valScore = round1(clip(valScore, 0, 30));

    // 2. Fundamental Quality & Moat (max 25)
    let qualScore = round1(clip((row.scores.fundamentalQualityScore / 100) * 18, 0, 18));
    const safetyOk =
      row.sectorGroup === 'Banking' || row.sectorGroup === 'Microfinance'
        ? (km.nplPct === null || km.nplPct <= (thresholds.maxNplPct ?? 4.5)) &&
          (km.carPct === null || km.carPct >= (thresholds.minCarPct ?? 10))
        : km.debtToEquity === null || km.debtToEquity <= (thresholds.maxDebtToEquity ?? 1.5);
    if (safetyOk) qualScore += 3.5;
    if ((km.roePct ?? 0) >= thresholds.strongRoePct) qualScore += 2.5;
    else if ((km.roePct ?? 0) >= thresholds.minRoePct) qualScore += 1.5;
    if (row.reportWeighting.hasAnnualReport) {
      qualScore += 2.5 * (annualWeightPct / 100);
    }
    qualScore = round1(clip(qualScore, 0, 25));

    // 3. Earnings Inflection & Compounding (max 20)
    let inflectScore = 0;
    let hasTrendMetrics = false;
    if (km.epsQoqPct !== null) {
      hasTrendMetrics = true;
      if (km.epsQoqPct > 0) inflectScore += km.epsQoqPct >= 15 ? 6 : km.epsQoqPct >= 5 ? 4 : 2;
    }
    if (km.epsYoyPct !== null) {
      hasTrendMetrics = true;
      if (km.epsYoyPct > 0) inflectScore += km.epsYoyPct >= 20 ? 6 : km.epsYoyPct >= 10 ? 4 : 2;
    }
    if (km.epsVsQ4Avg3yPct !== null) {
      hasTrendMetrics = true;
      if (km.epsVsQ4Avg3yPct > 0) inflectScore += km.epsVsQ4Avg3yPct >= 15 ? 4 : 2.5;
    }
    if (km.peg !== null && km.peg > 0 && km.peg <= 1.1) {
      inflectScore += 4;
    } else if (km.epsCagr3yPct !== null && km.epsCagr3yPct >= 12) {
      inflectScore += 3;
    }
    // When multi-quarter history isn't published yet, reward verified current profitability & ROE compounding power
    if (!hasTrendMetrics && (km.eps ?? 0) > 0) {
      if ((km.roePct ?? 0) >= thresholds.strongRoePct) inflectScore += 8;
      else if ((km.roePct ?? 0) >= thresholds.minRoePct) inflectScore += 5;
      else if ((km.roePct ?? 0) > 8) inflectScore += 2.5;
      if ((km.netMarginPct ?? 0) >= thresholds.minNetMarginPct) inflectScore += 3;
    }
    inflectScore = round1(clip(inflectScore, 0, 20));

    // 4. Crowd Neglect & Quiet Accumulation Alpha (max 15)
    let neglectScore = 0;
    if (turnoverRank !== null) {
      if (turnoverRank > 25) neglectScore += 7;
      else if (turnoverRank > 12) neglectScore += 5;
      else neglectScore += 2;
    } else {
      neglectScore += 4;
    }
    if (mk.gap52hPct !== null) {
      const drop = Math.abs(mk.gap52hPct);
      if (drop >= 12 && drop <= 45) neglectScore += 5;
      else if (drop >= 5 && drop < 12) neglectScore += 2.5;
    }
    if (mk.turnoverMultN !== null && mk.turnoverMultN >= 1.0 && mk.turnoverMultN <= 3.5) {
      neglectScore += 3;
    }
    neglectScore = round1(clip(neglectScore, 0, 15));

    // 5. Knowledge Base & Regulatory Conviction (max 10)
    let kbScore = 3; // Neutral baseline when KB not fetched yet
    if (kbEntry || relatedNotices.length > 0) {
      kbScore = 4;
      const grade = kbEntry?.creditRating.ratingGrade ?? null;
      kbScore += ratingTierBonus(grade);
      if (kbEntry?.creditRating.outlook === 'Positive') kbScore += 1.5;
      if (kbEntry?.creditRating.outlook === 'Negative') kbScore -= 2.5;
      if (kbEntry?.regulatoryStanding === 'Positive' || kbEntry?.regulatoryStanding === 'Clean') {
        kbScore += 1.5;
      } else if (kbEntry?.regulatoryStanding === 'Alert') {
        kbScore -= 4;
      } else if (kbEntry?.regulatoryStanding === 'Watch') {
        kbScore -= 1.5;
      }
      if (kbEntry?.lockInOverhangFlag) {
        kbScore -= 3;
      }
      if ((kbEntry?.tailwinds.length ?? 0) > 0) kbScore += 1;
    }
    kbScore = round1(clip(kbScore, 0, 10));

    const hiddenGemScore = round1(
      clip(valScore + qualScore + inflectScore + neglectScore + kbScore, 0, 100)
    );

    // Determine qualifying Hidden Gem Archetypes
    const archetypes: HiddenGemArchetype[] = [];

    const reasonableRelativeValue =
      (km.marginOfSafetyPct !== null && km.marginOfSafetyPct >= -25) ||
      (km.pe !== null && km.pe > 0 && km.pe <= thresholds.maxPe) ||
      (km.pb !== null && km.pb > 0 && km.pb <= thresholds.maxPb);

    if (
      (km.roePct ?? 0) >= thresholds.minRoePct &&
      row.scores.fundamentalQualityScore >= 60 &&
      reasonableRelativeValue &&
      (turnoverRank === null || turnoverRank > 12)
    ) {
      archetypes.push('undiscovered_quality');
    }

    if (
      safetyOk &&
      (km.eps ?? 0) > 0 &&
      ((km.marginOfSafetyPct ?? -999) >= 5 ||
        (km.pe !== null && km.pe > 0 && km.pe <= thresholds.deepValuePe && (km.pb === null || km.pb <= thresholds.maxPb)) ||
        (km.pb !== null && km.pb > 0 && km.pb <= thresholds.deepValuePb && (km.roePct ?? 0) >= thresholds.minRoePct * 0.85))
    ) {
      archetypes.push('deep_value_mos');
    }

    if (
      ((km.epsQoqPct ?? -999) >= 5 || (km.epsYoyPct ?? -999) >= 12 || (km.epsVsQ4Avg3yPct ?? -999) >= 10) &&
      (km.eps ?? 0) > 0 &&
      (km.pe === null || km.pe <= thresholds.maxPe * 1.15)
    ) {
      archetypes.push('earnings_inflection');
    }

    if (
      (row.sectorGroup === 'Banking' || row.sectorGroup === 'Microfinance') &&
      (km.nplPct === null || km.nplPct <= 3.5) &&
      (km.carPct === null || km.carPct >= 11) &&
      (km.roePct ?? 0) >= thresholds.minRoePct &&
      ((earningsYieldSpreadPct ?? -999) >= 0 ||
        (km.pb !== null && km.pb <= thresholds.maxPb && km.pe !== null && km.pe <= thresholds.maxPe))
    ) {
      archetypes.push('clean_bfi_yield');
    }

    if (
      row.sectorGroup === 'Insurance' &&
      (km.roePct ?? 0) >= 11 &&
      ((km.marginOfSafetyPct ?? -999) >= -15 ||
        (km.pe !== null && km.pe > 0 && km.pe <= 26) ||
        (km.pb !== null && km.pb > 0 && km.pb <= thresholds.maxPb))
    ) {
      archetypes.push('insurance_float');
    }

    if (
      kbEntry &&
      (isInvestmentGradeRating(kbEntry.creditRating.ratingGrade) ||
        kbEntry.regulatoryStanding === 'Positive' ||
        kbEntry.tailwinds.length > 0) &&
      kbEntry.regulatoryStanding !== 'Alert' &&
      !kbEntry.lockInOverhangFlag &&
      (km.marginOfSafetyPct === null ||
        km.marginOfSafetyPct >= -25 ||
        (km.pe !== null && km.pe > 0 && km.pe <= thresholds.maxPe))
    ) {
      archetypes.push('kb_tailwind');
    }

    // Must qualify for at least one archetype OR achieve strong composite score with reasonable multiples
    const isEligible =
      archetypes.length > 0 ||
      (hiddenGemScore >= 52 &&
        (km.eps ?? 0) > 0 &&
        safetyOk &&
        ((km.pe !== null && km.pe <= thresholds.maxPe) || (km.pb !== null && km.pb <= thresholds.maxPb)));
    if (!isEligible) continue;

    if (archetypes.length === 0) {
      archetypes.push('undiscovered_quality');
    }

    for (const a of archetypes) {
      archetypeCounts[a]++;
    }

    const primaryArchetype = archetypes[0];
    const convictionTier: HiddenGemCandidate['convictionTier'] =
      hiddenGemScore >= 72 && archetypes.length >= 2
        ? 'Tier 1 Gem'
        : hiddenGemScore >= 60
          ? 'Tier 2 Gem'
          : 'Emerging Watch';

    const whyHiddenGem: string[] = [];
    if (km.marginOfSafetyPct !== null && km.marginOfSafetyPct > 0 && km.intrinsicValue !== null) {
      whyHiddenGem.push(
        `Trades at +${km.marginOfSafetyPct.toFixed(1)}% Margin of Safety (LTP Rs ${mk.ltp?.toFixed(1)} vs Intrinsic Rs ${km.intrinsicValue.toFixed(1)}).`
      );
    }
    if (earningsYieldSpreadPct !== null && earningsYieldSpreadPct > 0) {
      whyHiddenGem.push(
        `Earnings yield (${km.earningsYieldPct?.toFixed(2)}%) beats Nepal Bank FD (${benchmarkFdRatePct.toFixed(1)}%) by +${earningsYieldSpreadPct.toFixed(2)}%.`
      );
    }
    if (km.roePct !== null && km.roePct >= thresholds.minRoePct) {
      whyHiddenGem.push(
        `Strong ${km.roePct.toFixed(1)}% ROE${km.pe ? ` at ${km.pe.toFixed(1)}x P/E` : ''}${km.pb ? ` & ${km.pb.toFixed(2)}x P/B` : ''}.`
      );
    }
    if (km.epsQoqPct !== null && km.epsQoqPct > 0) {
      whyHiddenGem.push(`EPS accelerating +${km.epsQoqPct.toFixed(1)}% QoQ${km.epsYoyPct !== null ? ` (${km.epsYoyPct >= 0 ? '+' : ''}${km.epsYoyPct.toFixed(1)}% YoY)` : ''}.`);
    } else if (km.epsVsQ4Avg3yPct !== null && km.epsVsQ4Avg3yPct > 5) {
      whyHiddenGem.push(`Annualized EPS is +${km.epsVsQ4Avg3yPct.toFixed(1)}% above its 3-year Q4 average.`);
    }
    if (turnoverRank !== null && turnoverRank > 15) {
      whyHiddenGem.push(
        `Under-followed liquidity rank #${turnoverRank} of ${totalRankedByTurnover} equities${mk.gap52hPct !== null ? ` (${mk.gap52hPct.toFixed(1)}% off 52W high)` : ''}.`
      );
    }
    if (row.reportWeighting.basis === 'blended') {
      whyHiddenGem.push(
        `Weighted ${row.reportWeighting.annualWeightPct}% Annual (${row.reportWeighting.annualPeriodLabel}) + ${row.reportWeighting.interimWeightPct}% Interim (${row.reportWeighting.interimPeriodLabel}).`
      );
    } else if (row.reportWeighting.basis === 'annual_only' && row.reportWeighting.annualPeriodLabel) {
      whyHiddenGem.push(
        `Backed by full-year Annual/Q4 report (${row.reportWeighting.annualPeriodLabel}).`
      );
    }
    if (kbEntry?.creditRating.ratingGrade) {
      whyHiddenGem.push(
        `${kbEntry.creditRating.agency ?? 'Agency'} rating ${kbEntry.creditRating.ratingGrade} (${kbEntry.creditRating.outlook}).`
      );
    }
    if (kbEntry?.tailwinds.length) {
      whyHiddenGem.push(kbEntry.tailwinds[0]);
    }

    const riskWatchouts: string[] = [];
    if (!row.reportWeighting.hasAnnualReport && annualWeightPct >= 60) {
      riskWatchouts.push(
        `Interim quarterly report only — ${annualWeightPct}% Annual Report weight awaits full-year/Q4 filing.`
      );
    }
    if (km.nplPct !== null && km.nplPct > 3.5) {
      riskWatchouts.push(`Elevated NPL at ${km.nplPct.toFixed(2)}% — monitor NRB asset quality disclosures.`);
    }
    if (km.debtToEquity !== null && thresholds.maxDebtToEquity !== null && km.debtToEquity > thresholds.maxDebtToEquity) {
      riskWatchouts.push(`Debt/Equity ${km.debtToEquity.toFixed(2)}x above ${thresholds.maxDebtToEquity}x sector guideline.`);
    }
    if (mk.turnover !== null && mk.turnover < 5_000_000) {
      riskWatchouts.push(`Thin session turnover (Rs ${(mk.turnover / 1e5).toFixed(1)} Lakh) — use limit orders.`);
    }
    if (kbEntry?.lockInOverhangFlag) {
      riskWatchouts.push(`CDSC promoter/share lock-in supply overhang flagged.`);
    }
    if (kbEntry?.riskFlags.length) {
      riskWatchouts.push(...kbEntry.riskFlags.slice(0, 2));
    }
    if (!kbEntry) {
      riskWatchouts.push(`Regulatory & credit rating KB not yet harvested for ${row.symbol}.`);
    }

    candidates.push({
      symbol: row.symbol,
      companyName: row.companyName,
      sector: row.sector,
      sectorGroup: row.sectorGroup,
      hiddenGemScore,
      subScores: {
        valuationMispricing: valScore,
        qualityMoat: qualScore,
        earningsInflection: inflectScore,
        crowdNeglectAlpha: neglectScore,
        knowledgeBaseConviction: kbScore,
      },
      archetypes,
      primaryArchetype,
      convictionTier,
      whyHiddenGem: whyHiddenGem.slice(0, 5),
      riskWatchouts: riskWatchouts.slice(0, 4),
      turnoverRank,
      totalRankedByTurnover,
      earningsYieldSpreadPct,
      kbEntry,
      screenerRow: row,
    });
  }

  // Sort by Hidden Gem Score descending, then Passed Investor Count, then MoS
  candidates.sort(
    (a, b) =>
      b.hiddenGemScore - a.hiddenGemScore ||
      b.screenerRow.passedInvestorCount - a.screenerRow.passedInvestorCount ||
      (b.screenerRow.keyMetrics.marginOfSafetyPct ?? -999) -
        (a.screenerRow.keyMetrics.marginOfSafetyPct ?? -999)
  );

  // Apply user query filters
  let filtered = candidates;
  if (opts.archetype && opts.archetype !== 'all') {
    filtered = filtered.filter((g) => g.archetypes.includes(opts.archetype as HiddenGemArchetype));
  }
  if (opts.sector && opts.sector !== 'All') {
    filtered = filtered.filter((g) => g.sector === opts.sector || g.sectorGroup === opts.sector);
  }
  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim().toLowerCase();
    filtered = filtered.filter(
      (g) =>
        g.symbol.toLowerCase().includes(q) ||
        g.companyName.toLowerCase().includes(q) ||
        g.sector.toLowerCase().includes(q) ||
        (g.kbEntry?.creditRating.ratingGrade || '').toLowerCase().includes(q)
    );
  }
  if (opts.minScore !== null && opts.minScore !== undefined && Number.isFinite(opts.minScore)) {
    filtered = filtered.filter((g) => g.hiddenGemScore >= opts.minScore!);
  }
  if (opts.minMos !== null && opts.minMos !== undefined && Number.isFinite(opts.minMos)) {
    filtered = filtered.filter(
      (g) => (g.screenerRow.keyMetrics.marginOfSafetyPct ?? -999) >= opts.minMos!
    );
  }
  if (opts.maxPe !== null && opts.maxPe !== undefined && Number.isFinite(opts.maxPe)) {
    filtered = filtered.filter(
      (g) =>
        g.screenerRow.keyMetrics.pe !== null &&
        g.screenerRow.keyMetrics.pe > 0 &&
        g.screenerRow.keyMetrics.pe <= opts.maxPe!
    );
  }
  if (opts.maxPb !== null && opts.maxPb !== undefined && Number.isFinite(opts.maxPb)) {
    filtered = filtered.filter(
      (g) =>
        g.screenerRow.keyMetrics.pb !== null &&
        g.screenerRow.keyMetrics.pb > 0 &&
        g.screenerRow.keyMetrics.pb <= opts.maxPb!
    );
  }
  if (opts.minRoe !== null && opts.minRoe !== undefined && Number.isFinite(opts.minRoe)) {
    filtered = filtered.filter(
      (g) => g.screenerRow.keyMetrics.roePct !== null && g.screenerRow.keyMetrics.roePct >= opts.minRoe!
    );
  }
  if (opts.maxNpl !== null && opts.maxNpl !== undefined && Number.isFinite(opts.maxNpl)) {
    filtered = filtered.filter(
      (g) => g.screenerRow.keyMetrics.nplPct === null || g.screenerRow.keyMetrics.nplPct <= opts.maxNpl!
    );
  }
  if (opts.beatsFdOnly) {
    filtered = filtered.filter((g) => (g.earningsYieldSpreadPct ?? -999) > 0);
  }
  if (opts.onlyWithKb) {
    filtered = filtered.filter((g) => g.kbEntry !== null);
  }
  if (opts.investmentGradeOnly) {
    filtered = filtered.filter((g) => isInvestmentGradeRating(g.kbEntry?.creditRating.ratingGrade ?? null));
  }
  if (opts.excludeAlertsAndLockIn) {
    filtered = filtered.filter(
      (g) =>
        g.kbEntry?.regulatoryStanding !== 'Alert' && !g.kbEntry?.lockInOverhangFlag
    );
  }
  if (opts.requireAnnualReport) {
    filtered = filtered.filter((g) => g.screenerRow.reportWeighting.hasAnnualReport);
  }

  return {
    generatedAt: new Date().toISOString(),
    marketDate: evaluated.marketDate,
    benchmarkFdRatePct,
    annualWeightPct,
    totalEvaluated,
    totalGems: filtered.length,
    annualBackedCount: candidates.filter((g) => g.screenerRow.reportWeighting.hasAnnualReport).length,
    kbCoveredCount: candidates.filter((g) => g.kbEntry !== null).length,
    archetypeCounts,
    kbSummary,
    gems: filtered,
  };
}
