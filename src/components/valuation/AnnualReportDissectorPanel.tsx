import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Building2, CheckCircle2, FileSpreadsheet, Minus, TrendingDown } from 'lucide-react';
import type {
  AnnualDissectorMetricRow,
  AnnualDissectorPeerRow,
  AnnualDissectorSection,
  AnnualReportDissector,
} from '../../types/fundamental';

interface AnnualReportDissectorPanelProps {
  symbol: string;
  dissector: AnnualReportDissector;
  onSelectSymbol: (symbol: string) => void;
}

type PeerSortField =
  | 'healthScore'
  | 'safetyScore'
  | 'growthScore'
  | 'roePct'
  | 'pe'
  | 'pb'
  | 'reserveToCapitalRatio'
  | 'marginOfSafetyPct';

function fmtUnit(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const digits = unit === 'x' ? 2 : unit === 'Rs' ? 1 : 1;
  if (unit === 'Rs') return `Rs ${v.toFixed(digits)}`;
  return `${v.toFixed(digits)}${unit}`;
}

function fmtDelta(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const digits = unit === 'x' ? 2 : unit === 'Rs' ? 1 : 1;
  const sign = v >= 0 ? '+' : '';
  if (unit === 'Rs') return `${sign}${v.toFixed(digits)}`;
  return `${sign}${v.toFixed(digits)}${unit}`;
}

function verdictStyle(verdict: AnnualDissectorMetricRow['verdict']): {
  badge: string;
  text: string;
  bar: string;
} {
  switch (verdict) {
    case 'Outperforming':
      return {
        badge:
          'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
        text: 'text-emerald-600 dark:text-emerald-400',
        bar: 'bg-emerald-600 dark:bg-emerald-500',
      };
    case 'In Line':
      return {
        badge:
          'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300',
        text: 'text-blue-600 dark:text-blue-400',
        bar: 'bg-blue-600 dark:bg-blue-500',
      };
    case 'Lagging':
      return {
        badge:
          'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
        text: 'text-amber-600 dark:text-amber-400',
        bar: 'bg-amber-600 dark:bg-amber-500',
      };
    default:
      return {
        badge:
          'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
        text: 'text-slate-400',
        bar: 'bg-slate-400',
      };
  }
}

function healthBandBadge(band: AnnualDissectorPeerRow['healthBand']): string {
  switch (band) {
    case 'Fortress Value':
      return 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300';
    case 'Healthy Compounder':
      return 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300';
    case 'Balanced / Watch':
      return 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300';
    default:
      return 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300';
  }
}

