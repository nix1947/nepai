import type {
  CandlestickData,
  HistogramData,
  LineData,
  Time,
  WhitespaceData,
} from 'lightweight-charts';
import type { PriceRow } from '../types/market';

export type ChartTimeframe = '1D' | '1W' | '1M';

export interface BarPoint {
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

export type SeriesOrGap = LineData<Time> | WhitespaceData<Time>;

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function getMondayKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

export function resampleBars(rows: PriceRow[], timeframe: ChartTimeframe): BarPoint[] {
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

export function toHeikinAshiCandles(bars: BarPoint[]): CandlestickData<Time>[] {
  const out: CandlestickData<Time>[] = [];
  let prevHaOpen = 0;
  let prevHaClose = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = i === 0 ? (b.open + b.close) / 2 : (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);
    prevHaOpen = haOpen;
    prevHaClose = haClose;
    out.push({
      time: b.time as Time,
      open: round2(haOpen),
      high: round2(haHigh),
      low: round2(haLow),
      close: round2(haClose),
    });
  }
  return out;
}

function calcSmaValues(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period < 1 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function calcWmaValues(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period < 1 || values.length < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let weighted = 0;
    let valid = true;
    for (let j = 0; j < period; j++) {
      const v = values[i - period + 1 + j];
      if (Number.isNaN(v)) {
        valid = false;
        break;
      }
      weighted += v * (j + 1);
    }
    if (valid) out[i] = weighted / denom;
  }
  return out;
}

export function calcEmaValues(values: number[], period: number): number[] {
  const res = new Array<number>(values.length).fill(NaN);
  if (period < 1 || values.length < period) return res;
  let start = -1;
  for (let i = 0; i <= values.length - period; i++) {
    let ok = true;
    for (let j = 0; j < period; j++) {
      if (Number.isNaN(values[i + j])) {
        ok = false;
        break;
      }
    }
    if (ok) {
      start = i;
      break;
    }
  }
  if (start === -1) return res;

  const k = 2 / (period + 1);
  let ema = 0;
  for (let j = 0; j < period; j++) ema += values[start + j];
  ema /= period;
  res[start + period - 1] = ema;
  for (let i = start + period; i < values.length; i++) {
    if (Number.isNaN(values[i])) continue;
    ema = values[i] * k + ema * (1 - k);
    res[i] = ema;
  }
  return res;
}

function calcSmmaValues(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period < 1 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

function toLineSeries(bars: BarPoint[], vals: number[], decimals = 2): LineData<Time>[] {
  const out: LineData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    const v = vals[i];
    if (Number.isFinite(v)) {
      out.push({ time: bars[i].time as Time, value: Number(v.toFixed(decimals)) });
    }
  }
  return out;
}

export function calcSma(bars: BarPoint[], period: number): LineData<Time>[] {
  if (period < 2) return [];
  return toLineSeries(bars, calcSmaValues(bars.map((b) => b.close), period));
}

export function calcEma(bars: BarPoint[], period: number): LineData<Time>[] {
  return toLineSeries(bars, calcEmaValues(bars.map((b) => b.close), period));
}

export function calcWma(bars: BarPoint[], period = 20): LineData<Time>[] {
  return toLineSeries(bars, calcWmaValues(bars.map((b) => b.close), period));
}

export function calcHma(bars: BarPoint[], period = 20): LineData<Time>[] {
  const closes = bars.map((b) => b.close);
  const half = Math.max(1, Math.floor(period / 2));
  const sqrtP = Math.max(1, Math.floor(Math.sqrt(period)));
  const wHalf = calcWmaValues(closes, half);
  const wFull = calcWmaValues(closes, period);
  const diff = closes.map((_, i) =>
    Number.isFinite(wHalf[i]) && Number.isFinite(wFull[i]) ? 2 * wHalf[i] - wFull[i] : NaN
  );
  return toLineSeries(bars, calcWmaValues(diff, sqrtP));
}

export function calcDema(bars: BarPoint[], period = 20): LineData<Time>[] {
  const e1 = calcEmaValues(bars.map((b) => b.close), period);
  const e2 = calcEmaValues(e1, period);
  const out = e1.map((v, i) => (Number.isFinite(v) && Number.isFinite(e2[i]) ? 2 * v - e2[i] : NaN));
  return toLineSeries(bars, out);
}

export function calcTema(bars: BarPoint[], period = 20): LineData<Time>[] {
  const e1 = calcEmaValues(bars.map((b) => b.close), period);
  const e2 = calcEmaValues(e1, period);
  const e3 = calcEmaValues(e2, period);
  const out = e1.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(e2[i]) && Number.isFinite(e3[i])
      ? 3 * v - 3 * e2[i] + e3[i]
      : NaN
  );
  return toLineSeries(bars, out);
}

export function calcKama(
  bars: BarPoint[],
  period = 10,
  fastPeriod = 2,
  slowPeriod = 30
): LineData<Time>[] {
  if (bars.length <= period) return [];
  const fastSc = 2 / (fastPeriod + 1);
  const slowSc = 2 / (slowPeriod + 1);
  const out = new Array<number>(bars.length).fill(NaN);
  let kama = bars[period].close;
  out[period] = kama;
  for (let i = period + 1; i < bars.length; i++) {
    const change = Math.abs(bars[i].close - bars[i - period].close);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) {
      volatility += Math.abs(bars[j].close - bars[j - 1].close);
    }
    const er = volatility > 0 ? change / volatility : 0;
    const sc = (er * (fastSc - slowSc) + slowSc) ** 2;
    kama = kama + sc * (bars[i].close - kama);
    out[i] = kama;
  }
  return toLineSeries(bars, out);
}

export function calcVwma(bars: BarPoint[], period = 20): LineData<Time>[] {
  if (bars.length < period) return [];
  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = period - 1; i < bars.length; i++) {
    let pv = 0;
    let vol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      pv += bars[j].close * bars[j].volume;
      vol += bars[j].volume;
    }
    if (vol > 0) out[i] = pv / vol;
  }
  return toLineSeries(bars, out);
}

