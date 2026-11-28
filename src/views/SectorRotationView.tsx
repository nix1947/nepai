import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Layers, RefreshCw } from 'lucide-react';
import type {
  SectorRotationPhase,
  SectorRotationResponse,
  SectorRotationRow,
} from '../types/fundamental';
import { formatNum, formatPct } from '../utils/format';

interface SectorRotationViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

type SortKey =
  | 'shareShift5vs20Pp'
  | 'share5dPct'
  | 'share1dPct'
  | 'return5dPct'
  | 'breadthPct'
  | 'avgRoePct'
  | 'avgMosPct';

const PHASE_FILTERS: Array<'All' | SectorRotationPhase> = [
  'All',
  'Leading Inflow',
  'Improving Accumulation',
  'Weakening Distribution',
  'Lagging Outflow',
];

function phaseTone(phase: SectorRotationPhase): string {
  switch (phase) {
    case 'Leading Inflow':
      return 'text-emerald-700 dark:text-emerald-400 font-semibold';
    case 'Improving Accumulation':
      return 'text-blue-700 dark:text-blue-400 font-semibold';
    case 'Weakening Distribution':
      return 'text-amber-700 dark:text-amber-400 font-semibold';
    case 'Lagging Outflow':
      return 'text-rose-700 dark:text-rose-400 font-semibold';
  }
}

