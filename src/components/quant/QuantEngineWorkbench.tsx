import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { QuantCalculators } from '../QuantCalculators';
import { QuantGlossaryPanel } from '../QuantGlossaryPanel';
import { QuantHelpTip } from '../QuantHelpTip';
import { QuantBacktestTab } from './QuantBacktestTab';
import { QuantEntryExitSizingTab } from './QuantEntryExitSizingTab';
import { QuantPortfolioJournalTab } from './QuantPortfolioJournalTab';
import { QuantDataQualitySection, QuantRegimeTab } from './QuantRegimeAndDataTab';
import { QuantScannerAndCandidateTab } from './QuantScannerAndCandidateTab';
import { QuantWatchlistsAndRsTab } from './QuantWatchlistsAndRsTab';
import type {
  AuditLogEntry,
  LearningMode,
  QuantEngineConfig,
  QuantEngineResponse,
  QuantStockCandidate,
  TradeJournalEntry,
} from '../../types/quant';

const JOURNAL_KEY = 'nepse.quant.paperJournal.v1';
const AUDIT_KEY = 'nepse.quant.auditLog.v1';
const MODE_KEY = 'nepse.quant.learningMode.v1';

const DEFAULT_CLIENT_CONFIG: QuantEngineConfig = {
  minAvgDailyTurnover: 1_000_000,
  minAvgDailyVolume: 1_500,
  minDaysHistory: 25,
  bullishBreadthMinPct: 55,
  bearishBreadthMaxPct: 40,
  weights: {
    trendStrength: 20,
    momentum: 20,
    relativeStrength: 15,
    volumeStrength: 20,
    breakoutStructure: 15,
    vwapBehavior: 10,
  },
  costs: {
    slippagePct: 0.35,
    cgtRate: 0.075,
    maxVolumeParticipationPct: 5,
  },
  backtest: {
    holdingDays: 15,
    stopAtrMult: 1.5,
    target1R: 1.5,
    target2R: 3.0,
    minSampleSize: 8,
    inSampleRatio: 0.6,
    walkForwardFolds: 3,
    breakoutVolMult: 1.5,
    vcpMaxBaseRangePct: 16,
    pullbackMaxSmaDistPct: 4.5,
  },
  risk: {
    portfolioValue: 500_000,
    riskPctPerTrade: 1.5,
    maxSingleStockPct: 20,
    maxSectorConcentrationPct: 35,
    maxPortfolioOpenRiskPct: 6,
    enforceTenKitta: false,
    allowBearishNewEntries: false,
  },
};

type EngineTabId =
  | 'scanner'
  | 'regime'
  | 'watchlists'
  | 'sizing'
  | 'portfolio'
  | 'backtest'
  | 'data_quality'
  | 'glossary'
  | 'classic';

interface QuantEngineWorkbenchProps {
  dates: string[];
  equityOnly: boolean;
  initialSymbol?: string | null;
  initialNavTick?: number;
  onInspectSymbol: (symbol: string) => void;
  classicScannersContent: React.ReactNode;
}

