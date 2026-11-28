import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CandlestickChart,
  Crosshair,
  FileText,
  Flame,
  Grid2x2,
  Layers,
  RotateCcw,
  Scale,
  TrendingDown,
  Zap,
} from 'lucide-react';
import type {
  HomepageHeatmapStock,
  HomepagePulseResponse,
  HomepageScriptSpotlight,
  HomepageSectorHeatmapRow,
  HomepageTopTurnoverRow,
  HomepageUnusualStockRow,
} from '../../types/market';

interface HomepageMarketCommandProps {
  data: HomepagePulseResponse | null;
  loading: boolean;
  selectedDate: string | null;
  latestDate: string | null;
  onSelectDate: (date: string | null) => void;
  onOpenValuation: (symbol: string) => void;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer: (symbol: string) => void;
  onOpenAnnualReports?: (symbol: string) => void;
}

function fmtCr(npr: number | null | undefined, digits = 1): string {
  if (npr === null || npr === undefined || !Number.isFinite(npr)) return '—';
  return `Rs ${(npr / 1e7).toFixed(digits)} Cr`;
}

function fmtVol(shares: number | null | undefined): string {
  if (shares === null || shares === undefined || !Number.isFinite(shares)) return '—';
  if (shares >= 1e7) return `${(shares / 1e7).toFixed(2)} Cr`;
  if (shares >= 1e5) return `${(shares / 1e5).toFixed(2)} L`;
  return Math.round(shares).toLocaleString();
}

