import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Camera,
  CheckCircle2,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  Star,
  TrendingUp,
} from 'lucide-react';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { InfoTip } from '../components/InfoTip';
import { NepseTradePlanner } from '../components/NepseTradePlanner';
import { StockRiskOpportunitiesPanel } from '../components/StockRiskOpportunitiesPanel';
import { StockVisualAlerts } from '../components/StockVisualAlerts';
import {
  TradingViewChart,
  type ChartLevel,
  type TradingViewChartHandle,
} from '../components/TradingViewChart';
import { LOOKBACK_PRESETS, useTradingSettings } from '../hooks/useTradingSettings';
import { useWatchlist } from '../hooks/useWatchlist';
import type { ExplorerOverviewResponse } from '../types/fundamental';
import type { PriceRow, SymbolInfo } from '../types/market';
import { applyCorporateActionAdjustments } from '../utils/adjustedPrices';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface StockExplorerViewProps {
  dates: string[];
  equityOnly: boolean;
  initialSymbol?: string | null;
  onInspectInQuant?: (symbol: string) => void;
  onSymbolChange?: (symbol: string) => void;
}

function safeExternalHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    return null;
  }
  return null;
}

function postureTone(posture: ExplorerOverviewResponse['decisionPlaybook']['actionPosture']): string {
  switch (posture) {
    case 'High-Conviction Buy':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'Accumulate on Pullback':
      return 'text-blue-700 dark:text-blue-400';
    case 'Avoid / Capital Preservation':
      return 'text-rose-700 dark:text-rose-400';
    case 'Momentum Trade Only (Price > Fair Value)':
      return 'text-amber-700 dark:text-amber-400';
    default:
      return 'text-slate-700 dark:text-slate-300';
  }
}

function pillarBarColor(status: 'Strong' | 'Constructive' | 'Neutral' | 'Caution'): string {
  switch (status) {
    case 'Strong':
      return 'bg-emerald-600 dark:bg-emerald-500';
    case 'Constructive':
      return 'bg-blue-600 dark:bg-blue-500';
    case 'Neutral':
      return 'bg-amber-500';
    case 'Caution':
      return 'bg-rose-600 dark:bg-rose-500';
  }
}