export function calcAlma(
  bars: BarPoint[],
  window = 9,
  offset = 0.85,
  sigma = 6
): LineData<Time>[] {
  if (bars.length < window) return [];
  const m = offset * (window - 1);
  const s = window / sigma;
  const weights: number[] = [];
  let wSum = 0;
  for (let i = 0; i < window; i++) {
    const w = Math.exp(-((i - m) ** 2) / (2 * s * s));
    weights.push(w);
    wSum += w;
  }
  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = window - 1; i < bars.length; i++) {
    let acc = 0;
    for (let j = 0; j < window; j++) {
      acc += bars[i - window + 1 + j].close * weights[j];
    }
    out[i] = acc / wSum;
  }
  return toLineSeries(bars, out);
}

export function calcMcGinley(bars: BarPoint[], period = 14): LineData<Time>[] {
  if (bars.length < period) return [];
  const out = new Array<number>(bars.length).fill(NaN);
  let md = bars[period - 1].close;
  out[period - 1] = md;
  for (let i = period; i < bars.length; i++) {
    const c = bars[i].close;
    const ratio = md > 0 ? c / md : 1;
    const denom = 0.6 * period * Math.pow(Math.max(0.1, ratio), 4);
    md = md + (c - md) / Math.max(1, denom);
    out[i] = md;
  }
  return toLineSeries(bars, out);
}

export function calcRollingVwap(bars: BarPoint[], period = 20): LineData<Time>[] {
  if (bars.length < 2) return [];
  const out = new Array<number>(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    const start = Math.max(0, i - period + 1);
    let pv = 0;
    let vol = 0;
    for (let j = start; j <= i; j++) {
      const tp = (bars[j].high + bars[j].low + bars[j].close) / 3;
      pv += tp * bars[j].volume;
      vol += bars[j].volume;
    }
    if (vol > 0) out[i] = pv / vol;
  }
  return toLineSeries(bars, out);
}

export function calcBollinger(
  bars: BarPoint[],
  period = 20,
  mult = 2
): { upper: LineData<Time>[]; basis: LineData<Time>[]; lower: LineData<Time>[] } {
  const upper: LineData<Time>[] = [];
  const basis: LineData<Time>[] = [];
  const lower: LineData<Time>[] = [];
  if (bars.length < period) return { upper, basis, lower };

  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, b) => s + b.close, 0) / period;
    const variance = slice.reduce((s, b) => s + (b.close - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const t = bars[i].time as Time;
    upper.push({ time: t, value: round2(mean + mult * sd) });
    basis.push({ time: t, value: round2(mean) });
    lower.push({ time: t, value: round2(mean - mult * sd) });
  }
  return { upper, basis, lower };
}

export function calcAtrValues(bars: BarPoint[], period = 14): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length <= period) return out;
  const trs = new Array<number>(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += trs[i];
  atr /= period;
  out[period] = atr;
  for (let i = period + 1; i < bars.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    out[i] = atr;
  }
  return out;
}

export function calcAtrSeries(bars: BarPoint[], period = 14): LineData<Time>[] {
  return toLineSeries(bars, calcAtrValues(bars, period));
}

export function calcKeltner(
  bars: BarPoint[],
  emaPeriod = 20,
  mult = 2,
  atrPeriod = 10
): { upper: LineData<Time>[]; basis: LineData<Time>[]; lower: LineData<Time>[] } {
  const ema = calcEmaValues(bars.map((b) => b.close), emaPeriod);
  const atr = calcAtrValues(bars, atrPeriod);
  const upper: LineData<Time>[] = [];
  const basis: LineData<Time>[] = [];
  const lower: LineData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (Number.isFinite(ema[i]) && Number.isFinite(atr[i])) {
      const t = bars[i].time as Time;
      upper.push({ time: t, value: round2(ema[i] + mult * atr[i]) });
      basis.push({ time: t, value: round2(ema[i]) });
      lower.push({ time: t, value: round2(ema[i] - mult * atr[i]) });
    }
  }
  return { upper, basis, lower };
}

export function calcDonchian(
  bars: BarPoint[],
  period = 20
): { upper: LineData<Time>[]; mid: LineData<Time>[]; lower: LineData<Time>[] } {
  const upper: LineData<Time>[] = [];
  const mid: LineData<Time>[] = [];
  const lower: LineData<Time>[] = [];
  if (bars.length < period) return { upper, mid, lower };
  for (let i = period - 1; i < bars.length; i++) {
    const win = bars.slice(i - period + 1, i + 1);
    const hh = Math.max(...win.map((w) => w.high));
    const ll = Math.min(...win.map((w) => w.low));
    const t = bars[i].time as Time;
    upper.push({ time: t, value: round2(hh) });
    mid.push({ time: t, value: round2((hh + ll) / 2) });
    lower.push({ time: t, value: round2(ll) });
  }
  return { upper, mid, lower };
}

export function calcEnvelope(
  bars: BarPoint[],
  period = 20,
  pct = 0.05
): { upper: LineData<Time>[]; lower: LineData<Time>[] } {
  const sma = calcSmaValues(bars.map((b) => b.close), period);
  const upper: LineData<Time>[] = [];
  const lower: LineData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (Number.isFinite(sma[i])) {
      const t = bars[i].time as Time;
      upper.push({ time: t, value: round2(sma[i] * (1 + pct)) });
      lower.push({ time: t, value: round2(sma[i] * (1 - pct)) });
    }
  }
  return { upper, lower };
}

