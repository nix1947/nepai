import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calculator, ChevronDown, ChevronUp, Lock, PencilLine } from 'lucide-react';
import {
  calcNepseBuyCost,
  calcNepseSellProceeds,
  solvePriceForNetProceeds,
} from '../utils/nepseFees';

interface NepseTradePlannerProps {
  symbol: string;
  lastClose: number;
  suggestedEntry?: number | null;
  suggestedStop?: number | null;
  suggestedTarget?: number | null;
}

function formatNpr(val: number, decimals = 2): string {
  if (!Number.isFinite(val)) return 'NPR 0.00';
  const abs = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return val < 0 ? `-NPR ${abs}` : `NPR ${abs}`;
}

export const NepseTradePlanner: React.FC<NepseTradePlannerProps> = ({
  symbol,
  lastClose,
  suggestedEntry,
  suggestedStop,
  suggestedTarget,
}) => {
  // Open by default with predefined valid parameters
  const [open, setOpen] = useState(true);

  const safeEntryBase =
    suggestedEntry && suggestedEntry > 0
      ? Number(suggestedEntry.toFixed(2))
      : lastClose > 0
        ? Number(lastClose.toFixed(2))
        : 500;
  const computeDefaultStop = (refPrice: number, sug?: number | null) =>
    sug && sug > 0 && sug < refPrice
      ? Number(sug.toFixed(2))
      : Number((refPrice * 0.94).toFixed(2));
  const computeDefaultTarget = (refPrice: number, sug?: number | null) =>
    sug && sug > refPrice
      ? Number(sug.toFixed(2))
      : Number((refPrice * 1.12).toFixed(2));

  const [capital, setCapital] = useState<number>(200_000);
  const [riskPct, setRiskPct] = useState<number>(1.5);
  const [maxRiskNpr, setMaxRiskNpr] = useState<number>(3_000);
  const [entry, setEntry] = useState<number>(safeEntryBase);
  const [stop, setStop] = useState<number>(() => computeDefaultStop(safeEntryBase, suggestedStop));
  const [target, setTarget] = useState<number>(() =>
    computeDefaultTarget(safeEntryBase, suggestedTarget)
  );
  const [cgtRate, setCgtRate] = useState<number>(0.075);

  useEffect(() => {
    const nextEntry =
      suggestedEntry && suggestedEntry > 0
        ? Number(suggestedEntry.toFixed(2))
        : lastClose > 0
          ? Number(lastClose.toFixed(2))
          : 500;
    setEntry(nextEntry);
    setStop(computeDefaultStop(nextEntry, suggestedStop));
    setTarget(computeDefaultTarget(nextEntry, suggestedTarget));
  }, [symbol, lastClose, suggestedEntry, suggestedStop, suggestedTarget]);

  // Event-driven bidirectional updates prevent circular dependency loops completely
  const handleCapitalChange = (raw: string) => {
    const val = Number(raw);
    if (!Number.isFinite(val)) return;
    setCapital(val);
    if (val > 0 && riskPct > 0) {
      setMaxRiskNpr(Number(((val * riskPct) / 100).toFixed(2)));
    }
  };

  const handleRiskPctChange = (raw: string) => {
    const val = Number(raw);
    if (!Number.isFinite(val)) return;
    setRiskPct(val);
    if (val > 0 && capital > 0) {
      setMaxRiskNpr(Number(((capital * val) / 100).toFixed(2)));
    }
  };

  const handleMaxRiskChange = (raw: string) => {
    const val = Number(raw);
    if (!Number.isFinite(val)) return;
    setMaxRiskNpr(val);
    if (val > 0 && capital > 0) {
      setRiskPct(Number(((val / capital) * 100).toFixed(2)));
    }
  };

  const handleSimplePositive =
    (setter: React.Dispatch<React.SetStateAction<number>>) => (raw: string) => {
      const val = Number(raw);
      if (!Number.isFinite(val)) return;
      setter(val);
    };

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (capital <= 0) errors.push('Trading capital must be greater than NPR 0.');
    if (riskPct <= 0) errors.push('Risk percentage must be greater than 0%.');
    if (maxRiskNpr <= 0) errors.push('Maximum risk amount must be greater than NPR 0.');
    if (capital > 0 && maxRiskNpr > capital) {
      errors.push('Maximum risk amount cannot exceed total trading capital.');
    }
    if (entry <= 0) errors.push('Entry price must be greater than NPR 0.');
    if (stop <= 0) errors.push('Stop-loss price must be greater than NPR 0.');
    if (target <= 0) errors.push('Target/exit price must be greater than NPR 0.');
    if (entry > 0 && stop > 0 && stop >= entry) {
      errors.push('Stop-loss price must be strictly below entry price.');
    }
    if (entry > 0 && target > 0 && target <= entry) {
      errors.push('Target/exit price must be strictly above entry price.');
    }
    return errors;
  }, [capital, riskPct, maxRiskNpr, entry, stop, target]);

  const calc = useMemo(() => {
    const isValid = validationErrors.length === 0;
    if (!isValid) {
      return {
        isValid: false,
        shares: 0,
        cappedByCapital: false,
        buy: { gross: 0, fee: 0, total: 0 },
        stopSell: { gross: 0, fee: 0, cgt: 0, netReceivable: 0, netProfit: 0 },
        targetSell: { gross: 0, fee: 0, cgt: 0, netReceivable: 0, netProfit: 0 },
        stopLossAmount: 0,
        expectedProfit: 0,
        rrRatio: 0,
        breakevenPrice: 0,
        doubleUpPrice: 0,
        riskPerShare: 0,
      };
    }

    const riskPerShare = entry - stop;
    const riskBasedShares = Math.floor(maxRiskNpr / riskPerShare);
    // Account for ~0.4% max buy charges + Rs 25 DP when computing affordable shares
    const maxAffordableShares = Math.max(0, Math.floor((capital - 25) / (entry * 1.004)));
    const shares = Math.max(0, Math.min(riskBasedShares, maxAffordableShares));
    const cappedByCapital = riskBasedShares > maxAffordableShares;

    const buy = calcNepseBuyCost(shares, entry, 0);
    const stopSell = calcNepseSellProceeds(shares, stop, buy.total, 0, cgtRate);
    const targetSell = calcNepseSellProceeds(shares, target, buy.total, 0, cgtRate);

    const stopLossAmount = Math.max(0, buy.total - stopSell.netReceivable);
    const expectedProfit = targetSell.netProfit;
    const rrRatio = stopLossAmount > 0 ? expectedProfit / stopLossAmount : 0;

    // Breakeven exit price (net proceeds = buy.total), Double-Up price (net proceeds = 2 * buy.total)
    const breakevenPrice = solvePriceForNetProceeds(shares, buy.total, cgtRate, buy.total);
    const doubleUpPrice = solvePriceForNetProceeds(shares, buy.total, cgtRate, buy.total * 2);

    return {
      isValid: true,
      shares,
      cappedByCapital,
      buy,
      stopSell,
      targetSell,
      stopLossAmount,
      expectedProfit,
      rrRatio,
      breakevenPrice,
      doubleUpPrice,
      riskPerShare,
    };
  }, [validationErrors, capital, maxRiskNpr, entry, stop, target, cgtRate]);

  return (
    <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Calculator className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            NEPSE Position Size &amp; Risk-Reward Calculator ({symbol})
          </span>
          <span className="text-slate-400 hidden sm:inline">
            · Live auto-recalculation with SEBON broker slabs, 0.015% fee, NPR 25 DP &amp; CGT
          </span>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-5 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-5">
          {/* Editable Inputs Section */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                <PencilLine className="w-3.5 h-3.5" />
                <span>Editable Trade Inputs</span>
              </div>

              {/* Quick Target Presets */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-slate-400">Quick Target:</span>
                <button
                  type="button"
                  onClick={() => {
                    if (entry > stop && stop > 0) {
                      setTarget(Number((entry + (entry - stop) * 2).toFixed(2)));
                    }
                  }}
                  className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono"
                >
                  1:2 R:R
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (entry > stop && stop > 0) {
                      setTarget(Number((entry + (entry - stop) * 3).toFixed(2)));
                    }
                  }}
                  className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono"
                >
                  1:3 R:R
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (calc.doubleUpPrice > entry) {
                      setTarget(Number(calc.doubleUpPrice.toFixed(2)));
                    }
                  }}
                  className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-emerald-700 dark:text-emerald-400 font-mono"
                >
                  2x Double-Up
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 text-xs">
              <label className="space-y-1">
                <span className="block font-medium text-slate-700 dark:text-slate-300">
                  Trading Capital (NPR)
                </span>
                <input
                  type="number"
                  min={1}
                  step={10000}
                  value={capital}
                  onChange={(e) => handleCapitalChange(e.target.value)}
                  className={`w-full px-2.5 py-2 font-mono tabular-nums rounded-md border bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 ${
                    capital <= 0
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-slate-300 dark:border-slate-700 focus:ring-blue-600'
                  }`}
                />
              </label>

              <label className="space-y-1">
                <span className="block font-medium text-slate-700 dark:text-slate-300">
                  Risk Percentage (%)
                </span>
                <input
                  type="number"
                  min={0.1}
                  max={100}
                  step={0.25}
                  value={riskPct}
                  onChange={(e) => handleRiskPctChange(e.target.value)}
                  className={`w-full px-2.5 py-2 font-mono tabular-nums rounded-md border bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 ${
                    riskPct <= 0
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-slate-300 dark:border-slate-700 focus:ring-blue-600'
                  }`}
                />
              </label>

              <label className="space-y-1">
                <span className="block font-medium text-slate-700 dark:text-slate-300">
                  Maximum Risk (NPR)
                </span>
                <input
                  type="number"
                  min={1}
                  step={250}
                  value={maxRiskNpr}
                  onChange={(e) => handleMaxRiskChange(e.target.value)}
                  className={`w-full px-2.5 py-2 font-mono tabular-nums rounded-md border bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 ${
                    maxRiskNpr <= 0 || maxRiskNpr > capital
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-slate-300 dark:border-slate-700 focus:ring-blue-600'
                  }`}
                />
              </label>

              <label className="space-y-1">
                <span className="block font-medium text-slate-700 dark:text-slate-300">
                  Entry Price (NPR)
                </span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={entry}
                  onChange={(e) => handleSimplePositive(setEntry)(e.target.value)}
                  className={`w-full px-2.5 py-2 font-mono tabular-nums rounded-md border bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 ${
                    entry <= 0
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-slate-300 dark:border-slate-700 focus:ring-blue-600'
                  }`}
                />
              </label>

              <label className="space-y-1">
                <span className="block font-medium text-slate-700 dark:text-slate-300">
                  Stop-Loss Price (NPR)
                </span>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={stop}
                  onChange={(e) => handleSimplePositive(setStop)(e.target.value)}
                  className={`w-full px-2.5 py-2 font-mono tabular-nums rounded-md border bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 ${
                    stop <= 0 || stop >= entry
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-slate-300 dark:border-slate-700 focus:ring-blue-600'
                  }`}
                />
              </label>

              <label className="space-y-1">
                <span className="block font-medium text-slate-700 dark:text-slate-300">
                  Target / Exit Price (NPR)
                </span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={target}
                  onChange={(e) => handleSimplePositive(setTarget)(e.target.value)}
                  className={`w-full px-2.5 py-2 font-mono tabular-nums rounded-md border bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 ${
                    target <= 0 || target <= entry
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-slate-300 dark:border-slate-700 focus:ring-blue-600'
                  }`}
                />
              </label>

              <label className="space-y-1">
                <span className="block font-medium text-slate-700 dark:text-slate-300">
                  CGT Tax Rate
                </span>
                <select
                  value={cgtRate}
                  onChange={(e) => setCgtRate(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-600"
                >
                  <option value={0.075}>7.5% (&lt; 1 Year)</option>
                  <option value={0.05}>5.0% (≥ 1 Year)</option>
                </select>
              </label>
            </div>
          </div>

          {/* Inline Input Validation Alert */}
          {validationErrors.length > 0 && (
            <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <ul className="space-y-0.5">
                {validationErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Read-Only Calculated Outputs Section */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Lock className="w-3.5 h-3.5" />
                <span>Calculated Position &amp; Net Payoff Outputs (Read-Only)</span>
              </div>
              {calc.isValid && calc.cappedByCapital && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  Position capped by available trading capital ({formatNpr(capital, 0)})
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs font-mono tabular-nums">
              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Position Size (Shares)
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {calc.isValid ? `${calc.shares.toLocaleString('en-US')} shares` : '–'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {calc.isValid
                    ? `${Math.floor(calc.shares / 10)} lots (10-kitta) · Risk/sh ${formatNpr(calc.riskPerShare)}`
                    : 'Awaiting valid inputs'}
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Total Investment Amount
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {calc.isValid ? formatNpr(calc.buy.total) : '–'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {calc.isValid ? `Incl. buy fee ${formatNpr(calc.buy.fee)}` : 'Includes broker & DP'}
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Maximum Risk Amount
                </div>
                <div className="mt-1 text-base font-semibold text-amber-600 dark:text-amber-400">
                  {calc.isValid ? formatNpr(maxRiskNpr) : '–'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {riskPct > 0 ? `${riskPct.toFixed(2)}% of capital` : '–'}
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Entry / Stop-Loss Price
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {entry > 0 ? formatNpr(entry) : '–'}
                </div>
                <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                  SL: {stop > 0 ? formatNpr(stop) : '–'} (BE {calc.isValid ? formatNpr(calc.breakevenPrice) : '–'})
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Stop-Loss Amount (Net)
                </div>
                <div className="mt-1 text-base font-semibold text-red-600 dark:text-red-400">
                  {calc.isValid ? `-${formatNpr(calc.stopLossAmount)}` : '–'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {calc.isValid && calc.buy.total > 0
                    ? `-${((calc.stopLossAmount / calc.buy.total) * 100).toFixed(2)}% on cost (incl. fees)`
                    : '–'}
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Target / Exit Price
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {target > 0 ? formatNpr(target) : '–'}
                </div>
                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {entry > 0 && target > entry
                    ? `+${(((target - entry) / entry) * 100).toFixed(2)}% gross move`
                    : '–'}
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Expected Profit (Net)
                </div>
                <div className="mt-1 text-base font-semibold text-emerald-600 dark:text-emerald-400">
                  {calc.isValid ? `+${formatNpr(calc.expectedProfit)}` : '–'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {calc.isValid
                    ? `After sell fee ${formatNpr(calc.targetSell.fee)} & CGT ${formatNpr(calc.targetSell.cgt)}`
                    : '–'}
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Risk-to-Reward Ratio
                </div>
                <div
                  className={`mt-1 text-base font-semibold ${
                    calc.rrRatio >= 2
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : calc.rrRatio >= 1
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {calc.isValid && calc.rrRatio > 0 ? `1 : ${calc.rrRatio.toFixed(2)}` : '–'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">Net post-fee &amp; CGT</div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 sm:col-span-2">
                <div className="text-[11px] font-sans text-slate-500 dark:text-slate-400">
                  Double-Up Price (2× Net Investment Return)
                </div>
                <div className="mt-1 text-base font-semibold text-blue-600 dark:text-blue-400">
                  {calc.isValid && calc.doubleUpPrice > 0 ? formatNpr(calc.doubleUpPrice) : '–'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {calc.isValid && calc.doubleUpPrice > 0
                    ? `Exact exit price where net receivable equals 2× ${formatNpr(calc.buy.total)} after fees & ${(cgtRate * 100).toFixed(1)}% CGT`
                    : 'Requires valid positive inputs'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
