import React, { useEffect, useMemo, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { InfoTip } from '../components/InfoTip';
import { NepseTradePlanner } from '../components/NepseTradePlanner';
import { StockRiskOpportunitiesPanel } from '../components/StockRiskOpportunitiesPanel';
import { StockVisualAlerts } from '../components/StockVisualAlerts';
import { TradingViewChart, type ChartLevel } from '../components/TradingViewChart';
import { LOOKBACK_PRESETS, useTradingSettings } from '../hooks/useTradingSettings';
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
  const { settings, updateSettings } = useTradingSettings();
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol || '');
  const [symbolFilter, setSymbolFilter] = useState<string>('');
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
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        const list: SymbolInfo[] = d.symbols || [];
        setSymbols(list);
        if (list.length > 0 && (!selectedSymbol || !list.some((s) => s.symbol === selectedSymbol))) {
          const def = list.find((s) => s.symbol === 'NABIL')?.symbol || list[0].symbol;
          setSelectedSymbol(def);
        }
      })
      .catch(() => null);
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
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setHistory(d.history || []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  const last = history[history.length - 1] ?? null;
  const nDays = settings.lookbackDays;

  const rollingMetrics = useMemo(() => {
    if (history.length === 0) return null;
    const windowRows = history.slice(-nDays);
    const priorRows = history.slice(0, -1).slice(-nDays);
    const avgTurnoverN =
      windowRows.reduce((s, r) => s + r.turnover, 0) / Math.max(1, windowRows.length);
    const avgVolumeN =
      windowRows.reduce((s, r) => s + r.volume, 0) / Math.max(1, windowRows.length);
    const smaN = windowRows.reduce((s, r) => s + r.close, 0) / Math.max(1, windowRows.length);
    const firstClose = windowRows[0]?.close ?? last?.close ?? 0;
    const latestClose = last?.close ?? 0;
    const periodChgPct = firstClose > 0 ? ((latestClose - firstClose) / firstClose) * 100 : null;
    const resN =
      priorRows.length > 0 ? Math.max(...priorRows.map((r) => r.high)) : last?.high ?? 0;
    const supN =
      priorRows.length > 0 ? Math.min(...priorRows.map((r) => r.low)) : last?.low ?? 0;

    return {
      sampleCount: windowRows.length,
      avgTurnoverN,
      avgVolumeN,
      smaN,
      periodChgPct,
      resN,
      supN,
      volMult: avgVolumeN > 0 && last ? last.volume / avgVolumeN : 1,
      turnMult: avgTurnoverN > 0 && last ? last.turnover / avgTurnoverN : 1,
    };
  }, [history, nDays, last]);

  const srLevels = useMemo((): ChartLevel[] => {
    if (!showSR || !rollingMetrics || history.length <= 3) return [];
    return [
      { label: `${nDays}d Res`, value: rollingMetrics.resN, color: '#d97706' },
      { label: `${nDays}d Sup`, value: rollingMetrics.supN, color: '#16a34a' },
    ];
  }, [showSR, rollingMetrics, history.length, nDays]);

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

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">Rolling Window (N):</span>
            <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
              {LOOKBACK_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => updateSettings({ lookbackDays: preset })}
                  className={`px-2 py-1 rounded font-mono text-[11px] font-medium transition-colors ${
                    nDays === preset
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {preset}d
                </button>
              ))}
            </div>
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showSR}
              onChange={(e) => setShowSR(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            <span>{nDays}-day Support / Resistance</span>
          </label>
        </div>
      </div>

      {/* Latest Session KPIs */}
      {last && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">LTP / Close</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">NPR {formatNum(last.ltp || last.close)}</div>
            <div className={`text-xs font-mono ${last.diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatPct(last.diff_pct)}
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Volume ({nDays}d ×)</span>
              <InfoTip
                title="Volume vs N-Day Rolling Average"
                body={`Compares today's traded shares to the average over the last ${nDays} trading days. Spikes above 1.8x often signal fresh accumulation or distribution.`}
                example="5d reacts fast to sudden swings; 20d represents a normal 1-month NEPSE baseline."
              />
            </div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">{formatInt(last.volume)}</div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {rollingMetrics ? `${rollingMetrics.volMult.toFixed(2)}x of ${nDays}d avg` : '–'}
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Turnover (Rs cr)</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">{formatCrore(last.turnover)}</div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {rollingMetrics ? `${rollingMetrics.turnMult.toFixed(2)}x of ${nDays}d avg` : '–'}
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">{nDays}d Avg Turnover</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">
              {rollingMetrics ? `${formatCrore(rollingMetrics.avgTurnoverN)} cr` : '–'}
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {rollingMetrics ? `Avg Vol ${formatInt(rollingMetrics.avgVolumeN)}` : '–'}
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">52w High / Low</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums">
              {formatNum(last.w52_high, 1)} / {formatNum(last.w52_low, 1)}
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {rollingMetrics && rollingMetrics.periodChgPct !== null
                ? `${nDays}d Return ${formatPct(rollingMetrics.periodChgPct)}`
                : '–'}
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">vs MA120 / SMA{nDays}</div>
            <div className="mt-1 text-lg font-semibold font-mono tabular-nums">
              {ma120Delta !== null ? `${Number(ma120Delta) >= 0 ? '+' : ''}${ma120Delta}%` : '–'}
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {rollingMetrics ? `SMA(${nDays}): ${formatNum(rollingMetrics.smaN)}` : '–'}
            </div>
          </div>
        </div>
      )}

      {/* 52w & Intraday Microstructure Strip */}
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

      {/* Visual Alert Engine */}
      {!loading && history.length >= 2 && (
        <StockVisualAlerts
          symbol={selectedSymbol}
          history={history}
          settings={settings}
          onUpdateSettings={updateSettings}
        />
      )}

      {/* Free TradingView Interactive Chart (Full-Screen + Collapsible TA Sidebar) */}
      {loading ? (
        <div className="h-[470px] animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : (
        <TradingViewChart
          symbol={selectedSymbol}
          history={history}
          lookbackDays={nDays}
          levels={srLevels}
          showSR={showSR}
          onToggleSR={setShowSR}
          symbols={symbols}
          onSelectSymbol={setSelectedSymbol}
          watchlist={watchlist}
          isStarred={isStarred}
          onToggleStar={() => selectedSymbol && toggleSymbol(selectedSymbol)}
        />
      )}

      {/* NEPSE Position Size Calculator (Open by Default) */}
      {last && (
        <NepseTradePlanner
          symbol={selectedSymbol}
          lastClose={last.close}
          suggestedStop={rollingMetrics?.supN ?? last.low}
          suggestedTarget={rollingMetrics?.resN ?? last.w52_high}
        />
      )}

      {/* Live Risk & Opportunity Research */}
      {selectedSymbol && (
        <StockRiskOpportunitiesPanel
          symbol={selectedSymbol}
          companyName={last?.name || symbols.find((s) => s.symbol === selectedSymbol)?.name}
          autoLoad={false}
        />
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Recent Daily Sessions
        </h3>
        <DataTable
          rows={[...history].reverse().slice(0, 40)}
          columns={cols}
          rowKey={(r) => r.date}
          exportFilename={`${selectedSymbol || 'stock'}-sessions.csv`}
          maxHeightClass="max-h-[340px]"
        />
      </div>
    </div>
  );
};
