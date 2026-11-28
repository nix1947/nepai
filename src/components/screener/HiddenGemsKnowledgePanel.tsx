import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Compass,
  ExternalLink,
  Gem,
  Landmark,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useWatchlist } from '../../hooks/useWatchlist';
import type {
  HiddenGemArchetype,
  HiddenGemCandidate,
  HiddenGemsResponse,
  KnowledgeBaseResponse,
  RegulatoryAgency,
} from '../../types/fundamental';
import { ColumnDef, createWatchlistColumn, DataTable } from '../DataTable';

interface HiddenGemsKnowledgePanelProps {
  equityOnly: boolean;
  annualWeightPct?: number;
  onChangeAnnualWeightPct?: (weight: number) => void;
  onSelectCompanyDossier: (symbol: string) => void;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer: (symbol: string) => void;
}

const ARCHETYPE_META: Array<{
  id: 'all' | HiddenGemArchetype;
  label: string;
  hint: string;
}> = [
  {
    id: 'all',
    label: 'All Hidden Gems',
    hint: 'All candidates matching valuation, quality, inflection, or KB tailwind criteria',
  },
  {
    id: 'undiscovered_quality',
    label: 'Undiscovered Quality',
    hint: 'High ROE & quality score ≥ 60 outside top-12 crowded turnover stocks at reasonable multiples',
  },
  {
    id: 'deep_value_mos',
    label: 'Deep Value + MoS',
    hint: 'Positive MoS or deep-value sector P/E & P/B with clean balance sheet',
  },
  {
    id: 'earnings_inflection',
    label: 'Earnings Inflection',
    hint: 'Accelerating EPS QoQ/YoY or beating 3Y Q4 baseline at reasonable multiples',
  },
  {
    id: 'clean_bfi_yield',
    label: 'Clean BFI Yield (NRB)',
    hint: 'BFIs with NPL ≤ 3.5%, CAR ≥ 11%, strong ROE, and attractive P/B or Bank FD yield beat',
  },
  {
    id: 'insurance_float',
    label: 'Insurance Float (NIA)',
    hint: 'Life & non-life insurers with ROE ≥ 11% and disciplined P/E or P/B multiples',
  },
  {
    id: 'kb_tailwind',
    label: 'KB-Verified Tailwind',
    hint: 'Investment-grade ICRA/CARE rating or clean regulatory tailwind without lock-in risk',
  },
];

const ARCHETYPE_SHORT: Record<HiddenGemArchetype, string> = {
  undiscovered_quality: 'Undiscovered Quality',
  deep_value_mos: 'Deep Value MoS',
  earnings_inflection: 'Earnings Inflection',
  clean_bfi_yield: 'Clean BFI Yield',
  insurance_float: 'Insurance Float',
  kb_tailwind: 'KB Tailwind',
};

const AGENCY_TABS: Array<{ id: 'ALL' | RegulatoryAgency; label: string; desc: string }> = [
  { id: 'ALL', label: 'All Agencies', desc: 'Combined regulatory & credit rating feed' },
  { id: 'ICRA', label: 'ICRA Nepal', desc: 'icranepal.com ratings & outlooks' },
  { id: 'CARE', label: 'CARE Ratings', desc: 'careratingsnepal.com ratings' },
  { id: 'NRB', label: 'NRB (BFIs)', desc: 'nrb.org.np directives & BFI reports' },
  { id: 'NIA', label: 'NIA (Insurance)', desc: 'nia.gov.np solvency & premium data' },
  { id: 'SEBON', label: 'SEBON', desc: 'sebon.gov.np approvals & enforcement' },
  { id: 'NEPSE', label: 'NEPSE', desc: 'nepalstock.com corporate disclosures' },
  { id: 'CDSC', label: 'CDSC', desc: 'cdsc.com.np demat & lock-in expiry' },
];

function fmtOpt(v: number | null | undefined, suffix = '', digits = 1): string {
  return v !== null && v !== undefined && Number.isFinite(v)
    ? `${v.toFixed(digits)}${suffix}`
    : '—';
}

