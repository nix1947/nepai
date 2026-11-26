import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RotateCcw, Search, Sliders } from 'lucide-react';
import { AlgorithmExplainPanel } from '../components/AlgorithmExplainPanel';
import { ALGORITHM_DOCS, type AlgorithmDoc } from '../data/algorithmDocs';
import type { PriceRow, RangeSummaryRow } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

type CategoryFilter = 'All' | AlgorithmDoc['category'];
type LabMode = 'simulator' | 'tracer';
type SimModel = 'turnover_direction' | 'potential';

const CATEGORIES: CategoryFilter[] = [
  'All',
  'Breakout',
  'Reversal',
  'Accumulation',
  'Momentum',
  'Turnover Flow',
];

interface AlgorithmsViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

const clip = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const AlgorithmsView: React.FC<AlgorithmsViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const [category, setCategory] = useState<CategoryFilter>('All');
  const [labMode, setLabMode] = useState<LabMode>('simulator');
  const [simModel, setSimModel] = useState<SimModel>('turnover_direction');

  // --- Simulator State: Turnover × Direction ---
  const [tdStockCr, setTdStockCr] = useState(42);
  const [tdMaxCr, setTdMaxCr] = useState(55);
  const [tdChgPct, setTdChgPct] = useState(7.5);
  const [tdConsPct, setTdConsPct] = useState(80);
  const [tdClosePos, setTdClosePos] = useState(86);
  const [tdVwapAligned, setTdVwapAligned] = useState(true);
  const [tdMa120Aligned, setTdMa120Aligned] = useState(true);
  const [tdHigh52Aligned, setTdHigh52Aligned] = useState(true);
  const [tdTrades, setTdTrades] = useState(1450);

  // --- Simulator State: Consolidation Breakout ---
  const [bkBaseDays, setBkBaseDays] = useState(42);
  const [bkSqueezePct, setBkSqueezePct] = useState(32);
  const [bkDryUpPct, setBkDryUpPct] = useState(28);
  const [bkAccumRatio, setBkAccumRatio] = useState(1.7);
  const [bkVolMult, setBkVolMult] = useState(3.1);
  const [bkClosePos, setBkClosePos] = useState(85);
  const [bkMoreTrades, setBkMoreTrades] = useState(true);
  const [bkAboveMa120, setBkAboveMa120] = useState(true);
  const [bkAboveMa180, setBkAboveMa180] = useState(true);
  const [bkGap52Pct, setBkGap52Pct] = useState(3.8);
  const [bkAboveVwap, setBkAboveVwap] = useState(true);

  // --- Live Stock Tracer State ---
  const latestDate = dates[dates.length - 1] ?? '';
  const [dayRows, setDayRows] = useState<PriceRow[]>([]);
  const [flowRows, setFlowRows] = useState<RangeSummaryRow[]>([]);
  const [loadingLive, setLoadingLive] = useState(false);
  const [traceQuery, setTraceQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState('');

  useEffect(() => {
    if (!latestDate) return;
    let cancelled = false;
    setLoadingLive(true);
    Promise.all([
      fetch(`/api/day/${encodeURIComponent(latestDate)}?equityOnly=${equityOnly}`).then((r) => r.json()),
      fetch(
        `/api/turnover-direction?start=${encodeURIComponent(latestDate)}&end=${encodeURIComponent(
          latestDate
        )}&topPct=100&equityOnly=${equityOnly}`
      ).then((r) => r.json()),
    ])
      .then(([dayData, dirData]) => {
        if (cancelled) return;
        const rows: PriceRow[] = dayData.rows || [];
        const allFlow: RangeSummaryRow[] = [...(dirData.up || []), ...(dirData.down || [])].sort(
          (a, b) => (b.momentum_score ?? 0) - (a.momentum_score ?? 0)
        );
        setDayRows(rows);
        setFlowRows(allFlow);
        setSelectedSymbol((prev) => {
          if (prev && rows.some((r) => r.symbol === prev)) return prev;
          return allFlow[0]?.symbol || rows[0]?.symbol || '';
        });
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setLoadingLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [latestDate, equityOnly]);

  const tdCalc = useMemo(() => {
    const dir: 'up' | 'down' = tdChgPct >= 0 ? 'up' : 'down';
    const turnRs = tdStockCr * 1e7;
    const maxRs = Math.max(tdMaxCr, tdStockCr, 1) * 1e7;
    const turnPts = 30 * (Math.log10(Math.max(turnRs, 1)) / Math.log10(Math.max(maxRs, 10)));
    const chgPts = 25 * clip(Math.abs(tdChgPct) / 15, 0, 1);
    const consistency = tdConsPct / 100;
    const consPts = 20 * consistency;
    const convicPts =
      (tdVwapAligned ? 8 : 0) + 7 * (dir === 'up' ? tdClosePos / 100 : (100 - tdClosePos) / 100);
    const trendPts = (tdMa120Aligned ? 5 : 0) + (tdHigh52Aligned ? 5 : 0);
    const total = Math.round(clip(turnPts + chgPts + consPts + convicPts + trendPts, 0, 100) * 10) / 10;

    const avgTradeSize = tdTrades > 0 ? turnRs / tdTrades : turnRs;
    const isBlockOnly = tdTrades < 50 && avgTradeSize > 500_000;

    let flowTag = dir === 'up' ? 'Active Buying' : 'Supply Pressure';
    if (dir === 'up') {
      if (isBlockOnly) flowTag = 'Block / Low Trades';
      else if (total >= 68 && consistency >= 0.6) flowTag = 'Momentum Leader';
      else if (consistency >= 0.6) flowTag = 'Steady Accumulation';
      else if (tdChgPct >= 4 && tdVwapAligned) flowTag = 'Breakout Surge';
    } else {
      if (isBlockOnly) flowTag = 'Block Exit';
      else if (consistency >= 0.6 && tdChgPct <= -3) flowTag = 'Heavy Distribution';
      else if (tdVwapAligned) flowTag = 'Intraday Fade';
    }

    return {
      dir,
      total,
      flowTag,
      avgTradeSize,
      isBlockOnly,
      factors: [
        { label: 'Turnover Dominance', pts: turnPts, max: 30 },
        { label: 'Price Expansion', pts: chgPts, max: 25 },
        { label: 'Session Consistency', pts: consPts, max: 20 },
        { label: 'VWAP & Close Conviction', pts: convicPts, max: 15 },
        { label: 'MA120 & 52w Alignment', pts: trendPts, max: 10 },
      ],
    };
  }, [
    tdStockCr,
    tdMaxCr,
    tdChgPct,
    tdConsPct,
    tdClosePos,
    tdVwapAligned,
    tdMa120Aligned,
    tdHigh52Aligned,
    tdTrades,
  ]);

  const bkCalc = useMemo(() => {
    const durPts = 15 * clip(bkBaseDays / 60, 0, 1);
    const sqPts = bkSqueezePct >= 20 ? 10 * clip(bkSqueezePct / 40, 0, 1) : 0;
    const dryPts = bkDryUpPct >= 20 ? 10 * clip(bkDryUpPct / 40, 0, 1) : 0;
    const accPts = bkAccumRatio >= 1.2 ? 10 * clip((bkAccumRatio - 1) / 1.0, 0, 1) : 0;
    const volPts = 20 * clip(bkVolMult / 4.0, 0, 1);
    const closePts = 10 * (bkClosePos / 100);
    const tradePts = bkMoreTrades ? 5 : 0;
    const trendPts = (bkAboveMa120 ? 5 : 0) + (bkAboveMa180 ? 5 : 0);
    const near52Pts = bkGap52Pct <= 5 ? 10 : bkGap52Pct <= 15 ? 5 : 0;

    const total =
      Math.round(
        clip(durPts + sqPts + dryPts + accPts + volPts + closePts + tradePts + trendPts + near52Pts, 0, 100) *
          10
      ) / 10;

    const tags: string[] = [];
    if (bkBaseDays >= 40) tags.push(`long-base(${bkBaseDays}d)`);
    if (bkSqueezePct >= 20) tags.push('volatility-squeeze');
    if (bkDryUpPct >= 20) tags.push('volume-dry-up');
    if (bkAccumRatio >= 1.3) tags.push(`accumulation(${bkAccumRatio.toFixed(1)}x)`);
    if (bkClosePos >= 70) tags.push('strong-close');
    if (bkMoreTrades) tags.push('more-trades(>=1.5x)');
    if (bkAboveVwap) tags.push('closed-above-VWAP');
    if (bkAboveMa120) tags.push('>MA120');
    if (bkAboveMa180) tags.push('>MA180');
    if (bkGap52Pct <= 5) tags.push('near-52w-high');

    return {
      total,
      tags,
      factors: [
        { label: 'Base Duration', pts: durPts, max: 15 },
        { label: 'Volatility Squeeze', pts: sqPts, max: 10 },
        { label: 'Volume Dry-Up', pts: dryPts, max: 10 },
        { label: 'Base Accumulation', pts: accPts, max: 10 },
        { label: 'Breakout Volume Surge', pts: volPts, max: 20 },
        { label: 'Strong Close', pts: closePts, max: 10 },
        { label: 'Broad Participation', pts: tradePts, max: 5 },
        { label: 'MA120 / MA180 Trend', pts: trendPts, max: 10 },
        { label: '52w High Proximity', pts: near52Pts, max: 10 },
      ],
    };
  }, [
    bkBaseDays,
    bkSqueezePct,
    bkDryUpPct,
    bkAccumRatio,
    bkVolMult,
    bkClosePos,
    bkMoreTrades,
    bkAboveMa120,
    bkAboveMa180,
    bkGap52Pct,
    bkAboveVwap,
  ]);

  const applyTdPreset = (preset: 'leader' | 'block' | 'distribution') => {
    if (preset === 'leader') {
      setTdStockCr(48);
      setTdMaxCr(55);
      setTdChgPct(8.4);
      setTdConsPct(80);
      setTdClosePos(90);
      setTdVwapAligned(true);
      setTdMa120Aligned(true);
      setTdHigh52Aligned(true);
      setTdTrades(2100);
    } else if (preset === 'block') {
      setTdStockCr(35);
      setTdMaxCr(55);
      setTdChgPct(1.8);
      setTdConsPct(50);
      setTdClosePos(45);
      setTdVwapAligned(false);
      setTdMa120Aligned(false);
      setTdHigh52Aligned(false);
      setTdTrades(18);
    } else {
      setTdStockCr(40);
      setTdMaxCr(55);
      setTdChgPct(-6.2);
      setTdConsPct(80);
      setTdClosePos(14);
      setTdVwapAligned(true);
      setTdMa120Aligned(true);
      setTdHigh52Aligned(false);
      setTdTrades(1650);
    }
  };

  const tracedRow = useMemo(
    () => dayRows.find((r) => r.symbol === selectedSymbol) ?? null,
    [dayRows, selectedSymbol]
  );

  const tracedFlow = useMemo(
    () => flowRows.find((r) => r.symbol === selectedSymbol) ?? null,
    [flowRows, selectedSymbol]
  );

  const matchingSymbols = useMemo(() => {
    const q = traceQuery.trim().toLowerCase();
    const list = q
      ? dayRows.filter(
          (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
        )
      : dayRows;
    return [...list].sort((a, b) => b.turnover - a.turnover).slice(0, 40);
  }, [dayRows, traceQuery]);

  const tracedSteps = useMemo(() => {
    if (!tracedRow) return null;
    const avgTradeSize = tracedRow.trans > 0 ? tracedRow.turnover / tracedRow.trans : tracedRow.turnover;
    const span = tracedRow.high - tracedRow.low;
    const closePos =
      span > 0 ? ((tracedRow.close - tracedRow.low) / span) * 100 : tracedRow.diff >= 0 ? 100 : 0;
    const vsD120 =
      tracedRow.d120 && tracedRow.d120 > 0
        ? ((tracedRow.close - tracedRow.d120) / tracedRow.d120) * 100
        : null;
    const vsD180 =
      tracedRow.d180 && tracedRow.d180 > 0
        ? ((tracedRow.close - tracedRow.d180) / tracedRow.d180) * 100
        : null;
    const gap52h =
      tracedRow.w52_high && tracedRow.w52_high > 0
        ? ((tracedRow.w52_high - tracedRow.close) / tracedRow.w52_high) * 100
        : null;
    const isBlock = tracedRow.trans < 12 && avgTradeSize > 500_000;

    return {
      avgTradeSize,
      closePos,
      vsD120,
      vsD180,
      gap52h,
      isBlock,
    };
  }, [tracedRow]);

  const filteredDocs = useMemo(
    () =>
      category === 'All'
        ? ALGORITHM_DOCS
        : ALGORITHM_DOCS.filter((d) => d.category === category),
    [category]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Algorithm Reference &amp; Interactive Score Lab
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Step-by-step execution pipelines, worked NEPSE math examples, live stock formula tracer,
            and interactive what-if conviction simulator
          </p>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                category === cat
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Surprise Feature: Interactive Score Lab & Live Stock Formula Tracer */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Interactive Algorithm Lab
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Test live scoring formulas with sliders or trace exact calculations on any loaded NEPSE ticker
              </p>
            </div>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setLabMode('simulator')}
              className={`px-3 py-1.5 font-medium rounded-md transition-colors whitespace-nowrap ${
                labMode === 'simulator'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              What-If Score Simulator
            </button>
            <button
              type="button"
              onClick={() => setLabMode('tracer')}
              className={`px-3 py-1.5 font-medium rounded-md transition-colors whitespace-nowrap ${
                labMode === 'tracer'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Live Stock Step-by-Step Trace
            </button>
          </div>
        </div>

        {labMode === 'simulator' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-md text-xs">
                <button
                  type="button"
                  onClick={() => setSimModel('turnover_direction')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    simModel === 'turnover_direction'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Turnover × Direction (Momentum)
                </button>
                <button
                  type="button"
                  onClick={() => setSimModel('potential')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    simModel === 'potential'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Consolidation → Breakout
                </button>
              </div>

              {simModel === 'turnover_direction' && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Load case:</span>
                  <button
                    type="button"
                    onClick={() => applyTdPreset('leader')}
                    className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-emerald-700 dark:text-emerald-400"
                  >
                    Momentum Leader
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTdPreset('block')}
                    className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-amber-700 dark:text-amber-400"
                  >
                    Block Cross Warning
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTdPreset('distribution')}
                    className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-red-700 dark:text-red-400"
                  >
                    Heavy Distribution
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTdPreset('leader')}
                    aria-label="Reset simulator"
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {simModel === 'turnover_direction' ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Stock Turnover</span>
                      <span className="font-mono tabular-nums font-semibold">Rs {tdStockCr} cr</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={tdStockCr}
                      onChange={(e) => setTdStockCr(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Top Leader Benchmark</span>
                      <span className="font-mono tabular-nums font-semibold">Rs {tdMaxCr} cr</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={120}
                      value={tdMaxCr}
                      onChange={(e) => setTdMaxCr(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Period Price Change</span>
                      <span
                        className={`font-mono tabular-nums font-semibold ${
                          tdChgPct >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {tdChgPct >= 0 ? `+${tdChgPct.toFixed(1)}%` : `${tdChgPct.toFixed(1)}%`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-15}
                      max={20}
                      step={0.5}
                      value={tdChgPct}
                      onChange={(e) => setTdChgPct(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Directional Consistency</span>
                      <span className="font-mono tabular-nums font-semibold">{tdConsPct}% days</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={tdConsPct}
                      onChange={(e) => setTdConsPct(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Close Position in Day Range</span>
                      <span className="font-mono tabular-nums font-semibold">{tdClosePos}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={tdClosePos}
                      onChange={(e) => setTdClosePos(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Total Transactions</span>
                      <span className="font-mono tabular-nums font-semibold">
                        {formatInt(tdTrades)} (Rs {formatInt(tdCalc.avgTradeSize)}/tx)
                      </span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={4000}
                      step={5}
                      value={tdTrades}
                      onChange={(e) => setTdTrades(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <div className="sm:col-span-2 flex flex-wrap gap-4 pt-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tdVwapAligned}
                        onChange={(e) => setTdVwapAligned(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>Close aligned vs VWAP (+8)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tdMa120Aligned}
                        onChange={(e) => setTdMa120Aligned(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>MA120 trend aligned (+5)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={tdHigh52Aligned}
                        onChange={(e) => setTdHigh52Aligned(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>52w zone aligned (+5)</span>
                    </label>
                  </div>
                </div>

                <div className="lg:col-span-5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {tdCalc.dir === 'up' ? 'Buying Momentum Score' : 'Selling Pressure Score'}
                      </div>
                      <div className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {tdCalc.total.toFixed(1)} <span className="text-xs font-normal text-slate-500">/ 100</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">Flow Classification</div>
                      <div
                        className={`text-sm font-semibold ${
                          tdCalc.isBlockOnly
                            ? 'text-amber-600 dark:text-amber-400'
                            : tdCalc.dir === 'up'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {tdCalc.flowTag}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                    {tdCalc.factors.map((f) => (
                      <div key={f.label} className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-300">{f.label}</span>
                          <span className="font-mono tabular-nums font-medium">
                            {f.pts.toFixed(1)} / {f.max}
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
                          <div
                            className={`h-full ${
                              tdCalc.dir === 'up' ? 'bg-emerald-600' : 'bg-red-600'
                            }`}
                            style={{ width: `${clip((f.pts / f.max) * 100, 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Base Duration</span>
                      <span className="font-mono tabular-nums font-semibold">{bkBaseDays} days</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={90}
                      value={bkBaseDays}
                      onChange={(e) => setBkBaseDays(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Volatility Squeeze</span>
                      <span className="font-mono tabular-nums font-semibold">{bkSqueezePct}% tighter</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      value={bkSqueezePct}
                      onChange={(e) => setBkSqueezePct(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Pre-Breakout Volume Dry-Up</span>
                      <span className="font-mono tabular-nums font-semibold">{bkDryUpPct}% lower</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      value={bkDryUpPct}
                      onChange={(e) => setBkDryUpPct(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Base Up/Down Vol Ratio</span>
                      <span className="font-mono tabular-nums font-semibold">{bkAccumRatio.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={3.0}
                      step={0.1}
                      value={bkAccumRatio}
                      onChange={(e) => setBkAccumRatio(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Breakout Day Volume ×</span>
                      <span className="font-mono tabular-nums font-semibold">{bkVolMult.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min={1.0}
                      max={5.0}
                      step={0.1}
                      value={bkVolMult}
                      onChange={(e) => setBkVolMult(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Breakout Close Position</span>
                      <span className="font-mono tabular-nums font-semibold">{bkClosePos}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={bkClosePos}
                      onChange={(e) => setBkClosePos(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <label className="space-y-1 sm:col-span-2">
                    <div className="flex justify-between">
                      <span className="text-slate-600 dark:text-slate-300">Gap Below 52-Week High</span>
                      <span className="font-mono tabular-nums font-semibold">{bkGap52Pct.toFixed(1)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={30}
                      step={0.5}
                      value={bkGap52Pct}
                      onChange={(e) => setBkGap52Pct(Number(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </label>

                  <div className="sm:col-span-2 flex flex-wrap gap-4 pt-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bkMoreTrades}
                        onChange={(e) => setBkMoreTrades(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>Trades ≥ 1.5x (+5)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bkAboveMa120}
                        onChange={(e) => setBkAboveMa120(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>&gt; MA120 (+5)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bkAboveMa180}
                        onChange={(e) => setBkAboveMa180(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>&gt; MA180 (+5)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bkAboveVwap}
                        onChange={(e) => setBkAboveVwap(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>Closed &gt; VWAP</span>
                    </label>
                  </div>
                </div>

                <div className="lg:col-span-5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Breakout Conviction Score
                      </div>
                      <div className="text-2xl font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                        {bkCalc.total.toFixed(1)} <span className="text-xs font-normal text-slate-500">/ 100</span>
                      </div>
                    </div>
                    <div className="text-right text-xs font-medium text-blue-600 dark:text-blue-400">
                      {bkCalc.tags.length} signal(s) fired
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                    {bkCalc.factors.map((f) => (
                      <div key={f.label} className="space-y-0.5 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-300">{f.label}</span>
                          <span className="font-mono tabular-nums font-medium">
                            {f.pts.toFixed(1)} / {f.max}
                          </span>
                        </div>
                        <div className="h-1 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-blue-600"
                            style={{ width: `${clip((f.pts / f.max) * 100, 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {bkCalc.tags.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                      {bkCalc.tags.join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Live Stock Step-by-Step Tracer */
          <div className="space-y-4">
            {!latestDate ? (
              <div className="text-xs text-slate-500 py-6 text-center">
                Pull at least 1 ShareSansar session to trace live NEPSE calculations.
              </div>
            ) : loadingLive ? (
              <div className="h-44 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-md" />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={traceQuery}
                        onChange={(e) => setTraceQuery(e.target.value)}
                        placeholder="Filter symbol…"
                        className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-44"
                      />
                    </div>
                    <select
                      value={selectedSymbol}
                      onChange={(e) => setSelectedSymbol(e.target.value)}
                      className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-medium max-w-xs"
                    >
                      {matchingSymbols.map((r) => (
                        <option key={r.symbol} value={r.symbol}>
                          {r.symbol} — {r.name} (Rs {formatCrore(r.turnover, 2)} cr)
                        </option>
                      ))}
                    </select>
                  </div>

                  {tracedRow && (
                    <button
                      type="button"
                      onClick={() => onInspectSymbol(tracedRow.symbol)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                    >
                      <span>Open {tracedRow.symbol} in Stock Explorer</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {tracedRow && tracedSteps && (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/70 dark:bg-slate-950/70 text-xs">
                    <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900">
                      <div>
                        <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                          {tracedRow.symbol}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 ml-2">
                          {tracedRow.name}
                        </span>
                      </div>
                      <div className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        Session {latestDate} · Close Rs {formatNum(tracedRow.close)} ({formatPct(tracedRow.diff_pct)})
                      </div>
                    </div>

                    <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 mr-2">01.</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          Liquidity &amp; Ticket Size Audit
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        Rs {formatCrore(tracedRow.turnover, 2)} cr across {formatInt(tracedRow.trans)} trades = Rs{' '}
                        {formatInt(tracedSteps.avgTradeSize)}/trade{' '}
                        <span className={tracedSteps.isBlock ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-emerald-600 dark:text-emerald-400'}>
                          ({tracedSteps.isBlock ? 'Low-trade block warning' : 'Organic multi-trade flow'})
                        </span>
                      </span>
                    </div>

                    <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 mr-2">02.</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          Session Return &amp; Intraday Range
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        Prev {formatNum(tracedRow.prev_close)} → High {formatNum(tracedRow.high)} / Low{' '}
                        {formatNum(tracedRow.low)} → Close {formatNum(tracedRow.close)} (Range {formatNum(tracedRow.range_pct)}%)
                      </span>
                    </div>

                    <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 mr-2">03.</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          VWAP Control &amp; Candle Close Strength
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        VWAP {formatNum(tracedRow.vwap)} ({formatPct(tracedRow.vwap_pct)}) · Closed at{' '}
                        {tracedSteps.closePos.toFixed(0)}% of intraday range
                      </span>
                    </div>

                    <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 mr-2">04.</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          Long-Term Trend Posture (MA120 / MA180)
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        MA120: {formatNum(tracedRow.d120)} ({formatPct(tracedSteps.vsD120)}) · MA180:{' '}
                        {formatNum(tracedRow.d180)} ({formatPct(tracedSteps.vsD180)})
                      </span>
                    </div>

                    <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 mr-2">05.</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          52-Week High Overhead Supply
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        52w High {formatNum(tracedRow.w52_high)} · 52w Low {formatNum(tracedRow.w52_low)} ·{' '}
                        {tracedSteps.gap52h !== null ? `${tracedSteps.gap52h.toFixed(1)}% below annual peak` : '–'}
                      </span>
                    </div>

                    <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900">
                      <div>
                        <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 mr-2">06.</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          Turnover × Direction Verdict
                        </span>
                      </div>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {tracedFlow
                          ? `${tracedFlow.flow_tag} · Score ${tracedFlow.momentum_score?.toFixed(1)}/100`
                          : tracedRow.diff === 0
                            ? 'Flat close (0.00%) — excluded from directional momentum'
                            : 'Active session evaluated'}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <div className="space-y-6">
        {filteredDocs.map((doc) => (
          <AlgorithmExplainPanel key={doc.id} doc={doc} />
        ))}
      </div>
    </div>
  );
};