export const StockExplorerView: React.FC<StockExplorerViewProps> = ({
  dates,
  equityOnly,
  initialSymbol,
  onInspectInQuant,
  onSymbolChange,
}) => {
  const { settings, updateSettings } = useTradingSettings();
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol || '');
  const [symbolFilter, setSymbolFilter] = useState<string>('');
  const [showSR, setShowSR] = useState(true);
  const [useAdjustedPrices, setUseAdjustedPrices] = useState(true);
  const [history, setHistory] = useState<PriceRow[]>([]);
  const [explorer, setExplorer] = useState<ExplorerOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingReports, setFetchingReports] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();
  const chartRef = useRef<TradingViewChartHandle | null>(null);

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

  const loadSymbolData = useCallback(async (sym: string, eqOnly: boolean) => {
    setLoading(true);
    setActionMsg(null);
    try {
      const [symRes, expRes] = await Promise.all([
        fetch(`/api/symbol/${encodeURIComponent(sym)}`),
        fetch(`/api/explorer/${encodeURIComponent(sym)}?equityOnly=${eqOnly}`),
      ]);
      if (symRes.ok) {
        const symJson = await symRes.json();
        setHistory(symJson.history || []);
      } else {
        setHistory([]);
      }
      if (expRes.ok) {
        const expJson = (await expRes.json()) as ExplorerOverviewResponse;
        setExplorer(expJson);
      } else {
        setExplorer(null);
      }
    } catch {
      setHistory([]);
      setExplorer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedSymbol) return;
    onSymbolChange?.(selectedSymbol);
    void loadSymbolData(selectedSymbol, equityOnly);
  }, [selectedSymbol, equityOnly, loadSymbolData]);

  const handleFetchReports = async () => {
    if (!selectedSymbol || fetchingReports) return;
    setFetchingReports(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/financials/${encodeURIComponent(selectedSymbol)}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      await loadSymbolData(selectedSymbol, equityOnly);
      setActionMsg(`Fetched latest quarterly reports for ${selectedSymbol}.`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Unable to fetch financial reports');
    } finally {
      setFetchingReports(false);
    }
  };

  const priceAdjustment = useMemo(
    () => applyCorporateActionAdjustments(history, explorer?.corporateActions ?? []),
    [history, explorer?.corporateActions]
  );

  const activeHistory =
    useAdjustedPrices && priceAdjustment.applied.length > 0
      ? priceAdjustment.adjustedHistory
      : history;

  const last = activeHistory[activeHistory.length - 1] ?? null;
  const nDays = settings.lookbackDays;

  const rollingMetrics = useMemo(() => {
    if (activeHistory.length === 0) return null;
    const windowRows = activeHistory.slice(-nDays);
    const priorRows = activeHistory.slice(0, -1).slice(-nDays);
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
  }, [activeHistory, nDays, last]);

  const srLevels = useMemo((): ChartLevel[] => {
    if (!showSR || !rollingMetrics || activeHistory.length <= 3) return [];
    return [
      { label: `${nDays}d Res`, value: rollingMetrics.resN, color: '#d97706' },
      { label: `${nDays}d Sup`, value: rollingMetrics.supN, color: '#16a34a' },
    ];
  }, [showSR, rollingMetrics, activeHistory.length, nDays]);

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
  const playbook = explorer?.decisionPlaybook ?? null;
  const fund = explorer?.fundamental ?? null;
  const km = fund?.summary.keyMetrics ?? null;
  const q4 = fund?.growth.q4Benchmark ?? null;
  const sectorAvg = explorer?.sectorBenchmark?.averages ?? null;

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
              <>
                <button
                  type="button"
                  onClick={() => toggleSymbol(selectedSymbol)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                    isStarred
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-500 text-amber-500' : ''}`} />
                  <span>{isStarred ? 'Starred' : 'Watchlist'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleFetchReports}
                  disabled={fetchingReports}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${fetchingReports ? 'animate-spin' : ''}`} />
                  <span>{fetchingReports ? 'Fetching…' : 'Fetch Reports'}</span>
                </button>
                {onInspectInQuant && (
                  <button
                    type="button"
                    onClick={() => onInspectInQuant(selectedSymbol)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>Quant Decision Gate</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
                {!loading && activeHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void chartRef.current?.exportPng()}
                    title="Export Stock Explorer chart & annotations as PNG"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Export PNG</span>
                  </button>
                )}
              </>
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

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
            <button
              type="button"
              onClick={() => setUseAdjustedPrices(true)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                useAdjustedPrices
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Bonus-Adjusted ({priceAdjustment.applied.length})
            </button>
            <button
              type="button"
              onClick={() => setUseAdjustedPrices(false)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                !useAdjustedPrices
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Raw Unadjusted
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">Window:</span>
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
            <span>{nDays}d S/R</span>
          </label>
        </div>
      </div>

      {actionMsg && (
        <div className="px-4 py-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200">
          {actionMsg}
        </div>
      )}

      {useAdjustedPrices && priceAdjustment.applied.length > 0 && (
        <div className="px-4 py-2 rounded-md border border-blue-200 dark:border-blue-900/70 bg-blue-50/60 dark:bg-blue-950/20 text-xs text-blue-800 dark:text-blue-300 flex flex-wrap items-center gap-2">
          <Scale className="w-3.5 h-3.5 shrink-0" />
          <span>
            Historical pre-ex-date OHLC prices adjusted for {priceAdjustment.applied.length} corporate action(s):{' '}
            {priceAdjustment.applied.map((a) => `${a.effectiveDate} (${a.label})`).join(' · ')}
          </span>
        </div>
      )}

      {/* 360° Fundamental + Technical Decision Playbook */}
      {explorer && playbook && (
        <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="space-y-1 max-w-3xl">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {explorer.symbol} · {explorer.companyName}
                </span>
                <span aria-hidden="true">·</span>
                <span>{explorer.sector}</span>
                {explorer.sectorBenchmark?.rankInSector && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Peer Rank #{explorer.sectorBenchmark.rankInSector}/{explorer.sectorBenchmark.rankedTotal}
                    </span>
                  </>
                )}
                {explorer.kbEntry?.creditRating.ratingGrade && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">
                      {explorer.kbEntry.creditRating.agency ?? 'Credit'} {explorer.kbEntry.creditRating.ratingGrade}
                    </span>
                  </>
                )}
              </div>
              <h3 className={`text-base font-bold ${postureTone(playbook.actionPosture)}`}>
                {playbook.actionPosture}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {playbook.summaryHeadline}
              </p>
            </div>

            <div className="flex items-center gap-5 shrink-0">
              <div className="text-right">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">360° Confluence</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {playbook.confluenceScore}
                  <span className="text-xs font-normal text-slate-400">/100</span>
                </div>
              </div>
              {playbook.fdSpreadPct !== null && (
                <div className="text-right">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Spread vs {playbook.benchmarkFdRatePct.toFixed(1)}% FD
                  </div>
                  <div
                    className={`text-lg font-bold font-mono tabular-nums ${
                      playbook.fdSpreadPct >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {playbook.fdSpreadPct >= 0 ? '+' : ''}
                    {playbook.fdSpreadPct.toFixed(2)}pp
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Operating Profit One-Off Caution Banner */}
          {fund?.growth.earningsQuality.hasNonOperatingCaution &&
            fund.growth.earningsQuality.cautionMessage && (
              <div className="px-4 py-3 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/25 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-semibold">
                    Earnings Quality Caution — Focus on Core Operating Profit
                  </div>
                  <p className="leading-relaxed">{fund.growth.earningsQuality.cautionMessage}</p>
                </div>
              </div>
            )}

          {/* 4 Decision Pillars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {playbook.pillars.map((p) => (
              <div
                key={p.key}
                className="border border-slate-200 dark:border-slate-800 rounded-md p-3 bg-slate-50/60 dark:bg-slate-950/40 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{p.label}</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {p.score.toFixed(0)} · {p.status}
                  </span>
                </div>
                <div className="h-1.5 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded ${pillarBarColor(p.status)}`}
                    style={{ width: `${Math.min(100, Math.max(4, p.score))}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                  {p.headline}
                </p>
              </div>
            ))}
          </div>

          {/* 3-Year 4th Quarter Baseline & Peer Fundamentals Strip */}
          {km && q4 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-1 text-xs">
              <div className="border border-slate-100 dark:border-slate-800 rounded-md p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Fair Value / MoS</div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums">
                  {km.intrinsicValue !== null ? `Rs ${km.intrinsicValue.toFixed(0)}` : '—'}
                </div>
                <div
                  className={`text-[11px] font-mono tabular-nums ${
                    (km.marginOfSafetyPct ?? 0) >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {km.marginOfSafetyPct !== null
                    ? `${km.marginOfSafetyPct >= 0 ? '+' : ''}${km.marginOfSafetyPct.toFixed(1)}% MoS`
                    : '—'}
                </div>
              </div>

              <div className="border border-slate-100 dark:border-slate-800 rounded-md p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  EPS vs {q4.yearsCount || 3}Y Q4 Avg
                </div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums">
                  {km.eps !== null ? `Rs ${km.eps.toFixed(2)}` : '—'}
                </div>
                <div
                  className={`text-[11px] font-mono tabular-nums ${
                    (q4.epsVsAvgPct ?? 0) >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {q4.epsVsAvgPct !== null
                    ? `${q4.epsVsAvgPct >= 0 ? '+' : ''}${q4.epsVsAvgPct.toFixed(1)}% vs Q4 Avg`
                    : q4.basisLabel}
                </div>
              </div>

              <div className="border border-slate-100 dark:border-slate-800 rounded-md p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Op. Profit vs {q4.yearsCount || 3}Y Q4
                </div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums">
                  {q4.currentAnnualizedOperatingProfitCr !== null
                    ? `${q4.currentAnnualizedOperatingProfitCr.toFixed(1)} Cr`
                    : km.operatingProfitCr !== null
                      ? `${km.operatingProfitCr.toFixed(1)} Cr`
                      : '—'}
                </div>
                <div
                  className={`text-[11px] font-mono tabular-nums ${
                    (q4.operatingProfitVsAvgPct ?? 0) >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {q4.operatingProfitVsAvgPct !== null
                    ? `${q4.operatingProfitVsAvgPct >= 0 ? '+' : ''}${q4.operatingProfitVsAvgPct.toFixed(1)}% vs Q4 Avg`
                    : '—'}
                </div>
              </div>

              <div className="border border-slate-100 dark:border-slate-800 rounded-md p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">P/E vs Sector</div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums">
                  {km.pe !== null ? `${km.pe.toFixed(1)}x` : '—'}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Sector {sectorAvg?.avgPe !== null && sectorAvg?.avgPe !== undefined ? `${sectorAvg.avgPe.toFixed(1)}x` : '—'}
                </div>
              </div>

              <div className="border border-slate-100 dark:border-slate-800 rounded-md p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">ROE vs Sector</div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums">
                  {km.roePct !== null ? `${km.roePct.toFixed(1)}%` : '—'}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Sector {sectorAvg?.avgRoePct !== null && sectorAvg?.avgRoePct !== undefined ? `${sectorAvg.avgRoePct.toFixed(1)}%` : '—'}
                </div>
              </div>

              <div className="border border-slate-100 dark:border-slate-800 rounded-md p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {km.nplPct !== null ? 'NPL / Balance' : 'Debt / Equity'}
                </div>
                <div className="mt-0.5 font-mono font-semibold tabular-nums">
                  {km.nplPct !== null
                    ? `${km.nplPct.toFixed(2)}%`
                    : km.debtToEquity !== null
                      ? `${km.debtToEquity.toFixed(2)}x`
                      : '—'}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  P/B {km.pb !== null ? `${km.pb.toFixed(2)}x` : '—'}
                </div>
              </div>
            </div>
          )}

          {/* Bull Points / Key Risks / Execution Playbook */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Core Thesis &amp; Bullish Confluence</span>
              </div>
              {playbook.bullPoints.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Fetch latest statements to surface bullish catalysts.
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                  {playbook.bullPoints.map((pt, i) => (
                    <li key={i} className="leading-snug">
                      • {pt}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Risk Checks, Overhangs &amp; Cautions</span>
              </div>
              {playbook.riskPoints.length === 0 ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  No major fundamental or regulatory risk flags triggered.
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                  {playbook.riskPoints.map((pt, i) => (
                    <li key={i} className="leading-snug">
                      • {pt}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex items-start gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <span>{playbook.executionGuidance}</span>
            </div>
          </div>
        </section>
      )}

      {/* Corporate Actions, Dividend History & Lock-In Overhangs */}
      {explorer && (explorer.corporateActions.length > 0 || explorer.lockInEvents.length > 0) && (
        <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Corporate Actions, Bonus / Dividends &amp; Lock-In Schedule
              </h3>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {explorer.corporateActions.length} corporate action(s) · {explorer.lockInEvents.length} lock-in window(s)
            </span>
          </div>

          {explorer.lockInEvents.length > 0 && (
            <div className="space-y-1.5">
              {explorer.lockInEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="px-3 py-2 rounded-md border border-amber-200 dark:border-amber-900/70 bg-amber-50/50 dark:bg-amber-950/20 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-amber-800 dark:text-amber-300">
                      {ev.shareholderCategory} Lock-In Expiry · {ev.unlockDate} ({ev.overhangTier})
                    </div>
                    <div className="text-slate-700 dark:text-slate-300">{ev.headline}</div>
                  </div>
                  <div className="font-mono tabular-nums text-right text-amber-700 dark:text-amber-300">
                    {typeof ev.daysRemaining === 'number'
                      ? ev.daysRemaining >= 0
                        ? `${ev.daysRemaining}d remaining`
                        : `${Math.abs(ev.daysRemaining)}d ago`
                      : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          {explorer.corporateActions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-medium">FY</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                    <th className="py-2 pr-3 font-medium text-right">Bonus %</th>
                    <th className="py-2 pr-3 font-medium text-right">Cash %</th>
                    <th className="py-2 pr-3 font-medium text-right">Right %</th>
                    <th className="py-2 pr-3 font-medium">Book Close / AGM</th>
                    <th className="py-2 font-medium">Disclosure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {explorer.corporateActions.slice(0, 8).map((act) => {
                    const href = safeExternalHref(act.sourceUrl);
                    return (
                      <tr key={act.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="py-2 pr-3 font-mono tabular-nums">{act.fiscalYear || '—'}</td>
                        <td className="py-2 pr-3 font-medium">{act.actionType}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {act.bonusPct !== null ? `${act.bonusPct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {act.cashPct !== null ? `${act.cashPct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {act.rightRatioPct !== null ? `${act.rightRatioPct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {act.bookClosureDate || act.agmDate || act.exDate || act.status}
                        </td>
                        <td className="py-2 text-slate-700 dark:text-slate-300 max-w-md truncate">
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                            >
                              {act.headline}
                            </a>
                          ) : (
                            act.headline
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

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
                  ? formatPct((last.close / last.d180 - 1) * 100)
                  : '–'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Visual Alert Engine */}
      {!loading && activeHistory.length >= 2 && (
        <StockVisualAlerts
          symbol={selectedSymbol}
          history={activeHistory}
          settings={settings}
          onUpdateSettings={updateSettings}
        />
      )}

      {/* Interactive Chart */}
      {loading ? (
        <div className="h-[470px] animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : (
        <TradingViewChart
          ref={chartRef}
          symbol={selectedSymbol}
          history={activeHistory}
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

      {/* NEPSE Position Size Calculator */}
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
          Recent Daily Sessions{useAdjustedPrices && priceAdjustment.applied.length > 0 ? ' (Bonus-Adjusted)' : ''}
        </h3>
        <DataTable
          rows={[...activeHistory].reverse().slice(0, 40)}
          columns={cols}
          rowKey={(r) => r.date}
          exportFilename={`${selectedSymbol || 'stock'}-sessions.csv`}
          maxHeightClass="max-h-[340px]"
        />
      </div>
    </div>
  );
};
