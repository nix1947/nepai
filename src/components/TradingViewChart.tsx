import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  calcAdx,
  calcAtrSeries,
  calcBollinger,
  calcClassicPivots,
  calcEma,
  calcMacd,
  calcObv,
  calcRsi,
  calcSma,
  calcStochastic,
  calcSupertrend,
  resampleBars,
  toHeikinAshiCandles,
  type BarPoint,
  type ChartTimeframe,
} from '../utils/chartIndicators';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';
import { InfoTip } from './InfoTip';

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

interface IndicatorOption {
  id: string;
  label: string;
  category: 'Overlay' | 'Oscillator';
  desc: string;
  active: boolean;
  toggle: () => void;
}

const DRAWINGS_STORAGE_KEY_V2 = 'nepse.chart.drawings.v2';
const DRAWINGS_STORAGE_KEY_V1 = 'nepse.chart.drawings.v1';
const FIB_RATIOS = [
  { ratio: 0, label: '0.0%', color: '#64748b' },
  { ratio: 0.236, label: '23.6%', color: '#0ea5e9' },
  { ratio: 0.382, label: '38.2%', color: '#10b981' },
  { ratio: 0.5, label: '50.0%', color: '#f59e0b' },
  { ratio: 0.618, label: '61.8%', color: '#2563eb' },
  { ratio: 0.786, label: '78.6%', color: '#8b5cf6' },
  { ratio: 1, label: '100%', color: '#ef4444' },
];

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

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
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
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<SeriesType, Time> | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chartStyle, setChartStyle] = useState<ChartStyle>('candles');
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1D');
  const [zoom, setZoom] = useState<ZoomRange>('ALL');
  const [scaleMode, setScaleMode] = useState<ScaleMode>('normal');
  const [showGrid, setShowGrid] = useState(true);

  // Overlays
  const [showVolume, setShowVolume] = useState(true);
  const [showSmaN, setShowSmaN] = useState(true);
  const [showEma9, setShowEma9] = useState(false);
  const [showEma20, setShowEma20] = useState(false);
  const [showEma50, setShowEma50] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showSupertrend, setShowSupertrend] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showMa120, setShowMa120] = useState(true);
  const [showPivots, setShowPivots] = useState(false);
  const [show52wLines, setShow52wLines] = useState(false);

  // Oscillator Sub-panes
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);
  const [showStoch, setShowStoch] = useState(false);
  const [showAdx, setShowAdx] = useState(false);
  const [showAtr, setShowAtr] = useState(false);
  const [showObv, setShowObv] = useState(false);

  // Popovers & Advanced Modes
  const [indicatorsModalOpen, setIndicatorsModalOpen] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState('');
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

  // Fetch comparison symbol OHLCV when selected
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

  // Replay playback timer
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

  // Computed Indicators
  const rsiData = useMemo(() => calcRsi(visibleBars, 14), [visibleBars]);
  const macdData = useMemo(() => calcMacd(visibleBars), [visibleBars]);
  const stochData = useMemo(() => calcStochastic(visibleBars, 14, 3, 3), [visibleBars]);
  const adxData = useMemo(() => calcAdx(visibleBars, 14), [visibleBars]);
  const atrSeries = useMemo(() => calcAtrSeries(visibleBars, 14), [visibleBars]);
  const obvData = useMemo(() => calcObv(visibleBars), [visibleBars]);
  const supertrendData = useMemo(() => calcSupertrend(visibleBars, 10, 3), [visibleBars]);
  const pivotLevels = useMemo(() => calcClassicPivots(visibleBars), [visibleBars]);

  const latestRsi = rsiData[rsiData.length - 1]?.value ?? null;
  const latestAtr = atrSeries[atrSeries.length - 1]?.value ?? null;
  const latestMacd = macdData.macd[macdData.macd.length - 1]?.value ?? null;
  const latestStochK = stochData.k[stochData.k.length - 1]?.value ?? null;
  const latestStochD = stochData.d[stochData.d.length - 1]?.value ?? null;
  const latestAdx = adxData.adx[adxData.adx.length - 1]?.value ?? null;

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

  const triggerOverlaySync = useCallback(() => {
    setRenderTick((t) => (t + 1) % 1000000);
  }, []);

  const activePaneCount =
    (showRsi ? 1 : 0) +
    (showMacd ? 1 : 0) +
    (showStoch ? 1 : 0) +
    (showAdx ? 1 : 0) +
    (showAtr ? 1 : 0) +
    (showObv ? 1 : 0);

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

    const subPaneHeight = 88;
    const defaultInlineH = 430 + activePaneCount * subPaneHeight;
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
          bottom: showVolume ? 0.24 : 0.06,
        },
      },
      timeScale: {
        borderColor,
        timeVisible: false,
        rightOffset: 6,
      },
    });
    chartRef.current = chart;

    // Main Price Series according to selected TradingView Chart Style
    let mainSeries: ISeriesApi<SeriesType, Time>;
    if (chartStyle === 'bars') {
      const s = chart.addSeries(
        BarSeries,
        {
          upColor: '#10b981',
          downColor: '#ef4444',
          thinBars: false,
        },
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
      const s = chart.addSeries(
        LineSeries,
        {
          color: '#2563eb',
          lineWidth: 2,
        },
        0
      );
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

    // Comparison Overlay Symbol
    if (compareSymbol && compareBars.length > 0) {
      const visibleTimeSet = new Set(visibleBars.map((b) => b.time));
      const aligned = compareBars
        .filter((b) => visibleTimeSet.has(b.time))
        .map((b) => ({ time: b.time as Time, value: b.close }));
      if (aligned.length > 0) {
        const cmpSeries = chart.addSeries(
          LineSeries,
          {
            color: '#f59e0b',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: compareSymbol,
          },
          0
        );
        cmpSeries.setData(aligned);
      }
    }

    // Support & Resistance levels
    if (showSR && levels.length > 0 && effectivePriceScaleMode !== PriceScaleMode.Percentage) {
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

    // Classic Pivot Points overlay
    if (showPivots && pivotLevels && effectivePriceScaleMode !== PriceScaleMode.Percentage) {
      const pDefs = [
        { title: 'R2', price: pivotLevels.r2, color: '#ef4444' },
        { title: 'R1', price: pivotLevels.r1, color: '#f97316' },
        { title: 'PP', price: pivotLevels.pp, color: '#64748b' },
        { title: 'S1', price: pivotLevels.s1, color: '#10b981' },
        { title: 'S2', price: pivotLevels.s2, color: '#059669' },
      ];
      for (const p of pDefs) {
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

    // 52w High/Low optional lines
    if (show52wLines && latestRaw && effectivePriceScaleMode !== PriceScaleMode.Percentage) {
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

    // User horizontal drawings as native price lines
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

    // Volume histogram on pane 0 overlay scale
    if (showVolume) {
      const volSeries = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        },
        0
      );
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
      });
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

    // Overlay Moving Averages & Bands
    if (showSmaN) {
      const smaData = calcSma(visibleBars, lookbackDays);
      if (smaData.length > 0) {
        const smaSeries = chart.addSeries(
          LineSeries,
          {
            color: '#2563eb',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: `SMA(${lookbackDays})`,
          },
          0
        );
        smaSeries.setData(smaData);
      }
    }

    if (showEma9) {
      const ema9 = calcEma(visibleBars, 9);
      if (ema9.length > 0) {
        chart
          .addSeries(
            LineSeries,
            {
              color: '#14b8a6',
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: true,
              title: 'EMA(9)',
            },
            0
          )
          .setData(ema9);
      }
    }

    if (showEma20) {
      const ema20 = calcEma(visibleBars, 20);
      if (ema20.length > 0) {
        chart
          .addSeries(
            LineSeries,
            {
              color: '#f59e0b',
              lineWidth: 2,
              priceLineVisible: false,
              lastValueVisible: true,
              title: 'EMA(20)',
            },
            0
          )
          .setData(ema20);
      }
    }

    if (showEma50) {
      const ema50 = calcEma(visibleBars, 50);
      if (ema50.length > 0) {
        chart
          .addSeries(
            LineSeries,
            {
              color: '#a855f7',
              lineWidth: 2,
              priceLineVisible: false,
              lastValueVisible: true,
              title: 'EMA(50)',
            },
            0
          )
          .setData(ema50);
      }
    }

    if (showBollinger) {
      const bb = calcBollinger(visibleBars, 20, 2);
      if (bb.upper.length > 0) {
        chart
          .addSeries(
            LineSeries,
            {
              color: 'rgba(148, 163, 184, 0.85)',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              priceLineVisible: false,
              lastValueVisible: false,
              title: 'BB Upper',
            },
            0
          )
          .setData(bb.upper);
        chart
          .addSeries(
            LineSeries,
            {
              color: 'rgba(148, 163, 184, 0.85)',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              priceLineVisible: false,
              lastValueVisible: false,
              title: 'BB Lower',
            },
            0
          )
          .setData(bb.lower);
      }
    }

    if (showSupertrend && supertrendData.up.length > 0) {
      chart
        .addSeries(
          LineSeries,
          {
            color: '#10b981',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            title: 'ST Up',
          },
          0
        )
        .setData(supertrendData.up);
      chart
        .addSeries(
          LineSeries,
          {
            color: '#ef4444',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            title: 'ST Down',
          },
          0
        )
        .setData(supertrendData.down);
    }

    if (showVwap && timeframe === '1D') {
      const vwapData: LineData<Time>[] = visibleBars
        .filter((b) => b.vwap !== null)
        .map((b) => ({ time: b.time as Time, value: Number(b.vwap!.toFixed(2)) }));
      if (vwapData.length > 0) {
        chart
          .addSeries(
            LineSeries,
            {
              color: '#06b6d4',
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              priceLineVisible: false,
              lastValueVisible: true,
              title: 'VWAP',
            },
            0
          )
          .setData(vwapData);
      }
    }

    if (showMa120 && timeframe === '1D') {
      const d120Data = visibleBars
        .filter((b) => b.d120 !== null)
        .map((b) => ({ time: b.time as Time, value: b.d120! }));
      const d180Data = visibleBars
        .filter((b) => b.d180 !== null)
        .map((b) => ({ time: b.time as Time, value: b.d180! }));

      if (d120Data.length > 0) {
        chart
          .addSeries(
            LineSeries,
            {
              color: '#8b5cf6',
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
              title: 'MA120',
            },
            0
          )
          .setData(d120Data);
      }
      if (d180Data.length > 0) {
        chart
          .addSeries(
            LineSeries,
            {
              color: '#ec4899',
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
              title: 'MA180',
            },
            0
          )
          .setData(d180Data);
      }
    }

    // Oscillator Sub-panes
    let nextPane = 1;
    if (showRsi && rsiData.length > 0) {
      const rsiPane = nextPane++;
      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: '#6366f1',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'RSI(14)',
        },
        rsiPane
      );
      rsiSeries.setData(rsiData);
      rsiSeries.createPriceLine({
        price: 70,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '70',
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '30',
      });
      chart.panes()[rsiPane]?.setHeight(subPaneHeight);
    }

    if (showMacd && macdData.macd.length > 0) {
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

    if (showStoch && stochData.k.length > 0) {
      const stochPane = nextPane++;
      const kS = chart.addSeries(
        LineSeries,
        { color: '#0ea5e9', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: '%K' },
        stochPane
      );
      const dS = chart.addSeries(
        LineSeries,
        { color: '#f97316', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: '%D' },
        stochPane
      );
      kS.setData(stochData.k);
      dS.setData(stochData.d);
      kS.createPriceLine({ price: 80, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '80' });
      kS.createPriceLine({ price: 20, color: '#10b981', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '20' });
      chart.panes()[stochPane]?.setHeight(subPaneHeight);
    }

    if (showAdx && adxData.adx.length > 0) {
      const adxPane = nextPane++;
      const adxS = chart.addSeries(
        LineSeries,
        { color: '#eab308', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'ADX' },
        adxPane
      );
      adxS.setData(adxData.adx);
      chart
        .addSeries(
          LineSeries,
          { color: '#10b981', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: '+DI' },
          adxPane
        )
        .setData(adxData.plusDi);
      chart
        .addSeries(
          LineSeries,
          { color: '#ef4444', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: '-DI' },
          adxPane
        )
        .setData(adxData.minusDi);
      adxS.createPriceLine({ price: 25, color: '#64748b', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '25' });
      chart.panes()[adxPane]?.setHeight(subPaneHeight);
    }

    if (showAtr && atrSeries.length > 0) {
      const atrPane = nextPane++;
      chart
        .addSeries(
          LineSeries,
          { color: '#ec4899', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'ATR(14)' },
          atrPane
        )
        .setData(atrSeries);
      chart.panes()[atrPane]?.setHeight(subPaneHeight);
    }

    if (showObv && obvData.length > 0) {
      const obvPane = nextPane++;
      chart
        .addSeries(
          LineSeries,
          { color: '#14b8a6', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'OBV' },
          obvPane
        )
        .setData(obvData);
      chart.panes()[obvPane]?.setHeight(subPaneHeight);
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
    chartStyle,
    compareBars,
    compareSymbol,
    drawings,
    fullBars,
    hideDrawings,
    isDark,
    isFullscreen,
    latestRaw,
    levels,
    lookbackDays,
    macdData,
    obvData,
    pivotLevels,
    replayMode,
    rsiData,
    scaleMode,
    show52wLines,
    showAdx,
    showAtr,
    showBollinger,
    showEma20,
    showEma50,
    showEma9,
    showGrid,
    showMa120,
    showMacd,
    showObv,
    showPivots,
    showRsi,
    showSR,
    showSmaN,
    showStoch,
    showSupertrend,
    showVolume,
    showVwap,
    stochData,
    supertrendData,
    timeframe,
    triggerOverlaySync,
    visibleBars,
    zoom,
  ]);

  // Project vector drawings onto SVG overlay
  const projectedOverlays = useMemo(() => {
    void renderTick;
    const chart = chartRef.current;
    const series = mainSeriesRef.current;
    const wrapW = chartWrapRef.current?.clientWidth || 900;
    const wrapH = chartWrapRef.current?.clientHeight || 430;
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

  const indicatorCatalog: IndicatorOption[] = useMemo(
    () => [
      { id: 'vol', label: 'Volume', category: 'Overlay', desc: 'Session share volume histogram', active: showVolume, toggle: () => setShowVolume((v) => !v) },
      { id: 'smaN', label: `SMA (${lookbackDays})`, category: 'Overlay', desc: `${lookbackDays}-period simple moving average`, active: showSmaN, toggle: () => setShowSmaN((v) => !v) },
      { id: 'ema9', label: 'EMA (9)', category: 'Overlay', desc: 'Fast 9-period exponential trendline', active: showEma9, toggle: () => setShowEma9((v) => !v) },
      { id: 'ema20', label: 'EMA (20)', category: 'Overlay', desc: 'Swing 20-period exponential average', active: showEma20, toggle: () => setShowEma20((v) => !v) },
      { id: 'ema50', label: 'EMA (50)', category: 'Overlay', desc: 'Medium-term 50-period institutional baseline', active: showEma50, toggle: () => setShowEma50((v) => !v) },
      { id: 'bb', label: 'Bollinger Bands (20, 2)', category: 'Overlay', desc: '2-sigma volatility bands for squeezes & breakouts', active: showBollinger, toggle: () => setShowBollinger((v) => !v) },
      { id: 'st', label: 'Supertrend (10, 3)', category: 'Overlay', desc: 'ATR trailing trend & stop-flip line', active: showSupertrend, toggle: () => setShowSupertrend((v) => !v) },
      { id: 'vwap', label: 'VWAP (1D)', category: 'Overlay', desc: 'Volume-weighted average execution price', active: showVwap, toggle: () => setShowVwap((v) => !v) },
      { id: 'ma120', label: 'MA 120 / 180 (1D)', category: 'Overlay', desc: 'ShareSansar 120-day & 180-day moving averages', active: showMa120, toggle: () => setShowMa120((v) => !v) },
      { id: 'pivots', label: 'Pivot Points (Classic)', category: 'Overlay', desc: 'PP, R1, R2, S1, S2 from previous completed bar', active: showPivots, toggle: () => setShowPivots((v) => !v) },
      { id: 'rsi', label: 'RSI (14)', category: 'Oscillator', desc: 'Relative Strength Index with 70/30 thresholds', active: showRsi, toggle: () => setShowRsi((v) => !v) },
      { id: 'macd', label: 'MACD (12, 26, 9)', category: 'Oscillator', desc: 'Trend momentum convergence/divergence & histogram', active: showMacd, toggle: () => setShowMacd((v) => !v) },
      { id: 'stoch', label: 'Stochastic (14, 3, 3)', category: 'Oscillator', desc: '%K / %D momentum oscillator with 80/20 zones', active: showStoch, toggle: () => setShowStoch((v) => !v) },
      { id: 'adx', label: 'ADX / DMI (14)', category: 'Oscillator', desc: 'Trend strength (ADX) + directional +DI / -DI', active: showAdx, toggle: () => setShowAdx((v) => !v) },
      { id: 'atr', label: 'ATR (14)', category: 'Oscillator', desc: 'Average True Range volatility pane in NPR', active: showAtr, toggle: () => setShowAtr((v) => !v) },
      { id: 'obv', label: 'On-Balance Volume (OBV)', category: 'Oscillator', desc: 'Cumulative volume flow for accumulation/distribution', active: showObv, toggle: () => setShowObv((v) => !v) },
    ],
    [
      lookbackDays,
      showAdx,
      showAtr,
      showBollinger,
      showEma20,
      showEma50,
      showEma9,
      showMa120,
      showMacd,
      showObv,
      showPivots,
      showRsi,
      showSmaN,
      showStoch,
      showSupertrend,
      showVolume,
      showVwap,
    ]
  );

  const filteredIndicators = useMemo(() => {
    const q = indicatorSearch.trim().toLowerCase();
    if (!q) return indicatorCatalog;
    return indicatorCatalog.filter(
      (i) => i.label.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)
    );
  }, [indicatorCatalog, indicatorSearch]);

  const activeIndicatorCount = indicatorCatalog.filter((i) => i.active).length;

  const stepSymbol = (dir: -1 | 1) => {
    if (!onSelectSymbol || symbols.length === 0) return;
    const idx = symbols.findIndex((s) => s.symbol === symbol);
    const nextIdx = idx === -1 ? 0 : (idx + dir + symbols.length) % symbols.length;
    onSelectSymbol(symbols[nextIdx].symbol);
  };

  const handleDownloadSnapshot = () => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const canvas = chart.takeScreenshot();
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${symbol}-${timeframe}-chart.png`;
      a.click();
    } catch {
      // ignore snapshot failure
    }
  };

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
        {/* Left: Symbol Switcher + Timeframes + Chart Style + Indicators + Compare + Replay */}
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
            <span>Indicators ({activeIndicatorCount})</span>
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

        {/* Right: Zoom Ranges + Scale + Screenshot + Sidebar + Fullscreen */}
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
            onClick={handleDownloadSnapshot}
            title="Save chart snapshot PNG"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Camera className="w-3 h-3" />
            <span className="hidden xl:inline">PNG</span>
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
          {showSupertrend && supertrendData.latestTrend && (
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
          {latestRsi !== null && showRsi && (
            <span className="text-indigo-600 dark:text-indigo-400">
              RSI(14): <span className="font-semibold">{latestRsi.toFixed(1)}</span>
            </span>
          )}
          {latestStochK !== null && showStoch && (
            <span className="text-sky-600 dark:text-sky-400">
              Stoch: {latestStochK.toFixed(1)}/{latestStochD?.toFixed(1) ?? '–'}
            </span>
          )}
          {latestAdx !== null && showAdx && (
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

      {/* Main Terminal Grid: Left Drawing Rail + Center Chart Canvas + Right TA Sidebar */}
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

          {/* Chart Canvas + Advanced SVG Vector Drawings Overlay */}
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
                <button
                  type="submit"
                  className="px-2 py-0.5 rounded bg-blue-600 text-white font-medium"
                >
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

            {/* SVG Overlay for Trendlines, Rays, Vertical Lines, Fibs, Long Position, Measure, Notes */}
            {projectedOverlays.items.length > 0 && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
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
                        <line
                          x1={c1.x}
                          y1={c1.y}
                          x2={endX}
                          y2={endY}
                          stroke="#0ea5e9"
                          strokeWidth={2}
                        />
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
                        <line
                          x1={boxX}
                          y1={c1.y}
                          x2={boxX + boxW}
                          y2={c1.y}
                          stroke="#0f172a"
                          strokeWidth={1.5}
                        />
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

                  // Price Range / Measure
                  const p1 = drawing.p1.price;
                  const p2 = drawing.p2.price;
                  const diff = p2 - p1;
                  const pct = p1 > 0 ? (diff / p1) * 100 : 0;
                  const i1 = barIndexMap.get(drawing.p1.time);
                  const i2 = barIndexMap.get(drawing.p2.time);
                  const barCount =
                    i1 !== undefined && i2 !== undefined ? Math.abs(i2 - i1) : null;
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
              isFullscreen ? 'h-full' : 'max-h-[620px]'
            }`}
          >
            {/* Watchlist Quick Switch in Full Screen */}
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

            {/* Quick Indicator Toggles */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                <span>Quick Indicators</span>
                <InfoTip
                  title="TradingView Technical Suite"
                  body="Toggle primary overlays & sub-panes here, or open the searchable Indicators menu above for EMA(9/50), Supertrend, Pivots, Stochastic, ADX, ATR, and OBV."
                  align="right"
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                {[
                  { label: 'Volume', active: showVolume, toggle: () => setShowVolume((v) => !v) },
                  { label: `SMA(${lookbackDays})`, active: showSmaN, toggle: () => setShowSmaN((v) => !v) },
                  { label: 'EMA(20)', active: showEma20, toggle: () => setShowEma20((v) => !v) },
                  { label: 'EMA(50)', active: showEma50, toggle: () => setShowEma50((v) => !v) },
                  { label: 'Supertrend', active: showSupertrend, toggle: () => setShowSupertrend((v) => !v) },
                  { label: 'BB(20,2)', active: showBollinger, toggle: () => setShowBollinger((v) => !v) },
                  { label: 'VWAP', active: showVwap, toggle: () => setShowVwap((v) => !v) },
                  { label: 'MA120/180', active: showMa120, toggle: () => setShowMa120((v) => !v) },
                  { label: 'RSI(14)', active: showRsi, toggle: () => setShowRsi((v) => !v) },
                  { label: 'MACD', active: showMacd, toggle: () => setShowMacd((v) => !v) },
                  { label: 'Stoch(14)', active: showStoch, toggle: () => setShowStoch((v) => !v) },
                  { label: 'ADX(14)', active: showAdx, toggle: () => setShowAdx((v) => !v) },
                ].map((ind) => (
                  <button
                    key={ind.label}
                    type="button"
                    onClick={ind.toggle}
                    className={`px-2 py-1.5 rounded border text-left font-medium truncate transition-colors ${
                      ind.active
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
                  <span className="text-slate-400">ADX(14)</span>
                  <span>{latestAdx !== null ? latestAdx.toFixed(1) : '–'}</span>
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
                  <span>Classic Pivot Points (R2–S2)</span>
                  <input
                    type="checkbox"
                    checked={showPivots}
                    onChange={(e) => setShowPivots(e.target.checked)}
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
            className="w-full max-w-lg rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
                <Layers className="w-4 h-4 text-blue-600" />
                <span>Indicators &amp; Oscillators</span>
              </div>
              <button
                type="button"
                onClick={() => setIndicatorsModalOpen(false)}
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
                  value={indicatorSearch}
                  onChange={(e) => setIndicatorSearch(e.target.value)}
                  placeholder="Search SMA, EMA, Supertrend, Bollinger, RSI, MACD, Stochastic, ADX, OBV…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {filteredIndicators.map((ind) => (
                <button
                  key={ind.id}
                  type="button"
                  onClick={ind.toggle}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {ind.label}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">{ind.category}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{ind.desc}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-medium shrink-0 ${
                      ind.active
                        ? 'bg-blue-600 text-white'
                        : 'border border-slate-200 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    {ind.active ? 'Active' : 'Add'}
                  </span>
                </button>
              ))}
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
            Scroll/pinch to zoom · Drag to pan · Use left drawing rail (Magnet OHLC snap, Fib, Long R:R, Rays) · Replay or Full Screen
          </span>
          <span>TradingView Lightweight Charts · EOD NEPSE Data</span>
        </div>
      )}
    </div>
  );
};
