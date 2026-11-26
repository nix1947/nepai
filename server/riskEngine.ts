import fs from 'fs';
import path from 'path';
import type {
  CompositeDoNotBuyResponse,
  CompositeDoNotBuyRow,
  DataFreshnessStatus,
  FundamentalRiskRow,
  FundamentallyRiskyResponse,
  MacroResearchResponse,
  MarketOpportunityRow,
  MarketOpportunityVsRiskResponse,
  ScoreFactorItem,
  StockResearchResponse,
  TechnicalRiskRow,
  TechnicallyRiskyResponse,
} from '../src/types/market.ts';
import type { MarketStore } from './marketStore.ts';
import { getNepseSector } from './sectors.ts';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clip(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function intelFilePath(store: MarketStore): string {
  return path.join(store.dataDir, '.fundamental-intel.json');
}

function macroSnapshotPath(store: MarketStore): string {
  return path.join(store.dataDir, '.macro-rates-cache.json');
}

export function saveFundamentalAudit(store: MarketStore, audit: StockResearchResponse): void {
  try {
    const file = intelFilePath(store);
    let existing: Record<string, StockResearchResponse> = {};
    if (fs.existsSync(file)) {
      existing = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, StockResearchResponse>;
    }
    existing[audit.symbol.toUpperCase()] = audit;
    fs.writeFileSync(file, JSON.stringify(existing, null, 2), 'utf8');
  } catch {
    // ignore disk persistence error
  }
}

export function loadAllFundamentalAudits(store: MarketStore): Record<string, StockResearchResponse> {
  try {
    const file = intelFilePath(store);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StockResearchResponse>) : {};
  } catch {
    return {};
  }
}

export function saveMacroSnapshot(store: MarketStore, macro: MacroResearchResponse): void {
  try {
    fs.writeFileSync(macroSnapshotPath(store), JSON.stringify(macro, null, 2), 'utf8');
  } catch {
    // ignore disk persistence error
  }
}