export function calcSupertrend(
  bars: BarPoint[],
  period = 10,
  mult = 3
): {
  up: SeriesOrGap[];
  down: SeriesOrGap[];
  latestTrend: 'bullish' | 'bearish' | null;
  latestValue: number | null;
} {
  if (bars.length <= period + 1) {
    return { up: [], down: [], latestTrend: null, latestValue: null };
  }

  const atr = calcAtrValues(bars, period);
  const finalUpper: number[] = new Array(bars.length).fill(NaN);
  const finalLower: number[] = new Array(bars.length).fill(NaN);
  const dir: Array<'bullish' | 'bearish' | null> = new Array(bars.length).fill(null);

  for (let i = period; i < bars.length; i++) {
    if (!Number.isFinite(atr[i])) continue;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const basicUpper = hl2 + mult * atr[i];
    const basicLower = hl2 - mult * atr[i];

    if (i === period || !Number.isFinite(finalUpper[i - 1])) {
      finalUpper[i] = basicUpper;
      finalLower[i] = basicLower;
      dir[i] = bars[i].close >= hl2 ? 'bullish' : 'bearish';
      continue;
    }

    finalUpper[i] =
      basicUpper < finalUpper[i - 1] || bars[i - 1].close > finalUpper[i - 1]
        ? basicUpper
        : finalUpper[i - 1];
    finalLower[i] =
      basicLower > finalLower[i - 1] || bars[i - 1].close < finalLower[i - 1]
        ? basicLower
        : finalLower[i - 1];

    const prevDir = dir[i - 1];
    if (prevDir === 'bullish') {
      dir[i] = bars[i].close < finalLower[i] ? 'bearish' : 'bullish';
    } else {
      dir[i] = bars[i].close > finalUpper[i] ? 'bullish' : 'bearish';
    }
  }

  const up: SeriesOrGap[] = [];
  const down: SeriesOrGap[] = [];
  let latestTrend: 'bullish' | 'bearish' | null = null;
  let latestValue: number | null = null;

  for (let i = period; i < bars.length; i++) {
    const t = bars[i].time as Time;
    if (dir[i] === 'bullish') {
      const v = round2(finalLower[i]);
      up.push({ time: t, value: v });
      down.push({ time: t });
      latestTrend = 'bullish';
      latestValue = v;
    } else if (dir[i] === 'bearish') {
      const v = round2(finalUpper[i]);
      down.push({ time: t, value: v });
      up.push({ time: t });
      latestTrend = 'bearish';
      latestValue = v;
    }
  }

  return { up, down, latestTrend, latestValue };
}

export function calcParabolicSar(
  bars: BarPoint[],
  step = 0.02,
  maxStep = 0.2
): { up: SeriesOrGap[]; down: SeriesOrGap[] } {
  if (bars.length < 4) return { up: [], down: [] };
  const up: SeriesOrGap[] = [];
  const down: SeriesOrGap[] = [];

  let isUp = bars[1].close >= bars[0].close;
  let af = step;
  let ep = isUp ? Math.max(bars[0].high, bars[1].high) : Math.min(bars[0].low, bars[1].low);
  let sar = isUp ? Math.min(bars[0].low, bars[1].low) : Math.max(bars[0].high, bars[1].high);

  for (let i = 2; i < bars.length; i++) {
    const prev1 = bars[i - 1];
    const prev2 = bars[i - 2];
    const cur = bars[i];
    const t = cur.time as Time;

    sar = sar + af * (ep - sar);
    if (isUp) {
      sar = Math.min(sar, prev1.low, prev2.low);
      if (cur.low < sar) {
        isUp = false;
        sar = ep;
        ep = cur.low;
        af = step;
      } else {
        if (cur.high > ep) {
          ep = cur.high;
          af = Math.min(maxStep, af + step);
        }
      }
    } else {
      sar = Math.max(sar, prev1.high, prev2.high);
      if (cur.high > sar) {
        isUp = true;
        sar = ep;
        ep = cur.high;
        af = step;
      } else {
        if (cur.low < ep) {
          ep = cur.low;
          af = Math.min(maxStep, af + step);
        }
      }
    }

    if (isUp) {
      up.push({ time: t, value: round2(sar) });
      down.push({ time: t });
    } else {
      down.push({ time: t, value: round2(sar) });
      up.push({ time: t });
    }
  }

  return { up, down };
}

export function calcIchimoku(
  bars: BarPoint[],
  tenkanP = 9,
  kijunP = 26,
  senkouBP = 52
): {
  tenkan: LineData<Time>[];
  kijun: LineData<Time>[];
  spanA: LineData<Time>[];
  spanB: LineData<Time>[];
  chikou: LineData<Time>[];
  latestSignal: 'bullish' | 'bearish' | 'neutral';
} {
  const n = bars.length;
  const tenkanRaw = new Array<number>(n).fill(NaN);
  const kijunRaw = new Array<number>(n).fill(NaN);
  const spanBRaw = new Array<number>(n).fill(NaN);

  const midHL = (idx: number, p: number): number => {
    if (idx < p - 1) return NaN;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = idx - p + 1; j <= idx; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    return (hh + ll) / 2;
  };

  for (let i = 0; i < n; i++) {
    tenkanRaw[i] = midHL(i, tenkanP);
    kijunRaw[i] = midHL(i, kijunP);
    spanBRaw[i] = midHL(i, senkouBP);
  }

  const tenkan = toLineSeries(bars, tenkanRaw);
  const kijun = toLineSeries(bars, kijunRaw);

  const spanA: LineData<Time>[] = [];
  const spanB: LineData<Time>[] = [];
  const chikou: LineData<Time>[] = [];

  for (let i = 0; i < n; i++) {
    const srcIdx = i - kijunP;
    if (srcIdx >= 0 && Number.isFinite(tenkanRaw[srcIdx]) && Number.isFinite(kijunRaw[srcIdx])) {
      spanA.push({
        time: bars[i].time as Time,
        value: round2((tenkanRaw[srcIdx] + kijunRaw[srcIdx]) / 2),
      });
    }
    if (srcIdx >= 0 && Number.isFinite(spanBRaw[srcIdx])) {
      spanB.push({
        time: bars[i].time as Time,
        value: round2(spanBRaw[srcIdx]),
      });
    }
    if (i + kijunP < n) {
      chikou.push({
        time: bars[i].time as Time,
        value: round2(bars[i + kijunP].close),
      });
    }
  }

  let latestSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  const lastClose = bars[n - 1]?.close;
  const lastA = spanA[spanA.length - 1]?.value;
  const lastB = spanB[spanB.length - 1]?.value;
  if (lastClose && lastA !== undefined && lastB !== undefined) {
    const top = Math.max(lastA, lastB);
    const bot = Math.min(lastA, lastB);
    if (lastClose > top) latestSignal = 'bullish';
    else if (lastClose < bot) latestSignal = 'bearish';
  }

  return { tenkan, kijun, spanA, spanB, chikou, latestSignal };
}

