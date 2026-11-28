import React, { useMemo, useState } from 'react';
import {
  CandlestickChart,
  GitCompare,
  Plus,
  Scale,
  Trash2,
  X,
} from 'lucide-react';
import { useCompareList } from '../hooks/useWatchlist';
import type { MasterScreenerRow } from '../types/fundamental';
import { buildPlainEnglishVerdict } from '../utils/plainEnglish';

interface CompareStocksDrawerProps {
  open: boolean;
  onClose: () => void;
  rows: MasterScreenerRow[];
  onOpenValuation: (symbol: string) => void;
  onInspectSymbol: (symbol: string) => void;
}

interface MetricSpec {
  label: string;
  group:
    | 'Pricing & Value'
    | 'Annual Health & Fundamentals'
    | '3-Year 4Q Average Baseline'
    | 'Technical & Player Flow'
    | '10x Runway';
  higherBetter?: boolean;
  lowerBetter?: boolean;
  getVal: (r: MasterScreenerRow) => number | null;
  format: (r: MasterScreenerRow) => string;
}

const COMPARE_METRICS: MetricSpec[] = [
  {
    label: 'LTP (Latest EOD)',
    group: 'Pricing & Value',
    getVal: (r) => r.ltp,
    format: (r) => (r.ltp !== null ? `Rs ${r.ltp.toFixed(0)}` : '—'),
  },
  {
    label: 'Composite Fair Value',
    group: 'Pricing & Value',
    getVal: (r) => r.valuation.compositeFairValue,
    format: (r) =>
      r.valuation.compositeFairValue !== null
        ? `Rs ${r.valuation.compositeFairValue.toFixed(0)}`
        : '—',
  },
  {
    label: 'Margin of Safety (%)',
    group: 'Pricing & Value',
    higherBetter: true,
    getVal: (r) => r.valuation.marginOfSafetyPct,
    format: (r) =>
      r.valuation.marginOfSafetyPct !== null
        ? `${r.valuation.marginOfSafetyPct >= 0 ? '+' : ''}${r.valuation.marginOfSafetyPct.toFixed(1)}%`
        : '—',
  },
  {
    label: 'Buy Zone Price (≤ 85% FV)',
    group: 'Pricing & Value',
    getVal: (r) => r.valuation.buyZonePrice,
    format: (r) =>
      r.valuation.buyZonePrice !== null ? `Rs ${r.valuation.buyZonePrice.toFixed(0)}` : '—',
  },
  {
    label: 'FD Yield Spread',
    group: 'Pricing & Value',
    higherBetter: true,
    getVal: (r) => r.valuation.fdSpreadPct,
    format: (r) =>
      r.valuation.fdSpreadPct !== null
        ? `${r.valuation.fdSpreadPct >= 0 ? '+' : ''}${r.valuation.fdSpreadPct.toFixed(2)}%`
        : '—',
  },
  {
    label: 'Valuation Health Score',
    group: 'Annual Health & Fundamentals',
    higherBetter: true,
    getVal: (r) => r.valuation.valuationHealthScore,
    format: (r) =>
      r.valuation.valuationHealthScore !== null
        ? `${r.valuation.valuationHealthScore.toFixed(0)} / 100`
        : '—',
  },
  {
    label: '9-Investor Score & Passes',
    group: 'Annual Health & Fundamentals',
    higherBetter: true,
    getVal: (r) => r.fundamentals.overallScore,
    format: (r) =>
      `${r.fundamentals.overallScore.toFixed(0)} (${r.fundamentals.passedInvestorCount}/9)`,
  },
  {
    label: 'P/E Ratio',
    group: 'Annual Health & Fundamentals',
    lowerBetter: true,
    getVal: (r) => (r.valuation.pe && r.valuation.pe > 0 ? r.valuation.pe : null),
    format: (r) => (r.valuation.pe !== null ? `${r.valuation.pe.toFixed(1)}x` : '—'),
  },
  {
    label: 'P/B Ratio',
    group: 'Annual Health & Fundamentals',
    lowerBetter: true,
    getVal: (r) => (r.valuation.pb && r.valuation.pb > 0 ? r.valuation.pb : null),
    format: (r) => (r.valuation.pb !== null ? `${r.valuation.pb.toFixed(2)}x` : '—'),
  },
  {
    label: 'Return on Equity (ROE)',
    group: 'Annual Health & Fundamentals',
    higherBetter: true,
    getVal: (r) => r.fundamentals.roePct,
    format: (r) => (r.fundamentals.roePct !== null ? `${r.fundamentals.roePct.toFixed(1)}%` : '—'),
  },
  {
    label: 'EPS (70% Annual Blended)',
    group: 'Annual Health & Fundamentals',
    higherBetter: true,
    getVal: (r) => r.earnings.eps,
    format: (r) => (r.earnings.eps !== null ? `Rs ${r.earnings.eps.toFixed(1)}` : '—'),
  },
  {
    label: 'Reserve / Capital Cushion',
    group: 'Annual Health & Fundamentals',
    higherBetter: true,
    getVal: (r) => r.fundamentals.reserveToCapitalRatio,
    format: (r) =>
      r.fundamentals.reserveToCapitalRatio !== null
        ? `${r.fundamentals.reserveToCapitalRatio.toFixed(2)}x`
        : '—',
  },
  {
    label: 'Op. Profit vs 3Y 4Q Avg',
    group: '3-Year 4Q Average Baseline',
    higherBetter: true,
    getVal: (r) => r.earnings.operatingProfitVsQ4Avg3yPct,
    format: (r) =>
      r.earnings.operatingProfitVsQ4Avg3yPct !== null
        ? `${r.earnings.operatingProfitVsQ4Avg3yPct >= 0 ? '+' : ''}${r.earnings.operatingProfitVsQ4Avg3yPct.toFixed(1)}% (Avg ${r.earnings.q4AvgOperatingProfitCr3y?.toFixed(1) ?? '—'} Cr)`
        : '—',
  },
  {
    label: 'EPS vs 3Y 4Q Avg',
    group: '3-Year 4Q Average Baseline',
    higherBetter: true,
    getVal: (r) => r.earnings.epsVsQ4Avg3yPct,
    format: (r) =>
      r.earnings.epsVsQ4Avg3yPct !== null
        ? `${r.earnings.epsVsQ4Avg3yPct >= 0 ? '+' : ''}${r.earnings.epsVsQ4Avg3yPct.toFixed(1)}% (Avg ${r.earnings.q4AvgEps3y?.toFixed(1) ?? '—'})`
        : '—',
  },
  {
    label: 'Net Profit vs 3Y 4Q Avg',
    group: '3-Year 4Q Average Baseline',
    higherBetter: true,
    getVal: (r) => r.earnings.netProfitVsQ4Avg3yPct,
    format: (r) =>
      r.earnings.netProfitVsQ4Avg3yPct !== null
        ? `${r.earnings.netProfitVsQ4Avg3yPct >= 0 ? '+' : ''}${r.earnings.netProfitVsQ4Avg3yPct.toFixed(1)}% (Avg ${r.earnings.q4AvgNetProfitCr3y?.toFixed(1) ?? '—'} Cr)`
        : '—',
  },
  {
    label: 'Revenue vs 3Y 4Q Avg',
    group: '3-Year 4Q Average Baseline',
    higherBetter: true,
    getVal: (r) => r.earnings.revenueVsQ4Avg3yPct,
    format: (r) =>
      r.earnings.revenueVsQ4Avg3yPct !== null
        ? `${r.earnings.revenueVsQ4Avg3yPct >= 0 ? '+' : ''}${r.earnings.revenueVsQ4Avg3yPct.toFixed(1)}% (Avg ${r.earnings.q4AvgRevenueCr3y?.toFixed(1) ?? '—'} Cr)`
        : '—',
  },
  {
    label: 'Technical Score & RSI-14',
    group: 'Technical & Player Flow',
    higherBetter: true,
    getVal: (r) => r.technical.technicalScore,
    format: (r) =>
      `${r.technical.technicalScore.toFixed(0)} · RSI ${r.technical.rsi14?.toFixed(0) ?? '—'}`,
  },
  {
    label: 'Chart Trend',
    group: 'Technical & Player Flow',
    getVal: () => null,
    format: (r) => r.technical.trendState,
  },
  {
    label: 'Player Flow Score',
    group: 'Technical & Player Flow',
    higherBetter: true,
    getVal: (r) => r.liquidity.playerInterestScore,
    format: (r) => `${r.liquidity.playerInterestScore.toFixed(0)} / 100`,
  },
  {
    label: '20D Avg Turnover',
    group: 'Technical & Player Flow',
    higherBetter: true,
    getVal: (r) => r.liquidity.avgTurnover20Cr,
    format: (r) => `Rs ${r.liquidity.avgTurnover20Cr.toFixed(2)} Cr`,
  },
  {
    label: 'Future 10x Score',
    group: '10x Runway',
    higherBetter: true,
    getVal: (r) => r.tenX.tenXScore,
    format: (r) => `${r.tenX.tenXScore.toFixed(0)} / 100`,
  },
  {
    label: '5Y Bull Target & Multiple',
    group: '10x Runway',
    higherBetter: true,
    getVal: (r) => r.tenX.bull5yMultiple,
    format: (r) =>
      r.tenX.bull5yPrice && r.tenX.bull5yMultiple
        ? `Rs ${r.tenX.bull5yPrice.toFixed(0)} (${r.tenX.bull5yMultiple.toFixed(1)}x)`
        : '—',
  },
];

