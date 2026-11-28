import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Calendar,
  Compass,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  GitCompare,
  Layers,
  Link2,
  Minus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { AnnualTrendCharts } from '../components/annual/AnnualTrendCharts';
import {
  FundamentalMenuBar,
  type FundamentalMenuId,
} from '../components/FundamentalMenuBar';
import type {
  AnnualReportIngestResponse,
  AnnualReportIntelligenceResponse,
  AnnualReportPillarAssessment,
  AnnualReportPillarId,
  AnnualReportPillarStatus,
  AnnualReportUniverseCandidate,
  AnnualReportUniverseResponse,
  ComparisonMetricDeltaRow,
  FiscalYearReportAnalysis,
} from '../types/fundamental';

interface AnnualReportViewProps {
  equityOnly: boolean;
  initialSymbol?: string | null;
  onSymbolChange?: (symbol: string) => void;
  onOpenValuation?: (symbol: string) => void;
  onInspectInScreener?: (symbol: string) => void;
  onSelectFundamentalMenu?: (target: FundamentalMenuId, symbol?: string | null) => void;
}

const PILLAR_ORDER: AnnualReportPillarId[] = [
  'managementQuality',
  'growth',
  'businessOpportunities',
  'risks',
  'weaknesses',
  'uncertainties',
  'upcomingBusinessPlans',
  'businessDirection',
];

const PILLAR_ICONS: Record<AnnualReportPillarId, React.ComponentType<{ className?: string }>> = {
  managementQuality: Building2,
  growth: TrendingUp,
  businessOpportunities: Sparkles,
  risks: ShieldAlert,
  weaknesses: AlertTriangle,
  uncertainties: BookOpen,
  upcomingBusinessPlans: Target,
  businessDirection: Compass,
};

function fmtRs(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `Rs ${v.toFixed(digits)}`;
}

function fmtCr(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `Rs ${v.toFixed(digits)} Cr`;
}

