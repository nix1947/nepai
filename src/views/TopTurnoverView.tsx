import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Flame,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { HorizontalTurnoverBar, WeeklyHeatmapChart } from '../components/Charts';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { InfoTip } from '../components/InfoTip';
import { MiniSparkline } from '../components/MiniSparkline';
import { PeriodPicker, resolvePeriodRange, type PeriodMode } from '../components/PeriodPicker';
import { LOOKBACK_PRESETS, useTradingSettings } from '../hooks/useTradingSettings';
import { useWatchlist } from '../hooks/useWatchlist';
import type {
  TopTurnoverAnalyticsResponse,
  TopTurnoverEnhancedRow,
  TurnoverSignalType,
  WeeklyTopRow,
} from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface TopTurnoverViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

type TurnoverQuickFilter =
  | 'all'
  | 'rising_turnover'
  | 'volume_spike'
  | 'accumulation'
  | 'divergence'
  | 'declining_activity'
  | 'unusual_attention'
  | 'gainers'
  | 'losers';

const SIGNAL_META: Record<
  TurnoverSignalType,
  { label: string; cls: string }
> = {
  unusual_attention: {
    label: 'Unusual Attention',
    cls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
  },
  rising_turnover: {
    label: 'Rising Turnover',
    cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
  },
  volume_spike: {
    label: 'Volume Spike',
    cls: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
  },
  accumulation: {
    label: 'Accumulation',
    cls: 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800',
  },
  bullish_divergence: {
    label: 'Bullish Absorption',
    cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
  },
  bearish_divergence: {
    label: 'Vol-Price Divergence',
    cls: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',
  },
  declining_activity: {
    label: 'Declining Activity',
    cls: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
  },
};