function fmtRs(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `Rs ${v.toFixed(digits)}`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function fmtTicket(npr: number | null | undefined): string {
  if (npr === null || npr === undefined || !Number.isFinite(npr) || npr <= 0) return '—';
  if (npr >= 1e5) return `Rs ${(npr / 1e5).toFixed(2)}L`;
  return `Rs ${Math.round(npr / 1000)}k`;
}

function heatTileClass(pct: number): string {
  if (pct >= 4) {
    return 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700';
  }
  if (pct >= 1.5) {
    return 'bg-emerald-500/90 text-white border-emerald-600 hover:bg-emerald-600';
  }
  if (pct > 0) {
    return 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-200/80 dark:hover:bg-emerald-900/60';
  }
  if (pct <= -4) {
    return 'bg-rose-600 text-white border-rose-700 hover:bg-rose-700';
  }
  if (pct <= -1.5) {
    return 'bg-rose-500/90 text-white border-rose-600 hover:bg-rose-600';
  }
  if (pct < 0) {
    return 'bg-rose-100 dark:bg-rose-950/60 text-rose-900 dark:text-rose-200 border-rose-200 dark:border-rose-800 hover:bg-rose-200/80 dark:hover:bg-rose-900/60';
  }
  return 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700';
}

function deltaTextClass(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'text-slate-500 dark:text-slate-400';
  if (pct > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (pct < 0) return 'text-rose-600 dark:text-rose-400';
  return 'text-slate-500 dark:text-slate-400';
}

function RangeBar({ pct, isBull }: { pct: number; isBull: boolean }) {
  const clamped = Math.max(4, Math.min(100, pct));
  return (
    <div className="w-full flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            isBull ? 'bg-emerald-500' : 'bg-rose-500'
          }`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400 w-7 text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

export const HomepageMarketCommand: React.FC<HomepageMarketCommandProps> = ({
  data,
  loading,
  selectedDate,
  latestDate,
  onSelectDate,
  onOpenValuation,
  onInspectSymbol,
  onInspectInAnalyzer,
  onOpenAnnualReports,
}) => {
  const [stripMetric, setStripMetric] = useState<'turnover' | 'volume'>('turnover');
  const [hoveredHistoryIdx, setHoveredHistoryIdx] = useState<number | null>(null);
  const [blowIdx, setBlowIdx] = useState(0);
  const [shortIdx, setShortIdx] = useState(0);
  const [heatmapMode, setHeatmapMode] = useState<'sectors' | 'stocks'>('sectors');
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [hoveredStock, setHoveredStock] = useState<HomepageHeatmapStock | null>(null);
  const [unusualFilter, setUnusualFilter] = useState<'all' | 'bull' | 'bear'>('all');

  const blowoutList = data?.blowoutScripts ?? [];
  const shortList = data?.shortScripts ?? [];
  const activeBlow = blowoutList[Math.min(blowIdx, Math.max(0, blowoutList.length - 1))] ?? null;
  const activeShort = shortList[Math.min(shortIdx, Math.max(0, shortList.length - 1))] ?? null;

  const filteredUnusual = useMemo(() => {
    const list = data?.unusualActivity ?? [];
    if (unusualFilter === 'bull') {
      return list.filter((u) => u.diffPct >= 0 && u.activityTag !== 'Heavy Distribution');
    }
    if (unusualFilter === 'bear') {
      return list.filter(
        (u) =>
          u.diffPct < 0 ||
          u.activityTag === 'Heavy Distribution' ||
          u.activityTag === 'Wick Churn / Trap'
      );
    }
    return list;
  }, [data?.unusualActivity, unusualFilter]);

  const sectorStocks = useMemo(() => {
    if (!data || !selectedSector) return [];
    return data.stockHeatmap.filter((s) => s.sector === selectedSector);
  }, [data, selectedSector]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-52 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-56 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-56 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary, historyStrip, topTurnoverUp, topTurnoverDown, sectorHeatmap, stockHeatmap, wowInsights } =
    data;

  const totalDirectionalTurn = Math.max(1, summary.upTurnover + summary.downTurnover);
  const upSharePct = (summary.upTurnover / totalDirectionalTurn) * 100;
  const breadthTotal = Math.max(1, summary.advancers + summary.decliners + summary.unchanged);
  const advPct = (summary.advancers / breadthTotal) * 100;
  const decPct = (summary.decliners / breadthTotal) * 100;

  const maxStripVal = Math.max(
    1,
    ...historyStrip.map((h) => (stripMetric === 'turnover' ? h.turnover : h.volume))
  );
  const avgStripVal =
    stripMetric === 'turnover' ? summary.avgNdTurnover : summary.avgNdVolume;
  const avgLineBottomPct = Math.min(92, Math.max(8, (avgStripVal / maxStripVal) * 100));

  const inspectedHist =
    hoveredHistoryIdx !== null && historyStrip[hoveredHistoryIdx]
      ? historyStrip[hoveredHistoryIdx]
      : historyStrip[historyStrip.length - 1] ?? null;

  const isHistoricalView = Boolean(selectedDate && latestDate && selectedDate !== latestDate);

  const renderSpotlightPanel = (
    title: string,
    subtitle: string,
    candidates: HomepageScriptSpotlight[],
    active: HomepageScriptSpotlight | null,
    activeIndex: number,
    onPick: (i: number) => void,
    isBull: boolean
  ) => (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isBull ? (
              <Flame className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <TrendingDown className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
        </div>

        {candidates.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {candidates.map((c, idx) => (
              <button
                key={c.symbol}
                type="button"
                onClick={() => onPick(idx)}
                className={`px-2 py-1 text-[11px] font-mono font-semibold rounded border transition-colors whitespace-nowrap shrink-0 ${
                  idx === activeIndex
                    ? isBull
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-rose-600 bg-rose-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {c.symbol} {fmtPct(c.diffPct, 1)}
              </button>
            ))}
          </div>
        )}
      </div>

      {active ? (
        <div className="p-4 space-y-3.5 flex-1 flex flex-col justify-between">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <button
                    type="button"
                    onClick={() => onOpenValuation(active.symbol)}
                    className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    {active.symbol}
                  </button>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {active.name}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2">
                  <span>{active.sector}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-semibold ${
                      isBull
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {active.setupLabel}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">Score {active.score.toFixed(0)}</span>
                </div>
              </div>

              <div className="text-right font-mono tabular-nums shrink-0">
                <div className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {fmtRs(active.ltp, 0)}
                </div>
                <div className={`text-xs font-semibold ${deltaTextClass(active.diffPct)}`}>
                  {fmtPct(active.diffPct, 2)}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              {active.headline}
            </p>

            {active.triggers.length > 0 && (
              <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-1">
                {active.triggers.map((t, i) => (
                  <React.Fragment key={t}>
                    {i > 0 && (
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                        ·
                      </span>
                    )}
                    <span className="font-mono">{t}</span>
                  </React.Fragment>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Volume &amp; Spike</div>
                <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {fmtVol(active.volume)} ({active.volumeMultN.toFixed(1)}x)
                </div>
                <div className={`font-mono text-[10px] tabular-nums ${deltaTextClass(active.volumeVsPrevPct)}`}>
                  vs Prev {fmtPct(active.volumeVsPrevPct, 0)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Turnover &amp; Spike</div>
                <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {fmtCr(active.turnover, 2)} ({active.turnoverMultN.toFixed(1)}x)
                </div>
                <div className={`font-mono text-[10px] tabular-nums ${deltaTextClass(active.turnoverVsPrevPct)}`}>
                  vs Prev {fmtPct(active.turnoverVsPrevPct, 0)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">VWAP &amp; Ticket</div>
                <div className={`font-mono font-semibold tabular-nums ${deltaTextClass(active.vwapPct)}`}>
                  {fmtPct(active.vwapPct, 1)} VWAP
                </div>
                <div className="font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                  Avg {fmtTicket(active.avgTradeSize)}/tx
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">Day Range Close</div>
                <div className="mt-1">
                  <RangeBar pct={active.closePosPct} isBull={isBull} />
                </div>
                <div className="font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                  Swing {active.rangePct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onInspectSymbol(active.symbol)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <CandlestickChart className="w-3.5 h-3.5" />
              <span>Chart</span>
            </button>
            <button
              type="button"
              onClick={() => onInspectInAnalyzer(active.symbol)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Trade Plan</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenValuation(active.symbol)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 whitespace-nowrap shrink-0"
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Valuation</span>
            </button>
            {onOpenAnnualReports && (
              <button
                type="button"
                onClick={() => onOpenAnnualReports(active.symbol)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Annual</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="p-6 text-xs text-slate-500 dark:text-slate-400 text-center">
          No liquid candidates matched this side on {summary.date}.
        </div>
      )}
    </div>
  );

  const renderTopTurnoverColumn = (
    title: string,
    subtitle: string,
    rows: HomepageTopTurnoverRow[],
    isUp: boolean
  ) => (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            {isUp ? (
              <ArrowUpRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="font-mono text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
          {fmtCr(isUp ? summary.upTurnover : summary.downTurnover, 1)} total
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-xs text-slate-500 text-center">
          No {isUp ? 'advancing' : 'declining'} turnover leaders on {summary.date}.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="text-left font-medium px-3 py-2">Script</th>
                <th className="text-right font-medium px-2.5 py-2">LTP / %</th>
                <th className="text-right font-medium px-2.5 py-2">Turnover (Share)</th>
                <th className="text-right font-medium px-2.5 py-2">vs Prev / Avg</th>
                <th className="text-right font-medium px-3 py-2 w-24">Close Pos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr
                  key={r.symbol}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-slate-400 w-4">
                        {r.rank}.
                      </span>
                      <button
                        type="button"
                        onClick={() => onInspectSymbol(r.symbol)}
                        className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {r.symbol}
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 pl-5 truncate max-w-[140px]">
                      {r.sector}
                    </div>
                  </td>
                  <td className="px-2.5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {fmtRs(r.ltp)}
                    </div>
                    <div className={`text-[11px] font-semibold ${deltaTextClass(r.diffPct)}`}>
                      {fmtPct(r.diffPct, 1)}
                    </div>
                  </td>
                  <td className="px-2.5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {fmtCr(r.turnover, 2)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {r.marketSharePct.toFixed(1)}% mkt · {fmtVol(r.volume)}
                    </div>
                  </td>
                  <td className="px-2.5 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                    <div className={`text-[11px] font-semibold ${deltaTextClass(r.turnoverVsPrevPct)}`}>
                      {fmtPct(r.turnoverVsPrevPct, 0)} prev
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {r.turnoverMultN.toFixed(1)}x TO · {r.volumeMultN.toFixed(1)}x Vol
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <RangeBar pct={r.closePosPct} isBull={isUp} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* 1. Market Summary: Volume, Turnovers & Comparisons + 14-Session Interactive Pulse */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Market Summary · Volume, Turnover &amp; Liquidity Comparisons
              </h3>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {summary.date}
                {summary.prevDate ? ` vs ${summary.prevDate}` : ''}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compare today&apos;s market turnover &amp; share volume against previous session, 5-day average, and {summary.nDays}-day norm — click any bar below to inspect that session
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isHistoricalView && (
              <button
                type="button"
                onClick={() => onSelectDate(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Back to Latest ({latestDate})</span>
              </button>
            )}
            <div className="inline-flex items-center gap-1 p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setStripMetric('turnover')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  stripMetric === 'turnover'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                }`}
              >
                Turnover Pulse
              </button>
              <button
                type="button"
                onClick={() => setStripMetric('volume')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  stripMetric === 'volume'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                }`}
              >
                Volume Pulse
              </button>
            </div>
          </div>
        </div>

        {/* 4-Column KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
          {/* KPI 1: Turnover */}
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Total Turnover</span>
              <span className={`font-mono font-semibold tabular-nums ${deltaTextClass(summary.turnoverVsPrevPct)}`}>
                {fmtPct(summary.turnoverVsPrevPct, 1)} vs prev
              </span>
            </div>
            <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {fmtCr(summary.todayTurnover, 2)}
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono tabular-nums">
              <div>
                <div className="text-[10px] text-slate-400">Prev Day</div>
                <div className="text-slate-700 dark:text-slate-300">
                  {fmtCr(summary.prevTurnover, 1)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">5D Avg</div>
                <div className={deltaTextClass(summary.turnoverVs5dPct)}>
                  {fmtPct(summary.turnoverVs5dPct, 1)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">{summary.nDays}D Avg</div>
                <div className={deltaTextClass(summary.turnoverVsNdPct)}>
                  {fmtPct(summary.turnoverVsNdPct, 1)}
                </div>
              </div>
            </div>
          </div>

          {/* KPI 2: Volume */}
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Total Volume</span>
              <span className={`font-mono font-semibold tabular-nums ${deltaTextClass(summary.volumeVsPrevPct)}`}>
                {fmtPct(summary.volumeVsPrevPct, 1)} vs prev
              </span>
            </div>
            <div className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {fmtVol(summary.todayVolume)} <span className="text-xs font-normal text-slate-500">shares</span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono tabular-nums">
              <div>
                <div className="text-[10px] text-slate-400">Prev Day</div>
                <div className="text-slate-700 dark:text-slate-300">
                  {fmtVol(summary.prevVolume)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">5D Avg</div>
                <div className={deltaTextClass(summary.volumeVs5dPct)}>
                  {fmtPct(summary.volumeVs5dPct, 1)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">{summary.nDays}D Avg</div>
                <div className={deltaTextClass(summary.volumeVsNdPct)}>
                  {fmtPct(summary.volumeVsNdPct, 1)}
                </div>
              </div>
            </div>
          </div>

          {/* KPI 3: Directional Money Flow (Up vs Down Turnover) */}
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Up vs Down Money Flow</span>
              <span className={`font-mono font-semibold tabular-nums ${deltaTextClass(summary.netFlowTiltPct)}`}>
                {summary.netFlowTiltPct >= 0 ? '+' : ''}
                {summary.netFlowTiltPct.toFixed(0)}% net tilt
              </span>
            </div>
            <div className="flex items-baseline justify-between font-mono text-sm font-bold tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">
                Up {fmtCr(summary.upTurnover, 1)}
              </span>
              <span className="text-rose-600 dark:text-rose-400">
                Down {fmtCr(summary.downTurnover, 1)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-rose-200 dark:bg-rose-950/60 overflow-hidden flex">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${Math.min(100, Math.max(0, upSharePct))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 pt-0.5">
              <span>Trades {summary.todayTrades.toLocaleString()}</span>
              <span>Median {fmtTicket(summary.medianAvgTradeSize)}/tx</span>
              <span>Top 5: {summary.top5ConcentrationPct.toFixed(0)}%</span>
            </div>
          </div>

          {/* KPI 4: Market Breadth & Regime */}
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Breadth &amp; Sentiment</span>
              <span className="font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                {summary.sentimentScore.toFixed(0)}/100 · {summary.sentimentLabel}
              </span>
            </div>
            <div className="flex items-baseline justify-between font-mono text-sm font-bold tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">
                {summary.advancers} Adv
              </span>
              <span className="text-slate-500 text-xs">{summary.unchanged} Flat</span>
              <span className="text-rose-600 dark:text-rose-400">
                {summary.decliners} Dec
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex">
              <div className="h-full bg-emerald-500" style={{ width: `${advPct}%` }} />
              <div
                className="h-full bg-rose-500 ml-auto"
                style={{ width: `${decPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 pt-0.5">
              <span>A/D {summary.adRatio.toFixed(2)}</span>
              <span>
                &gt;VWAP {summary.aboveVwap}/{summary.vwapEligible}
              </span>
              <span>
                Circuits +{summary.upperCircuitCount}/-{summary.lowerCircuitCount}
              </span>
            </div>
          </div>
        </div>

        {/* 14-Session Interactive History Strip */}
        {historyStrip.length > 1 && (
          <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-medium text-slate-700 dark:text-slate-300">
                Last {historyStrip.length} Sessions ({stripMetric === 'turnover' ? 'Turnover Rs Cr' : 'Share Volume'})
              </div>
              {inspectedHist && (
                <div className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {inspectedHist.date}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{fmtCr(inspectedHist.turnover, 2)}</span>
                  <span className={deltaTextClass(inspectedHist.turnoverVsPrevPct)}>
                    ({fmtPct(inspectedHist.turnoverVsPrevPct, 1)} vs prev)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{fmtVol(inspectedHist.volume)} shares</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {inspectedHist.advancers}↑ / {inspectedHist.decliners}↓
                  </span>
                </div>
              )}
            </div>

            <div className="relative h-24 pt-2 flex items-end gap-1.5">
              {/* Average Reference Line */}
              <div
                className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-400/70 dark:border-slate-600/80 z-10"
                style={{ bottom: `${avgLineBottomPct}%` }}
              >
                <span className="absolute right-0 -top-4 font-mono text-[10px] text-slate-500 dark:text-slate-400 bg-slate-50/90 dark:bg-slate-950/90 px-1">
                  {summary.nDays}D avg:{' '}
                  {stripMetric === 'turnover'
                    ? fmtCr(avgStripVal, 1)
                    : fmtVol(avgStripVal)}
                </span>
              </div>

              {historyStrip.map((h, idx) => {
                const val = stripMetric === 'turnover' ? h.turnover : h.volume;
                const heightPct = Math.max(8, Math.round((val / maxStripVal) * 100));
                const isSelected = h.date === summary.date;
                const isGreenDay = h.advancers >= h.decliners;
                return (
                  <button
                    key={h.date}
                    type="button"
                    onMouseEnter={() => setHoveredHistoryIdx(idx)}
                    onMouseLeave={() => setHoveredHistoryIdx(null)}
                    onClick={() => onSelectDate(h.date === latestDate ? null : h.date)}
                    title={`${h.date}: ${fmtCr(h.turnover, 2)}, ${fmtVol(h.volume)} shares`}
                    className="flex-1 h-full flex flex-col justify-end items-center group focus:outline-none"
                  >
                    <div
                      className={`w-full rounded-t transition-opacity ${
                        isGreenDay
                          ? isSelected
                            ? 'bg-emerald-600 dark:bg-emerald-400'
                            : 'bg-emerald-500/70 dark:bg-emerald-500/60 group-hover:bg-emerald-500'
                          : isSelected
                            ? 'bg-rose-600 dark:bg-rose-400'
                            : 'bg-rose-500/70 dark:bg-rose-500/60 group-hover:bg-rose-500'
                      } ${isSelected ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-950' : ''}`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span
                      className={`mt-1 font-mono text-[9px] tabular-nums hidden sm:block ${
                        isSelected
                          ? 'font-bold text-blue-600 dark:text-blue-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {h.date.slice(5)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 4 "Aha & Wow" Discovery Signals */}
        {wowInsights.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800">
            {wowInsights.map((w) => (
              <div key={w.id} className="p-3.5 space-y-1">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span
                    className={`font-semibold ${
                      w.tone === 'emerald'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : w.tone === 'red'
                          ? 'text-rose-700 dark:text-rose-400'
                          : w.tone === 'amber'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-blue-700 dark:text-blue-400'
                    }`}
                  >
                    {w.category}
                  </span>
                  {w.symbol && (
                    <button
                      type="button"
                      onClick={() => onInspectSymbol(w.symbol!)}
                      className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                    >
                      {w.symbol} →
                    </button>
                  )}
                </div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                  {w.title}
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {w.detail}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. Potential Blow-Out & Short / Distribution Script of the Day */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {renderSpotlightPanel(
          'Potential Blow-Out Script of the Day',
          'Strongest bullish expansion combining price thrust, volume/turnover spike & high-range close',
          blowoutList,
          activeBlow,
          blowIdx,
          setBlowIdx,
          true
        )}
        {renderSpotlightPanel(
          'Potential Short / Distribution Script of the Day',
          'Weakest distribution sell-offs & intraday blow-off upper-wick exhaustion traps (risk / exit alert)',
          shortList,
          activeShort,
          shortIdx,
          setShortIdx,
          false
        )}
      </section>

      {/* 3. Interactive Market Heat Map (Sectors + Top 60 Stocks Mosaic) */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Grid2x2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                NEPSE Market Heat Map
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {heatmapMode === 'sectors'
                  ? 'Click any sector to inspect its active stocks'
                  : 'Top 60 stocks by turnover · hover for spike telemetry, click to chart'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-600" />
              <span>&le; -4%</span>
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-200 dark:bg-rose-900" />
              <span>Red</span>
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-200 dark:bg-emerald-900" />
              <span>Green</span>
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-600" />
              <span>&ge; +4%</span>
            </div>

            <div className="inline-flex items-center gap-1 p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setHeatmapMode('sectors')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  heatmapMode === 'sectors'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                }`}
              >
                Sector Heat Map ({sectorHeatmap.length})
              </button>
              <button
                type="button"
                onClick={() => setHeatmapMode('stocks')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  heatmapMode === 'stocks'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                }`}
              >
                Top 60 Stocks
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {heatmapMode === 'sectors' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {sectorHeatmap.map((sec: HomepageSectorHeatmapRow) => {
                  const isSel = selectedSector === sec.sector;
                  return (
                    <button
                      key={sec.sector}
                      type="button"
                      onClick={() =>
                        setSelectedSector((prev) => (prev === sec.sector ? null : sec.sector))
                      }
                      className={`p-3 rounded-md border text-left transition-all space-y-1.5 ${heatTileClass(
                        sec.avgChangePct
                      )} ${
                        isSel
                          ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900'
                          : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold leading-snug truncate">
                          {sec.sector}
                        </span>
                        <span className="font-mono text-xs font-bold tabular-nums shrink-0">
                          {fmtPct(sec.avgChangePct, 2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums opacity-90">
                        <span>
                          {fmtCr(sec.turnover, 1)} ({sec.turnoverSharePct.toFixed(1)}%)
                        </span>
                        <span>
                          {sec.advancers}↑ / {sec.decliners}↓
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono tabular-nums opacity-85">
                        <span>
                          Prev TO: {fmtPct(sec.turnoverVsPrevPct, 0)} · Rot{' '}
                          {sec.rotationDeltaPct >= 0 ? '+' : ''}
                          {sec.rotationDeltaPct.toFixed(1)}pp
                        </span>
                        <span className="font-semibold">
                          {sec.leaderSymbol} {fmtPct(sec.leaderChangePct, 1)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedSector && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {selectedSector} — Top Active Stocks
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        ({sectorStocks.length} in top 60 market turnover)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSector(null)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                    >
                      Close Sector Drill-Down
                    </button>
                  </div>

                  {sectorStocks.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Stocks in {selectedSector} ranked outside the top 60 market turnover today.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                      {sectorStocks.map((st) => (
                        <button
                          key={st.symbol}
                          type="button"
                          onClick={() => onInspectSymbol(st.symbol)}
                          className={`p-2 rounded border text-left transition-colors ${heatTileClass(
                            st.diffPct
                          )}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono font-bold text-xs truncate">
                              {st.symbol}
                            </span>
                            <span className="font-mono text-[11px] font-bold tabular-nums">
                              {fmtPct(st.diffPct, 1)}
                            </span>
                          </div>
                          <div className="font-mono text-[10px] tabular-nums opacity-85 mt-0.5">
                            {fmtCr(st.turnover, 2)} · {st.volumeMultN.toFixed(1)}x Vol
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="min-h-[28px] px-3 py-1.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                {hoveredStock ? (
                  <>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                        {hoveredStock.symbol}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {hoveredStock.name} ({hoveredStock.sector})
                      </span>
                    </div>
                    <div className="font-mono tabular-nums text-slate-700 dark:text-slate-300 flex flex-wrap items-center gap-x-3">
                      <span>LTP {fmtRs(hoveredStock.ltp)}</span>
                      <span className={`font-bold ${deltaTextClass(hoveredStock.diffPct)}`}>
                        {fmtPct(hoveredStock.diffPct, 2)}
                      </span>
                      <span>TO {fmtCr(hoveredStock.turnover, 2)} ({hoveredStock.turnoverMultN.toFixed(1)}x)</span>
                      <span>Vol {hoveredStock.volumeMultN.toFixed(1)}x</span>
                      <span>vs Prev {fmtPct(hoveredStock.turnoverVsPrevPct, 0)}</span>
                    </div>
                  </>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">
                    Hover any stock tile for instant turnover &amp; volume spike details, or click to open its chart.
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-10 gap-1.5">
                {stockHeatmap.map((st, idx) => (
                  <button
                    key={st.symbol}
                    type="button"
                    onMouseEnter={() => setHoveredStock(st)}
                    onMouseLeave={() => setHoveredStock(null)}
                    onClick={() => onInspectSymbol(st.symbol)}
                    className={`p-2 rounded border text-left transition-transform hover:scale-[1.02] ${
                      idx < 6 ? 'sm:col-span-2' : ''
                    } ${heatTileClass(st.diffPct)}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono font-bold text-xs truncate">{st.symbol}</span>
                      <span className="font-mono text-[11px] font-bold tabular-nums">
                        {fmtPct(st.diffPct, 1)}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] tabular-nums opacity-85 truncate mt-0.5">
                      {fmtCr(st.turnover, 1)}
                    </div>
                    <div className="font-mono text-[9px] tabular-nums opacity-80">
                      Vol {st.volumeMultN.toFixed(1)}x · TO {st.turnoverMultN.toFixed(1)}x
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 4. Top Turnover Split: Top Turnover Up vs Top Turnover Down */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {renderTopTurnoverColumn(
          'Top Turnover · Up Leaders',
          'Highest rupee volume stocks closing positive today',
          topTurnoverUp,
          true
        )}
        {renderTopTurnoverColumn(
          'Top Turnover · Down Leaders',
          'Highest rupee volume stocks closing negative today',
          topTurnoverDown,
          false
        )}
      </section>

      {/* 5. Unusual Activity Stocks (Volume Spike & Turnover Spike) */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500 shrink-0" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Unusual Activity Stocks · Volume Spike &amp; Turnover Spike
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Ranked by abnormal surge in both shares traded and rupee turnover vs {summary.nDays}-day norm and previous session
            </p>
          </div>

          <div className="inline-flex items-center gap-1 p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 shrink-0">
            {[
              { id: 'all', label: 'All Spikes' },
              { id: 'bull', label: 'Bullish / Absorption' },
              { id: 'bear', label: 'Distribution / Trap' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setUnusualFilter(tab.id as 'all' | 'bull' | 'bear')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  unusualFilter === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredUnusual.length === 0 ? (
          <div className="p-6 text-xs text-slate-500 text-center">
            No unusual activity stocks match this filter on {summary.date}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Script &amp; Sector</th>
                  <th className="text-left font-medium px-3 py-2.5">Activity Read</th>
                  <th className="text-right font-medium px-3 py-2.5">LTP / % Chg</th>
                  <th className="text-right font-medium px-3 py-2.5">Volume &amp; Vol Spike</th>
                  <th className="text-right font-medium px-3 py-2.5">Turnover &amp; TO Spike</th>
                  <th className="text-right font-medium px-3 py-2.5">Ticket / VWAP</th>
                  <th className="text-right font-medium px-3 py-2.5 w-24">Close Pos</th>
                  <th className="text-right font-medium px-4 py-2.5">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUnusual.map((u: HomepageUnusualStockRow) => {
                  const isBullRow = u.diffPct >= 0 && u.activityTag !== 'Heavy Distribution';
                  return (
                    <tr
                      key={u.symbol}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => onOpenValuation(u.symbol)}
                          className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {u.symbol}
                        </button>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[150px]">
                          {u.sector}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`text-[11px] font-semibold ${
                            u.activityTag === 'Breakout Spike' ||
                            u.activityTag === 'Accumulation Surge'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : u.activityTag === 'Silent Absorption'
                                ? 'text-blue-700 dark:text-blue-400'
                                : u.activityTag === 'Wick Churn / Trap'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {u.activityTag}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {fmtRs(u.ltp)}
                        </div>
                        <div className={`text-[11px] font-semibold ${deltaTextClass(u.diffPct)}`}>
                          {fmtPct(u.diffPct, 2)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {u.volumeMultN.toFixed(1)}x{' '}
                          <span className="font-normal text-[10px] text-slate-500">
                            ({fmtVol(u.volume)})
                          </span>
                        </div>
                        <div className={`text-[10px] ${deltaTextClass(u.volumeVsPrevPct)}`}>
                          vs Prev {fmtPct(u.volumeVsPrevPct, 0)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {u.turnoverMultN.toFixed(1)}x{' '}
                          <span className="font-normal text-[10px] text-slate-500">
                            ({fmtCr(u.turnover, 2)})
                          </span>
                        </div>
                        <div className={`text-[10px] ${deltaTextClass(u.turnoverVsPrevPct)}`}>
                          vs Prev {fmtPct(u.turnoverVsPrevPct, 0)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="text-slate-800 dark:text-slate-200">
                          {fmtTicket(u.avgTradeSize)}/tx
                        </div>
                        <div className={`text-[10px] ${deltaTextClass(u.vwapPct)}`}>
                          VWAP {fmtPct(u.vwapPct, 1)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <RangeBar pct={u.closePosPct} isBull={isBullRow} />
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onInspectSymbol(u.symbol)}
                            title="Open Chart"
                            className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            Chart
                          </button>
                          <button
                            type="button"
                            onClick={() => onInspectInAnalyzer(u.symbol)}
                            title="Open ICT/SMC Analyzer"
                            className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 whitespace-nowrap shrink-0"
                          >
                            Plan
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
      </section>
    </div>
  );
};
