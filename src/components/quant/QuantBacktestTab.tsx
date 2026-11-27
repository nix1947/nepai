import React, { useMemo, useState } from 'react';
import { Activity, ShieldCheck, TrendingUp } from 'lucide-react';
import { DataTable, type ColumnDef } from '../DataTable';
import { QuantHelpTip } from '../QuantHelpTip';
import type {
  BacktestResponse,
  LearningMode,
  SetupStatisticalSummary,
  SimulatedTradeRecord,
  WalkForwardFold,
} from '../../types/quant';
import { formatNum } from '../../utils/format';

interface QuantBacktestTabProps {
  backtest: BacktestResponse;
  learningMode: LearningMode;
  onOpenGlossaryTerm: (id: string) => void;
}

export const QuantBacktestTab: React.FC<QuantBacktestTabProps> = ({
  backtest,
  learningMode,
  onOpenGlossaryTerm,
}) => {
  const [setupFilter, setSetupFilter] = useState<'All' | 'Breakout' | 'VCP' | 'Trend Pullback'>('All');
  const [oosFilter, setOosFilter] = useState<'all' | 'oos' | 'is'>('all');

  const equityGeom = useMemo(() => {
    const pts = backtest.equityCurve;
    if (pts.length < 2) return null;
    const vals = pts.map((p) => p.equityNpr);
    const minV = Math.min(...vals) * 0.995;
    const maxV = Math.max(...vals) * 1.005;
    const span = Math.max(1, maxV - minV);
    const w = 740;
    const h = 210;
    const padX = 12;
    const padY = 14;
    const xAt = (i: number) => padX + (i / (pts.length - 1)) * (w - padX * 2);
    const yAt = (v: number) => padY + (1 - (v - minV) / span) * (h - padY * 2);

    const path = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.equityNpr).toFixed(1)}`)
      .join(' ');
    const firstOosIdx = pts.findIndex((p) => p.isOutOfSample);
    const oosSplitX = firstOosIdx >= 0 ? xAt(firstOosIdx) : null;
    const startEq = pts[0].equityNpr;
    const endEq = pts[pts.length - 1].equityNpr;
    const maxDd = Math.max(...pts.map((p) => p.drawdownPct));

    return {
      w,
      h,
      path,
      oosSplitX,
      startEq,
      endEq,
      maxDd,
      startDate: pts[0].date,
      endDate: pts[pts.length - 1].date,
    };
  }, [backtest.equityCurve]);

  const filteredTrades = useMemo(() => {
    return backtest.recentTrades.filter((t) => {
      if (setupFilter !== 'All' && t.setupType !== setupFilter) return false;
      if (oosFilter === 'oos' && !t.isOutOfSample) return false;
      if (oosFilter === 'is' && t.isOutOfSample) return false;
      return true;
    });
  }, [backtest.recentTrades, setupFilter, oosFilter]);

  const summaryCols: ColumnDef<SetupStatisticalSummary>[] = [
    { key: 'setupType', label: 'Strategy', align: 'left', render: (s) => <span className="font-semibold text-slate-900 dark:text-slate-100">{s.setupType}</span> },
    { key: 'reliabilityLabel', label: 'Verdict', align: 'left', render: (s) => (
      <span className={`text-xs font-semibold ${s.statisticallyFavorable ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
        {s.reliabilityLabel}
      </span>
    ) },
    { key: 'sampleSize', label: 'N', align: 'right', render: (s) => s.sampleSize },
    {
      key: 'historicalWinRatePct',
      label: 'Win Rate (95% CI)',
      align: 'right',
      render: (s) =>
        s.historicalWinRatePct !== null
          ? `${s.historicalWinRatePct.toFixed(1)}% (${s.winRateCi95LowPct ?? '?'}–${s.winRateCi95HighPct ?? '?'}%)`
          : '–',
    },
    {
      key: 'avgWinNetPct',
      label: 'Avg Win (Net / Gross)',
      align: 'right',
      render: (s) => (
        <span className="text-emerald-600 dark:text-emerald-400">
          +{s.avgWinNetPct ?? '–'}% / +{s.avgWinGrossPct ?? '–'}%
        </span>
      ),
    },
    {
      key: 'avgLossNetPct',
      label: 'Avg Loss (Net)',
      align: 'right',
      render: (s) => (
        <span className="text-red-600 dark:text-red-400">
          {s.avgLossNetPct ?? '–'}%
        </span>
      ),
    },
    {
      key: 'netExpectancyPct',
      label: 'Net Exp % (R)',
      align: 'right',
      render: (s) => (
        <span className={`font-semibold ${(s.netExpectancyPct ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {s.netExpectancyPct !== null ? `${s.netExpectancyPct >= 0 ? '+' : ''}${s.netExpectancyPct}% (${s.netExpectancyR ?? 0}R)` : '–'}
        </span>
      ),
    },
    { key: 'profitFactor', label: 'PF', align: 'right', render: (s) => s.profitFactor ?? '–' },
    { key: 'sharpeRatio', label: 'Sharpe / Sortino', align: 'right', render: (s) => `${s.sharpeRatio ?? '–'} / ${s.sortinoRatio ?? '–'}` },
    { key: 'outOfSampleNetExpectancyPct', label: 'OOS Exp %', align: 'right', render: (s) => (
      <span className={(s.outOfSampleNetExpectancyPct ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
        {s.outOfSampleNetExpectancyPct !== null ? `${s.outOfSampleNetExpectancyPct >= 0 ? '+' : ''}${s.outOfSampleNetExpectancyPct}% (N=${s.outOfSampleSampleSize})` : '–'}
      </span>
    ) },
    { key: 'overfittingRisk', label: 'Overfit Risk', align: 'left', render: (s) => s.overfittingRisk },
  ];

  const foldCols: ColumnDef<WalkForwardFold>[] = [
    { key: 'foldIndex', label: 'Fold', align: 'left', render: (f) => `Fold ${f.foldIndex}` },
    { key: 'trainEnd', label: 'Train Window', align: 'left', render: (f) => <span className="font-mono text-xs">{f.trainStart} → {f.trainEnd}</span> },
    { key: 'trainTrades', label: 'Train N', align: 'right', render: (f) => f.trainTrades },
    { key: 'trainNetExpectancyPct', label: 'Train Net Exp', align: 'right', render: (f) => f.trainNetExpectancyPct !== null ? `${f.trainNetExpectancyPct}%` : '–' },
    { key: 'testEnd', label: 'OOS Test Window', align: 'left', render: (f) => <span className="font-mono text-xs">{f.testStart} → {f.testEnd}</span> },
    { key: 'testTrades', label: 'Test N', align: 'right', render: (f) => f.testTrades },
    { key: 'testWinRatePct', label: 'Test Win %', align: 'right', render: (f) => f.testWinRatePct !== null ? `${f.testWinRatePct}%` : '–' },
    { key: 'testNetExpectancyPct', label: 'Test Net Exp', align: 'right', render: (f) => (
      <span className={(f.testNetExpectancyPct ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
        {f.testNetExpectancyPct !== null ? `${f.testNetExpectancyPct >= 0 ? '+' : ''}${f.testNetExpectancyPct}%` : '–'}
      </span>
    ) },
    { key: 'testProfitFactor', label: 'Test PF', align: 'right', render: (f) => f.testProfitFactor ?? '–' },
  ];

  const tradeCols: ColumnDef<SimulatedTradeRecord>[] = [
    { key: 'symbol', label: 'Symbol', align: 'left', render: (t) => <span className="font-semibold text-blue-600 dark:text-blue-400">{t.symbol}</span> },
    { key: 'setupType', label: 'Setup', align: 'left', render: (t) => t.setupType },
    { key: 'regimeAtEntry', label: 'Regime', align: 'left', render: (t) => t.regimeAtEntry },
    { key: 'entryDate', label: 'Entry (t+1)', align: 'left', render: (t) => <span className="font-mono text-xs">{t.entryDate}</span> },
    { key: 'exitDate', label: 'Exit Date', align: 'left', render: (t) => <span className="font-mono text-xs">{t.exitDate}</span> },
    { key: 'entryPrice', label: 'Entry NPR', align: 'right', render: (t) => formatNum(t.entryPrice) },
    { key: 'exitPrice', label: 'Exit NPR', align: 'right', render: (t) => formatNum(t.exitPrice) },
    { key: 'exitReason', label: 'Exit Trigger', align: 'left', render: (t) => t.exitReason },
    { key: 'grossReturnPct', label: 'Gross %', align: 'right', render: (t) => `${t.grossReturnPct >= 0 ? '+' : ''}${t.grossReturnPct}%` },
    {
      key: 'netReturnPct',
      label: 'Net %',
      align: 'right',
      render: (t) => (
        <span className={`font-semibold ${t.netReturnPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {t.netReturnPct >= 0 ? '+' : ''}
          {t.netReturnPct}%
        </span>
      ),
    },
    { key: 'isOutOfSample', label: 'Split', align: 'left', render: (t) => (t.isOutOfSample ? 'Out-of-Sample' : 'In-Sample') },
  ];

  const winnerCaseCols: ColumnDef<SimulatedTradeRecord>[] = [
    { key: 'symbol', label: 'Symbol', align: 'left', render: (t) => <span className="font-semibold text-blue-600 dark:text-blue-400">{t.symbol}</span> },
    { key: 'setupType', label: 'Setup', align: 'left', render: (t) => t.setupType },
    { key: 'regimeAtEntry', label: 'Regime', align: 'left', render: (t) => t.regimeAtEntry },
    {
      key: 'entryDate',
      label: 'Window',
      align: 'left',
      render: (t) => <span className="font-mono text-xs">{t.entryDate} → {t.exitDate}</span>,
    },
    { key: 'holdingDays', label: 'Days Held', align: 'right', render: (t) => `${t.holdingDays}d` },
    { key: 'exitReason', label: 'Exit Trigger', align: 'left', render: (t) => t.exitReason },
    {
      key: 'rMultipleNet',
      label: 'R-Multiple',
      align: 'right',
      render: (t) => (
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
          +{t.rMultipleNet.toFixed(2)}R
        </span>
      ),
    },
    {
      key: 'netReturnPct',
      label: 'Net Return %',
      align: 'right',
      render: (t) => (
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
          +{t.netReturnPct.toFixed(2)}%
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Equity Curve + In-Sample vs Out-of-Sample */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>Simulated Strategy Equity Curve (Net of NEPSE Fees, Slippage &amp; CGT)</span>
              <QuantHelpTip termId="out-of-sample-testing" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Total simulated closed trades: {backtest.totalSignalsTested} · Causal t+1 entry simulation · Historical results do NOT guarantee future returns.
            </p>
          </div>
          {equityGeom && (
            <div className="text-right font-mono tabular-nums text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Start NPR {Math.round(equityGeom.startEq).toLocaleString('en-US')} → End NPR {Math.round(equityGeom.endEq).toLocaleString('en-US')}
              </div>
              <div className="text-red-600 dark:text-red-400">
                Max Simulated Drawdown: -{equityGeom.maxDd.toFixed(2)}%
              </div>
            </div>
          )}
        </div>

        {equityGeom ? (
          <div>
            <svg viewBox={`0 0 ${equityGeom.w} ${equityGeom.h}`} className="w-full h-52 select-none" role="img" aria-label="Backtest Equity Curve">
              {equityGeom.oosSplitX !== null && (
                <>
                  <rect
                    x={equityGeom.oosSplitX}
                    y={10}
                    width={Math.max(0, equityGeom.w - 12 - equityGeom.oosSplitX)}
                    height={equityGeom.h - 24}
                    fill="currentColor"
                    className="text-blue-500/10"
                  />
                  <line
                    x1={equityGeom.oosSplitX}
                    y1={10}
                    x2={equityGeom.oosSplitX}
                    y2={equityGeom.h - 14}
                    stroke="#2563eb"
                    strokeDasharray="4 4"
                    strokeWidth="1.2"
                  />
                </>
              )}
              <path d={equityGeom.path} fill="none" stroke="#2563eb" strokeWidth="2.2" />
            </svg>
            <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-1">
              <span>{equityGeom.startDate} (In-Sample)</span>
              <span className="text-blue-600 dark:text-blue-400">Shaded region = Out-of-Sample ({((1 - backtest.configUsed.backtest.inSampleRatio) * 100).toFixed(0)}%)</span>
              <span>{equityGeom.endDate}</span>
            </div>
          </div>
        ) : (
          <div className="h-36 flex items-center justify-center text-xs text-slate-400">
            Insufficient historical simulated trades to plot equity curve.
          </div>
        )}
      </div>

      {/* Monte Carlo Trade-Sequence Stress Test */}
      {backtest.monteCarlo && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>
                  Monte Carlo Bootstrap Stress Test ({backtest.monteCarlo.trials.toLocaleString('en-US')} Trials)
                </span>
                <QuantHelpTip
                  termId="drawdown"
                  learningMode={learningMode}
                  customContext="Resamples the actual historical simulated trade outcomes 1,000 times with replacement to reveal outcome variance, tail drawdowns, and losing streaks."
                  onOpenGlossaryTerm={onOpenGlossaryTerm}
                />
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {backtest.monteCarlo.methodologyNote}
              </p>
            </div>
            <div className="text-right font-mono tabular-nums text-xs">
              <div className="text-slate-500 dark:text-slate-400">Profitable Sequences</div>
              <div className={`text-base font-bold ${backtest.monteCarlo.probabilityOfProfitPct >= 60 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {backtest.monteCarlo.probabilityOfProfitPct.toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono tabular-nums">
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">5th %ile Unlucky End</div>
              <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                NPR {backtest.monteCarlo.p5FinalEquityNpr.toLocaleString('en-US')}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">Median Final Equity</div>
              <div className="mt-1 font-semibold text-blue-600 dark:text-blue-400">
                NPR {backtest.monteCarlo.medianFinalEquityNpr.toLocaleString('en-US')}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">95th %ile Lucky End</div>
              <div className="mt-1 font-semibold text-emerald-600 dark:text-emerald-400">
                NPR {backtest.monteCarlo.p95FinalEquityNpr.toLocaleString('en-US')}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">Median Max DD</div>
              <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                -{backtest.monteCarlo.medianMaxDrawdownPct.toFixed(2)}%
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">95th %ile Worst DD</div>
              <div className="mt-1 font-semibold text-red-600 dark:text-red-400">
                -{backtest.monteCarlo.p95WorstDrawdownPct.toFixed(2)}%
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">95th %ile Loss Streak</div>
              <div className="mt-1 font-semibold text-amber-600 dark:text-amber-400">
                {backtest.monteCarlo.maxConsecutiveLossesP95} trades in a row
              </div>
            </div>
          </div>
        </div>
      )}

      {/* High-R Outlier & Multi-Week Winner Lab */}
      {backtest.winnerLab && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>High-R Outlier Backtest &amp; Multi-Week Winner Lab</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-4xl">
                {backtest.winnerLab.methodologyNote}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
              <div>
                <span className="font-sans text-slate-500">2R+ Outliers: </span>
                <strong className="text-emerald-600 dark:text-emerald-400">{backtest.winnerLab.outlier2RPlusCount}</strong>
              </div>
              <div>
                <span className="font-sans text-slate-500">3R+ Monsters: </span>
                <strong className="text-emerald-600 dark:text-emerald-400">{backtest.winnerLab.outlier3RPlusCount}</strong>
              </div>
              <div>
                <span className="font-sans text-slate-500">+20% Runs: </span>
                <strong className="text-blue-600 dark:text-blue-400">{backtest.winnerLab.outlier20PctCount}</strong>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Fixed Target vs Pyramid Winner-Trailing Comparison */}
            <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3.5 space-y-2">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Baseline: Fixed T1/T2 Exit
                </div>
                <div className="space-y-1 font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500">Avg Net / Trade</span>
                    <span className={backtest.winnerLab.fixedTargetAvgNetPct >= 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
                      {backtest.winnerLab.fixedTargetAvgNetPct >= 0 ? '+' : ''}{backtest.winnerLab.fixedTargetAvgNetPct}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500">Win Rate</span>
                    <span>{backtest.winnerLab.fixedTargetWinRatePct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500">Compounded Return</span>
                    <span className="font-semibold">{backtest.winnerLab.fixedTotalReturnPct >= 0 ? '+' : ''}{backtest.winnerLab.fixedTotalReturnPct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500">Max Drawdown</span>
                    <span className="text-red-600 dark:text-red-400">-{backtest.winnerLab.fixedTargetMaxDdPct}%</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3.5 space-y-2">
                <div className="font-semibold text-blue-700 dark:text-blue-400">
                  Pyramid + 20d EMA Winner Trail
                </div>
                <div className="space-y-1 font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500">Avg Net / Trade</span>
                    <span className={backtest.winnerLab.trailingPyramidAvgNetPct >= 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
                      {backtest.winnerLab.trailingPyramidAvgNetPct >= 0 ? '+' : ''}{backtest.winnerLab.trailingPyramidAvgNetPct}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500">Win Rate</span>
                    <span>{backtest.winnerLab.trailingPyramidWinRatePct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500">Compounded Return</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {backtest.winnerLab.trailingPyramidTotalReturnPct >= 0 ? '+' : ''}{backtest.winnerLab.trailingPyramidTotalReturnPct}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500">Max Drawdown</span>
                    <span className="text-red-600 dark:text-red-400">-{backtest.winnerLab.trailingPyramidMaxDdPct}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* R-Multiple Distribution Bar Histogram */}
            <div className="lg:col-span-6 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Net R-Multiple Distribution (Tail Payoff Skew)
                </span>
                <span className="text-[11px] font-mono text-slate-500">Count &amp; Avg Net %</span>
              </div>
              {(() => {
                const buckets = backtest.winnerLab.rDistribution;
                const maxCount = Math.max(1, ...buckets.map((b) => b.count));
                return (
                  <div className="space-y-1.5 text-xs">
                    {buckets.map((b) => {
                      const isPositive = b.label.startsWith('+') || b.label.includes('1R to') || b.label.includes('2R') || b.label.includes('>= 3R') || b.label.startsWith('0R');
                      return (
                        <div key={b.label} className="grid grid-cols-12 items-center gap-2 font-mono tabular-nums">
                          <span className="col-span-3 text-[11px] text-slate-600 dark:text-slate-300 truncate">
                            {b.label}
                          </span>
                          <div className="col-span-6 h-2.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                            <div
                              className={`h-full ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`}
                              style={{ width: `${Math.max(2, (b.count / maxCount) * 100)}%` }}
                            />
                          </div>
                          <span className="col-span-3 text-right text-[11px] text-slate-700 dark:text-slate-300">
                            {b.count} ({b.avgNetReturnPct >= 0 ? '+' : ''}{b.avgNetReturnPct}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {backtest.winnerLab.topWinnerCases.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Top Historical Multi-Week Winner Case Studies (Causal Trailing Simulation)
              </div>
              <DataTable
                rows={backtest.winnerLab.topWinnerCases}
                columns={winnerCaseCols}
                rowKey={(t) => `winner-${t.id}`}
                maxHeightClass="max-h-[250px]"
              />
            </div>
          )}
        </div>
      )}

      {/* Setup Statistical Comparison */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Statistical Advantage Validation by Strategy
          </h3>
          <QuantHelpTip termId="statistical-significance" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
        </div>
        <DataTable
          rows={backtest.setupSummaries}
          columns={summaryCols}
          rowKey={(s) => s.setupType}
          exportFilename={`nepse-setup-stats-${backtest.asOfDate}.csv`}
          maxHeightClass="max-h-[280px]"
        />
      </div>

      {/* Conditional Performance by Market Regime */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {backtest.setupSummaries.map((s) => (
          <div key={s.setupType} className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5 text-xs">
            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-between">
              <span>{s.setupType} by Market Regime</span>
              <span className="font-mono text-[11px] text-slate-500">N={s.sampleSize}</span>
            </div>
            <div className="space-y-1.5 font-mono tabular-nums">
              {s.byRegime.map((r) => (
                <div key={r.regime} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                  <span className="font-sans text-slate-700 dark:text-slate-300">{r.regime}</span>
                  <span>
                    N={r.sampleSize} · WR {r.winRatePct ?? '–'}% ·{' '}
                    <span className={(r.netExpectancyPct ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600'}>
                      {r.netExpectancyPct !== null ? `${r.netExpectancyPct >= 0 ? '+' : ''}${r.netExpectancyPct}%` : '–'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 pt-1">
              {s.reliabilityNotes.map((n, idx) => (
                <div key={idx}>· {n}</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Walk-Forward Validation Folds */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Chronological Walk-Forward Validation Folds
          </h3>
          <QuantHelpTip termId="walk-forward-validation" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
        </div>
        <DataTable
          rows={backtest.walkForwardFolds}
          columns={foldCols}
          rowKey={(f) => String(f.foldIndex)}
          maxHeightClass="max-h-[260px]"
        />
      </div>

      {/* Safeguards & Honest Limitations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
          <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Bias Prevention &amp; Cost Safeguards Active</span>
            <QuantHelpTip termId="look-ahead-bias" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <ul className="space-y-1 text-slate-600 dark:text-slate-300">
            {backtest.methodologySafeguards.map((item, i) => (
              <li key={i}>· {item}</li>
            ))}
          </ul>
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            Disclosed Data &amp; Model Limitations
          </div>
          <ul className="space-y-1 text-slate-600 dark:text-slate-300">
            {backtest.limitations.map((item, i) => (
              <li key={i}>· {item}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Simulated Historical Trades Log */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Simulated Historical Trade Log ({filteredTrades.length})
          </h3>
          <div className="flex flex-wrap gap-2 text-xs">
            <select
              value={setupFilter}
              onChange={(e) => setSetupFilter(e.target.value as typeof setupFilter)}
              className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="All">All Setups</option>
              <option value="Breakout">Breakout</option>
              <option value="VCP">VCP</option>
              <option value="Trend Pullback">Trend Pullback</option>
            </select>
            <select
              value={oosFilter}
              onChange={(e) => setOosFilter(e.target.value as typeof oosFilter)}
              className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="all">In-Sample + Out-of-Sample</option>
              <option value="oos">Out-of-Sample Only</option>
              <option value="is">In-Sample Only</option>
            </select>
          </div>
        </div>
        <DataTable
          rows={filteredTrades}
          columns={tradeCols}
          rowKey={(t) => t.id}
          searchKeys={['symbol', 'setupType', 'exitReason', 'regimeAtEntry']}
          exportFilename={`nepse-backtest-trades-${backtest.asOfDate}.csv`}
          maxHeightClass="max-h-[360px]"
        />
      </div>
    </div>
  );
};
