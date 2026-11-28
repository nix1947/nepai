import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import {
  Activity,
  ArrowUpRight,
  Camera,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Crosshair,
  Eye,
  EyeOff,
  GitCompare,
  Layers,
  Magnet,
  Maximize2,
  Minimize2,
  Minus,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Ruler,
  Search,
  SkipForward,
  Slash,
  SlidersHorizontal,
  Star,
  StickyNote,
  Target,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { PriceRow, SymbolInfo } from '../types/market';
import {
  calcAdLine,
  calcAdx,
  calcAlligator,
  calcAlma,
  calcAroon,
  calcAtrSeries,
  calcAwesomeOscillator,
  calcBbPercentB,
  calcBbWidth,
  calcBollinger,
  calcCamarillaPivots,
  calcCci,
  calcChaikinOscillator,
  calcClassicPivots,
  calcCmf,
  calcCmo,
  calcCoppock,
  calcDema,
  calcDonchian,
  calcDpo,
  calcEaseOfMovement,
  calcElderRay,
  calcEma,
  calcEnvelope,
  calcFibPivots,
  calcFisherTransform,
  calcForceIndex,
  calcHistoricalVolatility,
  calcHma,
  calcIchimoku,
  calcKama,
  calcKeltner,
  calcLinearRegressionChannel,
  calcMacd,
  calcMcGinley,
  calcMfi,
  calcMomentum,
  calcObv,
  calcParabolicSar,
  calcPpo,
  calcRoc,
  calcRollingVwap,
  calcRsi,
  calcSma,
  calcStochRsi,
  calcStochastic,
  calcSupertrend,
  calcTema,
  calcTrix,
  calcUltimateOscillator,
  calcVolumeOscillator,
  calcVortex,
  calcVpt,
  calcVwma,
  calcWilliamsR,
  calcWma,
  calcZigZag,
  resampleBars,
  toHeikinAshiCandles,
  type BarPoint,
  type ChartTimeframe,
} from '../utils/chartIndicators';
import { composeChartPngWithSvg, triggerPngDownload } from '../utils/chartExport';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';
import { InfoTip } from './InfoTip';

export interface TradingViewChartHandle {
  exportPng: () => Promise<void>;
}

export interface ChartLevel {
  label: string;
  value: number;
  color: string;
}

type ChartStyle = 'candles' | 'hollow' | 'heikin' | 'bars' | 'area' | 'line';
type ZoomRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';
type ScaleMode = 'normal' | 'percent' | 'log';
type DrawTool =
  | 'cursor'
  | 'trend'
  | 'ray'
  | 'hline'
  | 'vline'
  | 'fib'
  | 'long'
  | 'measure'
  | 'note';

type DrawingKind = Exclude<DrawTool, 'cursor'>;

type IndicatorId =
  | 'vol'
  | 'smaN'
  | 'sma20'
  | 'sma50'
  | 'sma200'
  | 'ema9'
  | 'ema20'
  | 'ema50'
  | 'ema200'
  | 'wma20'
  | 'hma20'
  | 'dema20'
  | 'tema20'
  | 'kama'
  | 'vwma20'
  | 'alma9'
  | 'mcginley'
  | 'emaRibbon'
  | 'bb'
  | 'keltner'
  | 'donchian'
  | 'envelope'
  | 'supertrend'
  | 'psar'
  | 'ichimoku'
  | 'alligator'
  | 'rvwap'
  | 'vwap'
  | 'ma120'
  | 'pivots'
  | 'fibPivots'
  | 'camPivots'
  | 'linreg'
  | 'zigzag'
  | 'rsi'
  | 'stochRsi'
  | 'macd'
  | 'ppo'
  | 'stoch'
  | 'adx'
  | 'atr'
  | 'bbw'
  | 'bbPctB'
  | 'hvol'
  | 'cci'
  | 'willr'
  | 'mfi'
  | 'ao'
  | 'roc'
  | 'mom'
  | 'trix'
  | 'uo'
  | 'cmo'
  | 'dpo'
  | 'aroon'
  | 'coppock'
  | 'vortex'
  | 'elder'
  | 'fisher'
  | 'obv'
  | 'cmf'
  | 'adLine'
  | 'chaikinOsc'
  | 'force'
  | 'eom'
  | 'volOsc'
  | 'vpt';

type IndicatorCategory =
  | 'Trend & MAs'
  | 'Bands & Channels'
  | 'Volatility & Pivots'
  | 'Momentum & Oscillators'
  | 'Volume & Flow';

interface IndicatorMeta {
  id: IndicatorId;
  label: string;
  shortLabel: string;
  category: IndicatorCategory;
  pane: 'Overlay' | 'Oscillator';
  desc: string;
}

interface SavedDrawing {
  id: string;
  kind: DrawingKind;
  p1: { time: string; price: number };
  p2?: { time: string; price: number };
  text?: string;
}

interface TradingViewChartProps {
  symbol: string;
  history: PriceRow[];
  lookbackDays: number;
  levels?: ChartLevel[];
  showSR?: boolean;
  onToggleSR?: (next: boolean) => void;
  symbols?: SymbolInfo[];
  onSelectSymbol?: (sym: string) => void;
  watchlist?: string[];
  isStarred?: boolean;
  onToggleStar?: () => void;
}

const DRAWINGS_STORAGE_KEY_V2 = 'nepse.chart.drawings.v2';
const DRAWINGS_STORAGE_KEY_V1 = 'nepse.chart.drawings.v1';
const INDICATORS_STORAGE_KEY = 'nepse.chart.indicators.v1';

const DEFAULT_INDICATORS: Record<IndicatorId, boolean> = {
  vol: true,
  smaN: true,
  sma20: false,
  sma50: false,
  sma200: false,
  ema9: false,
  ema20: false,
  ema50: false,
  ema200: false,
  wma20: false,
  hma20: false,
  dema20: false,
  tema20: false,
  kama: false,
  vwma20: false,
  alma9: false,
  mcginley: false,
  emaRibbon: false,
  bb: false,
  keltner: false,
  donchian: false,
  envelope: false,
  supertrend: false,
  psar: false,
  ichimoku: false,
  alligator: false,
  rvwap: false,
  vwap: false,
  ma120: true,
  pivots: false,
  fibPivots: false,
  camPivots: false,
  linreg: false,
  zigzag: false,
  rsi: true,
  stochRsi: false,
  macd: false,
  ppo: false,
  stoch: false,
  adx: false,
  atr: false,
  bbw: false,
  bbPctB: false,
  hvol: false,
  cci: false,
  willr: false,
  mfi: false,
  ao: false,
  roc: false,
  mom: false,
  trix: false,
  uo: false,
  cmo: false,
  dpo: false,
  aroon: false,
  coppock: false,
  vortex: false,
  elder: false,
  fisher: false,
  obv: false,
  cmf: false,
  adLine: false,
  chaikinOsc: false,
  force: false,
  eom: false,
  volOsc: false,
  vpt: false,
};

const INDICATOR_PRESETS: Array<{
  id: string;
  label: string;
  ids: IndicatorId[];
}> = [
  { id: 'default', label: 'Default', ids: ['vol', 'smaN', 'ma120', 'rsi'] },
  {
    id: 'trend',
    label: 'Trend Pro',
    ids: ['vol', 'ema9', 'ema20', 'ema50', 'sma200', 'supertrend', 'macd', 'adx'],
  },
  {
    id: 'swing',
    label: 'Swing & RSI',
    ids: ['vol', 'ema20', 'bb', 'rsi', 'stoch', 'cci', 'mfi'],
  },
  {
    id: 'ichimoku',
    label: 'Ichimoku Cloud',
    ids: ['vol', 'ichimoku', 'psar', 'rsi', 'cmf'],
  },
  {
    id: 'quant',
    label: 'Quant Volatility',
    ids: ['vol', 'kama', 'keltner', 'linreg', 'bbw', 'hvol', 'fisher'],
  },
  {
    id: 'volume',
    label: 'Volume Flow',
    ids: ['vol', 'vwap', 'rvwap', 'vwma20', 'obv', 'cmf', 'chaikinOsc', 'volOsc'],
  },
  { id: 'clear', label: 'Clear All', ids: [] },
];

const FIB_RATIOS = [
  { ratio: 0, label: '0.0%', color: '#64748b' },
  { ratio: 0.236, label: '23.6%', color: '#0ea5e9' },
  { ratio: 0.382, label: '38.2%', color: '#10b981' },
  { ratio: 0.5, label: '50.0%', color: '#f59e0b' },
  { ratio: 0.618, label: '61.8%', color: '#2563eb' },
  { ratio: 0.786, label: '78.6%', color: '#8b5cf6' },
  { ratio: 1, label: '100%', color: '#ef4444' },
];

function loadSavedIndicators(): Record<IndicatorId, boolean> {
  try {
    const raw = localStorage.getItem(INDICATORS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_INDICATORS };
    const parsed = JSON.parse(raw) as Partial<Record<IndicatorId, boolean>>;
    return { ...DEFAULT_INDICATORS, ...parsed };
  } catch {
    return { ...DEFAULT_INDICATORS };
  }
}

function loadDrawingsForSymbol(symbol: string): SavedDrawing[] {
  try {
    const rawV2 = localStorage.getItem(DRAWINGS_STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Record<string, SavedDrawing[]>;
      if (Array.isArray(parsed[symbol])) return parsed[symbol];
    }
    const rawV1 = localStorage.getItem(DRAWINGS_STORAGE_KEY_V1);
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as Record<string, SavedDrawing[]>;
      if (Array.isArray(parsed[symbol])) return parsed[symbol];
    }
    return [];
  } catch {
    return [];
  }
}

function saveDrawingsForSymbol(symbol: string, list: SavedDrawing[]): void {
  try {
    const raw = localStorage.getItem(DRAWINGS_STORAGE_KEY_V2);
    const parsed = raw ? (JSON.parse(raw) as Record<string, SavedDrawing[]>) : {};
    parsed[symbol] = list;
    localStorage.setItem(DRAWINGS_STORAGE_KEY_V2, JSON.stringify(parsed));
  } catch {
    // ignore storage quota errors
  }
}

function snapPriceToBar(bar: BarPoint | undefined, rawPrice: number): number {
  if (!bar) return Number(rawPrice.toFixed(2));
  const candidates = [bar.open, bar.high, bar.low, bar.close];
  let best = candidates[0];
  let bestDist = Math.abs(rawPrice - best);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(rawPrice - candidates[i]);
    if (d < bestDist) {
      best = candidates[i];
      bestDist = d;
    }
  }
  return Number(best.toFixed(2));
}

