import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  Calculator,
  CandlestickChart,
  CheckCircle2,
  Compass,
  Crosshair,
  ExternalLink,
  FileSearch,
  Layers,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type {
  AnnualReportAiDeepDive,
  CompanyValuationDossierResponse,
  ValuationUniverseCandidate,
  ValuationUniverseResponse,
} from '../types/fundamental';
import { ValuationHealthScoreCard } from '../components/valuation/ValuationHealthScoreCard';
import { AnnualReportDissectorPanel } from '../components/valuation/AnnualReportDissectorPanel';
import {
  FundamentalMenuBar,
  type FundamentalMenuId,
} from '../components/FundamentalMenuBar';

interface ValuationViewProps {
  equityOnly: boolean;
  initialSymbol?: string | null;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer: (symbol: string) => void;
  onInspectInScreener?: (symbol: string) => void;
  onSymbolChange?: (symbol: string) => void;
  onSelectFundamentalMenu?: (target: FundamentalMenuId, symbol?: string | null) => void;
}

function fmtRs(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `Rs ${v.toFixed(digits)}`;
}

function fmtNum(v: number | null | undefined, digits = 1, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtSigned(v: number | null | undefined, digits = 1, suffix = '%'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}${suffix}`;
}

function verdictTone(verdict: CompanyValuationDossierResponse['pricingVerdict']): string {
  switch (verdict) {
    case 'Deeply Undervalued':
    case 'Undervalued / Attractive':
      return 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300';
    case 'Fairly Valued':
      return 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300';
    case 'Richly Priced':
      return 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300';
    default:
      return 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
  }
}

function convictionTone(
  tier: CompanyValuationDossierResponse['swot']['futureWorthVerdict']['convictionTier']
): string {
  switch (tier) {
    case 'Core Long-Term Allocation':
      return 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300';
    case 'Opportunistic Value Allocation':
      return 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300';
    case 'Hold / Wait for Entry Zone':
      return 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300';
    default:
      return 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300';
  }
}

export const ValuationView: React.FC<ValuationViewProps> = ({
  equityOnly,
  initialSymbol,
  onInspectSymbol,
  onInspectInAnalyzer,
  onInspectInScreener,
  onSymbolChange,
  onSelectFundamentalMenu,
}) => {
  const [annualWeightPct, setAnnualWeightPct] = useState<number>(70);
  const [universe, setUniverse] = useState<ValuationUniverseResponse | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol || '');
  const [dossier, setDossier] = useState<CompanyValuationDossierResponse | null>(null);

  const [loadingUniverse, setLoadingUniverse] = useState<boolean>(true);
  const [loadingDossier, setLoadingDossier] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Selector filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [candidateFilter, setCandidateFilter] = useState<
    'all' | 'annual_only' | 'undervalued' | 'core'
  >('all');

  // Interactive Pricing Sandbox State
  const [simPrice, setSimPrice] = useState<number>(400);
  const [simKe, setSimKe] = useState<number>(12.0);
  const [simGrowth, setSimGrowth] = useState<number>(8.0);

  // Live Annual Report Search Grounding Deep-Dive
  const [deepDiving, setDeepDiving] = useState<boolean>(false);
  const [deepDiveError, setDeepDiveError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSymbol) {
      setSelectedSymbol(initialSymbol.toUpperCase());
    }
  }, [initialSymbol]);

  const loadUniverse = useCallback(async () => {
    setLoadingUniverse(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/valuation/universe?equityOnly=${equityOnly}&annualWeightPct=${annualWeightPct}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const resp = data as ValuationUniverseResponse;
      setUniverse(resp);
      setSelectedSymbol((prev) => {
        if (prev && resp.candidates.some((c) => c.symbol === prev)) return prev;
        const annualPreferred = resp.candidates.find((c) => c.hasAnnualReport);
        return annualPreferred?.symbol || resp.candidates[0]?.symbol || '';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load valuation universe');
    } finally {
      setLoadingUniverse(false);
    }
  }, [equityOnly, annualWeightPct]);

  useEffect(() => {
    void loadUniverse();
  }, [loadUniverse]);

  const loadDossier = useCallback(
    async (sym: string) => {
      if (!sym) return;
      setLoadingDossier(true);
      setDeepDiveError(null);
      try {
        const res = await fetch(
          `/api/valuation/company/${encodeURIComponent(sym)}?equityOnly=${equityOnly}&annualWeightPct=${annualWeightPct}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const d = data as CompanyValuationDossierResponse;
        setDossier(d);
        setSimPrice(Math.round(d.summary.market.ltp ?? d.compositeFairValue ?? 400));
        setSimKe(12.0);
        const rawG =
          d.summary.keyMetrics.epsCagr3yPct ??
          d.summary.keyMetrics.epsYoyPct ??
          (d.summary.keyMetrics.roePct ? Math.round(d.summary.keyMetrics.roePct * 0.48) : 8);
        setSimGrowth(Math.max(2, Math.min(20, Math.round(rawG))));
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to load dossier for ${sym}`);
        setDossier(null);
      } finally {
        setLoadingDossier(false);
      }
    },
    [equityOnly, annualWeightPct]
  );

  useEffect(() => {
    if (selectedSymbol) {
      onSymbolChange?.(selectedSymbol);
      void loadDossier(selectedSymbol);
    }
  }, [selectedSymbol, loadDossier, onSymbolChange]);

  const handleRunDeepDive = async (force = false) => {
    if (!selectedSymbol) return;
    setDeepDiving(true);
    setDeepDiveError(null);
    try {
      const res = await fetch('/api/valuation/annual-deep-dive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, force }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `Annual report deep-dive failed (${res.status})`);
      }
      const deep = body as AnnualReportAiDeepDive;
      setDossier((prev) => (prev && prev.summary.symbol === deep.symbol ? { ...prev, aiDeepDive: deep } : prev));
    } catch (err) {
      setDeepDiveError(err instanceof Error ? err.message : 'Annual report deep-dive failed');
    } finally {
      setDeepDiving(false);
    }
  };

  const filteredCandidates = useMemo(() => {
    if (!universe) return [];
    const q = searchQuery.trim().toLowerCase();
    return universe.candidates.filter((c) => {
      if (candidateFilter === 'annual_only' && !c.hasAnnualReport) return false;
      if (candidateFilter === 'undervalued' && (c.marginOfSafetyPct ?? -999) < 8) return false;
      if (
        candidateFilter === 'core' &&
        c.convictionTier !== 'Core Long-Term Allocation' &&
        c.convictionTier !== 'Opportunistic Value Allocation'
      ) {
        return false;
      }
      if (!q) return true;
      return (
        c.symbol.toLowerCase().includes(q) ||
        c.companyName.toLowerCase().includes(q) ||
        c.sector.toLowerCase().includes(q)
      );
    });
  }, [universe, searchQuery, candidateFilter]);

  // Live Interactive Sandbox Math
  const sandbox = useMemo(() => {
    if (!dossier) return null;
    const km = dossier.summary.keyMetrics;
    const eps = km.eps;
    const bvps = km.bvps;
    const roe = km.roePct;
    const baseFair = dossier.compositeFairValue;
    const keDec = simKe / 100;
    const gDec = Math.min(keDec - 0.02, simGrowth / 100);

    const estimates: number[] = [];
    if (bvps !== null && bvps > 0 && roe !== null && roe > 0) {
      const jPb = Math.max(0.45, Math.min(4.5, (roe / 100 - gDec) / Math.max(0.025, keDec - gDec)));
      estimates.push(bvps * jPb);
    }
    if (eps !== null && eps > 0) {
      const rateScale = Math.max(0.55, Math.min(1.05, 5.5 / Math.max(4.0, dossier.benchmarkFdRatePct)));
      estimates.push(eps * (8.5 + 1.5 * simGrowth) * rateScale * (12.0 / simKe));
      estimates.push(eps / Math.max(0.05, keDec - gDec * 0.45));
    }

    const simFairValue =
      estimates.length > 0
        ? Math.round((estimates.reduce((a, b) => a + b, 0) / estimates.length) * 10) / 10
        : baseFair;

    const simMos =
      simFairValue && simFairValue > 0 && simPrice > 0
        ? ((simFairValue - simPrice) / simFairValue) * 100
        : null;
    const simPe = eps && eps > 0 && simPrice > 0 ? simPrice / eps : null;
    const simPb = bvps && bvps > 0 && simPrice > 0 ? simPrice / bvps : null;
    const simEy = simPe && simPe > 0 ? 100 / simPe : null;
    const simFdSpread = simEy !== null ? simEy - dossier.benchmarkFdRatePct : null;
    return {
      simFairValue,
      simMos,
      simPe,
      simPb,
      simEy,
      simFdSpread,
      buy15: simFairValue ? Math.round(simFairValue * 0.85) : null,
      buy25: simFairValue ? Math.round(simFairValue * 0.75) : null,
    };
  }, [dossier, simPrice, simKe, simGrowth]);

  if (loadingUniverse && !universe) {
    return (
      <div className="space-y-4">
        <div className="h-16 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-44 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-80 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {onSelectFundamentalMenu && (
        <FundamentalMenuBar
          active="valuation"
          activeSymbol={selectedSymbol || null}
          onSelect={onSelectFundamentalMenu}
        />
      )}

      {/* Header & Weighting Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Company Pricing &amp; Annual Report Valuation Lab
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Multi-model intrinsic pricing · 70% Annual / 30% Quarterly forensics · 5Y Future Worth · Company SWOT &amp; Allocation Verdict
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Report Weight:
          </span>
          <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-[11px]">
            {[
              { pct: 70, label: '70% Annual / 30% Qtr' },
              { pct: 100, label: '100% Annual' },
              { pct: 50, label: '50 / 50' },
              { pct: 0, label: 'Latest Qtr' },
            ].map((w) => (
              <button
                key={w.pct}
                type="button"
                onClick={() => setAnnualWeightPct(w.pct)}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                  annualWeightPct === w.pct
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-lg p-4 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Universe Strip + Company Picker */}
      {universe && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Valued Companies</div>
              <div className="text-base font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {universe.totalEvaluated}
              </div>
            </div>
            <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Annual / Q4 Verified
              </div>
              <div className="text-base font-mono font-bold text-blue-600 dark:text-blue-400 tabular-nums mt-0.5">
                {universe.withAnnualReports}
              </div>
            </div>
            <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Undervalued (MoS ≥ 8%)
              </div>
              <div className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                {universe.undervaluedCount}
              </div>
            </div>
            <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Core Long-Term Worth
              </div>
              <div className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                {universe.coreAllocationCount}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter symbol, company, sector…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 max-w-sm"
              >
                {filteredCandidates.map((c: ValuationUniverseCandidate) => (
                  <option key={c.symbol} value={c.symbol}>
                    {c.symbol} · {c.ltp ? `Rs ${c.ltp.toFixed(0)}` : 'No LTP'} → Fair{' '}
                    {c.compositeFairValue ? `Rs ${c.compositeFairValue.toFixed(0)}` : '—'} (
                    {c.marginOfSafetyPct !== null
                      ? `${c.marginOfSafetyPct >= 0 ? '+' : ''}${c.marginOfSafetyPct.toFixed(0)}%`
                      : '—'}
                    ) · Health {c.valuationHealthScore.toFixed(0)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {[
                { id: 'all', label: 'All Ranked' },
                { id: 'annual_only', label: `Annual / Q4 Verified (${universe.withAnnualReports})` },
                { id: 'undervalued', label: `Undervalued (${universe.undervaluedCount})` },
                { id: 'core', label: 'Worth Investing' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() =>
                    setCandidateFilter(f.id as 'all' | 'annual_only' | 'undervalued' | 'core')
                  }
                  className={`px-2.5 py-1 rounded border font-medium whitespace-nowrap ${
                    candidateFilter === f.id
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Top Opportunity Chips */}
          {filteredCandidates.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {filteredCandidates.slice(0, 12).map((c) => {
                const active = c.symbol === selectedSymbol;
                return (
                  <button
                    key={c.symbol}
                    type="button"
                    onClick={() => setSelectedSymbol(c.symbol)}
                    className={`shrink-0 px-2.5 py-1.5 rounded border text-left transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-mono">
                      <span className="font-bold text-slate-900 dark:text-slate-100">{c.symbol}</span>
                      {c.hasAnnualReport && (
                        <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400">
                          ANNUAL
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {c.marginOfSafetyPct !== null ? (
                        <span
                          className={
                            c.marginOfSafetyPct >= 8
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : c.marginOfSafetyPct < -12
                                ? 'text-amber-600 dark:text-amber-400'
                                : ''
                          }
                        >
                          MoS {c.marginOfSafetyPct >= 0 ? '+' : ''}
                          {c.marginOfSafetyPct.toFixed(0)}%
                        </span>
                      ) : (
                        'MoS —'
                      )}{' '}
                      · H:{c.valuationHealthScore.toFixed(0)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main Selected Company Valuation Dossier */}
      {loadingDossier && !dossier ? (
        <div className="space-y-4">
          <div className="h-44 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-72 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        </div>
      ) : dossier ? (
        <div className="space-y-5">
          {/* Company Header & Deep-Dive Trigger Bar */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {dossier.summary.symbol}
                  </h3>
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {dossier.summary.companyName}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${verdictTone(
                      dossier.pricingVerdict
                    )}`}
                  >
                    {dossier.pricingVerdict}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${convictionTone(
                      dossier.swot.futureWorthVerdict.convictionTier
                    )}`}
                  >
                    {dossier.swot.futureWorthVerdict.convictionTier}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {dossier.summary.sector} ({dossier.summary.sectorGroup} Rules) ·{' '}
                  {dossier.forensics.hasAnnualReport
                    ? `Weighted ${dossier.annualWeightPct}% Annual (${dossier.forensics.annualPeriodLabel}) + ${100 - dossier.annualWeightPct}% Interim (${dossier.forensics.interimPeriodLabel ?? 'None'})`
                    : `Interim Basis (${dossier.forensics.interimPeriodLabel ?? dossier.summary.latestPeriod.periodLabel}) · No Annual/Q4 stored yet`}
                  {dossier.forensics.capitalStructure.creditRatingLabel
                    ? ` · Rating: ${dossier.forensics.capitalStructure.creditRatingLabel}`
                    : ''}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={deepDiving}
                  onClick={() => void handleRunDeepDive(Boolean(dossier.aiDeepDive))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap"
                >
                  {deepDiving ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileSearch className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {deepDiving
                      ? 'Digging Annual Reports…'
                      : dossier.aiDeepDive
                        ? 'Refresh Annual Report Deep-Dive'
                        : 'Dig Deeper into Annual Reports (Live Search)'}
                  </span>
                </button>

                {onInspectInScreener && (
                  <button
                    type="button"
                    onClick={() => onInspectInScreener(dossier.summary.symbol)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>9-Investor Dossier</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onInspectSymbol(dossier.summary.symbol)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <CandlestickChart className="w-3.5 h-3.5" />
                  <span>Chart</span>
                </button>

                <button
                  type="button"
                  onClick={() => onInspectInAnalyzer(dossier.summary.symbol)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>Analyzer</span>
                </button>
              </div>
            </div>

            {deepDiveError && (
              <div className="px-3.5 py-2.5 rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
                {deepDiveError}
              </div>
            )}

            {dossier.summary.keyMetrics.earningsQuality?.hasNonOperatingCaution && (
              <div className="border border-amber-300 dark:border-amber-800 rounded-lg bg-amber-50/75 dark:bg-amber-950/30 p-3 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      {dossier.summary.keyMetrics.earningsQuality.cautionTitle ??
                        'Non-Operating Earnings Caution · Anchored on Operating Profit'}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-amber-800 dark:text-amber-300 tabular-nums">
                    Op. Profit:{' '}
                    {dossier.summary.keyMetrics.operatingProfitCr !== null
                      ? `Rs ${dossier.summary.keyMetrics.operatingProfitCr.toFixed(1)} Cr`
                      : '—'}{' '}
                    · Op. YoY:{' '}
                    {dossier.summary.keyMetrics.operatingProfitYoyPct !== null
                      ? `${dossier.summary.keyMetrics.operatingProfitYoyPct >= 0 ? '+' : ''}${dossier.summary.keyMetrics.operatingProfitYoyPct.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
                {dossier.summary.keyMetrics.earningsQuality.cautionMessage && (
                  <p className="text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
                    {dossier.summary.keyMetrics.earningsQuality.cautionMessage}
                  </p>
                )}
              </div>
            )}

            {/* 4 Key Pricing Metrics + Target Price Zone Ruler */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 pt-1">
              <div className="xl:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 bg-slate-50/70 dark:bg-slate-950/60">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Market LTP</div>
                  <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                    {fmtRs(dossier.summary.market.ltp, 1)}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    P/E {fmtNum(dossier.summary.keyMetrics.pe, 1, 'x')} · P/B{' '}
                    {fmtNum(dossier.summary.keyMetrics.pb, 2, 'x')}
                  </div>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 bg-slate-50/70 dark:bg-slate-950/60">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Composite Fair Value
                  </div>
                  <div className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 tabular-nums mt-0.5">
                    {fmtRs(dossier.compositeFairValue, 1)}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    Range: {dossier.swot.futureWorthVerdict.fairValueRangeLabel}
                  </div>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 bg-slate-50/70 dark:bg-slate-950/60">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Margin of Safety
                  </div>
                  <div
                    className={`text-lg font-mono font-bold tabular-nums mt-0.5 ${
                      (dossier.marginOfSafetyPct ?? -999) >= 10
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : (dossier.marginOfSafetyPct ?? 0) < -10
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {fmtSigned(dossier.marginOfSafetyPct, 1, '%')}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    Buy Zone: {dossier.swot.futureWorthVerdict.idealEntryZoneLabel}
                  </div>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 bg-slate-50/70 dark:bg-slate-950/60">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Worth Investing Score
                  </div>
                  <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                    {dossier.swot.futureWorthVerdict.considerableInvestmentScore.toFixed(1)}
                    <span className="text-xs font-normal text-slate-400"> /100</span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    FD Spread: {fmtSigned(dossier.swot.futureWorthVerdict.opportunityCostVsFdSpreadPct, 2, '%')}
                  </div>
                </div>
              </div>

              {/* Actionable Entry & Pricing Zones Ladder */}
              <div className="xl:col-span-5 border border-slate-200 dark:border-slate-800 rounded-md p-3 bg-slate-50/70 dark:bg-slate-950/60 flex flex-col justify-between space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Actionable Pricing &amp; Entry Zones
                  </span>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    LTP {fmtRs(dossier.summary.market.ltp, 0)}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
                  <div className="border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/60 dark:bg-emerald-950/20 rounded p-1.5">
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                      Deep Value
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      {fmtRs(dossier.entryZones.deepValuePrice, 0)}
                    </div>
                    <div className="text-[9px] text-slate-400">25% MoS</div>
                  </div>
                  <div className="border border-blue-200 dark:border-blue-900/70 bg-blue-50/60 dark:bg-blue-950/20 rounded p-1.5">
                    <div className="text-[10px] text-blue-700 dark:text-blue-400">
                      Buy Zone
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      {fmtRs(dossier.entryZones.buyZonePrice, 0)}
                    </div>
                    <div className="text-[9px] text-slate-400">15% MoS</div>
                  </div>
                  <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded p-1.5">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      Fair Value
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      {fmtRs(dossier.entryZones.fairValuePrice, 0)}
                    </div>
                    <div className="text-[9px] text-slate-400">Intrinsic</div>
                  </div>
                  <div className="border border-amber-200 dark:border-amber-900/70 bg-amber-50/60 dark:bg-amber-950/20 rounded p-1.5">
                    <div className="text-[10px] text-amber-700 dark:text-amber-400">
                      Trim Zone
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      {fmtRs(dossier.entryZones.trimZonePrice, 0)}
                    </div>
                    <div className="text-[9px] text-slate-400">+20% Rich</div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                  {dossier.swot.futureWorthVerdict.rationale}
                </p>
              </div>
            </div>
          </div>

          {/* Consolidated Valuation Health Score (Weighted Safety + Growth + Cushion) */}
          <ValuationHealthScoreCard
            symbol={dossier.summary.symbol}
            health={dossier.valuationHealthScore}
            industryAverages={dossier.annualReportDissector.industryAverages}
          />

          {/* Annual Report Dissector & Industry Peer Comparison */}
          <AnnualReportDissectorPanel
            symbol={dossier.summary.symbol}
            dissector={dossier.annualReportDissector}
            onSelectSymbol={(sym) => setSelectedSymbol(sym)}
          />

          {/* Live Search-Grounded Annual Report Deep-Dive Box (when triggered or cached) */}
          {dossier.aiDeepDive && (
            <div className="border border-blue-200 dark:border-blue-900 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Live Annual Report &amp; AGM Forensic Deep-Dive ({dossier.aiDeepDive.annualReportYear ?? 'Latest Audited Filings'})
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      Model: {dossier.aiDeepDive.model} · Generated {dossier.aiDeepDive.generatedAt.slice(0, 10)}
                      {dossier.aiDeepDive.cached ? ' · Disk Cached' : ' · Fresh Grounded Search'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                <div className="space-y-2">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    Executive Annual Report Synthesis
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    {dossier.aiDeepDive.executiveSummary}
                  </p>
                  <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-1">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      Future Worth &amp; Capital Allocation Verdict
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">
                      {dossier.aiDeepDive.futureWorthOutlook}
                    </p>
                    <p className="font-medium text-blue-700 dark:text-blue-300">
                      {dossier.aiDeepDive.considerableInvestmentVerdict}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5 space-y-1.5">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      Management Guidance &amp; Catalysts
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                      {dossier.aiDeepDive.managementGuidanceAndCatalysts.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5 space-y-1.5">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      Bonus / Dividend &amp; Auditor Notes
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                      {dossier.aiDeepDive.dividendAndBonusHistory.map((item, i) => (
                        <li key={`div-${i}`}>{item}</li>
                      ))}
                      {dossier.aiDeepDive.auditorAndGovernanceFindings.map((item, i) => (
                        <li key={`aud-${i}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {dossier.aiDeepDive.citations.length > 0 && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">
                    Grounded Annual &amp; Regulatory Sources:
                  </span>
                  {dossier.aiDeepDive.citations.map((c, idx) => (
                    <a
                      key={idx}
                      href={c.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="truncate max-w-[200px]">{c.title}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Row 2: Multi-Model Pricing Table + Interactive Pricing Sandbox & Sensitivity Matrix */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* 6 Valuation Models Breakdown */}
            <div className="xl:col-span-7 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Multi-Model Intrinsic Valuation &amp; Pricing Matrix
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Weighted blend across 6 sector-adjusted models anchored to {dossier.annualWeightPct}% Annual reports
                    </p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="px-3 py-2 text-left font-medium">Valuation Model</th>
                      <th className="px-3 py-2 text-right font-medium">Weight</th>
                      <th className="px-3 py-2 text-right font-medium">Fair Price</th>
                      <th className="px-3 py-2 text-right font-medium">vs LTP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {dossier.models.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="px-3 py-2.5 align-top">
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {m.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            {m.formula}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {m.note}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 align-top">
                          {m.weightPct}%
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 align-top whitespace-nowrap">
                          {m.available ? fmtRs(m.price, 1) : 'N/A'}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums align-top whitespace-nowrap ${
                            m.upsidePct !== null && m.upsidePct >= 10
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : m.upsidePct !== null && m.upsidePct < -10
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {fmtSigned(m.upsidePct, 1, '%')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Interactive What-If Pricing & 5x5 Sensitivity Grid */}
            <div className="xl:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Interactive Pricing Sandbox &amp; Sensitivity Grid
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSimPrice(
                      Math.round(dossier.summary.market.ltp ?? dossier.compositeFairValue ?? 400)
                    );
                    setSimKe(12.0);
                    setSimGrowth(8);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>

              {sandbox && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-600 dark:text-slate-300">Target Buy Price</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        Rs {simPrice.toFixed(0)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={Math.max(20, Math.round((dossier.summary.market.ltp ?? 400) * 0.45))}
                      max={Math.max(100, Math.round((dossier.summary.market.ltp ?? 400) * 1.65))}
                      value={simPrice}
                      onChange={(e) => setSimPrice(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-600 dark:text-slate-300">Hurdle (ke)</span>
                        <span className="font-mono font-semibold">{simKe.toFixed(1)}%</span>
                      </div>
                      <input
                        type="range"
                        min={8.5}
                        max={17.5}
                        step={0.5}
                        value={simKe}
                        onChange={(e) => setSimKe(Number(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-600 dark:text-slate-300">Growth (g)</span>
                        <span className="font-mono font-semibold">{simGrowth.toFixed(0)}%</span>
                      </div>
                      <input
                        type="range"
                        min={2}
                        max={16}
                        step={1}
                        value={simGrowth}
                        onChange={(e) => setSimGrowth(Number(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                    <div className="border border-slate-200 dark:border-slate-800 rounded p-2">
                      <div className="text-[10px] font-sans text-slate-500">Sim Fair Value</div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {fmtRs(sandbox.simFairValue, 0)}
                      </div>
                    </div>
                    <div className="border border-slate-200 dark:border-slate-800 rounded p-2">
                      <div className="text-[10px] font-sans text-slate-500">Sim MoS %</div>
                      <div
                        className={`font-bold ${
                          (sandbox.simMos ?? -99) >= 15
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : (sandbox.simMos ?? 0) < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {fmtSigned(sandbox.simMos, 1, '%')}
                      </div>
                    </div>
                    <div className="border border-slate-200 dark:border-slate-800 rounded p-2">
                      <div className="text-[10px] font-sans text-slate-500">At Price P/E · Yield</div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {fmtNum(sandbox.simPe, 1, 'x')} · {fmtNum(sandbox.simEy, 1, '%')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 5x5 Sensitivity Grid */}
              <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Discount Rate (ke) × Growth (g) Fair Value Matrix (Rs)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono tabular-nums border-collapse">
                    <thead>
                      <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                        <th className="py-1 px-1.5 text-left">ke \ g</th>
                        {dossier.sensitivityGrid.growthValues.map((g) => (
                          <th key={g} className="py-1 px-1.5 text-right">
                            {g}%
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {dossier.sensitivityGrid.cells.map((rowCells, rIdx) => (
                        <tr key={rIdx}>
                          <td className="py-1 px-1.5 font-semibold text-slate-600 dark:text-slate-300">
                            {dossier.sensitivityGrid.keValues[rIdx].toFixed(1)}%
                          </td>
                          {rowCells.map((cell) => {
                            const mos = cell.mosPct;
                            const cellColor =
                              mos !== null && mos >= 15
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold'
                                : mos !== null && mos >= 0
                                  ? 'bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                                  : mos !== null && mos < -15
                                    ? 'text-slate-400 dark:text-slate-500'
                                    : 'text-slate-700 dark:text-slate-300';
                            return (
                              <td
                                key={`${cell.kePct}-${cell.growthPct}`}
                                title={
                                  cell.mosPct !== null
                                    ? `MoS: ${cell.mosPct >= 0 ? '+' : ''}${cell.mosPct.toFixed(1)}% vs LTP`
                                    : ''
                                }
                                className={`py-1 px-1.5 text-right rounded-sm ${cellColor}`}
                              >
                                {cell.fairValue !== null ? cell.fairValue.toFixed(0) : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: 1Y · 3Y · 5Y Future Worth Projections */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Future Worth Trajectory (1-Year · 3-Year · 5-Year Bear / Base / Bull Pricing)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Forward share value &amp; implied CAGR from current market LTP based on compounding ROE &amp; multiple scenarios
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {dossier.scenarios.map((sc) => (
                <div
                  key={sc.horizon}
                  className="border border-slate-200 dark:border-slate-800 rounded-md p-3 bg-slate-50/60 dark:bg-slate-950/60 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-mono text-slate-900 dark:text-slate-100">
                      {sc.horizon} Horizon
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      vs LTP {fmtRs(dossier.summary.market.ltp, 0)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                    <div>
                      <div className="text-[10px] font-sans text-slate-500">Bear</div>
                      <div className="font-semibold text-amber-700 dark:text-amber-400">
                        {fmtRs(sc.bearPrice, 0)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {fmtSigned(sc.bearCagrPct, 1, '%/yr')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans text-slate-500">Base</div>
                      <div className="font-bold text-blue-600 dark:text-blue-400">
                        {fmtRs(sc.basePrice, 0)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {fmtSigned(sc.baseCagrPct, 1, '%/yr')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-sans text-slate-500">Bull</div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">
                        {fmtRs(sc.bullPrice, 0)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {fmtSigned(sc.bullCagrPct, 1, '%/yr')}
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                    {sc.assumptions}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Row 4: Annual Report Forensics & Capital Structure + Historical Ledger */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Annual Report (70%) vs Interim (30%) Forensics &amp; Capital Cushion
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {dossier.forensics.annualVsInterimDivergence.flag} ·{' '}
                    {dossier.forensics.capitalStructure.dividendBonusCapacityRating}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums border border-slate-100 dark:border-slate-800 rounded p-2.5 bg-slate-50/60 dark:bg-slate-950/60">
                <div className="font-sans text-[11px] font-medium text-slate-500">Metric</div>
                <div className="text-right text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                  Annual ({dossier.annualWeightPct}%)
                </div>
                <div className="text-right text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Interim ({100 - dossier.annualWeightPct}%)
                </div>

                <div className="font-sans text-slate-600 dark:text-slate-300">Period</div>
                <div className="text-right text-[11px]">
                  {dossier.forensics.annualPeriodLabel ?? 'None'}
                </div>
                <div className="text-right text-[11px]">
                  {dossier.forensics.interimPeriodLabel ?? 'None'}
                </div>

                <div className="font-sans text-slate-600 dark:text-slate-300">EPS</div>
                <div className="text-right">{fmtNum(dossier.forensics.annualEps, 2)}</div>
                <div className="text-right">{fmtNum(dossier.forensics.interimEps, 2)}</div>

                <div className="font-sans text-slate-600 dark:text-slate-300">ROE %</div>
                <div className="text-right">{fmtNum(dossier.forensics.annualRoePct, 1, '%')}</div>
                <div className="text-right">{fmtNum(dossier.forensics.interimRoePct, 1, '%')}</div>

                <div className="font-sans text-slate-600 dark:text-slate-300">BVPS</div>
                <div className="text-right">{fmtNum(dossier.forensics.annualBvps, 1)}</div>
                <div className="text-right">{fmtNum(dossier.forensics.interimBvps, 1)}</div>
              </div>

              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                {dossier.forensics.annualVsInterimDivergence.explanation}
              </p>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums pt-1">
                <div className="border border-slate-100 dark:border-slate-800 rounded p-2">
                  <div className="text-[10px] font-sans text-slate-500">Paid-Up Capital</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {dossier.forensics.capitalStructure.shareCapitalCr !== null
                      ? `Rs ${dossier.forensics.capitalStructure.shareCapitalCr.toFixed(1)} Cr`
                      : '—'}
                  </div>
                </div>
                <div className="border border-slate-100 dark:border-slate-800 rounded p-2">
                  <div className="text-[10px] font-sans text-slate-500">Reserves + Retained</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {dossier.forensics.capitalStructure.reservesCr !== null
                      ? `Rs ${(
                          dossier.forensics.capitalStructure.reservesCr +
                          (dossier.forensics.capitalStructure.retainedEarningsCr ?? 0)
                        ).toFixed(1)} Cr`
                      : '—'}
                  </div>
                </div>
                <div className="border border-slate-100 dark:border-slate-800 rounded p-2">
                  <div className="text-[10px] font-sans text-slate-500">Reserve / Capital</div>
                  <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {fmtNum(dossier.forensics.capitalStructure.reserveToCapitalRatio, 2, 'x')}
                  </div>
                </div>
                <div className="border border-slate-100 dark:border-slate-800 rounded p-2">
                  <div className="text-[10px] font-sans text-slate-500">OCF / Net Profit</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {fmtNum(dossier.forensics.capitalStructure.netProfitToOcfPct, 0, '%')}
                  </div>
                </div>
              </div>
            </div>

            {/* Historical Annual & Quarterly Statements Table */}
            <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Indexed Annual &amp; Quarterly Statement Trajectory ({dossier.forensics.historicalPeriods.length} Periods)
                  </h4>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[340px]">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Period</th>
                      <th className="px-3 py-2 text-right font-medium">EPS</th>
                      <th className="px-3 py-2 text-right font-medium">ROE %</th>
                      <th className="px-3 py-2 text-right font-medium">BVPS</th>
                      <th className="px-3 py-2 text-right font-medium">Revenue (Cr)</th>
                      <th className="px-3 py-2 text-right font-medium">Profit (Cr)</th>
                      <th className="px-3 py-2 text-right font-medium">NPL / D:E</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                    {dossier.forensics.historicalPeriods.map((p) => (
                      <tr
                        key={p.periodLabel}
                        className={
                          p.isAnnual
                            ? 'bg-blue-50/40 dark:bg-blue-950/20'
                            : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/30'
                        }
                      >
                        <td className="px-3 py-2 font-sans whitespace-nowrap">
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {p.periodLabel}
                          </span>
                          {p.isAnnual && (
                            <span className="ml-1.5 text-[10px] font-mono font-semibold text-blue-600 dark:text-blue-400">
                              ANNUAL
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtNum(p.eps, 2)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(p.roePct, 1, '%')}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(p.bvps, 1)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(p.revenueCr, 1)}</td>
                        <td className="px-3 py-2 text-right">{fmtNum(p.netProfitCr, 1)}</td>
                        <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">
                          {p.nplPct !== null
                            ? `${p.nplPct.toFixed(2)}%`
                            : p.debtToEquity !== null
                              ? `${p.debtToEquity.toFixed(2)}x`
                              : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Row 5: Company SWOT (Strengths, Weaknesses, Opportunities, Risks) & Worth Investing Synthesis */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Company Strengths, Weaknesses, Opportunities &amp; Risks (SWOT + Future Worth)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {dossier.swot.futureWorthVerdict.headline}
                  </p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 text-[11px] font-semibold rounded border ${convictionTone(
                  dossier.swot.futureWorthVerdict.convictionTier
                )}`}
              >
                {dossier.swot.futureWorthVerdict.convictionTier} (
                {dossier.swot.futureWorthVerdict.considerableInvestmentScore.toFixed(0)}/100)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="border border-emerald-200 dark:border-emerald-900/70 rounded-md p-3 bg-emerald-50/30 dark:bg-emerald-950/15 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Strengths</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                  {dossier.swot.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                  {dossier.aiDeepDive?.annualReportStrengths.map((s, i) => (
                    <li key={`ai-s-${i}`} className="text-emerald-800 dark:text-emerald-200">
                      [Annual Search] {s}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-amber-200 dark:border-amber-900/70 rounded-md p-3 bg-amber-50/30 dark:bg-amber-950/15 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Weaknesses</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                  {dossier.swot.weaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {dossier.aiDeepDive?.annualReportWeaknesses.map((w, i) => (
                    <li key={`ai-w-${i}`} className="text-amber-800 dark:text-amber-200">
                      [Annual Search] {w}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-blue-200 dark:border-blue-900/70 rounded-md p-3 bg-blue-50/30 dark:bg-blue-950/15 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-300">
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Opportunities &amp; Future Catalysts</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                  {dossier.swot.opportunities.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                  {dossier.aiDeepDive?.annualReportOpportunities.map((o, i) => (
                    <li key={`ai-o-${i}`} className="text-blue-800 dark:text-blue-200">
                      [Annual Search] {o}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-red-200 dark:border-red-900/70 rounded-md p-3 bg-red-50/30 dark:bg-red-950/15 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-300">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Risks &amp; Downside Watchouts</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                  {dossier.swot.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                  {dossier.aiDeepDive?.annualReportRisks.map((r, i) => (
                    <li key={`ai-r-${i}`} className="text-red-800 dark:text-red-200">
                      [Annual Search] {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