export function calcAlligator(bars: BarPoint[]): {
  jaw: LineData<Time>[];
  teeth: LineData<Time>[];
  lips: LineData<Time>[];
} {
  const hl2 = bars.map((b) => (b.high + b.low) / 2);
  const jawRaw = calcSmmaValues(hl2, 13);
  const teethRaw = calcSmmaValues(hl2, 8);
  const lipsRaw = calcSmmaValues(hl2, 5);

  const shiftOntoBars = (arr: number[], shift: number): LineData<Time>[] => {
    const out: LineData<Time>[] = [];
    for (let i = shift; i < bars.length; i++) {
      const v = arr[i - shift];
      if (Number.isFinite(v)) out.push({ time: bars[i].time as Time, value: round2(v) });
    }
    return out;
  };

  return {
    jaw: shiftOntoBars(jawRaw, 8),
    teeth: shiftOntoBars(teethRaw, 5),
    lips: shiftOntoBars(lipsRaw, 3),
  };
}

export function calcLinearRegressionChannel(
  bars: BarPoint[],
  length = 50,
  stdMult = 2
): { mid: LineData<Time>[]; upper: LineData<Time>[]; lower: LineData<Time>[] } {
  if (bars.length < 10) return { mid: [], upper: [], lower: [] };
  const n = Math.min(length, bars.length);
  const start = bars.length - n;
  const slice = bars.slice(start);

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += slice[i].close;
    sumXY += i * slice[i].close;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  let errSq = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * i;
    errSq += (slice[i].close - pred) ** 2;
  }
  const stdErr = Math.sqrt(errSq / n);

  const mid: LineData<Time>[] = [];
  const upper: LineData<Time>[] = [];
  const lower: LineData<Time>[] = [];
  for (let i = 0; i < n; i++) {
    const t = slice[i].time as Time;
    const m = intercept + slope * i;
    mid.push({ time: t, value: round2(m) });
    upper.push({ time: t, value: round2(m + stdMult * stdErr) });
    lower.push({ time: t, value: round2(m - stdMult * stdErr) });
  }
  return { mid, upper, lower };
}

export function calcZigZag(bars: BarPoint[], deviationPct = 5): LineData<Time>[] {
  if (bars.length < 5) return [];
  const threshold = deviationPct / 100;
  const pivots: Array<{ idx: number; price: number }> = [];

  let dir = 0; // 1 = seeking high, -1 = seeking low
  let lastIdx = 0;
  let lastPrice = bars[0].close;

  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    if (dir === 0) {
      if ((h - lastPrice) / lastPrice >= threshold) {
        pivots.push({ idx: lastIdx, price: lastPrice });
        dir = 1;
        lastIdx = i;
        lastPrice = h;
      } else if ((lastPrice - l) / lastPrice >= threshold) {
        pivots.push({ idx: lastIdx, price: lastPrice });
        dir = -1;
        lastIdx = i;
        lastPrice = l;
      }
    } else if (dir === 1) {
      if (h >= lastPrice) {
        lastIdx = i;
        lastPrice = h;
      } else if ((lastPrice - l) / lastPrice >= threshold) {
        pivots.push({ idx: lastIdx, price: lastPrice });
        dir = -1;
        lastIdx = i;
        lastPrice = l;
      }
    } else {
      if (l <= lastPrice) {
        lastIdx = i;
        lastPrice = l;
      } else if ((h - lastPrice) / lastPrice >= threshold) {
        pivots.push({ idx: lastIdx, price: lastPrice });
        dir = 1;
        lastIdx = i;
        lastPrice = h;
      }
    }
  }
  pivots.push({ idx: lastIdx, price: lastPrice });

  return pivots.map((p) => ({
    time: bars[p.idx].time as Time,
    value: round2(p.price),
  }));
}

export function calcRsi(bars: BarPoint[], period = 14): LineData<Time>[] {
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
  out.push({ time: bars[period].time as Time, value: round2(firstRsi) });

  for (let i = period + 1; i < bars.length; i++) {
    const delta = bars[i].close - bars[i - 1].close;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    out.push({ time: bars[i].time as Time, value: round2(rsi) });
  }
  return out;
}

export function calcStochRsi(
  bars: BarPoint[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3
): { k: LineData<Time>[]; d: LineData<Time>[] } {
  const rsiPts = calcRsi(bars, rsiPeriod);
  if (rsiPts.length < stochPeriod + smoothK + smoothD) return { k: [], d: [] };

  const rawK: Array<{ time: Time; val: number }> = [];
  for (let i = stochPeriod - 1; i < rsiPts.length; i++) {
    const win = rsiPts.slice(i - stochPeriod + 1, i + 1);
    const maxR = Math.max(...win.map((w) => w.value));
    const minR = Math.min(...win.map((w) => w.value));
    const denom = maxR - minR;
    rawK.push({
      time: rsiPts[i].time,
      val: denom > 0 ? ((rsiPts[i].value - minR) / denom) * 100 : 50,
    });
  }

  const kArr: Array<{ time: Time; val: number }> = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const avg = rawK.slice(i - smoothK + 1, i + 1).reduce((s, x) => s + x.val, 0) / smoothK;
    kArr.push({ time: rawK[i].time, val: avg });
  }

  const dOut: LineData<Time>[] = [];
  for (let i = smoothD - 1; i < kArr.length; i++) {
    const avg = kArr.slice(i - smoothD + 1, i + 1).reduce((s, x) => s + x.val, 0) / smoothD;
    dOut.push({ time: kArr[i].time, value: round2(avg) });
  }

  return {
    k: kArr.map((p) => ({ time: p.time, value: round2(p.val) })),
    d: dOut,
  };
}