export const TopTurnoverView: React.FC<TopTurnoverViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const { settings, updateSettings } = useTradingSettings();
  const [mode, setMode] = useState<PeriodMode>('last1');
  const [customStart, setCustomStart] = useState(
    dates[Math.max(0, dates.length - Math.min(dates.length, settings.lookbackDays))] ?? ''
  );
  const [customEnd, setCustomEnd] = useState(dates[dates.length - 1] ?? '');
  const [limitN, setLimitN] = useState(20);
  const [quickFilter, setQuickFilter] = useState<TurnoverQuickFilter>('all');
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  const [analytics, setAnalytics] = useState<TopTurnoverAnalyticsResponse | null>(null);
  const [weeklyData, setWeeklyData] = useState<{
    weeks: Array<{ label: string; map: Record<string, number> }>;
    rows: WeeklyTopRow[];
  }>({ weeks: [], rows: [] });
  const [loading, setLoading] = useState(false);

  const nDays = settings.lookbackDays;

  useEffect(() => {
    if (dates.length > 0) {
      if (!customEnd) setCustomEnd(dates[dates.length - 1]);
      if (!customStart) {
        setCustomStart(
          dates[Math.max(0, dates.length - (mode === 'weekly' ? 20 : nDays))]
        );
      }
    }
  }, [dates, customEnd, customStart, mode, nDays]);

  const resolved = resolvePeriodRange(dates, mode, customStart, customEnd);

  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    setLoading(true);
    const qs = `start=${encodeURIComponent(resolved.start)}&end=${encodeURIComponent(
      resolved.end
    )}&n=${limitN}&nDays=${nDays}&equityOnly=${equityOnly}`;

    const url =
      mode === 'weekly'
        ? `/api/weekly-turnover?${qs}`
        : `/api/top-turnover-analytics?${qs}`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (mode === 'weekly') {
          setWeeklyData({ weeks: data.weeks || [], rows: data.rows || [] });
        } else {
          setAnalytics(data);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAnalytics(null);
        setWeeklyData({ weeks: [], rows: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolved?.start, resolved?.end, limitN, nDays, equityOnly, mode]);

  const applyRollingWindow = (presetN: number) => {
    updateSettings({ lookbackDays: presetN });
    if (dates.length > 0) {
      const end = dates[dates.length - 1];
      const start = dates[Math.max(0, dates.length - presetN)];
      setCustomStart(start);
      setCustomEnd(end);
      setMode('custom');
    }
  };

  const rows = analytics?.rows ?? [];

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (quickFilter === 'gainers') return (r.change_pct ?? 0) > 0;
      if (quickFilter === 'losers') return (r.change_pct ?? 0) < 0;
      if (quickFilter === 'divergence') {
        return (
          r.signals.includes('bullish_divergence') ||
          r.signals.includes('bearish_divergence')
        );
      }
      if (quickFilter === 'all') return true;
      return r.signals.includes(quickFilter);
    });
  }, [rows, quickFilter]);

  const summaryStats = useMemo(() => {
    const marketTotalTurnover = analytics?.marketTotalTurnover ?? 0;
    const prevMarketTurn = analytics?.prevMarketTotalTurnover ?? null;
    const topTurn = rows.reduce((s, r) => s + r.turnover, 0);
    const top5Turn = rows.slice(0, 5).reduce((s, r) => s + r.turnover, 0);
    const topTrades = rows.reduce((s, r) => s + r.trans, 0);
    const gainers = rows.filter((r) => (r.change_pct ?? 0) > 0);
    const losers = rows.filter((r) => (r.change_pct ?? 0) < 0);
    const upTurn = gainers.reduce((s, r) => s + r.turnover, 0);
    const downTurn = losers.reduce((s, r) => s + r.turnover, 0);
    const concentrationPct = marketTotalTurnover > 0 ? (topTurn / marketTotalTurnover) * 100 : 0;
    const top5SharePct = marketTotalTurnover > 0 ? (top5Turn / marketTotalTurnover) * 100 : 0;
    const avgTicket = topTrades > 0 ? topTurn / topTrades : 0;
    const unusualCount = rows.filter(
      (r) =>
        r.turnover_vs_avg_n >= settings.turnoverSpikeMult ||
        r.volume_vs_avg_n >= settings.volumeSpikeMult
    ).length;
    const accumCount = rows.filter((r) => r.signals.includes('accumulation')).length;
    const mktDeltaVsPrevPct =
      prevMarketTurn && prevMarketTurn > 0
        ? ((marketTotalTurnover - prevMarketTurn) / prevMarketTurn) * 100
        : null;

    return {
      topTurn,
      concentrationPct,
      top5SharePct,
      gainersCount: gainers.length,
      losersCount: losers.length,
      upTurn,
      downTurn,
      avgTicket,
      unusualCount,
      accumCount,
      mktDeltaVsPrevPct,
      leader: rows[0] ?? null,
    };
  }, [rows, analytics, settings.turnoverSpikeMult, settings.volumeSpikeMult]);

  const weeklyOrder = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of weeklyData.rows) {
      totals.set(r.symbol, (totals.get(r.symbol) || 0) + r.turnover);
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
  }, [weeklyData.rows]);

  const enhancedCols: ColumnDef<TopTurnoverEnhancedRow>[] = [
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
        <div className="leading-tight">
          <span className="font-semibold text-blue-600 dark:text-blue-400">{r.symbol}</span>
          <span className="block text-[10px] text-slate-400 truncate max-w-[125px]">{r.sector}</span>
        </div>
      ),
    },
    {
      key: 'ltp',
      label: 'LTP',
      align: 'right',
      render: (r) => <span className="font-semibold">{formatNum(r.ltp)}</span>,
    },
    {
      key: 'change_pct',
      label: 'Chg %',
      align: 'right',
      render: (r) => {
        const val = r.change_pct ?? 0;
        const pos = val >= 0;
        return (
          <span
            className={`inline-flex items-center justify-end gap-0.5 font-medium ${
              pos
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {pos ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            <span>{formatPct(r.change_pct)}</span>
          </span>
        );
      },
    },
    {
      key: 'turnover',
      label: 'Turn (cr)',
      align: 'right',
      csvValue: (r) => (r.turnover / 1e7).toFixed(4),
      render: (r) => (
        <div className="leading-tight">
          <span className="font-semibold">{formatCrore(r.turnover)}</span>
          <span className="block text-[10px] text-slate-400">
            {r.market_share_pct?.toFixed(1)}% mkt
          </span>
        </div>
      ),
    },
    {
      key: 'turnover_vs_avg_n',
      label: `vs ${nDays}d Turn`,
      align: 'right',
      render: (r) => {
        const mult = r.turnover_vs_avg_n;
        const high = mult >= settings.turnoverSpikeMult;
        const low = mult <= 0.65;
        return (
          <div className="leading-tight">
            <span
              className={`font-semibold ${
                high
                  ? 'text-amber-600 dark:text-amber-400'
                  : low
                    ? 'text-slate-400'
                    : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              {mult.toFixed(2)}x
            </span>
            <span className="block text-[10px] text-slate-400">
              avg {formatCrore(r.avg_turnover_n)} cr
            </span>
          </div>
        );
      },
    },
    {
      key: 'turnover_vs_prev_pct',
      label: 'vs Prior',
      align: 'right',
      render: (r) => {
        if (r.turnover_vs_prev_pct === null) return <span className="text-slate-400">–</span>;
        const pos = r.turnover_vs_prev_pct >= 0;
        return (
          <span
            className={
              pos
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }
          >
            {pos ? '+' : ''}
            {r.turnover_vs_prev_pct.toFixed(0)}%
          </span>
        );
      },
    },
    {
      key: 'volume',
      label: 'Volume',
      align: 'right',
      render: (r) => (
        <div className="leading-tight">
          <span>{formatInt(r.volume)}</span>
          <span
            className={`block text-[10px] ${
              r.volume_vs_avg_n >= settings.volumeSpikeMult
                ? 'text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-slate-400'
            }`}
          >
            {r.volume_vs_avg_n.toFixed(1)}x {nDays}d vol
          </span>
        </div>
      ),
    },
    {
      key: 'price_vs_avg_n_pct',
      label: `vs ${nDays}d Price`,
      align: 'right',
      render: (r) => (
        <span
          className={
            (r.price_vs_avg_n_pct ?? 0) >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }
        >
          {formatPct(r.price_vs_avg_n_pct)}
        </span>
      ),
    },
    {
      key: 'sparkline',
      label: 'Trend',
      align: 'right',
      sortable: false,
      render: (r) => (
        <MiniSparkline
          values={r.sparkline_close}
          positive={(r.change_pct ?? 0) >= 0}
        />
      ),
    },
    {
      key: 'insight',
      label: 'Signal & Context',
      align: 'left',
      sortable: false,
      render: (r) => {
        const primary = r.signals[0];
        const meta = primary ? SIGNAL_META[primary] : null;
        return (
          <div className="max-w-[230px] space-y-0.5 text-left font-sans">
            {meta && (
              <span
                className={`inline-block px-1.5 py-0.5 text-[10px] font-medium border rounded ${meta.cls}`}
              >
                {meta.label}
              </span>
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug line-clamp-2">
              {r.insight}
            </p>
          </div>
        );
      },
    },
  ];

  const weeklyCols: ColumnDef<WeeklyTopRow>[] = [
    { key: 'week_start', label: 'Week Start', align: 'left', render: (r) => <span className="font-mono">{r.week_start}</span> },
    { key: 'week_end', label: 'Week End', align: 'left', render: (r) => <span className="font-mono">{r.week_end}</span> },
    { key: 'rank', label: 'Rank', align: 'right', render: (r) => r.rank },
    {
      key: 'symbol',
      label: 'Symbol',
      align: 'left',
      render: (r) => <span className="font-semibold text-blue-600 dark:text-blue-400">{r.symbol}</span>,
    },
    { key: 'name', label: 'Company', align: 'left', render: (r) => <span className="truncate max-w-[180px] inline-block">{r.name || '–'}</span> },
    { key: 'ltp', label: 'LTP', align: 'right', render: (r) => formatNum(r.ltp ?? r.end_price) },
    { key: 'turnover', label: 'Turn (cr)', align: 'right', render: (r) => formatCrore(r.turnover) },
    {
      key: 'change_pct',
      label: 'Chg %',
      align: 'right',
      render: (r) => (
        <span className={(r.change_pct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          {formatPct(r.change_pct)}
        </span>
      ),
    },
    { key: 'volume', label: 'Volume', align: 'right', render: (r) => formatInt(r.volume) },
    { key: 'trans', label: 'Trades', align: 'right', render: (r) => formatInt(r.trans) },
  ];

  const filterButtons: Array<{
    id: TurnoverQuickFilter;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count: number;
  }> = [
    { id: 'all', label: `All Top ${limitN}`, icon: Activity, count: rows.length },
    {
      id: 'rising_turnover',
      label: 'Rising Turnover',
      icon: TrendingUp,
      count: rows.filter((r) => r.signals.includes('rising_turnover')).length,
    },
    {
      id: 'volume_spike',
      label: 'Volume Spike',
      icon: Flame,
      count: rows.filter((r) => r.signals.includes('volume_spike')).length,
    },
    {
      id: 'accumulation',
      label: 'Accumulation',
      icon: Sparkles,
      count: rows.filter((r) => r.signals.includes('accumulation')).length,
    },
    {
      id: 'divergence',
      label: 'Price-Vol Divergence',
      icon: AlertTriangle,
      count: rows.filter(
        (r) =>
          r.signals.includes('bullish_divergence') ||
          r.signals.includes('bearish_divergence')
      ).length,
    },
    {
      id: 'unusual_attention',
      label: 'Unusual Attention',
      icon: Flame,
      count: rows.filter((r) => r.signals.includes('unusual_attention')).length,
    },
    {
      id: 'declining_activity',
      label: 'Declining Activity',
      icon: TrendingDown,
      count: rows.filter((r) => r.signals.includes('declining_activity')).length,
    },
    {
      id: 'gainers',
      label: 'Gainers',
      icon: ArrowUpRight,
      count: rows.filter((r) => (r.change_pct ?? 0) > 0).length,
    },
    {
      id: 'losers',
      label: 'Losers',
      icon: ArrowDownRight,
      count: rows.filter((r) => (r.change_pct ?? 0) < 0).length,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Top Turnover &amp; Liquidity Intelligence
            </h2>
            <InfoTip
              title="How N-Day Rolling Turnover Comparisons Work"
              body={`Each stock's daily turnover, volume, and price in the selected period are compared against its ${nDays}-day rolling historical average (configured in Settings or the N preset buttons).`}
              example={`A reading of 2.5x means today's turnover is 250% of its ${nDays}-day average. Using N=5 reacts fast to swing moves; N=20 filters noise against a 1-month NEPSE baseline.`}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Track LTP, turnover multiples vs {nDays}-day average, prior-period shifts, accumulation patterns, and volume-price divergence
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">Baseline N:</span>
            <InfoTip
              title="Choosing Rolling Window N"
              body="5-day averages capture short-term momentum shifts immediately. 20-day (~1 NEPSE month) is standard for institutional comparisons. 50–100 days highlight long-term regime changes."
              example="Switching from N=20 to N=5 lowers the baseline memory so only the last week's activity sets 'normal'."
            />
            <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
              {LOOKBACK_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => updateSettings({ lookbackDays: n })}
                  className={`px-2 py-1 rounded font-mono text-[11px] font-medium transition-colors ${
                    nDays === n
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {n}d
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyRollingWindow(nDays)}
                className="px-2 py-1 rounded font-mono text-[11px] text-blue-600 dark:text-blue-400 hover:bg-white/70 dark:hover:bg-slate-900/70"
                title={`Set range filter to last ${nDays} sessions`}
              >
                Use {nDays}d range
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="tt-limit" className="text-slate-600 dark:text-slate-400 font-medium">
              Top:{' '}
              <span className="font-mono text-slate-900 dark:text-slate-100">{limitN}</span>
            </label>
            <input
              id="tt-limit"
              type="range"
              min={5}
              max={50}
              step={5}
              value={limitN}
              onChange={(e) => setLimitN(Number(e.target.value))}
              className="w-24 accent-blue-600"
            />
          </div>
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
        includeShortWindows
      />

      {loading ? (
        <div className="h-72 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : mode === 'weekly' ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              NEPSE trading weeks start on Monday. Heatmap values show weekly turnover in Rs crore.
            </p>
            <WeeklyHeatmapChart weeks={weeklyData.weeks} symbols={weeklyOrder} />
          </div>
          <DataTable
            rows={weeklyData.rows}
            columns={weeklyCols}
            rowKey={(r) => `${r.week_start}-${r.symbol}`}
            onRowClick={(r) => onInspectSymbol(r.symbol)}
            searchKeys={['symbol', 'name']}
            exportFilename={`nepse-weekly-turnover-${resolved?.end || 'latest'}.csv`}
            watchlistFilter={{ watchlist, getSymbol: (r) => r.symbol }}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Plain-English Automated Insights Strip */}
          {analytics && analytics.insights.length > 0 && (
            <div className="border border-blue-200 dark:border-blue-900/60 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Period Liquidity Takeaways ({nDays}-Day Rolling Baseline)</span>
                </div>
                {analytics.prevStart && analytics.prevEnd && (
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    Compared vs prior window: {analytics.prevStart === analytics.prevEnd ? analytics.prevEnd : `${analytics.prevStart} → ${analytics.prevEnd}`}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300">
                {analytics.insights.map((line, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0" />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPI Strip */}
          {rows.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Top {limitN} Turnover</span>
                  <InfoTip
                    title="Turnover Concentration"
                    body="Shows how much of the entire NEPSE session turnover is concentrated inside the top N most active stocks."
                    example="When Top 5 share exceeds 30%, institutional capital is rotating into narrow leaders rather than broad rallies."
                    align="right"
                  />
                </div>
                <div className="text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  Rs {formatCrore(summaryStats.topTurn)} cr
                </div>
                <div className="text-[11px] font-mono tabular-nums text-blue-600 dark:text-blue-400">
                  {summaryStats.concentrationPct.toFixed(1)}% of NEPSE · Top 5: {summaryStats.top5SharePct.toFixed(1)}%
                  {summaryStats.mktDeltaVsPrevPct !== null && (
                    <span className={summaryStats.mktDeltaVsPrevPct >= 0 ? ' text-emerald-600 dark:text-emerald-400' : ' text-red-600 dark:text-red-400'}>
                      {' '}· {summaryStats.mktDeltaVsPrevPct >= 0 ? '+' : ''}{summaryStats.mktDeltaVsPrevPct.toFixed(0)}% vs prior
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Direction Split in Top {limitN}
                </div>
                <div className="text-lg font-mono tabular-nums font-semibold">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {summaryStats.gainersCount} ↑
                  </span>
                  <span className="text-slate-400 mx-1.5">/</span>
                  <span className="text-red-600 dark:text-red-400">
                    {summaryStats.losersCount} ↓
                  </span>
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  +{formatCrore(summaryStats.upTurn, 1)} cr vs -{formatCrore(summaryStats.downTurn, 1)} cr
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Unusual Activity ({nDays}d Base)</span>
                  <InfoTip
                    title="Unusual Activity & Accumulation"
                    body={`Counts leaders currently trading at ≥${settings.turnoverSpikeMult}x their ${nDays}-day turnover average or ≥${settings.volumeSpikeMult}x volume average.`}
                    align="right"
                  />
                </div>
                <div className="text-lg font-mono tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                  {summaryStats.unusualCount} spikes · {summaryStats.accumCount} accum
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Avg ticket: Rs {formatInt(summaryStats.avgTicket)}/tx
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  #1 Liquidity Magnet
                </div>
                {summaryStats.leader ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onInspectSymbol(summaryStats.leader!.symbol)}
                        className="inline-flex items-center gap-1 text-lg font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <span>{summaryStats.leader.symbol}</span>
                        <ArrowUpRight className="w-4 h-4" />
                      </button>
                      <span
                        className={`text-xs font-mono font-semibold ${
                          (summaryStats.leader.change_pct ?? 0) >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        LTP {formatNum(summaryStats.leader.ltp)} ({formatPct(summaryStats.leader.change_pct)})
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      Rs {formatCrore(summaryStats.leader.turnover)} cr ·{' '}
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        {summaryStats.leader.turnover_vs_avg_n.toFixed(1)}x {nDays}d avg
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-400">–</div>
                )}
              </div>
            </div>
          )}

          {/* Intelligent Signal Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {filterButtons.map((btn) => {
                const Icon = btn.icon;
                const active = quickFilter === btn.id;
                return (
                  <button
                    key={btn.id}
                    type="button"
                    onClick={() => setQuickFilter(btn.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{btn.label}</span>
                    <span className="font-mono text-[10px] opacity-75">({btn.count})</span>
                  </button>
                );
              })}
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {filteredRows.length} / {rows.length} shown
            </span>
          </div>

          {/* Horizontal Bar Visual Comparison */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Comparative Turnover Ranking (Rs crore · green = net gainers, red = net decliners)
              </span>
              <span className="text-slate-400 font-mono">Click any bar to inspect chart</span>
            </div>
            <HorizontalTurnoverBar
              items={filteredRows.map((r) => ({
                symbol: r.symbol,
                turnover: r.turnover,
                pct: r.change_pct ?? 0,
              }))}
              onSelectSymbol={onInspectSymbol}
            />
          </div>

          <DataTable
            rows={filteredRows}
            columns={enhancedCols}
            rowKey={(r) => r.symbol}
            onRowClick={(r) => onInspectSymbol(r.symbol)}
            searchKeys={['symbol', 'name', 'sector', 'insight']}
            exportFilename={`nepse-top-turnover-${resolved?.end || 'latest'}.csv`}
            watchlistFilter={{ watchlist, getSymbol: (r) => r.symbol }}
          />
        </div>
      )}
    </div>
  );
};