export const QuantEngineWorkbench: React.FC<QuantEngineWorkbenchProps> = ({
  dates,
  equityOnly,
  initialSymbol,
  initialNavTick,
  onInspectSymbol,
  classicScannersContent,
}) => {
  const [activeTab, setActiveTab] = useState<EngineTabId>('scanner');
  const [learningMode, setLearningMode] = useState<LearningMode>(() => {
    try {
      const saved = window.localStorage.getItem(MODE_KEY);
      return saved === 'advanced' ? 'advanced' : 'beginner';
    } catch {
      return 'beginner';
    }
  });

  const [asof, setAsof] = useState<string>(dates[dates.length - 1] ?? '');
  const [config, setConfig] = useState<QuantEngineConfig>(DEFAULT_CLIENT_CONFIG);
  const [draftConfig, setDraftConfig] = useState<QuantEngineConfig>(DEFAULT_CLIENT_CONFIG);
  const [showSettings, setShowSettings] = useState(false);

  const [data, setData] = useState<QuantEngineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [focusedGlossaryId, setFocusedGlossaryId] = useState<string | null>(null);

  const [journal, setJournal] = useState<TradeJournalEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem(JOURNAL_KEY);
      return raw ? (JSON.parse(raw) as TradeJournalEntry[]) : [];
    } catch {
      return [];
    }
  });

  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem(AUDIT_KEY);
      return raw ? (JSON.parse(raw) as AuditLogEntry[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (dates.length > 0 && (!asof || !dates.includes(asof))) {
      setAsof(dates[dates.length - 1]);
    }
  }, [dates, asof]);

  useEffect(() => {
    if (initialSymbol) {
      setSelectedSymbol(initialSymbol);
      setActiveTab('scanner');
    }
  }, [initialSymbol, initialNavTick]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, learningMode);
    } catch {
      // ignore storage errors
    }
  }, [learningMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
    } catch {
      // ignore storage errors
    }
  }, [journal]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUDIT_KEY, JSON.stringify(auditLog.slice(0, 100)));
    } catch {
      // ignore storage errors
    }
  }, [auditLog]);

  const appendAudit = useCallback(
    (eventType: AuditLogEntry['eventType'], summary: string, dateRef?: string) => {
      const entry: AuditLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        eventType,
        asOfDate: dateRef || asof || dates[dates.length - 1] || '',
        summary,
      };
      setAuditLog((prev) => [entry, ...prev].slice(0, 100));
    },
    [asof, dates]
  );

  const fetchAnalysis = useCallback(
    (targetAsof: string, targetConfig: QuantEngineConfig, reason?: string) => {
      if (!targetAsof) return;
      setLoading(true);
      setErrorMsg(null);
      fetch('/api/quant/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asOf: targetAsof,
          equityOnly,
          config: targetConfig,
        }),
      })
        .then(async (r) => {
          const json = await r.json();
          if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
          return json as QuantEngineResponse;
        })
        .then((res) => {
          setData(res);
          setSelectedSymbol((prev) => {
            if (prev && res.candidates.some((c) => c.symbol === prev)) return prev;
            return res.topOpportunities[0]?.symbol ?? res.candidates[0]?.symbol ?? null;
          });
          if (reason) {
            appendAudit('SCAN_RUN', reason, res.asOfDate);
          }
        })
        .catch((err) => {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to run quantitative engine');
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [equityOnly, appendAudit]
  );

  useEffect(() => {
    if (!asof) return;
    fetchAnalysis(asof, config);
  }, [asof, equityOnly, config, fetchAnalysis]);

  const handleOpenGlossaryTerm = useCallback((termId: string) => {
    setFocusedGlossaryId(termId);
    setActiveTab('glossary');
  }, []);

  const handleAddPaperTrade = useCallback(
    (c: QuantStockCandidate) => {
      const exit = c.exitPlan;
      const sizing = c.positionSizing;
      if (!exit || !sizing) return;
      const newEntry: TradeJournalEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        symbol: c.symbol,
        sector: c.sector,
        setupType: c.setupType,
        regimeAtEntry: data?.marketRegime.regime ?? 'Neutral',
        status: c.classification.includes('BUY') ? 'OPEN' : 'PLANNED',
        entryDate: c.asOfDate,
        entryPrice: sizing.plannedEntry,
        stopLoss: exit.initialStopLoss,
        target1: exit.target1,
        target2: exit.target2,
        quantity: Math.max(10, sizing.finalQuantity),
        remainingQuantity: Math.max(10, sizing.finalQuantity),
        realizedPnlNpr: 0,
        notes: `${c.classification} (${c.setupType}) · Score ${c.technicalScore.toFixed(0)}/100`,
        isPaperTrade: true,
      };
      setJournal((prev) => [newEntry, ...prev]);
      appendAudit(
        'JOURNAL_ACTION',
        `Logged ${newEntry.status} paper trade: ${newEntry.symbol} (${newEntry.quantity} sh @ NPR ${newEntry.entryPrice}, SL ${newEntry.stopLoss})`,
        c.asOfDate
      );
      setActiveTab('portfolio');
    },
    [data?.marketRegime.regime, appendAudit]
  );

  const handleCreateManualEntry = useCallback(
    (entry: Omit<TradeJournalEntry, 'id' | 'createdAt' | 'isPaperTrade'>) => {
      const full: TradeJournalEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        isPaperTrade: true,
      };
      setJournal((prev) => [full, ...prev]);
      appendAudit(
        'JOURNAL_ACTION',
        `Logged ${full.status} paper trade: ${full.symbol} (${full.quantity} sh @ NPR ${full.entryPrice})`,
        entry.entryDate
      );
    },
    [appendAudit]
  );

  const handleUpdateJournalEntry = useCallback(
    (id: string, patch: Partial<TradeJournalEntry>, auditSummary: string) => {
      setJournal((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
      appendAudit('JOURNAL_ACTION', auditSummary);
    },
    [appendAudit]
  );

  const handleDeleteJournalEntry = useCallback(
    (id: string) => {
      setJournal((prev) => {
        const target = prev.find((x) => x.id === id);
        if (target) appendAudit('JOURNAL_ACTION', `Removed paper journal record for ${target.symbol}`);
        return prev.filter((x) => x.id !== id);
      });
    },
    [appendAudit]
  );

  const handleApplyConfig = () => {
    setConfig(draftConfig);
    setShowSettings(false);
    appendAudit(
      'CONFIG_CHANGE',
      `Updated engine parameters: Portfolio NPR ${draftConfig.risk.portfolioValue.toLocaleString('en-US')}, Risk ${draftConfig.risk.riskPctPerTrade}%, Min Turn NPR ${(draftConfig.minAvgDailyTurnover / 1e5).toFixed(0)}L`
    );
  };

  const navTabs: Array<{ id: EngineTabId; label: string }> = [
    { id: 'scanner', label: 'All-NEPSE Scanner' },
    { id: 'regime', label: 'Market Regime' },
    { id: 'watchlists', label: 'Watchlists & RS' },
    { id: 'sizing', label: 'Entry, Exit & Sizing' },
    { id: 'portfolio', label: `Portfolio & Journal (${journal.filter((j) => j.status === 'OPEN' || j.status === 'PARTIAL').length})` },
    { id: 'backtest', label: 'Backtest & Reliability' },
    { id: 'data_quality', label: 'Data Quality' },
    { id: 'glossary', label: 'Glossary & Practice Lab' },
    { id: 'classic', label: 'Classic Scanners (8)' },
  ];

  const weightSum =
    draftConfig.weights.trendStrength +
    draftConfig.weights.momentum +
    draftConfig.weights.relativeStrength +
    draftConfig.weights.volumeStrength +
    draftConfig.weights.breakoutStructure +
    draftConfig.weights.vwapBehavior;

  return (
    <div className="space-y-6">
      {/* Unified Engine Header & Controls */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
              <span>Statistical Advantage Trading Engine</span>
              <span aria-hidden="true">·</span>
              <span>SEPA · CAN SLIM · Trend Following</span>
              {data && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{data.dataTimestamp}</span>
                </>
              )}
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              NEPSE Quantitative Stock &amp; Risk Decision Workbench
            </h2>
          </div>

          {/* Right Controls: Learning Mode (Explanation Depth Only), asOf Date, Settings, Re-run */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {/* Beginner vs Advanced Learning Depth */}
            <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5">
              <button
                type="button"
                onClick={() => setLearningMode('beginner')}
                className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
                  learningMode === 'beginner'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Beginner Guide
              </button>
              <button
                type="button"
                onClick={() => setLearningMode('advanced')}
                className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
                  learningMode === 'advanced'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Advanced Quant
              </button>
            </div>

            <select
              value={asof}
              onChange={(e) => setAsof(e.target.value)}
              aria-label="Analysis Date"
              className="px-2.5 py-1.5 font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              {[...dates].reverse().map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                setDraftConfig(config);
                setShowSettings((v) => !v);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Parameters</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('glossary')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Learn Terms</span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => fetchAnalysis(asof, config, `Manual re-scan executed for ${asof}`)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Analyzing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Summary Strip when loaded */}
        {data && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                Regime
                <QuantHelpTip termId="market-breadth" learningMode={learningMode} onOpenGlossaryTerm={handleOpenGlossaryTerm} />
              </span>
              <span
                className={`font-semibold text-sm ${
                  data.marketRegime.regime === 'Bullish'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : data.marketRegime.regime === 'Bearish'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {data.marketRegime.regime} ({data.marketRegime.regimeScore}/100)
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                Target Exposure
                <QuantHelpTip termId="maximum-exposure" learningMode={learningMode} onOpenGlossaryTerm={handleOpenGlossaryTerm} />
              </span>
              <span className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100">
                {data.marketRegime.recommendedExposureMinPct}%–{data.marketRegime.recommendedExposureMaxPct}%
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Breadth &gt; SMA20</span>
              <span className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100 block">
                {data.marketRegime.breadthAboveSma20Pct.toFixed(1)}% ({data.marketRegime.adRatio.toFixed(2)}x A/D)
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Actionable / Wait</span>
              <span className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100 block">
                {data.candidates.filter((c) => c.classification.includes('BUY')).length} BUY ·{' '}
                {data.candidates.filter((c) => c.classification === 'WAIT FOR CONFIRMATION').length} WAIT
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Valid / Excluded</span>
              <span className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100 block">
                {data.candidates.length} valid · {data.excludedStocks.length} excl
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Data Integrity</span>
              <span className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100 block">
                {data.dataQuality.overallQualityScore}/100 ({data.dataQuality.totalSessionsInStore}d)
              </span>
            </div>
          </div>
        )}

        {/* Collapsible Engine Configuration Drawer */}
        {showSettings && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Configurable Quantitative, Risk &amp; Cost Parameters
              </div>
              <div className="text-slate-500">
                Technical Weights Total: <strong className="font-mono">{weightSum}%</strong> (auto-normalized to 100%)
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <label className="space-y-1">
                <span>Portfolio (NPR)</span>
                <input
                  type="number"
                  min={10000}
                  step={50000}
                  value={draftConfig.risk.portfolioValue}
                  onChange={(e) => setDraftConfig({ ...draftConfig, risk: { ...draftConfig.risk, portfolioValue: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>Risk / Trade (%)</span>
                <input
                  type="number"
                  min={0.25}
                  max={5}
                  step={0.25}
                  value={draftConfig.risk.riskPctPerTrade}
                  onChange={(e) => setDraftConfig({ ...draftConfig, risk: { ...draftConfig.risk, riskPctPerTrade: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>Max Stock %</span>
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={draftConfig.risk.maxSingleStockPct}
                  onChange={(e) => setDraftConfig({ ...draftConfig, risk: { ...draftConfig.risk, maxSingleStockPct: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>Max Sector %</span>
                <input
                  type="number"
                  min={10}
                  max={80}
                  value={draftConfig.risk.maxSectorConcentrationPct}
                  onChange={(e) => setDraftConfig({ ...draftConfig, risk: { ...draftConfig.risk, maxSectorConcentrationPct: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>Min Turn (Lakh)</span>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={Math.round(draftConfig.minAvgDailyTurnover / 1e5)}
                  onChange={(e) => setDraftConfig({ ...draftConfig, minAvgDailyTurnover: Number(e.target.value) * 1e5 })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>Min 20d Vol</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={draftConfig.minAvgDailyVolume}
                  onChange={(e) => setDraftConfig({ ...draftConfig, minAvgDailyVolume: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>Slippage % / side</span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  value={draftConfig.costs.slippagePct}
                  onChange={(e) => setDraftConfig({ ...draftConfig, costs: { ...draftConfig.costs, slippagePct: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>CGT Tax Rate</span>
                <select
                  value={draftConfig.costs.cgtRate}
                  onChange={(e) => setDraftConfig({ ...draftConfig, costs: { ...draftConfig.costs, cgtRate: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value={0.075}>7.5% (&lt;1 yr)</option>
                  <option value={0.05}>5.0% (≥1 yr)</option>
                </select>
              </label>
              <label className="space-y-1">
                <span>Stop ATR Mult</span>
                <input
                  type="number"
                  min={0.8}
                  max={3}
                  step={0.1}
                  value={draftConfig.backtest.stopAtrMult}
                  onChange={(e) => setDraftConfig({ ...draftConfig, backtest: { ...draftConfig.backtest, stopAtrMult: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>Max Hold Days</span>
                <input
                  type="number"
                  min={5}
                  max={40}
                  value={draftConfig.backtest.holdingDays}
                  onChange={(e) => setDraftConfig({ ...draftConfig, backtest: { ...draftConfig.backtest, holdingDays: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>Breakout RVOL ≥</span>
                <input
                  type="number"
                  min={1}
                  max={3}
                  step={0.1}
                  value={draftConfig.backtest.breakoutVolMult}
                  onChange={(e) => setDraftConfig({ ...draftConfig, backtest: { ...draftConfig.backtest, breakoutVolMult: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
              <label className="space-y-1">
                <span>Min Sample Size</span>
                <input
                  type="number"
                  min={3}
                  max={50}
                  value={draftConfig.backtest.minSampleSize}
                  onChange={(e) => setDraftConfig({ ...draftConfig, backtest: { ...draftConfig.backtest, minSampleSize: Number(e.target.value) } })}
                  className="w-full px-2.5 py-1.5 font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftConfig.risk.enforceTenKitta}
                    onChange={(e) => setDraftConfig({ ...draftConfig, risk: { ...draftConfig.risk, enforceTenKitta: e.target.checked } })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Round quantities to 10-kitta lots</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftConfig.risk.allowBearishNewEntries}
                    onChange={(e) => setDraftConfig({ ...draftConfig, risk: { ...draftConfig.risk, allowBearishNewEntries: e.target.checked } })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Allow BUY signals during Bearish regime (not recommended)</span>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDraftConfig(DEFAULT_CLIENT_CONFIG)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Reset Defaults
                </button>
                <button
                  type="button"
                  onClick={handleApplyConfig}
                  className="px-4 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
                >
                  Apply &amp; Re-Analyze
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Compact Internal Segmented Navigation */}
      <div className="flex flex-wrap gap-1.5 pb-1 border-b border-slate-200 dark:border-slate-800">
        {navTabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 text-xs font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Error / Loading / Active View */}
      {errorMsg && activeTab !== 'classic' && activeTab !== 'glossary' && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-700 dark:text-red-300">
          Quantitative engine error: {errorMsg}
        </div>
      )}

      {activeTab === 'classic' ? (
        classicScannersContent
      ) : activeTab === 'glossary' ? (
        <div className="space-y-8">
          <QuantCalculators
            learningMode={learningMode}
            onOpenGlossaryTerm={handleOpenGlossaryTerm}
          />
          <QuantGlossaryPanel
            learningMode={learningMode}
            focusedTermId={focusedGlossaryId}
            onSelectTerm={setFocusedGlossaryId}
          />
        </div>
      ) : !data && loading ? (
        <div className="space-y-4">
          <div className="h-32 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
          <div className="h-72 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
        </div>
      ) : !data ? (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
          Select a trading date with loaded CSV data to run the Statistical Advantage Engine.
        </div>
      ) : (
        <>
          {activeTab === 'scanner' && (
            <QuantScannerAndCandidateTab
              candidates={data.candidates}
              excludedStocks={data.excludedStocks}
              selectedSymbol={selectedSymbol}
              onSelectSymbol={setSelectedSymbol}
              asOfDate={data.asOfDate}
              learningMode={learningMode}
              onOpenGlossaryTerm={handleOpenGlossaryTerm}
              onInspectInExplorer={onInspectSymbol}
              onAddPaperTrade={handleAddPaperTrade}
              onOpenSizingTab={(sym) => {
                setSelectedSymbol(sym);
                setActiveTab('sizing');
              }}
            />
          )}

          {activeTab === 'regime' && (
            <QuantRegimeTab
              regime={data.marketRegime}
              learningMode={learningMode}
              onOpenGlossaryTerm={handleOpenGlossaryTerm}
            />
          )}

          {activeTab === 'watchlists' && (
            <QuantWatchlistsAndRsTab
              data={data}
              learningMode={learningMode}
              onOpenGlossaryTerm={handleOpenGlossaryTerm}
              onSelectCandidate={(sym) => {
                setSelectedSymbol(sym);
                setActiveTab('scanner');
              }}
              onOpenSizingTab={(sym) => {
                setSelectedSymbol(sym);
                setActiveTab('sizing');
              }}
            />
          )}

          {activeTab === 'sizing' && (
            <QuantEntryExitSizingTab
              data={data}
              selectedSymbol={selectedSymbol}
              onSelectSymbol={setSelectedSymbol}
              learningMode={learningMode}
              onOpenGlossaryTerm={handleOpenGlossaryTerm}
              onAddPaperTrade={handleAddPaperTrade}
            />
          )}

          {activeTab === 'portfolio' && (
            <QuantPortfolioJournalTab
              candidates={data.candidates}
              excludedStocks={data.excludedStocks}
              regime={data.marketRegime}
              config={data.config}
              journal={journal}
              auditLog={auditLog}
              onCreateEntry={handleCreateManualEntry}
              onUpdateEntry={handleUpdateJournalEntry}
              onDeleteEntry={handleDeleteJournalEntry}
              learningMode={learningMode}
              onOpenGlossaryTerm={handleOpenGlossaryTerm}
            />
          )}

          {activeTab === 'backtest' && (
            <QuantBacktestTab
              backtest={data.backtestSummary}
              learningMode={learningMode}
              onOpenGlossaryTerm={handleOpenGlossaryTerm}
            />
          )}

          {activeTab === 'data_quality' && (
            <QuantDataQualitySection
              dataQuality={data.dataQuality}
              excludedStocks={data.excludedStocks}
              learningMode={learningMode}
              onOpenGlossaryTerm={handleOpenGlossaryTerm}
            />
          )}
        </>
      )}
    </div>
  );
};