export const AnnualReportDissectorPanel: React.FC<AnnualReportDissectorPanelProps> = ({
  symbol,
  dissector,
  onSelectSymbol,
}) => {
  const [activeTab, setActiveTab] = useState<'dissector' | 'peers'>('dissector');
  const [sectionFilter, setSectionFilter] = useState<'all' | AnnualDissectorSection['id']>('all');
  const [sortField, setSortField] = useState<PeerSortField>('healthScore');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const ind = dissector.industryAverages;
  const isFinancialBfi =
    dissector.sectorGroup === 'Banking' || dissector.sectorGroup === 'Microfinance';

  const visibleSections = useMemo(() => {
    if (sectionFilter === 'all') return dissector.sections;
    return dissector.sections.filter((s) => s.id === sectionFilter);
  }, [dissector.sections, sectionFilter]);

  const sortedPeers = useMemo(() => {
    const rows = [...dissector.peerMatrix];
    rows.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return sortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [dissector.peerMatrix, sortField, sortAsc]);

  const handleSort = (field: PeerSortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(field === 'pe' || field === 'pb');
    }
  };

  // Summary tally across dissected metrics
  const allMetrics = useMemo(
    () => dissector.sections.flatMap((s) => s.metrics),
    [dissector.sections]
  );
  const outperformingCount = allMetrics.filter((m) => m.verdict === 'Outperforming').length;
  const inLineCount = allMetrics.filter((m) => m.verdict === 'In Line').length;
  const laggingCount = allMetrics.filter((m) => m.verdict === 'Lagging').length;

  return (
    <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      {/* Top Bar */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Annual Report Dissector &amp; Industry Peer Benchmark
            </h4>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              {dissector.scopeLabel}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Rank{' '}
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
              #{dissector.companyRankByHealth ?? '—'} of {dissector.peerCount}
            </span>{' '}
            by Valuation Health · {dissector.annualVerifiedPeerCount} peers with audited Annual/Q4
            ledgers ·{' '}
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              {outperformingCount} outperforming
            </span>
            , {inLineCount} in line,{' '}
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              {laggingCount} lagging
            </span>{' '}
            industry avg
          </p>
        </div>

        <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5 text-[11px] shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('dissector')}
            className={`px-3 py-1 rounded font-medium whitespace-nowrap transition-colors ${
              activeTab === 'dissector'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Report Dissector vs Industry Avg
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('peers')}
            className={`px-3 py-1 rounded font-medium whitespace-nowrap transition-colors ${
              activeTab === 'peers'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Peer Comparison Matrix ({dissector.peerMatrix.length})
          </button>
        </div>
      </div>

      {/* Industry Average Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 text-xs">
        <div className="px-3.5 py-2.5">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Ind Avg Health</div>
          <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {ind.healthScore !== null ? `${ind.healthScore.toFixed(1)}/100` : '—'}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            Safety {ind.safetyScore?.toFixed(0) ?? '—'} · Growth {ind.growthScore?.toFixed(0) ?? '—'}
          </div>
        </div>
        <div className="px-3.5 py-2.5">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Ind Avg ROE / Margin</div>
          <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {ind.roePct !== null ? `${ind.roePct.toFixed(1)}%` : '—'}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            Margin {ind.netMarginPct !== null ? `${ind.netMarginPct.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="px-3.5 py-2.5">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Ind Avg Reserve/Cap</div>
          <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {ind.reserveToCapitalRatio !== null ? `${ind.reserveToCapitalRatio.toFixed(2)}x` : '—'}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            BVPS {ind.bvps !== null ? `Rs ${ind.bvps.toFixed(0)}` : '—'}
          </div>
        </div>
        <div className="px-3.5 py-2.5">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Ind Avg P/E &amp; P/B</div>
          <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {ind.pe !== null ? `${ind.pe.toFixed(1)}x` : '—'} ·{' '}
            {ind.pb !== null ? `${ind.pb.toFixed(2)}x` : '—'}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            Yield {ind.earningsYieldPct !== null ? `${ind.earningsYieldPct.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="px-3.5 py-2.5">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">Ind Avg EPS Growth</div>
          <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {ind.epsGrowthPct !== null
              ? `${ind.epsGrowthPct >= 0 ? '+' : ''}${ind.epsGrowthPct.toFixed(1)}%`
              : '—'}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            Rev {ind.revenueGrowthPct !== null ? `${ind.revenueGrowthPct >= 0 ? '+' : ''}${ind.revenueGrowthPct.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="px-3.5 py-2.5">
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {isFinancialBfi ? 'Ind Avg NPL / CAR' : 'Ind Avg D/E & MoS'}
          </div>
          <div className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
            {isFinancialBfi
              ? `${ind.nplPct !== null ? `${ind.nplPct.toFixed(2)}%` : '—'} · ${ind.carPct !== null ? `${ind.carPct.toFixed(1)}%` : '—'}`
              : `${ind.debtToEquity !== null ? `${ind.debtToEquity.toFixed(2)}x` : '—'} · ${ind.marginOfSafetyPct !== null ? `${ind.marginOfSafetyPct.toFixed(0)}%` : '—'}`}
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            MoS Avg {ind.marginOfSafetyPct !== null ? `${ind.marginOfSafetyPct.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {activeTab === 'dissector' ? (
        <div className="p-4 space-y-4">
          {/* Section Filter Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Line-item Annual Report vs Interim dissection benchmarked against{' '}
              <strong className="text-slate-700 dark:text-slate-200">{dissector.sector}</strong>{' '}
              averages, medians, and top quartile leaders
            </span>
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              {(
                [
                  { id: 'all', label: 'All Sections' },
                  { id: 'profitability', label: 'Profitability' },
                  { id: 'growth', label: 'Growth' },
                  { id: 'capital_solvency', label: 'Capital & Solvency' },
                  { id: 'valuation', label: 'Valuation Multiples' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSectionFilter(tab.id)}
                  className={`px-2.5 py-1 rounded border font-medium whitespace-nowrap ${
                    sectionFilter === tab.id
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {visibleSections.map((sec) => (
              <div
                key={sec.id}
                className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden"
              >
                <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h5 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {sec.title}
                    </h5>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{sec.subtitle}</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900">
                        <th className="px-3 py-2 text-left font-medium">Annual Report Metric</th>
                        <th className="px-3 py-2 text-right font-medium">
                          {symbol} ({dissector.annualWeightPct}% Wtd)
                        </th>
                        <th className="px-3 py-2 text-right font-medium">Annual Only</th>
                        <th className="px-3 py-2 text-right font-medium">Interim Qtr</th>
                        <th className="px-3 py-2 text-right font-medium">Industry Avg</th>
                        <th className="px-3 py-2 text-right font-medium">Top Quartile</th>
                        <th className="px-3 py-2 text-right font-medium">vs Ind Avg</th>
                        <th className="px-3 py-2 text-right font-medium">Percentile</th>
                        <th className="px-3 py-2 text-right font-medium">Standing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                      {sec.metrics.map((m) => {
                        const vs = verdictStyle(m.verdict);
                        return (
                          <tr key={m.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                            <td className="px-3 py-2 font-sans font-medium text-slate-900 dark:text-slate-100">
                              {m.label}
                              {!m.higherIsBetter && (
                                <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                                  (lower better)
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900 dark:text-slate-100">
                              {fmtUnit(m.companyValue, m.unit)}
                            </td>
                            <td className="px-3 py-2 text-right text-blue-600 dark:text-blue-400">
                              {fmtUnit(m.annualReportValue, m.unit)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">
                              {fmtUnit(m.interimValue, m.unit)}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">
                              {fmtUnit(m.industryAverage, m.unit)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400">
                              {fmtUnit(m.topQuartileValue, m.unit)}
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold ${vs.text}`}>
                              {fmtDelta(m.deltaVsIndustry, m.unit)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {m.percentileInIndustry !== null ? (
                                <div className="inline-flex items-center gap-1.5">
                                  <div className="w-12 h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                                    <div
                                      className={`h-full ${vs.bar}`}
                                      style={{ width: `${Math.max(5, m.percentileInIndustry)}%` }}
                                    />
                                  </div>
                                  <span className="text-[11px] text-slate-600 dark:text-slate-300 w-7 text-right">
                                    {m.percentileInIndustry.toFixed(0)}p
                                  </span>
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-sans">
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border whitespace-nowrap ${vs.badge}`}
                              >
                                {m.verdict === 'Outperforming' && (
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                )}
                                {m.verdict === 'In Line' && <Minus className="w-2.5 h-2.5" />}
                                {m.verdict === 'Lagging' && (
                                  <TrendingDown className="w-2.5 h-2.5" />
                                )}
                                <span>{m.verdict}</span>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Click any peer ticker to dissect its Annual Report &amp; Valuation Health Score.
                Pinned top row shows {dissector.sector} Industry Averages.
              </span>
            </span>
          </div>

          <div className="overflow-x-auto max-h-[420px] border border-slate-200 dark:border-slate-800 rounded-md">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Company</th>
                  <th className="px-3 py-2 text-right font-medium">LTP</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('healthScore')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Health</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('safetyScore')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Safety</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('growthScore')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Growth</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('roePct')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>ROE %</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('reserveToCapitalRatio')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Res/Cap</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('pe')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>P/E</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('pb')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>P/B</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {isFinancialBfi ? 'NPL %' : 'D / E'}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => handleSort('marginOfSafetyPct')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>MoS %</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                {/* Pinned Industry Average Row */}
                <tr className="bg-blue-50/50 dark:bg-blue-950/25 font-semibold border-b-2 border-blue-200 dark:border-blue-900">
                  <td className="px-3 py-2 font-sans text-blue-700 dark:text-blue-300">
                    Industry Average ({dissector.peerCount} peers)
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">—</td>
                  <td className="px-3 py-2 text-right text-blue-700 dark:text-blue-300">
                    {ind.healthScore !== null ? ind.healthScore.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                    {ind.safetyScore !== null ? ind.safetyScore.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                    {ind.growthScore !== null ? ind.growthScore.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                    {ind.roePct !== null ? `${ind.roePct.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                    {ind.reserveToCapitalRatio !== null
                      ? `${ind.reserveToCapitalRatio.toFixed(2)}x`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                    {ind.pe !== null ? `${ind.pe.toFixed(1)}x` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                    {ind.pb !== null ? `${ind.pb.toFixed(2)}x` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                    {isFinancialBfi
                      ? ind.nplPct !== null
                        ? `${ind.nplPct.toFixed(2)}%`
                        : '—'
                      : ind.debtToEquity !== null
                        ? `${ind.debtToEquity.toFixed(2)}x`
                        : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                    {ind.marginOfSafetyPct !== null
                      ? `${ind.marginOfSafetyPct >= 0 ? '+' : ''}${ind.marginOfSafetyPct.toFixed(1)}%`
                      : '—'}
                  </td>
                </tr>

                {sortedPeers.map((p) => (
                  <tr
                    key={p.symbol}
                    onClick={() => onSelectSymbol(p.symbol)}
                    className={`cursor-pointer transition-colors ${
                      p.isTarget
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="px-3 py-2 font-sans">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {p.symbol}
                        </span>
                        {p.isTarget && (
                          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                            Selected
                          </span>
                        )}
                        {p.hasAnnualReport && (
                          <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400">
                            Annual
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[180px]">
                        {p.companyName}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                      {p.ltp !== null ? `Rs ${p.ltp.toFixed(0)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`inline-block px-1.5 py-0.5 text-[11px] font-bold rounded border ${healthBandBadge(
                          p.healthBand
                        )}`}
                      >
                        {p.healthScore.toFixed(0)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                      {p.safetyScore.toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                      {p.growthScore.toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                      {p.roePct !== null ? `${p.roePct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                      {p.reserveToCapitalRatio !== null
                        ? `${p.reserveToCapitalRatio.toFixed(2)}x`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                      {p.pe !== null ? `${p.pe.toFixed(1)}x` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                      {p.pb !== null ? `${p.pb.toFixed(2)}x` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">
                      {isFinancialBfi
                        ? p.nplPct !== null
                          ? `${p.nplPct.toFixed(2)}%`
                          : '—'
                        : p.debtToEquity !== null
                          ? `${p.debtToEquity.toFixed(2)}x`
                          : '—'}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        (p.marginOfSafetyPct ?? -999) >= 10
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : (p.marginOfSafetyPct ?? 0) < -10
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {p.marginOfSafetyPct !== null
                        ? `${p.marginOfSafetyPct >= 0 ? '+' : ''}${p.marginOfSafetyPct.toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