export function loadMacroSnapshot(store: MarketStore): MacroResearchResponse | null {
  try {
    const file = macroSnapshotPath(store);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as MacroResearchResponse;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function computeTechnicalRiskRows(
  store: MarketStore,
  day?: string,
  nDays = 20,
  equityOnly = true
): TechnicallyRiskyResponse {
  const cleanN = Math.max(5, Math.min(250, Math.round(nDays)));
  const dates = store.getDates();
  const targetDay = day && dates.includes(day) ? day : dates[dates.length - 1];
  if (!targetDay) {
    return {
      date: '',
      nDays: cleanN,
      totalScreened: 0,
      severeCount: 0,
      highCount: 0,
      dataStatus: 'Unavailable',
      rows: [],
    };
  }

  const pulse = store.getMarketPulse(targetDay, equityOnly, { nDays: cleanN });
  const returnsN: number[] = [];
  const histBySym = new Map<string, ReturnType<MarketStore['getSymbolHistory']>>();

  for (const row of pulse.rows) {
    const hist = store.getSymbolHistory(row.symbol, targetDay);
    histBySym.set(row.symbol, hist);
    if (hist.length >= 2) {
      const slice = hist.slice(-cleanN);
      const firstBase = slice[0].prev_close > 0 ? slice[0].prev_close : slice[0].close;
      if (firstBase > 0) {
        returnsN.push((row.close / firstBase - 1) * 100);
      }
    }
  }
  const medianReturnN = median(returnsN);

  const rows: TechnicalRiskRow[] = [];

  for (const row of pulse.rows) {
    const hist = histBySym.get(row.symbol) || [];
    if (hist.length < 3) continue;
    const slice = hist.slice(-cleanN);
    const firstBase = slice[0].prev_close > 0 ? slice[0].prev_close : slice[0].close;
    const periodReturnNPct = firstBase > 0 ? round2((row.close / firstBase - 1) * 100) : null;

    const upVol = slice.filter((h) => h.diff > 0).reduce((s, h) => s + h.volume, 0);
    const dnVol = slice.filter((h) => h.diff < 0).reduce((s, h) => s + h.volume, 0);
    const upDownVolRatio = round2(upVol / Math.max(dnVol, 1));

    const ranges = slice.map((h) => (h.close > 0 ? ((h.high - h.low) / h.close) * 100 : 0));
    const avgVolatilityPct = round2(mean(ranges));

    const priorSlice = slice.slice(0, -1);
    const priorLowN = priorSlice.length > 0 ? Math.min(...priorSlice.map((h) => h.low || h.close)) : row.low;
    const supportBreakPct =
      priorLowN > 0 ? round2(((row.close - priorLowN) / priorLowN) * 100) : null;

    const chg = row.diff_pct ?? 0;
    const breakdown: ScoreFactorItem[] = [];
    const warningTags: string[] = [];

    // 1. Trend Structure Breakdown (0 - 30)
    let trendPts = 0;
    const trendReasons: string[] = [];
    if (row.vs_d120_pct !== null && row.vs_d120_pct < 0) {
      trendPts += Math.min(12, Math.abs(row.vs_d120_pct) * 0.9);
      trendReasons.push(`${row.vs_d120_pct.toFixed(1)}% below MA120`);
      warningTags.push('Below MA120');
    }
    if (row.vs_d180_pct !== null && row.vs_d180_pct < 0) {
      trendPts += Math.min(8, Math.abs(row.vs_d180_pct) * 0.6);
      trendReasons.push(`${row.vs_d180_pct.toFixed(1)}% below MA180`);
      if (!warningTags.includes('Below MA180')) warningTags.push('Below MA180');
    }
    if (periodReturnNPct !== null && periodReturnNPct < -2) {
      trendPts += Math.min(6, Math.abs(periodReturnNPct) * 0.45);
      trendReasons.push(`${periodReturnNPct.toFixed(1)}% over ${cleanN}d`);
    }
    if (row.vwap_pct !== null && row.vwap_pct < -0.5) {
      trendPts += Math.min(4, Math.abs(row.vwap_pct) * 1.2);
      trendReasons.push(`closed ${row.vwap_pct.toFixed(1)}% below VWAP`);
    }
    trendPts = round1(clip(trendPts, 0, 30));
    breakdown.push({
      factor: 'Trend & Moving Average Breakdown',
      score: trendPts,
      maxScore: 30,
      evidence: trendReasons.length > 0 ? trendReasons.join('; ') : 'Price holding above primary moving averages.',
      sourceType: 'Technical',
    });

    // 2. Selling Pressure & Distribution (0 - 25)
    let distPts = 0;
    const distReasons: string[] = [];
    if (upDownVolRatio < 0.9) {
      distPts += Math.min(12, (0.95 - upDownVolRatio) * 18);
      distReasons.push(`Up/Down vol ratio ${upDownVolRatio.toFixed(2)}x`);
      warningTags.push('Heavy Distribution');
    }
    if (chg < -0.8 && row.turnover_vs_avg_n >= 1.25) {
      distPts += Math.min(8, row.turnover_vs_avg_n * 3);
      distReasons.push(`down ${chg.toFixed(1)}% on ${row.turnover_vs_avg_n.toFixed(1)}x turnover`);
      warningTags.push('High-Volume Selloff');
    } else if (chg > 1.2 && row.volume_vs_avg_n <= 0.65) {
      distPts += 6;
      distReasons.push(`weak-volume bounce (${row.volume_vs_avg_n.toFixed(2)}x ${cleanN}d avg vol)`);
      warningTags.push('Weak-Volume Divergence');
    }
    if (row.close_pos_pct < 32) {
      distPts += 5;
      distReasons.push(`closed in bottom ${Math.round(row.close_pos_pct)}% of daily range`);
    }
    distPts = round1(clip(distPts, 0, 25));
    breakdown.push({
      factor: 'Selling Pressure & Volume Divergence',
      score: distPts,
      maxScore: 25,
      evidence: distReasons.length > 0 ? distReasons.join('; ') : 'No heavy distribution detected.',
      sourceType: 'Technical',
    });

    // 3. Support Breakdown & 52w Weakness (0 - 20)
    let supPts = 0;
    const supReasons: string[] = [];
    if (supportBreakPct !== null && supportBreakPct <= 0.5) {
      supPts += supportBreakPct <= 0 ? Math.min(10, 6 + Math.abs(supportBreakPct) * 1.5) : 4;
      supReasons.push(
        supportBreakPct <= 0
          ? `broke below ${cleanN}d support (${supportBreakPct.toFixed(1)}%)`
          : `testing ${cleanN}d support floor`
      );
      if (supportBreakPct <= 0) warningTags.push(`${cleanN}d Support Break`);
    }
    if (row.pos_52w_pct !== null && row.pos_52w_pct <= 28) {
      supPts += Math.min(10, (30 - row.pos_52w_pct) * 0.45);
      supReasons.push(`near 52w lows (${row.pos_52w_pct.toFixed(0)}th percentile)`);
      warningTags.push('Near 52W Low');
    } else if (row.gap_52h_pct !== null && row.gap_52h_pct >= 25) {
      supPts += Math.min(6, (row.gap_52h_pct - 20) * 0.25);
      supReasons.push(`${row.gap_52h_pct.toFixed(1)}% below 52w high`);
    }
    supPts = round1(clip(supPts, 0, 20));
    breakdown.push({
      factor: 'Support Breakdown & 52W Drawdown',
      score: supPts,
      maxScore: 20,
      evidence: supReasons.length > 0 ? supReasons.join('; ') : 'Holding above recent N-day support.',
      sourceType: 'Technical',
    });

    // 4. Relative Strength Weakness (0 - 15)
    let rsPts = 0;
    const rsDiff = periodReturnNPct !== null ? round2(periodReturnNPct - medianReturnN) : 0;
    if (periodReturnNPct !== null && rsDiff < -2) {
      rsPts = round1(clip(Math.abs(rsDiff) * 1.2, 0, 15));
      if (rsDiff < -6) warningTags.push('Weak Relative Strength');
    }
    breakdown.push({
      factor: `Relative Strength Lag vs Market (${cleanN}d)`,
      score: rsPts,
      maxScore: 15,
      evidence:
        periodReturnNPct !== null
          ? `${periodReturnNPct.toFixed(1)}% vs market median ${medianReturnN.toFixed(1)}% (${rsDiff >= 0 ? '+' : ''}${rsDiff.toFixed(1)}% RS spread)`
          : 'Insufficient N-day history for RS.',
      sourceType: 'Technical',
    });

    // 5. Volatility & Liquidity Trap (0 - 10)
    let volPts = 0;
    const volReasons: string[] = [];
    if (avgVolatilityPct >= 4.2) {
      volPts += Math.min(6, (avgVolatilityPct - 3.5) * 1.8);
      volReasons.push(`elevated ${avgVolatilityPct.toFixed(1)}% avg daily swing`);
      warningTags.push('High Volatility');
    }
    if (row.turnover_vs_avg_n < 0.55 && (periodReturnNPct ?? 0) < 0) {
      volPts += 4;
      volReasons.push(`fading liquidity (${row.turnover_vs_avg_n.toFixed(2)}x ${cleanN}d avg)`);
      warningTags.push('Liquidity Fade');
    }
    volPts = round1(clip(volPts, 0, 10));
    breakdown.push({
      factor: 'Volatility & Liquidity Fragility',
      score: volPts,
      maxScore: 10,
      evidence: volReasons.length > 0 ? volReasons.join('; ') : 'Normal daily volatility and liquidity.',
      sourceType: 'Technical',
    });

    const technicalRiskScore = round1(clip(trendPts + distPts + supPts + rsPts + volPts, 0, 100));
    if (technicalRiskScore < 25 && warningTags.length === 0) continue;

    const riskLevel: TechnicalRiskRow['riskLevel'] =
      technicalRiskScore >= 65 ? 'Severe' : technicalRiskScore >= 45 ? 'High' : 'Moderate';

    const activeReasons = breakdown
      .filter((b) => b.score >= 4)
      .map((b) => b.evidence)
      .slice(0, 3);

    rows.push({
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      date: targetDay,
      ltp: row.ltp || row.close,
      changePct: chg,
      periodReturnNPct,
      turnover: row.turnover,
      turnoverMultN: row.turnover_vs_avg_n,
      volMultN: row.volume_vs_avg_n,
      vwapPct: row.vwap_pct,
      vsD120Pct: row.vs_d120_pct,
      vsD180Pct: row.vs_d180_pct,
      pos52wPct: row.pos_52w_pct,
      gap52hPct: row.gap_52h_pct,
      upDownVolRatio,
      avgVolatilityPct,
      supportBreakPct,
      technicalRiskScore,
      riskLevel,
      breakdown,
      warningTags: Array.from(new Set(warningTags)).slice(0, 5),
      explanation:
        activeReasons.length > 0
          ? activeReasons.join(' · ')
          : `Technical risk score ${technicalRiskScore}/100 over the last ${cleanN} trading sessions.`,
      dataStatus: 'Historical',
    });
  }

  rows.sort((a, b) => b.technicalRiskScore - a.technicalRiskScore);

  return {
    date: targetDay,
    nDays: cleanN,
    totalScreened: pulse.rows.length,
    severeCount: rows.filter((r) => r.riskLevel === 'Severe').length,
    highCount: rows.filter((r) => r.riskLevel === 'High').length,
    dataStatus: 'Historical',
    rows,
  };
}

export function getFundamentallyRiskyStocks(
  store: MarketStore,
  day?: string,
  equityOnly = true
): FundamentallyRiskyResponse {
  const dates = store.getDates();
  const targetDay = day && dates.includes(day) ? day : dates[dates.length - 1] || '';
  const pulse = targetDay ? store.getMarketPulse(targetDay, equityOnly, { nDays: 20 }) : null;
  const priceMap = new Map((pulse?.rows || []).map((r) => [r.symbol.toUpperCase(), r]));

  const audits = loadAllFundamentalAudits(store);
  const rows: FundamentalRiskRow[] = [];

  for (const audit of Object.values(audits)) {
    const sym = audit.symbol.toUpperCase();
    const marketRow = priceMap.get(sym);
    if (equityOnly && priceMap.size > 0 && !marketRow) continue;

    const fm = audit.financialMetrics;
    const redFlags = audit.fundamentalRedFlags || [];
    const govFlags = audit.governanceRegulatoryFlags || [];

    const whyRisky =
      redFlags.length > 0
        ? redFlags.slice(0, 2).join(' ')
        : audit.assessment9Part?.majorRisksRedFlags?.[0] ||
          audit.risks?.[0]?.detail ||
          audit.summary;

    const status: DataFreshnessStatus = audit.cached ? 'Cached' : audit.dataStatus || 'Cached';

    rows.push({
      symbol: sym,
      companyName: audit.companyName || marketRow?.name || sym,
      sector: audit.sector || marketRow?.sector || getNepseSector(sym, marketRow?.name),
      ltp: marketRow ? marketRow.ltp || marketRow.close : null,
      changePct: marketRow ? marketRow.diff_pct ?? 0 : null,
      reportingPeriod: audit.reportingPeriod || fm?.reportingPeriod || 'Unavailable',
      publicationDate: audit.publicationDate || fm?.publicationDate || 'Unavailable',
      retrievedAt: audit.retrievedAt || audit.generatedAt,
      dataStatus: status,
      fundamentalRiskScore: audit.riskScore ?? 50,
      recommendation: audit.recommendation || 'WATCHLIST',
      redFlags,
      governanceFlags: govFlags,
      keyMetrics: {
        eps: fm?.eps || 'Unavailable',
        pe: fm?.pe || 'Unavailable',
        pb: fm?.pb || 'Unavailable',
        roe: fm?.roe || 'Unavailable',
        npl: fm?.npl || 'Unavailable',
        cashFlow: fm?.cashFlow || 'Unavailable',
        netWorthPerShare: fm?.netWorthPerShare || 'Unavailable',
        dividendHistory: fm?.dividendHistory || 'Unavailable',
      },
      limitations: audit.limitations || [],
      whyRisky,
      sources: audit.sources || [],
    });
  }

  rows.sort((a, b) => b.fundamentalRiskScore - a.fundamentalRiskScore);

  const unauditedCandidates = (pulse?.rows || [])
    .filter((r) => !audits[r.symbol.toUpperCase()])
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 30)
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      ltp: r.ltp || r.close,
      changePct: r.diff_pct ?? 0,
    }));

  return {
    date: targetDay,
    auditedCount: rows.length,
    flaggedCount: rows.filter(
      (r) =>
        r.fundamentalRiskScore >= 45 ||
        r.redFlags.length > 0 ||
        r.governanceFlags.length > 0 ||
        r.recommendation === 'AVOID'
    ).length,
    rows,
    candidateSymbols: unauditedCandidates,
  };
}

