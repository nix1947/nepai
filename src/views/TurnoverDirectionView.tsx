import React, { useEffect, useState } from 'react';
import { TurnoverScatterChart } from '../components/Charts';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { PeriodPicker, resolvePeriodRange, type PeriodMode } from '../components/PeriodPicker';
import type { RangeSummaryRow } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface TurnoverDirectionViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

export const TurnoverDirectionView: React.FC<TurnoverDirectionViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const [mode, setMode] = useState<PeriodMode>('last5');
  const [customStart, setCustomStart] = useState(
    dates[Math.max(0, dates.length - 6)] ?? ''
  );
  const [customEnd, setCustomEnd] = useState(dates[dates.length - 1] ?? '');
  const [topPct, setTopPct] = useState(10);
  const [consistent, setConsistent] = useState(false);

  const [data, setData] = useState<{
    all: RangeSummaryRow[];
    up: RangeSummaryRow[];
    down: RangeSummaryRow[];
    cutoff: number;
  }>({ all: [], up: [], down: [], cutoff: 0 });
  const [loading, setLoading] = useState(false);

  const resolved = resolvePeriodRange(dates, mode, customStart, customEnd);

  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/turnover-direction?start=${encodeURIComponent(resolved.start)}&end=${encodeURIComponent(
        resolved.end
      )}&topPct=${topPct}&consistent=${consistent}&equityOnly=${equityOnly}`
    )
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled) {
          setData({
            all: res.all || [],
            up: res.up || [],
            down: res.down || [],
            cutoff: res.cutoff || 0,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resolved?.start, resolved?.end, topPct, consistent, equityOnly]);

  const makeCols = (dir: 'up' | 'down'): ColumnDef<RangeSummaryRow>[] => [
    {
      key: 'symbol',
      label: 'Symbol',
      align: 'left',
      render: (r) => (
        <span className="font-semibold text-blue-600 dark:text-blue-400">{r.symbol}</span>
      ),
    },
    { key: 'turnover', label: 'Turn (cr)', align: 'right', render: (r) => formatCrore(r.turnover) },
    { key: 'start_price', label: 'Start', align: 'right', render: (r) => formatNum(r.start_price) },
    { key: 'end_price', label: 'End', align: 'right', render: (r) => formatNum(r.end_price) },
    {
      key: 'change_pct',
      label: 'Chg %',
      align: 'right',
      render: (r) => (
        <span
          className={
            dir === 'up'
              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
              : 'text-red-600 dark:text-red-400 font-medium'
          }
        >
          {formatPct(r.change_pct)}
        </span>
      ),
    },
    {
      key: dir === 'up' ? 'up_days' : 'down_days',
      label: dir === 'up' ? 'Up / Days' : 'Dn / Days',
      align: 'right',
      render: (r) => `${dir === 'up' ? r.up_days : r.down_days}/${r.days_traded}`,
    },
    { key: 'volume', label: 'Volume', align: 'right', render: (r) => formatInt(r.volume) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Turnover × Direction
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Separates the highest-turnover percentile into institutional accumulation (UP) vs heavy distribution (DOWN)
        </p>
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
      />

      <div className="flex flex-wrap items-center gap-6 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 text-xs">
        <div className="flex items-center gap-3">
          <label htmlFor="td-pct" className="text-slate-600 dark:text-slate-300 font-medium">
            High turnover = top <span className="font-mono font-semibold">{topPct}%</span>
          </label>
          <input
            id="td-pct"
            type="range"
            min={3}
            max={50}
            value={topPct}
            onChange={(e) => setTopPct(Number(e.target.value))}
            className="w-32 accent-blue-600"
          />
        </div>

        <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={consistent}
            onChange={(e) => setConsistent(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
          />
          <span>Steady trend only (≥ 60% of days in that direction)</span>
        </label>

        {data.cutoff > 0 && (
          <span className="ml-auto font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Cutoff: Rs {formatCrore(data.cutoff)} cr
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-80 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : (
        <>
          <TurnoverScatterChart all={data.all} up={data.up} down={data.down} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                High Turnover + Price UP ({data.up.length})
              </h3>
              <DataTable
                rows={data.up}
                columns={makeCols('up')}
                rowKey={(r) => r.symbol}
                onRowClick={(r) => onInspectSymbol(r.symbol)}
                searchKeys={['symbol', 'name']}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
                High Turnover + Price DOWN ({data.down.length})
              </h3>
              <DataTable
                rows={data.down}
                columns={makeCols('down')}
                rowKey={(r) => r.symbol}
                onRowClick={(r) => onInspectSymbol(r.symbol)}
                searchKeys={['symbol', 'name']}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
