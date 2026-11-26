import React, { useEffect, useMemo, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { CandlestickVolumeChart, type HorizontalLevel } from '../components/Charts';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { NepseTradePlanner } from '../components/NepseTradePlanner';
import { useWatchlist } from '../hooks/useWatchlist';
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
  const [symbolFilter, setSymbolFilter] = useState<string>('');
  const [daysShown, setDaysShown] = useState(90);
  const [showSR, setShowSR] = useState(true);
  const [history, setHistory] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

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

  const filteredSymbols = useMemo(() => {
    const q = symbolFilter.trim().toLowerCase();
    if (!q) return symbols;
    return symbols.filter(
      (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [symbols, symbolFilter]);

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
    {
      key: 'turnover',
      label: 'Turnover (cr)',
      align: 'right',
      csvValue: (r) => (r.turnover / 1e7).toFixed(4),
      render: (r) => formatCrore(r.turnover),
    },
    { key: 'trans', label: 'Trades', align: 'right', render: (r) => formatInt(r.trans) },
  ];

  const isStarred = selectedSymbol ? hasSymbol(selectedSymbol) : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex-1 min-w-[280px] space-y-2">
          <label htmlFor="ex-search" className="block text-xs font-medium text-slate-500 dark:text-slate-400">
            Find &amp; Select Security ({symbols.length} listed)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-44">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="ex-search"
                type="text"
                value={symbolFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setSymbolFilter(val);
                  const q = val.trim().toLowerCase();
                  if (q) {
                    const exact = symbols.find((s) => s.symbol.toLowerCase() === q);
                    const first =
                      exact ||
                      symbols.find(
                        (s) =>
                          s.symbol.toLowerCase().startsWith(q) ||
                          s.name.toLowerCase().includes(q)
                      );
                    if (first) setSelectedSymbol(first.symbol);
                  }
                }}
                placeholder="Type symbol (NABIL)…"
                className="w-full pl-8 pr-2.5 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
            </div>

            <select
              id="ex-sym"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            >
              {filteredSymbols.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.symbol}
                  {s.name ? ` — ${s.name}` : ''}
                </option>
              ))}
            </select>

            {selectedSymbol && (
              <button
                type="button"
                onClick={() => toggleSymbol(selectedSymbol)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
                  isStarred
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-500 text-amber-500' : ''}`} />
                <span>{isStarred ? 'Starred' : 'Watchlist'}</span>
              </button>
            )}
          </div>

          {watchlist.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-slate-400 mr-1">Watchlist:</span>
              {watchlist.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setSelectedSymbol(sym)}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors ${
                    selectedSymbol === sym
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>
          )}
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

      {last && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex-1 min-w-[220px] max-w-sm space-y-1">
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              <span>52w Low: {formatNum(last.w52_low, 1)}</span>
              <span>
                {last.w52_high && last.w52_low && last.w52_high > last.w52_low
                  ? `${Math.round(
                      Math.max(
                        0,
                        Math.min(
                          100,
                          ((last.close - last.w52_low) / (last.w52_high - last.w52_low)) * 100
                        )
                      )
                    )}% of 52w range`
                  : '52w position'}
              </span>
              <span>52w High: {formatNum(last.w52_high, 1)}</span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden relative">
              <div
                className="h-full bg-blue-600 dark:bg-blue-500"
                style={{
                  width: `${
                    last.w52_high && last.w52_low && last.w52_high > last.w52_low
                      ? Math.max(
                          2,
                          Math.min(
                            100,
                            ((last.close - last.w52_low) / (last.w52_high - last.w52_low)) * 100
                          )
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 font-mono tabular-nums">
            <div>
              <span className="text-slate-400 mr-1.5 font-sans">vs VWAP:</span>
              <span
                className={
                  (last.vwap_pct ?? 0) >= 0
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'text-red-600 dark:text-red-400 font-medium'
                }
              >
                {formatPct(last.vwap_pct)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 mr-1.5 font-sans">Rs/Trade:</span>
              <span className="text-slate-800 dark:text-slate-200 font-medium">
                {last.trans > 0 ? formatInt(last.turnover / last.trans) : '–'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 mr-1.5 font-sans">Close Str:</span>
              <span className="text-slate-800 dark:text-slate-200 font-medium">
                {last.high > last.low
                  ? `${Math.round(((last.close - last.low) / (last.high - last.low)) * 100)}%`
                  : '–'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 mr-1.5 font-sans">vs MA180:</span>
              <span className="text-slate-800 dark:text-slate-200 font-medium">
                {last.d180 && last.d180 > 0
                  ? formatPct(((last.close / last.d180 - 1) * 100))
                  : '–'}
              </span>
            </div>
          </div>
        </div>
      )}

      {last && (
        <NepseTradePlanner
          symbol={selectedSymbol}
          lastClose={last.close}
          suggestedStop={
            srLevels.find((l) => l.label.includes('support'))?.value ?? last.low
          }
          suggestedTarget={
            srLevels.find((l) => l.label.includes('resistance'))?.value ?? last.w52_high
          }
        />
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
          exportFilename={`${selectedSymbol || 'stock'}-sessions.csv`}
          maxHeightClass="max-h-[340px]"
        />
      </div>
    </div>
  );
};
