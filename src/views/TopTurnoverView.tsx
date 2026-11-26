import React, { useEffect, useMemo, useState } from 'react';
import { HorizontalTurnoverBar, WeeklyHeatmapChart } from '../components/Charts';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { PeriodPicker, resolvePeriodRange, type PeriodMode } from '../components/PeriodPicker';
import type { RangeSummaryRow, WeeklyTopRow } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface TopTurnoverViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

export const TopTurnoverView: React.FC<TopTurnoverViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const [mode, setMode] = useState<PeriodMode>('last1');
  const [customStart, setCustomStart] = useState(
    dates[Math.max(0, dates.length - 6)] ?? ''
  );
  const [customEnd, setCustomEnd] = useState(dates[dates.length - 1] ?? '');
  const [limitN, setLimitN] = useState(15);

  const [rangeRows, setRangeRows] = useState<RangeSummaryRow[]>([]);
  const [weeklyData, setWeeklyData] = useState<{
    weeks: Array<{ label: string; map: Record<string, number> }>;
    rows: WeeklyTopRow[];
  }>({ weeks: [], rows: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (dates.length > 0) {
      if (!customEnd) setCustomEnd(dates[dates.length - 1]);
      if (!customStart) {
        setCustomStart(dates[Math.max(0, dates.length - (mode === 'weekly' ? 20 : 6))]);
      }
    }
  }, [dates, customEnd, customStart, mode]);

  const resolved = resolvePeriodRange(dates, mode, customStart, customEnd);

  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    setLoading(true);
    const qs = `start=${encodeURIComponent(resolved.start)}&end=${encodeURIComponent(
      resolved.end
    )}&n=${limitN}&equityOnly=${equityOnly}`;

    const url = mode === 'weekly' ? `/api/weekly-turnover?${qs}` : `/api/range-summary?${qs}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (mode === 'weekly') {
          setWeeklyData({ weeks: data.weeks || [], rows: data.rows || [] });
        } else {
          setRangeRows(data.rows || []);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolved?.start, resolved?.end, limitN, equityOnly, mode]);

  const weeklyOrder = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of weeklyData.rows) {
      totals.set(r.symbol, (totals.get(r.symbol) || 0) + r.turnover);
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
  }, [weeklyData.rows]);

  const rangeCols: ColumnDef<RangeSummaryRow>[] = [
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
      key: 'turnover',
      label: 'Turnover (cr)',
      align: 'right',
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
      key: 'start_price',
      label: 'Start Close',
      align: 'right',
      render: (r) => formatNum(r.start_price),
    },
    {
      key: 'end_price',
      label: 'End Close',
      align: 'right',
      render: (r) => formatNum(r.end_price),
    },
    {
      key: 'change_pct',
      label: 'Change %',
      align: 'right',
      render: (r) => (
        <span
          className={
            (r.change_pct ?? 0) >= 0
              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
              : 'text-red-600 dark:text-red-400 font-medium'
          }
        >
          {formatPct(r.change_pct)}
        </span>
      ),
    },
    {
      key: 'days_traded',
      label: 'Days',
      align: 'right',
      render: (r) => r.days_traded,
    },
  ];

  const weeklyCols: ColumnDef<WeeklyTopRow>[] = [
    { key: 'week_start', label: 'Week Start', align: 'left', render: (r) => <span className="font-mono">{r.week_start}</span> },
    { key: 'week_end', label: 'Week End', align: 'left', render: (r) => <span className="font-mono">{r.week_end}</span> },
    { key: 'rank', label: 'Rank', align: 'right', render: (r) => r.rank },
    ...rangeCols,
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Top Turnover Leaders
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Price change is anchored to the previous close before the selected period started
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <label htmlFor="tt-limit" className="text-slate-600 dark:text-slate-400 font-medium">
            Top N: <span className="font-mono text-slate-900 dark:text-slate-100">{limitN}</span>
          </label>
          <input
            id="tt-limit"
            type="range"
            min={5}
            max={50}
            step={5}
            value={limitN}
            onChange={(e) => setLimitN(Number(e.target.value))}
            className="w-32 accent-blue-600"
          />
        </div>
      </div>

      <PeriodPicker
        dates={dates}
        mode={mode}
        onModeChange={setMode}
        customStart={customStart}
        customEnd={customEnd}
        onCustomChange={(s, e) => {
          setCustomStart(s);
          setCustomEnd(e);
        }}
        allowWeekly
      />

      {loading ? (
        <div className="h-64 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : mode === 'weekly' ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              NEPSE weeks run Sunday–Saturday. Matrix values show turnover in Rs crore.
            </p>
            <WeeklyHeatmapChart weeks={weeklyData.weeks} symbols={weeklyOrder} />
          </div>
          <DataTable
            rows={weeklyData.rows}
            columns={weeklyCols}
            rowKey={(r) => `${r.week_start}-${r.symbol}`}
            onRowClick={(r) => onInspectSymbol(r.symbol)}
            searchKeys={['symbol', 'name']}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
            <HorizontalTurnoverBar
              items={rangeRows.map((r) => ({
                symbol: r.symbol,
                turnover: r.turnover,
                pct: r.change_pct ?? 0,
              }))}
              onSelectSymbol={onInspectSymbol}
            />
          </div>
          <DataTable
            rows={rangeRows}
            columns={rangeCols}
            rowKey={(r) => r.symbol}
            onRowClick={(r) => onInspectSymbol(r.symbol)}
            searchKeys={['symbol', 'name']}
          />
        </div>
      )}
    </div>
  );
};