export function getCompositeDoNotBuyStocks(
  store: MarketStore,
  day?: string,
  nDays = 20,
  equityOnly = true
): CompositeDoNotBuyResponse {
  const tech = computeTechnicalRiskRows(store, day, nDays, equityOnly);
  const audits = loadAllFundamentalAudits(store);
  const pulse = tech.date ? store.getMarketPulse(tech.date, equityOnly, { nDays: tech.nDays }) : null;
  const pulseMap = new Map((pulse?.rows || []).map((r) => [r.symbol.toUpperCase(), r]));
  const techMap = new Map(tech.rows.map((r) => [r.symbol.toUpperCase(), r]));

  const allSymbols = new Set<string>([
    ...tech.rows.map((r) => r.symbol.toUpperCase()),
    ...Object.keys(audits),
  ]);

  const rows: CompositeDoNotBuyRow[] = [];

  for (const sym of allSymbols) {
    const t = techMap.get(sym);
    const a = audits[sym];
    const p = pulseMap.get(sym);
    if (equityOnly && pulseMap.size > 0 && !p && !a) continue;

    const technicalRiskScore = t?.technicalRiskScore ?? 15;
    const hasFundamentalAudit = Boolean(a);
    const fundamentalRiskScore = a ? a.riskScore : null;

    // Liquidity / Governance / Valuation sub-score
    let liqGovScore = 0;
    if (p && p.turnover < 1_000_000) liqGovScore += 30;
    if (p && p.turnover_vs_avg_n < 0.55) liqGovScore += 20;
    if (a?.governanceRegulatoryFlags?.length) liqGovScore += Math.min(50, a.governanceRegulatoryFlags.length * 25);
    if (a?.recommendation === 'AVOID') liqGovScore += 20;
    liqGovScore = round1(clip(liqGovScore, 0, 100));

    let compositeRiskScore = 0;
    if (hasFundamentalAudit && fundamentalRiskScore !== null) {
      compositeRiskScore = round1(
        clip(fundamentalRiskScore * 0.55 + technicalRiskScore * 0.30 + liqGovScore * 0.15, 0, 100)
      );
    } else {
      // Unaudited: clearly scoped to technical + liquidity risk only (max 85 until fundamentals confirm)
      compositeRiskScore = round1(clip(technicalRiskScore * 0.80 + liqGovScore * 0.20, 0, 85));
    }

    const confirmedRedFlags = [
      ...(a?.fundamentalRedFlags || []),
      ...(a?.governanceRegulatoryFlags || []),
    ];
    const technicalWarnings = t?.warningTags || [];

    const qualifies =
      compositeRiskScore >= 48 ||
      a?.recommendation === 'AVOID' ||
      confirmedRedFlags.length > 0;

    if (!qualifies) continue;

    const whyParts: string[] = [];
    if (confirmedRedFlags.length > 0) {
      whyParts.push(`Verified Fundamental/Regulatory Red Flags: ${confirmedRedFlags.slice(0, 2).join('; ')}.`);
    } else if (a?.summary) {
      whyParts.push(`Fundamental Audit (${a.recommendation}): ${a.assessment9Part?.majorRisksRedFlags?.[0] || a.summary}`);
    } else {
      whyParts.push('Fundamental statements not yet audited via Search Grounding — flagged strictly on ShareSansar technical breakdown.');
    }
    if (t) {
      whyParts.push(`Technical Risk (${t.technicalRiskScore}/100): ${t.explanation}.`);
    }

    rows.push({
      symbol: sym,
      name: a?.companyName || t?.name || p?.name || sym,
      sector: a?.sector || t?.sector || p?.sector || getNepseSector(sym),
      ltp: p ? p.ltp || p.close : t?.ltp ?? null,
      changePct: p ? p.diff_pct ?? 0 : t?.changePct ?? null,
      compositeRiskScore,
      fundamentalRiskScore,
      technicalRiskScore,
      liquidityGovernanceScore: liqGovScore,
      hasFundamentalAudit,
      confirmedRedFlags,
      technicalWarnings,
      whyNotBuy: whyParts.join(' '),
      reportingPeriod: a?.reportingPeriod || (hasFundamentalAudit ? 'Unavailable' : 'Not yet audited'),
      publicationDate: a?.publicationDate || (hasFundamentalAudit ? 'Unavailable' : 'Run AI Audit'),
      retrievedAt: a?.retrievedAt || null,
      dataStatus: a ? (a.cached ? 'Cached' : a.dataStatus || 'Cached') : 'Historical',
      technicalSnapshot: {
        vwapPct: p?.vwap_pct ?? t?.vwapPct ?? null,
        vsD120Pct: p?.vs_d120_pct ?? t?.vsD120Pct ?? null,
        upDownVolRatio: t?.upDownVolRatio ?? 1,
        turnoverMultN: p?.turnover_vs_avg_n ?? t?.turnoverMultN ?? 1,
      },
      sources: a?.sources || [],
    });
  }

  rows.sort((a, b) => {
    const aPriority = (a.hasFundamentalAudit ? 15 : 0) + a.compositeRiskScore;
    const bPriority = (b.hasFundamentalAudit ? 15 : 0) + b.compositeRiskScore;
    return bPriority - aPriority;
  });

  const priorityAuditSymbols = tech.rows
    .filter((r) => !audits[r.symbol.toUpperCase()])
    .slice(0, 10)
    .map((r) => r.symbol);

  return {
    date: tech.date,
    nDays: tech.nDays,
    auditedCount: Object.keys(audits).length,
    rows,
    priorityAuditSymbols,
  };
}

