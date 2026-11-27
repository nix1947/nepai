import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, PlusCircle, X } from 'lucide-react';
import { CandlestickVolumeChart, type HorizontalLevel } from '../Charts';
import { createWatchlistColumn, DataTable, type ColumnDef } from '../DataTable';
import { QuantHelpTip } from '../QuantHelpTip';
import { useWatchlist } from '../../hooks/useWatchlist';
import type { PriceRow } from '../../types/market';
import type {
  LearningMode,
  QuantStockCandidate,
  TradeClassification,
} from '../../types/quant';
import { formatCrore, formatNum, formatPct } from '../../utils/format';

interface QuantScannerAndCandidateTabProps {
  candidates: QuantStockCandidate[];
  excludedStocks: QuantStockCandidate[];
  selectedSymbol: string | null;
  onSelectSymbol: (sym: string) => void;
  asOfDate: string;
  learningMode: LearningMode;
  onOpenGlossaryTerm: (id: string) => void;
  onInspectInExplorer: (sym: string) => void;
  onAddPaperTrade: (c: QuantStockCandidate) => void;
  onOpenSizingTab: (sym: string) => void;
}

const CLASSIFICATION_TEXT_COLOR: Record<TradeClassification, string> = {
  'STRONG BUY CANDIDATE': 'text-emerald-700 dark:text-emerald-400 font-bold',
  'BUY CANDIDATE': 'text-emerald-600 dark:text-emerald-400 font-semibold',
  'WAIT FOR CONFIRMATION': 'text-amber-600 dark:text-amber-400 font-semibold',
  HOLD: 'text-blue-600 dark:text-blue-400 font-medium',
  WATCHLIST: 'text-slate-700 dark:text-slate-300 font-medium',
  REDUCE: 'text-orange-600 dark:text-orange-400 font-semibold',
  SELL: 'text-red-600 dark:text-red-400 font-semibold',
  REJECT: 'text-red-700 dark:text-red-400 font-medium',
};