function fmtPct(v: number | null | undefined, signed = false, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = signed && v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtValWithUnit(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (unit === 'Rs') return `Rs ${v.toFixed(1)}`;
  if (unit === 'Cr') return `Rs ${v.toFixed(2)} Cr`;
  if (unit === 'x') return `${v.toFixed(2)}x`;
  return `${v.toFixed(1)}${unit}`;
}

function statusTone(status: AnnualReportPillarStatus): string {
  switch (status) {
    case 'Strong':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'Solid':
      return 'text-blue-700 dark:text-blue-300';
    case 'Watch':
      return 'text-amber-700 dark:text-amber-300';
    case 'Fragile':
      return 'text-red-700 dark:text-red-300';
  }
}

function deltaTone(dir: ComparisonMetricDeltaRow['direction']): string {
  switch (dir) {
    case 'improved':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'deteriorated':
      return 'text-red-600 dark:text-red-400';
    case 'neutral':
      return 'text-slate-600 dark:text-slate-400';
    default:
      return 'text-slate-400 dark:text-slate-500';
  }
}

export const AnnualReportView: React.FC<AnnualReportViewProps> = ({
  equityOnly,
  initialSymbol,
  onSymbolChange,
  onOpenValuation,
  onInspectInScreener,
  onSelectFundamentalMenu,
}) => {
  const [universe, setUniverse] = useState<AnnualReportUniverseResponse | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol || '');
  const [intel, setIntel] = useState<AnnualReportIntelligenceResponse | null>(null);
  const [activeFyTab, setActiveFyTab] = useState<string>('latest');

  const [loadingUniverse, setLoadingUniverse] = useState<boolean>(true);
  const [loadingIntel, setLoadingIntel] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [rosterFilter, setRosterFilter] = useState<
    'all' | 'multi_fy' | 'audited' | 'ai_distilled' | 'rated'
  >('all');

  const [distilling, setDistilling] = useState<boolean>(false);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [showAllLineItems, setShowAllLineItems] = useState<boolean>(false);

  const [ingestOpen, setIngestOpen] = useState<boolean>(false);
  const [ingestFy, setIngestFy] = useState<string>('2082/83');
  const [ingestUrl, setIngestUrl] = useState<string>('');
  const [ingestFile, setIngestFile] = useState<{
    name: string;
    mimeType: string;
    base64: string;
    sizeBytes: number;
  } | null>(null);
  const [ingesting, setIngesting] = useState<boolean>(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<AnnualReportIngestResponse | null>(null);

  useEffect(() => {
    if (initialSymbol) {
      setSelectedSymbol(initialSymbol.toUpperCase());
    }
  }, [initialSymbol]);

  const loadUniverse = useCallback(async () => {
    setLoadingUniverse(true);
    setError(null);
    try {
      const res = await fetch(`/api/annual-reports/universe?equityOnly=${equityOnly}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const resp = data as AnnualReportUniverseResponse;
      setUniverse(resp);
      setSelectedSymbol((prev) => {
        if (prev && resp.candidates.some((c) => c.symbol === prev)) return prev;
        const preferred =
          resp.candidates.find((c) => c.totalFyCount > 1) ??
          resp.candidates.find((c) => c.symbol === 'NABIL') ??
          resp.candidates[0];
        return preferred?.symbol || '';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load annual report universe');
    } finally {
      setLoadingUniverse(false);
    }
  }, [equityOnly]);

  useEffect(() => {
    void loadUniverse();
  }, [loadUniverse]);

  const loadCompanyIntel = useCallback(
    async (sym: string) => {
      if (!sym) return;
      setLoadingIntel(true);
      setDistillError(null);
      setError(null);
      try {
        const res = await fetch(
          `/api/annual-reports/company/${encodeURIComponent(sym)}?equityOnly=${equityOnly}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const payload = data as AnnualReportIntelligenceResponse;
        setIntel(payload);
        setActiveFyTab(
          payload.recommendedAnnualFy ?? payload.fiscalYears[0]?.fiscalYear ?? 'latest'
        );
        setIngestFy(
          payload.fiscalContext?.latestCompletedFy ?? payload.aiDistillTargetFy ?? '2082/83'
        );
        setIngestOpen(!payload.hasAuditedAnnual || payload.fallbackUsed);
        setIngestResult(null);
        setIngestError(null);
        setShowAllLineItems(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to load annual reports for ${sym}`);
        setIntel(null);
      } finally {
        setLoadingIntel(false);
      }
    },
    [equityOnly]
  );

  useEffect(() => {
    if (selectedSymbol) {
      onSymbolChange?.(selectedSymbol);
      void loadCompanyIntel(selectedSymbol);
    }
  }, [selectedSymbol, loadCompanyIntel, onSymbolChange]);

  const filteredCandidates = useMemo(() => {
    const list = universe?.candidates ?? [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((c) => {
      if (sectorFilter !== 'All' && c.sector !== sectorFilter) return false;
      if (rosterFilter === 'multi_fy' && c.totalFyCount < 2) return false;
      if (rosterFilter === 'audited' && c.auditedFyCount === 0) return false;
      if (rosterFilter === 'ai_distilled' && c.aiDistilledFyCount === 0) return false;
      if (rosterFilter === 'rated' && !c.creditRatingLabel) return false;
      if (q) {
        return (
          c.symbol.toLowerCase().includes(q) ||
          c.companyName.toLowerCase().includes(q) ||
          c.sector.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [universe, searchQuery, sectorFilter, rosterFilter]);

  const activeFyReport: FiscalYearReportAnalysis | null = useMemo(() => {
    if (!intel || intel.fiscalYears.length === 0) return null;
    if (activeFyTab === 'compare') return intel.fiscalYears[0];
    return (
      intel.fiscalYears.find((f) => f.fiscalYear === activeFyTab) ?? intel.fiscalYears[0]
    );
  }, [intel, activeFyTab]);

  const handleDistillFy = async (fiscalYear: string, force = false) => {
    if (!selectedSymbol) return;
    setDistilling(true);
    setDistillError(null);
    try {
      const res = await fetch('/api/annual-reports/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, fiscalYear, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `AI distillation failed (${res.status})`);
      }
      await loadCompanyIntel(selectedSymbol);
      setActiveFyTab(fiscalYear);
      await loadUniverse();
    } catch (err) {
      setDistillError(
        err instanceof Error ? err.message : `AI distillation failed for ${selectedSymbol}`
      );
    } finally {
      setDistilling(false);
    }
  };

  const handleSelectReportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setIngestError(null);
    if (!file) {
      setIngestFile(null);
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setIngestError('File exceeds 15 MB upload cap. Provide a smaller PDF/text file or paste an official link.');
      setIngestFile(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const resStr = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = resStr.indexOf(',');
      const base64 = commaIdx >= 0 ? resStr.slice(commaIdx + 1) : resStr;
      setIngestFile({
        name: file.name,
        mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain'),
        base64,
        sizeBytes: file.size,
      });
    };
    reader.onerror = () => {
      setIngestError('Failed to read selected local file.');
    };
    reader.readAsDataURL(file);
  };

  const handleIngestReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSymbol) return;
    if (!ingestUrl.trim() && !ingestFile) {
      setIngestError('Upload an Annual Report file (PDF/TXT/CSV) or paste a public URL link first.');
      return;
    }

    setIngesting(true);
    setIngestError(null);
    setIngestResult(null);
    try {
      const res = await fetch('/api/annual-reports/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedSymbol,
          fiscalYear: ingestFy.trim() || undefined,
          sourceUrl: ingestUrl.trim() || undefined,
          fileName: ingestFile?.name,
          mimeType: ingestFile?.mimeType,
          fileBase64: ingestFile?.base64,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Upload / link distillation failed (${res.status})`);
      }
      const parsed = data as AnnualReportIngestResponse;
      setIngestResult(parsed);
      setIngestUrl('');
      setIngestFile(null);
      await loadCompanyIntel(selectedSymbol);
      setActiveFyTab(parsed.fiscalYear);
      await loadUniverse();
    } catch (err) {
      setIngestError(
        err instanceof Error ? err.message : `Failed to save and distill report for ${selectedSymbol}`
      );
    } finally {
      setIngesting(false);
    }
  };

  const renderPillarCard = (pillar: AnnualReportPillarAssessment) => {
    const Icon = PILLAR_ICONS[pillar.id];
    return (
      <article
        key={pillar.id}
        className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-3"
      >
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {pillar.title}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">{pillar.subtitle}</p>
              </div>
            </div>
            <span className={`text-xs font-semibold whitespace-nowrap shrink-0 ${statusTone(pillar.status)}`}>
              {pillar.status}
            </span>
          </div>

          <p className="text-xs sm:text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed">
            {pillar.summary}
          </p>

          <ul className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80">
            {pillar.findings.map((item, idx) => (
              <li
                key={idx}
                className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed flex items-start gap-2"
              >
                <span aria-hidden="true" className="text-slate-400 dark:text-slate-500 select-none">
                  ·
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-2">
          {pillar.keyMetrics.map((km, idx) => (
            <div key={idx} className="min-w-0">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {km.label}
              </div>
              <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums truncate">
                {km.value}
              </div>
              {km.note && (
                <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                  {km.note}
                </div>
              )}
            </div>
          ))}
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-6">
      {onSelectFundamentalMenu && (
        <FundamentalMenuBar
          active="annual-reports"
          activeSymbol={selectedSymbol || null}
          onSelect={onSelectFundamentalMenu}
        />
      )}

      {/* Universe Overview Header */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Annual Report Analysis &amp; Stock Intelligence
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
            Structured distillation of stored financial statements, multi-year growth trends, management quality, regulatory standing, and strategic direction across NEPSE companies.
          </p>
          {universe?.fiscalContext && (
            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              Current BS FY {universe.fiscalContext.currentFy} · Latest Closed FY {universe.fiscalContext.latestCompletedFy} · Prior FY {universe.fiscalContext.previousCompletedFy} · Poush End ~{universe.fiscalContext.poushEndApproxDate}{' '}
              ({universe.fiscalContext.poushEndPassed
                ? 'Crossed — latest FY audited AR expected'
                : `${universe.fiscalContext.daysUntilPoushEnd}d left — falls back to prior FY if latest AR not yet published`})
            </p>
          )}
        </div>

        {universe && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-mono tabular-nums shrink-0">
            <div>
              <span className="text-slate-500 dark:text-slate-400 block text-[11px] font-sans">
                Covered Stocks
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {universe.totalCompanies}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400 block text-[11px] font-sans">
                Multi-FY History
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {universe.multiFyCount}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400 block text-[11px] font-sans">
                Audited Annual
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {universe.auditedAnnualCount}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400 block text-[11px] font-sans">
                AI Distilled
              </span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {universe.aiDistilledCount}
              </span>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="border border-red-200 dark:border-red-900 rounded-lg bg-red-50 dark:bg-red-950/30 px-4 py-3 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadUniverse()}
            className="px-3 py-1.5 rounded-md border border-red-300 dark:border-red-800 font-medium hover:bg-red-100 dark:hover:bg-red-900/40 whitespace-nowrap shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Searchable Company Roster */}
        <aside className="lg:col-span-4 xl:col-span-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
          <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search symbol or company…"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['all', 'All'],
                  ['multi_fy', 'Multi-FY'],
                  ['audited', 'Annual'],
                  ['ai_distilled', 'AI'],
                  ['rated', 'Rated'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRosterFilter(id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    rosterFilter === id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              aria-label="Filter by sector"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200"
            >
              <option value="All">All Sectors ({universe?.candidates.length ?? 0})</option>
              {(universe?.sectors ?? []).map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>
          </div>

          <div className="max-h-[72vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
            {loadingUniverse ? (
              <div className="p-4 space-y-2.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 rounded bg-slate-100 dark:bg-slate-800 animate-pulse"
                  />
                ))}
              </div>
            ) : filteredCandidates.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <p>No companies match your current filter.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSectorFilter('All');
                    setRosterFilter('all');
                  }}
                  className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              filteredCandidates.map((c: AnnualReportUniverseCandidate) => {
                const active = c.symbol === selectedSymbol;
                return (
                  <button
                    key={c.symbol}
                    type="button"
                    onClick={() => setSelectedSymbol(c.symbol)}
                    className={`w-full text-left px-3.5 py-2.5 transition-colors flex items-start justify-between gap-2 ${
                      active
                        ? 'bg-blue-50/80 dark:bg-blue-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono text-xs font-bold ${
                            active
                              ? 'text-blue-700 dark:text-blue-300'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {c.symbol}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {c.latestFy ? `FY ${c.latestFy}` : ''}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300 truncate">
                        {c.companyName}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {c.totalFyCount} FY{c.totalFyCount === 1 ? '' : 's'}
                        <span aria-hidden="true"> · </span>
                        {c.auditedFyCount > 0 ? 'Audited' : 'Interim'}
                        {c.aiDistilledFyCount > 0 ? ' · AI' : ''}
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0 space-y-0.5">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {c.ltp !== null ? `Rs ${c.ltp.toFixed(0)}` : '—'}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        ROE {c.roePct !== null ? `${c.roePct.toFixed(1)}%` : '—'}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right: Active Stock Annual Report Intelligence Workspace */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-5 min-w-0">
          {loadingIntel ? (
            <div className="space-y-4">
              <div className="h-32 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-48 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : !intel || !activeFyReport ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-8 text-center space-y-2">
              <FileText className="w-6 h-6 text-slate-400 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Select a company to view Annual Report Intelligence
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Choose any stock from the left roster to inspect its latest annual report analysis, multi-year comparisons, and trend charts.
              </p>
            </div>
          ) : (
            <>
              {/* Stock Header + Historical Annual Report Tabs */}
              <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {intel.companyName}
                      </h3>
                      <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">
                        {intel.symbol}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span>{intel.sector}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        LTP {fmtRs(intel.ltp, 0)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {intel.hasAuditedAnnual
                          ? `${intel.auditedFyCount} Audited Annual FY`
                          : 'Latest Interim / Quarterly Basis'}
                      </span>
                      {intel.kbEntry?.creditRating?.ratingGrade && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            Rating {intel.kbEntry.creditRating.ratingGrade} ({intel.kbEntry.creditRating.outlook})
                          </span>
                        </>
                      )}
                      {intel.compositeFairValue !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            Intrinsic {fmtRs(intel.compositeFairValue, 0)} ({fmtPct(intel.marginOfSafetyPct, true)} MoS)
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {onOpenValuation && (
                      <button
                        type="button"
                        onClick={() => onOpenValuation(intel.symbol)}
                        className="px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                      >
                        Valuation Lab
                      </button>
                    )}
                    {onInspectInScreener && (
                      <button
                        type="button"
                        onClick={() => onInspectInScreener(intel.symbol)}
                        className="px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                      >
                        9-Investor Dossier
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIngestOpen((v) => !v)}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                        ingestOpen
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload / Link Missing FY</span>
                    </button>

                    <button
                      type="button"
                      disabled={distilling}
                      onClick={() => {
                        const targetFy =
                          activeFyTab === 'compare'
                            ? intel.aiDistillTargetFy || intel.recommendedAnnualFy || activeFyReport.fiscalYear
                            : activeFyReport.fiscalYear;
                        void handleDistillFy(targetFy, Boolean(activeFyReport.aiDistillation));
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${distilling ? 'animate-spin' : ''}`} />
                      <span>
                        {distilling
                          ? `Distilling FY ${activeFyTab === 'compare' ? intel.aiDistillTargetFy : activeFyReport.fiscalYear}…`
                          : activeFyReport.aiDistillation
                            ? `Refresh AI FY ${activeFyReport.fiscalYear}`
                            : `Distill FY ${activeFyTab === 'compare' ? intel.aiDistillTargetFy : activeFyReport.fiscalYear} with AI`}
                      </span>
                    </button>
                  </div>
                </div>

                {intel.fallbackUsed && intel.fallbackReason && (
                  <div className="px-3.5 py-2.5 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 text-xs text-blue-900 dark:text-blue-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <Calendar className="w-4 h-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                      <span>
                        <strong>Nepal FY Poush-End Rule Applied:</strong> {intel.fallbackReason}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIngestOpen(true)}
                      className="text-xs font-semibold text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap shrink-0"
                    >
                      Upload or Link FY {intel.fiscalContext.latestCompletedFy} Report →
                    </button>
                  </div>
                )}

                {ingestResult && (
                  <div className="px-3.5 py-2.5 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
                    <div className="font-semibold">
                      Saved &amp; Distilled FY {ingestResult.fiscalYear} for {ingestResult.symbol} ({ingestResult.distillation.model})
                    </div>
                    <div className="font-mono text-[11px] opacity-90">
                      Stored: {ingestResult.savedFilePath} · Knowledge Base updated ({ingestResult.kbUpdated ? 'Yes' : 'No'}) · Source: {ingestResult.sourceType}
                    </div>
                  </div>
                )}

                {ingestOpen && (
                  <form
                    onSubmit={(e) => void handleIngestReport(e)}
                    className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          Upload Missing Annual Report or Paste Official Link
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          When an Annual Report FY (such as FY {intel.fiscalContext.latestCompletedFy}) is not in the vault yet, upload the PDF/text report or paste its public URL. We save it locally, distill all 8 qualitative &amp; financial pillars, and update the NEPSE Regulatory Knowledge Base.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIngestOpen(false)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 whitespace-nowrap"
                      >
                        Hide
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                      <div className="md:col-span-2">
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                          Target FY (BS)
                        </label>
                        <input
                          type="text"
                          value={ingestFy}
                          onChange={(e) => setIngestFy(e.target.value)}
                          placeholder="e.g. 2082/83"
                          list="nepse-fy-options"
                          className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                        <datalist id="nepse-fy-options">
                          <option value={intel.fiscalContext.currentFy} />
                          <option value={intel.fiscalContext.latestCompletedFy} />
                          <option value={intel.fiscalContext.previousCompletedFy} />
                          <option value="2080/81" />
                        </datalist>
                      </div>

                      <div className="md:col-span-5">
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                          Public Annual Report Link (PDF / Notice URL)
                        </label>
                        <div className="relative">
                          <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="url"
                            value={ingestUrl}
                            onChange={(e) => setIngestUrl(e.target.value)}
                            placeholder="https://company.com.np/annual-report-2082-83.pdf"
                            className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          />
                        </div>
                      </div>

                      <div className="md:col-span-3">
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                          Or Upload File (.pdf, .txt, .csv, .md)
                        </label>
                        <input
                          type="file"
                          accept=".pdf,.txt,.md,.csv,.json,application/pdf,text/plain"
                          onChange={handleSelectReportFile}
                          className="block w-full text-[11px] text-slate-600 dark:text-slate-300 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border file:border-slate-200 dark:file:border-slate-700 file:text-[11px] file:font-medium file:bg-white dark:file:bg-slate-900 file:text-slate-700 dark:file:text-slate-200 hover:file:bg-slate-100"
                        />
                        {ingestFile && (
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5 truncate">
                            {ingestFile.name} ({Math.round(ingestFile.sizeBytes / 1024)} KB)
                          </div>
                        )}
                      </div>

                      <div className="md:col-span-2">
                        <button
                          type="submit"
                          disabled={ingesting || (!ingestUrl.trim() && !ingestFile)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>{ingesting ? 'Saving & Distilling…' : 'Save & Distill'}</span>
                        </button>
                      </div>
                    </div>

                    {ingestError && (
                      <div className="text-xs text-red-600 dark:text-red-400">{ingestError}</div>
                    )}
                  </form>
                )}

                {distillError && (
                  <div className="px-3.5 py-2.5 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
                    {distillError}
                  </div>
                )}

                {/* Historical Annual Report Tabs */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    {intel.fiscalYears.map((fy) => {
                      const isTabActive = activeFyTab === fy.fiscalYear;
                      return (
                        <button
                          key={fy.fiscalYear}
                          type="button"
                          onClick={() => setActiveFyTab(fy.fiscalYear)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            isTabActive
                              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                          }`}
                        >
                          <span>
                            {fy.isLatest ? `Latest · FY ${fy.fiscalYear}` : `FY ${fy.fiscalYear}`}
                          </span>
                          <span className="ml-1.5 text-[10px] opacity-75">
                            ({fy.basis === 'Audited Annual' ? 'Annual' : fy.quarter})
                          </span>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => setActiveFyTab('compare')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        activeFyTab === 'compare'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      <GitCompare className="w-3.5 h-3.5" />
                      <span>Compare Across Years ({intel.totalFyCount})</span>
                    </button>
                  </div>

                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {activeFyTab === 'compare'
                      ? `Cross-FY historical matrix · ${intel.totalFyCount} fiscal year${intel.totalFyCount === 1 ? '' : 's'}`
                      : `${activeFyReport.periodLabel} · ${activeFyReport.basis} · Source: ${activeFyReport.dataSource}`}
                  </div>
                </div>
              </section>

              {activeFyTab === 'compare' ? (
                /* Dedicated Multi-Year Comparison Tab */
                <div className="space-y-5">
                  {intel.comparison && (
                    <ComparisonMatrixSection
                      comparison={intel.comparison}
                      fiscalYears={intel.fiscalYears}
                    />
                  )}
                  <AnnualTrendCharts
                    symbol={intel.symbol}
                    sectorGroup={intel.sectorGroup}
                    trendSeries={intel.trendSeries}
                  />
                </div>
              ) : (
                /* Selected Fiscal Year Deep-Dive Tab (Latest FY by default) */
                <div className="space-y-5">
                  {/* Executive Distillation Summary & KPI Strip */}
                  <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          {activeFyReport.isLatest
                            ? `Latest Report Distillation · FY ${activeFyReport.fiscalYear}`
                            : `Historical Report Analysis · FY ${activeFyReport.fiscalYear}`}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {activeFyReport.basis} ({activeFyReport.periodLabel})
                          <span aria-hidden="true"> · </span>
                          Validation: {activeFyReport.validationStatus}
                          {activeFyReport.publicationDate
                            ? ` · Published ${activeFyReport.publicationDate}`
                            : ''}
                          {activeFyReport.aiDistillation
                            ? ` · AI Distilled (${activeFyReport.aiDistillation.model})`
                            : ''}
                        </p>
                      </div>

                      {activeFyReport.sourceUrl && (
                        <a
                          href={activeFyReport.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                        >
                          <span>Source Disclosure</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    {activeFyReport.basis !== 'Audited Annual' && (
                      <div className="px-3.5 py-2 rounded-md border border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300">
                        Audited full-year Annual Report PDF metrics are not yet indexed for FY {activeFyReport.fiscalYear}; figures below reflect {activeFyReport.periodLabel} ({activeFyReport.basis}). Click{' '}
                        <strong>Distill FY {activeFyReport.fiscalYear} with AI</strong> to fetch audited AGM &amp; Board Report highlights via search grounding.
                      </div>
                    )}

                    <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed max-w-4xl">
                      {activeFyReport.executiveSummary}
                    </p>

                    {/* Key Metrics Strip */}
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                      {[
                        {
                          label: 'Revenue',
                          val: fmtCr(activeFyReport.metrics.revenueCr, 1),
                          delta: activeFyReport.yoyDeltas.revenueYoYPct,
                          unit: '%',
                        },
                        {
                          label: 'Net Profit',
                          val: fmtCr(activeFyReport.metrics.netProfitCr, 1),
                          delta: activeFyReport.yoyDeltas.netProfitYoYPct,
                          unit: '%',
                        },
                        {
                          label: 'EPS',
                          val: fmtRs(activeFyReport.metrics.eps, 2),
                          delta: activeFyReport.yoyDeltas.epsYoYPct,
                          unit: '%',
                        },
                        {
                          label: 'BVPS',
                          val: fmtRs(activeFyReport.metrics.bvps, 1),
                          delta: activeFyReport.yoyDeltas.bvpsYoYPct,
                          unit: '%',
                        },
                        {
                          label: 'ROE',
                          val: fmtPct(activeFyReport.metrics.roePct),
                          delta: activeFyReport.yoyDeltas.roeDeltaPp,
                          unit: ' pp',
                        },
                        {
                          label: 'Net Margin',
                          val: fmtPct(activeFyReport.metrics.netMarginPct),
                          delta: activeFyReport.yoyDeltas.netMarginDeltaPp,
                          unit: ' pp',
                        },
                        {
                          label: 'Net Worth',
                          val: fmtCr(activeFyReport.metrics.netWorthCr, 1),
                          delta: activeFyReport.yoyDeltas.netWorthYoYPct,
                          unit: '%',
                        },
                        {
                          label:
                            intel.sectorGroup === 'Banking' || intel.sectorGroup === 'Microfinance'
                              ? 'NPL / CAR'
                              : 'Debt / Equity',
                          val:
                            intel.sectorGroup === 'Banking' || intel.sectorGroup === 'Microfinance'
                              ? `${fmtPct(activeFyReport.metrics.nplPct, false, 2)} / ${fmtPct(activeFyReport.metrics.carPct)}`
                              : activeFyReport.metrics.debtToEquity !== null
                                ? `${activeFyReport.metrics.debtToEquity.toFixed(2)}x`
                                : '—',
                          delta:
                            intel.sectorGroup === 'Banking' || intel.sectorGroup === 'Microfinance'
                              ? activeFyReport.yoyDeltas.nplDeltaPp
                              : activeFyReport.yoyDeltas.debtToEquityDelta,
                          unit:
                            intel.sectorGroup === 'Banking' || intel.sectorGroup === 'Microfinance'
                              ? ' pp NPL'
                              : 'x',
                        },
                      ].map((kpi) => (
                        <div key={kpi.label} className="space-y-0.5">
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {kpi.label}
                          </div>
                          <div className="font-mono text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                            {kpi.val}
                          </div>
                          {kpi.delta !== null && (
                            <div
                              className={`font-mono text-[10px] tabular-nums ${
                                kpi.delta >= 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {kpi.delta >= 0 ? '+' : ''}
                              {kpi.delta.toFixed(1)}
                              {kpi.unit} YoY
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* 8-Pillar Annual Report Assessment Grid */}
                  <section className="space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          8-Pillar Annual Report Assessment · FY {activeFyReport.fiscalYear}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Management quality, growth, opportunities, risks, weaknesses, uncertainties, upcoming plans, and strategic direction
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {PILLAR_ORDER.map((id) => renderPillarCard(activeFyReport.pillars[id]))}
                    </div>
                  </section>

                  {/* AI AGM / Auditor / Dividend Highlights & Citations (when available) */}
                  {(activeFyReport.aiDistillation ||
                    (activeFyReport.isLatest && intel.legacyDeepDive)) && (
                    <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                            AGM Governance, Dividends &amp; Grounded Disclosures
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Extracted via server-side search grounding ·{' '}
                            {activeFyReport.aiDistillation
                              ? `FY ${activeFyReport.aiDistillation.fiscalYear} (${activeFyReport.aiDistillation.model})`
                              : `Latest Deep Dive (${intel.legacyDeepDive?.model})`}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            Auditor &amp; Governance Notes
                          </h4>
                          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {(
                              activeFyReport.aiDistillation?.auditorAndGovernanceNotes ??
                              intel.legacyDeepDive?.auditorAndGovernanceFindings ??
                              []
                            ).map((note, idx) => (
                              <li key={idx}>· {note}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-1.5">
                          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            Dividend &amp; Bonus History
                          </h4>
                          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {(
                              activeFyReport.aiDistillation?.dividendAndBonusDeclared ??
                              intel.legacyDeepDive?.dividendAndBonusHistory ??
                              []
                            ).map((div, idx) => (
                              <li key={idx}>· {div}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-1.5">
                          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            Strategic Shift vs Prior FY
                          </h4>
                          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {(
                              activeFyReport.aiDistillation?.strategicComparisonVsPriorFy ?? [
                                intel.legacyDeepDive?.considerableInvestmentVerdict || '',
                              ]
                            )
                              .filter(Boolean)
                              .map((s, idx) => (
                                <li key={idx}>· {s}</li>
                              ))}
                          </ul>
                        </div>
                      </div>

                      {(
                        activeFyReport.aiDistillation?.citations ??
                        intel.legacyDeepDive?.citations ??
                        []
                      ).length > 0 && (
                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            Verified Filing &amp; News Sources
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {(
                              activeFyReport.aiDistillation?.citations ??
                              intel.legacyDeepDive?.citations ??
                              []
                            ).map((cit, idx) => (
                              <a
                                key={idx}
                                href={cit.uri}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline max-w-xs truncate"
                              >
                                <span className="truncate">{cit.title}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  {/* Multi-Year Trend Visualizations */}
                  <AnnualTrendCharts
                    symbol={intel.symbol}
                    sectorGroup={intel.sectorGroup}
                    trendSeries={intel.trendSeries}
                    selectedFy={activeFyReport.fiscalYear}
                  />

                  {/* Automated Latest vs Prior FY Comparison */}
                  {intel.comparison && (
                    <ComparisonMatrixSection
                      comparison={intel.comparison}
                      fiscalYears={intel.fiscalYears}
                    />
                  )}

                  {/* Within-FY Quarterly Progression & Raw Statement Line Items */}
                  {(activeFyReport.quarterHistoryInFy.length > 0 ||
                    activeFyReport.lineItemHighlights.length > 0) && (
                    <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                            Stored Statement Disclosures · FY {activeFyReport.fiscalYear}
                          </h3>
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {activeFyReport.quarterHistoryInFy.length} period record(s) ·{' '}
                          {activeFyReport.lineItemHighlights.length} extracted line items
                        </span>
                      </div>

                      {activeFyReport.quarterHistoryInFy.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                                <th className="py-2 pr-4 font-medium">Period</th>
                                <th className="py-2 px-3 font-medium text-right">Revenue</th>
                                <th className="py-2 px-3 font-medium text-right">Net Profit</th>
                                <th className="py-2 px-3 font-medium text-right">EPS</th>
                                <th className="py-2 px-3 font-medium text-right">BVPS</th>
                                <th className="py-2 pl-3 font-medium text-right">ROE</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                              {activeFyReport.quarterHistoryInFy.map((q) => (
                                <tr
                                  key={q.periodLabel}
                                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                >
                                  <td className="py-2 pr-4 font-sans font-medium text-slate-900 dark:text-slate-100">
                                    {q.periodLabel}
                                  </td>
                                  <td className="py-2 px-3 text-right">{fmtCr(q.revenueCr, 2)}</td>
                                  <td className="py-2 px-3 text-right">{fmtCr(q.netProfitCr, 2)}</td>
                                  <td className="py-2 px-3 text-right">{fmtRs(q.eps, 2)}</td>
                                  <td className="py-2 px-3 text-right">{fmtRs(q.bvps, 1)}</td>
                                  <td className="py-2 pl-3 text-right">{fmtPct(q.roePct)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {activeFyReport.lineItemHighlights.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                              Reported Financial Line Items
                            </h4>
                            {activeFyReport.lineItemHighlights.length > 12 && (
                              <button
                                type="button"
                                onClick={() => setShowAllLineItems((v) => !v)}
                                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {showAllLineItems
                                  ? 'Show fewer'
                                  : `Show all ${activeFyReport.lineItemHighlights.length} items`}
                              </button>
                            )}
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left border-collapse">
                              <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                                  <th className="py-1.5 pr-4 font-medium">Statement / Section</th>
                                  <th className="py-1.5 px-3 font-medium">Particulars</th>
                                  <th className="py-1.5 pl-3 font-medium text-right">Reported Value</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                                {(showAllLineItems
                                  ? activeFyReport.lineItemHighlights
                                  : activeFyReport.lineItemHighlights.slice(0, 12)
                                ).map((li, idx) => (
                                  <tr
                                    key={idx}
                                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                  >
                                    <td className="py-1.5 pr-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                      {li.section}
                                    </td>
                                    <td className="py-1.5 px-3 text-slate-800 dark:text-slate-200">
                                      {li.particulars}
                                    </td>
                                    <td className="py-1.5 pl-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                      {li.rawValue}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const ComparisonMatrixSection: React.FC<{
  comparison: NonNullable<AnnualReportIntelligenceResponse['comparison']>;
  fiscalYears: FiscalYearReportAnalysis[];
}> = ({ comparison, fiscalYears }) => {
  return (
    <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Comparison with Previous Financial Years
            </h3>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 max-w-3xl">
            {comparison.headlineSummary}
          </p>
        </div>

        <div className="text-xs font-medium text-slate-700 dark:text-slate-200 shrink-0">
          Mgmt Execution: <strong>{comparison.managementPerformanceShift.status}</strong>
        </div>
      </div>

      {/* Quantitative YoY Metric Comparison Table */}
      {comparison.hasMultiYearComparison && comparison.metricDeltas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4 font-medium">Metric</th>
                <th className="py-2 px-3 font-medium text-right">FY {comparison.priorFy}</th>
                <th className="py-2 px-3 font-medium text-right">FY {comparison.latestFy}</th>
                <th className="py-2 px-3 font-medium text-right">YoY Change</th>
                <th className="py-2 pl-4 font-medium">Analytical Reading</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {comparison.metricDeltas.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {row.label}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {fmtValWithUnit(row.priorVal, row.unit)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {fmtValWithUnit(row.latestVal, row.unit)}
                  </td>
                  <td
                    className={`py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap ${deltaTone(row.direction)}`}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      {row.direction === 'improved' && <ArrowUpRight className="w-3 h-3" />}
                      {row.direction === 'deteriorated' && <ArrowDownRight className="w-3 h-3" />}
                      {row.direction === 'neutral' && <Minus className="w-3 h-3" />}
                      {row.absDelta !== null
                        ? row.pctDelta !== null
                          ? `${row.pctDelta >= 0 ? '+' : ''}${row.pctDelta.toFixed(1)}%`
                          : `${row.absDelta >= 0 ? '+' : ''}${row.absDelta.toFixed(2)}${row.unit === '%' ? ' pp' : row.unit}`
                        : '—'}
                    </span>
                  </td>
                  <td className="py-2 pl-4 text-slate-600 dark:text-slate-300">
                    {row.interpretation}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Multi-Year Cross-Tab Snapshot when 2+ FYs exist */}
      {fiscalYears.length > 1 && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            All Indexed Fiscal Years Side-by-Side
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-4 font-medium">Fiscal Year</th>
                  <th className="py-2 px-3 font-medium">Basis</th>
                  <th className="py-2 px-3 font-medium text-right">Revenue</th>
                  <th className="py-2 px-3 font-medium text-right">Net Profit</th>
                  <th className="py-2 px-3 font-medium text-right">EPS</th>
                  <th className="py-2 px-3 font-medium text-right">BVPS</th>
                  <th className="py-2 px-3 font-medium text-right">ROE</th>
                  <th className="py-2 pl-3 font-medium text-right">Net Worth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                {fiscalYears.map((fy) => (
                  <tr key={fy.fiscalYear} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 pr-4 font-sans font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      FY {fy.fiscalYear}
                    </td>
                    <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {fy.basis} ({fy.quarter})
                    </td>
                    <td className="py-2 px-3 text-right">{fmtCr(fy.metrics.revenueCr, 1)}</td>
                    <td className="py-2 px-3 text-right">{fmtCr(fy.metrics.netProfitCr, 1)}</td>
                    <td className="py-2 px-3 text-right">{fmtRs(fy.metrics.eps, 2)}</td>
                    <td className="py-2 px-3 text-right">{fmtRs(fy.metrics.bvps, 1)}</td>
                    <td className="py-2 px-3 text-right">{fmtPct(fy.metrics.roePct)}</td>
                    <td className="py-2 pl-3 text-right">{fmtCr(fy.metrics.netWorthCr, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Qualitative Cross-Year Evolution Grid */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Management Performance Shift
          </h4>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {comparison.managementPerformanceShift.summary}
          </p>
          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
            {comparison.managementPerformanceShift.points.map((pt, i) => (
              <li key={i}>· {pt}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Strategy &amp; Direction Changes
          </h4>
          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {comparison.strategyAndDirectionShifts.map((pt, i) => (
              <li key={i}>· {pt}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Progress Against Prior Plans
          </h4>
          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {comparison.progressAgainstPriorPlans.map((pt, i) => (
              <li key={i}>· {pt}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Emerging Opportunities
          </h4>
          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {comparison.emergingOpportunities.map((pt, i) => (
              <li key={i}>· {pt}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Emerging Risks &amp; Weaknesses
          </h4>
          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {comparison.emergingRisksAndWeaknesses.map((pt, i) => (
              <li key={i}>· {pt}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Efficiency &amp; Capital Allocation Trend
          </h4>
          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {comparison.efficiencyAndCapitalTrend.map((pt, i) => (
              <li key={i}>· {pt}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};
