import React, { useEffect, useMemo, useState } from 'react';
import { CandlestickVolumeChart, type HorizontalLevel } from '../components/Charts';
import { DataTable, type ColumnDef } from '../components/DataTable';
import type { PriceRow, SymbolInfo } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface StockExplorerViewProps {
  dates: string[];
  equityOnly: boolean;
  initialSymbol?: string | null;
}

export const StockExplorerView: React.FC<StockExplorerViewProps> = ({
  dates,
  equityOnly,
  initialSymbol,
}) => {
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol || '');
  const [daysShown, setDaysShown] = useState(90);
  const [showSR, setShowSR] = useState(true);
  const [history, setHistory] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialSymbol) setSelectedSymbol(initialSymbol);
  }, [initialSymbol]);

  useEffect(() => {
    const latest = dates[dates.length - 1];
    if (!latest) return;
    fetch(`/api/symbols?day=${encodeURIComponent(latest)}&equityOnly=${equityOnly}`)
      .then((r) => r.json())
      .then((d) => {
        const list: SymbolInfo[] = d.symbols || [];
        setSymbols(list);
        if (list.length > 0 && (!selectedSymbol || !list.some((s) => s.symbol === selectedSymbol))) {
          const def = list.find((s) => s.symbol === 'NABIL')?.symbol || list[0].symbol;
          setSelectedSymbol(def);
        }
      });
  }, [dates, equityOnly]);

  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/symbol/${encodeURIComponent(selectedSymbol)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setHistory(d.history || []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  const sliced = useMemo(() => history.slice(-daysShown), [history, daysShown]);
  const last = history[history.length - 1] ?? null;

  const srLevels = useMemo((): HorizontalLevel[] => {
    if (!showSR || history.length <= 5) return [];
    const prior = history.slice(0, -1).slice(-20);
    return [
      { label: '20d resistance', value: Math.max(...prior.map((r) => r.high)), color: '#d97706' },
      { label: '20d support', value: Math.min(...prior.map((r) => r.low)), color: '#16a34a' },
    ];
  }, [showSR, history]);

  const ma120Delta =
    last && last.d120 && last.d120 > 0 ? ((last.close / last.d120 - 1) * 100).toFixed(1) : null;

  const cols: ColumnDef<PriceRow>[] = [
    { key: 'date', label: 'Date', align: 'left', render: (r) => <span className="font-mono">{r.date}</span> },
    { key: 'open', label: 'Open', align: 'right', render: (r) => formatNum(r.open) },
    { key: 'high', label: 'High', align: 'right', render: (r) => formatNum(r.high) },
    { key: 'low', label: 'Low', align: 'right', render: (r) => formatNum(r.low) },
    { key: 'close', label: 'Close', align: 'right', render: (r) => <span className="font-semibold">{formatNum(r.close)}</span> },
    {
      key: 'diff_pct',
      label: 'Chg %',
      align: 'right',
      render: (r) => (
        <span className={(r.diff_pct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          {formatPct(r.diff_pct)}
        </span>
      ),
    },
    { key: 'volume', label: 'Volume', align: 'right', render: (r) => formatInt(r.volume) },
    { key: 'turnover', label: 'Turnover (cr)', align: 'right', render: (r) => formatCrore(r.turnover) },
    { key: 'trans', label: 'Trades', align: 'right', render: (r) => formatInt(r.trans) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex-1 min-w-[260px]">
          <label htmlFor="ex-sym" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Security Symbol
          </label>
          <select
            id="ex-sym"
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="w-full max-w-md px-3 py-2 text-sm font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          >
            {symbols.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol}
                {s.name ? ` — ${s.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs">
          <label className="space-y-1">
            <span className="flex justify-between gap-4 text-slate-600 dark:text-slate-300">
              <span>Sessions shown</span>
              <span className="font-mono font-semibold">{daysShown}</span>
            </span>
            <input
              type="range"
              min={20}
              max={250}
              value={daysShown}
              onChange={(e) => setDaysShown(Number(e.target.value))}
              className="w-36 accent-blue-600"
            />
          </label>

          <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showSR}
              onChange={(e) => setShowSR(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            <span>20-day Support / Resistance</span>
          </label>
        </div>
      </div>

      {last && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Close</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">{formatNum(last.close)}</div>
            <div className={`text-xs font-mono ${last.diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatPct(last.diff_pct)}
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Volume</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">{formatInt(last.volume)}</div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Turnover (Rs cr)</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">{formatCrore(last.turnover)}</div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">52w High</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">{formatNum(last.w52_high, 1)}</div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">52w Low</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">{formatNum(last.w52_low, 1)}</div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">vs MA120</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">
              {ma120Delta !== null ? `${Number(ma120Delta) >= 0 ? '+' : ''}${ma120Delta}%` : '–'}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-[360px] animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : (
        <CandlestickVolumeChart history={sliced} levels={srLevels} />
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Recent Daily Sessions
        </h3>
        <DataTable
          rows={[...sliced].reverse().slice(0, 30)}
          columns={cols}
          rowKey={(r) => r.date}
          maxHeightClass="max-h-[340px]"
        />
      </div>
    </div>
  );
};
