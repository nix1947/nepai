import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  type Time,
} from 'lightweight-charts';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Maximize2,
  Minimize2,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Ruler,
  Search,
  Slash,
  Star,
  Trash2,
} from 'lucide-react';
import type { PriceRow, SymbolInfo } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';
import { InfoTip } from './InfoTip';

export interface ChartLevel {
  label: string;
  value: number;
  color: string;
}

type Timeframe = '1D' | '1W' | '1M';
type ZoomRange = '1M' | '3M' | '6M' | 'ALL';
type DrawTool = 'cursor' | 'hline' | 'trend' | 'measure';

interface SavedDrawing {
  id: string;
  kind: 'hline' | 'trend' | 'measure';
  p1: { time: string; price: number };
  p2?: { time: string; price: number };
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

interface BarPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  diff: number;
  diff_pct: number | null;
  vwap: number | null;
  d120: number | null;
  d180: number | null;
}

const DRAWINGS_STORAGE_KEY = 'nepse.chart.drawings.v1';

function loadDrawingsForSymbol(symbol: string): SavedDrawing[] {
  try {
    const raw = localStorage.getItem(DRAWINGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, SavedDrawing[]>;
    return Array.isArray(parsed[symbol]) ? parsed[symbol] : [];
  } catch {
    return [];
  }
}

function saveDrawingsForSymbol(symbol: string, list: SavedDrawing[]): void {
  try {
    const raw = localStorage.getItem(DRAWINGS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, SavedDrawing[]>) : {};
    parsed[symbol] = list;
    localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore storage quota
  }
}

function getMondayKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

function resampleBars(rows: PriceRow[], timeframe: Timeframe): BarPoint[] {
  const clean = rows.filter((r) => r.close > 0 && r.open > 0 && r.high > 0 && r.low > 0);
  if (timeframe === '1D') {
    return clean.map((r) => ({
      time: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      turnover: r.turnover,
      diff: r.diff,
      diff_pct: r.diff_pct,
      vwap: r.vwap && r.vwap > 0 ? r.vwap : null,
      d120: r.d120 && r.d120 > 0 ? r.d120 : null,
      d180: r.d180 && r.d180 > 0 ? r.d180 : null,
    }));
  }

  const buckets = new Map<string, PriceRow[]>();
  for (const r of clean) {
    const key = timeframe === '1W' ? getMondayKey(r.date) : `${r.date.slice(0, 7)}-01`;
    const list = buckets.get(key) || [];
    list.push(r);
    buckets.set(key, list);
  }

  const out: BarPoint[] = [];
  let prevBarClose: number | null = null;
  for (const [bucketKey, group] of buckets.entries()) {
    const first = group[0];
    const last = group[group.length - 1];
    const open = first.open;
    const high = Math.max(...group.map((g) => g.high));
    const low = Math.min(...group.map((g) => g.low));
    const close = last.close;
    const volume = group.reduce((s, g) => s + g.volume, 0);
    const turnover = group.reduce((s, g) => s + g.turnover, 0);
    const vwap = volume > 0 ? turnover / volume : null;
    const diff = prevBarClose !== null ? close - prevBarClose : close - open;
    const diff_pct =
      prevBarClose && prevBarClose > 0 ? ((close - prevBarClose) / prevBarClose) * 100 : last.diff_pct;
    prevBarClose = close;
    out.push({
      time: bucketKey,
      open,
      high,
      low,
      close,
      volume,
      turnover,
      diff,
      diff_pct,
      vwap,
      d120: last.d120 && last.d120 > 0 ? last.d120 : null,
      d180: last.d180 && last.d180 > 0 ? last.d180 : null,
    });
  }
  return out;
}

function calcSma(bars: BarPoint[], period: number): LineData<Time>[] {
  if (period < 2 || bars.length < period) return [];
  const res: LineData<Time>[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) {
      res.push({ time: bars[i].time as Time, value: Number((sum / period).toFixed(2)) });
    }
  }
  return res;
}

function calcEmaValues(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const res: number[] = new Array(values.length).fill(NaN);
  res[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    res[i] = ema;
  }
  return res;
}

function calcEma(bars: BarPoint[], period: number): LineData<Time>[] {
  const vals = calcEmaValues(bars.map((b) => b.close), period);
  const res: LineData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (!Number.isNaN(vals[i])) {
      res.push({ time: bars[i].time as Time, value: Number(vals[i].toFixed(2)) });
    }
  }
  return res;
}

