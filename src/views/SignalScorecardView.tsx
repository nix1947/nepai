import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, RefreshCw, Target } from 'lucide-react';
import type {
  SignalScorecardCohort,
  SignalScorecardResponse,
} from '../types/fundamental';
import { formatInt, formatNum, formatPct } from '../utils/format';

interface SignalScorecardViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

type HorizonKey = '5' | '10' | '20';
type CategoryFilter = 'All' | SignalScorecardCohort['category'];

const CATEGORY_FILTERS: CategoryFilter[] = [
  'All',
  'Momentum & Flow',
  'Smart Money',
  'Technical Setup',
  'Fundamental',
];

export const SignalScorecardView: React.FC<SignalScorecardViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const [data, setData] = useState<SignalScorecardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<HorizonKey>('10');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');

  const loadScorecard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/intelligence/signal-scorecard?equityOnly=${equityOnly}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SignalScorecardResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute signal scorecard');
    } finally {
      setLoading(false);
    }
  }, [equityOnly]);

  useEffect(() => {
    void loadScorecard();
  }, [loadScorecard, dates.length]);

  const filteredCohorts = useMemo(() => {
    const list = data?.cohorts ?? [];
    const scoped =
      categoryFilter === 'All'
        ? list
        : list.filter((c) => c.category === categoryFilter);
    return [...scoped].sort((a, b) => {
      const aw = a.statsByHorizon[horizon]?.winRatePct ?? -1;
      const bw = b.statsByHorizon[horizon]?.winRatePct ?? -1;
      return bw - aw;
    });
  }, [data, categoryFilter, horizon]);

  const baselineStats = data?.baselineByHorizon[horizon] ?? null;

  const bestWinRateCohort = useMemo(() => {
    if (!data || data.cohorts.length === 0) return null;
    const valid = data.cohorts.filter(
      (c) => (c.statsByHorizon[horizon]?.winRatePct ?? null) !== null
    );
    if (valid.length === 0) return null;
    return [...valid].sort(
      (a, b) =>
        (b.statsByHorizon[horizon].winRatePct ?? 0) -
        (a.statsByHorizon[horizon].winRatePct ?? 0)
    )[0];
  }, [data, horizon]);

  const bestProfitFactorCohort = useMemo(() => {
    if (!data || data.cohorts.length === 0) return null;
    const valid = data.cohorts.filter(
      (c) => (c.statsByHorizon[horizon]?.profitFactor ?? null) !== null
    );
    if (valid.length === 0) return null;
    return [...valid].sort(
      (a, b) =>
        (b.statsByHorizon[horizon].profitFactor ?? 0) -
        (a.statsByHorizon[horizon].profitFactor ?? 0)
    )[0];
  }, [data, horizon]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Signal Win-Rate &amp; Causal Forward Scorecard
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Audits 5D, 10D, and 20D forward returns after each strategy cohort triggers across loaded NEPSE EOD history, benchmarked against the median NEPSE equity baseline.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadScorecard()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Recalculate</span>
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Top KPI Cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Audit Sample Scope
            </div>
            <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {data.totalSessionsAnalyzed} sessions
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {data.evaluationCheckpoints} causal checkpoints · EOD {data.asOfDate || 'N/A'}
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Market Baseline Median ({horizon}D)
            </div>
            <div
              className={`text-lg font-mono font-bold tabular-nums ${
                (baselineStats?.medianReturnPct ?? 0) >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {baselineStats?.medianReturnPct !== null &&
              baselineStats?.medianReturnPct !== undefined
                ? formatPct(baselineStats.medianReturnPct)
                : '—'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Win rate{' '}
              {baselineStats?.winRatePct !== null && baselineStats?.winRatePct !== undefined
                ? `${formatNum(baselineStats.winRatePct, 1)}%`
                : '—'}{' '}
              ({formatInt(baselineStats?.samples ?? 0)} obs)
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Highest {horizon}D Win Rate
            </div>
            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 truncate">
              {bestWinRateCohort ? bestWinRateCohort.name : '—'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {bestWinRateCohort
                ? `${formatNum(bestWinRateCohort.statsByHorizon[horizon].winRatePct ?? 0, 1)}% wins · Excess ${formatPct(
                    bestWinRateCohort.statsByHorizon[horizon].excessVsBaselinePct ?? 0
                  )}`
                : 'Requires >=10 EOD sessions'}
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Top {horizon}D Profit Factor
            </div>
            <div className="text-sm font-bold text-blue-600 dark:text-blue-400 truncate">
              {bestProfitFactorCohort ? bestProfitFactorCohort.name : '—'}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {bestProfitFactorCohort
                ? `${formatNum(bestProfitFactorCohort.statsByHorizon[horizon].profitFactor ?? 0, 2)}x PF · Median ${formatPct(
                    bestProfitFactorCohort.statsByHorizon[horizon].medianReturnPct ?? 0
                  )}`
                : 'Requires >=10 EOD sessions'}
            </div>
          </div>
        </div>
      )}

      {/* Controls: Horizon & Category */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 border border-slate-200 dark:border-slate-800 rounded-md p-1 bg-white dark:bg-slate-900 w-fit">
          {(['5', '10', '20'] as HorizonKey[]).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                horizon === h
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {h}D Forward
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1 border border-slate-200 dark:border-slate-800 rounded-md p-1 bg-white dark:bg-slate-900 w-fit">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === cat
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Main Horizon Table */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/50">
                <th className="py-2.5 px-3 font-medium">Strategy Cohort</th>
                <th className="py-2.5 px-3 font-medium text-right">Samples</th>
                <th className="py-2.5 px-3 font-medium">Win Rate ({horizon}D)</th>
                <th className="py-2.5 px-3 font-medium text-right">Median Ret</th>
                <th className="py-2.5 px-3 font-medium text-right">Avg Ret</th>
                <th className="py-2.5 px-3 font-medium text-right">Excess vs Mkt</th>
                <th className="py-2.5 px-3 font-medium text-right">Profit Factor</th>
                <th className="py-2.5 px-3 font-medium text-right">Best / Worst</th>
                <th className="py-2.5 px-3 font-medium">Today&apos;s Qualifying Stocks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {loading && !data ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-500">
                    Evaluating historical signal cohorts…
                  </td>
                </tr>
              ) : filteredCohorts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-500">
                    No signal cohorts matched this filter.
                  </td>
                </tr>
              ) : (
                filteredCohorts.map((c) => {
                  const st = c.statsByHorizon[horizon];
                  const winPct = st.winRatePct ?? 0;
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors align-top"
                    >
                      <td className="py-3 px-3 max-w-xs">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {c.name}
                        </div>
                        <div className="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-0.5">
                          {c.category}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          {c.description}
                        </p>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {formatInt(st.samples)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap min-w-[130px]">
                        <div className="flex items-center justify-between font-mono tabular-nums font-semibold">
                          <span
                            className={
                              winPct >= 55
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : winPct >= 45
                                  ? 'text-slate-800 dark:text-slate-200'
                                  : 'text-rose-600 dark:text-rose-400'
                            }
                          >
                            {st.winRatePct !== null ? `${formatNum(st.winRatePct, 1)}%` : '—'}
                          </span>
                        </div>
                        <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800 mt-1.5 overflow-hidden">
                          <div
                            className={`h-full ${
                              winPct >= 55
                                ? 'bg-emerald-600 dark:bg-emerald-500'
                                : winPct >= 45
                                  ? 'bg-blue-600 dark:bg-blue-500'
                                  : 'bg-rose-600 dark:bg-rose-500'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, winPct))}%` }}
                          />
                        </div>
                      </td>
                      <td
                        className={`py-3 px-3 whitespace-nowrap text-right font-mono tabular-nums font-medium ${
                          (st.medianReturnPct ?? 0) >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {st.medianReturnPct !== null ? formatPct(st.medianReturnPct) : '—'}
                      </td>
                      <td
                        className={`py-3 px-3 whitespace-nowrap text-right font-mono tabular-nums ${
                          (st.avgReturnPct ?? 0) >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {st.avgReturnPct !== null ? formatPct(st.avgReturnPct) : '—'}
                      </td>
                      <td
                        className={`py-3 px-3 whitespace-nowrap text-right font-mono tabular-nums font-medium ${
                          (st.excessVsBaselinePct ?? 0) >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {st.excessVsBaselinePct !== null
                          ? formatPct(st.excessVsBaselinePct)
                          : '—'}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-right font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                        {st.profitFactor !== null ? `${formatNum(st.profitFactor, 2)}x` : '—'}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-right font-mono tabular-nums text-[11px]">
                        <div className="text-emerald-600 dark:text-emerald-400">
                          {st.bestReturnPct !== null ? formatPct(st.bestReturnPct) : '—'}
                        </div>
                        <div className="text-rose-600 dark:text-rose-400">
                          {st.worstReturnPct !== null ? formatPct(st.worstReturnPct) : '—'}
                        </div>
                      </td>
                      <td className="py-3 px-3 max-w-xs">
                        {c.currentCandidates.length === 0 ? (
                          <span className="text-[11px] text-slate-400">None today</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {c.currentCandidates.slice(0, 8).map((sym) => (
                              <button
                                key={sym}
                                type="button"
                                onClick={() => onInspectSymbol(sym)}
                                className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:border-blue-500 whitespace-nowrap"
                              >
                                {sym}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Multi-Horizon Comparison Cards (5D / 10D / 20D) */}
      {data && filteredCohorts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Multi-Horizon Edge Breakdown (5D / 10D / 20D)
            </h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredCohorts.map((c) => (
              <div
                key={c.id}
                className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {c.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {c.category}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                    {c.currentCandidates.length} active today
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {(['5', '10', '20'] as HorizonKey[]).map((h) => {
                    const st = c.statsByHorizon[h];
                    return (
                      <div
                        key={h}
                        className={`p-2.5 rounded border text-xs space-y-1 ${
                          horizon === h
                            ? 'border-blue-300 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          <span>{h}D</span>
                          <span>n={st.samples}</span>
                        </div>
                        <div className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {st.winRatePct !== null ? `${formatNum(st.winRatePct, 1)}% win` : '—'}
                        </div>
                        <div
                          className={`font-mono text-[11px] tabular-nums ${
                            (st.medianReturnPct ?? 0) >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          Med:{' '}
                          {st.medianReturnPct !== null ? formatPct(st.medianReturnPct) : '—'}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          Ex:{' '}
                          {st.excessVsBaselinePct !== null
                            ? formatPct(st.excessVsBaselinePct)
                            : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Note: Forward returns are measured strictly causally from EOD close at checkpoint t to t+5, t+10, and t+20 sessions without transaction costs or SEBON/brokerage commissions. At least 10 loaded sessions are required to build multi-horizon cohorts.
      </p>
    </div>
  );
};