export const CompareStocksDrawer: React.FC<CompareStocksDrawerProps> = ({
  open,
  onClose,
  rows,
  onOpenValuation,
  onInspectSymbol,
}) => {
  const { compareSymbols, toggleCompare, removeCompare, clearCompare, setCompareSymbols } =
    useCompareList();
  const [addInput, setAddInput] = useState<string>('');

  const rowMap = useMemo(() => {
    const m = new Map<string, MasterScreenerRow>();
    for (const r of rows) m.set(r.symbol, r);
    return m;
  }, [rows]);

  const selectedRows = useMemo(
    () =>
      compareSymbols
        .map((sym) => rowMap.get(sym))
        .filter((r): r is MasterScreenerRow => Boolean(r)),
    [compareSymbols, rowMap]
  );

  if (!open) return null;

  const groups: MetricSpec['group'][] = [
    'Pricing & Value',
    'Annual Health & Fundamentals',
    '3-Year 4Q Average Baseline',
    'Technical & Player Flow',
    '10x Runway',
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/50 transition-opacity" onClick={onClose} />
      <aside className="relative z-10 w-full max-w-4xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                Side-by-Side Stock Comparison ({selectedRows.length}/4)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Compare up to 4 NEPSE companies across Fair Value, Annual Health, Technicals, Player Flow &amp; 10x Runway
            </p>
          </div>

          <div className="flex items-center gap-2">
            {selectedRows.length > 0 && (
              <button
                type="button"
                onClick={clearCompare}
                className="px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Clear All
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close comparison drawer"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Add Stock Bar */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-950/60">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = addInput.trim().toUpperCase();
              if (!clean || !rowMap.has(clean)) return;
              if (!compareSymbols.includes(clean)) toggleCompare(clean);
              setAddInput('');
            }}
            className="flex items-center gap-2 flex-1 max-w-sm"
          >
            <input
              type="text"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value.toUpperCase())}
              placeholder="Add stock to compare (e.g. EBL, NABIL)…"
              list="compare-ticker-suggestions"
              className="flex-1 px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
            />
            <datalist id="compare-ticker-suggestions">
              {rows.map((r) => (
                <option key={r.symbol} value={r.symbol}>
                  {r.companyName}
                </option>
              ))}
            </datalist>
            <button
              type="submit"
              disabled={!addInput.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>

          {rows.length >= 3 && (
            <button
              type="button"
              onClick={() => setCompareSymbols(rows.slice(0, 3).map((r) => r.symbol))}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Load Top 3 Confluence Stocks
            </button>
          )}
        </div>

        <div className="flex-1 overflow-auto p-5">
          {selectedRows.length === 0 ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center space-y-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Select 2 to 4 stocks to compare side by side
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Click <span className="font-semibold">+ Compare</span> on any stock card in Today Briefing, Master Screener, Watchlist, or the Stock 360° bar—or add symbols above.
              </p>
              {rows.length >= 3 && (
                <button
                  type="button"
                  onClick={() => setCompareSymbols(rows.slice(0, 3).map((r) => r.symbol))}
                  className="px-3.5 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Compare Top 3 Picks Now
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {selectedRows.some((r) => r.earnings.q4AvgYearsCount > 0) &&
                (() => {
                  const chartItems = selectedRows.map((r) => ({
                    symbol: r.symbol,
                    yearsCount: r.earnings.q4AvgYearsCount,
                    opDelta: r.earnings.operatingProfitVsQ4Avg3yPct,
                    epsDelta: r.earnings.epsVsQ4Avg3yPct,
                    opIdx:
                      r.earnings.operatingProfitVsQ4Avg3yPct !== null
                        ? Math.max(0, 100 + r.earnings.operatingProfitVsQ4Avg3yPct)
                        : null,
                    epsIdx:
                      r.earnings.epsVsQ4Avg3yPct !== null
                        ? Math.max(0, 100 + r.earnings.epsVsQ4Avg3yPct)
                        : null,
                  }));
                  const maxIdx = Math.max(
                    150,
                    ...chartItems.flatMap((i) => [i.opIdx ?? 0, i.epsIdx ?? 0])
                  );
                  const scaleMax = Math.ceil(maxIdx / 25) * 25;
                  const refLeftPct = (100 / scaleMax) * 100;
                  return (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 bg-slate-50/50 dark:bg-slate-950/40 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            Current Growth Performance vs 3-Year 4Q Average Baseline
                          </span>
                          <span className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">
                            (100% dashed line = 3-Year 4Q Average)
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-1.5 rounded-xs bg-emerald-600 inline-block" />
                            Op. Profit
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-1.5 rounded-xs bg-blue-500 inline-block" />
                            EPS
                          </span>
                        </div>
                      </div>
                      <div className="relative pt-4 space-y-2">
                        <div
                          className="absolute top-0 bottom-0 border-l-2 border-dashed border-amber-500/80 dark:border-amber-400/80 pointer-events-none z-10"
                          style={{ left: `${refLeftPct}%` }}
                        >
                          <span className="absolute -top-0.5 -translate-x-1/2 px-1 bg-white dark:bg-slate-900 text-[9px] font-mono font-semibold text-amber-700 dark:text-amber-300 whitespace-nowrap">
                            3-Year 4Q Avg (100%)
                          </span>
                        </div>
                        {chartItems.map((item) => (
                          <div key={item.symbol} className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {item.symbol}{' '}
                                {item.yearsCount > 0 && (
                                  <span className="font-normal text-[10px] text-slate-400">
                                    ({item.yearsCount}Y Q4)
                                  </span>
                                )}
                              </span>
                              <span className="text-[10px] text-slate-600 dark:text-slate-300">
                                Op:{' '}
                                {item.opDelta !== null
                                  ? `${item.opDelta >= 0 ? '+' : ''}${item.opDelta.toFixed(1)}%`
                                  : '—'}{' '}
                                · EPS:{' '}
                                {item.epsDelta !== null
                                  ? `${item.epsDelta >= 0 ? '+' : ''}${item.epsDelta.toFixed(1)}%`
                                  : '—'}
                              </span>
                            </div>
                            <div className="space-y-1">
                              <div className="h-2 w-full bg-slate-200/70 dark:bg-slate-800 rounded-sm overflow-hidden">
                                {item.opIdx !== null && (
                                  <div
                                    className={`h-full ${
                                      (item.opDelta ?? 0) >= 0
                                        ? 'bg-emerald-600 dark:bg-emerald-500'
                                        : 'bg-amber-500 dark:bg-amber-400'
                                    }`}
                                    style={{ width: `${Math.min(100, (item.opIdx / scaleMax) * 100)}%` }}
                                  />
                                )}
                              </div>
                              <div className="h-1.5 w-full bg-slate-200/70 dark:bg-slate-800 rounded-sm overflow-hidden">
                                {item.epsIdx !== null && (
                                  <div
                                    className="h-full bg-blue-500/85 dark:bg-blue-400/85"
                                    style={{ width: `${Math.min(100, (item.epsIdx / scaleMax) * 100)}%` }}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
                    <th className="px-3.5 py-3 text-left font-semibold text-slate-600 dark:text-slate-300 w-52">
                      Metric
                    </th>
                    {selectedRows.map((r) => (
                      <th key={r.symbol} className="px-3.5 py-3 text-right min-w-[155px]">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                            {r.symbol}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeCompare(r.symbol)}
                            title={`Remove ${r.symbol}`}
                            className="p-0.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 truncate max-w-[150px] ml-auto">
                          {r.sector}
                        </div>
                        <div className="flex items-center justify-end gap-1.5 mt-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenValuation(r.symbol);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                          >
                            <Scale className="w-3 h-3" />
                            <span>Valuation</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onInspectSymbol(r.symbol);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <CandlestickChart className="w-3 h-3" />
                            <span>Chart</span>
                          </button>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {groups.map((grp) => {
                    const specs = COMPARE_METRICS.filter((m) => m.group === grp);
                    return (
                      <React.Fragment key={grp}>
                        <tr className="bg-slate-50/70 dark:bg-slate-950/50">
                          <td
                            colSpan={1 + selectedRows.length}
                            className="px-3.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                          >
                            {grp}
                          </td>
                        </tr>
                        {specs.map((spec) => {
                          const vals = selectedRows.map((r) => spec.getVal(r));
                          const validVals = vals.filter((v): v is number => v !== null);
                          const bestVal =
                            validVals.length > 1
                              ? spec.higherBetter
                                ? Math.max(...validVals)
                                : spec.lowerBetter
                                  ? Math.min(...validVals)
                                  : null
                              : null;

                          return (
                            <tr
                              key={spec.label}
                              className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                            >
                              <td className="px-3.5 py-2 text-slate-600 dark:text-slate-300">
                                {spec.label}
                              </td>
                              {selectedRows.map((r, idx) => {
                                const v = vals[idx];
                                const isBest = bestVal !== null && v !== null && v === bestVal;
                                return (
                                  <td
                                    key={r.symbol}
                                    className={`px-3.5 py-2 text-right font-mono tabular-nums ${
                                      isBest
                                        ? 'font-bold text-emerald-600 dark:text-emerald-400'
                                        : 'text-slate-800 dark:text-slate-200'
                                    }`}
                                  >
                                    {spec.format(r)}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}

                  <tr className="bg-slate-50/40 dark:bg-slate-950/30">
                    <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-300 font-medium align-top">
                      Plain-English Takeaway
                    </td>
                    {selectedRows.map((r) => {
                      const v = buildPlainEnglishVerdict(r);
                      return (
                        <td
                          key={r.symbol}
                          className="px-3.5 py-2.5 text-right text-[11px] text-slate-600 dark:text-slate-300 align-top leading-relaxed"
                        >
                          <div className="font-semibold text-slate-900 dark:text-slate-100 mb-0.5">
                            {v.actionCue}
                          </div>
                          <div>{v.headline}</div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