function calcBollinger(
  bars: BarPoint[],
  period = 20,
  mult = 2
): { upper: LineData<Time>[]; lower: LineData<Time>[] } {
  const upper: LineData<Time>[] = [];
  const lower: LineData<Time>[] = [];
  if (bars.length < period) return { upper, lower };

  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, b) => s + b.close, 0) / period;
    const variance = slice.reduce((s, b) => s + (b.close - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const t = bars[i].time as Time;
    upper.push({ time: t, value: Number((mean + mult * sd).toFixed(2)) });
    lower.push({ time: t, value: Number((mean - mult * sd).toFixed(2)) });
  }
  return { upper, lower };
}

function calcRsi(bars: BarPoint[], period = 14): LineData<Time>[] {
  if (bars.length <= period) return [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = bars[i].close - bars[i - 1].close;
    if (delta > 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }
  avgGain /= period;
  avgLoss /= period;

  const out: LineData<Time>[] = [];
  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  out.push({ time: bars[period].time as Time, value: Number(firstRsi.toFixed(2)) });

  for (let i = period + 1; i < bars.length; i++) {
    const delta = bars[i].close - bars[i - 1].close;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    out.push({ time: bars[i].time as Time, value: Number(rsi.toFixed(2)) });
  }
  return out;
}

function calcMacd(bars: BarPoint[]): {
  macd: LineData<Time>[];
  signal: LineData<Time>[];
  hist: HistogramData<Time>[];
} {
  if (bars.length < 30) return { macd: [], signal: [], hist: [] };
  const closes = bars.map((b) => b.close);
  const ema12 = calcEmaValues(closes, 12);
  const ema26 = calcEmaValues(closes, 26);

  const macdRaw: Array<{ idx: number; val: number }> = [];
  for (let i = 0; i < bars.length; i++) {
    if (!Number.isNaN(ema12[i]) && !Number.isNaN(ema26[i])) {
      macdRaw.push({ idx: i, val: ema12[i] - ema26[i] });
    }
  }
  if (macdRaw.length < 9) return { macd: [], signal: [], hist: [] };

  const sigVals = calcEmaValues(macdRaw.map((m) => m.val), 9);
  const macd: LineData<Time>[] = [];
  const signal: LineData<Time>[] = [];
  const hist: HistogramData<Time>[] = [];

  for (let j = 0; j < macdRaw.length; j++) {
    const t = bars[macdRaw[j].idx].time as Time;
    const mVal = Number(macdRaw[j].val.toFixed(2));
    macd.push({ time: t, value: mVal });
    if (!Number.isNaN(sigVals[j])) {
      const sVal = Number(sigVals[j].toFixed(2));
      const hVal = Number((mVal - sVal).toFixed(2));
      signal.push({ time: t, value: sVal });
      hist.push({
        time: t,
        value: hVal,
        color: hVal >= 0 ? 'rgba(16, 185, 129, 0.55)' : 'rgba(239, 68, 68, 0.55)',
      });
    }
  }
  return { macd, signal, hist };
}

function calcLatestAtr(bars: BarPoint[], period = 14): number | null {
  if (bars.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
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
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [zoom, setZoom] = useState<ZoomRange>('ALL');
  const [showVolume, setShowVolume] = useState(true);
  const [showSmaN, setShowSmaN] = useState(true);
  const [showEma20, setShowEma20] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showMa120, setShowMa120] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(false);
  const [show52wLines, setShow52wLines] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  const [drawTool, setDrawTool] = useState<DrawTool>('cursor');
  const [pendingPoint, setPendingPoint] = useState<{ time: string; price: number } | null>(null);
  const [drawings, setDrawings] = useState<SavedDrawing[]>(() => loadDrawingsForSymbol(symbol));
  const [renderTick, setRenderTick] = useState(0);
  const [hovered, setHovered] = useState<BarPoint | null>(null);
  const [fsSearch, setFsSearch] = useState('');

  const drawToolRef = useRef<DrawTool>(drawTool);
  drawToolRef.current = drawTool;
  const pendingPointRef = useRef(pendingPoint);
  pendingPointRef.current = pendingPoint;

  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );

  useEffect(() => {
    setDrawings(loadDrawingsForSymbol(symbol));
    setPendingPoint(null);
  }, [symbol]);

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
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingPointRef.current) {
          setPendingPoint(null);
        } else if (drawToolRef.current !== 'cursor') {
          setDrawTool('cursor');
        } else {
          setIsFullscreen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const bars = useMemo(() => resampleBars(history, timeframe), [history, timeframe]);
  const barMap = useMemo(() => {
    const m = new Map<string, BarPoint>();
    for (const b of bars) m.set(b.time, b);
    return m;
  }, [bars]);

  const latestBar = bars[bars.length - 1] ?? null;
  const activeBar = hovered ?? latestBar;
  const latestRaw = history[history.length - 1] ?? null;

  const rsiData = useMemo(() => calcRsi(bars, 14), [bars]);
  const macdData = useMemo(() => calcMacd(bars), [bars]);
  const latestRsi = rsiData[rsiData.length - 1]?.value ?? null;
  const latestAtr = useMemo(() => calcLatestAtr(bars, 14), [bars]);

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

  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length === 0) return;

    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = showGrid
      ? isDark
        ? 'rgba(51, 65, 85, 0.35)'
        : 'rgba(226, 232, 240, 0.85)'
      : 'transparent';
    const borderColor = isDark ? '#1e293b' : '#e2e8f0';
    const bg = isDark ? '#0f172a' : '#ffffff';

    const defaultInlineH = 400 + (showRsi ? 95 : 0) + (showMacd ? 95 : 0);
    const initialH = isFullscreen
      ? Math.max(420, chartWrapRef.current?.clientHeight || window.innerHeight - 135)
      : defaultInlineH;

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
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: {
          top: 0.08,
          bottom: showVolume ? 0.24 : 0.06,
        },
      },
      timeScale: {
        borderColor,
        timeVisible: false,
        rightOffset: 4,
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(
      CandlestickSeries,
      {
        upColor: '#10b981',
        downColor: '#ef4444',
        borderUpColor: '#059669',
        borderDownColor: '#dc2626',
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      },
      0
    );
    candleSeriesRef.current = candleSeries;

    const candleData: CandlestickData<Time>[] = bars.map((b) => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    candleSeries.setData(candleData);

    // Support & Resistance levels
    if (showSR && levels.length > 0) {
      for (const lv of levels) {
        candleSeries.createPriceLine({
          price: lv.value,
          color: lv.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: lv.label,
        });
      }
    }

    // 52w High/Low optional lines
    if (show52wLines && latestRaw) {
      if (latestRaw.w52_high && latestRaw.w52_high > 0) {
        candleSeries.createPriceLine({
          price: latestRaw.w52_high,
          color: '#0ea5e9',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: '52w High',
        });
      }
      if (latestRaw.w52_low && latestRaw.w52_low > 0) {
        candleSeries.createPriceLine({
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
    for (const d of drawings) {
      if (d.kind === 'hline') {
        candleSeries.createPriceLine({
          price: d.p1.price,
          color: '#2563eb',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Line ${formatNum(d.p1.price)}`,
        });
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
      const volData: HistogramData<Time>[] = bars.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color:
          b.close >= b.open
            ? isDark
              ? 'rgba(16, 185, 129, 0.38)'
              : 'rgba(16, 185, 129, 0.45)'
            : isDark
              ? 'rgba(239, 68, 68, 0.38)'
              : 'rgba(239, 68, 68, 0.45)',
      }));
      volSeries.setData(volData);
    }

    if (showSmaN) {
      const smaData = calcSma(bars, lookbackDays);
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

    if (showEma20) {
      const emaData = calcEma(bars, 20);
      if (emaData.length > 0) {
        const emaSeries = chart.addSeries(
          LineSeries,
          {
            color: '#f59e0b',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: 'EMA(20)',
          },
          0
        );
        emaSeries.setData(emaData);
      }
    }

    if (showBollinger) {
      const bb = calcBollinger(bars, 20, 2);
      if (bb.upper.length > 0) {
        const upperS = chart.addSeries(
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
        );
        const lowerS = chart.addSeries(
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
        );
        upperS.setData(bb.upper);
        lowerS.setData(bb.lower);
      }
    }

    if (showVwap && timeframe === '1D') {
      const vwapData: LineData<Time>[] = bars
        .filter((b) => b.vwap !== null)
        .map((b) => ({ time: b.time as Time, value: Number(b.vwap!.toFixed(2)) }));
      if (vwapData.length > 0) {
        const vwapSeries = chart.addSeries(
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
        );
        vwapSeries.setData(vwapData);
      }
    }

    if (showMa120 && timeframe === '1D') {
      const d120Data: LineData<Time>[] = bars
        .filter((b) => b.d120 !== null)
        .map((b) => ({ time: b.time as Time, value: b.d120! }));
      const d180Data: LineData<Time>[] = bars
        .filter((b) => b.d180 !== null)
        .map((b) => ({ time: b.time as Time, value: b.d180! }));

      if (d120Data.length > 0) {
        const s120 = chart.addSeries(
          LineSeries,
          {
            color: '#8b5cf6',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            title: 'MA120',
          },
          0
        );
        s120.setData(d120Data);
      }
      if (d180Data.length > 0) {
        const s180 = chart.addSeries(
          LineSeries,
          {
            color: '#ec4899',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            title: 'MA180',
          },
          0
        );
        s180.setData(d180Data);
      }
    }

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
      const panes = chart.panes();
      if (panes[rsiPane]) panes[rsiPane].setHeight(95);
    }

    if (showMacd && macdData.macd.length > 0) {
      const macdPane = nextPane++;
      const histS = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        macdPane
      );
      const macdS = chart.addSeries(
        LineSeries,
        {
          color: '#2563eb',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'MACD',
        },
        macdPane
      );
      const sigS = chart.addSeries(
        LineSeries,
        {
          color: '#f97316',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'Sig(9)',
        },
        macdPane
      );
      histS.setData(macdData.hist);
      macdS.setData(macdData.macd);
      sigS.setData(macdData.signal);
      const panes = chart.panes();
      if (panes[macdPane]) panes[macdPane].setHeight(95);
    }

    // Visible range zoom
    if (zoom === 'ALL') {
      chart.timeScale().fitContent();
    } else {
      const approxBars =
        timeframe === '1D'
          ? zoom === '1M'
            ? 22
            : zoom === '3M'
              ? 65
              : 130
          : timeframe === '1W'
            ? zoom === '1M'
              ? 5
              : zoom === '3M'
                ? 13
                : 26
            : zoom === '1M'
              ? 2
              : zoom === '3M'
                ? 4
                : 6;
      const to = bars.length - 1;
      const from = Math.max(0, bars.length - approxBars);
      if (to > from) {
        chart.timeScale().setVisibleLogicalRange({ from, to: to + 1 });
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
      const tool = drawToolRef.current;
      if (tool === 'cursor' || !param.point || !param.time) return;
      const price = candleSeries.coordinateToPrice(param.point.y);
      if (price === null || !Number.isFinite(price)) return;
      const clickedTime = String(param.time);
      const roundedPrice = Number(price.toFixed(2));

      if (tool === 'hline') {
        setDrawings((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'hline',
            p1: { time: clickedTime, price: roundedPrice },
          },
        ]);
        setDrawTool('cursor');
      } else if (tool === 'trend' || tool === 'measure') {
        const anchor = pendingPointRef.current;
        if (!anchor) {
          setPendingPoint({ time: clickedTime, price: roundedPrice });
        } else {
          setDrawings((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: tool,
              p1: anchor,
              p2: { time: clickedTime, price: roundedPrice },
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
        ? Math.max(420, Math.floor(chartWrapRef.current?.clientHeight || rect.height))
        : defaultInlineH;
      if (nextW > 0) {
        chart.applyOptions({ width: nextW, height: nextH });
        triggerOverlaySync();
      }
    });
    ro.observe(chartWrapRef.current || el);

    // Trigger initial overlay projection after mount
    requestAnimationFrame(triggerOverlaySync);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [
    bars,
    barMap,
    drawings,
    isDark,
    isFullscreen,
    latestRaw,
    levels,
    logScale,
    lookbackDays,
    macdData,
    rsiData,
    show52wLines,
    showBollinger,
    showEma20,
    showGrid,
    showMa120,
    showMacd,
    showRsi,
    showSR,
    showSmaN,
    showVolume,
    showVwap,
    timeframe,
    triggerOverlaySync,
    zoom,
  ]);

  // Project trendlines & measure boxes onto SVG overlay
  const projectedOverlays = useMemo(() => {
    void renderTick;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || bars.length === 0) return [];

    const toCoords = (pt: { time: string; price: number }): { x: number; y: number } | null => {
      let x = chart.timeScale().timeToCoordinate(pt.time as Time);
      if (x === null) {
        // Fallback: closest bar date
        const nearest = bars.reduce((best, b) =>
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

    return drawings
      .filter((d) => (d.kind === 'trend' || d.kind === 'measure') && d.p2)
      .map((d) => {
        const c1 = toCoords(d.p1);
        const c2 = toCoords(d.p2!);
        if (!c1 || !c2) return null;
        return { drawing: d, c1, c2 };
      })
      .filter((x): x is { drawing: SavedDrawing; c1: { x: number; y: number }; c2: { x: number; y: number } } => x !== null);
  }, [drawings, bars, renderTick]);

  const filteredSwitchSymbols = useMemo(() => {
    const q = fsSearch.trim().toLowerCase();
    if (!q) return symbols;
    return symbols.filter(
      (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [symbols, fsSearch]);

  const stepSymbol = (dir: -1 | 1) => {
    if (!onSelectSymbol || symbols.length === 0) return;
    const idx = symbols.findIndex((s) => s.symbol === symbol);
    const nextIdx =
      idx === -1 ? 0 : (idx + dir + symbols.length) % symbols.length;
    onSelectSymbol(symbols[nextIdx].symbol);
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
    : 'border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3';

  return (
    <div className={wrapperClass}>
      {/* Top Toolbar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2.5 ${
          isFullscreen
            ? 'px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900'
            : 'border-b border-slate-100 dark:border-slate-800 pb-3'
        }`}
      >
        {/* Left: Symbol Switcher (seamless in full-screen) + Timeframe + Zoom */}
        <div className="flex flex-wrap items-center gap-2">
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
                  placeholder="Switch ticker…"
                  className="w-28 pl-6 pr-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
              <select
                value={symbol}
                onChange={(e) => onSelectSymbol(e.target.value)}
                aria-label="Switch active security"
                className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-blue-600 dark:text-blue-400 max-w-[170px]"
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
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 mr-1">
              {symbol} Interactive Chart
            </span>
          )}

          {/* Timeframe Switcher */}
          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[11px]">
            {(['1D', '1W', '1M'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 rounded font-mono font-medium transition-colors ${
                  timeframe === tf
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Zoom Range */}
          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[11px]">
            {(['1M', '3M', '6M', 'ALL'] as ZoomRange[]).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                className={`px-2 py-1 rounded font-mono font-medium transition-colors ${
                  zoom === z
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {z}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Drawing Tools + Sidebar Toggle + Fullscreen */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
            {(
              [
                { id: 'cursor', label: 'Crosshair', icon: Crosshair },
                { id: 'hline', label: 'H-Line', icon: Minus },
                { id: 'trend', label: 'Trendline', icon: Slash },
                { id: 'measure', label: 'Measure', icon: Ruler },
              ] as Array<{ id: DrawTool; label: string; icon: React.ComponentType<{ className?: string }> }>
            ).map((t) => {
              const Icon = t.icon;
              const active = drawTool === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setDrawTool(t.id);
                    setPendingPoint(null);
                  }}
                  title={t.label}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded font-medium transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span className="hidden md:inline">{t.label}</span>
                </button>
              );
            })}
          </div>

          {drawings.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setDrawings([]);
                setPendingPoint(null);
              }}
              title="Clear all drawings on this symbol"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear ({drawings.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 dark:bg-blue-600 text-white hover:opacity-90 transition-opacity font-medium"
            title={isFullscreen ? 'Exit Full-Screen (Esc)' : 'Open Full-Screen Chart Terminal'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit Full Screen</span>
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

      {/* Live OHLCV + Drawing Hint Bar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300 ${
          isFullscreen ? 'px-4 py-1.5 border-b border-slate-100 dark:border-slate-900' : ''
        }`}
      >
        {activeBar && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{activeBar.time}</span>
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
          </div>
        )}

        <div className="flex items-center gap-3">
          {drawTool !== 'cursor' && (
            <span className="text-blue-600 dark:text-blue-400 font-sans font-medium">
              {drawTool === 'hline'
                ? 'Click chart to place Horizontal S/R Line'
                : pendingPoint
                  ? `Anchor 1 set (${pendingPoint.time} @ ${formatNum(pendingPoint.price)}) — click Anchor 2`
                  : `Click chart to set Anchor 1 for ${drawTool === 'trend' ? 'Trendline' : 'Price Range'}`}
            </span>
          )}
          {latestRsi !== null && showRsi && (
            <span className="text-indigo-600 dark:text-indigo-400">
              RSI(14): <span className="font-semibold">{latestRsi.toFixed(1)}</span>
            </span>
          )}
          {latestAtr !== null && (
            <span className="text-slate-500 dark:text-slate-400">
              ATR(14): <span className="font-semibold">{formatNum(latestAtr)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Chart + Collapsible Technical Analysis Sidebar */}
      <div className={`flex flex-col lg:flex-row gap-3 ${isFullscreen ? 'flex-1 min-h-0 px-4 pb-3 pt-1' : ''}`}>
        {/* Chart Canvas + SVG Drawings Overlay */}
        <div
          ref={chartWrapRef}
          className={`relative flex-1 min-w-0 overflow-hidden rounded border border-slate-100 dark:border-slate-800/80 ${
            isFullscreen ? 'h-full' : ''
          }`}
        >
          <div ref={containerRef} className="w-full h-full" />

          {/* Interactive SVG Overlay for Trendlines & Measure Boxes */}
          {projectedOverlays.length > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
              {projectedOverlays.map(({ drawing, c1, c2 }) => {
                if (drawing.kind === 'trend') {
                  return (
                    <g key={drawing.id}>
                      <line
                        x1={c1.x}
                        y1={c1.y}
                        x2={c2.x}
                        y2={c2.y}
                        stroke="#2563eb"
                        strokeWidth={2}
                      />
                      <circle cx={c1.x} cy={c1.y} r={3.5} fill="#2563eb" />
                      <circle cx={c2.x} cy={c2.y} r={3.5} fill="#2563eb" />
                    </g>
                  );
                }
                const p1 = drawing.p1.price;
                const p2 = drawing.p2!.price;
                const diff = p2 - p1;
                const pct = p1 > 0 ? (diff / p1) * 100 : 0;
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
                      width={138}
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
                      {diff >= 0 ? '+' : ''}{diff.toFixed(1)} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Collapsible Technical Analysis Sidebar */}
        {sidebarOpen && (
          <aside
            className={`w-full lg:w-64 shrink-0 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/70 dark:bg-slate-900/90 p-3 space-y-4 text-xs overflow-y-auto ${
              isFullscreen ? 'h-full' : 'max-h-[590px]'
            }`}
          >
            {/* Watchlist Quick Switch in Sidebar */}
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

            {/* Indicators */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                <span>Technical Indicators</span>
                <InfoTip
                  title="Technical Indicator Overlays"
                  body="SMA(N) tracks your configured N-day average close. EMA(20) reacts faster to recent swings. Bollinger(20,2) shows volatility squeezes. RSI(14) & MACD gauge momentum."
                  align="right"
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                {[
                  { label: 'Volume', active: showVolume, toggle: () => setShowVolume((v) => !v) },
                  { label: `SMA(${lookbackDays})`, active: showSmaN, toggle: () => setShowSmaN((v) => !v) },
                  { label: 'EMA(20)', active: showEma20, toggle: () => setShowEma20((v) => !v) },
                  { label: 'BB(20,2)', active: showBollinger, toggle: () => setShowBollinger((v) => !v) },
                  { label: 'VWAP', active: showVwap, toggle: () => setShowVwap((v) => !v) },
                  { label: 'MA120/180', active: showMa120, toggle: () => setShowMa120((v) => !v) },
                  { label: 'RSI(14)', active: showRsi, toggle: () => setShowRsi((v) => !v) },
                  { label: 'MACD', active: showMacd, toggle: () => setShowMacd((v) => !v) },
                ].map((ind) => (
                  <button
                    key={ind.label}
                    type="button"
                    onClick={ind.toggle}
                    className={`px-2 py-1.5 rounded border text-left font-medium transition-colors ${
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
                  <span>52-Week High / Low Lines</span>
                  <input
                    type="checkbox"
                    checked={show52wLines}
                    onChange={(e) => setShow52wLines(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer text-slate-700 dark:text-slate-300">
                  <span>Logarithmic Price Scale</span>
                  <input
                    type="checkbox"
                    checked={logScale}
                    onChange={(e) => setLogScale(e.target.checked)}
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
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {drawings.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[10px] font-mono"
                    >
                      <span className="truncate">
                        {d.kind === 'hline'
                          ? `H-Line @ ${formatNum(d.p1.price)}`
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

      {!isFullscreen && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>
            Scroll/pinch to zoom · Drag to pan · Use drawing tools &amp; collapsible TA sidebar · Toggle Full Screen for terminal view
          </span>
          <span>TradingView Lightweight Charts (Open-Source · EOD NEPSE Data)</span>
        </div>
      )}
    </div>
  );
};
