import React, { useEffect, useState } from 'react';
import { Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import { formatInt, formatNum } from '../utils/format';

interface NepseTradePlannerProps {
  symbol: string;
  lastClose: number;
  suggestedStop?: number | null;
  suggestedTarget?: number | null;
}

// SEBON-regulated Nepal equity broker commission slabs
function calcBrokerCommission(amount: number): number {
  if (amount <= 0) return 0;
  let rate = 0.0024;
  if (amount <= 50_000) rate = 0.0036;
  else if (amount <= 500_000) rate = 0.0033;
  else if (amount <= 2_000_000) rate = 0.0031;
  else if (amount <= 10_000_000) rate = 0.0027;
  return Math.max(10, amount * rate);
}

function calcBuyTotal(shares: number, price: number): { gross: number; fee: number; total: number } {
  const gross = shares * price;
  if (gross <= 0) return { gross: 0, fee: 0, total: 0 };
  const broker = calcBrokerCommission(gross);
  const sebon = gross * 0.00015;
  const dp = 25;
  const fee = broker + sebon + dp;
  return { gross, fee, total: gross + fee };
}

function calcSellNet(
  shares: number,
  sellPrice: number,
  buyTotal: number,
  cgtRate: number
): { gross: number; fee: number; cgt: number; netReceivable: number; netProfit: number } {
  const gross = shares * sellPrice;
  if (gross <= 0) return { gross: 0, fee: 0, cgt: 0, netReceivable: 0, netProfit: 0 };
  const broker = calcBrokerCommission(gross);
  const sebon = gross * 0.00015;
  const dp = 25;
  const fee = broker + sebon + dp;
  const preTaxProceeds = gross - fee;
  const taxableGain = Math.max(0, preTaxProceeds - buyTotal);
  const cgt = taxableGain * cgtRate;
  const netReceivable = preTaxProceeds - cgt;
  return {
    gross,
    fee,
    cgt,
    netReceivable,
    netProfit: netReceivable - buyTotal,
  };
}

export const NepseTradePlanner: React.FC<NepseTradePlannerProps> = ({
  symbol,
  lastClose,
  suggestedStop,
  suggestedTarget,
}) => {
  const [open, setOpen] = useState(false);
  const [capital, setCapital] = useState(200_000);
  const [riskPct, setRiskPct] = useState(1.5);
  const [entry, setEntry] = useState(lastClose);
  const [stop, setStop] = useState(
    suggestedStop && suggestedStop < lastClose
      ? Number(suggestedStop.toFixed(1))
      : Number((lastClose * 0.94).toFixed(1))
  );
  const [target, setTarget] = useState(
    suggestedTarget && suggestedTarget > lastClose
      ? Number(suggestedTarget.toFixed(1))
      : Number((lastClose * 1.12).toFixed(1))
  );
  const [cgtRate, setCgtRate] = useState(0.075);

  useEffect(() => {
    setEntry(lastClose);
    setStop(
      suggestedStop && suggestedStop < lastClose
        ? Number(suggestedStop.toFixed(1))
        : Number((lastClose * 0.94).toFixed(1))
    );
    setTarget(
      suggestedTarget && suggestedTarget > lastClose
        ? Number(suggestedTarget.toFixed(1))
        : Number((lastClose * 1.12).toFixed(1))
    );
  }, [symbol, lastClose, suggestedStop, suggestedTarget]);

  const maxRiskRs = Math.max(0, capital * (riskPct / 100));
  const riskPerShare = Math.max(0.5, entry - stop);
  const rawShares = entry > 0 ? Math.floor(maxRiskRs / riskPerShare) : 0;
  const maxAffordable = entry > 0 ? Math.floor((capital * 0.994) / entry) : 0;
  // NEPSE standard odd-lot / 10-kitta friendly rounding
  const shares = Math.max(10, Math.min(rawShares, maxAffordable));

  const buy = calcBuyTotal(shares, entry);
  const targetSell = calcSellNet(shares, target, buy.total, cgtRate);
  const stopSell = calcSellNet(shares, stop, buy.total, cgtRate);
  const breakeven = shares > 0 ? (buy.total + calcBrokerCommission(buy.gross) + buy.gross * 0.00015 + 25) / shares : 0;
  const rrRatio =
    stopSell.netProfit < 0
      ? targetSell.netProfit / Math.abs(stopSell.netProfit)
      : 0;

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs">
          <Calculator className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            NEPSE Position Sizer &amp; Fee Calculator ({symbol})
          </span>
          <span className="hidden sm:inline text-slate-400">
            · Includes SEBON broker slabs, 0.015% fee, Rs 25 DP &amp; CGT
          </span>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <label className="space-y-1">
              <span className="block text-slate-500 dark:text-slate-400">Portfolio (Rs)</span>
              <input
                type="number"
                min={10000}
                step={10000}
                value={capital}
                onChange={(e) => setCapital(Math.max(1000, Number(e.target.value)))}
                className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-slate-500 dark:text-slate-400">Max Risk %</span>
              <input
                type="number"
                min={0.25}
                max={10}
                step={0.25}
                value={riskPct}
                onChange={(e) => setRiskPct(Math.max(0.1, Number(e.target.value)))}
                className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-slate-500 dark:text-slate-400">Entry (Rs)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                value={entry}
                onChange={(e) => setEntry(Math.max(1, Number(e.target.value)))}
                className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-slate-500 dark:text-slate-400">Stop-Loss (Rs)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                value={stop}
                onChange={(e) => setStop(Math.max(1, Number(e.target.value)))}
                className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-slate-500 dark:text-slate-400">Target (Rs)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                value={target}
                onChange={(e) => setTarget(Math.max(1, Number(e.target.value)))}
                className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-slate-500 dark:text-slate-400">CGT Tax</span>
              <select
                value={cgtRate}
                onChange={(e) => setCgtRate(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                <option value={0.075}>7.5% (&lt; 1 yr)</option>
                <option value={0.05}>5.0% (≥ 1 yr)</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1 text-xs font-mono tabular-nums">
            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
              <div className="text-[11px] font-sans text-slate-500">Suggested Size</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {formatInt(shares)} kitta
              </div>
              <div className="text-[11px] text-slate-400">Cost Rs {formatInt(buy.total)}</div>
            </div>
            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
              <div className="text-[11px] font-sans text-slate-500">Breakeven Price</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Rs {formatNum(breakeven)}
              </div>
              <div className="text-[11px] text-slate-400">Buy fee Rs {formatInt(buy.fee)}</div>
            </div>
            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
              <div className="text-[11px] font-sans text-slate-500">Stop Net Loss</div>
              <div className="mt-0.5 text-sm font-semibold text-red-600 dark:text-red-400">
                Rs {formatInt(stopSell.netProfit)}
              </div>
              <div className="text-[11px] text-slate-400">
                {buy.total > 0 ? `${((stopSell.netProfit / buy.total) * 100).toFixed(1)}%` : '–'}
              </div>
            </div>
            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
              <div className="text-[11px] font-sans text-slate-500">Target Net Profit</div>
              <div className="mt-0.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                +Rs {formatInt(targetSell.netProfit)}
              </div>
              <div className="text-[11px] text-slate-400">CGT Rs {formatInt(targetSell.cgt)}</div>
            </div>
            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
              <div className="text-[11px] font-sans text-slate-500">Net Risk : Reward</div>
              <div className="mt-0.5 text-sm font-semibold text-blue-600 dark:text-blue-400">
                1 : {rrRatio > 0 ? rrRatio.toFixed(2) : '–'}
              </div>
              <div className="text-[11px] text-slate-400">After fees &amp; tax</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
