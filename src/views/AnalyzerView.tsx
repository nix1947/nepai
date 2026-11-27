import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Info,
  Layers,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { AnalyzerChart, type AnalyzerChartHandle } from '../components/analyzer/AnalyzerChart';
import { NepseTradePlanner } from '../components/NepseTradePlanner';
import type {
  AnalyzerBacktestSummary,
  AnalyzerGrade,
  AnalyzerResponse,
  AnalyzerScanResponse,
  AnalyzerSetup,
  AnalyzerStrategyFilter,
  AnalyzerTimeframe,
  OverlayToggleState,
} from '../types/analyzer';
import type { SymbolInfo } from '../types/market';
import { formatCrore, formatNum, formatPct } from '../utils/format';

interface AnalyzerViewProps {
  dates: string[];
  equityOnly: boolean;
  allSymbols: SymbolInfo[];
  initialSymbol?: string | null;
}

const DEFAULT_OVERLAYS: OverlayToggleState = {
  swings: true,
  structureBreaks: true,
  displacement: false,
  fvg: true,
  ifvgAndBpr: false,
  volumeImbalanceAndVoids: false,
  orderBlocks: true,
  advancedBlocks: false,
  liquidityLevels: true,
  sweepsAndInducement: true,
  premiumDiscountOte: false,
  candlePatterns: false,
  srZones: false,
  trendlinesAndChannels: false,
  chartPatterns: false,
  supplyDemand: false,
  wyckoff: false,
  tradeBox: true,
};

const ALL_OVERLAYS_ON: OverlayToggleState = {
  swings: true,
  structureBreaks: true,
  displacement: true,
  fvg: true,
  ifvgAndBpr: true,
  volumeImbalanceAndVoids: true,
  orderBlocks: true,
  advancedBlocks: true,
  liquidityLevels: true,
  sweepsAndInducement: true,
  premiumDiscountOte: true,
  candlePatterns: true,
  srZones: true,
  trendlinesAndChannels: true,
  chartPatterns: true,
  supplyDemand: true,
  wyckoff: true,
  tradeBox: true,
};

const PRICE_ACTION_OVERLAYS: OverlayToggleState = {
  swings: true,
  structureBreaks: true,
  displacement: false,
  fvg: false,
  ifvgAndBpr: false,
  volumeImbalanceAndVoids: false,
  orderBlocks: false,
  advancedBlocks: false,
  liquidityLevels: true,
  sweepsAndInducement: false,
  premiumDiscountOte: true,
  candlePatterns: true,
  srZones: true,
  trendlinesAndChannels: true,
  chartPatterns: true,
  supplyDemand: true,
  wyckoff: false,
  tradeBox: true,
};

const OVERLAY_LABELS: Array<{ key: keyof OverlayToggleState; label: string; group: string }> = [
  { key: 'swings', label: 'Swings (HH/HL/LH/LL)', group: 'Structure' },
  { key: 'structureBreaks', label: 'BOS / CHoCH / MSS', group: 'Structure' },
  { key: 'displacement', label: 'Displacement', group: 'Structure' },
  { key: 'fvg', label: 'FVG (CE 50%)', group: 'Imbalance' },
  { key: 'ifvgAndBpr', label: 'IFVG & BPR', group: 'Imbalance' },
  { key: 'volumeImbalanceAndVoids', label: 'Vol Imb / Gaps / Voids', group: 'Imbalance' },
  { key: 'orderBlocks', label: 'Order Blocks (OB)', group: 'Order Blocks' },
  { key: 'advancedBlocks', label: 'Breaker / Mitig / Prop / Unicorn', group: 'Order Blocks' },
  { key: 'liquidityLevels', label: 'BSL/SSL, EQH/EQL, PDH/PWH/52W', group: 'Liquidity' },
  { key: 'sweepsAndInducement', label: 'Sweeps (✕), IDM, Turtle Soup', group: 'Liquidity' },
  { key: 'premiumDiscountOte', label: 'Premium/Discount, OTE, W.Open', group: 'Ranges' },
  { key: 'candlePatterns', label: 'Candlestick Patterns', group: 'Price Action' },
  { key: 'srZones', label: 'S/R Zones', group: 'Price Action' },
  { key: 'trendlinesAndChannels', label: 'Trendlines & Channels', group: 'Price Action' },
  { key: 'chartPatterns', label: 'Chart Patterns (DT/H&S/Tri/Cup)', group: 'Price Action' },
  { key: 'supplyDemand', label: 'Supply / Demand (RBR/DBD)', group: 'Zones' },
  { key: 'wyckoff', label: 'Wyckoff (Experimental)', group: 'Zones' },
  { key: 'tradeBox', label: 'Active Entry / SL / TP Box', group: 'Plan' },
];

interface ConfigFormState {
  swingLeft: number;
  swingRight: number;
  fvgMinAtr: number;
  displacementBodyAtr: number;
  eqTolerancePct: number;
  minRR: number;
}

const DEFAULT_CONFIG_FORM: ConfigFormState = {
  swingLeft: 3,
  swingRight: 3,
  fvgMinAtr: 0.15,
  displacementBodyAtr: 1.25,
  eqTolerancePct: 0.65,
  minRR: 1.5,
};

function gradeColorClass(grade: AnalyzerGrade): string {
  if (grade === 'A') return 'text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40';
  if (grade === 'B') return 'text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40';
  if (grade === 'C') return 'text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40';
  return 'text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900';
}