export const QuantScannerAndCandidateTab: React.FC<QuantScannerAndCandidateTabProps> = ({
  candidates,
  excludedStocks,
  selectedSymbol,
  onSelectSymbol,
  asOfDate,
  learningMode,
  onOpenGlossaryTerm,
  onInspectInExplorer,
  onAddPaperTrade,
  onOpenSizingTab,
}) => {
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();
  const [classFilter, setClassFilter] = useState<'all' | 'actionable' | 'wait' | 'hold_watch' | 'risk_reject'>('all');
  const [setupFilter, setSetupFilter] = useState<'All' | 'Breakout' | 'VCP' | 'Trend Pullback'>('All');
  const [horizonFilter, setHorizonFilter] = useState<'All' | 'Swing' | 'Positional'>('All');
  const [stage2OrPivotOnly, setStage2OrPivotOnly] = useState(false);
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [minScore, setMinScore] = useState<number>(0);
  const [includeExcludedInTable, setIncludeExcludedInTable] = useState(false);

  const [chartHistory, setChartHistory] = useState<PriceRow[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const sectors = useMemo(() => {
    const s = new Set<string>();
    candidates.forEach((c) => s.add(c.sector));
    return ['All', ...[...s].sort()];
  }, [candidates]);

  const filteredRows = useMemo(() => {
    const base = includeExcludedInTable ? [...candidates, ...excludedStocks] : candidates;
    return base.filter((c) => {
      if (c.technicalScore < minScore) return false;
      if (sectorFilter !== 'All' && c.sector !== sectorFilter) return false;
      if (setupFilter !== 'All' && c.setupType !== setupFilter) return false;
      if (horizonFilter === 'Swing' && c.horizonTag !== 'Swing' && c.horizonTag !== 'Both') return false;
      if (horizonFilter === 'Positional' && c.horizonTag !== 'Positional' && c.horizonTag !== 'Both') return false;
      if (stage2OrPivotOnly && !c.pocketPivot?.detected && (c.stage2?.scoreOutOf8 ?? 0) < 6) return false;
      if (classFilter === 'actionable') {
        return c.classification === 'STRONG BUY CANDIDATE' || c.classification === 'BUY CANDIDATE';
      }
      if (classFilter === 'wait') return c.classification === 'WAIT FOR CONFIRMATION';
      if (classFilter === 'hold_watch') return c.classification === 'HOLD' || c.classification === 'WATCHLIST';
      if (classFilter === 'risk_reject') {
        return c.classification === 'REDUCE' || c.classification === 'SELL' || c.classification === 'REJECT';
      }
      return true;
    });
  }, [candidates, excludedStocks, includeExcludedInTable, minScore, sectorFilter, setupFilter, horizonFilter, stage2OrPivotOnly, classFilter]);

  const activeCandidate = useMemo(() => {
    const pool = [...candidates, ...excludedStocks];
    return (
      pool.find((c) => c.symbol === selectedSymbol) ??
      filteredRows[0] ??
      candidates[0] ??
      null
    );
  }, [candidates, excludedStocks, filteredRows, selectedSymbol]);

  useEffect(() => {
    if (!activeCandidate?.symbol || !asOfDate) {
      setChartHistory([]);
      return;
    }
    let cancelled = false;
    setChartLoading(true);
    fetch(`/api/symbol/${encodeURIComponent(activeCandidate.symbol)}?end=${encodeURIComponent(asOfDate)}&days=120`)
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((d) => {
        if (!cancelled) setChartHistory(d.history || []);
      })
      .catch(() => {
        if (!cancelled) setChartHistory([]);
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCandidate?.symbol, asOfDate]);

  const chartLevels = useMemo((): HorizontalLevel[] => {
    if (!activeCandidate) return [];
    const lv: HorizontalLevel[] = [];
    if (activeCandidate.entryPlan.triggerPrice) {
      lv.push({ label: 'trigger', value: activeCandidate.entryPlan.triggerPrice, color: '#2563eb' });
    }
    if (activeCandidate.exitPlan) {
      lv.push({ label: 'stop-loss', value: activeCandidate.exitPlan.initialStopLoss, color: '#dc2626' });
      lv.push({ label: 'target 1', value: activeCandidate.exitPlan.target1, color: '#16a34a' });
      lv.push({ label: 'target 2', value: activeCandidate.exitPlan.target2, color: '#059669' });
    }
    return lv;
  }, [activeCandidate]);

  const columns: ColumnDef<QuantStockCandidate>[] = useMemo(
    () => [
      createWatchlistColumn<QuantStockCandidate>({
        getSymbol: (c) => c.symbol,
        hasSymbol,
        toggleSymbol,
      }),
      {
        key: 'symbol',
        label: 'Symbol',
        align: 'left',
        render: (c) => (
          <div>
            <span className="font-semibold text-blue-600 dark:text-blue-400">{c.symbol}</span>
            <span className="block text-[10px] text-slate-400 truncate max-w-[120px]">{c.sector}</span>
          </div>
        ),
      },
      {
        key: 'classification',
        label: 'Decision Gate',
        align: 'left',
        render: (c) => (
          <span className={`text-xs whitespace-nowrap ${CLASSIFICATION_TEXT_COLOR[c.classification]}`}>
            {c.classification}
          </span>
        ),
      },
      {
        key: 'technicalScore',
        label: 'Tech Score',
        align: 'right',
        render: (c) => (
          <div className="inline-flex items-center gap-2 justify-end">
            <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
              <div className="h-full bg-blue-600" style={{ width: `${c.technicalScore}%` }} />
            </div>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
              {c.technicalScore.toFixed(1)}
            </span>
          </div>
        ),
      },
      {
        key: 'setupType',
        label: 'Setup',
        align: 'left',
        render: (c) => (
          <span className="text-xs font-mono text-slate-700 dark:text-slate-300">
            {c.setupType === 'None' ? '–' : `${c.setupType}${c.entryPlan.setupStatus === 'Confirmed' ? ' ✓' : ' (watch)'}`}
          </span>
        ),
      },
      {
        key: 'stage2',
        label: 'Horizon · S2',
        align: 'left',
        sortValue: (c) => c.convictionScore ?? c.technicalScore,
        render: (c) => (
          <div className="text-xs whitespace-nowrap">
            <span className="text-slate-700 dark:text-slate-300">{c.horizonTag ?? 'Swing'}</span>
            <span className="font-mono text-slate-500"> · {c.stage2?.scoreOutOf8 ?? 0}/8</span>
            {c.pocketPivot?.detected && (
              <span className="ml-1 font-mono font-semibold text-blue-600 dark:text-blue-400">PP</span>
            )}
          </div>
        ),
      },
      {
        key: 'netExpectancy',
        label: 'Cohort Exp %',
        align: 'right',
        sortValue: (c) => c.setupStats?.netExpectancyPct ?? -999,
        render: (c) => {
          const v = c.setupStats?.netExpectancyPct;
          if (v === undefined || v === null) return <span className="text-slate-400">–</span>;
          return (
            <span className={`font-mono ${v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {v >= 0 ? '+' : ''}
              {v.toFixed(2)}%
            </span>
          );
        },
      },
      {
        key: 'close',
        label: 'Close',
        align: 'right',
        sortValue: (c) => c.indicators.close,
        render: (c) => formatNum(c.indicators.close),
      },
      {
        key: 'rsPercentile',
        label: 'RS %ile',
        align: 'right',
        sortValue: (c) => c.indicators.rsPercentile,
        render: (c) => `${c.indicators.rsPercentile.toFixed(0)}`,
      },
      {
        key: 'rvol',
        label: 'RVOL',
        align: 'right',
        sortValue: (c) => c.indicators.relativeVolume,
        render: (c) => `${c.indicators.relativeVolume.toFixed(2)}x`,
      },
      {
        key: 'avgTurnover',
        label: '20d Turn (Cr)',
        align: 'right',
        sortValue: (c) => c.indicators.avgTurnover20,
        render: (c) => formatCrore(c.indicators.avgTurnover20),
      },
      {
        key: 'vwapPct',
        label: 'vs VWAP',
        align: 'right',
        sortValue: (c) => c.indicators.vwapPct ?? -999,
        render: (c) =>
          c.indicators.vwapPct !== null ? (
            <span className={c.indicators.vwapPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {formatPct(c.indicators.vwapPct)}
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
      {/* Scanner Filter Toolbar */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', `All Valid (${candidates.length})`],
                [
                  'actionable',
                  `Actionable BUY (${candidates.filter((c) => c.classification === 'STRONG BUY CANDIDATE' || c.classification === 'BUY CANDIDATE').length})`,
                ],
                [
                  'wait',
                  `Wait Confirmation (${candidates.filter((c) => c.classification === 'WAIT FOR CONFIRMATION').length})`,
                ],
                [
                  'hold_watch',
                  `Hold / Watch (${candidates.filter((c) => c.classification === 'HOLD' || c.classification === 'WATCHLIST').length})`,
                ],
                [
                  'risk_reject',
                  `Reduce / Sell / Reject (${candidates.filter((c) => c.classification === 'REDUCE' || c.classification === 'SELL' || c.classification === 'REJECT').length})`,
                ],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setClassFilter(k)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  classFilter === k
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <select
              value={setupFilter}
              onChange={(e) => setSetupFilter(e.target.value as typeof setupFilter)}
              aria-label="Filter by setup strategy"
              className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
            >
              <option value="All">All Setups</option>
              <option value="Breakout">Breakout</option>
              <option value="VCP">VCP</option>
              <option value="Trend Pullback">Trend Pullback</option>
            </select>

            <select
              value={horizonFilter}
              onChange={(e) => setHorizonFilter(e.target.value as typeof horizonFilter)}
              aria-label="Filter by holding horizon"
              className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
            >
              <option value="All">All Horizons</option>
              <option value="Swing">Swing (5–30d)</option>
              <option value="Positional">Positional (2–6m)</option>
            </select>

            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              aria-label="Filter by sector"
              className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200"
            >
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s === 'All' ? 'All Sectors' : s}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={stage2OrPivotOnly}
                onChange={(e) => setStage2OrPivotOnly(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Stage-2 ≥ 6/8 or Pocket Pivot</span>
            </label>

            <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span>Min Score: {minScore}</span>
              <input
                type="range"
                min={0}
                max={85}
                step={5}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-20 accent-blue-600"
              />
            </label>

            <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeExcludedInTable}
                onChange={(e) => setIncludeExcludedInTable(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Show Excluded ({excludedStocks.length})</span>
            </label>
          </div>
        </div>
      </div>

      {/* Scanner Results Table */}
      <DataTable
        rows={filteredRows}
        columns={columns}
        rowKey={(c) => c.symbol}
        selectedKey={activeCandidate?.symbol ?? null}
        onRowClick={(c) => onSelectSymbol(c.symbol)}
        searchKeys={['symbol', 'name', 'sector', 'classification', 'setupType']}
        exportFilename={`nepse-quant-scanner-${asOfDate}.csv`}
        watchlistFilter={{ watchlist, getSymbol: (c) => c.symbol }}
        maxHeightClass="max-h-[380px]"
      />

      {/* Selected Candidate Decision Workbench */}
      {activeCandidate && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="space-y-1">
              <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                <span>{activeCandidate.sector}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{activeCandidate.dataTimestamp}</span>
                <span aria-hidden="true">·</span>
                <span>
                  Fundamentals:{' '}
                  {activeCandidate.fundamentalStatus.hasAudit
                    ? `Audited (${activeCandidate.fundamentalStatus.reportingPeriod} · ${activeCandidate.fundamentalStatus.recommendation ?? 'Reviewed'})`
                    : 'Unavailable — Price/Volume EOD Only'}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {activeCandidate.symbol}
                  {activeCandidate.name ? ` — ${activeCandidate.name}` : ''}
                </h3>
                <span className={`text-sm ${CLASSIFICATION_TEXT_COLOR[activeCandidate.classification]}`}>
                  {activeCandidate.classification}
                </span>
                <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
                  NPR {formatNum(activeCandidate.indicators.close)} ({formatPct(activeCandidate.indicators.dayChangePct)})
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 max-w-4xl leading-relaxed">
                {activeCandidate.classificationReason}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeCandidate.exitPlan && activeCandidate.positionSizing && (
                <button
                  type="button"
                  onClick={() => onAddPaperTrade(activeCandidate)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Log Paper Trade</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenSizingTab(activeCandidate.symbol)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Entry &amp; Sizing Planner</span>
              </button>
              <button
                type="button"
                onClick={() => onInspectInExplorer(activeCandidate.symbol)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Stock Explorer</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 5 Core Decision Questions */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Five Essential Trading Decisions Answered
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 text-xs">
              <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3 space-y-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  1. Statistical Advantage?
                  <QuantHelpTip termId="expectancy" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {activeCandidate.fiveQuestionsSummary.hasStatisticalAdvantage}
                </p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3 space-y-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  2. Market Favorable?
                  <QuantHelpTip termId="market-breadth" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {activeCandidate.fiveQuestionsSummary.isMarketFavorable}
                </p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3 space-y-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  3. Valid Entry Now?
                  <QuantHelpTip termId="entry-zone" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {activeCandidate.fiveQuestionsSummary.isEntryValid}
                </p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3 space-y-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  4. Size &amp; Max Loss?
                  <QuantHelpTip termId="position-sizing" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {activeCandidate.fiveQuestionsSummary.allocationAndMaxLoss}
                </p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3 space-y-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  5. What Triggers Exit?
                  <QuantHelpTip termId="stop-loss" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {activeCandidate.fiveQuestionsSummary.exitTriggers}
                </p>
              </div>
            </div>
          </div>

          {/* 6-Factor Score Breakdown + Entry Conditions */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="lg:col-span-6 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span>Transparent 6-Factor Technical Score ({activeCandidate.technicalScore.toFixed(1)}/100)</span>
                  <QuantHelpTip
                    termId="trend-strength"
                    learningMode={learningMode}
                    customContext="High technical score measures current chart strength ONLY. It never triggers a BUY recommendation on its own without statistical validation and entry confirmation."
                    onOpenGlossaryTerm={onOpenGlossaryTerm}
                  />
                </h4>
                <span className="text-[11px] font-mono text-slate-500">
                  VWAP: {activeCandidate.indicators.vwapSource.replace(/ShareSansar\s+/gi, '')}
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                {activeCandidate.scoreBreakdown.map((comp) => {
                  const helpTermMap: Record<string, string> = {
                    trendStrength: 'trend-strength',
                    momentum: 'momentum',
                    relativeStrength: 'relative-strength',
                    volumeStrength: 'relative-volume',
                    breakoutStructure: 'breakout',
                    vwapBehavior: 'vwap',
                  };
                  return (
                    <div key={comp.key} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1">
                          {comp.label} ({comp.weightPct}% wt)
                          <QuantHelpTip
                            termId={helpTermMap[comp.key] || 'trend-strength'}
                            learningMode={learningMode}
                            onOpenGlossaryTerm={onOpenGlossaryTerm}
                          />
                        </span>
                        <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {comp.rawScore0to100.toFixed(0)}/100 → +{comp.weightedPoints.toFixed(1)} pts
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full bg-blue-600" style={{ width: `${comp.rawScore0to100}%` }} />
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {comp.explanation}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Entry Conditions & Cohort Stats */}
            <div className="lg:col-span-6 space-y-4 text-xs">
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span>
                    Entry Timing Plan — {activeCandidate.entryPlan.setupType} ({activeCandidate.entryPlan.setupStatus})
                  </span>
                  <QuantHelpTip termId="invalidation-level" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
                </h4>
                {activeCandidate.entryPlan.confirmationConditions.length > 0 ? (
                  <ul className="space-y-1.5">
                    {activeCandidate.entryPlan.confirmationConditions.map((cond, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        {cond.passed ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <span className="font-medium text-slate-800 dark:text-slate-200">{cond.label}: </span>
                          <span className="text-slate-600 dark:text-slate-300">{cond.detail}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500 dark:text-slate-400">
                    No active Breakout, VCP, or Trend Pullback trigger today.
                  </p>
                )}

                {activeCandidate.entryPlan.rejectionReasons.length > 0 && (
                  <div className="pt-2 text-amber-700 dark:text-amber-300 space-y-0.5">
                    <div className="font-semibold">Cautions / Reasons Not Confirmed:</div>
                    {activeCandidate.entryPlan.rejectionReasons.map((r, i) => (
                      <div key={i}>· {r}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Historical Cohort vs Individual Stock Note */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                  <span>Statistical Reliability &amp; Uncertainty Disclosure</span>
                  <QuantHelpTip termId="win-rate" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  {activeCandidate.estimatedModelConfidenceLabel}
                </p>
                {activeCandidate.setupStats && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums pt-1">
                    <div className="bg-slate-50 dark:bg-slate-950 p-2 rounded">
                      <div className="font-sans text-[10px] text-slate-500">Sample Size</div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">N = {activeCandidate.setupStats.sampleSize}</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-950 p-2 rounded">
                      <div className="font-sans text-[10px] text-slate-500">Hist Win Rate</div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {activeCandidate.setupStats.historicalWinRatePct ?? '–'}%
                      </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-950 p-2 rounded">
                      <div className="font-sans text-[10px] text-slate-500">Net Expectancy</div>
                      <div className={`font-semibold ${(activeCandidate.setupStats.netExpectancyPct ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {activeCandidate.setupStats.netExpectancyPct !== null
                          ? `${activeCandidate.setupStats.netExpectancyPct >= 0 ? '+' : ''}${activeCandidate.setupStats.netExpectancyPct}%`
                          : '–'}
                      </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-950 p-2 rounded">
                      <div className="font-sans text-[10px] text-slate-500">Profit Factor</div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {activeCandidate.setupStats.profitFactor ?? '–'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stage-2 Trend Template, Pocket Pivot, Smart-Money & Catalyst Confluence */}
          {(activeCandidate.stage2 || activeCandidate.smartMoney || activeCandidate.fundamentalConfluence) && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
              {activeCandidate.stage2 && (
                <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3.5 space-y-2">
                  <div className="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-100">
                    <span>Minervini Stage-2 Trend Template</span>
                    <span className="font-mono text-blue-600 dark:text-blue-400">
                      {activeCandidate.stage2.scoreOutOf8}/8
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    {[
                      ['Close > SMA50', activeCandidate.stage2.aboveSma50],
                      ['Close > MA120/180', activeCandidate.stage2.aboveMa120And180],
                      ['SMA20 > SMA50', activeCandidate.stage2.sma20AboveSma50],
                      ['MA120 Rising', activeCandidate.stage2.ma120Rising],
                      ['≥25% off 52w Low', activeCandidate.stage2.above52wLow25Pct],
                      ['Within 20% 52w High', activeCandidate.stage2.within20Pct52wHigh],
                      ['20d RS > 0%', activeCandidate.stage2.positive20dRs],
                      ['Vol Accumulation', activeCandidate.stage2.positiveAccumulation],
                    ].map(([lbl, ok]) => (
                      <div key={String(lbl)} className="flex items-center gap-1.5">
                        {ok ? (
                          <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                        ) : (
                          <X className="w-3 h-3 text-slate-400 shrink-0" />
                        )}
                        <span className={ok ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}>
                          {lbl}
                        </span>
                      </div>
                    ))}
                  </div>
                  {activeCandidate.stage2.isProxyMa200 && (
                    <div className="text-[10px] text-slate-400">
                      Uses exchange MA120/MA180 baseline (&lt;200 daily CSV sessions loaded).
                    </div>
                  )}
                </div>
              )}

              <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3.5 space-y-2">
                <div className="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-100">
                  <span>Pocket Pivot &amp; Smart-Money Footprint</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {activeCandidate.smartMoney?.score0to100 ?? '–'}/100
                  </span>
                </div>
                {activeCandidate.pocketPivot && (
                  <div className={`text-[11px] font-medium ${activeCandidate.pocketPivot.detected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}`}>
                    {activeCandidate.pocketPivot.detected ? 'Pocket Pivot Confirmed ✓ · ' : 'No Pocket Pivot · '}
                    {activeCandidate.pocketPivot.detail}
                  </div>
                )}
                {activeCandidate.smartMoney && (
                  <div className="space-y-1 font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                    <div>Classification: <span className="font-sans font-semibold text-slate-800 dark:text-slate-200">{activeCandidate.smartMoney.label}</span></div>
                    <div>Avg Rs/Tx: Rs {Math.round(activeCandidate.smartMoney.avgTradeSizeNpr).toLocaleString('en-US')} ({activeCandidate.smartMoney.avgTradeSizeMult20.toFixed(2)}x 20d)</div>
                    <div>20d Up/Dn Vol: {activeCandidate.smartMoney.upDownVolRatio20.toFixed(2)}x · Close Pos: {activeCandidate.smartMoney.closePositionPct.toFixed(0)}%</div>
                  </div>
                )}
              </div>

              {activeCandidate.fundamentalConfluence && (
                <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3.5 space-y-2">
                  <div className="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-100">
                    <span>Fundamental Catalyst Confluence</span>
                    <span className="font-mono text-blue-600 dark:text-blue-400">
                      {activeCandidate.fundamentalConfluence.hasAudit
                        ? `${activeCandidate.fundamentalConfluence.confluenceScore0to100}/100`
                        : 'No Audit'}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                    EPS {activeCandidate.fundamentalConfluence.epsText} · P/E {activeCandidate.fundamentalConfluence.peText} · ROE {activeCandidate.fundamentalConfluence.roeText}
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {activeCandidate.fundamentalConfluence.summary}
                  </p>
                  {activeCandidate.fundamentalConfluence.catalystTags.length > 0 && (
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      Catalysts: {activeCandidate.fundamentalConfluence.catalystTags.join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Candlestick Chart + S/R/Stop/Target Overlays */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                120-Day Candlestick &amp; Volume Structure ({activeCandidate.symbol})
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-3">
                <span>RSI14: {activeCandidate.indicators.rsi14 ?? '–'}</span>
                <span>ADX14: {activeCandidate.indicators.adx14 ?? '–'}</span>
                <span>ATR14: {activeCandidate.indicators.atr14 ?? '–'} ({activeCandidate.indicators.atrPct ?? '–'}%)</span>
                <span>SMA20: {activeCandidate.indicators.sma20 ?? '–'}</span>
                <span>SMA50: {activeCandidate.indicators.sma50 ?? '–'}</span>
              </div>
            </div>
            {chartLoading ? (
              <div className="h-[340px] animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
            ) : (
              <CandlestickVolumeChart history={chartHistory} levels={chartLevels} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
