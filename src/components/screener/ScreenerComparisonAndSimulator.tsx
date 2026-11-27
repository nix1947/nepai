import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, RotateCcw, Sliders, X } from 'lucide-react';
import type { InvestorId, ScreenedCompanyRow } from '../../types/fundamental';
import { GrowthTrendSparkline } from './GrowthTrendCell';

const INVESTOR_META: Array<{ id: InvestorId; label: string }> = [
  { id: 'buffett', label: 'Buffett' },
  { id: 'munger', label: 'Munger' },
  { id: 'graham', label: 'Graham' },
  { id: 'lynch', label: 'Lynch' },
  { id: 'marks', label: 'Marks' },
  { id: 'fisher', label: 'Fisher' },
  { id: 'greenblatt', label: 'Greenblatt' },
  { id: 'templeton', label: 'Templeton' },
  { id: 'pabrai', label: 'Pabrai' },
];

const COMPARE_SERIES_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6'];

function fmtNum(v: number | null | undefined, digits = 1, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtSigned(v: number | null | undefined, digits = 1, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}${suffix}`;
}

interface CompareMetricRow {
  label: string;
  section?: string;
  direction: 'higher' | 'lower' | 'none';
  getNum: (r: ScreenedCompanyRow) => number | null;
  format: (r: ScreenedCompanyRow) => React.ReactNode;
}

export interface PeerComparisonArenaProps {
  rows: ScreenedCompanyRow[];
  onRemoveSymbol: (symbol: string) => void;
  onInspectSymbol: (symbol: string) => void;
  onClear: () => void;
}

export const PeerComparisonArena: React.FC<PeerComparisonArenaProps> = ({
  rows,
  onRemoveSymbol,
  onInspectSymbol,
  onClear,
}) => {
  const metricRows: CompareMetricRow[] = useMemo(
    () => [
      {
        section: 'Composite & Consensus',
        label: 'Overall Score',
        direction: 'higher',
        getNum: (r) => (r.hasFundamentalData ? r.scores.overallScore : null),
        format: (r) => (r.hasFundamentalData ? `${r.scores.overallScore.toFixed(1)} / 100` : '—'),
      },
      {
        label: 'Verdict · Investors Passed',
        direction: 'higher',
        getNum: (r) => (r.hasFundamentalData ? r.passedInvestorCount : null),
        format: (r) =>
          r.hasFundamentalData ? `${r.recommendation.verdict} · ${r.passedInvestorCount}/9` : 'Pending',
      },
      {
        label: 'Quality / Valuation / Growth',
        direction: 'higher',
        getNum: (r) => (r.hasFundamentalData ? r.scores.fundamentalQualityScore : null),
        format: (r) =>
          r.hasFundamentalData
            ? `${r.scores.fundamentalQualityScore.toFixed(0)} · ${r.scores.valuationAttractivenessScore.toFixed(0)} · ${r.scores.growthScore.toFixed(0)}`
            : '—',
      },
      {
        section: 'Valuation & Margin of Safety',
        label: 'Market LTP (Rs)',
        direction: 'none',
        getNum: (r) => r.market.ltp,
        format: (r) => fmtNum(r.market.ltp, 1),
      },
      {
        label: 'Intrinsic Fair Value (Rs)',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.intrinsicValue,
        format: (r) => fmtNum(r.keyMetrics.intrinsicValue, 1),
      },
      {
        label: 'Margin of Safety',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.marginOfSafetyPct,
        format: (r) => fmtSigned(r.keyMetrics.marginOfSafetyPct, 1, '%'),
      },
      {
        label: 'P/E Ratio',
        direction: 'lower',
        getNum: (r) => (r.keyMetrics.pe !== null && r.keyMetrics.pe > 0 ? r.keyMetrics.pe : null),
        format: (r) => fmtNum(r.keyMetrics.pe, 1, 'x'),
      },
      {
        label: 'P/B Ratio',
        direction: 'lower',
        getNum: (r) => (r.keyMetrics.pb !== null && r.keyMetrics.pb > 0 ? r.keyMetrics.pb : null),
        format: (r) => fmtNum(r.keyMetrics.pb, 2, 'x'),
      },
      {
        label: 'PEG Ratio',
        direction: 'lower',
        getNum: (r) => (r.keyMetrics.peg !== null && r.keyMetrics.peg > 0 ? r.keyMetrics.peg : null),
        format: (r) => fmtNum(r.keyMetrics.peg, 2, 'x'),
      },
      {
        label: 'Earnings Yield',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.earningsYieldPct,
        format: (r) => fmtNum(r.keyMetrics.earningsYieldPct, 2, '%'),
      },
      {
        section: 'Previous Quarter Comparison',
        label: 'Latest vs Prev Period',
        direction: 'none',
        getNum: () => null,
        format: (r) =>
          r.keyMetrics.prevPeriodLabel
            ? `${r.latestPeriod.periodLabel} vs ${r.keyMetrics.prevPeriodLabel}`
            : r.latestPeriod.periodLabel,
      },
      {
        label: 'EPS (Trend · Now / Prev Q)',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.eps,
        format: (r) => (
          <div className="inline-flex items-center justify-end gap-2">
            <GrowthTrendSparkline
              values={r.keyMetrics.trends.eps}
              periods={r.keyMetrics.trends.periods}
              metricName="EPS"
              digits={2}
              width={42}
              height={14}
            />
            <span>
              {fmtNum(r.keyMetrics.eps, 2)} / {fmtNum(r.keyMetrics.prevEps, 2)}
            </span>
          </div>
        ),
      },
      {
        label: 'EPS QoQ · YoY %',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.epsYoyPct ?? r.keyMetrics.epsQoqPct,
        format: (r) =>
          `${fmtSigned(r.keyMetrics.epsQoqPct, 1, '%')} · ${fmtSigned(r.keyMetrics.epsYoyPct, 1, '%')}`,
      },
      {
        label: 'Revenue (Trend · Cr)',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.revenueCr,
        format: (r) => (
          <div className="inline-flex items-center justify-end gap-2">
            <GrowthTrendSparkline
              values={r.keyMetrics.trends.revenueCr}
              periods={r.keyMetrics.trends.periods}
              metricName="Revenue"
              unit=" Cr"
              digits={1}
              width={42}
              height={14}
            />
            <span>{fmtNum(r.keyMetrics.revenueCr, 1, 'Cr')}</span>
          </div>
        ),
      },
      {
        label: 'Revenue QoQ · YoY %',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.revenueYoyPct ?? r.keyMetrics.revenueQoqPct,
        format: (r) =>
          `${fmtSigned(r.keyMetrics.revenueQoqPct, 1, '%')} · ${fmtSigned(r.keyMetrics.revenueYoyPct, 1, '%')}`,
      },
      {
        label: 'Net Profit (Trend · Cr)',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.netProfitCr,
        format: (r) => (
          <div className="inline-flex items-center justify-end gap-2">
            <GrowthTrendSparkline
              values={r.keyMetrics.trends.netProfitCr}
              periods={r.keyMetrics.trends.periods}
              metricName="Net Profit"
              unit=" Cr"
              digits={1}
              width={42}
              height={14}
            />
            <span>{fmtNum(r.keyMetrics.netProfitCr, 1, 'Cr')}</span>
          </div>
        ),
      },
      {
        label: 'Net Profit QoQ · YoY %',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.netProfitYoyPct ?? r.keyMetrics.netProfitQoqPct,
        format: (r) =>
          `${fmtSigned(r.keyMetrics.netProfitQoqPct, 1, '%')} · ${fmtSigned(r.keyMetrics.netProfitYoyPct, 1, '%')}`,
      },
      {
        label: 'ROE QoQ Shift',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.roeQoqDeltaPct,
        format: (r) => fmtSigned(r.keyMetrics.roeQoqDeltaPct, 2, ' pp'),
      },
      {
        section: 'Multi-Horizon Growth',
        label: 'Same Qtr Last Yr Period',
        direction: 'none',
        getNum: () => null,
        format: (r) => r.keyMetrics.yoyPeriodLabel ?? '—',
      },
      {
        label: '3Y / 5Y EPS CAGR',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.epsCagr3yPct,
        format: (r) =>
          `${fmtSigned(r.keyMetrics.epsCagr3yPct, 1, '%')} / ${fmtSigned(r.keyMetrics.epsCagr5yPct, 1, '%')}`,
      },
      {
        section: 'Profitability & Balance Sheet Safety',
        label: 'ROE % · ROA %',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.roePct,
        format: (r) =>
          `${fmtNum(r.keyMetrics.roePct, 1, '%')} · ${fmtNum(r.keyMetrics.roaPct, 2, '%')}`,
      },
      {
        label: 'Net Profit Margin',
        direction: 'higher',
        getNum: (r) => r.keyMetrics.netMarginPct,
        format: (r) => fmtNum(r.keyMetrics.netMarginPct, 1, '%'),
      },
      {
        label: 'Debt/Equity · NPL %',
        direction: 'lower',
        getNum: (r) => r.keyMetrics.nplPct ?? r.keyMetrics.debtToEquity,
        format: (r) =>
          `${fmtNum(r.keyMetrics.debtToEquity, 2, 'x')} · ${fmtNum(r.keyMetrics.nplPct, 2, '%')}`,
      },
    ],
    []
  );

  if (rows.length === 0) return null;

  // Determine leader index for each row when >= 2 rows have numeric values
  const getBestIndex = (m: CompareMetricRow): number | null => {
    if (m.direction === 'none' || rows.length < 2) return null;
    let bestIdx: number | null = null;
    let bestVal: number | null = null;
    rows.forEach((r, idx) => {
      const v = m.getNum(r);
      if (v === null || !Number.isFinite(v)) return;
      if (bestVal === null) {
        bestVal = v;
        bestIdx = idx;
      } else if (m.direction === 'higher' ? v > bestVal : v < bestVal) {
        bestVal = v;
        bestIdx = idx;
      }
    });
    return bestIdx;
  };

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Side-by-Side Peer Comparison ({rows.length}/4 selected)
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Emerald values mark the peer leader for each fundamental metric · Click a symbol to open its full 9-investor dossier
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="px-2.5 py-1 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            Clear Selection
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200 dark:divide-slate-800">
        {/* Comparison Matrix */}
        <div className="xl:col-span-7 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <th className="px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400 w-44">
                  Metric
                </th>
                {rows.map((r, idx) => (
                  <th key={r.symbol} className="px-3 py-2 text-right font-medium min-w-[125px]">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <span
                        className="inline-block w-2 h-2 rounded-sm shrink-0"
                        style={{ backgroundColor: COMPARE_SERIES_COLORS[idx % COMPARE_SERIES_COLORS.length] }}
                      />
                      <button
                        type="button"
                        onClick={() => onInspectSymbol(r.symbol)}
                        className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {r.symbol}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveSymbol(r.symbol)}
                        aria-label={`Remove ${r.symbol} from comparison`}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-[10px] font-normal text-slate-400 truncate max-w-[130px] ml-auto">
                      {r.sector}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {metricRows.map((m) => {
                const bestIdx = getBestIndex(m);
                return (
                  <React.Fragment key={m.label}>
                    {m.section && (
                      <tr className="bg-slate-50/70 dark:bg-slate-950/60">
                        <td
                          colSpan={rows.length + 1}
                          className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                        >
                          {m.section}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {m.label}
                      </td>
                      {rows.map((r, idx) => {
                        const isLeader = bestIdx === idx;
                        return (
                          <td
                            key={`${m.label}-${r.symbol}`}
                            className={`px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap ${
                              isLeader
                                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {m.format(r)}
                          </td>
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 9-Investor Grouped Horizontal Comparison Bars */}
        <div className="xl:col-span-5 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                9-Investor DNA Comparison (0–100)
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Vertical dashed line marks 65/100 qualification threshold
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
              {rows.map((r, idx) => (
                <span key={r.symbol} className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <span
                    className="w-2.5 h-2.5 rounded-sm inline-block"
                    style={{ backgroundColor: COMPARE_SERIES_COLORS[idx % COMPARE_SERIES_COLORS.length] }}
                  />
                  {r.symbol}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            {INVESTOR_META.map((inv) => (
              <div key={inv.id} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{inv.label}</span>
                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {rows
                      .map((r) => `${r.symbol} ${(r.investorScores[inv.id] ?? 0).toFixed(0)}`)
                      .join(' · ')}
                  </span>
                </div>
                <div className="relative space-y-1">
                  {/* 65-point threshold guide */}
                  <div
                    className="absolute top-0 bottom-0 border-l border-dashed border-slate-300 dark:border-slate-700 pointer-events-none"
                    style={{ left: '65%' }}
                  />
                  {rows.map((r, idx) => {
                    const score = Math.max(0, Math.min(100, r.investorScores[inv.id] ?? 0));
                    return (
                      <div
                        key={`${inv.id}-${r.symbol}`}
                        className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-sm overflow-hidden"
                      >
                        <div
                          className="h-full transition-all duration-200"
                          style={{
                            width: `${score}%`,
                            backgroundColor:
                              COMPARE_SERIES_COLORS[idx % COMPARE_SERIES_COLORS.length],
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export interface ValuationSensitivitySimulatorProps {
  candidates: ScreenedCompanyRow[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
  onInspectSymbol: (symbol: string) => void;
  benchmarkFdRatePct?: number;
}

export const ValuationSensitivitySimulator: React.FC<ValuationSensitivitySimulatorProps> = ({
  candidates,
  selectedSymbol,
  onSelectSymbol,
  onInspectSymbol,
  benchmarkFdRatePct = 6.5,
}) => {
  const activeRow = useMemo(() => {
    if (candidates.length === 0) return null;
    return (
      candidates.find((c) => c.symbol === selectedSymbol) ??
      candidates[0]
    );
  }, [candidates, selectedSymbol]);

  const defaultLtp = activeRow?.market.ltp ?? 400;
  const defaultGrowth = useMemo(() => {
    const g =
      activeRow?.keyMetrics.epsCagr3yPct ??
      activeRow?.keyMetrics.epsYoyPct ??
      activeRow?.keyMetrics.netProfitYoyPct ??
      10;
    return Math.max(2, Math.min(28, Math.round(g)));
  }, [activeRow]);

  const [targetPrice, setTargetPrice] = useState<number>(defaultLtp);
  const [discountRatePct, setDiscountRatePct] = useState<number>(11.5);
  const [growthRatePct, setGrowthRatePct] = useState<number>(defaultGrowth);

  useEffect(() => {
    if (activeRow) {
      setTargetPrice(Math.round(activeRow.market.ltp ?? 400));
      setDiscountRatePct(11.5);
      setGrowthRatePct(defaultGrowth);
    }
  }, [activeRow?.symbol, activeRow?.market.ltp, defaultGrowth]);

  if (!activeRow) {
    return (
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 text-xs text-slate-500 dark:text-slate-400">
        No evaluated companies with live market LTP available yet for What-If simulation.
      </div>
    );
  }

  const ltp = activeRow.market.ltp ?? targetPrice;
  const eps = activeRow.keyMetrics.eps;
  const bvps = activeRow.keyMetrics.bvps;
  const baseIntrinsic = activeRow.keyMetrics.intrinsicValue;
  const baselineGrowth = Math.max(
    2,
    Math.min(
      28,
      activeRow.keyMetrics.epsCagr3yPct ?? activeRow.keyMetrics.epsYoyPct ?? 10
    )
  );

  // Adjust baseline intrinsic value smoothly for discount-rate sensitivity (ke baseline 11.5%)
  // and growth expectation delta around the company's baseline growth rate.
  const keRatio = 11.5 / Math.max(7.0, discountRatePct);
  const growthMultiplier = (1 + growthRatePct / 100) / (1 + baselineGrowth / 100);
  const adjustedIntrinsic =
    baseIntrinsic !== null && baseIntrinsic > 0
      ? Number((baseIntrinsic * keRatio * Math.pow(growthMultiplier, 1.35)).toFixed(1))
      : eps !== null && eps > 0
        ? Number((eps * (8.5 + growthRatePct * 0.7) * keRatio).toFixed(1))
        : null;

  const simPe = eps !== null && eps > 0 ? targetPrice / eps : null;
  const simPb = bvps !== null && bvps > 0 ? targetPrice / bvps : null;
  const simPeg = simPe !== null && growthRatePct > 0 ? simPe / growthRatePct : null;
  const simEarningsYield = simPe !== null && simPe > 0 ? 100 / simPe : null;
  const yieldSpread =
    simEarningsYield !== null ? simEarningsYield - benchmarkFdRatePct : null;
  const simMosPct =
    adjustedIntrinsic !== null && adjustedIntrinsic > 0
      ? ((adjustedIntrinsic - targetPrice) / adjustedIntrinsic) * 100
      : null;

  const mos15Price = adjustedIntrinsic ? Math.round(adjustedIntrinsic * 0.85) : null;
  const mos25Price = adjustedIntrinsic ? Math.round(adjustedIntrinsic * 0.75) : null;
  const mos35Price = adjustedIntrinsic ? Math.round(adjustedIntrinsic * 0.65) : null;

  const minSliderPrice = Math.max(10, Math.round(ltp * 0.4));
  const maxSliderPrice = Math.max(minSliderPrice + 50, Math.round(ltp * 1.6));

  const ruleChecks = [
    {
      label: 'Graham Value (P/E ≤ 15x)',
      passed: simPe !== null && simPe <= 15,
      detail: simPe !== null ? `${simPe.toFixed(1)}x` : 'N/A',
    },
    {
      label: 'Lynch GARP (PEG ≤ 1.0x)',
      passed: simPeg !== null && simPeg <= 1.0,
      detail: simPeg !== null ? `${simPeg.toFixed(2)}x` : 'N/A',
    },
    {
      label: 'Buffett Safety (MoS ≥ 15%)',
      passed: simMosPct !== null && simMosPct >= 15,
      detail: simMosPct !== null ? `${simMosPct >= 0 ? '+' : ''}${simMosPct.toFixed(1)}%` : 'N/A',
    },
    {
      label: `Earnings Yield > FD + 2% (${(benchmarkFdRatePct + 2).toFixed(1)}%)`,
      passed: simEarningsYield !== null && simEarningsYield >= benchmarkFdRatePct + 2,
      detail: simEarningsYield !== null ? `${simEarningsYield.toFixed(2)}%` : 'N/A',
    },
  ];

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              What-If Target Entry &amp; Margin-of-Safety Simulator
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Stress-test buy prices, discount rates, and sustainable EPS growth to locate exact Buffett/Graham entry zones
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeRow.symbol}
            onChange={(e) => onSelectSymbol(e.target.value)}
            className="px-2.5 py-1.5 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            {candidates.map((c) => (
              <option key={c.symbol} value={c.symbol}>
                {c.symbol} · LTP {c.market.ltp?.toFixed(0) ?? '—'} · Score {c.scores.overallScore.toFixed(0)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setTargetPrice(Math.round(ltp));
              setDiscountRatePct(11.5);
              setGrowthRatePct(defaultGrowth);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            onClick={() => onInspectSymbol(activeRow.symbol)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
          >
            <span>Open Full Dossier</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
        {/* Controls Column */}
        <div className="lg:col-span-5 p-4 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Target Entry Price (Rs)
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                Rs {targetPrice.toFixed(0)}{' '}
                <span className="text-[11px] font-normal text-slate-400">
                  (vs LTP {ltp.toFixed(0)}: {(((targetPrice - ltp) / ltp) * 100 >= 0 ? '+' : '')}
                  {(((targetPrice - ltp) / ltp) * 100).toFixed(1)}%)
                </span>
              </span>
            </div>
            <input
              type="range"
              min={minSliderPrice}
              max={maxSliderPrice}
              step={1}
              value={Math.min(maxSliderPrice, Math.max(minSliderPrice, targetPrice))}
              onChange={(e) => setTargetPrice(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
              <button
                type="button"
                onClick={() => setTargetPrice(Math.round(ltp))}
                className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-mono"
              >
                LTP {ltp.toFixed(0)}
              </button>
              {mos15Price && (
                <button
                  type="button"
                  onClick={() => setTargetPrice(mos15Price)}
                  className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-mono"
                >
                  15% MoS: {mos15Price}
                </button>
              )}
              {mos25Price && (
                <button
                  type="button"
                  onClick={() => setTargetPrice(mos25Price)}
                  className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-mono"
                >
                  25% MoS: {mos25Price}
                </button>
              )}
              {mos35Price && (
                <button
                  type="button"
                  onClick={() => setTargetPrice(mos35Price)}
                  className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-mono"
                >
                  35% MoS: {mos35Price}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Required Hurdle / Discount Rate (ke)
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {discountRatePct.toFixed(1)}%
              </span>
            </div>
            <input
              type="range"
              min={7.5}
              max={18}
              step={0.5}
              value={discountRatePct}
              onChange={(e) => setDiscountRatePct(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Assumed Sustainable EPS Growth
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {growthRatePct.toFixed(0)}% / yr
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={28}
              step={1}
              value={growthRatePct}
              onChange={(e) => setGrowthRatePct(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>
        </div>

        {/* Simulated Output Grid */}
        <div className="lg:col-span-7 p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Adjusted Fair Value</div>
              <div className="text-base font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {adjustedIntrinsic !== null ? `Rs ${adjustedIntrinsic.toFixed(1)}` : '—'}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                Base: {baseIntrinsic !== null ? `Rs ${baseIntrinsic.toFixed(1)}` : '—'}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Simulated MoS %</div>
              <div
                className={`text-base font-mono font-semibold tabular-nums mt-0.5 ${
                  simMosPct !== null && simMosPct >= 15
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : simMosPct !== null && simMosPct < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {simMosPct !== null ? `${simMosPct >= 0 ? '+' : ''}${simMosPct.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                Reported: {fmtSigned(activeRow.keyMetrics.marginOfSafetyPct, 1, '%')}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Target P/E · P/B</div>
              <div className="text-base font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {fmtNum(simPe, 1, 'x')} · {fmtNum(simPb, 2, 'x')}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                EPS {fmtNum(eps, 2)} · BVPS {fmtNum(bvps, 1)}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Target PEG Ratio</div>
              <div
                className={`text-base font-mono font-semibold tabular-nums mt-0.5 ${
                  simPeg !== null && simPeg <= 1.0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {fmtNum(simPeg, 2, 'x')}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                At {growthRatePct.toFixed(0)}% CAGR
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Earnings Yield vs FD</div>
              <div className="text-base font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {fmtNum(simEarningsYield, 2, '%')}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                Spread vs {benchmarkFdRatePct.toFixed(1)}%: {fmtSigned(yieldSpread, 2, '%')}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Suggested Buy Zones</div>
              <div className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
                {mos15Price ? `≤ ${mos15Price}` : '—'} (15%) · {mos25Price ? `≤ ${mos25Price}` : '—'} (25%)
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                Deep safety (35%): {mos35Price ? `Rs ${mos35Price}` : '—'}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {ruleChecks.map((rc) => (
              <div
                key={rc.label}
                className="flex items-center justify-between px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800"
              >
                <span className="text-slate-700 dark:text-slate-300">{rc.label}</span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    rc.passed
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {rc.detail} · {rc.passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
