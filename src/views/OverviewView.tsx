import React, { useEffect, useMemo, useState } from 'react';
import { Flame, Star } from 'lucide-react';
import { HorizontalTurnoverBar, MarketHistoryCharts, TurnoverTreemap } from '../components/Charts';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { InfoTip } from '../components/InfoTip';
import { useTradingSettings } from '../hooks/useTradingSettings';
import { useWatchlist } from '../hooks/useWatchlist';
import type { DailyAggregate, PriceRow, TopTurnoverEnhancedRow } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface OverviewViewProps {
  dates: string[];
  daily: DailyAggregate[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
  onOpenScheduler: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  dates,
  daily,
  equityOnly,
  onInspectSymbol,
  onOpenScheduler,
}) => {
  const { settings } = useTradingSettings();
  const nDays = settings.lookbackDays;
  const [selectedDay, setSelectedDay] = useState<string>(dates[dates.length - 1] ?? '');
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [unusualRows, setUnusualRows] = useState<TopTurnoverEnhancedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  useEffect(() => {
    if (dates.length > 0 && (!selectedDay || !dates.includes(selectedDay))) {
      setSelectedDay(dates[dates.length - 1]);
    }
  }, [dates, selectedDay]);

  useEffect(() => {
    if (!selectedDay) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/day/${encodeURIComponent(selectedDay)}?equityOnly=${equityOnly}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch(
        `/api/top-turnover-analytics?start=${encodeURIComponent(selectedDay)}&end=${encodeURIComponent(
          selectedDay
        )}&nDays=${nDays}&n=35&equityOnly=${equityOnly}`
      ).then((r) => (r.ok ? r.json() : { rows: [] })),
    ])
      .then(([dayData, topData]) => {
        if (cancelled) return;
        setRows(dayData.rows || []);
        const spikes = ((topData.rows || []) as TopTurnoverEnhancedRow[])
          .filter((r) => r.turnover_vs_avg_n >= 1.4)
          .sort((a, b) => b.turnover_vs_avg_n - a.turnover_vs_avg_n)
          .slice(0, 4);
        setUnusualRows(spikes);
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setUnusualRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, equityOnly, nDays]);

  const agg = daily.find((d) => d.date === selectedDay);
  const idx = daily.findIndex((d) => d.date === selectedDay);
  const prevAgg = idx > 0 ? daily[idx - 1] : null;
  const turnDelta =
    agg && prevAgg && prevAgg.turnover > 0
      ? ((agg.turnover / prevAgg.turnover - 1) * 100).toFixed(1)
      : null;

  const top15 = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.turnover - a.turnover)
        .slice(0, 15)
        .map((r) => ({ symbol: r.symbol, turnover: r.turnover, pct: r.diff_pct ?? 0 })),
    [rows]
  );

  const topGainers = useMemo(
    () =>
      [...rows]
        .filter((r) => (r.diff_pct ?? 0) > 0)
        .sort((a, b) => (b.diff_pct ?? 0) - (a.diff_pct ?? 0))
        .slice(0, 8),
    [rows]
  );

  const topLosers = useMemo(
    () =>
      [...rows]
        .filter((r) => (r.diff_pct ?? 0) < 0)
        .sort((a, b) => (a.diff_pct ?? 0) - (b.diff_pct ?? 0))
        .slice(0, 8),
    [rows]
  );

  const sortedByTurnover = useMemo(
    () => [...rows].sort((a, b) => b.turnover - a.turnover),
    [rows]
  );

  const marketCols: ColumnDef<PriceRow>[] = useMemo(
    () => [
      {
        key: '_star',
        label: '',
        align: 'left',
        sortable: false,
        widthClass: 'w-8',
        render: (r) => {
          const starred = hasSymbol(r.symbol);
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleSymbol(r.symbol);
              }}
              aria-label={starred ? `Remove ${r.symbol} from watchlist` : `Add ${r.symbol} to watchlist`}
              className="p-0.5 text-slate-400 hover:text-amber-500 transition-colors"
            >
              <Star className={`w-3.5 h-3.5 ${starred ? 'fill-amber-500 text-amber-500' : ''}`} />
            </button>
          );
        },
      },
      {
        key: 'symbol',
        label: 'Symbol',
        align: 'left',
        render: (r) => (
          <span className="font-semibold text-blue-600 dark:text-blue-400">{r.symbol}</span>
        ),
      },
      {
        key: 'name',
        label: 'Company',
        align: 'left',
        render: (r) => (
          <span className="text-slate-600 dark:text-slate-300 truncate max-w-[220px] inline-block">
            {r.name || '–'}
          </span>
        ),
      },
      {
        key: 'close',
        label: 'Close',
        align: 'right',
        render: (r) => <span className="font-medium">{formatNum(r.close)}</span>,
      },
      {
        key: 'diff_pct',
        label: 'Chg %',
        align: 'right',
        render: (r) => (
          <span
            className={
              (r.diff_pct ?? 0) >= 0
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-red-600 dark:text-red-400 font-medium'
            }
          >
            {formatPct(r.diff_pct)}
          </span>
        ),
      },
      {
        key: 'turnover',
        label: 'Turnover (cr)',
        align: 'right',
        csvValue: (r) => (r.turnover / 1e7).toFixed(4),
        render: (r) => formatCrore(r.turnover),
      },
      {
        key: 'volume',
        label: 'Volume',
        align: 'right',
        render: (r) => formatInt(r.volume),
      },
      {
        key: 'trans',
        label: 'Trades',
        align: 'right',
        render: (r) => formatInt(r.trans),
      },
      {
        key: 'gap_52h',
        label: 'vs 52w High',
        align: 'right',
        sortValue: (r) =>
          r.w52_high !== null && r.w52_high > 0 ? ((r.close - r.w52_high) / r.w52_high) * 100 : null,
        render: (r) =>
          r.w52_high !== null && r.w52_high > 0 ? (
            <span className="text-slate-500 dark:text-slate-400">
              {formatPct(((r.close - r.w52_high) / r.w52_high) * 100)}
            </span>
          ) : (
            '–'
          ),
      },
    ],
    [hasSymbol, toggleSymbol]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Market Overview
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Session breadth, sector-agnostic turnover concentration, daily movers, and full market table
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="overview-day" className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Trading day
          </label>
          <select
            id="overview-day"
            value={selectedDay}
            onChange={(e) => setSelectedDay(e.target.value)}
            className="px-3 py-1.5 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          >
            {[...dates].reverse().map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {agg && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Turnover (Rs crore)</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatCrore(agg.turnover, 1)}
            </div>
            {turnDelta !== null && (
              <div
                className={`mt-1 text-xs font-mono tabular-nums ${
                  Number(turnDelta) >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {Number(turnDelta) >= 0 ? `+${turnDelta}%` : `${turnDelta}%`} vs {prevAgg?.date}
              </div>
            )}
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Traded shares</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatInt(agg.volume)}
            </div>
            <div className="mt-1 text-xs text-slate-400">All listed volume</div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Companies traded</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {agg.companies}
            </div>
            <div className="mt-1 text-xs text-slate-400">Active securities</div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Advancers</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {agg.advancers}
            </div>
            <div className="mt-1 text-xs text-slate-400">Closed higher</div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Decliners</div>
            <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-red-600 dark:text-red-400">
              {agg.decliners}
            </div>
            <div className="mt-1 text-xs text-slate-400">Unchanged: {agg.unchanged}</div>
          </div>
        </div>
      )}

      {unusualRows.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Flame className="w-3.5 h-3.5 text-amber-500" />
              <span>Unusual Liquidity Spotlight (vs {nDays}-Day Average)</span>
              <InfoTip
                title="Why Watch N-Day Turnover Spikes?"
                body={`Highlights active leaders whose turnover on ${selectedDay} is significantly above their ${nDays}-day rolling average.`}
                example="2.5x means today's rupee turnover is 250% of its normal daily pace."
              />
            </div>
            <span className="text-[11px] font-mono text-slate-400">Click any stock to analyze</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {unusualRows.map((u) => (
              <button
                key={u.symbol}
                type="button"
                onClick={() => onInspectSymbol(u.symbol)}
                className="text-left p-2.5 rounded-md border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-700 bg-slate-50/50 dark:bg-slate-950/50 transition-colors space-y-1"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-blue-600 dark:text-blue-400">{u.symbol}</span>
                  <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                    {u.turnover_vs_avg_n.toFixed(1)}x {nDays}d avg
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  <span>LTP {formatNum(u.ltp)}</span>
                  <span className={(u.change_pct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    {formatPct(u.change_pct)}
                  </span>
                  <span>{formatCrore(u.turnover)} cr</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Turnover Heat Map (Top 60)
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Size = turnover · Colour = % change (±5%) · Click tile to inspect
            </span>
          </div>
          {loading ? (
            <div className="h-[430px] animate-pulse bg-slate-100 dark:bg-slate-800 rounded-md" />
          ) : (
            <TurnoverTreemap rows={rows} onSelectSymbol={onInspectSymbol} />
          )}
        </div>

        <div className="xl:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Top 15 by Turnover
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">Rs crore</span>
          </div>
          {loading ? (
            <div className="h-[430px] animate-pulse bg-slate-100 dark:bg-slate-800 rounded-md" />
          ) : (
            <HorizontalTurnoverBar items={top15} onSelectSymbol={onInspectSymbol} />
          )}
        </div>
      </div>

      {/* Top Gainers & Top Losers */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                Top Gainers
              </h3>
              <span className="text-xs text-slate-400 font-mono">{selectedDay}</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {topGainers.length === 0 ? (
                <div className="px-4 py-6 text-slate-400 text-center">No advancers in this session.</div>
              ) : (
                topGainers.map((r) => (
                  <button
                    key={r.symbol}
                    type="button"
                    onClick={() => onInspectSymbol(r.symbol)}
                    className="w-full px-4 py-2 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-blue-600 dark:text-blue-400 w-16 shrink-0">
                        {r.symbol}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400 truncate">{r.name}</span>
                    </div>
                    <div className="flex items-center gap-4 font-mono tabular-nums shrink-0">
                      <span className="text-slate-700 dark:text-slate-300">{formatNum(r.close)}</span>
                      <span className="text-slate-500 dark:text-slate-400 w-16 text-right">
                        {formatCrore(r.turnover)} cr
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold w-16 text-right">
                        {formatPct(r.diff_pct)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
                Top Losers
              </h3>
              <span className="text-xs text-slate-400 font-mono">{selectedDay}</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {topLosers.length === 0 ? (
                <div className="px-4 py-6 text-slate-400 text-center">No decliners in this session.</div>
              ) : (
                topLosers.map((r) => (
                  <button
                    key={r.symbol}
                    type="button"
                    onClick={() => onInspectSymbol(r.symbol)}
                    className="w-full px-4 py-2 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-blue-600 dark:text-blue-400 w-16 shrink-0">
                        {r.symbol}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400 truncate">{r.name}</span>
                    </div>
                    <div className="flex items-center gap-4 font-mono tabular-nums shrink-0">
                      <span className="text-slate-700 dark:text-slate-300">{formatNum(r.close)}</span>
                      <span className="text-slate-500 dark:text-slate-400 w-16 text-right">
                        {formatCrore(r.turnover)} cr
                      </span>
                      <span className="text-red-600 dark:text-red-400 font-semibold w-16 text-right">
                        {formatPct(r.diff_pct)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full Session Screener Table */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            All Traded Securities ({selectedDay})
          </h3>
          <span className="text-xs text-slate-400">Click column headers to sort · Click row to inspect</span>
        </div>
        <DataTable
          rows={sortedByTurnover}
          columns={marketCols}
          rowKey={(r) => r.symbol}
          onRowClick={(r) => onInspectSymbol(r.symbol)}
          searchKeys={['symbol', 'name']}
          exportFilename={`nepse-${selectedDay || 'session'}.csv`}
          watchlistFilter={{ watchlist, getSymbol: (r) => r.symbol }}
          maxHeightClass="max-h-[460px]"
        />
      </div>

      {/* Market History */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Market History</h3>
        {daily.length < 2 ? (
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 dark:text-slate-300">
            <span>
              Only {daily.length} trading day is loaded. Backfill 30–180 days from ShareSansar to unlock Market History curves and all 8 technical scanners.
            </span>
            <button
              type="button"
              onClick={onOpenScheduler}
              className="px-3.5 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap"
            >
              Backfill Historical Data
            </button>
          </div>
        ) : (
          <MarketHistoryCharts daily={daily} />
        )}
      </div>
    </div>
  );
};