export function calcMacd(bars: BarPoint[]): {
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
    if (Number.isFinite(ema12[i]) && Number.isFinite(ema26[i])) {
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
    const mVal = round2(macdRaw[j].val);
    macd.push({ time: t, value: mVal });
    if (Number.isFinite(sigVals[j])) {
      const sVal = round2(sigVals[j]);
      const hVal = round2(mVal - sVal);
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

export function calcPpo(bars: BarPoint[]): {
  ppo: LineData<Time>[];
  signal: LineData<Time>[];
  hist: HistogramData<Time>[];
} {
  if (bars.length < 30) return { ppo: [], signal: [], hist: [] };
  const closes = bars.map((b) => b.close);
  const ema12 = calcEmaValues(closes, 12);
  const ema26 = calcEmaValues(closes, 26);
  const raw: Array<{ idx: number; val: number }> = [];
  for (let i = 0; i < bars.length; i++) {
    if (Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) && ema26[i] > 0) {
      raw.push({ idx: i, val: ((ema12[i] - ema26[i]) / ema26[i]) * 100 });
    }
  }
  if (raw.length < 9) return { ppo: [], signal: [], hist: [] };
  const sigVals = calcEmaValues(raw.map((r) => r.val), 9);
  const ppo: LineData<Time>[] = [];
  const signal: LineData<Time>[] = [];
  const hist: HistogramData<Time>[] = [];
  for (let j = 0; j < raw.length; j++) {
    const t = bars[raw[j].idx].time as Time;
    const v = round2(raw[j].val);
    ppo.push({ time: t, value: v });
    if (Number.isFinite(sigVals[j])) {
      const s = round2(sigVals[j]);
      const h = round2(v - s);
      signal.push({ time: t, value: s });
      hist.push({
        time: t,
        value: h,
        color: h >= 0 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      });
    }
  }
  return { ppo, signal, hist };
}

export function calcStochastic(
  bars: BarPoint[],
  kPeriod = 14,
  smoothK = 3,
  dPeriod = 3
): { k: LineData<Time>[]; d: LineData<Time>[] } {
  if (bars.length < kPeriod + smoothK + dPeriod) return { k: [], d: [] };

  const rawK: Array<{ idx: number; val: number }> = [];
  for (let i = kPeriod - 1; i < bars.length; i++) {
    const win = bars.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...win.map((w) => w.high));
    const ll = Math.min(...win.map((w) => w.low));
    const denom = hh - ll;
    const pctK = denom > 0 ? ((bars[i].close - ll) / denom) * 100 : 50;
    rawK.push({ idx: i, val: pctK });
  }

  const smoothedK: Array<{ idx: number; val: number }> = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const avg = rawK.slice(i - smoothK + 1, i + 1).reduce((s, r) => s + r.val, 0) / smoothK;
    smoothedK.push({ idx: rawK[i].idx, val: avg });
  }

  const kOut: LineData<Time>[] = smoothedK.map((p) => ({
    time: bars[p.idx].time as Time,
    value: round2(p.val),
  }));

  const dOut: LineData<Time>[] = [];
  for (let i = dPeriod - 1; i < smoothedK.length; i++) {
    const avgD =
      smoothedK.slice(i - dPeriod + 1, i + 1).reduce((s, r) => s + r.val, 0) / dPeriod;
    dOut.push({
      time: bars[smoothedK[i].idx].time as Time,
      value: round2(avgD),
    });
  }

  return { k: kOut, d: dOut };
}

export function calcAdx(
  bars: BarPoint[],
  period = 14
): { adx: LineData<Time>[]; plusDi: LineData<Time>[]; minusDi: LineData<Time>[] } {
  if (bars.length <= period * 2) return { adx: [], plusDi: [], minusDi: [] };

  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close)
      )
    );
  }

  let sTr = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let sPlus = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let sMinus = minusDm.slice(0, period).reduce((a, b) => a + b, 0);

  const dxArr: Array<{ idx: number; dx: number; pdi: number; mdi: number }> = [];
  const pushPoint = (barIdx: number) => {
    const pdi = sTr > 0 ? (100 * sPlus) / sTr : 0;
    const mdi = sTr > 0 ? (100 * sMinus) / sTr : 0;
    const sumDi = pdi + mdi;
    const dx = sumDi > 0 ? (100 * Math.abs(pdi - mdi)) / sumDi : 0;
    dxArr.push({ idx: barIdx, dx, pdi, mdi });
  };
  pushPoint(period);

  for (let i = period; i < tr.length; i++) {
    sTr = sTr - sTr / period + tr[i];
    sPlus = sPlus - sPlus / period + plusDm[i];
    sMinus = sMinus - sMinus / period + minusDm[i];
    pushPoint(i + 1);
  }

  if (dxArr.length < period) return { adx: [], plusDi: [], minusDi: [] };

  const plusDi: LineData<Time>[] = [];
  const minusDi: LineData<Time>[] = [];
  const adx: LineData<Time>[] = [];

  let adxVal = dxArr.slice(0, period).reduce((s, d) => s + d.dx, 0) / period;
  const firstBar = bars[dxArr[period - 1].idx].time as Time;
  adx.push({ time: firstBar, value: round2(adxVal) });
  plusDi.push({ time: firstBar, value: round2(dxArr[period - 1].pdi) });
  minusDi.push({ time: firstBar, value: round2(dxArr[period - 1].mdi) });

  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i].dx) / period;
    const t = bars[dxArr[i].idx].time as Time;
    adx.push({ time: t, value: round2(adxVal) });
    plusDi.push({ time: t, value: round2(dxArr[i].pdi) });
    minusDi.push({ time: t, value: round2(dxArr[i].mdi) });
  }

  return { adx, plusDi, minusDi };
}

export function calcBbWidth(bars: BarPoint[], period = 20, mult = 2): LineData<Time>[] {
  const bb = calcBollinger(bars, period, mult);
  const out: LineData<Time>[] = [];
  for (let i = 0; i < bb.basis.length; i++) {
    const bVal = bb.basis[i].value;
    if (bVal > 0) {
      out.push({
        time: bb.basis[i].time,
        value: round2(((bb.upper[i].value - bb.lower[i].value) / bVal) * 100),
      });
    }
  }
  return out;
}

export function calcBbPercentB(bars: BarPoint[], period = 20, mult = 2): LineData<Time>[] {
  if (bars.length < period) return [];
  const bb = calcBollinger(bars, period, mult);
  const barByTime = new Map<string, number>();
  for (const b of bars) barByTime.set(b.time, b.close);
  const out: LineData<Time>[] = [];
  for (let i = 0; i < bb.upper.length; i++) {
    const tStr = String(bb.upper[i].time);
    const close = barByTime.get(tStr);
    const range = bb.upper[i].value - bb.lower[i].value;
    if (close !== undefined && range > 0) {
      out.push({
        time: bb.upper[i].time,
        value: round2((close - bb.lower[i].value) / range),
      });
    }
  }
  return out;
}