export const TradingViewChart = forwardRef<TradingViewChartHandle, TradingViewChartProps>(({
  symbol,
  history,
  lookbackDays,
  levels = [],
  showSR = true,
  onToggleSR,
  symbols = [],
  onSelectSymbol,
  watchlist = [],
  isStarred = false,
  onToggleStar,
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const svgOverlayRef = useRef<SVGSVGElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<SeriesType, Time> | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chartStyle, setChartStyle] = useState<ChartStyle>('candles');
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1D');
  const [zoom, setZoom] = useState<ZoomRange>('ALL');
  const [scaleMode, setScaleMode] = useState<ScaleMode>('normal');
  const [showGrid, setShowGrid] = useState(true);
  const [show52wLines, setShow52wLines] = useState(false);

  const [enabled, setEnabled] = useState<Record<IndicatorId, boolean>>(loadSavedIndicators);

  // Popovers & Advanced Modes
  const [indicatorsModalOpen, setIndicatorsModalOpen] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState('');
  const [indicatorCategory, setIndicatorCategory] = useState<'All' | IndicatorCategory>('All');
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [compareSearch, setCompareSearch] = useState('');
  const [compareSymbol, setCompareSymbol] = useState<string | null>(null);
  const [compareHistory, setCompareHistory] = useState<PriceRow[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);

  // Bar Replay
  const [replayMode, setReplayMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeedMs, setReplaySpeedMs] = useState(700);
  const [replayPickPending, setReplayPickPending] = useState(false);

  // Drawings
  const [drawTool, setDrawTool] = useState<DrawTool>('cursor');
  const [magnetMode, setMagnetMode] = useState(false);
  const [hideDrawings, setHideDrawings] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<{ time: string; price: number } | null>(null);
  const [pendingNoteAnchor, setPendingNoteAnchor] = useState<{ time: string; price: number } | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [drawings, setDrawings] = useState<SavedDrawing[]>(() => loadDrawingsForSymbol(symbol));
  const [renderTick, setRenderTick] = useState(0);
  const [hovered, setHovered] = useState<BarPoint | null>(null);
  const [fsSearch, setFsSearch] = useState('');

  const drawToolRef = useRef<DrawTool>(drawTool);
  drawToolRef.current = drawTool;
  const magnetModeRef = useRef<boolean>(magnetMode);
  magnetModeRef.current = magnetMode;
  const pendingPointRef = useRef(pendingPoint);
  pendingPointRef.current = pendingPoint;
  const replayPickPendingRef = useRef(replayPickPending);
  replayPickPendingRef.current = replayPickPending;

  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );

  const toggleInd = useCallback((id: IndicatorId) => {
    setEnabled((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const applyPreset = useCallback((ids: IndicatorId[]) => {
    const next: Record<IndicatorId, boolean> = { ...DEFAULT_INDICATORS };
    for (const k of Object.keys(next) as IndicatorId[]) next[k] = false;
    for (const id of ids) next[id] = true;
    setEnabled(next);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(INDICATORS_STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // ignore storage quota errors
    }
  }, [enabled]);

  useEffect(() => {
    setDrawings(loadDrawingsForSymbol(symbol));
    setPendingPoint(null);
    setPendingNoteAnchor(null);
    setReplayMode(false);
    setReplayPlaying(false);
    setReplayIndex(null);
    setReplayPickPending(false);
    if (compareSymbol === symbol) {
      setCompareSymbol(null);
      setCompareHistory([]);
    }
  }, [symbol, compareSymbol]);

  useEffect(() => {
    saveDrawingsForSymbol(symbol, drawings);
  }, [symbol, drawings]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!compareSymbol) {
      setCompareHistory([]);
      return;
    }
    let cancelled = false;
    setCompareLoading(true);
    fetch(`/api/symbol/${encodeURIComponent(compareSymbol)}`)
      .then((r) => r.json())
      .then((data: { history?: PriceRow[] }) => {
        if (!cancelled) {
          setCompareHistory(Array.isArray(data.history) ? data.history : []);
        }
      })
      .catch(() => {
        if (!cancelled) setCompareHistory([]);
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compareSymbol]);

  const fullBars = useMemo(() => resampleBars(history, timeframe), [history, timeframe]);

  const visibleBars = useMemo(() => {
    if (!replayMode || replayIndex === null) return fullBars;
    const clamped = Math.max(2, Math.min(fullBars.length, replayIndex + 1));
    return fullBars.slice(0, clamped);
  }, [fullBars, replayMode, replayIndex]);

  const compareBars = useMemo(
    () => (compareSymbol && compareHistory.length > 0 ? resampleBars(compareHistory, timeframe) : []),
    [compareSymbol, compareHistory, timeframe]
  );

  useEffect(() => {
    if (!replayMode || !replayPlaying) return;
    const id = window.setInterval(() => {
      setReplayIndex((prev) => {
        const cur = prev ?? Math.max(1, Math.floor(fullBars.length * 0.7));
        if (cur >= fullBars.length - 1) {
          setReplayPlaying(false);
          return fullBars.length - 1;
        }
        return cur + 1;
      });
    }, replaySpeedMs);
    return () => window.clearInterval(id);
  }, [replayMode, replayPlaying, replaySpeedMs, fullBars.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingNoteAnchor) {
          setPendingNoteAnchor(null);
          setNoteDraft('');
        } else if (indicatorsModalOpen) {
          setIndicatorsModalOpen(false);
        } else if (compareModalOpen) {
          setCompareModalOpen(false);
        } else if (pendingPointRef.current) {
          setPendingPoint(null);
        } else if (drawToolRef.current !== 'cursor') {
          setDrawTool('cursor');
        } else if (replayPickPendingRef.current) {
          setReplayPickPending(false);
        } else if (isFullscreen) {
          setIsFullscreen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen, indicatorsModalOpen, compareModalOpen, pendingNoteAnchor]);

  const barMap = useMemo(() => {
    const m = new Map<string, BarPoint>();
    for (const b of visibleBars) m.set(b.time, b);
    return m;
  }, [visibleBars]);

  const barIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    visibleBars.forEach((b, i) => m.set(b.time, i));
    return m;
  }, [visibleBars]);

  const latestBar = visibleBars[visibleBars.length - 1] ?? null;
  const activeBar = hovered ?? latestBar;
  const latestRaw = history[history.length - 1] ?? null;

  // Core Snapshot Indicators (always computed for live TA Snapshot + Consensus Gauge)
  const rsiData = useMemo(() => calcRsi(visibleBars, 14), [visibleBars]);
  const macdData = useMemo(() => calcMacd(visibleBars), [visibleBars]);
  const stochData = useMemo(() => calcStochastic(visibleBars, 14, 3, 3), [visibleBars]);
  const adxData = useMemo(() => calcAdx(visibleBars, 14), [visibleBars]);
  const atrSeries = useMemo(() => calcAtrSeries(visibleBars, 14), [visibleBars]);
  const supertrendData = useMemo(() => calcSupertrend(visibleBars, 10, 3), [visibleBars]);
  const ichimokuData = useMemo(() => calcIchimoku(visibleBars, 9, 26, 52), [visibleBars]);
  const cciData = useMemo(() => calcCci(visibleBars, 20), [visibleBars]);
  const mfiData = useMemo(() => calcMfi(visibleBars, 14), [visibleBars]);
  const willrData = useMemo(() => calcWilliamsR(visibleBars, 14), [visibleBars]);
  const cmfData = useMemo(() => calcCmf(visibleBars, 20), [visibleBars]);
  const ema20Data = useMemo(() => calcEma(visibleBars, 20), [visibleBars]);
  const ema50Data = useMemo(() => calcEma(visibleBars, 50), [visibleBars]);
  const pivotLevels = useMemo(() => calcClassicPivots(visibleBars), [visibleBars]);

  const latestRsi = rsiData[rsiData.length - 1]?.value ?? null;
  const latestAtr = atrSeries[atrSeries.length - 1]?.value ?? null;
  const latestMacd = macdData.macd[macdData.macd.length - 1]?.value ?? null;
  const latestMacdSig = macdData.signal[macdData.signal.length - 1]?.value ?? null;
  const latestStochK = stochData.k[stochData.k.length - 1]?.value ?? null;
  const latestStochD = stochData.d[stochData.d.length - 1]?.value ?? null;
  const latestAdx = adxData.adx[adxData.adx.length - 1]?.value ?? null;
  const latestPlusDi = adxData.plusDi[adxData.plusDi.length - 1]?.value ?? null;
  const latestMinusDi = adxData.minusDi[adxData.minusDi.length - 1]?.value ?? null;
  const latestCci = cciData[cciData.length - 1]?.value ?? null;
  const latestMfi = mfiData[mfiData.length - 1]?.value ?? null;
  const latestWillr = willrData[willrData.length - 1]?.value ?? null;
  const latestCmf = cmfData[cmfData.length - 1]?.value ?? null;

  // Consensus Signal Summary across 10 core studies
  const technicalConsensus = useMemo(() => {
    let bull = 0;
    let bear = 0;
    let neut = 0;
    const vote = (condBull: boolean, condBear: boolean) => {
      if (condBull) bull++;
      else if (condBear) bear++;
      else neut++;
    };

    if (latestRsi !== null) vote(latestRsi > 52 && latestRsi < 75, latestRsi < 48 && latestRsi > 25);
    if (latestMacd !== null && latestMacdSig !== null) vote(latestMacd > latestMacdSig, latestMacd < latestMacdSig);
    if (latestStochK !== null && latestStochD !== null) vote(latestStochK > latestStochD && latestStochK < 85, latestStochK < latestStochD && latestStochK > 15);
    if (latestCci !== null) vote(latestCci > 50, latestCci < -50);
    if (latestMfi !== null) vote(latestMfi > 52 && latestMfi < 80, latestMfi < 48 && latestMfi > 20);
    if (latestWillr !== null) vote(latestWillr > -45 && latestWillr < -15, latestWillr < -55 && latestWillr > -85);
    if (latestAdx !== null && latestPlusDi !== null && latestMinusDi !== null && latestAdx >= 18) {
      vote(latestPlusDi > latestMinusDi, latestMinusDi > latestPlusDi);
    } else if (latestAdx !== null) {
      neut++;
    }
    if (supertrendData.latestTrend) vote(supertrendData.latestTrend === 'bullish', supertrendData.latestTrend === 'bearish');
    if (ichimokuData.latestSignal) vote(ichimokuData.latestSignal === 'bullish', ichimokuData.latestSignal === 'bearish');
    const e20 = ema20Data[ema20Data.length - 1]?.value;
    const e50 = ema50Data[ema50Data.length - 1]?.value;
    if (e20 !== undefined && e50 !== undefined && latestBar) {
      vote(latestBar.close > e20 && e20 > e50, latestBar.close < e20 && e20 < e50);
    }

    const net = bull - bear;
    const verdict =
      net >= 5
        ? 'Strong Buy'
        : net >= 2
          ? 'Buy'
          : net <= -5
            ? 'Strong Sell'
            : net <= -2
              ? 'Sell'
              : 'Neutral';

    return { bull, bear, neut, verdict };
  }, [
    ema20Data,
    ema50Data,
    ichimokuData.latestSignal,
    latestAdx,
    latestBar,
    latestCci,
    latestMacd,
    latestMacdSig,
    latestMfi,
    latestMinusDi,
    latestPlusDi,
    latestRsi,
    latestStochD,
    latestStochK,
    latestWillr,
    supertrendData.latestTrend,
  ]);

  const volAnalysis = useMemo(() => {
    if (history.length === 0) return null;
    const win = history.slice(-lookbackDays);
    const avgVol = win.reduce((s, r) => s + r.volume, 0) / Math.max(1, win.length);
    const avgTurn = win.reduce((s, r) => s + r.turnover, 0) / Math.max(1, win.length);
    const upVol = win.filter((r) => r.diff > 0).reduce((s, r) => s + r.volume, 0);
    const dnVol = win.filter((r) => r.diff < 0).reduce((s, r) => s + r.volume, 0);
    const last = history[history.length - 1];
    return {
      avgVol,
      avgTurn,
      volMult: avgVol > 0 ? last.volume / avgVol : 1,
      turnMult: avgTurn > 0 ? last.turnover / avgTurn : 1,
      upDownRatio: upVol / Math.max(1, dnVol),
    };
  }, [history, lookbackDays]);

  const indicatorCatalog: IndicatorMeta[] = useMemo(
    () => [
      // Trend & MAs (Overlays)
      { id: 'smaN', label: `SMA (${lookbackDays})`, shortLabel: `SMA(${lookbackDays})`, category: 'Trend & MAs', pane: 'Overlay', desc: `${lookbackDays}-period simple moving average` },
      { id: 'sma20', label: 'SMA (20)', shortLabel: 'SMA(20)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Short-term 20-period simple moving average' },
      { id: 'sma50', label: 'SMA (50)', shortLabel: 'SMA(50)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Institutional 50-period simple moving average' },
      { id: 'sma200', label: 'SMA (200)', shortLabel: 'SMA(200)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Long-term 200-period secular trend baseline' },
      { id: 'ema9', label: 'EMA (9)', shortLabel: 'EMA(9)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Fast 9-period exponential trendline' },
      { id: 'ema20', label: 'EMA (20)', shortLabel: 'EMA(20)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Swing 20-period exponential average' },
      { id: 'ema50', label: 'EMA (50)', shortLabel: 'EMA(50)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Medium-term 50-period institutional EMA' },
      { id: 'ema200', label: 'EMA (200)', shortLabel: 'EMA(200)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Macro 200-period exponential trendline' },
      { id: 'wma20', label: 'WMA (20)', shortLabel: 'WMA(20)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Linearly weighted moving average emphasizing recent closes' },
      { id: 'hma20', label: 'Hull MA (20)', shortLabel: 'HMA(20)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Ultra-smooth zero-lag Hull moving average' },
      { id: 'dema20', label: 'DEMA (20)', shortLabel: 'DEMA(20)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Double Exponential Moving Average for faster trend turns' },
      { id: 'tema20', label: 'TEMA (20)', shortLabel: 'TEMA(20)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Triple Exponential Moving Average reducing lag further' },
      { id: 'kama', label: 'KAMA (10, 2, 30)', shortLabel: 'KAMA', category: 'Trend & MAs', pane: 'Overlay', desc: 'Kaufman Adaptive MA adjusting speed to trend noise' },
      { id: 'alma9', label: 'ALMA (9, 0.85, 6)', shortLabel: 'ALMA(9)', category: 'Trend & MAs', pane: 'Overlay', desc: 'Arnaud Legoux Gaussian-weighted moving average' },
      { id: 'mcginley', label: 'McGinley Dynamic (14)', shortLabel: 'McGinley', category: 'Trend & MAs', pane: 'Overlay', desc: 'Self-adjusting trend follower minimizing whipsaws' },
      { id: 'emaRibbon', label: 'EMA Ribbon (8/13/21/34/55)', shortLabel: 'Ribbon', category: 'Trend & MAs', pane: 'Overlay', desc: 'Multi-line Fibonacci EMA ribbon visualizing momentum expansion' },
      { id: 'ma120', label: 'MA 120 / 180 (1D)', shortLabel: 'MA120/180', category: 'Trend & MAs', pane: 'Overlay', desc: 'ShareSansar 120-day & 180-day moving averages' },
      { id: 'supertrend', label: 'Supertrend (10, 3)', shortLabel: 'Supertrend', category: 'Trend & MAs', pane: 'Overlay', desc: 'ATR trailing trend flip & dynamic stop line' },
      { id: 'psar', label: 'Parabolic SAR (0.02, 0.2)', shortLabel: 'PSAR', category: 'Trend & MAs', pane: 'Overlay', desc: 'Stop-and-reverse trailing dot system' },
      { id: 'ichimoku', label: 'Ichimoku Cloud (9, 26, 52)', shortLabel: 'Ichimoku', category: 'Trend & MAs', pane: 'Overlay', desc: 'Tenkan, Kijun, Senkou Span A/B & Chikou Span' },
      { id: 'alligator', label: 'Williams Alligator (13, 8, 5)', shortLabel: 'Alligator', category: 'Trend & MAs', pane: 'Overlay', desc: 'Jaw, Teeth & Lips smoothed SMMA trend lines' },
      { id: 'zigzag', label: 'ZigZag Swing Structure (5%)', shortLabel: 'ZigZag 5%', category: 'Trend & MAs', pane: 'Overlay', desc: 'Connects >=5% swing highs and lows to clarify market structure' },

      // Bands & Channels (Overlays)
      { id: 'bb', label: 'Bollinger Bands (20, 2)', shortLabel: 'BB(20,2)', category: 'Bands & Channels', pane: 'Overlay', desc: 'Upper, Basis SMA(20), and Lower 2-sigma volatility bands' },
      { id: 'keltner', label: 'Keltner Channels (20, 2)', shortLabel: 'Keltner', category: 'Bands & Channels', pane: 'Overlay', desc: 'EMA(20) ± 2×ATR(10) volatility envelope' },
      { id: 'donchian', label: 'Donchian Channels (20)', shortLabel: 'Donchian', category: 'Bands & Channels', pane: 'Overlay', desc: '20-bar highest high, midpoint & lowest low turtle bands' },
      { id: 'envelope', label: 'Price Envelope (20, ±5%)', shortLabel: 'Envelope', category: 'Bands & Channels', pane: 'Overlay', desc: 'Fixed ±5% percentage channel around SMA(20)' },
      { id: 'linreg', label: 'Linear Regression Channel (50)', shortLabel: 'LinReg(50)', category: 'Bands & Channels', pane: 'Overlay', desc: 'Least-squares trend midline with ±2 standard error bands' },

      // Volatility & Pivots
      { id: 'pivots', label: 'Pivot Points (Classic R3–S3)', shortLabel: 'Pivots', category: 'Volatility & Pivots', pane: 'Overlay', desc: 'PP, R1–R3, S1–S3 derived from previous completed session' },
      { id: 'fibPivots', label: 'Fibonacci Pivot Points', shortLabel: 'Fib Pivots', category: 'Volatility & Pivots', pane: 'Overlay', desc: '0.382 / 0.618 / 1.000 Fibonacci pivot support & resistance' },
      { id: 'camPivots', label: 'Camarilla Pivots (H3/H4/L3/L4)', shortLabel: 'Camarilla', category: 'Volatility & Pivots', pane: 'Overlay', desc: 'Tight breakout/mean-reversion Camarilla zones' },
      { id: 'atr', label: 'ATR (14)', shortLabel: 'ATR(14)', category: 'Volatility & Pivots', pane: 'Oscillator', desc: 'Average True Range volatility pane in NPR' },
      { id: 'bbw', label: 'Bollinger BandWidth (%)', shortLabel: 'BBWidth', category: 'Volatility & Pivots', pane: 'Oscillator', desc: 'Measures band squeeze compression prior to breakouts' },
      { id: 'bbPctB', label: 'Bollinger %B', shortLabel: 'BB %B', category: 'Volatility & Pivots', pane: 'Oscillator', desc: 'Price location within Bollinger Bands (0 = lower, 1 = upper)' },
      { id: 'hvol', label: 'Historical Volatility (20)', shortLabel: 'HistVol', category: 'Volatility & Pivots', pane: 'Oscillator', desc: 'Annualized 20-bar log-return volatility (%)' },

      // Momentum & Oscillators
      { id: 'rsi', label: 'RSI (14)', shortLabel: 'RSI(14)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Relative Strength Index with 70/30 thresholds' },
      { id: 'stochRsi', label: 'Stochastic RSI (14, 14, 3, 3)', shortLabel: 'StochRSI', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Fast %K/%D oscillator applied to RSI for early turns' },
      { id: 'macd', label: 'MACD (12, 26, 9)', shortLabel: 'MACD', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Trend momentum convergence/divergence & histogram' },
      { id: 'ppo', label: 'PPO (12, 26, 9)', shortLabel: 'PPO', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Percentage Price Oscillator (scale-free MACD in %)' },
      { id: 'stoch', label: 'Stochastic (14, 3, 3)', shortLabel: 'Stoch(14)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: '%K / %D momentum oscillator with 80/20 zones' },
      { id: 'adx', label: 'ADX / DMI (14)', shortLabel: 'ADX(14)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Trend strength (ADX) + directional +DI / -DI' },
      { id: 'cci', label: 'CCI (20)', shortLabel: 'CCI(20)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Commodity Channel Index with ±100 extreme levels' },
      { id: 'willr', label: 'Williams %R (14)', shortLabel: 'W%R(14)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Overbought (-20) & oversold (-80) range momentum' },
      { id: 'ao', label: 'Awesome Oscillator (5, 34)', shortLabel: 'AO', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Bill Williams 5/34 midpoint momentum histogram' },
      { id: 'roc', label: 'Rate of Change — ROC (12)', shortLabel: 'ROC(12)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: '12-bar percentage velocity around zero line' },
      { id: 'mom', label: 'Momentum (10)', shortLabel: 'MOM(10)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: '10-bar net NPR price change oscillator' },
      { id: 'trix', label: 'TRIX (15)', shortLabel: 'TRIX(15)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Triple-smoothed EMA rate-of-change trend filter' },
      { id: 'uo', label: 'Ultimate Oscillator (7, 14, 28)', shortLabel: 'UO', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Multi-horizon weighted buying pressure (70/30)' },
      { id: 'cmo', label: 'Chande Momentum — CMO (14)', shortLabel: 'CMO(14)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Un-smoothed up/down momentum between -100 and +100' },
      { id: 'dpo', label: 'Detrended Price Osc (20)', shortLabel: 'DPO(20)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Isolates short-term cycles by removing trend' },
      { id: 'aroon', label: 'Aroon Up / Down (25)', shortLabel: 'Aroon(25)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Measures time since 25-bar high vs 25-bar low' },
      { id: 'coppock', label: 'Coppock Curve (14, 11, 10)', shortLabel: 'Coppock', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Long-term trend reversal & bottoming histogram' },
      { id: 'vortex', label: 'Vortex Indicator (14)', shortLabel: 'Vortex', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'VI+ vs VI- directional trend crossovers' },
      { id: 'elder', label: 'Elder Ray Bull/Bear (13)', shortLabel: 'Elder Ray', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Buying & selling power relative to EMA(13)' },
      { id: 'fisher', label: 'Fisher Transform (10)', shortLabel: 'Fisher(10)', category: 'Momentum & Oscillators', pane: 'Oscillator', desc: 'Gaussian price normalization highlighting sharp reversals' },

      // Volume & Flow
      { id: 'vol', label: 'Volume', shortLabel: 'Volume', category: 'Volume & Flow', pane: 'Overlay', desc: 'Session share volume histogram' },
      { id: 'vwap', label: 'Session VWAP (1D)', shortLabel: 'VWAP', category: 'Volume & Flow', pane: 'Overlay', desc: 'Daily volume-weighted average execution price' },
      { id: 'rvwap', label: 'Rolling VWAP (20)', shortLabel: 'RVWAP(20)', category: 'Volume & Flow', pane: 'Overlay', desc: '20-bar cumulative turnover/volume anchor (1D/1W/1M)' },
      { id: 'vwma20', label: 'VWMA (20)', shortLabel: 'VWMA(20)', category: 'Volume & Flow', pane: 'Overlay', desc: 'Volume-weighted moving average giving heavy-volume days more weight' },
      { id: 'mfi', label: 'Money Flow Index — MFI (14)', shortLabel: 'MFI(14)', category: 'Volume & Flow', pane: 'Oscillator', desc: 'Volume-weighted RSI with 80/20 overbought/oversold thresholds' },
      { id: 'obv', label: 'On-Balance Volume (OBV)', shortLabel: 'OBV', category: 'Volume & Flow', pane: 'Oscillator', desc: 'Cumulative directional volume flow' },
      { id: 'cmf', label: 'Chaikin Money Flow (20)', shortLabel: 'CMF(20)', category: 'Volume & Flow', pane: 'Oscillator', desc: 'Accumulation/distribution pressure between -1 and +1' },
      { id: 'adLine', label: 'Accumulation / Distribution Line', shortLabel: 'A/D Line', category: 'Volume & Flow', pane: 'Oscillator', desc: 'Cumulative close-location-weighted volume flow' },
      { id: 'chaikinOsc', label: 'Chaikin Oscillator (3, 10)', shortLabel: 'ChaikinOsc', category: 'Volume & Flow', pane: 'Oscillator', desc: 'EMA(3) - EMA(10) momentum of A/D Line' },
      { id: 'force', label: 'Elder Force Index (13)', shortLabel: 'Force(13)', category: 'Volume & Flow', pane: 'Oscillator', desc: 'Price change × volume smoothed by 13-period EMA' },
      { id: 'eom', label: 'Ease of Movement (14)', shortLabel: 'EOM(14)', category: 'Volume & Flow', pane: 'Oscillator', desc: 'Price movement relative to share volume' },
      { id: 'volOsc', label: 'Volume Oscillator (5, 20)', shortLabel: 'VolOsc', category: 'Volume & Flow', pane: 'Oscillator', desc: '% spread between 5-bar and 20-bar volume SMAs' },
      { id: 'vpt', label: 'Volume Price Trend (VPT)', shortLabel: 'VPT', category: 'Volume & Flow', pane: 'Oscillator', desc: 'Cumulative percentage-return-weighted volume' },
    ],
    [lookbackDays]
  );

  const subpaneIds: IndicatorId[] = useMemo(
    () => indicatorCatalog.filter((i) => i.pane === 'Oscillator').map((i) => i.id),
    [indicatorCatalog]
  );

  const activePaneCount = useMemo(
    () => subpaneIds.reduce((cnt, id) => cnt + (enabled[id] ? 1 : 0), 0),
    [enabled, subpaneIds]
  );

  const activeIndicatorList = useMemo(
    () => indicatorCatalog.filter((i) => enabled[i.id]),
    [enabled, indicatorCatalog]
  );

  const filteredIndicators = useMemo(() => {
    const q = indicatorSearch.trim().toLowerCase();
    return indicatorCatalog.filter((i) => {
      if (indicatorCategory !== 'All' && i.category !== indicatorCategory) return false;
      if (!q) return true;
      return (
        i.label.toLowerCase().includes(q) ||
        i.shortLabel.toLowerCase().includes(q) ||
        i.desc.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    });
  }, [indicatorCatalog, indicatorCategory, indicatorSearch]);

  const triggerOverlaySync = useCallback(() => {
    setRenderTick((t) => (t + 1) % 1000000);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || visibleBars.length === 0) return;

    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = showGrid
      ? isDark
        ? 'rgba(51, 65, 85, 0.35)'
        : 'rgba(226, 232, 240, 0.85)'
      : 'transparent';
    const borderColor = isDark ? '#1e293b' : '#e2e8f0';
    const bg = isDark ? '#0b1220' : '#ffffff';

    const subPaneHeight = activePaneCount <= 3 ? 86 : activePaneCount <= 6 ? 72 : 62;
    const defaultInlineH = 420 + activePaneCount * subPaneHeight;
    const initialH = isFullscreen
      ? Math.max(460, chartWrapRef.current?.clientHeight || window.innerHeight - 155)
      : defaultInlineH;

    const effectivePriceScaleMode =
      scaleMode === 'percent' || (compareSymbol && compareBars.length > 0 && scaleMode === 'normal')
        ? PriceScaleMode.Percentage
        : scaleMode === 'log'
          ? PriceScaleMode.Logarithmic
          : PriceScaleMode.Normal;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: initialH,
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor,
        mode: effectivePriceScaleMode,
        scaleMargins: {
          top: 0.08,
          bottom: enabled.vol ? 0.24 : 0.06,
        },
      },
      timeScale: {
        borderColor,
        timeVisible: false,
        rightOffset: 6,
      },
    });
    chartRef.current = chart;

    // Main Price Series
    let mainSeries: ISeriesApi<SeriesType, Time>;
    if (chartStyle === 'bars') {
      const s = chart.addSeries(
        BarSeries,
        { upColor: '#10b981', downColor: '#ef4444', thinBars: false },
        0
      );
      s.setData(
        visibleBars.map((b) => ({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
      mainSeries = s;
    } else if (chartStyle === 'area') {
      const s = chart.addSeries(
        AreaSeries,
        {
          lineColor: '#2563eb',
          lineWidth: 2,
          topColor: isDark ? 'rgba(37, 99, 235, 0.32)' : 'rgba(37, 99, 235, 0.24)',
          bottomColor: isDark ? 'rgba(37, 99, 235, 0.02)' : 'rgba(37, 99, 235, 0.01)',
        },
        0
      );
      s.setData(visibleBars.map((b) => ({ time: b.time as Time, value: b.close })));
      mainSeries = s;
    } else if (chartStyle === 'line') {
      const s = chart.addSeries(LineSeries, { color: '#2563eb', lineWidth: 2 }, 0);
      s.setData(visibleBars.map((b) => ({ time: b.time as Time, value: b.close })));
      mainSeries = s;
    } else {
      const isHollow = chartStyle === 'hollow';
      const s = chart.addSeries(
        CandlestickSeries,
        {
          upColor: isHollow ? 'transparent' : '#10b981',
          downColor: '#ef4444',
          borderUpColor: '#10b981',
          borderDownColor: '#ef4444',
          wickUpColor: '#10b981',
          wickDownColor: '#ef4444',
        },
        0
      );
      const candleData: CandlestickData<Time>[] =
        chartStyle === 'heikin'
          ? toHeikinAshiCandles(visibleBars)
          : visibleBars.map((b) => ({
              time: b.time as Time,
              open: b.open,
              high: b.high,
              low: b.low,
              close: b.close,
            }));
      s.setData(candleData);
      mainSeries = s;
    }
    mainSeriesRef.current = mainSeries;

    const addOverlayLine = (
      data: LineData<Time>[],
      title: string,
      color: string,
      lineWidth: 1 | 2 | 3 | 4 = 1,
      lineStyle: LineStyle = LineStyle.Solid,
      lastValueVisible = false
    ) => {
      if (data.length === 0) return;
      chart
        .addSeries(
          LineSeries,
          { color, lineWidth, lineStyle, priceLineVisible: false, lastValueVisible, title },
          0
        )
        .setData(data);
    };

    // Comparison Overlay Symbol
    if (compareSymbol && compareBars.length > 0) {
      const visibleTimeSet = new Set(visibleBars.map((b) => b.time));
      const aligned = compareBars
        .filter((b) => visibleTimeSet.has(b.time))
        .map((b) => ({ time: b.time as Time, value: b.close }));
      if (aligned.length > 0) {
        addOverlayLine(aligned, compareSymbol, '#f59e0b', 2, LineStyle.Solid, true);
      }
    }

    // Price Lines (S/R, Pivots, 52w, User H-lines)
    if (effectivePriceScaleMode !== PriceScaleMode.Percentage) {
      if (showSR && levels.length > 0) {
        for (const lv of levels) {
          mainSeries.createPriceLine({
            price: lv.value,
            color: lv.color,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: lv.label,
          });
        }
      }

      if (enabled.pivots && pivotLevels) {
        for (const p of [
          { title: 'R3', price: pivotLevels.r3, color: '#dc2626' },
          { title: 'R2', price: pivotLevels.r2, color: '#ef4444' },
          { title: 'R1', price: pivotLevels.r1, color: '#f97316' },
          { title: 'PP', price: pivotLevels.pp, color: '#64748b' },
          { title: 'S1', price: pivotLevels.s1, color: '#10b981' },
          { title: 'S2', price: pivotLevels.s2, color: '#059669' },
          { title: 'S3', price: pivotLevels.s3, color: '#047857' },
        ]) {
          mainSeries.createPriceLine({
            price: p.price,
            color: p.color,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: p.title,
          });
        }
      }

      if (enabled.fibPivots) {
        const fp = calcFibPivots(visibleBars);
        if (fp) {
          for (const p of [
            { title: 'Fib R3', price: fp.r3, color: '#e11d48' },
            { title: 'Fib R2', price: fp.r2, color: '#f43f5e' },
            { title: 'Fib R1', price: fp.r1, color: '#fb7185' },
            { title: 'Fib PP', price: fp.pp, color: '#8b5cf6' },
            { title: 'Fib S1', price: fp.s1, color: '#38bdf8' },
            { title: 'Fib S2', price: fp.s2, color: '#0ea5e9' },
            { title: 'Fib S3', price: fp.s3, color: '#0284c7' },
          ]) {
            mainSeries.createPriceLine({
              price: p.price,
              color: p.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: p.title,
            });
          }
        }
      }

      if (enabled.camPivots) {
        const cam = calcCamarillaPivots(visibleBars);
        if (cam) {
          for (const p of [
            { title: 'Cam H4', price: cam.h4, color: '#b91c1c' },
            { title: 'Cam H3', price: cam.h3, color: '#f97316' },
            { title: 'Cam L3', price: cam.l3, color: '#14b8a6' },
            { title: 'Cam L4', price: cam.l4, color: '#0f766e' },
          ]) {
            mainSeries.createPriceLine({
              price: p.price,
              color: p.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: p.title,
            });
          }
        }
      }

      if (show52wLines && latestRaw) {
        if (latestRaw.w52_high && latestRaw.w52_high > 0) {
          mainSeries.createPriceLine({
            price: latestRaw.w52_high,
            color: '#0ea5e9',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: '52w High',
          });
        }
        if (latestRaw.w52_low && latestRaw.w52_low > 0) {
          mainSeries.createPriceLine({
            price: latestRaw.w52_low,
            color: '#f43f5e',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: '52w Low',
          });
        }
      }
    }

    if (!hideDrawings) {
      for (const d of drawings) {
        if (d.kind === 'hline') {
          mainSeries.createPriceLine({
            price: d.p1.price,
            color: '#2563eb',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `Line ${formatNum(d.p1.price)}`,
          });
        }
      }
    }

    // Volume histogram on pane 0
    if (enabled.vol) {
      const volSeries = chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' }, priceScaleId: 'volume' },
        0
      );
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      const volData: HistogramData<Time>[] = visibleBars.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color:
          b.close >= b.open
            ? isDark
              ? 'rgba(16, 185, 129, 0.36)'
              : 'rgba(16, 185, 129, 0.44)'
            : isDark
              ? 'rgba(239, 68, 68, 0.36)'
              : 'rgba(239, 68, 68, 0.44)',
      }));
      volSeries.setData(volData);
    }

    // Moving Averages & Trend Overlays
    if (enabled.smaN) addOverlayLine(calcSma(visibleBars, lookbackDays), `SMA(${lookbackDays})`, '#2563eb', 2, LineStyle.Solid, true);
    if (enabled.sma20) addOverlayLine(calcSma(visibleBars, 20), 'SMA(20)', '#0ea5e9', 1, LineStyle.Solid, true);
    if (enabled.sma50) addOverlayLine(calcSma(visibleBars, 50), 'SMA(50)', '#f97316', 2, LineStyle.Solid, true);
    if (enabled.sma200) addOverlayLine(calcSma(visibleBars, 200), 'SMA(200)', '#dc2626', 2, LineStyle.Solid, true);
    if (enabled.ema9) addOverlayLine(calcEma(visibleBars, 9), 'EMA(9)', '#14b8a6', 1, LineStyle.Solid, true);
    if (enabled.ema20) addOverlayLine(ema20Data, 'EMA(20)', '#f59e0b', 2, LineStyle.Solid, true);
    if (enabled.ema50) addOverlayLine(ema50Data, 'EMA(50)', '#a855f7', 2, LineStyle.Solid, true);
    if (enabled.ema200) addOverlayLine(calcEma(visibleBars, 200), 'EMA(200)', '#e11d48', 2, LineStyle.Dashed, true);
    if (enabled.wma20) addOverlayLine(calcWma(visibleBars, 20), 'WMA(20)', '#06b6d4', 1, LineStyle.Solid, true);
    if (enabled.hma20) addOverlayLine(calcHma(visibleBars, 20), 'HMA(20)', '#22c55e', 2, LineStyle.Solid, true);
    if (enabled.dema20) addOverlayLine(calcDema(visibleBars, 20), 'DEMA(20)', '#6366f1', 1, LineStyle.Solid, true);
    if (enabled.tema20) addOverlayLine(calcTema(visibleBars, 20), 'TEMA(20)', '#ec4899', 1, LineStyle.Solid, true);
    if (enabled.kama) addOverlayLine(calcKama(visibleBars, 10, 2, 30), 'KAMA', '#3b82f6', 2, LineStyle.Solid, true);
    if (enabled.vwma20) addOverlayLine(calcVwma(visibleBars, 20), 'VWMA(20)', '#84cc16', 1, LineStyle.Solid, true);
    if (enabled.alma9) addOverlayLine(calcAlma(visibleBars, 9, 0.85, 6), 'ALMA(9)', '#d946ef', 2, LineStyle.Solid, true);
    if (enabled.mcginley) addOverlayLine(calcMcGinley(visibleBars, 14), 'McGinley(14)', '#f43f5e', 2, LineStyle.Solid, true);

    if (enabled.emaRibbon) {
      const ribbonDefs: Array<{ p: number; color: string }> = [
        { p: 8, color: '#22d3ee' },
        { p: 13, color: '#38bdf8' },
        { p: 21, color: '#3b82f6' },
        { p: 34, color: '#6366f1' },
        { p: 55, color: '#a855f7' },
      ];
      for (const r of ribbonDefs) {
        addOverlayLine(calcEma(visibleBars, r.p), `EMA(${r.p})`, r.color, 1, LineStyle.Solid, false);
      }
    }

    if (enabled.bb) {
      const bb = calcBollinger(visibleBars, 20, 2);
      addOverlayLine(bb.upper, 'BB Upper', 'rgba(148, 163, 184, 0.85)', 1, LineStyle.Dotted, false);
      addOverlayLine(bb.basis, 'BB Basis', 'rgba(148, 163, 184, 0.55)', 1, LineStyle.Dashed, false);
      addOverlayLine(bb.lower, 'BB Lower', 'rgba(148, 163, 184, 0.85)', 1, LineStyle.Dotted, false);
    }

    if (enabled.keltner) {
      const kc = calcKeltner(visibleBars, 20, 2, 10);
      addOverlayLine(kc.upper, 'KC Upper', '#0ea5e9', 1, LineStyle.Dashed, false);
      addOverlayLine(kc.basis, 'KC Mid', '#38bdf8', 1, LineStyle.Dotted, false);
      addOverlayLine(kc.lower, 'KC Lower', '#0ea5e9', 1, LineStyle.Dashed, false);
    }

    if (enabled.donchian) {
      const dc = calcDonchian(visibleBars, 20);
      addOverlayLine(dc.upper, 'DC High', '#10b981', 1, LineStyle.Solid, false);
      addOverlayLine(dc.mid, 'DC Mid', '#64748b', 1, LineStyle.Dotted, false);
      addOverlayLine(dc.lower, 'DC Low', '#ef4444', 1, LineStyle.Solid, false);
    }

    if (enabled.envelope) {
      const env = calcEnvelope(visibleBars, 20, 0.05);
      addOverlayLine(env.upper, 'Env +5%', '#f59e0b', 1, LineStyle.Dotted, false);
      addOverlayLine(env.lower, 'Env -5%', '#f59e0b', 1, LineStyle.Dotted, false);
    }

    if (enabled.linreg) {
      const lr = calcLinearRegressionChannel(visibleBars, 50, 2);
      addOverlayLine(lr.upper, 'Reg +2σ', '#a855f7', 1, LineStyle.Dashed, false);
      addOverlayLine(lr.mid, 'LinReg(50)', '#8b5cf6', 2, LineStyle.Solid, true);
      addOverlayLine(lr.lower, 'Reg -2σ', '#a855f7', 1, LineStyle.Dashed, false);
    }

    if (enabled.zigzag) {
      addOverlayLine(calcZigZag(visibleBars, 5), 'ZigZag 5%', '#f97316', 2, LineStyle.Solid, false);
    }

    if (enabled.supertrend && supertrendData.up.length > 0) {
      chart
        .addSeries(
          LineSeries,
          { color: '#10b981', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: 'ST Up' },
          0
        )
        .setData(supertrendData.up);
      chart
        .addSeries(
          LineSeries,
          { color: '#ef4444', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: 'ST Down' },
          0
        )
        .setData(supertrendData.down);
    }

    if (enabled.psar) {
      const psar = calcParabolicSar(visibleBars, 0.02, 0.2);
      if (psar.up.length > 0) {
        chart
          .addSeries(
            LineSeries,
            {
              color: '#10b981',
              lineVisible: false,
              pointMarkersVisible: true,
              pointMarkersRadius: 2,
              priceLineVisible: false,
              lastValueVisible: false,
              title: 'SAR Bull',
            },
            0
          )
          .setData(psar.up);
        chart
          .addSeries(
            LineSeries,
            {
              color: '#ef4444',
              lineVisible: false,
              pointMarkersVisible: true,
              pointMarkersRadius: 2,
              priceLineVisible: false,
              lastValueVisible: false,
              title: 'SAR Bear',
            },
            0
          )
          .setData(psar.down);
      }
    }

    if (enabled.ichimoku) {
      addOverlayLine(ichimokuData.tenkan, 'Tenkan(9)', '#0ea5e9', 1, LineStyle.Solid, true);
      addOverlayLine(ichimokuData.kijun, 'Kijun(26)', '#ef4444', 1, LineStyle.Solid, true);
      addOverlayLine(ichimokuData.spanA, 'Span A', 'rgba(16, 185, 129, 0.78)', 1, LineStyle.Dashed, false);
      addOverlayLine(ichimokuData.spanB, 'Span B', 'rgba(239, 68, 68, 0.78)', 1, LineStyle.Dashed, false);
      addOverlayLine(ichimokuData.chikou, 'Chikou', '#84cc16', 1, LineStyle.Dotted, false);
    }

    if (enabled.alligator) {
      const alli = calcAlligator(visibleBars);
      addOverlayLine(alli.jaw, 'Jaw(13)', '#2563eb', 2, LineStyle.Solid, false);
      addOverlayLine(alli.teeth, 'Teeth(8)', '#ef4444', 1, LineStyle.Solid, false);
      addOverlayLine(alli.lips, 'Lips(5)', '#10b981', 1, LineStyle.Solid, false);
    }

    if (enabled.rvwap) {
      addOverlayLine(calcRollingVwap(visibleBars, 20), 'RVWAP(20)', '#06b6d4', 2, LineStyle.Solid, true);
    }

    if (enabled.vwap && timeframe === '1D') {
      const vwapData: LineData<Time>[] = visibleBars
        .filter((b) => b.vwap !== null)
        .map((b) => ({ time: b.time as Time, value: Number(b.vwap!.toFixed(2)) }));
      addOverlayLine(vwapData, 'VWAP', '#06b6d4', 1, LineStyle.Dashed, true);
    }

    if (enabled.ma120 && timeframe === '1D') {
      const d120Data = visibleBars
        .filter((b) => b.d120 !== null)
        .map((b) => ({ time: b.time as Time, value: b.d120! }));
      const d180Data = visibleBars
        .filter((b) => b.d180 !== null)
        .map((b) => ({ time: b.time as Time, value: b.d180! }));
      addOverlayLine(d120Data, 'MA120', '#8b5cf6', 1, LineStyle.Solid, false);
      addOverlayLine(d180Data, 'MA180', '#ec4899', 1, LineStyle.Solid, false);
    }

    // Oscillator & Volume Sub-panes
    let nextPane = 1;
    const addSubLinePane = (
      seriesDefs: Array<{
        data: LineData<Time>[];
        title: string;
        color: string;
        lineWidth?: 1 | 2 | 3 | 4;
        lastValue?: boolean;
        refLines?: Array<{ price: number; color: string; title: string }>;
      }>
    ) => {
      const valid = seriesDefs.filter((s) => s.data.length > 0);
      if (valid.length === 0) return;
      const paneIdx = nextPane++;
      for (const sDef of valid) {
        const ser = chart.addSeries(
          LineSeries,
          {
            color: sDef.color,
            lineWidth: sDef.lineWidth ?? 1,
            priceLineVisible: false,
            lastValueVisible: sDef.lastValue ?? true,
            title: sDef.title,
          },
          paneIdx
        );
        ser.setData(sDef.data);
        if (sDef.refLines) {
          for (const rf of sDef.refLines) {
            ser.createPriceLine({
              price: rf.price,
              color: rf.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: rf.title,
            });
          }
        }
      }
      chart.panes()[paneIdx]?.setHeight(subPaneHeight);
    };

    const addSubHistPane = (
      data: HistogramData<Time>[],
      title: string,
      zeroLine = true
    ) => {
      if (data.length === 0) return;
      const paneIdx = nextPane++;
      const s = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: true, title },
        paneIdx
      );
      s.setData(data);
      if (zeroLine) {
        s.createPriceLine({
          price: 0,
          color: '#64748b',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: '0',
        });
      }
      chart.panes()[paneIdx]?.setHeight(subPaneHeight);
    };

    if (enabled.rsi) {
      addSubLinePane([
        {
          data: rsiData,
          title: 'RSI(14)',
          color: '#6366f1',
          lineWidth: 2,
          refLines: [
            { price: 70, color: '#ef4444', title: '70' },
            { price: 30, color: '#10b981', title: '30' },
          ],
        },
      ]);
    }

    if (enabled.stochRsi) {
      const srsi = calcStochRsi(visibleBars, 14, 14, 3, 3);
      addSubLinePane([
        {
          data: srsi.k,
          title: 'SRSI %K',
          color: '#2563eb',
          refLines: [
            { price: 80, color: '#ef4444', title: '80' },
            { price: 20, color: '#10b981', title: '20' },
          ],
        },
        { data: srsi.d, title: 'SRSI %D', color: '#f97316' },
      ]);
    }

    if (enabled.macd && macdData.macd.length > 0) {
      const macdPane = nextPane++;
      chart
        .addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, macdPane)
        .setData(macdData.hist);
      chart
        .addSeries(
          LineSeries,
          { color: '#2563eb', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'MACD' },
          macdPane
        )
        .setData(macdData.macd);
      chart
        .addSeries(
          LineSeries,
          { color: '#f97316', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Sig(9)' },
          macdPane
        )
        .setData(macdData.signal);
      chart.panes()[macdPane]?.setHeight(subPaneHeight);
    }

    if (enabled.ppo) {
      const ppo = calcPpo(visibleBars);
      if (ppo.ppo.length > 0) {
        const ppoPane = nextPane++;
        chart
          .addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, ppoPane)
          .setData(ppo.hist);
        chart
          .addSeries(
            LineSeries,
            { color: '#0ea5e9', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'PPO%' },
            ppoPane
          )
          .setData(ppo.ppo);
        chart
          .addSeries(
            LineSeries,
            { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'Sig' },
            ppoPane
          )
          .setData(ppo.signal);
        chart.panes()[ppoPane]?.setHeight(subPaneHeight);
      }
    }

    if (enabled.stoch) {
      addSubLinePane([
        {
          data: stochData.k,
          title: '%K',
          color: '#0ea5e9',
          refLines: [
            { price: 80, color: '#ef4444', title: '80' },
            { price: 20, color: '#10b981', title: '20' },
          ],
        },
        { data: stochData.d, title: '%D', color: '#f97316' },
      ]);
    }

    if (enabled.adx) {
      addSubLinePane([
        {
          data: adxData.adx,
          title: 'ADX',
          color: '#eab308',
          lineWidth: 2,
          refLines: [{ price: 25, color: '#64748b', title: '25' }],
        },
        { data: adxData.plusDi, title: '+DI', color: '#10b981', lastValue: false },
        { data: adxData.minusDi, title: '-DI', color: '#ef4444', lastValue: false },
      ]);
    }

    if (enabled.atr) {
      addSubLinePane([{ data: atrSeries, title: 'ATR(14)', color: '#ec4899', lineWidth: 2 }]);
    }

    if (enabled.bbw) {
      addSubLinePane([{ data: calcBbWidth(visibleBars, 20, 2), title: 'BBWidth%', color: '#8b5cf6', lineWidth: 2 }]);
    }

    if (enabled.bbPctB) {
      addSubLinePane([
        {
          data: calcBbPercentB(visibleBars, 20, 2),
          title: 'BB %B',
          color: '#06b6d4',
          lineWidth: 2,
          refLines: [
            { price: 1, color: '#ef4444', title: '1.0' },
            { price: 0, color: '#10b981', title: '0.0' },
          ],
        },
      ]);
    }

    if (enabled.hvol) {
      addSubLinePane([{ data: calcHistoricalVolatility(visibleBars, 20), title: 'HistVol%', color: '#f43f5e', lineWidth: 2 }]);
    }

    if (enabled.cci) {
      addSubLinePane([
        {
          data: cciData,
          title: 'CCI(20)',
          color: '#14b8a6',
          lineWidth: 2,
          refLines: [
            { price: 100, color: '#ef4444', title: '+100' },
            { price: -100, color: '#10b981', title: '-100' },
          ],
        },
      ]);
    }

    if (enabled.willr) {
      addSubLinePane([
        {
          data: willrData,
          title: 'W%R(14)',
          color: '#a855f7',
          lineWidth: 2,
          refLines: [
            { price: -20, color: '#ef4444', title: '-20' },
            { price: -80, color: '#10b981', title: '-80' },
          ],
        },
      ]);
    }

    if (enabled.mfi) {
      addSubLinePane([
        {
          data: mfiData,
          title: 'MFI(14)',
          color: '#0ea5e9',
          lineWidth: 2,
          refLines: [
            { price: 80, color: '#ef4444', title: '80' },
            { price: 20, color: '#10b981', title: '20' },
          ],
        },
      ]);
    }

    if (enabled.ao) {
      addSubHistPane(calcAwesomeOscillator(visibleBars, 5, 34), 'AO');
    }

    if (enabled.roc) {
      addSubLinePane([
        {
          data: calcRoc(visibleBars, 12),
          title: 'ROC(12)%',
          color: '#3b82f6',
          lineWidth: 2,
          refLines: [{ price: 0, color: '#64748b', title: '0' }],
        },
      ]);
    }

    if (enabled.mom) {
      addSubLinePane([
        {
          data: calcMomentum(visibleBars, 10),
          title: 'MOM(10)',
          color: '#22c55e',
          lineWidth: 2,
          refLines: [{ price: 0, color: '#64748b', title: '0' }],
        },
      ]);
    }

    if (enabled.trix) {
      addSubLinePane([
        {
          data: calcTrix(visibleBars, 15),
          title: 'TRIX(15)',
          color: '#f59e0b',
          lineWidth: 2,
          refLines: [{ price: 0, color: '#64748b', title: '0' }],
        },
      ]);
    }

    if (enabled.uo) {
      addSubLinePane([
        {
          data: calcUltimateOscillator(visibleBars, 7, 14, 28),
          title: 'UO(7,14,28)',
          color: '#ec4899',
          lineWidth: 2,
          refLines: [
            { price: 70, color: '#ef4444', title: '70' },
            { price: 30, color: '#10b981', title: '30' },
          ],
        },
      ]);
    }

    if (enabled.cmo) {
      addSubLinePane([
        {
          data: calcCmo(visibleBars, 14),
          title: 'CMO(14)',
          color: '#6366f1',
          lineWidth: 2,
          refLines: [
            { price: 50, color: '#ef4444', title: '+50' },
            { price: -50, color: '#10b981', title: '-50' },
          ],
        },
      ]);
    }

    if (enabled.dpo) {
      addSubLinePane([
        {
          data: calcDpo(visibleBars, 20),
          title: 'DPO(20)',
          color: '#06b6d4',
          lineWidth: 1,
          refLines: [{ price: 0, color: '#64748b', title: '0' }],
        },
      ]);
    }

    if (enabled.aroon) {
      const ar = calcAroon(visibleBars, 25);
      addSubLinePane([
        { data: ar.up, title: 'AroonUp', color: '#10b981', lineWidth: 2 },
        { data: ar.down, title: 'AroonDn', color: '#ef4444', lineWidth: 2 },
      ]);
    }

    if (enabled.coppock) {
      addSubHistPane(calcCoppock(visibleBars), 'Coppock');
    }

    if (enabled.vortex) {
      const vx = calcVortex(visibleBars, 14);
      addSubLinePane([
        {
          data: vx.plus,
          title: 'VI+',
          color: '#10b981',
          lineWidth: 2,
          refLines: [{ price: 1, color: '#64748b', title: '1.0' }],
        },
        { data: vx.minus, title: 'VI-', color: '#ef4444', lineWidth: 2 },
      ]);
    }

    if (enabled.elder) {
      const er = calcElderRay(visibleBars, 13);
      if (er.bull.length > 0) {
        const erPane = nextPane++;
        chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: true, title: 'BullPow' }, erPane).setData(er.bull);
        chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: true, title: 'BearPow' }, erPane).setData(er.bear);
        chart.panes()[erPane]?.setHeight(subPaneHeight);
      }
    }

    if (enabled.fisher) {
      const ft = calcFisherTransform(visibleBars, 10);
      addSubLinePane([
        {
          data: ft.fisher,
          title: 'Fisher(10)',
          color: '#2563eb',
          lineWidth: 2,
          refLines: [{ price: 0, color: '#64748b', title: '0' }],
        },
        { data: ft.trigger, title: 'Trigger', color: '#f97316' },
      ]);
    }

    if (enabled.obv) {
      addSubLinePane([{ data: calcObv(visibleBars), title: 'OBV', color: '#14b8a6', lineWidth: 2 }]);
    }

    if (enabled.cmf) {
      addSubLinePane([
        {
          data: cmfData,
          title: 'CMF(20)',
          color: '#10b981',
          lineWidth: 2,
          refLines: [{ price: 0, color: '#64748b', title: '0.0' }],
        },
      ]);
    }

    if (enabled.adLine) {
      addSubLinePane([{ data: calcAdLine(visibleBars), title: 'A/D Line', color: '#3b82f6', lineWidth: 2 }]);
    }

    if (enabled.chaikinOsc) {
      addSubLinePane([
        {
          data: calcChaikinOscillator(visibleBars, 3, 10),
          title: 'ChaikinOsc',
          color: '#f59e0b',
          lineWidth: 2,
          refLines: [{ price: 0, color: '#64748b', title: '0' }],
        },
      ]);
    }

    if (enabled.force) {
      addSubLinePane([
        {
          data: calcForceIndex(visibleBars, 13),
          title: 'Force(13)',
          color: '#ef4444',
          lineWidth: 2,
          refLines: [{ price: 0, color: '#64748b', title: '0' }],
        },
      ]);
    }

    if (enabled.eom) {
      addSubLinePane([
        {
          data: calcEaseOfMovement(visibleBars, 14),
          title: 'EOM(14)',
          color: '#8b5cf6',
          lineWidth: 2,
          refLines: [{ price: 0, color: '#64748b', title: '0' }],
        },
      ]);
    }

    if (enabled.volOsc) {
      addSubHistPane(calcVolumeOscillator(visibleBars, 5, 20), 'VolOsc%');
    }

    if (enabled.vpt) {
      addSubLinePane([{ data: calcVpt(visibleBars), title: 'VPT', color: '#0ea5e9', lineWidth: 2 }]);
    }

    // Visible range zoom
    if (zoom === 'ALL' || replayMode) {
      chart.timeScale().fitContent();
    } else {
      const approxBars =
        timeframe === '1D'
          ? zoom === '1M'
            ? 22
            : zoom === '3M'
              ? 65
              : zoom === '6M'
                ? 130
                : 250
          : timeframe === '1W'
            ? zoom === '1M'
              ? 5
              : zoom === '3M'
                ? 13
                : zoom === '6M'
                  ? 26
                  : 52
            : zoom === '1M'
              ? 2
              : zoom === '3M'
                ? 4
                : zoom === '6M'
                  ? 6
                  : 12;
      const to = visibleBars.length - 1;
      const from = Math.max(0, visibleBars.length - approxBars);
      if (to > from) {
        chart.timeScale().setVisibleLogicalRange({ from, to: to + 2 });
      } else {
        chart.timeScale().fitContent();
      }
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || typeof param.time !== 'string') {
        setHovered(null);
        return;
      }
      setHovered(barMap.get(param.time) ?? null);
    });

    chart.subscribeClick((param) => {
      if (!param.time) return;
      const clickedTime = String(param.time);

      if (replayPickPendingRef.current) {
        const idx = fullBars.findIndex((b) => b.time === clickedTime);
        if (idx >= 1) {
          setReplayMode(true);
          setReplayPlaying(false);
          setReplayIndex(idx);
        }
        setReplayPickPending(false);
        return;
      }

      const tool = drawToolRef.current;
      if (tool === 'cursor' || !param.point) return;

      const rawPrice = mainSeries.coordinateToPrice(param.point.y);
      if (rawPrice === null || !Number.isFinite(rawPrice)) return;
      const snappedPrice = magnetModeRef.current
        ? snapPriceToBar(barMap.get(clickedTime), rawPrice)
        : Number(rawPrice.toFixed(2));

      if (tool === 'hline' || tool === 'vline') {
        setDrawings((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: tool,
            p1: { time: clickedTime, price: snappedPrice },
          },
        ]);
        setDrawTool('cursor');
      } else if (tool === 'note') {
        setPendingNoteAnchor({ time: clickedTime, price: snappedPrice });
        setNoteDraft('');
      } else {
        const anchor = pendingPointRef.current;
        if (!anchor) {
          setPendingPoint({ time: clickedTime, price: snappedPrice });
        } else {
          setDrawings((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: tool,
              p1: anchor,
              p2: { time: clickedTime, price: snappedPrice },
            },
          ]);
          setPendingPoint(null);
          setDrawTool('cursor');
        }
      }
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      triggerOverlaySync();
    });

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const nextW = Math.floor(rect.width);
      const nextH = isFullscreen
        ? Math.max(460, Math.floor(chartWrapRef.current?.clientHeight || rect.height))
        : defaultInlineH;
      if (nextW > 0) {
        chart.applyOptions({ width: nextW, height: nextH });
        triggerOverlaySync();
      }
    });
    ro.observe(chartWrapRef.current || el);

    requestAnimationFrame(triggerOverlaySync);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
    };
  }, [
    activePaneCount,
    adxData,
    atrSeries,
    barMap,
    cciData,
    chartStyle,
    cmfData,
    compareBars,
    compareSymbol,
    drawings,
    ema20Data,
    ema50Data,
    enabled,
    fullBars,
    hideDrawings,
    ichimokuData,
    isDark,
    isFullscreen,
    latestRaw,
    levels,
    lookbackDays,
    macdData,
    mfiData,
    pivotLevels,
    replayMode,
    rsiData,
    scaleMode,
    show52wLines,
    showGrid,
    showSR,
    stochData,
    supertrendData,
    timeframe,
    triggerOverlaySync,
    visibleBars,
    willrData,
    zoom,
  ]);

  // Project vector drawings onto SVG overlay
  const projectedOverlays = useMemo(() => {
    void renderTick;
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    const wrapW = chartWrapRef.current?.clientWidth || 900;
    const wrapH = chartWrapRef.current?.clientHeight || 420;
    if (!chart || !series || visibleBars.length === 0 || hideDrawings) {
      return { items: [], wrapW, wrapH };
    }

    const toCoords = (pt: { time: string; price: number }): { x: number; y: number } | null => {
      let x = chart.timeScale().timeToCoordinate(pt.time as Time);
      if (x === null) {
        const nearest = visibleBars.reduce((best, b) =>
          Math.abs(b.time.localeCompare(pt.time)) < Math.abs(best.time.localeCompare(pt.time))
            ? b
            : best
        );
        x = chart.timeScale().timeToCoordinate(nearest.time as Time);
      }
      const y = series.priceToCoordinate(pt.price);
      if (x === null || y === null) return null;
      return { x, y };
    };

    const items = drawings
      .filter((d) => d.kind !== 'hline')
      .map((d) => {
        const c1 = toCoords(d.p1);
        if (!c1) return null;
        if (d.kind === 'vline' || d.kind === 'note') {
          return { drawing: d, c1, c2: null as { x: number; y: number } | null };
        }
        if (!d.p2) return null;
        const c2 = toCoords(d.p2);
        if (!c2) return null;
        return { drawing: d, c1, c2 };
      })
      .filter(
        (
          x
        ): x is {
          drawing: SavedDrawing;
          c1: { x: number; y: number };
          c2: { x: number; y: number } | null;
        } => x !== null
      );

    return { items, wrapW, wrapH };
  }, [drawings, hideDrawings, renderTick, visibleBars]);

  const filteredSwitchSymbols = useMemo(() => {
    const q = fsSearch.trim().toLowerCase();
    if (!q) return symbols;
    return symbols.filter(
      (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [symbols, fsSearch]);

  const filteredCompareSymbols = useMemo(() => {
    const q = compareSearch.trim().toLowerCase();
    return symbols
      .filter((s) => s.symbol !== symbol)
      .filter((s) => !q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [symbols, symbol, compareSearch]);

  const stepSymbol = (dir: -1 | 1) => {
    if (!onSelectSymbol || symbols.length === 0) return;
    const idx = symbols.findIndex((s) => s.symbol === symbol);
    const nextIdx = idx === -1 ? 0 : (idx + dir + symbols.length) % symbols.length;
    onSelectSymbol(symbols[nextIdx].symbol);
  };

  const handleDownloadSnapshot = useCallback(async () => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const baseCanvas = chart.takeScreenshot();
      const bar = latestBar ?? activeBar;
      const activeStudyLabels = activeIndicatorList.slice(0, 6).map((i) => i.shortLabel).join(', ');
      const headerTitle = `${symbol} · ${timeframe}${compareSymbol ? ` vs ${compareSymbol}` : ''} · ${bar?.time ?? 'Latest'} · Technical: ${technicalConsensus.verdict} (${technicalConsensus.bull}B/${technicalConsensus.bear}S)`;
      const headerMeta = bar
        ? `O ${formatNum(bar.open)} · H ${formatNum(bar.high)} · L ${formatNum(bar.low)} · C ${formatNum(bar.close)} (${formatPct(bar.diff_pct)}) · Vol ${formatInt(bar.volume)}${activeStudyLabels ? ` · Studies: ${activeStudyLabels}` : ''}`
        : undefined;
      const footerText =
        drawings.length > 0 && !hideDrawings
          ? `Includes ${drawings.length} chart annotation${drawings.length === 1 ? '' : 's'}${levels.length > 0 && showSR ? ` · ${levels.map((l) => `${l.label} ${formatNum(l.value)}`).join(' · ')}` : ''}`
          : levels.length > 0 && showSR
            ? `S/R Levels: ${levels.map((l) => `${l.label} ${formatNum(l.value)}`).join(' · ')}`
            : undefined;
      const dataUrl = await composeChartPngWithSvg({
        baseCanvas,
        svgOverlay: hideDrawings ? null : svgOverlayRef.current,
        headerTitle,
        headerMeta,
        footerText,
        dark: isDark,
      });
      triggerPngDownload(dataUrl, `${symbol}_${timeframe}_${bar?.time ?? 'chart'}.png`);
    } catch {
      // ignore snapshot failure
    }
  }, [
    symbol,
    timeframe,
    compareSymbol,
    latestBar,
    activeBar,
    activeIndicatorList,
    technicalConsensus,
    drawings.length,
    hideDrawings,
    levels,
    showSR,
    isDark,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      exportPng: handleDownloadSnapshot,
    }),
    [handleDownloadSnapshot]
  );

  const handleFitScale = () => {
    chartRef.current?.timeScale().fitContent();
    setZoom('ALL');
  };

  const handleStartReplay = () => {
    if (replayMode) {
      setReplayMode(false);
      setReplayPlaying(false);
      setReplayIndex(null);
      setReplayPickPending(false);
      return;
    }
    const defaultIdx = Math.max(5, Math.floor(fullBars.length * 0.72));
    setReplayMode(true);
    setReplayPlaying(false);
    setReplayIndex(defaultIdx);
    setReplayPickPending(false);
  };

  const submitNoteDrawing = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingNoteAnchor) return;
    const txt = noteDraft.trim() || `Note @ ${formatNum(pendingNoteAnchor.price)}`;
    setDrawings((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'note',
        p1: pendingNoteAnchor,
        text: txt,
      },
    ]);
    setPendingNoteAnchor(null);
    setNoteDraft('');
    setDrawTool('cursor');
  };

  if (history.length === 0) {
    return (
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
        No price history available for {symbol}.
      </div>
    );
  }

  const wrapperClass = isFullscreen
    ? 'fixed inset-0 z-50 bg-white dark:bg-slate-950 flex flex-col overflow-hidden'
    : 'relative border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3 sm:p-4 space-y-2.5';

  const drawingTools: Array<{
    id: DrawTool;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'cursor', label: 'Crosshair (Esc)', icon: Crosshair },
    { id: 'trend', label: 'Trendline', icon: Slash },
    { id: 'ray', label: 'Extended Ray', icon: ArrowUpRight },
    { id: 'hline', label: 'Horizontal Line', icon: Minus },
    { id: 'vline', label: 'Vertical Date Line', icon: MoreVertical },
    { id: 'fib', label: 'Fib Retracement', icon: Columns2 },
    { id: 'long', label: 'Long Position (R:R)', icon: Target },
    { id: 'measure', label: 'Price Range Measure', icon: Ruler },
    { id: 'note', label: 'Price Note Callout', icon: StickyNote },
  ];

  const categories: Array<'All' | IndicatorCategory> = [
    'All',
    'Trend & MAs',
    'Bands & Channels',
    'Volatility & Pivots',
    'Momentum & Oscillators',
    'Volume & Flow',
  ];

  const quickButtons: Array<{ id: IndicatorId; label: string }> = [
    { id: 'vol', label: 'Volume' },
    { id: 'smaN', label: `SMA(${lookbackDays})` },
    { id: 'ema20', label: 'EMA(20)' },
    { id: 'ema50', label: 'EMA(50)' },
    { id: 'ichimoku', label: 'Ichimoku' },
    { id: 'supertrend', label: 'Supertrend' },
    { id: 'psar', label: 'PSAR' },
    { id: 'bb', label: 'BB(20,2)' },
    { id: 'rsi', label: 'RSI(14)' },
    { id: 'macd', label: 'MACD' },
    { id: 'stoch', label: 'Stoch(14)' },
    { id: 'cmf', label: 'CMF(20)' },
  ];

  return (
    <div className={wrapperClass}>
      {/* Top TradingView Advanced Header Bar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${
          isFullscreen
            ? 'px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900'
            : 'border-b border-slate-100 dark:border-slate-800 pb-2.5'
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {symbols.length > 0 && onSelectSymbol ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => stepSymbol(-1)}
                title="Previous stock"
                className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="relative">
                <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={fsSearch}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFsSearch(v);
                    const q = v.trim().toLowerCase();
                    if (q) {
                      const match =
                        symbols.find((s) => s.symbol.toLowerCase() === q) ||
                        symbols.find((s) => s.symbol.toLowerCase().startsWith(q));
                      if (match) onSelectSymbol(match.symbol);
                    }
                  }}
                  placeholder="Ticker…"
                  className="w-24 pl-6 pr-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
              <select
                value={symbol}
                onChange={(e) => onSelectSymbol(e.target.value)}
                aria-label="Switch active security"
                className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-blue-600 dark:text-blue-400 max-w-[155px]"
              >
                {filteredSwitchSymbols.map((s) => (
                  <option key={s.symbol} value={s.symbol}>
                    {s.symbol}
                    {s.name ? ` — ${s.name}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => stepSymbol(1)}
                title="Next stock"
                className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              {onToggleStar && (
                <button
                  type="button"
                  onClick={onToggleStar}
                  title={isStarred ? 'Remove from watchlist' : 'Add to watchlist'}
                  className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-amber-500"
                >
                  <Star className={`w-3.5 h-3.5 ${isStarred ? 'fill-amber-500 text-amber-500' : ''}`} />
                </button>
              )}
            </div>
          ) : (
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 mr-1 whitespace-nowrap">
              {symbol} Advanced Chart
            </span>
          )}

          {/* Timeframes */}
          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[11px]">
            {(['1D', '1W', '1M'] as ChartTimeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 rounded font-mono font-medium whitespace-nowrap shrink-0 transition-colors ${
                  timeframe === tf
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Chart Style Selector */}
          <select
            value={chartStyle}
            onChange={(e) => setChartStyle(e.target.value as ChartStyle)}
            aria-label="Chart series style"
            className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200"
          >
            <option value="candles">Candles</option>
            <option value="hollow">Hollow Candles</option>
            <option value="heikin">Heikin Ashi</option>
            <option value="bars">OHLC Bars</option>
            <option value="area">Area</option>
            <option value="line">Line</option>
          </select>

          {/* Indicators Modal Trigger */}
          <button
            type="button"
            onClick={() => {
              setIndicatorsModalOpen((v) => !v);
              setCompareModalOpen(false);
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
              indicatorsModalOpen
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>
              Indicators ({activeIndicatorList.length}/{indicatorCatalog.length})
            </span>
          </button>

          {/* Compare Symbol Button */}
          {symbols.length > 1 && (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setCompareModalOpen((v) => !v);
                  setIndicatorsModalOpen(false);
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                  compareSymbol
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <GitCompare className="w-3 h-3" />
                <span>{compareSymbol ? `vs ${compareSymbol}` : 'Compare'}</span>
              </button>
              {compareSymbol && (
                <button
                  type="button"
                  onClick={() => {
                    setCompareSymbol(null);
                    setCompareHistory([]);
                  }}
                  title="Remove comparison symbol"
                  className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Bar Replay Toggle */}
          <button
            type="button"
            onClick={handleStartReplay}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
              replayMode
                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Practice bar-by-bar price action replay"
          >
            <Activity className="w-3 h-3" />
            <span>{replayMode ? 'Replay On' : 'Replay'}</span>
          </button>
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
            {(['1M', '3M', '6M', '1Y', 'ALL'] as ZoomRange[]).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                className={`px-1.5 py-1 rounded font-mono font-medium whitespace-nowrap shrink-0 transition-colors ${
                  zoom === z
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {z}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
            {(
              [
                { id: 'normal', label: 'Rs' },
                { id: 'percent', label: '%' },
                { id: 'log', label: 'Log' },
              ] as Array<{ id: ScaleMode; label: string }>
            ).map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => setScaleMode(sc.id)}
                title={`Price scale: ${sc.label}`}
                className={`px-1.5 py-1 rounded font-mono font-medium whitespace-nowrap shrink-0 transition-colors ${
                  scaleMode === sc.id
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleFitScale}
            title="Auto-fit chart scale"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="hidden xl:inline">Fit</span>
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadSnapshot()}
            title="Export chart & drawings as PNG"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium whitespace-nowrap shrink-0 transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Export PNG</span>
          </button>

          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors"
            title={sidebarOpen ? 'Collapse TA Sidebar' : 'Expand TA Sidebar'}
          >
            {sidebarOpen ? (
              <PanelRightClose className="w-3.5 h-3.5" />
            ) : (
              <PanelRightOpen className="w-3.5 h-3.5" />
            )}
            <span>TA Panel</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 dark:bg-blue-600 text-white hover:opacity-90 transition-opacity font-medium whitespace-nowrap shrink-0"
            title={isFullscreen ? 'Exit Full-Screen (Esc)' : 'Open Full-Screen Chart Terminal'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Full Screen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bar Replay Controls Strip */}
      {replayMode && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 text-[11px] ${
            isFullscreen ? 'mx-4 mt-1.5' : ''
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-emerald-800 dark:text-emerald-300">
              Bar Replay
            </span>
            <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {visibleBars.length} / {fullBars.length} bars · Cutoff {latestBar?.time ?? '–'}
            </span>
            <button
              type="button"
              onClick={() => setReplayPickPending((v) => !v)}
              className={`px-2 py-0.5 rounded border text-[11px] font-medium ${
                replayPickPending
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
              }`}
            >
              {replayPickPending ? 'Click any candle to jump…' : 'Jump to Candle'}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setReplayPlaying((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-700"
            >
              {replayPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{replayPlaying ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setReplayPlaying(false);
                setReplayIndex((prev) =>
                  Math.min(fullBars.length - 1, (prev ?? Math.floor(fullBars.length * 0.72)) + 1)
                );
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            >
              <SkipForward className="w-3 h-3" />
              <span>+1 Bar</span>
            </button>
            <select
              value={replaySpeedMs}
              onChange={(e) => setReplaySpeedMs(Number(e.target.value))}
              aria-label="Replay speed"
              className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-mono"
            >
              <option value={1000}>0.7x</option>
              <option value={700}>1x</option>
              <option value={350}>2x</option>
              <option value={150}>4x</option>
            </select>
            <button
              type="button"
              onClick={handleStartReplay}
              className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-red-600"
            >
              Exit Replay
            </button>
          </div>
        </div>
      )}

      {/* Live OHLCV + Indicator Legend Strip */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300 ${
          isFullscreen ? 'px-4 py-1 border-b border-slate-100 dark:border-slate-900' : ''
        }`}
      >
        {activeBar && (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {symbol} · {timeframe} · {activeBar.time}
            </span>
            <span>O <span className="text-slate-900 dark:text-slate-100">{formatNum(activeBar.open)}</span></span>
            <span>H <span className="text-slate-900 dark:text-slate-100">{formatNum(activeBar.high)}</span></span>
            <span>L <span className="text-slate-900 dark:text-slate-100">{formatNum(activeBar.low)}</span></span>
            <span>
              C{' '}
              <span
                className={
                  activeBar.close >= activeBar.open
                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-red-600 dark:text-red-400 font-semibold'
                }
              >
                {formatNum(activeBar.close)}
              </span>
            </span>
            <span
              className={
                (activeBar.diff_pct ?? 0) >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }
            >
              {formatPct(activeBar.diff_pct)}
            </span>
            <span>Vol {formatInt(activeBar.volume)}</span>
            <span>Turn Rs {formatCrore(activeBar.turnover)} cr</span>
            {compareSymbol && (
              <span className="text-amber-600 dark:text-amber-400">
                {compareLoading ? `Loading ${compareSymbol}…` : `Compare: ${compareSymbol} (% scale)`}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {drawTool !== 'cursor' && (
            <span className="text-blue-600 dark:text-blue-400 font-sans font-medium">
              {drawTool === 'hline'
                ? 'Click chart to place Horizontal S/R Line'
                : drawTool === 'vline'
                  ? 'Click chart to mark Vertical Date Line'
                  : drawTool === 'note'
                    ? 'Click chart to place Price Callout Note'
                    : pendingPoint
                      ? `Anchor 1 (${pendingPoint.time} @ ${formatNum(pendingPoint.price)}) — click Anchor 2`
                      : `Click Anchor 1 for ${
                          drawTool === 'trend'
                            ? 'Trendline'
                            : drawTool === 'ray'
                              ? 'Extended Ray'
                              : drawTool === 'fib'
                                ? 'Fib Retracement'
                                : drawTool === 'long'
                                  ? 'Long Entry (then Stop-Loss)'
                                  : 'Price Measure'
                        }`}
            </span>
          )}
          {enabled.supertrend && supertrendData.latestTrend && (
            <span
              className={
                supertrendData.latestTrend === 'bullish'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }
            >
              ST(10,3): {supertrendData.latestTrend === 'bullish' ? 'Bull' : 'Bear'}{' '}
              {supertrendData.latestValue !== null ? formatNum(supertrendData.latestValue) : ''}
            </span>
          )}
          {latestRsi !== null && enabled.rsi && (
            <span className="text-indigo-600 dark:text-indigo-400">
              RSI: <span className="font-semibold">{latestRsi.toFixed(1)}</span>
            </span>
          )}
          {latestCci !== null && enabled.cci && (
            <span className="text-teal-600 dark:text-teal-400">
              CCI: {latestCci.toFixed(0)}
            </span>
          )}
          {latestMfi !== null && enabled.mfi && (
            <span className="text-sky-600 dark:text-sky-400">
              MFI: {latestMfi.toFixed(1)}
            </span>
          )}
          {latestAdx !== null && enabled.adx && (
            <span className="text-amber-600 dark:text-amber-400">
              ADX: {latestAdx.toFixed(1)}
            </span>
          )}
          {latestAtr !== null && (
            <span className="text-slate-500 dark:text-slate-400">
              ATR(14): <span className="font-semibold">{formatNum(latestAtr)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Terminal Grid */}
      <div
        className={`flex flex-col lg:flex-row gap-2.5 ${
          isFullscreen ? 'flex-1 min-h-0 px-3 pb-3 pt-1' : ''
        }`}
      >
        <div className="flex flex-1 min-w-0 gap-2 min-h-0">
          {/* TradingView Vertical Left Drawing Toolbar */}
          <nav
            aria-label="Chart drawing tools"
            className="w-10 shrink-0 flex flex-col items-center gap-1 py-1.5 px-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/90"
          >
            {drawingTools.map((t) => {
              const Icon = t.icon;
              const active = drawTool === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setDrawTool(t.id);
                    setPendingPoint(null);
                    setPendingNoteAnchor(null);
                  }}
                  title={t.label}
                  aria-label={t.label}
                  className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}

            <div className="w-5 border-t border-slate-200 dark:border-slate-700 my-0.5" />

            <button
              type="button"
              onClick={() => setMagnetMode((v) => !v)}
              title={magnetMode ? 'Magnet Mode On (snaps to OHLC)' : 'Magnet Mode Off'}
              aria-label="Toggle OHLC magnet snap"
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                magnetMode
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-400'
                  : 'text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800'
              }`}
            >
              <Magnet className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setHideDrawings((v) => !v)}
              title={hideDrawings ? 'Show Drawings' : 'Hide Drawings'}
              aria-label="Toggle drawing visibility"
              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                hideDrawings
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800'
              }`}
            >
              {hideDrawings ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>

            {drawings.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setDrawings((prev) => prev.slice(0, -1))}
                  title="Undo last drawing"
                  aria-label="Undo last drawing"
                  className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDrawings([]);
                    setPendingPoint(null);
                  }}
                  title="Clear all drawings on this symbol"
                  aria-label="Clear all drawings"
                  className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </nav>

          {/* Chart Canvas + SVG Overlay */}
          <div
            ref={chartWrapRef}
            className={`relative flex-1 min-w-0 overflow-hidden rounded border border-slate-200 dark:border-slate-800 ${
              isFullscreen ? 'h-full' : ''
            }`}
          >
            <div ref={containerRef} className="w-full h-full" />

            {/* Inline Price Note Composer */}
            {pendingNoteAnchor && (
              <form
                onSubmit={submitNoteDrawing}
                className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-md text-xs"
              >
                <span className="font-mono text-[11px] text-slate-500">
                  {pendingNoteAnchor.time} @ {formatNum(pendingNoteAnchor.price)}
                </span>
                <input
                  type="text"
                  autoFocus
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add note (e.g. Breakout)"
                  className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs w-44"
                />
                <button type="submit" className="px-2 py-0.5 rounded bg-blue-600 text-white font-medium">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingNoteAnchor(null);
                    setNoteDraft('');
                  }}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </form>
            )}

            {/* SVG Vector Drawings Overlay */}
            {projectedOverlays.items.length > 0 && (
              <svg ref={svgOverlayRef} className="absolute inset-0 w-full h-full pointer-events-none z-10">
                {projectedOverlays.items.map(({ drawing, c1, c2 }) => {
                  if (drawing.kind === 'vline') {
                    return (
                      <g key={drawing.id}>
                        <line
                          x1={c1.x}
                          y1={0}
                          x2={c1.x}
                          y2={projectedOverlays.wrapH}
                          stroke="#8b5cf6"
                          strokeDasharray="4 3"
                          strokeWidth={1.5}
                        />
                        <rect x={c1.x - 36} y={4} width={72} height={16} rx={3} fill="#7c3aed" />
                        <text
                          x={c1.x - 31}
                          y={15}
                          fill="#ffffff"
                          fontSize="10"
                          fontFamily="ui-monospace, monospace"
                        >
                          {drawing.p1.time}
                        </text>
                      </g>
                    );
                  }

                  if (drawing.kind === 'note') {
                    const label = drawing.text || `Rs ${formatNum(drawing.p1.price)}`;
                    const w = Math.min(180, Math.max(76, label.length * 6.5 + 16));
                    return (
                      <g key={drawing.id}>
                        <circle cx={c1.x} cy={c1.y} r={4} fill="#2563eb" />
                        <rect
                          x={c1.x + 6}
                          y={Math.max(4, c1.y - 12)}
                          width={w}
                          height={20}
                          rx={4}
                          fill="#1e293b"
                          stroke="#3b82f6"
                          strokeWidth={1}
                        />
                        <text
                          x={c1.x + 12}
                          y={Math.max(17, c1.y + 1)}
                          fill="#f8fafc"
                          fontSize="10"
                          fontFamily="ui-monospace, monospace"
                        >
                          {label}
                        </text>
                      </g>
                    );
                  }

                  if (!c2 || !drawing.p2) return null;

                  if (drawing.kind === 'trend') {
                    return (
                      <g key={drawing.id}>
                        <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke="#2563eb" strokeWidth={2} />
                        <circle cx={c1.x} cy={c1.y} r={3.5} fill="#2563eb" />
                        <circle cx={c2.x} cy={c2.y} r={3.5} fill="#2563eb" />
                      </g>
                    );
                  }

                  if (drawing.kind === 'ray') {
                    const dx = c2.x - c1.x;
                    const dy = c2.y - c1.y;
                    let endX = c2.x;
                    let endY = c2.y;
                    if (Math.abs(dx) > 0.5) {
                      const targetX = dx > 0 ? projectedOverlays.wrapW : 0;
                      const t = (targetX - c1.x) / dx;
                      endX = targetX;
                      endY = c1.y + dy * t;
                    } else {
                      endY = dy >= 0 ? projectedOverlays.wrapH : 0;
                    }
                    return (
                      <g key={drawing.id}>
                        <line x1={c1.x} y1={c1.y} x2={endX} y2={endY} stroke="#0ea5e9" strokeWidth={2} />
                        <circle cx={c1.x} cy={c1.y} r={3.5} fill="#0ea5e9" />
                        <circle cx={c2.x} cy={c2.y} r={3.5} fill="#0ea5e9" />
                      </g>
                    );
                  }

                  if (drawing.kind === 'fib') {
                    const xLeft = Math.min(c1.x, c2.x);
                    const xRight = Math.max(c1.x + 80, Math.max(c1.x, c2.x));
                    const pStart = drawing.p1.price;
                    const pEnd = drawing.p2.price;
                    return (
                      <g key={drawing.id}>
                        {FIB_RATIOS.map((f) => {
                          const y = c1.y + (c2.y - c1.y) * f.ratio;
                          const levelPrice = pStart + (pEnd - pStart) * f.ratio;
                          return (
                            <g key={f.label}>
                              <line
                                x1={xLeft}
                                y1={y}
                                x2={xRight}
                                y2={y}
                                stroke={f.color}
                                strokeDasharray={f.ratio === 0 || f.ratio === 1 ? undefined : '4 3'}
                                strokeWidth={1.25}
                              />
                              <text
                                x={xLeft + 4}
                                y={y - 3}
                                fill={f.color}
                                fontSize="10"
                                fontFamily="ui-monospace, monospace"
                                fontWeight="600"
                              >
                                {f.label} ({formatNum(levelPrice)})
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  }

                  if (drawing.kind === 'long') {
                    const entry = drawing.p1.price;
                    const stop = drawing.p2.price;
                    const risk = Math.max(0.1, Math.abs(entry - stop));
                    const targetPrice = entry >= stop ? entry + risk * 2 : entry - risk * 2;
                    const series = mainSeriesRef.current;
                    const targetY = series?.priceToCoordinate(targetPrice) ?? c1.y - (c2.y - c1.y) * 2;
                    const boxW = Math.max(96, Math.abs(c2.x - c1.x));
                    const boxX = Math.min(c1.x, c2.x);
                    const profitTop = Math.min(c1.y, targetY);
                    const profitH = Math.max(4, Math.abs(c1.y - targetY));
                    const lossTop = Math.min(c1.y, c2.y);
                    const lossH = Math.max(4, Math.abs(c2.y - c1.y));
                    const riskPct = entry > 0 ? (risk / entry) * 100 : 0;
                    const rewardPct = entry > 0 ? ((risk * 2) / entry) * 100 : 0;
                    return (
                      <g key={drawing.id}>
                        <rect
                          x={boxX}
                          y={profitTop}
                          width={boxW}
                          height={profitH}
                          fill="rgba(16,185,129,0.16)"
                          stroke="#10b981"
                          strokeWidth={1}
                        />
                        <rect
                          x={boxX}
                          y={lossTop}
                          width={boxW}
                          height={lossH}
                          fill="rgba(239,68,68,0.16)"
                          stroke="#ef4444"
                          strokeWidth={1}
                        />
                        <line x1={boxX} y1={c1.y} x2={boxX + boxW} y2={c1.y} stroke="#0f172a" strokeWidth={1.5} />
                        <rect x={boxX + 4} y={profitTop + 4} width={154} height={16} rx={3} fill="#059669" />
                        <text
                          x={boxX + 9}
                          y={profitTop + 15}
                          fill="#ffffff"
                          fontSize="10"
                          fontFamily="ui-monospace, monospace"
                        >
                          TP {formatNum(targetPrice)} (+{rewardPct.toFixed(1)}% · 2R)
                        </text>
                        <rect x={boxX + 4} y={lossTop + lossH - 20} width={136} height={16} rx={3} fill="#dc2626" />
                        <text
                          x={boxX + 9}
                          y={lossTop + lossH - 9}
                          fill="#ffffff"
                          fontSize="10"
                          fontFamily="ui-monospace, monospace"
                        >
                          SL {formatNum(stop)} (-{riskPct.toFixed(1)}%)
                        </text>
                      </g>
                    );
                  }

                  const p1 = drawing.p1.price;
                  const p2 = drawing.p2.price;
                  const diff = p2 - p1;
                  const pct = p1 > 0 ? (diff / p1) * 100 : 0;
                  const i1 = barIndexMap.get(drawing.p1.time);
                  const i2 = barIndexMap.get(drawing.p2.time);
                  const barCount = i1 !== undefined && i2 !== undefined ? Math.abs(i2 - i1) : null;
                  const rx = Math.min(c1.x, c2.x);
                  const ry = Math.min(c1.y, c2.y);
                  const rw = Math.max(2, Math.abs(c2.x - c1.x));
                  const rh = Math.max(2, Math.abs(c2.y - c1.y));
                  const pos = diff >= 0;
                  return (
                    <g key={drawing.id}>
                      <rect
                        x={rx}
                        y={ry}
                        width={rw}
                        height={rh}
                        fill={pos ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'}
                        stroke={pos ? '#10b981' : '#ef4444'}
                        strokeDasharray="4 3"
                        strokeWidth={1}
                      />
                      <rect
                        x={rx + 4}
                        y={Math.max(4, ry - 20)}
                        width={barCount !== null ? 186 : 140}
                        height={18}
                        rx={3}
                        fill={pos ? '#059669' : '#dc2626'}
                      />
                      <text
                        x={rx + 9}
                        y={Math.max(16, ry - 8)}
                        fill="#ffffff"
                        fontSize="10"
                        fontFamily="ui-monospace, monospace"
                      >
                        {diff >= 0 ? '+' : ''}
                        {diff.toFixed(1)} ({pct >= 0 ? '+' : ''}
                        {pct.toFixed(1)}%)
                        {barCount !== null ? ` · ${barCount}b` : ''}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>

        {/* Collapsible Technical Analysis Sidebar */}
        {sidebarOpen && (
          <aside
            className={`w-full lg:w-64 shrink-0 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/70 dark:bg-slate-900/90 p-3 space-y-4 text-xs overflow-y-auto ${
              isFullscreen ? 'h-full' : 'max-h-[680px]'
            }`}
          >
            {isFullscreen && watchlist.length > 0 && onSelectSymbol && (
              <div className="space-y-1.5 border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="font-semibold text-slate-800 dark:text-slate-200">Watchlist</div>
                <div className="flex flex-wrap gap-1">
                  {watchlist.map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => onSelectSymbol(sym)}
                      className={`px-2 py-0.5 rounded font-mono text-[11px] border ${
                        sym === symbol
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                      }`}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 10-Indicator Technical Consensus */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                <span>Technical Summary</span>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    technicalConsensus.verdict.includes('Buy')
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : technicalConsensus.verdict.includes('Sell')
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {technicalConsensus.verdict}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-center font-mono tabular-nums text-[10px] bg-white dark:bg-slate-950 p-1.5 rounded border border-slate-200 dark:border-slate-800">
                <div>
                  <div className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {technicalConsensus.bull}
                  </div>
                  <div className="text-slate-400">Buy</div>
                </div>
                <div>
                  <div className="text-slate-600 dark:text-slate-300 font-semibold">
                    {technicalConsensus.neut}
                  </div>
                  <div className="text-slate-400">Neutral</div>
                </div>
                <div>
                  <div className="text-red-600 dark:text-red-400 font-semibold">
                    {technicalConsensus.bear}
                  </div>
                  <div className="text-slate-400">Sell</div>
                </div>
              </div>
            </div>

            {/* Active Indicators Stack */}
            <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                <span>Active ({activeIndicatorList.length})</span>
                <button
                  type="button"
                  onClick={() => setIndicatorsModalOpen(true)}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  + Browse {indicatorCatalog.length}
                </button>
              </div>
              {activeIndicatorList.length === 0 ? (
                <div className="text-[11px] text-slate-400">No active indicators.</div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {activeIndicatorList.map((ind) => (
                    <button
                      key={ind.id}
                      type="button"
                      onClick={() => toggleInd(ind.id)}
                      title={`Remove ${ind.label}`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-[10px] font-mono text-slate-700 dark:text-slate-200 hover:border-red-400 hover:text-red-600"
                    >
                      <span>{ind.shortLabel}</span>
                      <X className="w-2.5 h-2.5" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Indicator Toggles */}
            <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                <span>Quick Indicators</span>
                <InfoTip
                  title="67-Indicator Technical Library"
                  body="Toggle primary studies here or click Indicators in the toolbar for all 67 overlays, channels, pivots, momentum oscillators, and volume flow studies."
                  align="right"
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                {quickButtons.map((ind) => (
                  <button
                    key={ind.id}
                    type="button"
                    onClick={() => toggleInd(ind.id)}
                    className={`px-2 py-1.5 rounded border text-left font-medium truncate transition-colors ${
                      enabled[ind.id]
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {ind.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Oscillator Snapshot */}
            <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                Technical Snapshot
              </div>
              <div className="space-y-1 font-mono tabular-nums text-[11px] bg-white dark:bg-slate-950 p-2.5 rounded border border-slate-200 dark:border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-400">RSI(14)</span>
                  <span
                    className={
                      latestRsi !== null && latestRsi >= 70
                        ? 'text-red-600 dark:text-red-400 font-semibold'
                        : latestRsi !== null && latestRsi <= 30
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          : 'text-slate-700 dark:text-slate-200'
                    }
                  >
                    {latestRsi !== null ? latestRsi.toFixed(1) : '–'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">MACD(12,26)</span>
                  <span>{latestMacd !== null ? latestMacd.toFixed(2) : '–'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Stoch %K/%D</span>
                  <span>
                    {latestStochK !== null ? latestStochK.toFixed(1) : '–'} /{' '}
                    {latestStochD !== null ? latestStochD.toFixed(1) : '–'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">CCI(20)</span>
                  <span>{latestCci !== null ? latestCci.toFixed(0) : '–'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">MFI(14)</span>
                  <span>{latestMfi !== null ? latestMfi.toFixed(1) : '–'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Williams %R</span>
                  <span>{latestWillr !== null ? latestWillr.toFixed(1) : '–'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">ADX(14)</span>
                  <span>{latestAdx !== null ? latestAdx.toFixed(1) : '–'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">CMF(20)</span>
                  <span
                    className={
                      latestCmf !== null && latestCmf > 0.05
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : latestCmf !== null && latestCmf < -0.05
                          ? 'text-red-600 dark:text-red-400'
                          : ''
                    }
                  >
                    {latestCmf !== null ? latestCmf.toFixed(2) : '–'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Supertrend</span>
                  <span
                    className={
                      supertrendData.latestTrend === 'bullish'
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : supertrendData.latestTrend === 'bearish'
                          ? 'text-red-600 dark:text-red-400 font-semibold'
                          : ''
                    }
                  >
                    {supertrendData.latestTrend
                      ? `${supertrendData.latestTrend === 'bullish' ? 'Bull' : 'Bear'} ${
                          supertrendData.latestValue !== null
                            ? formatNum(supertrendData.latestValue)
                            : ''
                        }`
                      : '–'}
                  </span>
                </div>
                {pivotLevels && (
                  <div className="flex justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-slate-400">Pivot PP/R1/S1</span>
                    <span>
                      {formatNum(pivotLevels.pp)} / {formatNum(pivotLevels.r1)} /{' '}
                      {formatNum(pivotLevels.s1)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Support / Resistance & Scale */}
            <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                Levels &amp; Chart Settings
              </div>
              <div className="space-y-1.5 text-[11px]">
                {onToggleSR && (
                  <label className="flex items-center justify-between cursor-pointer text-slate-700 dark:text-slate-300">
                    <span>{lookbackDays}d Support &amp; Resistance</span>
                    <input
                      type="checkbox"
                      checked={showSR}
                      onChange={(e) => onToggleSR(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                  </label>
                )}
                <label className="flex items-center justify-between cursor-pointer text-slate-700 dark:text-slate-300">
                  <span>Classic Pivots (R3–S3)</span>
                  <input
                    type="checkbox"
                    checked={enabled.pivots}
                    onChange={() => toggleInd('pivots')}
                    className="rounded border-slate-300 text-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer text-slate-700 dark:text-slate-300">
                  <span>Fibonacci Pivots</span>
                  <input
                    type="checkbox"
                    checked={enabled.fibPivots}
                    onChange={() => toggleInd('fibPivots')}
                    className="rounded border-slate-300 text-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer text-slate-700 dark:text-slate-300">
                  <span>52-Week High / Low Lines</span>
                  <input
                    type="checkbox"
                    checked={show52wLines}
                    onChange={(e) => setShow52wLines(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer text-slate-700 dark:text-slate-300">
                  <span>Show Chart Gridlines</span>
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                </label>
              </div>
            </div>

            {/* Volume & N-Day Analysis */}
            {volAnalysis && (
              <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
                <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                  <span>Volume Analysis ({lookbackDays}d)</span>
                  <InfoTip
                    title="Volume & Turnover Multiples"
                    body={`Compares today's volume and turnover against the ${lookbackDays}-day rolling mean. Up/Down Ratio measures whether buyers or sellers control high-volume days.`}
                    align="right"
                  />
                </div>
                <div className="space-y-1 font-mono tabular-nums text-[11px] bg-white dark:bg-slate-950 p-2.5 rounded border border-slate-200 dark:border-slate-800">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Vol vs {lookbackDays}d Avg</span>
                    <span
                      className={
                        volAnalysis.volMult >= 1.5
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          : 'text-slate-700 dark:text-slate-200'
                      }
                    >
                      {volAnalysis.volMult.toFixed(2)}x
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Turn vs {lookbackDays}d Avg</span>
                    <span
                      className={
                        volAnalysis.turnMult >= 1.5
                          ? 'text-amber-600 dark:text-amber-400 font-semibold'
                          : 'text-slate-700 dark:text-slate-200'
                      }
                    >
                      {volAnalysis.turnMult.toFixed(2)}x
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{lookbackDays}d Avg Turn</span>
                    <span>{formatCrore(volAnalysis.avgTurn)} cr</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Up/Down Vol</span>
                    <span
                      className={
                        volAnalysis.upDownRatio >= 1.2
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          : volAnalysis.upDownRatio <= 0.8
                            ? 'text-red-600 dark:text-red-400 font-semibold'
                            : 'text-slate-700 dark:text-slate-200'
                      }
                    >
                      {volAnalysis.upDownRatio.toFixed(2)}x
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Saved Drawings List */}
            {drawings.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3">
                <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                  <span>Saved Drawings ({drawings.length})</span>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {drawings.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[10px] font-mono"
                    >
                      <span className="truncate">
                        {d.kind === 'hline'
                          ? `H-Line @ ${formatNum(d.p1.price)}`
                          : d.kind === 'vline'
                            ? `V-Line @ ${d.p1.time}`
                            : d.kind === 'note'
                              ? `Note: ${d.text || formatNum(d.p1.price)}`
                              : d.kind === 'fib'
                                ? `Fib ${formatNum(d.p1.price)} → ${formatNum(d.p2?.price ?? d.p1.price)}`
                                : d.kind === 'long'
                                  ? `Long E:${formatNum(d.p1.price)} SL:${formatNum(d.p2?.price ?? d.p1.price)}`
                                  : d.kind === 'ray'
                                    ? `Ray ${formatNum(d.p1.price)} → ${formatNum(d.p2?.price ?? d.p1.price)}`
                                    : d.kind === 'trend'
                                      ? `Trend ${formatNum(d.p1.price)} → ${formatNum(d.p2?.price ?? d.p1.price)}`
                                      : `Measure ${formatNum(d.p1.price)} → ${formatNum(d.p2?.price ?? d.p1.price)}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDrawings((prev) => prev.filter((x) => x.id !== d.id))}
                        className="text-slate-400 hover:text-red-600 shrink-0"
                        aria-label="Delete drawing"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Indicators Catalog Modal */}
      {indicatorsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onClick={() => setIndicatorsModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
                <Layers className="w-4 h-4 text-blue-600" />
                <span>
                  Technical Indicators Library ({indicatorCatalog.length} studies · {activeIndicatorList.length} active)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIndicatorsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Strategy Presets */}
            <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-slate-400 font-medium mr-1">Presets:</span>
              {INDICATOR_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.ids)}
                  className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Search + Category Tabs */}
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={indicatorSearch}
                  onChange={(e) => setIndicatorSearch(e.target.value)}
                  placeholder="Search 67 indicators: HMA, KAMA, Ichimoku, Parabolic SAR, Keltner, StochRSI, CCI, MFI, Fisher, CMF, Vortex…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex flex-wrap gap-1 text-[11px]">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setIndicatorCategory(cat)}
                    className={`px-2 py-1 rounded border transition-colors ${
                      indicatorCategory === cat
                        ? 'border-blue-600 bg-blue-600 text-white font-medium'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {filteredIndicators.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No indicators matched &ldquo;{indicatorSearch}&rdquo;.
                </div>
              ) : (
                filteredIndicators.map((ind) => (
                  <button
                    key={ind.id}
                    type="button"
                    onClick={() => toggleInd(ind.id)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {ind.label}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {ind.category} · {ind.pane}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{ind.desc}</p>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded text-[11px] font-medium shrink-0 ${
                        enabled[ind.id]
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-200 dark:border-slate-700 text-slate-500'
                      }`}
                    >
                      {enabled[ind.id] ? 'Active' : 'Add'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compare Symbol Modal */}
      {compareModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          onClick={() => setCompareModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
                <GitCompare className="w-4 h-4 text-amber-500" />
                <span>Compare Symbol (% Return Overlay)</span>
              </div>
              <button
                type="button"
                onClick={() => setCompareModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 border-b border-slate-100 dark:border-slate-800">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={compareSearch}
                  onChange={(e) => setCompareSearch(e.target.value)}
                  placeholder="Search NEPSE symbol to overlay…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {filteredCompareSymbols.map((s) => (
                <button
                  key={s.symbol}
                  type="button"
                  onClick={() => {
                    setCompareSymbol(s.symbol);
                    setScaleMode('percent');
                    setCompareModalOpen(false);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {s.symbol}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{s.name}</div>
                  </div>
                  <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium shrink-0">
                    Overlay
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!isFullscreen && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>
            Scroll/pinch to zoom · Drag to pan · 67 technical indicators &amp; presets · Magnet OHLC drawing rail · Replay or Full Screen
          </span>
          <span>TradingView Lightweight Charts · EOD NEPSE Data</span>
        </div>
      )}
    </div>
  );
});

TradingViewChart.displayName = 'TradingViewChart';

