import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Star } from 'lucide-react';
import { HorizontalTurnoverBar, WeeklyHeatmapChart } from '../components/Charts';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { PeriodPicker, resolvePeriodRange, type PeriodMode } from '../components/PeriodPicker';
import { useWatchlist } from '../hooks/useWatchlist';
import type { AppLanguage, RangeSummaryRow, WeeklyTopRow } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';
import { biText } from '../utils/i18n';

interface TopTurnoverViewProps {
  dates: string[];
  equityOnly: boolean;
  lang: AppLanguage;
  onInspectSymbol: (symbol: string) => void;
}

type TurnoverQuickFilter = 'all' | 'gainers' | 'losers' | 'aboveVwap' | 'near52' | 'bigTicket';

export const TopTurnoverView: React.FC<TopTurnoverViewProps> = ({
  dates,
  equityOnly,
  lang,
  onInspectSymbol,
}) => {
  const [mode, setMode] = useState<PeriodMode>('last1');
  const [customStart, setCustomStart] = useState(
    dates[Math.max(0, dates.length - 6)] ?? ''
  );
  const [customEnd, setCustomEnd] = useState(dates[dates.length - 1] ?? '');
  const [limitN, setLimitN] = useState(15);
  const [quickFilter, setQuickFilter] = useState<TurnoverQuickFilter>('all');
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  const [rangeRows, setRangeRows] = useState<RangeSummaryRow[]>([]);
  const [marketTotalTurnover, setMarketTotalTurnover] = useState(0);
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
          setMarketTotalTurnover(data.marketTotalTurnover || 0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolved?.start, resolved?.end, limitN, equityOnly, mode]);

  const filteredRangeRows = useMemo(() => {
    return rangeRows.filter((r) => {
      if (quickFilter === 'gainers') return (r.change_pct ?? 0) > 0;
      if (quickFilter === 'losers') return (r.change_pct ?? 0) < 0;
      if (quickFilter === 'aboveVwap') return (r.vwap_pct ?? 0) > 0;
      if (quickFilter === 'near52')
        return r.gap_52h_pct !== null && r.gap_52h_pct !== undefined && r.gap_52h_pct <= 5;
      if (quickFilter === 'bigTicket') return (r.avg_trade_size ?? 0) >= 350_000;
      return true;
    });
  }, [rangeRows, quickFilter]);

  const summaryStats = useMemo(() => {
    const topTurn = rangeRows.reduce((s, r) => s + r.turnover, 0);
    const top5Turn = rangeRows.slice(0, 5).reduce((s, r) => s + r.turnover, 0);
    const topTrades = rangeRows.reduce((s, r) => s + r.trans, 0);
    const gainers = rangeRows.filter((r) => (r.change_pct ?? 0) > 0);
    const losers = rangeRows.filter((r) => (r.change_pct ?? 0) < 0);
    const upTurn = gainers.reduce((s, r) => s + r.turnover, 0);
    const downTurn = losers.reduce((s, r) => s + r.turnover, 0);
    const concentrationPct = marketTotalTurnover > 0 ? (topTurn / marketTotalTurnover) * 100 : 0;
    const top5SharePct = marketTotalTurnover > 0 ? (top5Turn / marketTotalTurnover) * 100 : 0;
    const avgTicket = topTrades > 0 ? topTurn / topTrades : 0;
    const bigTicketCount = rangeRows.filter((r) => (r.avg_trade_size ?? 0) >= 350_000).length;
    return {
      topTurn,
      concentrationPct,
      top5SharePct,
      gainersCount: gainers.length,
      losersCount: losers.length,
      upTurn,
      downTurn,
      avgTicket,
      bigTicketCount,
      leader: rangeRows[0] ?? null,
    };
  }, [rangeRows, marketTotalTurnover]);

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
      label: biText('Symbol', 'संकेत', lang),
      align: 'left',
      render: (r) => (
        <span className="font-semibold text-blue-600 dark:text-blue-400">{r.symbol}</span>
      ),
    },
    {
      key: 'name',
      label: biText('Company', 'कम्पनी', lang),
      align: 'left',
      render: (r) => (
        <span className="text-slate-600 dark:text-slate-300 truncate max-w-[200px] inline-block">
          {r.name || '–'}
        </span>
      ),
    },
    {
      key: 'turnover',
      label: biText('Turn (cr)', 'कारोबार (करोड)', lang),
      align: 'right',
      csvValue: (r) => (r.turnover / 1e7).toFixed(4),
      render: (r) => formatCrore(r.turnover),
    },
    ...(mode !== 'weekly'
      ? [
          {
            key: 'market_share_pct',
            label: biText('Share %', 'हिस्सा %', lang),
            align: 'right' as const,
            render: (r: RangeSummaryRow) =>
              r.market_share_pct !== undefined ? `${r.market_share_pct.toFixed(1)}%` : '–',
          },
        ]
      : []),
    {
      key: 'change_pct',
      label: biText('Chg %', 'परिवर्तन %', lang),
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
      key: 'vwap_pct',
      label: biText('vs VWAP', 'औसत मूल्य तुलना', lang),
      align: 'right',
      render: (r) => (
        <span
          className={
            (r.vwap_pct ?? 0) >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }
        >
          {formatPct(r.vwap_pct)}
        </span>
      ),
    },
    {
      key: 'avg_trade_size',
      label: biText('Rs/Trade', 'प्रति कारोबार', lang),
      align: 'right',
      render: (r) => {
        const val = r.avg_trade_size ?? (r.trans > 0 ? r.turnover / r.trans : 0);
        const isHigh = val >= 350_000;
        return (
          <span className={isHigh ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
            {formatInt(val)}
          </span>
        );
      },
    },
    {
      key: 'close_pos_pct',
      label: biText('Close Str', 'बन्द बल', lang),
      align: 'right',
      render: (r) =>
        r.close_pos_pct !== undefined ? `${r.close_pos_pct.toFixed(0)}%` : '–',
    },
    {
      key: 'up_days',
      label: biText('Up/Days', 'हरियो दिन', lang),
      align: 'right',
      render: (r) => `${r.up_days}/${r.days_traded}`,
    },
    {
      key: 'trans',
      label: biText('Trades', 'कारोबार संख्या', lang),
      align: 'right',
      render: (r) => formatInt(r.trans),
    },
    {
      key: 'end_price',
      label: biText('Close', 'अन्तिम मूल्य', lang),
      align: 'right',
      render: (r) => formatNum(r.end_price),
    },
  ];

  const weeklyCols: ColumnDef<WeeklyTopRow>[] = [
    { key: 'week_start', label: biText('Week Start', 'हप्ता सुरु', lang), align: 'left', render: (r) => <span className="font-mono">{r.week_start}</span> },
    { key: 'week_end', label: biText('Week End', 'हप्ता अन्त्य', lang), align: 'left', render: (r) => <span className="font-mono">{r.week_end}</span> },
    { key: 'rank', label: biText('Rank', 'क्रम', lang), align: 'right', render: (r) => r.rank },
    ...rangeCols,
  ];

  const filterButtons: Array<{ id: TurnoverQuickFilter; en: string; ne: string }> = [
    { id: 'all', en: `All Top ${limitN}`, ne: `सबै शीर्ष ${limitN}` },
    { id: 'gainers', en: 'Gainers', ne: 'बढेका' },
    { id: 'losers', en: 'Losers', ne: 'घटेका' },
    { id: 'aboveVwap', en: 'Above VWAP', ne: 'VWAP माथि' },
    { id: 'near52', en: 'Near 52w High', ne: '५२ हप्ता उच्च नजिक' },
    { id: 'bigTicket', en: 'Big Ticket (≥3.5L/tx)', ne: 'ठूलो टिकट' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {biText('Top Turnover Leaders', 'शीर्ष कारोबार गर्ने कम्पनीहरू', lang)}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {biText(
              'Measures liquidity concentration, VWAP control, ticket size (retail vs institutional), and price change anchored to pre-period close',
              'बजार तरलता केन्द्रिकरण, VWAP नियन्त्रण, प्रति-कारोबार आकार र अवधि अघिको बन्द मूल्यबाट वास्तविक परिवर्तन विश्लेषण',
              lang
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <label htmlFor="tt-limit" className="text-slate-600 dark:text-slate-400 font-medium">
            {biText('Top N', 'शीर्ष N', lang)}:{' '}
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
              {biText(
                'Trading weeks start on Monday (Mon–Fri). Matrix values show turnover in Rs crore.',
                'कारोबार हप्ता सोमबार–शुक्रबार आधारमा वर्गीकृत छ। म्याट्रिक्स मानहरू करोड रुपैयाँमा छन्।',
                lang
              )}
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
          {/* Top Turnover KPI & Concentration Strip */}
          {rangeRows.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {biText(`Top ${limitN} Turnover`, `शीर्ष ${limitN} कुल कारोबार`, lang)}
                </div>
                <div className="text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  Rs {formatCrore(summaryStats.topTurn)} cr
                </div>
                <div className="text-[11px] font-mono tabular-nums text-blue-600 dark:text-blue-400">
                  {summaryStats.concentrationPct.toFixed(1)}% {biText('of NEPSE turnover', 'कुल बजार हिस्सा', lang)} · Top 5: {summaryStats.top5SharePct.toFixed(1)}%
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {biText('Direction Split in Top N', 'शीर्ष N मा बढेका vs घटेका', lang)}
                </div>
                <div className="text-lg font-mono tabular-nums font-semibold">
                  <span className="text-emerald-600 dark:text-emerald-400">{summaryStats.gainersCount} ↑</span>
                  <span className="text-slate-400 mx-1.5">/</span>
                  <span className="text-red-600 dark:text-red-400">{summaryStats.losersCount} ↓</span>
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  +{formatCrore(summaryStats.upTurn, 1)} cr vs -{formatCrore(summaryStats.downTurn, 1)} cr
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {biText('Avg Ticket Size (Rs/Tx)', 'औसत प्रति-कारोबार रकम', lang)}
                </div>
                <div className="text-lg font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  Rs {formatInt(summaryStats.avgTicket)}
                </div>
                <div className="text-[11px] text-amber-600 dark:text-amber-400 font-mono tabular-nums">
                  {summaryStats.bigTicketCount} {biText('big-ticket names (≥3.5L/tx)', 'ठूलो टिकट स्टक', lang)}
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {biText('#1 Liquidity Magnet', 'सर्वाधिक कारोबार लिडर', lang)}
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
                        {formatPct(summaryStats.leader.change_pct)}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      Rs {formatCrore(summaryStats.leader.turnover)} cr ({summaryStats.leader.market_share_pct?.toFixed(1)}% share)
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-400">–</div>
                )}
              </div>
            </div>
          )}

          {/* Quick Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {filterButtons.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setQuickFilter(btn.id)}
                  className={`px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                    quickFilter === btn.id
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  {biText(btn.en, btn.ne, lang)}
                </button>
              ))}
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {filteredRangeRows.length} / {rangeRows.length} {biText('shown', 'देखाइएको', lang)}
            </span>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
            <HorizontalTurnoverBar
              items={filteredRangeRows.map((r) => ({
                symbol: r.symbol,
                turnover: r.turnover,
                pct: r.change_pct ?? 0,
              }))}
              onSelectSymbol={onInspectSymbol}
            />
          </div>

          <DataTable
            rows={filteredRangeRows}
            columns={rangeCols}
            rowKey={(r) => r.symbol}
            onRowClick={(r) => onInspectSymbol(r.symbol)}
            searchKeys={['symbol', 'name']}
            exportFilename={`nepse-top-turnover-${resolved?.end || 'latest'}.csv`}
            watchlistFilter={{ watchlist, getSymbol: (r) => r.symbol }}
          />
        </div>
      )}
    </div>
  );
};