export function calcHistoricalVolatility(bars: BarPoint[], period = 20): LineData<Time>[] {
  if (bars.length <= period) return [];
  const logRet: number[] = [NaN];
  for (let i = 1; i < bars.length; i++) {
    logRet.push(
      bars[i].close > 0 && bars[i - 1].close > 0
        ? Math.log(bars[i].close / bars[i - 1].close)
        : 0
    );
  }
  const out: LineData<Time>[] = [];
  for (let i = period; i < bars.length; i++) {
    const win = logRet.slice(i - period + 1, i + 1);
    const mean = win.reduce((s, r) => s + r, 0) / period;
    const varSum = win.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, period - 1);
    const annVol = Math.sqrt(varSum) * Math.sqrt(252) * 100;
    out.push({ time: bars[i].time as Time, value: round2(annVol) });
  }
  return out;
}

export function calcCci(bars: BarPoint[], period = 20): LineData<Time>[] {
  if (bars.length < period) return [];
  const tps = bars.map((b) => (b.high + b.low + b.close) / 3);
  const sma = calcSmaValues(tps, period);
  const out: LineData<Time>[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    const mean = sma[i];
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tps[j] - mean);
    md /= period;
    const cci = md > 0 ? (tps[i] - mean) / (0.015 * md) : 0;
    out.push({ time: bars[i].time as Time, value: round2(cci) });
  }
  return out;
}

export function calcWilliamsR(bars: BarPoint[], period = 14): LineData<Time>[] {
  if (bars.length < period) return [];
  const out: LineData<Time>[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    const win = bars.slice(i - period + 1, i + 1);
    const hh = Math.max(...win.map((w) => w.high));
    const ll = Math.min(...win.map((w) => w.low));
    const denom = hh - ll;
    const wr = denom > 0 ? ((hh - bars[i].close) / denom) * -100 : -50;
    out.push({ time: bars[i].time as Time, value: round2(wr) });
  }
  return out;
}

export function calcMfi(bars: BarPoint[], period = 14): LineData<Time>[] {
  if (bars.length <= period) return [];
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  const posFlow = new Array<number>(bars.length).fill(0);
  const negFlow = new Array<number>(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const rmf = tp[i] * bars[i].volume;
    if (tp[i] > tp[i - 1]) posFlow[i] = rmf;
    else if (tp[i] < tp[i - 1]) negFlow[i] = rmf;
  }
  const out: LineData<Time>[] = [];
  for (let i = period; i < bars.length; i++) {
    let pSum = 0;
    let nSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      pSum += posFlow[j];
      nSum += negFlow[j];
    }
    const mfi = nSum === 0 ? 100 : 100 - 100 / (1 + pSum / nSum);
    out.push({ time: bars[i].time as Time, value: round2(mfi) });
  }
  return out;
}

export function calcAwesomeOscillator(
  bars: BarPoint[],
  fast = 5,
  slow = 34
): HistogramData<Time>[] {
  if (bars.length < slow) return [];
  const hl2 = bars.map((b) => (b.high + b.low) / 2);
  const sFast = calcSmaValues(hl2, fast);
  const sSlow = calcSmaValues(hl2, slow);
  const out: HistogramData<Time>[] = [];
  let prev = 0;
  for (let i = slow - 1; i < bars.length; i++) {
    const val = round2(sFast[i] - sSlow[i]);
    const isRising = i === slow - 1 ? val >= 0 : val >= prev;
    prev = val;
    out.push({
      time: bars[i].time as Time,
      value: val,
      color: isRising ? 'rgba(16, 185, 129, 0.65)' : 'rgba(239, 68, 68, 0.65)',
    });
  }
  return out;
}

export function calcRoc(bars: BarPoint[], period = 12): LineData<Time>[] {
  if (bars.length <= period) return [];
  const out: LineData<Time>[] = [];
  for (let i = period; i < bars.length; i++) {
    const prev = bars[i - period].close;
    if (prev > 0) {
      out.push({
        time: bars[i].time as Time,
        value: round2(((bars[i].close - prev) / prev) * 100),
      });
    }
  }
  return out;
}

export function calcMomentum(bars: BarPoint[], period = 10): LineData<Time>[] {
  if (bars.length <= period) return [];
  const out: LineData<Time>[] = [];
  for (let i = period; i < bars.length; i++) {
    out.push({
      time: bars[i].time as Time,
      value: round2(bars[i].close - bars[i - period].close),
    });
  }
  return out;
}

export function calcTrix(bars: BarPoint[], period = 15): LineData<Time>[] {
  const closes = bars.map((b) => b.close);
  const e1 = calcEmaValues(closes, period);
  const e2 = calcEmaValues(e1, period);
  const e3 = calcEmaValues(e2, period);
  const out: LineData<Time>[] = [];
  for (let i = 1; i < bars.length; i++) {
    if (Number.isFinite(e3[i]) && Number.isFinite(e3[i - 1]) && e3[i - 1] > 0) {
      out.push({
        time: bars[i].time as Time,
        value: round4(((e3[i] - e3[i - 1]) / e3[i - 1]) * 100),
      });
    }
  }
  return out;
}

export function calcUltimateOscillator(
  bars: BarPoint[],
  p1 = 7,
  p2 = 14,
  p3 = 28
): LineData<Time>[] {
  if (bars.length <= p3) return [];
  const bp = new Array<number>(bars.length).fill(0);
  const tr = new Array<number>(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const prevC = bars[i - 1].close;
    const minLowPrev = Math.min(bars[i].low, prevC);
    const maxHighPrev = Math.max(bars[i].high, prevC);
    bp[i] = bars[i].close - minLowPrev;
    tr[i] = Math.max(0.0001, maxHighPrev - minLowPrev);
  }
  const avgRatio = (idx: number, len: number): number => {
    let sBp = 0;
    let sTr = 0;
    for (let j = idx - len + 1; j <= idx; j++) {
      sBp += bp[j];
      sTr += tr[j];
    }
    return sTr > 0 ? sBp / sTr : 0;
  };
  const out: LineData<Time>[] = [];
  for (let i = p3; i < bars.length; i++) {
    const a1 = avgRatio(i, p1);
    const a2 = avgRatio(i, p2);
    const a3 = avgRatio(i, p3);
    const uo = (100 * (4 * a1 + 2 * a2 + a3)) / 7;
    out.push({ time: bars[i].time as Time, value: round2(uo) });
  }
  return out;
}