export function getMarketOpportunityVsRisk(
  store: MarketStore,
  day?: string,
  nDays = 20,
  equityOnly = true
): MarketOpportunityVsRiskResponse {
  const cleanN = Math.max(5, Math.min(250, Math.round(nDays)));
  const dates = store.getDates();
  const targetDay = day && dates.includes(day) ? day : dates[dates.length - 1] || '';
  const macro = loadMacroSnapshot(store);
  const audits = loadAllFundamentalAudits(store);

  if (!targetDay) {
    return {
      date: '',
      nDays: cleanN,
      macroAvailable: Boolean(macro),
      macroRetrievedAt: macro?.retrievedAt || null,
      macroDataStatus: macro?.dataStatus || 'Unavailable',
      fixedIncomeBenchmarks: macro?.fixedIncomeBenchmarks || null,
      opportunities: [],
      insufficientCompensation: [],
      candidateAuditSymbols: [],
    };
  }

  const pulse = store.getMarketPulse(targetDay, equityOnly, { nDays: cleanN });
  const radar = store.getOpportunityRadar(targetDay, cleanN, equityOnly);
  const radarMap = new Map(radar.points.map((p) => [p.symbol.toUpperCase(), p]));
  const pulseMap = new Map(pulse.rows.map((r) => [r.symbol.toUpperCase(), r]));

  const opportunities: MarketOpportunityRow[] = [];
  const insufficientCompensation: MarketOpportunityRow[] = [];

  const candidateSyms = new Set<string>([
    ...Object.keys(audits),
    ...radar.points
      .filter((p) => p.category === 'acceleration' || p.category === 'accumulation' || p.category === 'breakout_watch')
      .map((p) => p.symbol.toUpperCase()),
  ]);

  for (const sym of candidateSyms) {
    const p = pulseMap.get(sym);
    if (!p) continue;
    const rad = radarMap.get(sym);
    const audit = audits[sym];
    const hist = store.getSymbolHistory(sym, targetDay);
    const slice = hist.slice(-cleanN);
    const firstBase = slice[0] ? (slice[0].prev_close > 0 ? slice[0].prev_close : slice[0].close) : 0;
    const periodReturnNPct = firstBase > 0 ? round2((p.close / firstBase - 1) * 100) : null;

    const upVol = slice.filter((h) => h.diff > 0).reduce((s, h) => s + h.volume, 0);
    const dnVol = slice.filter((h) => h.diff < 0).reduce((s, h) => s + h.volume, 0);
    const upDownVolRatio = round2(upVol / Math.max(dnVol, 1));

    if (audit) {
      const oppScore = audit.opportunityScore ?? 50;
      const riskScore = audit.riskScore ?? 50;
      const fm = audit.financialMetrics;
      const beatsFi = audit.opportunityCost?.beatsFixedIncome ?? null;

      const row: MarketOpportunityRow = {
        symbol: sym,
        name: audit.companyName || p.name,
        sector: audit.sector || p.sector,
        ltp: p.ltp || p.close,
        changePct: p.diff_pct ?? 0,
        periodReturnNPct,
        opportunityScore: oppScore,
        riskScore,
        hasFundamentalAudit: true,
        recommendation: audit.recommendation,
        whyConsiderBuying:
          audit.assessment9Part?.growthOpportunities?.[0] ||
          audit.opportunities?.[0]?.detail ||
          audit.summary,
        opportunityCostVerdict:
          audit.opportunityCost?.verdict ||
          'Run macro + stock refresh to compute exact FD/Bond opportunity-cost spread.',
        beatsFixedIncome: beatsFi,
        reportingPeriod: audit.reportingPeriod || fm?.reportingPeriod || 'Unavailable',
        publicationDate: audit.publicationDate || fm?.publicationDate || 'Unavailable',
        retrievedAt: audit.retrievedAt || audit.generatedAt,
        dataStatus: audit.cached ? 'Cached' : audit.dataStatus || 'Cached',
        technicalSnapshot: {
          vwapPct: p.vwap_pct,
          vsD120Pct: p.vs_d120_pct,
          turnoverMultN: p.turnover_vs_avg_n,
          upDownVolRatio,
        },
        keyMetrics: fm
          ? {
              eps: fm.eps,
              pe: fm.pe,
              roe: fm.roe,
              dividendHistory: fm.dividendHistory,
            }
          : null,
        sources: audit.sources || [],
      };

      if (
        (audit.recommendation === 'BUY' || (oppScore >= 60 && riskScore <= 55)) &&
        beatsFi !== false
      ) {
        opportunities.push(row);
      } else if (
        beatsFi === false ||
        audit.recommendation === 'HOLD' ||
        audit.recommendation === 'AVOID' ||
        riskScore > oppScore
      ) {
        insufficientCompensation.push(row);
      } else {
        opportunities.push(row);
      }
    } else if (rad && rad.category !== 'bearish_div') {
      const techOppScore = round1(clip(rad.radarScore * 0.78, 35, 82));
      const row: MarketOpportunityRow = {
        symbol: sym,
        name: p.name,
        sector: p.sector,
        ltp: p.ltp || p.close,
        changePct: p.diff_pct ?? 0,
        periodReturnNPct,
        opportunityScore: techOppScore,
        riskScore: 45,
        hasFundamentalAudit: false,
        recommendation: 'TECHNICAL_SETUP',
        whyConsiderBuying: `${rad.headline} (Technical ShareSansar signal — run AI Fundamental Audit to verify EPS, cash flow, and valuation before buying.)`,
        opportunityCostVerdict:
          macro?.fixedIncomeBenchmarks?.bankFdIndividualRate
            ? `Benchmark Bank FD is ${macro.fixedIncomeBenchmarks.bankFdIndividualRate}. Audit this stock to check earnings/dividend yield vs FD.`
            : 'Run Macro & Stock AI Audit to benchmark expected return against Nepal FD and Government Bond yields.',
        beatsFixedIncome: null,
        reportingPeriod: 'Not yet audited',
        publicationDate: 'Run AI Audit',
        retrievedAt: null,
        dataStatus: 'Historical',
        technicalSnapshot: {
          vwapPct: p.vwap_pct,
          vsD120Pct: p.vs_d120_pct,
          turnoverMultN: p.turnover_vs_avg_n,
          upDownVolRatio,
        },
        keyMetrics: null,
        sources: [],
      };
      opportunities.push(row);
    }
  }

  opportunities.sort((a, b) => {
    const aBonus = a.hasFundamentalAudit ? 20 : 0;
    const bBonus = b.hasFundamentalAudit ? 20 : 0;
    return bBonus + b.opportunityScore - b.riskScore * 0.35 - (aBonus + a.opportunityScore - a.riskScore * 0.35);
  });

  insufficientCompensation.sort((a, b) => b.riskScore - a.riskScore);

  const candidateAuditSymbols = radar.points
    .filter((p) => p.category !== 'bearish_div' && !audits[p.symbol.toUpperCase()])
    .slice(0, 10)
    .map((p) => p.symbol);

  return {
    date: targetDay,
    nDays: cleanN,
    macroAvailable: Boolean(macro),
    macroRetrievedAt: macro?.retrievedAt || null,
    macroDataStatus: macro?.dataStatus || 'Unavailable',
    fixedIncomeBenchmarks: macro?.fixedIncomeBenchmarks || null,
    opportunities: opportunities.slice(0, 45),
    insufficientCompensation: insufficientCompensation.slice(0, 30),
    candidateAuditSymbols,
  };
}
