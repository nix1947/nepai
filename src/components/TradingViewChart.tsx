import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts';
import type { PriceRow } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

export interface ChartLevel {
  label: string;
  value: number;
  color: string;
}

type Timeframe = '1D' | '1W' | '1M';
type ZoomRange = '1M' | '3M' | '6M' | 'ALL';

interface TradingViewChartProps {
  symbol: string;
  history: PriceRow[];
  lookbackDays: number;
  levels?: ChartLevel[];
  showSR?: boolean;
}

interface BarPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  diff_pct: number | null;
  vwap: number | null;
  d120: number | null;
  d180: number | null;
}

function getMondayKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0=Sun, 1=Mon
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

function calcEma(bars: BarPoint[], period: number): LineData<Time>[] {
  if (bars.length < period) return [];
  const k = 2 / (period + 1);
  let ema = bars.slice(0, period).reduce((s, b) => s + b.close, 0) / period;
  const res: LineData<Time>[] = [{ time: bars[period - 1].time as Time, value: Number(ema.toFixed(2)) }];
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    res.push({ time: bars[i].time as Time, value: Number(ema.toFixed(2)) });
  }
  return res;
}

function calcBollinger(
  bars: BarPoint[],
  period = 20,
  mult = 2
): { upper: LineData<Time>[]; mid: LineData<Time>[]; lower: LineData<Time>[] } {
  const upper: LineData<Time>[] = [];
  const mid: LineData<Time>[] = [];
  const lower: LineData<Time>[] = [];
  if (bars.length < period) return { upper, mid, lower };

  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, b) => s + b.close, 0) / period;
    const variance = slice.reduce((s, b) => s + (b.close - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const t = bars[i].time as Time;
    upper.push({ time: t, value: Number((mean + mult * sd).toFixed(2)) });
    mid.push({ time: t, value: Number(mean.toFixed(2)) });
    lower.push({ time: t, value: Number((mean - mult * sd).toFixed(2)) });
  }
  return { upper, mid, lower };
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

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
  symbol,
  history,
  lookbackDays,
  levels = [],
  showSR = true,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [zoom, setZoom] = useState<ZoomRange>('ALL');
  const [showVolume, setShowVolume] = useState(true);
  const [showSmaN, setShowSmaN] = useState(true);
  const [showEma20, setShowEma20] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVwap, setShowVwap] = useState(false);
  const [showMa120, setShowMa120] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [hovered, setHovered] = useState<BarPoint | null>(null);
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const bars = useMemo(() => resampleBars(history, timeframe), [history, timeframe]);

  const barMap = useMemo(() => {
    const m = new Map<string, BarPoint>();
    for (const b of bars) m.set(b.time, b);
    return m;
  }, [bars]);

  const latestBar = bars[bars.length - 1] ?? null;
  const activeBar = hovered ?? latestBar;

  const rsiData = useMemo(() => calcRsi(bars, 14), [bars]);
  const latestRsi = rsiData[rsiData.length - 1]?.value ?? null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length === 0) return;

    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(51, 65, 85, 0.35)' : 'rgba(226, 232, 240, 0.85)';
    const borderColor = isDark ? '#1e293b' : '#e2e8f0';
    const bg = isDark ? '#0f172a' : '#ffffff';

    const chart = createChart(el, {
      width: el.clientWidth,
      height: showRsi ? 470 : 370,
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

    const candleData: CandlestickData<Time>[] = bars.map((b) => ({
      time: b.time as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    candleSeries.setData(candleData);

    // Support & Resistance horizontal lines
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

    // SMA(N) using configurable lookbackDays
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

    // EMA(20)
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

    // Bollinger Bands (20, 2)
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

    // VWAP (1D)
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

    // MA120 & MA180 (ShareSansar feed)
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

    // RSI(14) in pane 1
    let rsiSeries: ISeriesApi<'Line', Time> | null = null;
    if (showRsi && rsiData.length > 0) {
      rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: '#6366f1',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'RSI(14)',
        },
        1
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
      if (panes.length > 1) {
        panes[1].setHeight(105);
      }
    }

    // Visible range zoom
    const applyZoom = (z: ZoomRange) => {
      if (z === 'ALL') {
        chart.timeScale().fitContent();
        return;
      }
      const approxBars =
        timeframe === '1D'
          ? z === '1M'
            ? 22
            : z === '3M'
              ? 65
              : 130
          : timeframe === '1W'
            ? z === '1M'
              ? 5
              : z === '3M'
                ? 13
                : 26
            : z === '1M'
              ? 2
              : z === '3M'
                ? 4
                : 6;
      const to = bars.length - 1;
      const from = Math.max(0, bars.length - approxBars);
      if (to > from) {
        chart.timeScale().setVisibleLogicalRange({ from, to: to + 1 });
      } else {
        chart.timeScale().fitContent();
      }
    };
    applyZoom(zoom);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || typeof param.time !== 'string') {
        setHovered(null);
        return;
      }
      setHovered(barMap.get(param.time) ?? null);
    });

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) chart.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [
    bars,
    barMap,
    isDark,
    levels,
    lookbackDays,
    rsiData,
    showBollinger,
    showEma20,
    showMa120,
    showRsi,
    showSR,
    showSmaN,
    showVolume,
    showVwap,
    timeframe,
    zoom,
  ]);

  if (history.length === 0) {
    return (
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
        No price history available for {symbol}.
      </div>
    );
  }

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
      {/* Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 mr-1">
            {symbol} Interactive Chart
          </span>

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

        {/* Indicator Toggles */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {[
            { label: 'Volume', active: showVolume, toggle: () => setShowVolume((v) => !v), color: 'text-slate-700 dark:text-slate-200' },
            { label: `SMA(${lookbackDays})`, active: showSmaN, toggle: () => setShowSmaN((v) => !v), color: 'text-blue-600 dark:text-blue-400' },
            { label: 'EMA(20)', active: showEma20, toggle: () => setShowEma20((v) => !v), color: 'text-amber-600 dark:text-amber-400' },
            { label: 'BB(20,2)', active: showBollinger, toggle: () => setShowBollinger((v) => !v), color: 'text-slate-600 dark:text-slate-300' },
            { label: 'VWAP', active: showVwap, toggle: () => setShowVwap((v) => !v), color: 'text-cyan-600 dark:text-cyan-400' },
            { label: 'MA120/180', active: showMa120, toggle: () => setShowMa120((v) => !v), color: 'text-violet-600 dark:text-violet-400' },
            { label: 'RSI(14)', active: showRsi, toggle: () => setShowRsi((v) => !v), color: 'text-indigo-600 dark:text-indigo-400' },
          ].map((ind) => (
            <button
              key={ind.label}
              type="button"
              onClick={ind.toggle}
              className={`px-2 py-1 rounded border transition-colors font-medium whitespace-nowrap ${
                ind.active
                  ? `border-blue-500/60 bg-blue-50/70 dark:bg-blue-950/40 ${ind.color}`
                  : 'border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {ind.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live OHLCV Crosshair Readout */}
      {activeBar && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{activeBar.time}</span>
            <span>
              O <span className="text-slate-900 dark:text-slate-100">{formatNum(activeBar.open)}</span>
            </span>
            <span>
              H <span className="text-slate-900 dark:text-slate-100">{formatNum(activeBar.high)}</span>
            </span>
            <span>
              L <span className="text-slate-900 dark:text-slate-100">{formatNum(activeBar.low)}</span>
            </span>
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
          {latestRsi !== null && showRsi && (
            <div className="text-indigo-600 dark:text-indigo-400">
              Latest RSI(14): <span className="font-semibold">{latestRsi.toFixed(1)}</span>
            </div>
          )}
        </div>
      )}

      {/* Lightweight Charts Canvas */}
      <div ref={containerRef} className="w-full overflow-hidden rounded border border-slate-100 dark:border-slate-800/80" />

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>
          Scroll/pinch to zoom · Drag to pan · Hover candles for OHLCV &amp; indicator values
        </span>
        <span>TradingView Lightweight Charts (Free Open-Source · ShareSansar NEPSE Data)</span>
      </div>
    </div>
  );
};