export function calcCmo(bars: BarPoint[], period = 14): LineData<Time>[] {
  if (bars.length <= period) return [];
  const out: LineData<Time>[] = [];
  for (let i = period; i < bars.length; i++) {
    let su = 0;
    let sd = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = bars[j].close - bars[j - 1].close;
      if (diff > 0) su += diff;
      else sd += Math.abs(diff);
    }
    const denom = su + sd;
    const cmo = denom > 0 ? ((su - sd) / denom) * 100 : 0;
    out.push({ time: bars[i].time as Time, value: round2(cmo) });
  }
  return out;
}

export function calcDpo(bars: BarPoint[], period = 20): LineData<Time>[] {
  if (bars.length < period + 12) return [];
  const shift = Math.floor(period / 2) + 1;
  const sma = calcSmaValues(bars.map((b) => b.close), period);
  const out: LineData<Time>[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    if (i - shift >= 0 && Number.isFinite(sma[i])) {
      out.push({
        time: bars[i].time as Time,
        value: round2(bars[i - shift].close - sma[i]),
      });
    }
  }
  return out;
}

export function calcAroon(
  bars: BarPoint[],
  period = 25
): { up: LineData<Time>[]; down: LineData<Time>[] } {
  if (bars.length <= period) return { up: [], down: [] };
  const up: LineData<Time>[] = [];
  const down: LineData<Time>[] = [];
  for (let i = period; i < bars.length; i++) {
    let highIdx = i - period;
    let lowIdx = i - period;
    for (let j = i - period; j <= i; j++) {
      if (bars[j].high >= bars[highIdx].high) highIdx = j;
      if (bars[j].low <= bars[lowIdx].low) lowIdx = j;
    }
    const upVal = ((period - (i - highIdx)) / period) * 100;
    const downVal = ((period - (i - lowIdx)) / period) * 100;
    const t = bars[i].time as Time;
    up.push({ time: t, value: round2(upVal) });
    down.push({ time: t, value: round2(downVal) });
  }
  return { up, down };
}

export function calcCoppock(bars: BarPoint[]): HistogramData<Time>[] {
  if (bars.length < 30) return [];
  const roc14 = new Array<number>(bars.length).fill(NaN);
  const roc11 = new Array<number>(bars.length).fill(NaN);
  for (let i = 14; i < bars.length; i++) {
    if (bars[i - 14].close > 0) roc14[i] = ((bars[i].close - bars[i - 14].close) / bars[i - 14].close) * 100;
    if (bars[i - 11].close > 0) roc11[i] = ((bars[i].close - bars[i - 11].close) / bars[i - 11].close) * 100;
  }
  const sumRoc = bars.map((_, i) =>
    Number.isFinite(roc14[i]) && Number.isFinite(roc11[i]) ? roc14[i] + roc11[i] : NaN
  );
  const wma = calcWmaValues(sumRoc, 10);
  const out: HistogramData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (Number.isFinite(wma[i])) {
      const v = round2(wma[i]);
      out.push({
        time: bars[i].time as Time,
        value: v,
        color: v >= 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)',
      });
    }
  }
  return out;
}

export function calcVortex(
  bars: BarPoint[],
  period = 14
): { plus: LineData<Time>[]; minus: LineData<Time>[] } {
  if (bars.length <= period) return { plus: [], minus: [] };
  const vmPlus = new Array<number>(bars.length).fill(0);
  const vmMinus = new Array<number>(bars.length).fill(0);
  const tr = new Array<number>(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    vmPlus[i] = Math.abs(bars[i].high - bars[i - 1].low);
    vmMinus[i] = Math.abs(bars[i].low - bars[i - 1].high);
    tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
  }
  const plus: LineData<Time>[] = [];
  const minus: LineData<Time>[] = [];
  for (let i = period; i < bars.length; i++) {
    let sP = 0;
    let sM = 0;
    let sT = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sP += vmPlus[j];
      sM += vmMinus[j];
      sT += tr[j];
    }
    if (sT > 0) {
      const t = bars[i].time as Time;
      plus.push({ time: t, value: round4(sP / sT) });
      minus.push({ time: t, value: round4(sM / sT) });
    }
  }
  return { plus, minus };
}

export function calcElderRay(
  bars: BarPoint[],
  period = 13
): { bull: HistogramData<Time>[]; bear: HistogramData<Time>[] } {
  const ema = calcEmaValues(bars.map((b) => b.close), period);
  const bull: HistogramData<Time>[] = [];
  const bear: HistogramData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (Number.isFinite(ema[i])) {
      const t = bars[i].time as Time;
      const bPow = round2(bars[i].high - ema[i]);
      const sPow = round2(bars[i].low - ema[i]);
      bull.push({
        time: t,
        value: bPow,
        color: bPow >= 0 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(148, 163, 184, 0.45)',
      });
      bear.push({
        time: t,
        value: sPow,
        color: sPow < 0 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(148, 163, 184, 0.45)',
      });
    }
  }
  return { bull, bear };
}

export function calcFisherTransform(
  bars: BarPoint[],
  period = 10
): { fisher: LineData<Time>[]; trigger: LineData<Time>[] } {
  if (bars.length < period + 2) return { fisher: [], trigger: [] };
  const fisher: LineData<Time>[] = [];
  const trigger: LineData<Time>[] = [];
  let val = 0;
  let fish = 0;
  for (let i = period - 1; i < bars.length; i++) {
    const win = bars.slice(i - period + 1, i + 1);
    const hl2s = win.map((w) => (w.high + w.low) / 2);
    const maxH = Math.max(...hl2s);
    const minL = Math.min(...hl2s);
    const curHl2 = (bars[i].high + bars[i].low) / 2;
    const raw = maxH !== minL ? 0.66 * ((curHl2 - minL) / (maxH - minL) - 0.5) + 0.67 * val : 0;
    val = Math.max(-0.999, Math.min(0.999, raw));
    const prevFish = fish;
    fish = 0.5 * Math.log((1 + val) / (1 - val)) + 0.5 * prevFish;
    const t = bars[i].time as Time;
    fisher.push({ time: t, value: round2(fish) });
    if (i > period - 1) {
      trigger.push({ time: t, value: round2(prevFish) });
    }
  }
  return { fisher, trigger };
}