export const SectorRotationView: React.FC<SectorRotationViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const [data, setData] = useState<SectorRotationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<'All' | SectorRotationPhase>('All');
  const [sortKey, setSortKey] = useState<SortKey>('shareShift5vs20Pp');
  const [sortAsc, setSortAsc] = useState(false);

  const loadRotation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/intelligence/sector-rotation?equityOnly=${equityOnly}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SectorRotationResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute sector rotation');
    } finally {
      setLoading(false);
    }
  }, [equityOnly]);

  useEffect(() => {
    void loadRotation();
  }, [loadRotation, dates.length]);

  const sortedSectors = useMemo(() => {
    const base = data?.sectors ?? [];
    const filtered =
      phaseFilter === 'All' ? base : base.filter((s) => s.rotationPhase === phaseFilter);
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortAsc ? av - bv : bv - av;
    });
  }, [data, phaseFilter, sortKey, sortAsc]);

  const topInflow = useMemo(() => {
    if (!data || data.sectors.length === 0) return null;
    return [...data.sectors].sort((a, b) => b.shareShift5vs20Pp - a.shareShift5vs20Pp)[0];
  }, [data]);

  const broadestSector = useMemo(() => {
    if (!data || data.sectors.length === 0) return null;
    return [...data.sectors].sort((a, b) => b.breadthPct - a.breadthPct)[0];
  }, [data]);

  const maxAbsShift = useMemo(() => {
    if (!data || data.sectors.length === 0) return 1;
    return Math.max(
      0.5,
      ...data.sectors.map((s) => Math.abs(s.shareShift5vs20Pp))
    );
  }, [data]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Sector Rotation &amp; Capital Flow Tracker
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tracks multi-horizon NEPSE turnover share shifts (1D / 5D / 20D / 60D), weighted returns, Advance/Decline breadth, and average sector valuation cushion.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadRotation()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Flow</span>
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Latest Turnover ({data.asOfDate || 'N/A'})
            </div>
            <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              Rs {formatNum(data.totalTurnover1dCr, 2)} Cr
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Across {data.datesUsed} loaded sessions
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              5D Avg vs 20D Avg Turnover
            </div>
            <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              Rs {formatNum(data.totalTurnover5dAvgCr, 2)} Cr
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              20D Avg: Rs {formatNum(data.totalTurnover20dAvgCr, 2)} Cr
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Top Capital Inflow Shift (5D vs 20D)
            </div>
            <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 truncate">
              {topInflow ? topInflow.sector : '—'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {topInflow
                ? `${topInflow.shareShift5vs20Pp >= 0 ? '+' : ''}${formatNum(topInflow.shareShift5vs20Pp, 2)} pp share shift`
                : '—'}
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Broadest Advance Breadth
            </div>
            <div className="text-base font-bold text-blue-600 dark:text-blue-400 truncate">
              {broadestSector ? broadestSector.sector : '—'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {broadestSector
                ? `${formatNum(broadestSector.breadthPct, 1)}% advancing (${broadestSector.advancers1d}↑ / ${broadestSector.decliners1d}↓)`
                : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Phase Filters */}
      <div className="flex flex-wrap items-center gap-1 border border-slate-200 dark:border-slate-800 rounded-md p-1 bg-white dark:bg-slate-900 w-fit">
        {PHASE_FILTERS.map((phase) => (
          <button
            key={phase}
            type="button"
            onClick={() => setPhaseFilter(phase)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              phaseFilter === phase
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {phase}
          </button>
        ))}
      </div>

      {/* Diverging Share-Shift Visual Overview */}
      {data && sortedSectors.length > 0 && (
        <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              5-Day vs 20-Day Turnover Share Shift (percentage points)
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Positive = capital rotating in; Negative = capital rotating out
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5">
            {sortedSectors.map((row) => {
              const widthPct = Math.min(100, (Math.abs(row.shareShift5vs20Pp) / maxAbsShift) * 100);
              const positive = row.shareShift5vs20Pp >= 0;
              return (
                <div key={row.sector} className="space-y-1">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {row.sector}
                    </span>
                    <span
                      className={`font-mono tabular-nums font-semibold shrink-0 ${
                        positive
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {positive ? '+' : ''}
                      {formatNum(row.shareShift5vs20Pp, 2)} pp
                    </span>
                  </div>
                  <div className="h-2 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        positive
                          ? 'bg-emerald-600 dark:bg-emerald-500'
                          : 'bg-rose-600 dark:bg-rose-500'
                      }`}
                      style={{ width: `${Math.max(4, widthPct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Full Sortable Matrix */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/50">
                <th className="py-2.5 px-3 font-medium">Sector</th>
                <th className="py-2.5 px-3 font-medium">Phase</th>
                <th className="py-2.5 px-3 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('share1dPct')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>1D Sh%</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('share5dPct')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>5D Sh%</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium text-right">20D Sh%</th>
                <th className="py-2.5 px-3 font-medium text-right">60D Sh%</th>
                <th className="py-2.5 px-3 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('shareShift5vs20Pp')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>5v20 Shift</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('return5dPct')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>5D Ret</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('breadthPct')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>Breadth</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('avgRoePct')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>Avg ROE</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('avgMosPct')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>Avg MoS</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 font-medium">Top Turnover Leaders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {loading && !data ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-500">
                    Computing sector rotation matrix…
                  </td>
                </tr>
              ) : sortedSectors.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-500">
                    No sectors matched this rotation filter.
                  </td>
                </tr>
              ) : (
                sortedSectors.map((row: SectorRotationRow) => (
                  <tr
                    key={row.sector}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {row.sector}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {row.stocksCount} stocks · Rs {formatNum(row.turnover1dCr, 2)} Cr today
                      </div>
                    </td>
                    <td className={`py-2.5 px-3 whitespace-nowrap ${phaseTone(row.rotationPhase)}`}>
                      {row.rotationPhase}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                      {formatNum(row.share1dPct, 2)}%
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                      {formatNum(row.share5dPct, 2)}%
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatNum(row.share20dPct, 2)}%
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatNum(row.share60dPct, 2)}%
                    </td>
                    <td
                      className={`py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums font-semibold ${
                        row.shareShift5vs20Pp >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {row.shareShift5vs20Pp >= 0 ? '+' : ''}
                      {formatNum(row.shareShift5vs20Pp, 2)}
                    </td>
                    <td
                      className={`py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums ${
                        (row.return5dPct ?? 0) >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {row.return5dPct !== null ? formatPct(row.return5dPct) : '—'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                      <div>{formatNum(row.breadthPct, 0)}%</div>
                      <div className="text-[10px] text-slate-400">
                        {row.advancers1d}↑ / {row.decliners1d}↓
                      </div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                      {row.avgRoePct !== null ? `${formatNum(row.avgRoePct, 1)}%` : '—'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                      {row.avgMosPct !== null ? formatPct(row.avgMosPct) : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {row.topMovers.map((m) => (
                          <button
                            key={m.symbol}
                            type="button"
                            onClick={() => onInspectSymbol(m.symbol)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:border-blue-500 text-[11px] font-mono tabular-nums whitespace-nowrap"
                          >
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              {m.symbol}
                            </span>
                            <span
                              className={
                                m.changePct >= 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }
                            >
                              {formatPct(m.changePct)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
