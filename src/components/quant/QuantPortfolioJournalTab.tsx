import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Layers, Trash2 } from 'lucide-react';
import { QuantHelpTip } from '../QuantHelpTip';
import type {
  AuditLogEntry,
  LearningMode,
  MarketRegimeReport,
  QuantEngineConfig,
  QuantStockCandidate,
  TradeJournalEntry,
} from '../../types/quant';
import { formatNum } from '../../utils/format';
import { calcNepseBuyCost, calcNepseSellProceeds } from '../../utils/nepseFees';

interface QuantPortfolioJournalTabProps {
  candidates: QuantStockCandidate[];
  excludedStocks: QuantStockCandidate[];
  regime: MarketRegimeReport;
  config: QuantEngineConfig;
  journal: TradeJournalEntry[];
  auditLog: AuditLogEntry[];
  onCreateEntry: (entry: Omit<TradeJournalEntry, 'id' | 'createdAt' | 'isPaperTrade'>) => void;
  onUpdateEntry: (id: string, patch: Partial<TradeJournalEntry>, auditSummary: string) => void;
  onDeleteEntry: (id: string) => void;
  learningMode: LearningMode;
  onOpenGlossaryTerm: (id: string) => void;
}

export const QuantPortfolioJournalTab: React.FC<QuantPortfolioJournalTabProps> = ({
  candidates,
  excludedStocks,
  regime,
  config,
  journal,
  auditLog,
  onCreateEntry,
  onUpdateEntry,
  onDeleteEntry,
  learningMode,
  onOpenGlossaryTerm,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [formSymbol, setFormSymbol] = useState(candidates[0]?.symbol || '');
  const [formStatus, setFormStatus] = useState<'PLANNED' | 'OPEN'>('OPEN');
  const [formEntryPrice, setFormEntryPrice] = useState(candidates[0]?.indicators.close || 500);
  const [formStop, setFormStop] = useState(candidates[0]?.exitPlan?.initialStopLoss || 470);
  const [formT1, setFormT1] = useState(candidates[0]?.exitPlan?.target1 || 545);
  const [formT2, setFormT2] = useState(candidates[0]?.exitPlan?.target2 || 590);
  const [formQty, setFormQty] = useState(candidates[0]?.positionSizing?.finalQuantity || 100);
  const [formNotes, setFormNotes] = useState('');
  const [stopError, setStopError] = useState<string | null>(null);
  const [basketSymbols, setBasketSymbols] = useState<string[]>([]);

  const candidateMap = useMemo(() => {
    const m = new Map<string, QuantStockCandidate>();
    for (const c of [...candidates, ...excludedStocks]) m.set(c.symbol, c);
    return m;
  }, [candidates, excludedStocks]);

  // Top candidates eligible for multi-position capital & sector conflict simulation
  const allocatableCandidates = useMemo(() => {
    return candidates
      .filter(
        (c) =>
          c.positionSizing &&
          c.exitPlan &&
          c.positionSizing.finalQuantity > 0 &&
          (c.classification === 'STRONG BUY CANDIDATE' ||
            c.classification === 'BUY CANDIDATE' ||
            c.classification === 'WAIT FOR CONFIRMATION')
      )
      .slice(0, 14);
  }, [candidates]);

  const handleSymbolPick = (sym: string) => {
    setFormSymbol(sym);
    const c = candidateMap.get(sym);
    if (c) {
      setFormEntryPrice(c.indicators.close);
      if (c.exitPlan) {
        setFormStop(c.exitPlan.initialStopLoss);
        setFormT1(c.exitPlan.target1);
        setFormT2(c.exitPlan.target2);
      }
      if (c.positionSizing) {
        setFormQty(c.positionSizing.finalQuantity);
      }
    }
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSymbol || formEntryPrice <= 0 || formStop <= 0 || formStop >= formEntryPrice || formQty <= 0) {
      setStopError('Enter valid symbol, positive quantity, and Stop-Loss strictly below Entry Price.');
      return;
    }
    setStopError(null);
    const c = candidateMap.get(formSymbol);
    onCreateEntry({
      symbol: formSymbol,
      sector: c?.sector || 'Unknown',
      setupType: c?.setupType || 'None',
      regimeAtEntry: regime.regime,
      status: formStatus,
      entryDate: regime.asOfDate,
      entryPrice: formEntryPrice,
      stopLoss: formStop,
      target1: formT1,
      target2: formT2,
      quantity: formQty,
      remainingQuantity: formQty,
      realizedPnlNpr: 0,
      notes: formNotes || `Paper trade logged in ${regime.regime} regime`,
    });
    setShowAddForm(false);
    setFormNotes('');
  };

  // Portfolio Risk Monitor Metrics
  const riskMetrics = useMemo(() => {
    const active = journal.filter((j) => j.status === 'OPEN' || j.status === 'PARTIAL');
    let totalInvestedAtCost = 0;
    let totalMarketValue = 0;
    let totalOpenStopRiskNpr = 0;
    let unrealizedPnlNpr = 0;
    const sectorMap = new Map<string, number>();
    const exitAlerts: Array<{ id: string; symbol: string; alert: string; severity: 'red' | 'amber' | 'emerald' }> = [];

    for (const pos of active) {
      const c = candidateMap.get(pos.symbol);
      const latestClose = c?.indicators.close ?? pos.entryPrice;
      const costVal = pos.remainingQuantity * pos.entryPrice;
      const mktVal = pos.remainingQuantity * latestClose;
      totalInvestedAtCost += costVal;
      totalMarketValue += mktVal;
      unrealizedPnlNpr += (latestClose - pos.entryPrice) * pos.remainingQuantity;
      const openStopRisk = Math.max(0, (pos.entryPrice - pos.stopLoss) * pos.remainingQuantity);
      totalOpenStopRiskNpr += openStopRisk;

      sectorMap.set(pos.sector, (sectorMap.get(pos.sector) ?? 0) + mktVal);

      if (latestClose <= pos.stopLoss) {
        exitAlerts.push({
          id: pos.id,
          symbol: pos.symbol,
          alert: `STOP-LOSS HIT: EOD Close NPR ${formatNum(latestClose)} <= Stop NPR ${formatNum(pos.stopLoss)}. Exit discipline check.`,
          severity: 'red',
        });
      } else if (latestClose >= pos.target2) {
        exitAlerts.push({
          id: pos.id,
          symbol: pos.symbol,
          alert: `TARGET 2 REACHED: EOD Close NPR ${formatNum(latestClose)} >= T2 NPR ${formatNum(pos.target2)}.`,
          severity: 'emerald',
        });
      } else if (latestClose >= pos.target1 && pos.status === 'OPEN') {
        exitAlerts.push({
          id: pos.id,
          symbol: pos.symbol,
          alert: `TARGET 1 REACHED: Consider 50% partial exit and raising Stop to breakeven (NPR ${formatNum(pos.entryPrice)}).`,
          severity: 'emerald',
        });
      } else if (regime.regime === 'Bearish') {
        exitAlerts.push({
          id: pos.id,
          symbol: pos.symbol,
          alert: `REGIME DETERIORATION: NEPSE regime is Bearish — consider tightening trailing stop.`,
          severity: 'amber',
        });
      }
    }

    const realizedPnlNpr = journal.reduce((s, j) => s + (j.realizedPnlNpr || 0), 0);
    const pv = Math.max(1, config.risk.portfolioValue);
    const totalExposurePct = (totalMarketValue / pv) * 100;
    const totalOpenRiskPct = (totalOpenStopRiskNpr / pv) * 100;

    const sectorBreakdown = [...sectorMap.entries()]
      .map(([sector, valueNpr]) => ({
        sector,
        valueNpr,
        pctOfPortfolio: (valueNpr / pv) * 100,
        exceedsCap: (valueNpr / pv) * 100 > config.risk.maxSectorConcentrationPct,
      }))
      .sort((a, b) => b.valueNpr - a.valueNpr);

    return {
      activeCount: active.length,
      totalMarketValue,
      totalInvestedAtCost,
      totalExposurePct,
      totalOpenStopRiskNpr,
      totalOpenRiskPct,
      unrealizedPnlNpr,
      realizedPnlNpr,
      sectorMap,
      sectorBreakdown,
      exitAlerts,
      exceedsRegimeCap: totalExposurePct > regime.recommendedExposureMaxPct,
      exceedsOpenRiskCap: totalOpenRiskPct > config.risk.maxPortfolioOpenRiskPct,
    };
  }, [journal, candidateMap, config.risk, regime]);

  // Multi-Position Capital & Sector Conflict Allocator simulation
  const allocatorSim = useMemo(() => {
    const pv = Math.max(1, config.risk.portfolioValue);
    const selectedSet = new Set(basketSymbols);
    const picked = allocatableCandidates.filter((c) => selectedSet.has(c.symbol));

    let addCashNpr = 0;
    let addRiskNpr = 0;
    const projectedSectorMap = new Map<string, number>(riskMetrics.sectorMap);

    for (const c of picked) {
      const sizing = c.positionSizing!;
      addCashNpr += sizing.totalCashRequiredNpr;
      addRiskNpr += sizing.maxAcceptableLossNetNpr;
      projectedSectorMap.set(
        c.sector,
        (projectedSectorMap.get(c.sector) ?? 0) + sizing.totalCashRequiredNpr
      );
    }

    const projectedValueNpr = riskMetrics.totalMarketValue + addCashNpr;
    const projectedExposurePct = (projectedValueNpr / pv) * 100;
    const projectedRiskNpr = riskMetrics.totalOpenStopRiskNpr + addRiskNpr;
    const projectedRiskPct = (projectedRiskNpr / pv) * 100;

    const regimeMaxCash = (pv * regime.recommendedExposureMaxPct) / 100;
    const riskMaxNpr = (pv * config.risk.maxPortfolioOpenRiskPct) / 100;
    const remainingCashHeadroom = Math.max(0, regimeMaxCash - projectedValueNpr);
    const remainingRiskHeadroom = Math.max(0, riskMaxNpr - projectedRiskNpr);

    const sectorConflicts = [...projectedSectorMap.entries()]
      .map(([sector, val]) => ({
        sector,
        val,
        pct: (val / pv) * 100,
      }))
      .filter((s) => s.pct > config.risk.maxSectorConcentrationPct)
      .sort((a, b) => b.pct - a.pct);

    const conflicts: string[] = [];
    if (projectedExposurePct > regime.recommendedExposureMaxPct) {
      conflicts.push(
        `Total projected exposure (${projectedExposurePct.toFixed(1)}%) exceeds ${regime.regime} regime max (${regime.recommendedExposureMaxPct}%).`
      );
    }
    if (projectedRiskPct > config.risk.maxPortfolioOpenRiskPct) {
      conflicts.push(
        `Combined stop risk (${projectedRiskPct.toFixed(2)}%) exceeds ${config.risk.maxPortfolioOpenRiskPct}% portfolio stop-loss ceiling.`
      );
    }
    for (const sc of sectorConflicts) {
      conflicts.push(
        `Sector clustering: ${sc.sector} reaches ${sc.pct.toFixed(1)}% (> ${config.risk.maxSectorConcentrationPct}% cap).`
      );
    }

    return {
      picked,
      addCashNpr,
      addRiskNpr,
      projectedExposurePct,
      projectedRiskPct,
      remainingCashHeadroom,
      remainingRiskHeadroom,
      conflicts,
    };
  }, [basketSymbols, allocatableCandidates, riskMetrics, config.risk, regime]);

  const toggleBasketSymbol = (sym: string) => {
    setBasketSymbols((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const handleCommitBasket = () => {
    if (allocatorSim.picked.length === 0) return;
    for (const c of allocatorSim.picked) {
      const exit = c.exitPlan!;
      const sizing = c.positionSizing!;
      onCreateEntry({
        symbol: c.symbol,
        sector: c.sector,
        setupType: c.setupType,
        regimeAtEntry: regime.regime,
        status: c.classification.includes('BUY') ? 'OPEN' : 'PLANNED',
        entryDate: c.asOfDate,
        entryPrice: sizing.plannedEntry,
        stopLoss: exit.initialStopLoss,
        target1: exit.target1,
        target2: exit.target2,
        quantity: Math.max(1, sizing.finalQuantity),
        remainingQuantity: Math.max(1, sizing.finalQuantity),
        realizedPnlNpr: 0,
        notes: `Basket Allocation (${c.classification}) · Score ${c.technicalScore.toFixed(0)}/100`,
      });
    }
    setBasketSymbols([]);
  };

  const handleClosePosition = (pos: TradeJournalEntry, fraction: number) => {
    const c = candidateMap.get(pos.symbol);
    const closePrice = c?.indicators.close ?? pos.entryPrice;
    const qtyToSell =
      fraction >= 1
        ? pos.remainingQuantity
        : Math.max(1, Math.floor(pos.remainingQuantity * fraction));
    const buyCost = calcNepseBuyCost(qtyToSell, pos.entryPrice, 0);
    const sellOut = calcNepseSellProceeds(
      qtyToSell,
      closePrice,
      buyCost.total,
      0,
      config.costs.cgtRate
    );
    const realized = sellOut.netProfit;
    const remaining = Math.max(0, pos.remainingQuantity - qtyToSell);
    const nextStatus: TradeJournalEntry['status'] = remaining === 0 ? 'CLOSED' : 'PARTIAL';
    const nextStop =
      nextStatus === 'PARTIAL' ? Math.max(pos.stopLoss, pos.entryPrice) : pos.stopLoss;
    onUpdateEntry(
      pos.id,
      {
        remainingQuantity: remaining,
        status: nextStatus,
        stopLoss: nextStop,
        exitDate: remaining === 0 ? regime.asOfDate : pos.exitDate,
        exitPrice: closePrice,
        realizedPnlNpr: pos.realizedPnlNpr + Math.round(realized),
      },
      `${nextStatus} paper position ${pos.symbol}: sold ${qtyToSell} sh @ NPR ${formatNum(closePrice)} (Realized Net ~NPR ${Math.round(realized)} incl. exact SEBON fees)`
    );
  };

  const handleRaiseStop = (pos: TradeJournalEntry) => {
    const c = candidateMap.get(pos.symbol);
    const latestClose = c?.indicators.close ?? pos.entryPrice;
    const candidateTrail = Number((latestClose - (c?.indicators.atr14 ?? latestClose * 0.025) * 1.5).toFixed(2));
    // NEVER widen stop downward
    if (candidateTrail <= pos.stopLoss) {
      setStopError(
        `Never-Widen-Stop policy: computed trail NPR ${formatNum(candidateTrail)} is not strictly above current Stop NPR ${formatNum(pos.stopLoss)}.`
      );
      return;
    }
    setStopError(null);
    onUpdateEntry(
      pos.id,
      { stopLoss: candidateTrail },
      `Raised trailing stop for ${pos.symbol} from NPR ${formatNum(pos.stopLoss)} -> NPR ${formatNum(candidateTrail)}`
    );
  };

  return (
    <div className="space-y-6">
      {/* Paper-Trading Notice + Add Action */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="text-slate-600 dark:text-slate-300">
          <strong className="text-slate-900 dark:text-slate-100">Paper Trading &amp; Risk Monitor Only:</strong>{' '}
          Tracks hypothetical paper entries against real ShareSansar EOD closes with exact SEBON broker slabs &amp; {(config.costs.cgtRate * 100).toFixed(1)}% CGT. Strictly forbids widening stop-losses.
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="px-3 py-1.5 font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
        >
          {showAddForm ? 'Close Form' : '+ New Paper Entry'}
        </button>
      </div>

      {stopError && (
        <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          {stopError}
        </div>
      )}

      {showAddForm && (
        <form
          onSubmit={handleAddSubmit}
          className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3 text-xs"
        >
          <div className="font-semibold text-slate-900 dark:text-slate-100">Log Paper Position</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <label className="space-y-1">
              <span>Symbol</span>
              <select
                value={formSymbol}
                onChange={(e) => handleSymbolPick(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                {candidates.map((c) => (
                  <option key={c.symbol} value={c.symbol}>
                    {c.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span>State</span>
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as 'PLANNED' | 'OPEN')}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="OPEN">OPEN</option>
                <option value="PLANNED">PLANNED</option>
              </select>
            </label>
            <label className="space-y-1">
              <span>Entry (NPR)</span>
              <input type="number" step="0.5" value={formEntryPrice} onChange={(e) => setFormEntryPrice(Number(e.target.value))} className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span>Stop-Loss</span>
              <input type="number" step="0.5" value={formStop} onChange={(e) => setFormStop(Number(e.target.value))} className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span>Target 1</span>
              <input type="number" step="0.5" value={formT1} onChange={(e) => setFormT1(Number(e.target.value))} className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span>Target 2</span>
              <input type="number" step="0.5" value={formT2} onChange={(e) => setFormT2(Number(e.target.value))} className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
            <label className="space-y-1">
              <span>Quantity</span>
              <input type="number" min={1} value={formQty} onChange={(e) => setFormQty(Number(e.target.value))} className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Trade setup thesis / invalidation note..."
              className="flex-1 min-w-[220px] px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            <button type="submit" className="px-4 py-1.5 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700">
              Save Paper Trade
            </button>
          </div>
        </form>
      )}

      {/* Portfolio Risk Monitor KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-xs font-mono tabular-nums">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="font-sans text-slate-500 flex items-center gap-1">
            Open Exposure
            <QuantHelpTip termId="maximum-exposure" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <div className={`text-lg font-semibold ${riskMetrics.exceedsRegimeCap ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {riskMetrics.totalExposurePct.toFixed(1)}%
          </div>
          <div className="font-sans text-[11px] text-slate-400">
            Regime max {regime.recommendedExposureMaxPct}% ({riskMetrics.activeCount} open)
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="font-sans text-slate-500 flex items-center gap-1">
            Open Stop Risk
            <QuantHelpTip termId="portfolio-risk" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <div className={`text-lg font-semibold ${riskMetrics.exceedsOpenRiskCap ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {riskMetrics.totalOpenRiskPct.toFixed(2)}%
          </div>
          <div className="font-sans text-[11px] text-slate-400">
            NPR {Math.round(riskMetrics.totalOpenStopRiskNpr).toLocaleString('en-US')} / Cap {config.risk.maxPortfolioOpenRiskPct}%
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="font-sans text-slate-500">Unrealized Paper P&amp;L</div>
          <div className={`text-lg font-semibold ${riskMetrics.unrealizedPnlNpr >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {riskMetrics.unrealizedPnlNpr >= 0 ? '+' : ''}NPR {Math.round(riskMetrics.unrealizedPnlNpr).toLocaleString('en-US')}
          </div>
          <div className="font-sans text-[11px] text-slate-400">Mark-to-market EOD only</div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="font-sans text-slate-500">Realized Net P&amp;L</div>
          <div className={`text-lg font-semibold ${riskMetrics.realizedPnlNpr >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {riskMetrics.realizedPnlNpr >= 0 ? '+' : ''}NPR {Math.round(riskMetrics.realizedPnlNpr).toLocaleString('en-US')}
          </div>
          <div className="font-sans text-[11px] text-slate-400">Exact SEBON slabs &amp; CGT</div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="font-sans text-slate-500 flex items-center gap-1">
            Sector Concentration
            <QuantHelpTip termId="sector-concentration" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {riskMetrics.sectorBreakdown[0] ? `${riskMetrics.sectorBreakdown[0].pctOfPortfolio.toFixed(1)}%` : '0.0%'}
          </div>
          <div className="font-sans text-[11px] text-slate-400 truncate">
            {riskMetrics.sectorBreakdown[0]?.sector || 'No open sectors'}
          </div>
        </div>
      </div>

      {/* Multi-Position Capital & Sector Conflict Allocator */}
      {allocatableCandidates.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Multi-Position Capital &amp; Sector Conflict Allocator</span>
                <QuantHelpTip
                  termId="sector-concentration"
                  learningMode={learningMode}
                  customContext="Check multiple BUY or WAIT candidates together against your open positions to verify they do not breach the Regime Equity Exposure Ceiling, Portfolio Stop Risk Cap, or Sector Concentration Cap."
                  onOpenGlossaryTerm={onOpenGlossaryTerm}
                />
              </h3>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                Select candidate setups below to simulate simultaneous deployment on top of your {riskMetrics.activeCount} open paper position(s).
              </p>
            </div>
            <div className="flex items-center gap-2">
              {basketSymbols.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setBasketSymbols([])}
                    className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Clear ({basketSymbols.length})
                  </button>
                  <button
                    type="button"
                    onClick={handleCommitBasket}
                    className="px-3 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
                  >
                    Commit {basketSymbols.length} to Journal
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500">Projected Exposure</div>
              <div className={`mt-0.5 font-semibold ${allocatorSim.projectedExposurePct > regime.recommendedExposureMaxPct ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
                {allocatorSim.projectedExposurePct.toFixed(1)}% / {regime.recommendedExposureMaxPct}% max
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500">Projected Stop Risk</div>
              <div className={`mt-0.5 font-semibold ${allocatorSim.projectedRiskPct > config.risk.maxPortfolioOpenRiskPct ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
                {allocatorSim.projectedRiskPct.toFixed(2)}% / {config.risk.maxPortfolioOpenRiskPct}% cap
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500">Cash Headroom Left</div>
              <div className="mt-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                NPR {Math.round(allocatorSim.remainingCashHeadroom).toLocaleString('en-US')}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 rounded-md p-3">
              <div className="font-sans text-[11px] text-slate-500">Risk Budget Left</div>
              <div className="mt-0.5 font-semibold text-blue-600 dark:text-blue-400">
                NPR {Math.round(allocatorSim.remainingRiskHeadroom).toLocaleString('en-US')}
              </div>
            </div>
          </div>

          {allocatorSim.conflicts.length > 0 && (
            <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-red-700 dark:text-red-300 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Portfolio Allocation Conflicts Detected:</span>
              </div>
              {allocatorSim.conflicts.map((msg, i) => (
                <div key={i}>· {msg}</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
            {allocatableCandidates.map((c) => {
              const checked = basketSymbols.includes(c.symbol);
              const sizing = c.positionSizing!;
              return (
                <label
                  key={c.symbol}
                  className={`flex items-start gap-2.5 p-2.5 rounded-md border cursor-pointer transition-colors ${
                    checked
                      ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleBasketSymbol(c.symbol)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{c.symbol}</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {sizing.portfolioAllocationPct.toFixed(1)}% wt
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{c.sector} · {c.setupType}</div>
                    <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 mt-0.5">
                      {sizing.finalQuantity} sh · NPR {Math.round(sizing.totalCashRequiredNpr).toLocaleString('en-US')} · Risk -NPR {Math.round(sizing.maxAcceptableLossNetNpr).toLocaleString('en-US')}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Exit Alerts & Sector Concentration Warnings */}
      {(riskMetrics.exitAlerts.length > 0 || riskMetrics.exceedsRegimeCap || riskMetrics.exceedsOpenRiskCap) && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2 text-xs">
          <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>Active Portfolio Risk &amp; Exit Triggers</span>
          </div>
          {riskMetrics.exceedsRegimeCap && (
            <div className="text-red-600 dark:text-red-400">
              · Open exposure ({riskMetrics.totalExposurePct.toFixed(1)}%) exceeds current {regime.regime} regime max ({regime.recommendedExposureMaxPct}%). Pause new entries.
            </div>
          )}
          {riskMetrics.exceedsOpenRiskCap && (
            <div className="text-red-600 dark:text-red-400">
              · Open portfolio stop risk ({riskMetrics.totalOpenRiskPct.toFixed(2)}%) exceeds {config.risk.maxPortfolioOpenRiskPct}% portfolio risk ceiling.
            </div>
          )}
          {riskMetrics.exitAlerts.map((a, idx) => (
            <div
              key={`${a.id}-${idx}`}
              className={
                a.severity === 'red'
                  ? 'text-red-600 dark:text-red-400'
                  : a.severity === 'emerald'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
              }
            >
              · <strong>{a.symbol}:</strong> {a.alert}
            </div>
          ))}
        </div>
      )}

      {/* Journal Positions Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Paper Trade Journal ({journal.length})
          </h3>
          <span className="text-[11px] text-slate-400">Saved locally in browser storage</span>
        </div>

        {journal.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
            <p>No paper trades logged yet. Use “Log Paper Trade” on any Scanner candidate, commit a basket above, or click “+ New Paper Entry”.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 text-left font-medium">Symbol</th>
                  <th className="py-2.5 px-3 text-left font-medium">Status</th>
                  <th className="py-2.5 px-3 text-right font-medium">Qty / Rem</th>
                  <th className="py-2.5 px-3 text-right font-medium">Entry</th>
                  <th className="py-2.5 px-3 text-right font-medium">Latest EOD</th>
                  <th className="py-2.5 px-3 text-right font-medium">Stop / T1 / T2</th>
                  <th className="py-2.5 px-3 text-right font-medium">Unrealized P&amp;L</th>
                  <th className="py-2.5 px-3 text-right font-medium">Realized Net</th>
                  <th className="py-2.5 px-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                {journal.map((pos) => {
                  const latest = candidateMap.get(pos.symbol)?.indicators.close ?? pos.entryPrice;
                  const unreal =
                    pos.status === 'OPEN' || pos.status === 'PARTIAL'
                      ? (latest - pos.entryPrice) * pos.remainingQuantity
                      : 0;
                  const isActive = pos.status === 'OPEN' || pos.status === 'PARTIAL';
                  return (
                    <tr key={pos.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-sans">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{pos.symbol}</div>
                        <div className="text-[10px] text-slate-400">{pos.setupType} · {pos.entryDate}</div>
                      </td>
                      <td className="py-2.5 px-3 font-sans font-semibold text-slate-700 dark:text-slate-300">
                        {pos.status}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {pos.quantity} / {pos.remainingQuantity}
                      </td>
                      <td className="py-2.5 px-3 text-right">{formatNum(pos.entryPrice)}</td>
                      <td className="py-2.5 px-3 text-right">{formatNum(latest)}</td>
                      <td className="py-2.5 px-3 text-right text-[11px]">
                        <span className="text-red-600">{formatNum(pos.stopLoss, 1)}</span> /{' '}
                        <span className="text-emerald-600">{formatNum(pos.target1, 1)}</span> /{' '}
                        <span className="text-emerald-700">{formatNum(pos.target2, 1)}</span>
                      </td>
                      <td className={`py-2.5 px-3 text-right ${unreal >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {isActive ? `${unreal >= 0 ? '+' : ''}${Math.round(unreal).toLocaleString('en-US')}` : '–'}
                      </td>
                      <td className={`py-2.5 px-3 text-right ${pos.realizedPnlNpr >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {pos.realizedPnlNpr !== 0 ? `${pos.realizedPnlNpr >= 0 ? '+' : ''}${pos.realizedPnlNpr.toLocaleString('en-US')}` : '0'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-sans">
                        <div className="inline-flex items-center gap-1.5">
                          {pos.status === 'PLANNED' && (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateEntry(pos.id, { status: 'OPEN' }, `Activated planned paper trade ${pos.symbol}`)
                              }
                              className="px-2 py-1 text-[11px] rounded bg-blue-600 text-white hover:bg-blue-700"
                            >
                              Activate
                            </button>
                          )}
                          {isActive && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleRaiseStop(pos)}
                                className="px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                                title="Tighten stop upward only"
                              >
                                Trail↑
                              </button>
                              <button
                                type="button"
                                onClick={() => handleClosePosition(pos, 0.5)}
                                className="px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                Close 50%
                              </button>
                              <button
                                type="button"
                                onClick={() => handleClosePosition(pos, 1)}
                                className="px-2 py-1 text-[11px] rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                              >
                                Exit All
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteEntry(pos.id)}
                            aria-label={`Delete ${pos.symbol} paper entry`}
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
      </div>

      {/* Auditable History Log */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2 text-xs">
        <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <ClipboardList className="w-4 h-4 text-slate-500" />
          <span>Auditable Engine &amp; Journal Activity Log ({auditLog.length})</span>
        </div>
        {auditLog.length === 0 ? (
          <p className="text-slate-500">No logged events yet.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {auditLog.slice(0, 30).map((ev) => (
              <div key={ev.id} className="py-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <CheckCircle2 className="w-3 h-3 text-slate-400 self-center shrink-0" />
                  <span className="font-mono text-[11px] text-slate-400">{ev.timestamp.slice(0, 19).replace('T', ' ')}</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{ev.summary}</span>
                </div>
                <span className="font-mono text-[10px] text-slate-400">asOf {ev.asOfDate}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