export function calcObv(bars: BarPoint[]): LineData<Time>[] {
  if (bars.length === 0) return [];
  let obv = 0;
  const out: LineData<Time>[] = [{ time: bars[0].time as Time, value: 0 }];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].close > bars[i - 1].close) obv += bars[i].volume;
    else if (bars[i].close < bars[i - 1].close) obv -= bars[i].volume;
    out.push({ time: bars[i].time as Time, value: obv });
  }
  return out;
}

export function calcCmf(bars: BarPoint[], period = 20): LineData<Time>[] {
  if (bars.length < period) return [];
  const mfv = bars.map((b) => {
    const range = b.high - b.low;
    const mfm = range > 0 ? ((b.close - b.low) - (b.high - b.close)) / range : 0;
    return mfm * b.volume;
  });
  const out: LineData<Time>[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    let sumMfv = 0;
    let sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumMfv += mfv[j];
      sumVol += bars[j].volume;
    }
    const cmf = sumVol > 0 ? sumMfv / sumVol : 0;
    out.push({ time: bars[i].time as Time, value: round4(cmf) });
  }
  return out;
}

function calcAdValues(bars: BarPoint[]): number[] {
  let ad = 0;
  return bars.map((b) => {
    const range = b.high - b.low;
    const mfm = range > 0 ? ((b.close - b.low) - (b.high - b.close)) / range : 0;
    ad += mfm * b.volume;
    return ad;
  });
}

export function calcAdLine(bars: BarPoint[]): LineData<Time>[] {
  return toLineSeries(bars, calcAdValues(bars), 0);
}

export function calcChaikinOscillator(
  bars: BarPoint[],
  fast = 3,
  slow = 10
): LineData<Time>[] {
  if (bars.length < slow + 2) return [];
  const ad = calcAdValues(bars);
  const eFast = calcEmaValues(ad, fast);
  const eSlow = calcEmaValues(ad, slow);
  const out: LineData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (Number.isFinite(eFast[i]) && Number.isFinite(eSlow[i])) {
      out.push({ time: bars[i].time as Time, value: Math.round(eFast[i] - eSlow[i]) });
    }
  }
  return out;
}

export function calcForceIndex(bars: BarPoint[], period = 13): LineData<Time>[] {
  if (bars.length <= period) return [];
  const raw = new Array<number>(bars.length).fill(NaN);
  for (let i = 1; i < bars.length; i++) {
    raw[i] = (bars[i].close - bars[i - 1].close) * bars[i].volume;
  }
  return toLineSeries(bars, calcEmaValues(raw, period), 0);
}

export function calcEaseOfMovement(bars: BarPoint[], period = 14): LineData<Time>[] {
  if (bars.length <= period) return [];
  const raw = new Array<number>(bars.length).fill(NaN);
  for (let i = 1; i < bars.length; i++) {
    const dist = (bars[i].high + bars[i].low) / 2 - (bars[i - 1].high + bars[i - 1].low) / 2;
    const hl = Math.max(0.01, bars[i].high - bars[i].low);
    const boxRatio = bars[i].volume > 0 ? (bars[i].volume / 100000) / hl : 1;
    raw[i] = boxRatio > 0 ? dist / boxRatio : 0;
  }
  const sma: number[] = new Array(bars.length).fill(NaN);
  for (let i = period; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += raw[j];
    sma[i] = sum / period;
  }
  return toLineSeries(bars, sma, 2);
}

export function calcVolumeOscillator(
  bars: BarPoint[],
  fast = 5,
  slow = 20
): HistogramData<Time>[] {
  if (bars.length < slow) return [];
  const vols = bars.map((b) => b.volume);
  const vFast = calcSmaValues(vols, fast);
  const vSlow = calcSmaValues(vols, slow);
  const out: HistogramData<Time>[] = [];
  for (let i = slow - 1; i < bars.length; i++) {
    if (vSlow[i] > 0) {
      const val = round2(((vFast[i] - vSlow[i]) / vSlow[i]) * 100);
      out.push({
        time: bars[i].time as Time,
        value: val,
        color: val >= 0 ? 'rgba(16, 185, 129, 0.55)' : 'rgba(239, 68, 68, 0.55)',
      });
    }
  }
  return out;
}

export function calcVpt(bars: BarPoint[]): LineData<Time>[] {
  if (bars.length === 0) return [];
  let vpt = 0;
  const out: LineData<Time>[] = [{ time: bars[0].time as Time, value: 0 }];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i - 1].close > 0) {
      vpt += bars[i].volume * ((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
    }
    out.push({ time: bars[i].time as Time, value: Math.round(vpt) });
  }
  return out;
}

export interface ClassicPivots {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

export function calcClassicPivots(bars: BarPoint[]): ClassicPivots | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2];
  const range = prev.high - prev.low;
  const pp = (prev.high + prev.low + prev.close) / 3;
  return {
    pp: round2(pp),
    r1: round2(2 * pp - prev.low),
    r2: round2(pp + range),
    r3: round2(prev.high + 2 * (pp - prev.low)),
    s1: round2(2 * pp - prev.high),
    s2: round2(pp - range),
    s3: round2(prev.low - 2 * (prev.high - pp)),
  };
}

export function calcFibPivots(bars: BarPoint[]): ClassicPivots | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2];
  const range = prev.high - prev.low;
  const pp = (prev.high + prev.low + prev.close) / 3;
  return {
    pp: round2(pp),
    r1: round2(pp + 0.382 * range),
    r2: round2(pp + 0.618 * range),
    r3: round2(pp + 1.0 * range),
    s1: round2(pp - 0.382 * range),
    s2: round2(pp - 0.618 * range),
    s3: round2(pp - 1.0 * range),
  };
}

export interface CamarillaPivots {
  h4: number;
  h3: number;
  l3: number;
  l4: number;
}

export function calcCamarillaPivots(bars: BarPoint[]): CamarillaPivots | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2];
  const range = prev.high - prev.low;
  const c = prev.close;
  return {
    h4: round2(c + (range * 1.1) / 2),
    h3: round2(c + (range * 1.1) / 4),
    l3: round2(c - (range * 1.1) / 4),
    l4: round2(c - (range * 1.1) / 2),
  };
}
