import React, { useEffect, useState } from 'react';
import { HorizontalTurnoverBar, MarketHistoryCharts, TurnoverTreemap } from '../components/Charts';
import type { DailyAggregate, PriceRow } from '../types/market';
import { formatCrore, formatInt } from '../utils/format';

interface OverviewViewProps {
  dates: string[];
  daily: DailyAggregate[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  dates,
  daily,
  equityOnly,
  onInspectSymbol,
}) => {
  const [selectedDay, setSelectedDay] = useState<string>(dates[dates.length - 1] ?? '');
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (dates.length > 0 && (!selectedDay || !dates.includes(selectedDay))) {
      setSelectedDay(dates[dates.length - 1]);
    }
  }, [dates, selectedDay]);

  useEffect(() => {
    if (!selectedDay) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/day/${encodeURIComponent(selectedDay)}?equityOnly=${equityOnly}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRows(d.rows || []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, equityOnly]);

  const agg = daily.find((d) => d.date === selectedDay);
  const idx = daily.findIndex((d) => d.date === selectedDay);
  const prevAgg = idx > 0 ? daily[idx - 1] : null;
  const turnDelta =
    agg && prevAgg && prevAgg.turnover > 0
      ? ((agg.turnover / prevAgg.turnover - 1) * 100).toFixed(1)
      : null;

  const top15 = [...rows]
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 15)
    .map((r) => ({ symbol: r.symbol, turnover: r.turnover, pct: r.diff_pct ?? 0 }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Market Overview
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Session breadth, sector-agnostic turnover concentration, and historical trend
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

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Market History</h3>
        {daily.length < 2 ? (
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
            Only one trading day is currently loaded. Backfill historical days in Scheduler &amp; Data
            to unlock multi-session turnover and breadth curves.
          </div>
        ) : (
          <MarketHistoryCharts daily={daily} />
        )}
      </div>
    </div>
  );
};