function fmtSigned(v: number | null | undefined, suffix = '%', digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}${suffix}`;
}

export const HiddenGemsKnowledgePanel: React.FC<HiddenGemsKnowledgePanelProps> = ({
  equityOnly,
  annualWeightPct = 70,
  onChangeAnnualWeightPct,
  onSelectCompanyDossier,
  onInspectSymbol,
  onInspectInAnalyzer,
}) => {
  const [data, setData] = useState<HiddenGemsResponse | null>(null);
  const [kbFeed, setKbFeed] = useState<KnowledgeBaseResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [archetype, setArchetype] = useState<'all' | HiddenGemArchetype>('all');
  const [sector, setSector] = useState<string>('All');
  const [search, setSearch] = useState<string>('');
  const [minScore, setMinScore] = useState<string>('');
  const [minMos, setMinMos] = useState<string>('');
  const [maxPe, setMaxPe] = useState<string>('');
  const [maxPb, setMaxPb] = useState<string>('');
  const [minRoe, setMinRoe] = useState<string>('');
  const [maxNpl, setMaxNpl] = useState<string>('');
  const [beatsFdOnly, setBeatsFdOnly] = useState<boolean>(false);
  const [onlyWithKb, setOnlyWithKb] = useState<boolean>(false);
  const [investmentGradeOnly, setInvestmentGradeOnly] = useState<boolean>(false);
  const [excludeAlertsAndLockIn, setExcludeAlertsAndLockIn] = useState<boolean>(false);
  const [requireAnnualReport, setRequireAnnualReport] = useState<boolean>(false);

  // Selected gem & KB explorer state
  const [selectedGemSymbol, setSelectedGemSymbol] = useState<string | null>(null);
  const [agencyFilter, setAgencyFilter] = useState<'ALL' | RegulatoryAgency>('ALL');
  const [kbSearch, setKbSearch] = useState<string>('');

  // Harvest / Enrichment actions
  const [harvesting, setHarvesting] = useState<string | null>(null);
  const [crawlingAll, setCrawlingAll] = useState<boolean>(false);
  const [enrichingSymbol, setEnrichingSymbol] = useState<string | null>(null);
  const [enrichingBatch, setEnrichingBatch] = useState<boolean>(false);
  const [actionBanner, setActionBanner] = useState<{
    kind: 'info' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        equityOnly: String(equityOnly),
        annualWeightPct: String(annualWeightPct),
        archetype,
        sector,
        search,
        beatsFdOnly: String(beatsFdOnly),
        onlyWithKb: String(onlyWithKb),
        investmentGradeOnly: String(investmentGradeOnly),
        excludeAlertsAndLockIn: String(excludeAlertsAndLockIn),
        requireAnnualReport: String(requireAnnualReport),
      });
      if (minScore.trim()) qs.set('minScore', minScore.trim());
      if (minMos.trim()) qs.set('minMos', minMos.trim());
      if (maxPe.trim()) qs.set('maxPe', maxPe.trim());
      if (maxPb.trim()) qs.set('maxPb', maxPb.trim());
      if (minRoe.trim()) qs.set('minRoe', minRoe.trim());
      if (maxNpl.trim()) qs.set('maxNpl', maxNpl.trim());

      const kbQs = new URLSearchParams({ agency: agencyFilter });
      if (kbSearch.trim()) kbQs.set('q', kbSearch.trim());

      const [gemsRes, kbRes] = await Promise.all([
        fetch(`/api/screener/hidden-gems?${qs.toString()}`),
        fetch(`/api/screener/knowledge-base?${kbQs.toString()}`),
      ]);
      if (!gemsRes.ok) throw new Error('Failed to evaluate Hidden Gems universe');
      if (!kbRes.ok) throw new Error('Failed to query Regulatory Knowledge Base');

      const gemsJson = (await gemsRes.json()) as HiddenGemsResponse;
      const kbJson = (await kbRes.json()) as KnowledgeBaseResponse;
      setData(gemsJson);
      setKbFeed(kbJson);
      setSelectedGemSymbol((prev) => {
        if (prev && gemsJson.gems.some((g) => g.symbol === prev)) return prev;
        return gemsJson.gems[0]?.symbol ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Hidden Gems');
    } finally {
      setLoading(false);
    }
  }, [
    agencyFilter,
    annualWeightPct,
    archetype,
    beatsFdOnly,
    equityOnly,
    excludeAlertsAndLockIn,
    investmentGradeOnly,
    kbSearch,
    maxNpl,
    maxPb,
    maxPe,
    minMos,
    minRoe,
    minScore,
    onlyWithKb,
    requireAnnualReport,
    search,
    sector,
  ]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selectedGem = useMemo(() => {
    if (!data || data.gems.length === 0) return null;
    return data.gems.find((g) => g.symbol === selectedGemSymbol) ?? data.gems[0];
  }, [data, selectedGemSymbol]);

  const availableSectors = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.gems.map((g) => g.sector))).sort();
  }, [data]);

  const handleHarvestAgencies = async (label: string, agencies: RegulatoryAgency[]) => {
    setHarvesting(label);
    setActionBanner(null);
    try {
      const res = await fetch('/api/screener/knowledge-base/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agencies }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Harvest failed');
      const warnText =
        Array.isArray(json.warnings) && json.warnings.length > 0
          ? ` Notes: ${json.warnings.slice(0, 2).join(' · ')}`
          : '';
      setActionBanner({
        kind: json.addedNotices > 0 ? 'info' : 'warning',
        text: `Harvested ${json.addedNotices} notice(s) across ${agencies.join(', ')} (${json.companiesUpdated} company record(s) linked).${warnText}`,
      });
      await loadAll();
    } catch (err) {
      setActionBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Agency harvest failed',
      });
    } finally {
      setHarvesting(null);
    }
  };

  const handleCrawlAllWithGemini = async () => {
    setCrawlingAll(true);
    setActionBanner(null);
    try {
      const res = await fetch('/api/knowledge-base/crawl-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agencies: ['ICRA', 'CARE', 'NRB', 'NIA', 'SEBON', 'NEPSE', 'CDSC'],
          enrichLimit: 6,
          annualDistillLimit: 2,
          includeQuarterly: true,
          equityOnly,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Full Gemini KB crawl failed');
      const details = [
        `${json.addedNotices ?? 0} notice(s) across NRB/NIA/SEBON/CDSC/ICRA/CARE/NEPSE`,
      ];
      if (json.enrichedSymbols?.length) {
        details.push(`enriched ${json.enrichedSymbols.join(', ')}`);
      }
      if (json.annualDistilledSymbols?.length) {
        details.push(`annual reports (${json.annualDistilledSymbols.join(', ')})`);
      }
      if (json.quarterlyRefreshed?.length) {
        details.push(`quarterly filings (${json.quarterlyRefreshed.join(', ')})`);
      }
      const warnText =
        Array.isArray(json.warnings) && json.warnings.length > 0
          ? ` Notes: ${json.warnings.slice(0, 2).join(' · ')}`
          : '';
      setActionBanner({
        kind: json.geminiConfigured ? 'info' : 'warning',
        text: `Gemini KB crawl complete: ${details.join(' · ')}.${warnText}`,
      });
      await loadAll();
    } catch (err) {
      setActionBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Full Gemini KB crawl failed',
      });
    } finally {
      setCrawlingAll(false);
    }
  };

  const handleEnrichTopGems = async () => {
    if (!data || enrichingBatch) return;
    setEnrichingBatch(true);
    setActionBanner(null);
    try {
      const targets = data.gems.filter((g) => !g.kbEntry).slice(0, 5);
      const symbols = (targets.length > 0 ? targets : data.gems.slice(0, 5)).map((g) => g.symbol);
      const res = await fetch('/api/screener/knowledge-base/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, equityOnly }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Company KB enrichment failed');
      setActionBanner({
        kind: 'info',
        text: `Enriched ${json.updated?.length ?? 0} Hidden Gem(s) (${symbols.join(', ')}) with ICRA/CARE ratings and NRB/NIA/SEBON/NEPSE/CDSC filings.`,
      });
      await loadAll();
    } catch (err) {
      setActionBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Company KB enrichment failed',
      });
    } finally {
      setEnrichingBatch(false);
    }
  };

  const handleEnrichSingle = async (symbol: string) => {
    setEnrichingSymbol(symbol);
    setActionBanner(null);
    try {
      const res = await fetch('/api/screener/knowledge-base/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: [symbol], equityOnly }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `KB enrichment failed for ${symbol}`);
      setActionBanner({
        kind: 'info',
        text: `Updated regulatory & credit-rating knowledge base for ${symbol}.`,
      });
      await loadAll();
    } catch (err) {
      setActionBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : `Failed to enrich ${symbol}`,
      });
    } finally {
      setEnrichingSymbol(null);
    }
  };

  const resetFilters = () => {
    setArchetype('all');
    setSector('All');
    setSearch('');
    setMinScore('');
    setMinMos('');
    setMaxPe('');
    setMaxPb('');
    setMinRoe('');
    setMaxNpl('');
    setBeatsFdOnly(false);
    setOnlyWithKb(false);
    setInvestmentGradeOnly(false);
    setExcludeAlertsAndLockIn(false);
    setRequireAnnualReport(false);
  };

  const columns: ColumnDef<HiddenGemCandidate>[] = useMemo(
    () => [
      createWatchlistColumn<HiddenGemCandidate>({
        getSymbol: (g) => g.symbol,
        hasSymbol,
        toggleSymbol,
      }),
      {
        key: 'symbol',
        label: 'Symbol · Sector',
        align: 'left',
        sortValue: (g) => g.symbol,
        csvValue: (g) => g.symbol,
        render: (g) => (
          <div>
            <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
              {g.symbol}
            </span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[155px]">
              {g.sector}
            </span>
          </div>
        ),
      },
      {
        key: 'gemScore',
        label: 'Gem Score',
        align: 'right',
        sortValue: (g) => g.hiddenGemScore,
        csvValue: (g) => g.hiddenGemScore,
        render: (g) => (
          <div className="font-mono tabular-nums">
            <span
              className={`font-semibold ${
                g.hiddenGemScore >= 72
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : g.hiddenGemScore >= 60
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {g.hiddenGemScore.toFixed(1)}
            </span>
            <span className="block text-[10px] text-slate-500 dark:text-slate-400">
              {g.convictionTier}
            </span>
          </div>
        ),
      },
      {
        key: 'archetype',
        label: 'Gem Archetype',
        align: 'left',
        sortValue: (g) => ARCHETYPE_SHORT[g.primaryArchetype],
        csvValue: (g) => g.archetypes.map((a) => ARCHETYPE_SHORT[a]).join('; '),
        render: (g) => (
          <div className="text-[11px]">
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {ARCHETYPE_SHORT[g.primaryArchetype]}
            </span>
            {g.archetypes.length > 1 && (
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                +{g.archetypes.length - 1} more signal{g.archetypes.length > 2 ? 's' : ''}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'mos',
        label: 'MoS % · Intrinsic',
        align: 'right',
        sortValue: (g) => g.screenerRow.keyMetrics.marginOfSafetyPct,
        csvValue: (g) => g.screenerRow.keyMetrics.marginOfSafetyPct,
        render: (g) => {
          const mos = g.screenerRow.keyMetrics.marginOfSafetyPct;
          const iv = g.screenerRow.keyMetrics.intrinsicValue;
          const ltp = g.screenerRow.market.ltp;
          return (
            <div className="font-mono tabular-nums">
              <span
                className={
                  (mos ?? -1) >= 15
                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                    : (mos ?? 0) > 0
                      ? 'text-slate-800 dark:text-slate-200'
                      : 'text-red-600 dark:text-red-400'
                }
              >
                {fmtSigned(mos)}
              </span>
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                LTP {fmtOpt(ltp)} · IV {fmtOpt(iv)}
              </span>
            </div>
          );
        },
      },
      {
        key: 'pePb',
        label: 'P/E · P/B',
        align: 'right',
        sortValue: (g) => g.screenerRow.keyMetrics.pe,
        csvValue: (g) => g.screenerRow.keyMetrics.pe,
        render: (g) => (
          <div className="font-mono tabular-nums">
            <span>{fmtOpt(g.screenerRow.keyMetrics.pe, 'x')}</span>
            <span className="block text-[10px] text-slate-500 dark:text-slate-400">
              P/B {fmtOpt(g.screenerRow.keyMetrics.pb, 'x', 2)}
            </span>
          </div>
        ),
      },
      {
        key: 'roe',
        label: 'ROE · Growth',
        align: 'right',
        sortValue: (g) => g.screenerRow.keyMetrics.roePct,
        csvValue: (g) => g.screenerRow.keyMetrics.roePct,
        render: (g) => {
          const gr =
            g.screenerRow.keyMetrics.epsQoqPct ?? g.screenerRow.keyMetrics.epsYoyPct;
          return (
            <div className="font-mono tabular-nums">
              <span>{fmtOpt(g.screenerRow.keyMetrics.roePct, '%')}</span>
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                EPS Δ {fmtSigned(gr)}
              </span>
            </div>
          );
        },
      },
      {
        key: 'fdSpread',
        label: 'vs Bank FD',
        align: 'right',
        sortValue: (g) => g.earningsYieldSpreadPct,
        csvValue: (g) => g.earningsYieldSpreadPct,
        render: (g) => (
          <span
            className={`font-mono tabular-nums ${
              (g.earningsYieldSpreadPct ?? -999) > 0
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {fmtSigned(g.earningsYieldSpreadPct, '%', 2)}
          </span>
        ),
      },
      {
        key: 'neglect',
        label: 'Turnover Rank',
        align: 'right',
        sortValue: (g) => g.turnoverRank ?? 999,
        csvValue: (g) => g.turnoverRank,
        render: (g) => (
          <div className="font-mono tabular-nums text-[11px]">
            <span>
              {g.turnoverRank ? `#${g.turnoverRank}` : '—'}
              {g.totalRankedByTurnover ? `/${g.totalRankedByTurnover}` : ''}
            </span>
            <span className="block text-[10px] text-slate-500 dark:text-slate-400">
              52H {fmtSigned(g.screenerRow.market.gap52hPct)}
            </span>
          </div>
        ),
      },
      {
        key: 'kbStatus',
        label: 'Rating · Regulatory KB',
        align: 'left',
        sortValue: (g) => g.kbEntry?.creditRating.ratingGrade ?? g.kbEntry?.regulatoryStanding ?? 'ZZ',
        csvValue: (g) =>
          g.kbEntry
            ? `${g.kbEntry.creditRating.ratingGrade ?? 'Unrated'} (${g.kbEntry.regulatoryStanding})`
            : 'KB Pending',
        render: (g) => {
          const kb = g.kbEntry;
          if (!kb) {
            return (
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                KB Pending
              </span>
            );
          }
          const standingColor =
            kb.regulatoryStanding === 'Alert' || kb.lockInOverhangFlag
              ? 'text-red-600 dark:text-red-400'
              : kb.regulatoryStanding === 'Positive' || kb.regulatoryStanding === 'Clean'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400';
          return (
            <div className="text-[11px]">
              <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {kb.creditRating.ratingGrade || kb.creditRating.outlook}
              </span>
              <span className={`block text-[10px] ${standingColor}`}>
                {kb.regulatoryStanding}
                {kb.lockInOverhangFlag ? ' · Lock-In Risk' : ''}
              </span>
            </div>
          );
        },
      },
    ],
    [hasSymbol, toggleSymbol]
  );

  // Scatter geometry for Discovery Map
  const scatterPlot = useMemo(() => {
    const gems = (data?.gems || []).slice(0, 60);
    const width = 560;
    const height = 270;
    const padL = 44;
    const padR = 16;
    const padT = 16;
    const padB = 34;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const mosVals = gems
      .map((g) => g.screenerRow.keyMetrics.marginOfSafetyPct)
      .filter((v): v is number => v !== null);
    const xMin = Math.min(-15, ...(mosVals.length ? mosVals : [0]));
    const xMax = Math.max(45, ...(mosVals.length ? mosVals : [45]));
    const yMin = 40;
    const yMax = 96;

    const mapX = (mos: number) =>
      padL + ((Math.max(xMin, Math.min(xMax, mos)) - xMin) / Math.max(1, xMax - xMin)) * plotW;
    const mapY = (score: number) =>
      padT + plotH - ((Math.max(yMin, Math.min(yMax, score)) - yMin) / (yMax - yMin)) * plotH;

    return { gems, width, height, padL, padR, padT, padB, plotW, plotH, xMin, xMax, yMin, yMax, mapX, mapY };
  }, [data]);

  const kbSummary = data?.kbSummary || kbFeed?.summary;

  return (
    <div className="space-y-4">
      {/* Top KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Hidden Gems Found</div>
          <div className="text-lg font-mono font-semibold text-blue-600 dark:text-blue-400 tabular-nums mt-0.5">
            {data?.totalGems ?? 0}{' '}
            <span className="text-xs font-normal text-slate-400">
              / {data?.totalEvaluated ?? 0}
            </span>
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Tier 1 Conviction</div>
          <div className="text-lg font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
            {data?.gems.filter((g) => g.convictionTier === 'Tier 1 Gem').length ?? 0}
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">KB-Indexed Gems</div>
          <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {data?.kbCoveredCount ?? 0}
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Agency Bulletins</div>
          <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {kbSummary?.totalNotices ?? 0}
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Report Weighting</div>
          <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {annualWeightPct}%{' '}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              Annual · {100 - annualWeightPct}% Qtr
            </span>
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5 flex flex-col justify-between">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Enrich Top Gems</div>
          <button
            type="button"
            disabled={enrichingBatch || !data || data.gems.length === 0}
            onClick={() => void handleEnrichTopGems()}
            className="mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3 h-3 ${enrichingBatch ? 'animate-spin' : ''}`} />
            <span>{enrichingBatch ? 'Auditing Top 5…' : 'Audit Top 5 via Agencies'}</span>
          </button>
        </div>
      </div>

      {/* Multi-Agency Knowledge Base Harvester Toolbar */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-2.5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Landmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Multi-Agency Regulatory &amp; Credit Rating Knowledge Base</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Pull live reports and ratings from ICRA Nepal, CARE Ratings Nepal, NRB (BFIs), NIA (nia.gov.np), SEBON, NEPSE, and CDSC to verify hidden gems.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={crawlingAll || harvesting !== null}
              onClick={() => void handleCrawlAllWithGemini()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              {crawlingAll ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              <span>
                {crawlingAll
                  ? 'Crawling with Gemini…'
                  : 'Crawl All with Gemini & Update KB'}
              </span>
            </button>
            {[
              { label: 'All Agencies', agencies: ['ICRA', 'CARE', 'NRB', 'NIA', 'SEBON', 'NEPSE', 'CDSC'] as RegulatoryAgency[] },
              { label: 'ICRA & CARE', agencies: ['ICRA', 'CARE'] as RegulatoryAgency[] },
              { label: 'NRB (BFIs)', agencies: ['NRB'] as RegulatoryAgency[] },
              { label: 'NIA (Insurance)', agencies: ['NIA'] as RegulatoryAgency[] },
              { label: 'SEBON · NEPSE · CDSC', agencies: ['SEBON', 'NEPSE', 'CDSC'] as RegulatoryAgency[] },
            ].map((btn) => (
              <button
                key={btn.label}
                type="button"
                disabled={harvesting !== null || crawlingAll}
                onClick={() => void handleHarvestAgencies(btn.label, btn.agencies)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${harvesting === btn.label ? 'animate-spin text-blue-600' : ''}`} />
                <span>{harvesting === btn.label ? `Pulling ${btn.label}…` : `Pull ${btn.label}`}</span>
              </button>
            ))}
          </div>
        </div>

        {kbSummary && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800 pt-2">
            <span>Indexed: {kbSummary.totalCompaniesIndexed} companies</span>
            <span aria-hidden="true">·</span>
            <span>ICRA {kbSummary.byAgency.ICRA}</span>
            <span>CARE {kbSummary.byAgency.CARE}</span>
            <span>NRB {kbSummary.byAgency.NRB}</span>
            <span>NIA {kbSummary.byAgency.NIA}</span>
            <span>SEBON {kbSummary.byAgency.SEBON}</span>
            <span>NEPSE {kbSummary.byAgency.NEPSE}</span>
            <span>CDSC {kbSummary.byAgency.CDSC}</span>
            {kbSummary.lastHarvestAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Last harvest: {new Date(kbSummary.lastHarvestAt).toLocaleString()}</span>
              </>
            )}
          </div>
        )}

        {actionBanner && (
          <div
            className={`px-3 py-2 rounded border text-xs ${
              actionBanner.kind === 'error'
                ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                : actionBanner.kind === 'warning'
                  ? 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'
                  : 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200'
            }`}
          >
            {actionBanner.text}
          </div>
        )}
      </div>

      {/* Archetype Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-3">
        {ARCHETYPE_META.map((tab) => {
          const count =
            tab.id === 'all'
              ? data?.gems.length ?? 0
              : data?.archetypeCounts[tab.id] ?? 0;
          const active = archetype === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              title={tab.hint}
              onClick={() => setArchetype(tab.id)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}{' '}
              <span className={`font-mono text-[11px] ${active ? 'opacity-90' : 'text-slate-400'}`}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Valuation + Knowledge Base Filter Bar */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-3 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <div className="relative col-span-2">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker, company, or rating…"
              className="w-full pl-8 pr-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
          >
            <option value="All">All Sectors</option>
            {availableSectors.map((sec) => (
              <option key={sec} value={sec}>
                {sec}
              </option>
            ))}
          </select>

          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            placeholder="Min Gem Score"
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
          />
          <input
            type="number"
            value={minMos}
            onChange={(e) => setMinMos(e.target.value)}
            placeholder="Min MoS %"
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
          />
          <input
            type="number"
            value={maxPe}
            onChange={(e) => setMaxPe(e.target.value)}
            placeholder="Max P/E"
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
          />
          <input
            type="number"
            step="0.1"
            value={maxPb}
            onChange={(e) => setMaxPb(e.target.value)}
            placeholder="Max P/B"
            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
          />
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={minRoe}
              onChange={(e) => setMinRoe(e.target.value)}
              placeholder="Min ROE %"
              className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
            />
            <button
              type="button"
              onClick={resetFilters}
              title="Reset filters"
              className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-700 dark:text-slate-300">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={beatsFdOnly}
              onChange={(e) => setBeatsFdOnly(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>Earnings Yield &gt; Bank FD ({(data?.benchmarkFdRatePct ?? 6.5).toFixed(1)}%)</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyWithKb}
              onChange={(e) => setOnlyWithKb(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>Has Regulatory KB Data</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={investmentGradeOnly}
              onChange={(e) => setInvestmentGradeOnly(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>ICRA/CARE Investment Grade (A-/BBB+)</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeAlertsAndLockIn}
              onChange={(e) => setExcludeAlertsAndLockIn(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>Exclude Regulatory Alerts &amp; CDSC Lock-In Overhang</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={requireAnnualReport}
              onChange={(e) => setRequireAnnualReport(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>Annual / Q4 Report Verified ({data?.annualBackedCount ?? 0})</span>
          </label>

          {onChangeAnnualWeightPct && (
            <div className="inline-flex items-center gap-1.5">
              <span className="text-slate-500 dark:text-slate-400">Annual Weight:</span>
              {[70, 100, 50, 0].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onChangeAnnualWeightPct(w)}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-medium transition-colors whitespace-nowrap ${
                    annualWeightPct === w
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {w === 0 ? 'Latest Qtr' : `${w}%`}
                </button>
              ))}
            </div>
          )}

          <div className="inline-flex items-center gap-1.5 ml-auto">
            <span className="text-slate-500 dark:text-slate-400">Max NPL %:</span>
            <input
              type="number"
              step="0.2"
              value={maxNpl}
              onChange={(e) => setMaxNpl(e.target.value)}
              placeholder="e.g. 3.5"
              className="w-20 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-lg p-3.5 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-72 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-72 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        </div>
      ) : data ? (
        <>
          {/* Discovery Map + Selected Gem Thesis Dossier */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Left: Hidden Gem Quadrant Map */}
            <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <Compass className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>Hidden Gem Discovery Map</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    Top {scatterPlot.gems.length} plotted
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Margin of Safety (X) vs Hidden Gem Conviction Score (Y). Click any point to inspect.
                </p>
              </div>

              <div className="mt-3">
                <svg
                  viewBox={`0 0 ${scatterPlot.width} ${scatterPlot.height}`}
                  className="w-full h-auto select-none"
                  role="img"
                  aria-label="Hidden Gem Discovery Map comparing Margin of Safety against Gem Score"
                >
                  {/* Grid & Axes */}
                  {[50, 60, 70, 80, 90].map((yVal) => {
                    const y = scatterPlot.mapY(yVal);
                    return (
                      <g key={yVal}>
                        <line
                          x1={scatterPlot.padL}
                          x2={scatterPlot.width - scatterPlot.padR}
                          y1={y}
                          y2={y}
                          className="stroke-slate-200 dark:stroke-slate-800"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={scatterPlot.padL - 6}
                          y={y + 3}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono"
                        >
                          {yVal}
                        </text>
                      </g>
                    );
                  })}

                  {[0, 15, 30].map((xVal) => {
                    if (xVal < scatterPlot.xMin || xVal > scatterPlot.xMax) return null;
                    const x = scatterPlot.mapX(xVal);
                    return (
                      <g key={xVal}>
                        <line
                          x1={x}
                          x2={x}
                          y1={scatterPlot.padT}
                          y2={scatterPlot.height - scatterPlot.padB}
                          className={
                            xVal === 15
                              ? 'stroke-emerald-500/40'
                              : 'stroke-slate-200 dark:stroke-slate-800'
                          }
                          strokeDasharray="3 3"
                        />
                        <text
                          x={x}
                          y={scatterPlot.height - 12}
                          textAnchor="middle"
                          className="fill-slate-400 text-[10px] font-mono"
                        >
                          {xVal}%
                        </text>
                      </g>
                    );
                  })}

                  <text
                    x={scatterPlot.padL + scatterPlot.plotW / 2}
                    y={scatterPlot.height - 1}
                    textAnchor="middle"
                    className="fill-slate-500 text-[10px]"
                  >
                    Margin of Safety (%)
                  </text>

                  {/* Points */}
                  {scatterPlot.gems.map((g) => {
                    const mos = g.screenerRow.keyMetrics.marginOfSafetyPct ?? 0;
                    const cx = scatterPlot.mapX(mos);
                    const cy = scatterPlot.mapY(g.hiddenGemScore);
                    const isSelected = selectedGem?.symbol === g.symbol;
                    const hasKb = Boolean(g.kbEntry);
                    const fillClass = isSelected
                      ? 'fill-blue-600 dark:fill-blue-400 stroke-slate-900 dark:stroke-white'
                      : g.convictionTier === 'Tier 1 Gem'
                        ? 'fill-emerald-600/80 dark:fill-emerald-400/80 stroke-white dark:stroke-slate-900'
                        : 'fill-slate-500/70 dark:fill-slate-400/70 stroke-white dark:stroke-slate-900';

                    return (
                      <g
                        key={g.symbol}
                        onClick={() => setSelectedGemSymbol(g.symbol)}
                        className="cursor-pointer"
                      >
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 7 : hasKb ? 5.5 : 4.5}
                          strokeWidth={isSelected ? 2 : 1}
                          className={fillClass}
                        />
                        {(isSelected || g.hiddenGemScore >= 73) && (
                          <text
                            x={cx + 7}
                            y={cy + 3}
                            className={`text-[10px] font-mono font-semibold ${
                              isSelected
                                ? 'fill-blue-600 dark:fill-blue-400'
                                : 'fill-slate-700 dark:fill-slate-300'
                            }`}
                          >
                            {g.symbol}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800">
                <span>Green: Tier 1 Gem</span>
                <span aria-hidden="true">·</span>
                <span>Blue: Selected</span>
                <span aria-hidden="true">·</span>
                <span>Larger dot: KB Verified</span>
              </div>
            </div>

            {/* Right: Selected Gem Thesis & Regulatory KB Dossier */}
            <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col justify-between">
              {selectedGem ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">
                          {selectedGem.symbol}
                        </h3>
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {selectedGem.companyName}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        <span>{selectedGem.sector}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {selectedGem.convictionTier} ({selectedGem.hiddenGemScore.toFixed(1)}/100)
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {selectedGem.archetypes.map((a) => ARCHETYPE_SHORT[a]).join(' / ')}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={enrichingSymbol === selectedGem.symbol}
                        onClick={() => void handleEnrichSingle(selectedGem.symbol)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/50 disabled:opacity-50 whitespace-nowrap"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${enrichingSymbol === selectedGem.symbol ? 'animate-spin' : ''}`}
                        />
                        <span>
                          {enrichingSymbol === selectedGem.symbol
                            ? 'Pulling KB…'
                            : selectedGem.kbEntry
                              ? 'Refresh KB'
                              : 'Fetch Rating & Agency KB'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectCompanyDossier(selectedGem.symbol)}
                        className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        9-Investor Dossier
                      </button>
                      <button
                        type="button"
                        onClick={() => onInspectSymbol(selectedGem.symbol)}
                        className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        Explorer
                      </button>
                      <button
                        type="button"
                        onClick={() => onInspectInAnalyzer(selectedGem.symbol)}
                        className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        Analyzer
                      </button>
                    </div>
                  </div>

                  {/* 5-Pillar Sub-Scores */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                    {[
                      { label: 'Valuation', val: selectedGem.subScores.valuationMispricing, max: 30 },
                      { label: 'Quality Moat', val: selectedGem.subScores.qualityMoat, max: 25 },
                      { label: 'Inflection', val: selectedGem.subScores.earningsInflection, max: 20 },
                      { label: 'Neglect Alpha', val: selectedGem.subScores.crowdNeglectAlpha, max: 15 },
                      { label: 'Agency KB', val: selectedGem.subScores.knowledgeBaseConviction, max: 10 },
                    ].map((p) => (
                      <div
                        key={p.label}
                        className="border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950"
                      >
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">{p.label}</div>
                        <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {p.val.toFixed(1)}{' '}
                          <span className="text-[10px] font-normal text-slate-400">/ {p.max}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Thesis Bullets + Watchouts */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    <div>
                      <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 mb-1 flex items-center gap-1.5">
                        <Gem className="w-3.5 h-3.5" />
                        <span>Why It Screens as a Hidden Gem</span>
                      </div>
                      <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                        {selectedGem.whyHiddenGem.map((pt, i) => (
                          <li key={i} className="leading-snug">
                            • {pt}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Risk &amp; Verification Watchouts</span>
                      </div>
                      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                        {selectedGem.riskWatchouts.length > 0 ? (
                          selectedGem.riskWatchouts.map((pt, i) => (
                            <li key={i} className="leading-snug">
                              • {pt}
                            </li>
                          ))
                        ) : (
                          <li>• No critical fundamental or regulatory flags detected.</li>
                        )}
                      </ul>
                    </div>
                  </div>

                  {/* Knowledge Base Details */}
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 text-xs">
                    {selectedGem.kbEntry ? (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            Regulatory &amp; Rating Dossier
                          </span>
                          <span className="font-mono text-blue-600 dark:text-blue-400">
                            {selectedGem.kbEntry.creditRating.agency
                              ? `${selectedGem.kbEntry.creditRating.agency}: ${selectedGem.kbEntry.creditRating.ratingGrade} (${selectedGem.kbEntry.creditRating.outlook})`
                              : 'No ICRA/CARE rating parsed'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-600 dark:text-slate-300">
                            Standing: {selectedGem.kbEntry.regulatoryStanding}
                          </span>
                          {selectedGem.kbEntry.lockInOverhangFlag && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-red-600 dark:text-red-400">
                                CDSC Lock-In Supply Flagged
                              </span>
                            </>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                          {selectedGem.kbEntry.creditRating.rationale && (
                            <div className="sm:col-span-2">
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                Rating Rationale:
                              </span>{' '}
                              {selectedGem.kbEntry.creditRating.rationale}
                            </div>
                          )}
                          {selectedGem.kbEntry.nrbAssessment && (
                            <div>
                              <span className="font-medium text-slate-700 dark:text-slate-200">NRB:</span>{' '}
                              {selectedGem.kbEntry.nrbAssessment}
                            </div>
                          )}
                          {selectedGem.kbEntry.niaAssessment && (
                            <div>
                              <span className="font-medium text-slate-700 dark:text-slate-200">NIA:</span>{' '}
                              {selectedGem.kbEntry.niaAssessment}
                            </div>
                          )}
                          {selectedGem.kbEntry.sebonStatus && (
                            <div>
                              <span className="font-medium text-slate-700 dark:text-slate-200">SEBON:</span>{' '}
                              {selectedGem.kbEntry.sebonStatus}
                            </div>
                          )}
                          {selectedGem.kbEntry.nepseDisclosures && (
                            <div>
                              <span className="font-medium text-slate-700 dark:text-slate-200">NEPSE:</span>{' '}
                              {selectedGem.kbEntry.nepseDisclosures}
                            </div>
                          )}
                          {selectedGem.kbEntry.cdscStatus && (
                            <div>
                              <span className="font-medium text-slate-700 dark:text-slate-200">CDSC:</span>{' '}
                              {selectedGem.kbEntry.cdscStatus}
                            </div>
                          )}
                        </div>

                        {selectedGem.kbEntry.citations.length > 0 && (
                          <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px]">
                            <span className="text-slate-500 dark:text-slate-400">Citations:</span>
                            {selectedGem.kbEntry.citations.slice(0, 4).map((c, idx) => (
                              <a
                                key={`${c.uri}-${idx}`}
                                href={c.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[220px]"
                              >
                                <span>
                                  [{c.agency}] {c.title}
                                </span>
                                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>
                          No ICRA/CARE/NRB/NIA/SEBON/NEPSE/CDSC knowledge base record stored yet for{' '}
                          <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                            {selectedGem.symbol}
                          </span>
                          .
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleEnrichSingle(selectedGem.symbol)}
                          className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                        >
                          Pull Agency Record Now
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                  No hidden gems match the active filters. Try relaxing P/E, MoS %, or KB toggles.
                </div>
              )}
            </div>
          </div>

          {/* Ranked Hidden Gems Table */}
          <DataTable
            rows={data.gems}
            columns={columns}
            rowKey={(g) => g.symbol}
            onRowClick={(g) => setSelectedGemSymbol(g.symbol)}
            maxHeightClass="max-h-[480px]"
            exportFilename="nepse_hidden_gems_screener.csv"
            watchlistFilter={{
              watchlist,
              getSymbol: (g) => g.symbol,
            }}
          />

          {/* Regulatory & Credit Rating Knowledge Base Feed */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Regulatory &amp; Rating Agency Knowledge Base Feed</span>
                <span className="font-mono text-[11px] font-normal text-slate-500 dark:text-slate-400">
                  ({kbFeed?.notices.length ?? 0} records)
                </span>
              </div>

              <div className="relative w-full md:w-64 text-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={kbSearch}
                  onChange={(e) => setKbSearch(e.target.value)}
                  placeholder="Filter notices by ticker or keyword…"
                  className="w-full pl-8 pr-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {AGENCY_TABS.map((ag) => {
                const active = agencyFilter === ag.id;
                const count =
                  ag.id === 'ALL'
                    ? kbSummary?.totalNotices ?? 0
                    : kbSummary?.byAgency[ag.id] ?? 0;
                return (
                  <button
                    key={ag.id}
                    type="button"
                    title={ag.desc}
                    onClick={() => setAgencyFilter(ag.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {ag.label} ({count})
                  </button>
                );
              })}
            </div>

            {kbFeed && kbFeed.notices.length > 0 ? (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-96 overflow-y-auto">
                {kbFeed.notices.slice(0, 60).map((n) => (
                  <div key={n.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2 text-xs">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                          {n.agency}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{n.publishedDate}</span>
                        <span aria-hidden="true">·</span>
                        <span>{n.method}</span>
                        {n.ratingGrade && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                              {n.ratingGrade} ({n.ratingOutlook})
                            </span>
                          </>
                        )}
                        {n.symbols.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex flex-wrap gap-1.5">
                              {n.symbols.map((sym) => (
                                <button
                                  key={sym}
                                  type="button"
                                  onClick={() => onSelectCompanyDossier(sym)}
                                  className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  {sym}
                                </button>
                              ))}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="font-medium text-slate-900 dark:text-slate-100">{n.title}</div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                        {n.summary}
                      </p>
                    </div>

                    {n.url && (
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline shrink-0 whitespace-nowrap"
                      >
                        <span>Source</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <p>No regulatory notices indexed for this filter yet.</p>
                <button
                  type="button"
                  disabled={harvesting !== null}
                  onClick={() =>
                    void handleHarvestAgencies(
                      agencyFilter === 'ALL' ? 'All Agencies' : agencyFilter,
                      agencyFilter === 'ALL'
                        ? ['ICRA', 'CARE', 'NRB', 'NIA', 'SEBON', 'NEPSE', 'CDSC']
                        : [agencyFilter]
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Pull Live Regulatory Bulletins</span>
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};