export const AnalyzerView: React.FC<AnalyzerViewProps> = ({
  dates,
  equityOnly,
  allSymbols,
  initialSymbol,
}) => {
  const defaultSymbol = useMemo(() => {
    if (initialSymbol) return initialSymbol;
    const preferred = ['NABIL', 'NICA', 'GBIME', 'HBL', 'SHIVM', 'CIT'];
    for (const sym of preferred) {
      if (allSymbols.some((s) => s.symbol === sym)) return sym;
    }
    return allSymbols[0]?.symbol ?? 'NABIL';
  }, [initialSymbol, allSymbols]);

  const [symbol, setSymbol] = useState<string>(defaultSymbol);
  const [tickerQuery, setTickerQuery] = useState<string>('');
  const [tickerMenuOpen, setTickerMenuOpen] = useState<boolean>(false);

  const [tf, setTf] = useState<AnalyzerTimeframe>('1D');
  const [strategy, setStrategy] = useState<AnalyzerStrategyFilter>('All');
  const [mode, setMode] = useState<'single' | 'scan'>('single');

  const [overlays, setOverlays] = useState<OverlayToggleState>(DEFAULT_OVERLAYS);
  const [showOverlayPanel, setShowOverlayPanel] = useState<boolean>(true);
  const [showSettingsPanel, setShowSettingsPanel] = useState<boolean>(false);
  const [configForm, setConfigForm] = useState<ConfigFormState>(DEFAULT_CONFIG_FORM);

  // Replay mode state
  const [replayActive, setReplayActive] = useState<boolean>(false);
  const [replayIndex, setReplayIndex] = useState<number>(Math.max(0, dates.length - 1));
  const [replayPlaying, setReplayPlaying] = useState<boolean>(false);

  // Single analysis data
  const [analysis, setAnalysis] = useState<AnalyzerResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Selected setup & trade planner handoff
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>(null);
  const [plannerLevels, setPlannerLevels] = useState<{
    entry: number;
    stop: number;
    target: number;
  } | null>(null);

  // Inspector sub-tab
  const [inspectorTab, setInspectorTab] = useState<'bias' | 'setups' | 'concepts' | 'backtest'>('bias');

  // Scan state
  const [scanMinGrade, setScanMinGrade] = useState<'A' | 'B' | 'C'>('B');
  const [scanData, setScanData] = useState<AnalyzerScanResponse | null>(null);
  const [scanLoading, setScanLoading] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Backtest state
  const [backtestScope, setBacktestScope] = useState<'symbol' | 'cohort'>('symbol');
  const [backtestData, setBacktestData] = useState<AnalyzerBacktestSummary | null>(null);
  const [backtestLoading, setBacktestLoading] = useState<boolean>(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  const chartRef = useRef<AnalyzerChartHandle | null>(null);

  useEffect(() => {
    if (initialSymbol) {
      setSymbol(initialSymbol);
      setMode('single');
    }
  }, [initialSymbol]);

  useEffect(() => {
    if (!replayActive && dates.length > 0) {
      setReplayIndex(dates.length - 1);
    }
  }, [dates, replayActive]);

  const effectiveAsOf = useMemo(() => {
    if (!replayActive || dates.length === 0) return undefined;
    const clamped = Math.max(0, Math.min(dates.length - 1, replayIndex));
    return dates[clamped];
  }, [replayActive, dates, replayIndex]);

  const buildConfigParams = useCallback(() => {
    const p = new URLSearchParams();
    p.set('tf', tf);
    p.set('strategy', strategy);
    p.set('swingLeft', String(configForm.swingLeft));
    p.set('swingRight', String(configForm.swingRight));
    p.set('fvgMinAtr', String(configForm.fvgMinAtr));
    p.set('displacementBodyAtr', String(configForm.displacementBodyAtr));
    p.set('eqTolerancePct', String(configForm.eqTolerancePct));
    p.set('minRR', String(configForm.minRR));
    if (effectiveAsOf) p.set('asOf', effectiveAsOf);
    return p;
  }, [tf, strategy, configForm, effectiveAsOf]);

  // Fetch Single Stock Analysis
  useEffect(() => {
    if (mode !== 'single' || !symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = buildConfigParams();
    fetch(`/api/analyzer/${encodeURIComponent(symbol)}?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        return json as AnalyzerResponse;
      })
      .then((payload) => {
        if (cancelled) return;
        setAnalysis(payload);
        const firstLong = payload.topLongSetup ?? payload.setups[0] ?? null;
        setSelectedSetupId(firstLong?.id ?? null);
        if (firstLong && firstLong.tradePlan.valid) {
          setPlannerLevels({
            entry: firstLong.tradePlan.entryMid,
            stop: firstLong.tradePlan.stopLoss,
            target: firstLong.tradePlan.target2,
          });
        } else {
          setPlannerLevels(null);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load stock analysis');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, symbol, buildConfigParams]);

  // Fetch Scan Results
  useEffect(() => {
    if (mode !== 'scan') return;
    let cancelled = false;
    setScanLoading(true);
    setScanError(null);
    const params = buildConfigParams();
    params.set('minGrade', scanMinGrade);
    params.set('equityOnly', String(equityOnly));
    fetch(`/api/analyzer/scan?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        return json as AnalyzerScanResponse;
      })
      .then((payload) => {
        if (cancelled) return;
        setScanData(payload);
        setScanLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setScanError(err instanceof Error ? err.message : 'Scan failed');
        setScanLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, buildConfigParams, scanMinGrade, equityOnly]);

  // Auto-advance Replay playback
  useEffect(() => {
    if (!replayActive || !replayPlaying) return;
    const timer = setInterval(() => {
      setReplayIndex((prev) => {
        if (prev >= dates.length - 1) {
          setReplayPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 950);
    return () => clearInterval(timer);
  }, [replayActive, replayPlaying, dates.length]);

  const runBacktest = async (scope: 'symbol' | 'cohort') => {
    setBacktestScope(scope);
    setBacktestLoading(true);
    setBacktestError(null);
    try {
      const params = buildConfigParams();
      params.delete('asOf');
      params.set('holdoutRatio', '0.35');
      params.set('equityOnly', String(equityOnly));
      if (scope === 'symbol' && symbol) params.set('symbol', symbol);
      const res = await fetch(`/api/analyzer/backtest?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setBacktestData(json as AnalyzerBacktestSummary);
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setBacktestLoading(false);
    }
  };

  const selectedSetup: AnalyzerSetup | null = useMemo(() => {
    if (!analysis) return null;
    return (
      analysis.setups.find((s) => s.id === selectedSetupId) ??
      analysis.topLongSetup ??
      analysis.setups[0] ??
      null
    );
  }, [analysis, selectedSetupId]);

  const filteredTickers = useMemo(() => {
    const q = tickerQuery.trim().toLowerCase();
    if (!q) return allSymbols.slice(0, 15);
    return allSymbols
      .filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 15);
  }, [allSymbols, tickerQuery]);

  const handleExportJson = () => {
    if (!analysis) return;
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${analysis.symbol}_${analysis.tf}_${analysis.asOfDate}_analysis.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPng = () => {
    const dataUrl = chartRef.current?.exportPng();
    if (!dataUrl || !analysis) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${analysis.symbol}_${analysis.tf}_${analysis.asOfDate}.png`;
    a.click();
  };

  const latestClose = analysis?.bars[analysis.bars.length - 1]?.close ?? 0;

  return (
    <div className="space-y-4">
      {/* Top Control Toolbar */}
      <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Searchable Ticker Selector */}
            <div className="relative">
              <div className="flex items-center">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={tickerMenuOpen ? tickerQuery : symbol}
                  onFocus={() => {
                    setTickerQuery('');
                    setTickerMenuOpen(true);
                  }}
                  onBlur={() => setTimeout(() => setTickerMenuOpen(false), 160)}
                  onChange={(e) => {
                    setTickerQuery(e.target.value);
                    setTickerMenuOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && filteredTickers.length > 0) {
                      setSymbol(filteredTickers[0].symbol);
                      setTickerMenuOpen(false);
                      setMode('single');
                    }
                  }}
                  aria-label="Analyzer Symbol"
                  className="w-36 sm:w-44 pl-8 pr-2.5 py-1.5 text-xs font-mono font-semibold rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
              {tickerMenuOpen && filteredTickers.length > 0 && (
                <div className="absolute left-0 mt-1 w-72 max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg z-40 divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredTickers.map((t) => (
                    <button
                      key={t.symbol}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSymbol(t.symbol);
                        setTickerMenuOpen(false);
                        setMode('single');
                      }}
                      className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2"
                    >
                      <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {t.symbol}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400 truncate flex-1">
                        {t.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Timeframes */}
            <div className="inline-flex rounded border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
              {(['1D', '1W', '1M'] as AnalyzerTimeframe[]).map((tOpt) => (
                <button
                  key={tOpt}
                  type="button"
                  onClick={() => setTf(tOpt)}
                  className={`px-2.5 py-1.5 font-mono font-medium transition-colors ${
                    tf === tOpt
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {tOpt}
                </button>
              ))}
            </div>

            {/* Strategy Selector */}
            <div className="inline-flex flex-wrap rounded border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
              {(['All', 'ICT', 'SMC', 'Price Action', 'Wyckoff'] as AnalyzerStrategyFilter[]).map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStrategy(st)}
                    className={`px-2.5 py-1.5 font-medium transition-colors ${
                      strategy === st
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {st}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMode(mode === 'single' ? 'scan' : 'single')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                mode === 'scan'
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Radar className="w-3.5 h-3.5" />
              <span>{mode === 'scan' ? 'Back to Chart' : 'Scan Today (A/B)'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setReplayActive((v) => {
                  const next = !v;
                  if (next && dates.length > 15) {
                    setReplayIndex(Math.max(10, dates.length - 15));
                  } else if (!next) {
                    setReplayPlaying(false);
                    setReplayIndex(Math.max(0, dates.length - 1));
                  }
                  return next;
                });
                setMode('single');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                replayActive
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>{replayActive ? 'Exit Replay' : 'Replay Mode'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowOverlayPanel((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Overlays</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSettingsPanel((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Config</span>
            </button>

            {mode === 'single' && analysis && (
              <>
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  title="Export full analysis JSON"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>JSON</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPng}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  title="Export chart PNG"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>PNG</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Replay Scrub Bar */}
        {replayActive && mode === 'single' && dates.length > 0 && (
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-amber-700 dark:text-amber-300 font-mono">
                REPLAY AS-OF: {effectiveAsOf}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                (Strict causal window — future sessions hidden; swings confirm only after {configForm.swingRight} bars)
              </span>
            </div>
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <button
                type="button"
                onClick={() => setReplayIndex((i) => Math.max(5, i - 1))}
                className="p-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Previous bar"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setReplayPlaying((p) => !p)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
              >
                {replayPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{replayPlaying ? 'Pause' : 'Play'}</span>
              </button>
              <button
                type="button"
                onClick={() => setReplayIndex((i) => Math.min(dates.length - 1, i + 1))}
                className="p-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Next bar"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <input
                type="range"
                min={Math.min(10, dates.length - 1)}
                max={dates.length - 1}
                value={replayIndex}
                onChange={(e) => {
                  setReplayPlaying(false);
                  setReplayIndex(Number(e.target.value));
                }}
                className="flex-1 accent-amber-600"
              />
              <button
                type="button"
                onClick={() => {
                  setReplayPlaying(false);
                  setReplayIndex(dates.length - 1);
                }}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              >
                <RotateCcw className="w-3 h-3" />
                Latest
              </button>
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {showSettingsPanel && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-slate-400 block">Swing Left (n)</span>
              <input
                type="number"
                min={2}
                max={10}
                value={configForm.swingLeft}
                onChange={(e) =>
                  setConfigForm((f) => ({ ...f, swingLeft: Math.max(2, Number(e.target.value) || 3) }))
                }
                className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-slate-400 block">Swing Confirm (Right)</span>
              <input
                type="number"
                min={2}
                max={10}
                value={configForm.swingRight}
                onChange={(e) =>
                  setConfigForm((f) => ({ ...f, swingRight: Math.max(2, Number(e.target.value) || 3) }))
                }
                className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-slate-400 block">Min FVG (ATR×)</span>
              <input
                type="number"
                step={0.05}
                min={0.05}
                max={1.5}
                value={configForm.fvgMinAtr}
                onChange={(e) =>
                  setConfigForm((f) => ({ ...f, fvgMinAtr: Number(e.target.value) || 0.15 }))
                }
                className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-slate-400 block">Displacement (ATR×)</span>
              <input
                type="number"
                step={0.1}
                min={0.7}
                max={3}
                value={configForm.displacementBodyAtr}
                onChange={(e) =>
                  setConfigForm((f) => ({
                    ...f,
                    displacementBodyAtr: Number(e.target.value) || 1.25,
                  }))
                }
                className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-slate-400 block">EQH/EQL Tol (%)</span>
              <input
                type="number"
                step={0.1}
                min={0.1}
                max={2.5}
                value={configForm.eqTolerancePct}
                onChange={(e) =>
                  setConfigForm((f) => ({ ...f, eqTolerancePct: Number(e.target.value) || 0.65 }))
                }
                className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-slate-400 block">Min R:R Gate</span>
              <input
                type="number"
                step={0.1}
                min={1.0}
                max={4.0}
                value={configForm.minRR}
                onChange={(e) =>
                  setConfigForm((f) => ({ ...f, minRR: Math.max(1.0, Number(e.target.value) || 1.5) }))
                }
                className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setConfigForm(DEFAULT_CONFIG_FORM)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Reset Defaults
              </button>
            </div>
          </div>
        )}

        {/* Overlay Toggle Strip */}
        {mode === 'single' && showOverlayPanel && (
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                Chart Concept Overlays
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOverlays(DEFAULT_OVERLAYS)}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Core Default
                </button>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <button
                  type="button"
                  onClick={() => setOverlays(ALL_OVERLAYS_ON)}
                  className="text-slate-600 dark:text-slate-300 hover:underline"
                >
                  All Concepts
                </button>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <button
                  type="button"
                  onClick={() => setOverlays(PRICE_ACTION_OVERLAYS)}
                  className="text-slate-600 dark:text-slate-300 hover:underline"
                >
                  Price Action
                </button>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <button
                  type="button"
                  onClick={() =>
                    setOverlays(
                      Object.fromEntries(
                        Object.keys(DEFAULT_OVERLAYS).map((k) => [k, false])
                      ) as unknown as OverlayToggleState
                    )
                  }
                  className="text-slate-500 hover:underline"
                >
                  Clear All
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11px]">
              {OVERLAY_LABELS.map((item) => (
                <label
                  key={item.key}
                  className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300 select-none"
                >
                  <input
                    type="checkbox"
                    checked={overlays[item.key]}
                    onChange={(e) =>
                      setOverlays((prev) => ({ ...prev, [item.key]: e.target.checked }))
                    }
                    className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SCAN TODAY MODE */}
      {mode === 'scan' && (
        <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                NEPSE Auto Analyzer Scanner ({tf} · {strategy})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Long-only actionable setups passing liquidity, R:R &ge; {configForm.minRR}, and minimum grade gates.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Min Grade:</span>
              {(['A', 'B', 'C'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setScanMinGrade(g)}
                  className={`px-2.5 py-1 rounded border font-mono font-semibold ${
                    scanMinGrade === g
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {scanLoading ? (
            <div className="h-48 flex items-center justify-center text-xs text-slate-500">
              Scanning NEPSE symbols deterministically…
            </div>
          ) : scanError ? (
            <div className="p-3 rounded border border-rose-200 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
              {scanError}
            </div>
          ) : scanData ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500 text-[11px]">As-Of Date</div>
                  <div className="font-semibold">{scanData.asOfDate}</div>
                </div>
                <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500 text-[11px]">Symbols Scanned</div>
                  <div className="font-semibold">{scanData.scannedSymbols}</div>
                </div>
                <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500 text-[11px]">Qualifying Long Setups</div>
                  <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {scanData.qualifyingCount}
                  </div>
                </div>
                <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500 text-[11px]">Filter</div>
                  <div className="font-semibold">
                    Grade {scanData.minGrade}+ · {scanData.strategy}
                  </div>
                </div>
              </div>

              {scanData.rows.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded">
                  No stocks meet Grade {scanMinGrade}+ long criteria on {scanData.asOfDate} under current thresholds. Try lowering Min Grade to C or checking another timeframe.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase text-slate-500">
                        <th className="py-2 pr-3">Ticker</th>
                        <th className="py-2 pr-3">Grade / Score</th>
                        <th className="py-2 pr-3">Strategy &amp; Setup</th>
                        <th className="py-2 pr-3 text-right">Close</th>
                        <th className="py-2 pr-3 text-right">Entry</th>
                        <th className="py-2 pr-3 text-right">Stop</th>
                        <th className="py-2 pr-3 text-right">Target 2</th>
                        <th className="py-2 pr-3 text-right">R:R</th>
                        <th className="py-2 pr-3 text-right">20d Avg Turn.</th>
                        <th className="py-2">HTF / Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                      {scanData.rows.map((row) => (
                        <tr
                          key={row.symbol}
                          onClick={() => {
                            setSymbol(row.symbol);
                            setMode('single');
                          }}
                          className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <td className="py-2 pr-3 font-sans">
                            <div className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                              {row.symbol}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate max-w-[140px]">
                              {row.sector}
                            </div>
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold ${gradeColorClass(row.grade)}`}
                            >
                              {row.grade} ({row.score})
                            </span>
                          </td>
                          <td className="py-2 pr-3 font-sans">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {row.setupName}
                            </div>
                            <div className="text-[11px] text-slate-500">{row.strategy}</div>
                          </td>
                          <td className="py-2 pr-3 text-right">{formatNum(row.close)}</td>
                          <td className="py-2 pr-3 text-right text-blue-600 dark:text-blue-400">
                            {formatNum(row.entryMid)}
                          </td>
                          <td className="py-2 pr-3 text-right text-rose-600 dark:text-rose-400">
                            {formatNum(row.stopLoss)}
                          </td>
                          <td className="py-2 pr-3 text-right text-emerald-600 dark:text-emerald-400">
                            {formatNum(row.target2)}
                          </td>
                          <td className="py-2 pr-3 text-right font-semibold">{row.rrT2.toFixed(2)}R</td>
                          <td className="py-2 pr-3 text-right">{formatCrore(row.avgTurnover20Npr)}</td>
                          <td className="py-2 font-sans text-[11px]">
                            <span className="text-slate-600 dark:text-slate-300">
                              {row.htfAlignment}
                            </span>
                            {row.hasBearishWarning && (
                              <span className="block text-amber-600 dark:text-amber-400">
                                + Bearish supply warning nearby
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* SINGLE STOCK ANALYSIS MODE */}
      {mode === 'single' && (
        <>
          {loading && !analysis ? (
            <div className="h-96 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center text-xs text-slate-500">
              Analyzing {symbol} on {tf} EOD sessions…
            </div>
          ) : error ? (
            <div className="p-4 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : analysis ? (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
              {/* Left Column: Chart + Trade Planner */}
              <div className="xl:col-span-8 space-y-4">
                <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">
                        {analysis.symbol}
                      </h2>
                      <span className="text-xs text-slate-600 dark:text-slate-300">
                        {analysis.name}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        · {analysis.sector}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 flex flex-wrap items-center gap-3 mt-0.5 tabular-nums">
                      <span>As-Of: {analysis.asOfDate}</span>
                      <span>
                        Trend:{' '}
                        <strong
                          className={
                            analysis.trendState === 'Bullish'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : analysis.trendState === 'Bearish'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {analysis.trendState}
                        </strong>
                      </span>
                      <span>Zone: {analysis.premiumDiscount.zoneLabel}</span>
                      <span>20d Avg Turn: {formatCrore(analysis.liquidityStats.avgTurnover20Npr)}</span>
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    {analysis.topLongSetup ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Top Setup:</span>
                        <span
                          className={`px-2 py-0.5 rounded border text-xs font-semibold ${gradeColorClass(analysis.topLongSetup.grade)}`}
                        >
                          Grade {analysis.topLongSetup.grade} · {analysis.topLongSetup.score}/100
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">No qualifying long setup</span>
                    )}
                  </div>
                </div>

                <AnalyzerChart
                  ref={chartRef}
                  data={analysis}
                  overlays={overlays}
                  selectedSetup={selectedSetup}
                />

                {/* Quick Warnings Strip */}
                {analysis.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/20 px-3.5 py-2.5 space-y-1">
                    {analysis.warnings.map((w, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* NEPSE Long-Only Trade Planner Handoff */}
                <NepseTradePlanner
                  symbol={analysis.symbol}
                  lastClose={latestClose}
                  suggestedEntry={plannerLevels?.entry}
                  suggestedStop={plannerLevels?.stop}
                  suggestedTarget={plannerLevels?.target}
                />
              </div>

              {/* Right Column: Inspector Tabs */}
              <div className="xl:col-span-4 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                <div className="grid grid-cols-4 border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium">
                  {(
                    [
                      { id: 'bias', label: 'Bias' },
                      { id: 'setups', label: `Setups (${analysis.setups.length})` },
                      { id: 'concepts', label: 'Concepts' },
                      { id: 'backtest', label: 'Test/Limits' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setInspectorTab(t.id)}
                      className={`py-2.5 text-center transition-colors border-b-2 ${
                        inspectorTab === t.id
                          ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/20'
                          : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="p-4 space-y-4 max-h-[820px] overflow-y-auto text-xs">
                  {/* TAB 1: BIAS & NARRATIVE */}
                  {inspectorTab === 'bias' && (
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            HTF Bias Alignment
                          </span>
                          <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400 font-semibold">
                            {analysis.htfBias.alignmentLabel} ({analysis.htfBias.alignmentScore0to100}/100)
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[analysis.htfBias.monthly, analysis.htfBias.weekly, analysis.htfBias.daily].map(
                            (snap) => (
                              <div
                                key={snap.timeframe}
                                className="p-2 rounded border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40"
                              >
                                <div className="font-mono text-[11px] text-slate-500">
                                  {snap.timeframe}
                                </div>
                                <div
                                  className={`font-semibold flex items-center gap-1 mt-0.5 ${
                                    snap.trend === 'Bullish'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : snap.trend === 'Bearish'
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : 'text-amber-600 dark:text-amber-400'
                                  }`}
                                >
                                  {snap.trend === 'Bullish' ? (
                                    <TrendingUp className="w-3 h-3" />
                                  ) : snap.trend === 'Bearish' ? (
                                    <TrendingDown className="w-3 h-3" />
                                  ) : (
                                    <Activity className="w-3 h-3" />
                                  )}
                                  <span>{snap.trend}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  {snap.inDiscount ? 'Discount' : 'Premium'}
                                  {snap.lastBreakKind ? ` · ${snap.lastBreakKind}` : ''}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>

                      {/* Premium / Discount & Weekly PO3 */}
                      <div className="p-3 rounded border border-slate-200 dark:border-slate-800 space-y-2">
                        <div className="flex items-center justify-between font-semibold">
                          <span>Dealing Range ({analysis.premiumDiscount.rangeLookbackBars} bars)</span>
                          <span className="font-mono text-blue-600 dark:text-blue-400">
                            {analysis.premiumDiscount.pctInRange.toFixed(1)}% · {analysis.premiumDiscount.zoneLabel}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
                          <div>
                            <span className="text-slate-500 block">Range Low</span>
                            <span>{formatNum(analysis.premiumDiscount.rangeLow)}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Eq 50%</span>
                            <span>{formatNum(analysis.premiumDiscount.equilibrium)}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">Range High</span>
                            <span>{formatNum(analysis.premiumDiscount.rangeHigh)}</span>
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800 pt-2">
                          <span className="font-semibold">OTE 0.62–0.79:</span>{' '}
                          <span className="font-mono">
                            {formatNum(analysis.premiumDiscount.oteHigh)} –{' '}
                            {formatNum(analysis.premiumDiscount.oteLow)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300">
                          <span className="font-semibold">Weekly PO3:</span>{' '}
                          {analysis.premiumDiscount.weeklyPo3.phase} —{' '}
                          {analysis.premiumDiscount.weeklyPo3.note}
                        </div>
                      </div>

                      {/* Draw on Liquidity */}
                      <div>
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                          Draw on Liquidity Targets
                        </h3>
                        {analysis.drawOnLiquidity.length === 0 ? (
                          <p className="text-slate-500">No unswept resting pools mapped.</p>
                        ) : (
                          <div className="space-y-1 font-mono text-[11px] tabular-nums">
                            {analysis.drawOnLiquidity.map((d, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between px-2.5 py-1.5 rounded border border-slate-100 dark:border-slate-800"
                              >
                                <span
                                  className={
                                    d.side === 'buyside'
                                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                      : 'text-rose-600 dark:text-rose-400 font-semibold'
                                  }
                                >
                                  {d.label}
                                </span>
                                <span>
                                  {formatNum(d.price)} ({d.distancePct >= 0 ? '+' : ''}
                                  {d.distancePct.toFixed(1)}%)
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Narrative */}
                      <div>
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                          Deterministic Explanation
                        </h3>
                        <ul className="space-y-1.5 text-slate-600 dark:text-slate-300 list-disc pl-4 leading-relaxed">
                          {analysis.narrative.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: SETUPS */}
                  {inspectorTab === 'setups' && (
                    <div className="space-y-4">
                      {analysis.setups.filter((s) => s.direction === 'long').length === 0 ? (
                        <div className="p-3 rounded border border-slate-200 dark:border-slate-800 text-slate-500">
                          No qualifying long setups under {strategy} on {tf}. Review Warnings or switch to All strategies.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {analysis.setups
                            .filter((s) => s.direction === 'long')
                            .map((setup) => {
                              const active = selectedSetup?.id === setup.id;
                              return (
                                <div
                                  key={setup.id}
                                  className={`rounded-md border p-3 space-y-2.5 transition-colors ${
                                    active
                                      ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/20'
                                      : 'border-slate-200 dark:border-slate-800'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                                        {setup.name}
                                      </div>
                                      <div className="text-[11px] text-slate-500">
                                        Strategy: {setup.strategy}
                                      </div>
                                    </div>
                                    <span
                                      className={`px-2 py-0.5 rounded border font-mono text-[11px] font-bold shrink-0 ${gradeColorClass(setup.grade)}`}
                                    >
                                      {setup.grade} · {setup.score}/100
                                    </span>
                                  </div>

                                  <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                                    {setup.explanation}
                                  </p>

                                  {setup.tradePlan.valid ? (
                                    <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] bg-slate-50 dark:bg-slate-950/60 p-2 rounded border border-slate-200 dark:border-slate-800 tabular-nums">
                                      <div>
                                        <span className="text-slate-500">Entry:</span>{' '}
                                        <span className="text-blue-600 dark:text-blue-400 font-semibold">
                                          {formatNum(setup.tradePlan.entryMid)}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">Stop:</span>{' '}
                                        <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                          {formatNum(setup.tradePlan.stopLoss)}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">T1:</span>{' '}
                                        <span>
                                          {formatNum(setup.tradePlan.target1)} ({setup.tradePlan.rrT1.toFixed(1)}R)
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-slate-500">T2:</span>{' '}
                                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                          {formatNum(setup.tradePlan.target2)} ({setup.tradePlan.rrT2.toFixed(1)}R)
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                                      Rejected: {setup.tradePlan.rejectionReason}
                                    </div>
                                  )}

                                  {/* Weighted Checklist */}
                                  <div className="space-y-1">
                                    {setup.checklist.map((c, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between text-[11px]"
                                      >
                                        <span
                                          className={
                                            c.passed
                                              ? 'text-emerald-700 dark:text-emerald-300'
                                              : 'text-slate-400'
                                          }
                                        >
                                          {c.passed ? '[+]' : '[ ]'} {c.label}
                                        </span>
                                        <span className="font-mono text-slate-500">
                                          {c.pointsAwarded}/{c.weight}
                                        </span>
                                      </div>
                                    ))}
                                  </div>

                                  {setup.penalties.length > 0 && (
                                    <div className="text-[11px] text-amber-700 dark:text-amber-300 border-t border-slate-100 dark:border-slate-800 pt-1.5">
                                      Penalties (-{setup.totalPenalties}):{' '}
                                      {setup.penalties.map((p) => p.label).join(', ')}
                                    </div>
                                  )}

                                  <div className="flex items-center gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedSetupId(setup.id)}
                                      className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      Plot Box on Chart
                                    </button>
                                    {setup.tradePlan.valid && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedSetupId(setup.id);
                                          setPlannerLevels({
                                            entry: setup.tradePlan.entryMid,
                                            stop: setup.tradePlan.stopLoss,
                                            target: setup.tradePlan.target2,
                                          });
                                        }}
                                        className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium"
                                      >
                                        Send to Trade Planner
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}

                      {/* NEPSE Long-Only Bearish Exit / Take-Profit Warnings */}
                      {analysis.bearishExitWarnings.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                          <h4 className="font-semibold text-rose-600 dark:text-rose-400">
                            Exit / Take-Profit Warnings (NEPSE Retail Long-Only)
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            Short selling is unavailable to NEPSE retail accounts. Bearish setups act as profit-booking or caution signals:
                          </p>
                          {analysis.bearishExitWarnings.map((w) => (
                            <div
                              key={w.id}
                              className="p-2.5 rounded border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 space-y-1"
                            >
                              <div className="flex items-center justify-between font-semibold">
                                <span>{w.name}</span>
                                <span className="font-mono text-[11px]">
                                  Score {w.score}/100
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                {w.explanation}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: CONCEPTS INVENTORY */}
                  {inspectorTab === 'concepts' && (
                    <div className="space-y-3 text-[11px]">
                      <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                        <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                          <span className="text-slate-500 block">Structure Breaks</span>
                          <span className="font-semibold">{analysis.structureBreaks.length} (BOS/CHoCH/MSS)</span>
                        </div>
                        <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                          <span className="text-slate-500 block">Imbalances</span>
                          <span className="font-semibold">{analysis.imbalances.length} (FVG/IFVG/BPR/Gaps)</span>
                        </div>
                        <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                          <span className="text-slate-500 block">Order Blocks</span>
                          <span className="font-semibold">{analysis.orderBlocks.length} (OB/Breaker/Unicorn)</span>
                        </div>
                        <div className="p-2 rounded border border-slate-200 dark:border-slate-800">
                          <span className="text-slate-500 block">Chart Patterns</span>
                          <span className="font-semibold">{analysis.chartPatterns.length} detected</span>
                        </div>
                      </div>

                      {analysis.chartPatterns.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                            Chart Patterns
                          </h4>
                          <div className="space-y-1">
                            {analysis.chartPatterns.map((p) => (
                              <div
                                key={p.id}
                                className="p-2 rounded border border-slate-100 dark:border-slate-800 flex items-center justify-between"
                              >
                                <span>
                                  <strong>{p.name}</strong> ({p.status})
                                </span>
                                <span className="font-mono">
                                  Trig {formatNum(p.necklineOrTrigger)} → Tgt {formatNum(p.measuredTarget)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {analysis.candlePatterns.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                            Recent Candlestick Patterns
                          </h4>
                          <div className="space-y-1">
                            {analysis.candlePatterns.slice(-8).reverse().map((c, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between px-2 py-1 rounded bg-slate-50 dark:bg-slate-950/50"
                              >
                                <span>{c.pattern}</span>
                                <span className="font-mono text-slate-500">{c.date}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {analysis.vsaSignals.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                            Volume Spread Analysis (VSA)
                          </h4>
                          <div className="space-y-1">
                            {analysis.vsaSignals.slice(-5).reverse().map((v, idx) => (
                              <div
                                key={idx}
                                className="p-2 rounded border border-slate-100 dark:border-slate-800"
                              >
                                <div className="flex items-center justify-between font-semibold">
                                  <span>{v.kind}</span>
                                  <span className="font-mono text-slate-500">{v.date}</span>
                                </div>
                                <p className="text-slate-500 mt-0.5">{v.detail}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800 space-y-1">
                        <div className="flex items-center justify-between font-semibold">
                          <span>Wyckoff Phase (Experimental)</span>
                          <span className="text-purple-600 dark:text-purple-400">
                            {analysis.wyckoff.bias}
                          </span>
                        </div>
                        <div className="text-slate-600 dark:text-slate-300">
                          {analysis.wyckoff.regimePhase}
                        </div>
                        <p className="text-slate-500">{analysis.wyckoff.summary}</p>
                      </div>
                    </div>
                  )}

                  {/* TAB 4: BACKTEST & EOD LIMITS */}
                  {inspectorTab === 'backtest' && (
                    <div className="space-y-4">
                      {/* Hold-Out Backtest */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <BarChart2 className="w-3.5 h-3.5 text-blue-600" />
                            <span>Walk-Forward Hold-Out Backtest</span>
                          </h3>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          Simulates next-bar open entry, stop-first conservative collision, and NEPSE commissions + CGT over the latest 35% hold-out bars.
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={backtestLoading}
                            onClick={() => runBacktest('symbol')}
                            className="flex-1 px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium disabled:opacity-50"
                          >
                            {backtestLoading && backtestScope === 'symbol'
                              ? 'Running…'
                              : `Backtest ${symbol}`}
                          </button>
                          <button
                            type="button"
                            disabled={backtestLoading}
                            onClick={() => runBacktest('cohort')}
                            className="flex-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px] font-medium disabled:opacity-50"
                          >
                            {backtestLoading && backtestScope === 'cohort'
                              ? 'Running…'
                              : 'Backtest Liquid Cohort'}
                          </button>
                        </div>

                        {backtestError && (
                          <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-[11px]">
                            {backtestError}
                          </div>
                        )}

                        {backtestData && (
                          <div className="p-3 rounded border border-slate-200 dark:border-slate-800 space-y-2 font-mono text-[11px] tabular-nums">
                            <div className="flex items-center justify-between font-sans">
                              <span className="font-semibold">
                                {backtestData.symbol} · {backtestData.tf}
                              </span>
                              <span className="text-slate-500">
                                {backtestData.holdoutStartDate ?? '—'} → {backtestData.holdoutEndDate ?? '—'}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <span className="text-slate-500 block">Trades (Grade A/B)</span>
                                <span className="font-semibold">
                                  {backtestData.totalSetups} ({backtestData.gradeABSetups})
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500 block">Win Rate</span>
                                <span className="font-semibold">
                                  {backtestData.winRatePct !== null
                                    ? `${backtestData.winRatePct.toFixed(1)}%`
                                    : 'N/A'}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500 block">Avg Net / Trade</span>
                                <span
                                  className={`font-semibold ${
                                    (backtestData.avgNetReturnPct ?? 0) >= 0
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {backtestData.avgNetReturnPct !== null
                                    ? formatPct(backtestData.avgNetReturnPct)
                                    : 'N/A'}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500 block">Profit Factor / Max DD</span>
                                <span className="font-semibold">
                                  {backtestData.profitFactor ?? 'N/A'} /{' '}
                                  {backtestData.maxDrawdownPct !== null
                                    ? `${backtestData.maxDrawdownPct.toFixed(1)}%`
                                    : 'N/A'}
                                </span>
                              </div>
                            </div>
                            {backtestData.sampleTrades.length > 0 && (
                              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 max-h-40 overflow-y-auto">
                                {backtestData.sampleTrades.map((tr) => (
                                  <div
                                    key={tr.id}
                                    className="flex items-center justify-between text-[10px]"
                                  >
                                    <span className="font-sans truncate max-w-[145px]">
                                      {tr.entryDate} · {tr.setupName}
                                    </span>
                                    <span
                                      className={
                                        tr.netReturnPct >= 0
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : 'text-rose-600 dark:text-rose-400'
                                      }
                                    >
                                      {formatPct(tr.netReturnPct)} ({tr.rMultipleNet.toFixed(2)}R)
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <p className="font-sans text-[10px] text-slate-500">{backtestData.note}</p>
                          </div>
                        )}
                      </div>

                      {/* Honest EOD Limits Table */}
                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          <Info className="w-3.5 h-3.5 text-amber-600" />
                          <span>Honest Data Limits (End-of-Day Only)</span>
                        </h3>
                        <div className="space-y-1.5">
                          {analysis.eodLimits.map((lim, i) => (
                            <div
                              key={i}
                              className="p-2 rounded border border-slate-100 dark:border-slate-800 text-[11px]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  {lim.concept}
                                </span>
                                <span className="text-amber-600 dark:text-amber-400 font-mono text-[10px] shrink-0">
                                  {lim.status}
                                </span>
                              </div>
                              <div className="text-slate-500 mt-0.5">
                                EOD Proxy: {lim.eodEquivalent}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Required Footer Disclaimer */}
      <footer className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>Educational analysis on end-of-day data. Not investment advice.</span>
        <span className="font-mono">
          NEPSE Rules: ±10% Circuit · Tick NPR 0.10 · Long-Only Retail · Zero Look-Ahead Confirmed Swings
        </span>
      </footer>
    </div>
  );
};
