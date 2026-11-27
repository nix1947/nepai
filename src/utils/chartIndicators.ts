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
      open: Number(haOpen.toFixed(2)),
      high: Number(haHigh.toFixed(2)),
      low: Number(haLow.toFixed(2)),
      close: Number(haClose.toFixed(2)),
    });
  }
  return out;
}

export function calcSma(bars: BarPoint[], period: number): LineData<Time>[] {
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

export function calcEmaValues(values: number[], period: number): number[] {
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

export function calcEma(bars: BarPoint[], period: number): LineData<Time>[] {
  const vals = calcEmaValues(bars.map((b) => b.close), period);
  const res: LineData<Time>[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (!Number.isNaN(vals[i])) {
      res.push({ time: bars[i].time as Time, value: Number(vals[i].toFixed(2)) });
    }
  }
  return res;
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
    upper.push({ time: t, value: Number((mean + mult * sd).toFixed(2)) });
    basis.push({ time: t, value: Number(mean.toFixed(2)) });
    lower.push({ time: t, value: Number((mean - mult * sd).toFixed(2)) });
  }
  return { upper, basis, lower };
}

export function calcAtrSeries(bars: BarPoint[], period = 14): LineData<Time>[] {
  if (bars.length <= period) return [];
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: LineData<Time>[] = [{ time: bars[period].time as Time, value: Number(atr.toFixed(2)) }];
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    out.push({ time: bars[i + 1].time as Time, value: Number(atr.toFixed(2)) });
  }
  return out;
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

  const trs: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    trs[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
  }

  const atr: number[] = new Array(bars.length).fill(NaN);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < bars.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + trs[i]) / period;
  }

  const finalUpper: number[] = new Array(bars.length).fill(NaN);
  const finalLower: number[] = new Array(bars.length).fill(NaN);
  const dir: Array<'bullish' | 'bearish' | null> = new Array(bars.length).fill(null);

  for (let i = period; i < bars.length; i++) {
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const basicUpper = hl2 + mult * atr[i];
    const basicLower = hl2 - mult * atr[i];

    if (i === period) {
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
      const v = Number(finalLower[i].toFixed(2));
      up.push({ time: t, value: v });
      down.push({ time: t });
      latestTrend = 'bullish';
      latestValue = v;
    } else if (dir[i] === 'bearish') {
      const v = Number(finalUpper[i].toFixed(2));
      down.push({ time: t, value: v });
      up.push({ time: t });
      latestTrend = 'bearish';
      latestValue = v;
    }
  }

  return { up, down, latestTrend, latestValue };
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
    value: Number(p.val.toFixed(2)),
  }));

  const dOut: LineData<Time>[] = [];
  for (let i = dPeriod - 1; i < smoothedK.length; i++) {
    const avgD =
      smoothedK.slice(i - dPeriod + 1, i + 1).reduce((s, r) => s + r.val, 0) / dPeriod;
    dOut.push({
      time: bars[smoothedK[i].idx].time as Time,
      value: Number(avgD.toFixed(2)),
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
  adx.push({ time: firstBar, value: Number(adxVal.toFixed(2)) });
  plusDi.push({ time: firstBar, value: Number(dxArr[period - 1].pdi.toFixed(2)) });
  minusDi.push({ time: firstBar, value: Number(dxArr[period - 1].mdi.toFixed(2)) });

  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i].dx) / period;
    const t = bars[dxArr[i].idx].time as Time;
    adx.push({ time: t, value: Number(adxVal.toFixed(2)) });
    plusDi.push({ time: t, value: Number(dxArr[i].pdi.toFixed(2)) });
    minusDi.push({ time: t, value: Number(dxArr[i].mdi.toFixed(2)) });
  }

  return { adx, plusDi, minusDi };
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

export interface ClassicPivots {
  pp: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
}

export function calcClassicPivots(bars: BarPoint[]): ClassicPivots | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2];
  const pp = (prev.high + prev.low + prev.close) / 3;
  const r1 = 2 * pp - prev.low;
  const s1 = 2 * pp - prev.high;
  const r2 = pp + (prev.high - prev.low);
  const s2 = pp - (prev.high - prev.low);
  return {
    pp: Number(pp.toFixed(2)),
    r1: Number(r1.toFixed(2)),
    r2: Number(r2.toFixed(2)),
    s1: Number(s1.toFixed(2)),
    s2: Number(s2.toFixed(2)),
  };
}
