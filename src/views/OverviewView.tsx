import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Crosshair,
  Database,
  Flame,
  RefreshCw,
  Sparkles,
  Star,
  TrendingUp,
} from 'lucide-react';
import { HorizontalTurnoverBar, MarketHistoryCharts, TurnoverTreemap } from '../components/Charts';
import { createWatchlistColumn, DataTable, type ColumnDef } from '../components/DataTable';
import { FinancialsVaultPanel } from '../components/FinancialsVaultPanel';
import { InfoTip } from '../components/InfoTip';
import { useTradingSettings } from '../hooks/useTradingSettings';
import { useWatchlist } from '../hooks/useWatchlist';
import type { DailyAggregate, PriceRow, TopTurnoverEnhancedRow } from '../types/market';
import type { HighConvictionFeedResponse, QuantStockCandidate } from '../types/quant';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface OverviewViewProps {
  dates: string[];
  daily: DailyAggregate[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
  onInspectInQuant?: (symbol: string) => void;
  onInspectInAnalyzer?: (symbol: string) => void;
  onOpenScheduler: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  dates,
  daily,
  equityOnly,
  onInspectSymbol,
  onInspectInQuant,
  onInspectInAnalyzer,
  onOpenScheduler,
}) => {
  const { settings } = useTradingSettings();
  const nDays = settings.lookbackDays;
  const [selectedDay, setSelectedDay] = useState<string>(dates[dates.length - 1] ?? '');
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [unusualRows, setUnusualRows] = useState<TopTurnoverEnhancedRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [buyFeed, setBuyFeed] = useState<HighConvictionFeedResponse | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [horizonFilter, setHorizonFilter] = useState<'All' | 'Swing' | 'Positional'>('All');
  const [stage2Only, setStage2Only] = useState(false);
  const [catalystOnly, setCatalystOnly] = useState(false);
  const [refreshingCatalysts, setRefreshingCatalysts] = useState(false);
  const [catalystMsg, setCatalystMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [selectedFinSymbol, setSelectedFinSymbol] = useState<string | null>(null);
  const financialVaultRef = useRef<HTMLDivElement | null>(null);

  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  useEffect(() => {
    if (dates.length > 0 && (!selectedDay || !dates.includes(selectedDay))) {
      setSelectedDay(dates[dates.length - 1]);
    }
  }, [dates, selectedDay]);

  const loadBuyFeed = useCallback(async (day: string, eqOnly: boolean) => {
    if (!day) return;
    setFeedLoading(true);
    try {
      const res = await fetch(
        `/api/quant/high-conviction?asOf=${encodeURIComponent(day)}&equityOnly=${eqOnly}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as HighConvictionFeedResponse;
      setBuyFeed(json);
    } catch {
      setBuyFeed(null);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedDay) return;
    let cancelled = false;
    setLoading(true);
    setCatalystMsg(null);
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

    void loadBuyFeed(selectedDay, equityOnly);

    return () => {
      cancelled = true;
    };
  }, [selectedDay, equityOnly, nDays, loadBuyFeed]);

  const horizonCounts = useMemo(() => {
    const list = buyFeed?.feed ?? [];
    const base = list.filter((c) => {
      if (stage2Only && (c.stage2?.scoreOutOf8 ?? 0) < 6) return false;
      if (catalystOnly && !(c.fundamentalConfluence?.hasAudit)) return false;
      return true;
    });
    return {
      All: base.length,
      Swing: base.filter((c) => c.horizonTag === 'Swing' || c.horizonTag === 'Both').length,
      Positional: base.filter((c) => c.horizonTag === 'Positional' || c.horizonTag === 'Both').length,
    };
  }, [buyFeed, stage2Only, catalystOnly]);

  const filteredBuyFeed = useMemo((): QuantStockCandidate[] => {
    const list = buyFeed?.feed ?? [];
    const matching = list.filter((c) => {
      if (horizonFilter === 'Swing') {
        if (c.horizonTag !== 'Swing' && c.horizonTag !== 'Both') return false;
      } else if (horizonFilter === 'Positional') {
        if (c.horizonTag !== 'Positional' && c.horizonTag !== 'Both') return false;
      }
      if (stage2Only && (c.stage2?.scoreOutOf8 ?? 0) < 6) return false;
      if (catalystOnly && !(c.fundamentalConfluence?.hasAudit)) return false;
      return true;
    });

    if (horizonFilter === 'Swing') {
      matching.sort((a, b) => {
        const ap = a.horizonTag === 'Swing' ? 0 : 1;
        const bp = b.horizonTag === 'Swing' ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (b.convictionScore ?? b.technicalScore) - (a.convictionScore ?? a.technicalScore);
      });
    } else if (horizonFilter === 'Positional') {
      matching.sort((a, b) => {
        const ap = a.horizonTag === 'Positional' ? 0 : 1;
        const bp = b.horizonTag === 'Positional' ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (b.stage2?.scoreOutOf8 ?? 0) - (a.stage2?.scoreOutOf8 ?? 0) ||
          (b.convictionScore ?? b.technicalScore) - (a.convictionScore ?? a.technicalScore);
      });
    }

    return matching.slice(0, 12);
  }, [buyFeed, horizonFilter, stage2Only, catalystOnly]);

  const handleRefreshCatalysts = async () => {
    if (!buyFeed) return;
    const unaudited = (buyFeed.feed || [])
      .filter((c) => !c.fundamentalConfluence?.hasAudit)
      .slice(0, 5)
      .map((c) => c.symbol);
    const targets =
      unaudited.length > 0
        ? unaudited
        : filteredBuyFeed.slice(0, 5).map((c) => c.symbol);
    if (targets.length === 0) return;

    setRefreshingCatalysts(true);
    setCatalystMsg(null);
    try {
      const res = await fetch('/api/quant/refresh-catalysts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: targets, nDays }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const audited = Array.isArray(json.audited) ? json.audited : [];
      const okCount = audited.filter((a: { ok?: boolean }) => a.ok).length;
      const errEntry = audited.find((a: { ok?: boolean; error?: string }) => !a.ok && a.error);
      if (okCount === 0 && errEntry) {
        setCatalystMsg({ kind: 'err', text: `Catalyst audit unavailable: ${errEntry.error}` });
      } else {
        setCatalystMsg({
          kind: 'ok',
          text: `Updated live catalyst intel for ${okCount}/${targets.length} leaders (${targets.join(', ')}).`,
        });
      }
      await loadBuyFeed(selectedDay, equityOnly);
    } catch (err) {
      setCatalystMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to refresh stock catalysts',
      });
    } finally {
      setRefreshingCatalysts(false);
    }
  };

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

  const watchlistRows = useMemo(() => {
    if (!watchlist.length || !rows.length) return [];
    const map = new Map(rows.map((r) => [r.symbol, r]));
    return watchlist.map((s) => map.get(s)).filter((r): r is PriceRow => Boolean(r));
  }, [watchlist, rows]);

  const circuitAnd52wHighlights = useMemo(() => {
    const upperCircuits = rows
      .filter((r) => (r.diff_pct ?? 0) >= 9.0)
      .sort((a, b) => (b.diff_pct ?? 0) - (a.diff_pct ?? 0))
      .slice(0, 6);
    const near52wHigh = rows
      .filter((r) => r.w52_high !== null && r.w52_high > 0 && r.close >= r.w52_high * 0.985)
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, 6);
    return { upperCircuits, near52wHigh };
  }, [rows]);

  const jumpToFinancials = (symbol: string) => {
    setSelectedFinSymbol(symbol);
    financialVaultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const marketCols: ColumnDef<PriceRow>[] = useMemo(
    () => [
      createWatchlistColumn<PriceRow>({
        getSymbol: (r) => r.symbol,
        hasSymbol,
        toggleSymbol,
      }),
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

      {/* Session Breadth Ratio Gauge */}
      {agg && agg.companies > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Session Breadth Ratio ({selectedDay})
            </span>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                Adv {agg.advancers} ({((agg.advancers / agg.companies) * 100).toFixed(0)}%)
              </span>
              <span className="text-slate-500">Unch {agg.unchanged}</span>
              <span className="text-red-600 dark:text-red-400 font-semibold">
                Dec {agg.decliners} ({((agg.decliners / agg.companies) * 100).toFixed(0)}%)
              </span>
              <span className="text-slate-700 dark:text-slate-300 font-semibold">
                A/D {(agg.decliners > 0 ? agg.advancers / agg.decliners : agg.advancers).toFixed(2)}
              </span>
            </div>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800">
            <div
              className="bg-emerald-500 transition-all"
              style={{ width: `${(agg.advancers / agg.companies) * 100}%` }}
            />
            <div
              className="bg-slate-400 transition-all"
              style={{ width: `${(agg.unchanged / agg.companies) * 100}%` }}
            />
            <div
              className="bg-rose-500 transition-all"
              style={{ width: `${(agg.decliners / agg.companies) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* My Watchlist Live Pulse */}
      {watchlistRows.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              <span>My Watchlist Live Pulse ({watchlistRows.length})</span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">Click stock or action icons</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {watchlistRows.map((w) => (
              <div
                key={w.symbol}
                className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex items-center justify-between gap-2 text-xs"
              >
                <button
                  type="button"
                  onClick={() => onInspectSymbol(w.symbol)}
                  className="text-left min-w-0 cursor-pointer hover:underline"
                >
                  <div className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                    {w.symbol}
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                    {formatNum(w.close)}{' '}
                    <span className={(w.diff_pct ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {formatPct(w.diff_pct)}
                    </span>
                  </div>
                </button>
                <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
                  {onInspectInAnalyzer && (
                    <button
                      type="button"
                      onClick={() => onInspectInAnalyzer(w.symbol)}
                      title="Open in Auto Analyzer"
                      className="p-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      <Crosshair className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => jumpToFinancials(w.symbol)}
                    title="View Quarterly Financials"
                    className="p-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    <Database className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High-Conviction Asymmetric Buy Feed */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                High-Conviction Buy Feed (Stage-2 + Smart Money + Catalyst Confluence)
              </h3>
              <InfoTip
                title="Asymmetric Multi-Factor Conviction Engine"
                body="Ranks NEPSE equities by composite technical score, Minervini Stage-2 checklist (x/8), 10-day Pocket Pivot accumulation, institutional Rs/tx expansion, and audited fundamental catalysts — paired with causal NEPSE net R:R."
              />
            </div>
            {buyFeed && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                Regime: {buyFeed.regime} ({buyFeed.regimeScore.toFixed(0)}/100) · Target Equity Exposure: {buyFeed.recommendedExposureMinPct}–{buyFeed.recommendedExposureMaxPct}% · Audited Catalysts: {buyFeed.auditedSymbolsCount}/{buyFeed.totalValidCount}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5">
              {(['All', 'Swing', 'Positional'] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHorizonFilter(h)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    horizonFilter === h
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {h === 'All' ? `All Horizons (${horizonCounts.All})` : `${h} (${horizonCounts[h]})`}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer px-2 py-1">
              <input
                type="checkbox"
                checked={stage2Only}
                onChange={(e) => setStage2Only(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Stage-2 ≥ 6/8</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer px-2 py-1">
              <input
                type="checkbox"
                checked={catalystOnly}
                onChange={(e) => setCatalystOnly(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Catalyst-Backed</span>
            </label>

            <button
              type="button"
              onClick={handleRefreshCatalysts}
              disabled={refreshingCatalysts || feedLoading || !buyFeed?.feed.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingCatalysts ? 'animate-spin' : ''}`} />
              <span>{refreshingCatalysts ? 'Auditing Top 5…' : 'Refresh Top Catalysts'}</span>
            </button>
          </div>
        </div>

        {catalystMsg && (
          <div
            className={`px-3 py-2 rounded text-xs ${
              catalystMsg.kind === 'err'
                ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {catalystMsg.text}
          </div>
        )}

        {feedLoading ? (
          <div className="h-44 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-md" />
        ) : filteredBuyFeed.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No candidates match the selected Horizon / Stage-2 / Catalyst filters on {selectedDay}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 text-left font-medium">Stock · Horizon</th>
                  <th className="py-2 px-2 text-left font-medium">Gate · Setup</th>
                  <th className="py-2 px-2 text-right font-medium">Conviction</th>
                  <th className="py-2 px-2 text-right font-medium">Stage-2</th>
                  <th className="py-2 px-2 text-left font-medium">Accumulation Footprint</th>
                  <th className="py-2 px-2 text-right font-medium">Entry · Stop · T2 R:R</th>
                  <th className="py-2 px-2 text-left font-medium">Catalyst Confluence</th>
                  <th className="py-2 pl-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredBuyFeed.map((c) => {
                  const s2Score = c.stage2?.scoreOutOf8 ?? 0;
                  const gateCls =
                    c.classification === 'STRONG BUY CANDIDATE' || c.classification === 'BUY CANDIDATE'
                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                      : c.classification === 'WAIT FOR CONFIRMATION'
                        ? 'text-amber-600 dark:text-amber-400 font-semibold'
                        : 'text-slate-600 dark:text-slate-300';
                  return (
                    <tr key={c.symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onInspectSymbol(c.symbol)}
                            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {c.symbol}
                          </button>
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            · {c.horizonTag ?? 'Swing'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[165px]">
                          {c.sector} · LTP {formatNum(c.indicators.close)}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <div className={gateCls}>{c.classification}</div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {c.setupType === 'None' ? 'Watch' : `${c.setupType} · ${c.entryPlan.setupStatus}`}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {(c.convictionScore ?? c.technicalScore).toFixed(0)}/100
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Tech {c.technicalScore.toFixed(0)} · RS {c.indicators.rsPercentile.toFixed(0)}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                        <span className={s2Score >= 6 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}>
                          {s2Score}/8
                        </span>
                        {c.pocketPivot?.detected && (
                          <div className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">
                            Pocket Pivot {c.pocketPivot.volumeRatioVsMaxDown10.toFixed(1)}x
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-2">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {c.smartMoney?.label ?? c.indicators.accumulationPattern}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {c.smartMoney
                            ? `${c.smartMoney.avgTradeSizeMult20.toFixed(2)}x ticket · Up/Dn ${c.smartMoney.upDownVolRatio20.toFixed(2)}x`
                            : `RVOL ${c.indicators.relativeVolume.toFixed(2)}x`}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                        {c.exitPlan && c.positionSizing ? (
                          <>
                            <div className="text-slate-800 dark:text-slate-200">
                              {formatNum(c.positionSizing.plannedEntry)} / Stop {formatNum(c.exitPlan.initialStopLoss)}
                            </div>
                            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                              T2 1:{c.positionSizing.netRiskRewardT2} ({formatNum(c.exitPlan.target2)})
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">–</span>
                        )}
                      </td>

                      <td className="py-2.5 px-2 max-w-[230px]">
                        {c.fundamentalConfluence?.hasAudit ? (
                          <div>
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              Score {c.fundamentalConfluence.confluenceScore0to100}/100 · EPS {c.fundamentalConfluence.epsText}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {c.fundamentalConfluence.catalystTags.slice(0, 2).join(' · ') || c.fundamentalConfluence.summary}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            Price/Vol EOD only · click Refresh Top Catalysts
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {onInspectInQuant && (
                            <button
                              type="button"
                              onClick={() => onInspectInQuant(c.symbol)}
                              className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 font-medium hover:underline cursor-pointer"
                            >
                              <span>Decision Gate</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </button>
                          )}
                          {onInspectInAnalyzer && (
                            <button
                              type="button"
                              onClick={() => onInspectInAnalyzer(c.symbol)}
                              className="text-purple-600 dark:text-purple-400 font-medium hover:underline cursor-pointer"
                            >
                              Analyzer
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => jumpToFinancials(c.symbol)}
                            className="text-emerald-600 dark:text-emerald-400 font-medium hover:underline cursor-pointer"
                          >
                            Financials
                          </button>
                          <button
                            type="button"
                            onClick={() => onInspectSymbol(c.symbol)}
                            className="text-slate-600 dark:text-slate-300 hover:underline cursor-pointer"
                          >
                            Chart
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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

      {/* Circuit Leaders & Near 52-Week High Breakouts */}
      {(circuitAnd52wHighlights.upperCircuits.length > 0 || circuitAnd52wHighlights.near52wHigh.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>+9% / Circuit-Level Momentum ({selectedDay})</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400">Click to chart</span>
            </div>
            {circuitAnd52wHighlights.upperCircuits.length === 0 ? (
              <p className="text-xs text-slate-400">No stocks ≥ +9% in this session.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {circuitAnd52wHighlights.upperCircuits.map((r) => (
                  <button
                    key={r.symbol}
                    type="button"
                    onClick={() => onInspectSymbol(r.symbol)}
                    className="px-2.5 py-1.5 rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 text-xs font-mono hover:border-emerald-400 transition-colors cursor-pointer"
                  >
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{r.symbol}</span>{' '}
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      {formatPct(r.diff_pct)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Near 52-Week High Breakouts (within 1.5%)</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400">Sorted by turnover</span>
            </div>
            {circuitAnd52wHighlights.near52wHigh.length === 0 ? (
              <p className="text-xs text-slate-400">No stocks within 1.5% of 52-week high.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {circuitAnd52wHighlights.near52wHigh.map((r) => (
                  <button
                    key={r.symbol}
                    type="button"
                    onClick={() => onInspectSymbol(r.symbol)}
                    className="px-2.5 py-1.5 rounded border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 text-xs font-mono hover:border-blue-400 transition-colors cursor-pointer"
                  >
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{r.symbol}</span>{' '}
                    <span className="text-slate-600 dark:text-slate-300">Rs {formatNum(r.close)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quarterly Financials Vault (data/financial/) */}
      <div ref={financialVaultRef}>
        <FinancialsVaultPanel
          availableSymbols={sortedByTurnover.map((r) => r.symbol)}
          selectedSymbolExternal={selectedFinSymbol}
          onInspectChart={onInspectSymbol}
        />
      </div>

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
              Only {daily.length} trading day is loaded. Backfill 30–180 days to unlock Market History curves and all 8 technical scanners.
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
