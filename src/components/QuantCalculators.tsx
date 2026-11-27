import React, { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { QuantHelpTip } from './QuantHelpTip';
import type { LearningMode } from '../types/quant';
import { calcNepseBuyCost, calcNepseSellProceeds } from '../utils/nepseFees';

interface QuantCalculatorsProps {
  learningMode: LearningMode;
  onOpenGlossaryTerm?: (termId: string) => void;
}

type CalcKind =
  | 'position'
  | 'expectancy'
  | 'rs'
  | 'rvol'
  | 'rr'
  | 'exposure';

export const QuantCalculators: React.FC<QuantCalculatorsProps> = ({
  learningMode,
  onOpenGlossaryTerm,
}) => {
  const [activeCalc, setActiveCalc] = useState<CalcKind>('position');

  // 1. Position sizing inputs
  const [psPortfolio, setPsPortfolio] = useState(500_000);
  const [psRiskPct, setPsRiskPct] = useState(1.5);
  const [psEntry, setPsEntry] = useState(500);
  const [psStop, setPsStop] = useState(475);

  // 2. Expectancy inputs
  const [exWinRate, setExWinRate] = useState(52);
  const [exAvgWin, setExAvgWin] = useState(8.5);
  const [exAvgLoss, setExAvgLoss] = useState(4.2);

  // 3. Relative Strength inputs
  const [rsStockStart, setRsStockStart] = useState(420);
  const [rsStockEnd, setRsStockEnd] = useState(462);
  const [rsMktStart, setRsMktStart] = useState(2000);
  const [rsMktEnd, setRsMktEnd] = useState(2030);

  // 4. Relative Volume inputs
  const [rvToday, setRvToday] = useState(95_000);
  const [rvAvg20, setRvAvg20] = useState(50_000);

  // 5. Risk/Reward & Stop-Loss inputs
  const [rrEntry, setRrEntry] = useState(600);
  const [rrStop, setRrStop] = useState(576);
  const [rrTarget, setRrTarget] = useState(660);
  const [rrShares, setRrShares] = useState(200);
  const [rrCgt, setRrCgt] = useState(0.075);

  // 6. Portfolio Exposure & Sector Concentration inputs
  const [expPortfolio, setExpPortfolio] = useState(500_000);
  const [expOpenPositions, setExpOpenPositions] = useState(220_000);
  const [expSectorValue, setExpSectorValue] = useState(140_000);
  const [expRegimeMaxPct, setExpRegimeMaxPct] = useState(65);
  const [expSectorCapPct, setExpSectorCapPct] = useState(35);

  const psOut = useMemo(() => {
    const riskCapital = Math.max(0, (psPortfolio * psRiskPct) / 100);
    const riskPerShare = psEntry - psStop;
    const valid = psPortfolio > 0 && psRiskPct > 0 && psEntry > 0 && psStop > 0 && riskPerShare > 0;
    const qty = valid ? Math.floor(riskCapital / riskPerShare) : 0;
    const investment = qty * psEntry;
    const allocationPct = psPortfolio > 0 ? (investment / psPortfolio) * 100 : 0;
    const actualRisk = qty * Math.max(0, riskPerShare);
    return { valid, riskCapital, riskPerShare, qty, investment, allocationPct, actualRisk };
  }, [psPortfolio, psRiskPct, psEntry, psStop]);

  const exOut = useMemo(() => {
    const w = Math.max(0, Math.min(100, exWinRate)) / 100;
    const l = 1 - w;
    const avgGainTerm = w * Math.max(0, exAvgWin);
    const avgLossTerm = l * Math.abs(exAvgLoss);
    const expPct = avgGainTerm - avgLossTerm;
    const pf = avgLossTerm > 0 ? avgGainTerm / avgLossTerm : 0;
    const payoffRatio = exAvgLoss > 0 ? exAvgWin / Math.abs(exAvgLoss) : 0;
    return { w, l, avgGainTerm, avgLossTerm, expPct, pf, payoffRatio };
  }, [exWinRate, exAvgWin, exAvgLoss]);

  const rsOut = useMemo(() => {
    const stockRet = rsStockStart > 0 ? ((rsStockEnd - rsStockStart) / rsStockStart) * 100 : 0;
    const mktRet = rsMktStart > 0 ? ((rsMktEnd - rsMktStart) / rsMktStart) * 100 : 0;
    const excess = stockRet - mktRet;
    return { stockRet, mktRet, excess };
  }, [rsStockStart, rsStockEnd, rsMktStart, rsMktEnd]);

  const rvOut = useMemo(() => {
    const ratio = rvAvg20 > 0 ? rvToday / rvAvg20 : 0;
    let label = 'Quiet / Below Average';
    if (ratio >= 2.0) label = 'Strong Institutional Expansion (>= 2.0x)';
    else if (ratio >= 1.5) label = 'Breakout Confirmation Threshold (>= 1.5x)';
    else if (ratio >= 1.0) label = 'Healthy Normal Activity (1.0x–1.5x)';
    else if (ratio <= 0.7) label = 'Volume Dry-Up (Coiled Consolidation / Pullback)';
    return { ratio, label };
  }, [rvToday, rvAvg20]);

  const rrOut = useMemo(() => {
    const valid = rrEntry > 0 && rrStop > 0 && rrStop < rrEntry && rrTarget > rrEntry && rrShares > 0;
    if (!valid) {
      return { valid: false, grossRr: 0, netRr: 0, netLossStop: 0, netGainTarget: 0, buyCost: 0 };
    }
    const buy = calcNepseBuyCost(rrShares, rrEntry, 0);
    const stopSell = calcNepseSellProceeds(rrShares, rrStop, buy.total, 0, rrCgt);
    const tgtSell = calcNepseSellProceeds(rrShares, rrTarget, buy.total, 0, rrCgt);

    const netLossStop = Math.max(0, buy.total - stopSell.netReceivable);
    const netGainTarget = tgtSell.netProfit;

    const grossRr = (rrTarget - rrEntry) / (rrEntry - rrStop);
    const netRr = netLossStop > 0 ? netGainTarget / netLossStop : 0;
    return { valid: true, grossRr, netRr, netLossStop, netGainTarget, buyCost: buy.total };
  }, [rrEntry, rrStop, rrTarget, rrShares, rrCgt]);

  const expOut = useMemo(() => {
    const totalPct = expPortfolio > 0 ? (expOpenPositions / expPortfolio) * 100 : 0;
    const sectorPct = expPortfolio > 0 ? (expSectorValue / expPortfolio) * 100 : 0;
    const remainingHeadroomNpr = Math.max(0, (expPortfolio * expRegimeMaxPct) / 100 - expOpenPositions);
    const overRegime = totalPct > expRegimeMaxPct;
    const overSector = sectorPct > expSectorCapPct;
    return { totalPct, sectorPct, remainingHeadroomNpr, overRegime, overSector };
  }, [expPortfolio, expOpenPositions, expSectorValue, expRegimeMaxPct, expSectorCapPct]);

  const tabs: Array<{ id: CalcKind; label: string }> = [
    { id: 'position', label: 'Position Sizing' },
    { id: 'expectancy', label: 'Expectancy' },
    { id: 'rs', label: 'Relative Strength' },
    { id: 'rvol', label: 'Relative Volume' },
    { id: 'rr', label: 'Risk/Reward & Stop' },
    { id: 'exposure', label: 'Portfolio Exposure' },
  ];

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Interactive Quantitative Practice Calculators
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Experiment with hypothetical numbers to see exact step-by-step math before applying to real NEPSE analysis.
          </p>
        </div>
        <span className="text-[11px] font-mono font-semibold text-amber-700 dark:text-amber-400">
          HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveCalc(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              activeCalc === t.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeCalc === 'position' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                Portfolio Value (NPR)
                <QuantHelpTip termId="risk-capital" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
              </span>
              <input type="number" min={1000} step={50000} value={psPortfolio} onChange={(e) => setPsPortfolio(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                Risk Per Trade (%)
                <QuantHelpTip termId="risk-capital" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
              </span>
              <input type="number" min={0.1} max={10} step={0.25} value={psRiskPct} onChange={(e) => setPsRiskPct(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Entry Price (NPR)</span>
              <input type="number" min={1} step={5} value={psEntry} onChange={(e) => setPsEntry(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                Stop-Loss Price (NPR)
                <QuantHelpTip termId="stop-loss" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
              </span>
              <input type="number" min={1} step={5} value={psStop} onChange={(e) => setPsStop(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2 font-mono tabular-nums">
            {!psOut.valid ? (
              <div className="text-red-600 dark:text-red-400 font-sans">
                Ensure Entry Price is strictly greater than Stop-Loss Price and Portfolio Value is positive.
              </div>
            ) : (
              <>
                <div className="text-slate-600 dark:text-slate-300">
                  1. Risk Capital = NPR {psPortfolio.toLocaleString('en-US')} × {psRiskPct}% = <span className="font-semibold text-slate-900 dark:text-slate-100">NPR {psOut.riskCapital.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  2. Risk per Share = {psEntry} − {psStop} = <span className="font-semibold text-slate-900 dark:text-slate-100">NPR {psOut.riskPerShare.toFixed(2)}</span>
                </div>
                <div className="text-slate-900 dark:text-slate-100 font-semibold">
                  3. Position Quantity = floor({psOut.riskCapital.toFixed(0)} ÷ {psOut.riskPerShare.toFixed(2)}) = {psOut.qty.toLocaleString('en-US')} shares
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                  Total Investment = NPR {psOut.investment.toLocaleString('en-US')} ({psOut.allocationPct.toFixed(1)}% of portfolio) · Loss if Stopped = NPR {psOut.actualRisk.toLocaleString('en-US')}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeCalc === 'expectancy' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                Win Rate (%)
                <QuantHelpTip termId="win-rate" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
              </span>
              <input type="number" min={0} max={100} step={1} value={exWinRate} onChange={(e) => setExWinRate(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                Avg Win (%)
                <QuantHelpTip termId="average-win" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
              </span>
              <input type="number" min={0} step={0.5} value={exAvgWin} onChange={(e) => setExAvgWin(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                Avg Loss (%)
                <QuantHelpTip termId="average-loss" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
              </span>
              <input type="number" min={0.1} step={0.5} value={exAvgLoss} onChange={(e) => setExAvgLoss(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2 font-mono tabular-nums">
            <div className="text-slate-600 dark:text-slate-300">
              Win Contribution = {(exOut.w * 100).toFixed(0)}% × +{exAvgWin.toFixed(2)}% = +{exOut.avgGainTerm.toFixed(2)}%
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              Loss Contribution = {(exOut.l * 100).toFixed(0)}% × {Math.abs(exAvgLoss).toFixed(2)}% = -{exOut.avgLossTerm.toFixed(2)}%
            </div>
            <div className={`font-semibold text-sm ${exOut.expPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              Mathematical Expectancy = {exOut.expPct >= 0 ? '+' : ''}{exOut.expPct.toFixed(2)}% per trade
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              Implied Profit Factor = {exOut.pf.toFixed(2)} · Win/Loss Payoff = {exOut.payoffRatio.toFixed(2)}x
            </div>
          </div>
        </div>
      )}

      {activeCalc === 'rs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Stock Price 20d Ago</span>
              <input type="number" min={1} value={rsStockStart} onChange={(e) => setRsStockStart(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Stock Price Today</span>
              <input type="number" min={1} value={rsStockEnd} onChange={(e) => setRsStockEnd(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">NEPSE Index 20d Ago</span>
              <input type="number" min={1} value={rsMktStart} onChange={(e) => setRsMktStart(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">NEPSE Index Today</span>
              <input type="number" min={1} value={rsMktEnd} onChange={(e) => setRsMktEnd(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2 font-mono tabular-nums">
            <div>Stock 20d Return = {rsOut.stockRet >= 0 ? '+' : ''}{rsOut.stockRet.toFixed(2)}%</div>
            <div>NEPSE 20d Return = {rsOut.mktRet >= 0 ? '+' : ''}{rsOut.mktRet.toFixed(2)}%</div>
            <div className={`font-semibold text-sm ${rsOut.excess >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              Relative Strength Excess = {rsOut.excess >= 0 ? '+' : ''}{rsOut.excess.toFixed(2)}%
            </div>
            <div className="font-sans text-slate-500 dark:text-slate-400">
              {rsOut.excess >= 0
                ? 'Outperforming the broader NEPSE market over this lookback.'
                : 'Lagging the broader NEPSE market — weak leadership.'}
            </div>
          </div>
        </div>
      )}

      {activeCalc === 'rvol' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Today’s Volume (Shares)</span>
              <input type="number" min={0} step={5000} value={rvToday} onChange={(e) => setRvToday(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">20-Day Avg Volume</span>
              <input type="number" min={1} step={5000} value={rvAvg20} onChange={(e) => setRvAvg20(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2 font-mono tabular-nums">
            <div>Formula: {rvToday.toLocaleString('en-US')} ÷ {rvAvg20.toLocaleString('en-US')}</div>
            <div className="font-semibold text-sm text-blue-700 dark:text-blue-400">
              Relative Volume (RVOL) = {rvOut.ratio.toFixed(2)}x
            </div>
            <div className="font-sans text-slate-600 dark:text-slate-300">{rvOut.label}</div>
          </div>
        </div>
      )}

      {activeCalc === 'rr' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Entry (NPR)</span>
              <input type="number" min={1} value={rrEntry} onChange={(e) => setRrEntry(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Stop (NPR)</span>
              <input type="number" min={1} value={rrStop} onChange={(e) => setRrStop(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Target (NPR)</span>
              <input type="number" min={1} value={rrTarget} onChange={(e) => setRrTarget(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Shares</span>
              <input type="number" min={10} step={10} value={rrShares} onChange={(e) => setRrShares(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">CGT Rate</span>
              <select value={rrCgt} onChange={(e) => setRrCgt(Number(e.target.value))} className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
                <option value={0.075}>7.5% (&lt;1 yr)</option>
                <option value={0.05}>5.0% (≥1 yr)</option>
              </select>
            </label>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2 font-mono tabular-nums">
            {!rrOut.valid ? (
              <div className="text-red-600 dark:text-red-400 font-sans">Require Stop &lt; Entry &lt; Target and positive shares.</div>
            ) : (
              <>
                <div>Gross Risk/Reward = 1 : {rrOut.grossRr.toFixed(2)}</div>
                <div className="text-red-600 dark:text-red-400">Net Loss at Stop (after broker + SEBON + DP) = -NPR {rrOut.netLossStop.toFixed(0)}</div>
                <div className="text-emerald-600 dark:text-emerald-400">Net Profit at Target (after fees + {(rrCgt * 100).toFixed(1)}% CGT) = +NPR {rrOut.netGainTarget.toFixed(0)}</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">Net NEPSE Risk/Reward = 1 : {rrOut.netRr.toFixed(2)}</div>
              </>
            )}
          </div>
        </div>
      )}

      {activeCalc === 'exposure' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Portfolio Value</span>
              <input type="number" min={1000} step={50000} value={expPortfolio} onChange={(e) => setExpPortfolio(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Open Equity (NPR)</span>
              <input type="number" min={0} step={10000} value={expOpenPositions} onChange={(e) => setExpOpenPositions(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Largest Sector (NPR)</span>
              <input type="number" min={0} step={10000} value={expSectorValue} onChange={(e) => setExpSectorValue(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Regime Max (%)</span>
              <input type="number" min={0} max={100} value={expRegimeMaxPct} onChange={(e) => setExpRegimeMaxPct(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-slate-700 dark:text-slate-300">Sector Cap (%)</span>
              <input type="number" min={5} max={100} value={expSectorCapPct} onChange={(e) => setExpSectorCapPct(Number(e.target.value))} className="w-full px-3 py-2 font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2 font-mono tabular-nums">
            <div className={expOut.overRegime ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-emerald-600 dark:text-emerald-400 font-semibold'}>
              Total Deployment = {expOut.totalPct.toFixed(1)}% vs Regime Max {expRegimeMaxPct}% ({expOut.overRegime ? 'OVER LIMIT' : 'WITHIN LIMIT'})
            </div>
            <div className={expOut.overSector ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-800 dark:text-slate-200'}>
              Sector Concentration = {expOut.sectorPct.toFixed(1)}% vs Cap {expSectorCapPct}% ({expOut.overSector ? 'EXCEEDS CAP' : 'OK'})
            </div>
            <div className="text-slate-600 dark:text-slate-300">
              Remaining Capital Room Before Regime Ceiling: NPR {expOut.remainingHeadroomNpr.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
