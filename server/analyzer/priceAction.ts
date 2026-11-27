import type {
  AnalyzerBar,
  AnalyzerConfig,
  BreakoutRetestEvent,
  CandlePatternHit,
  ChartPatternDetection,
  SRZone,
  SwingPoint,
  TrendlineSegment,
  VsaSignal,
} from '../../src/types/analyzer.ts';
import { round2 } from './config.ts';

export interface PriceActionResult {
  candlePatterns: CandlePatternHit[];
  srZones: SRZone[];
  trendlines: TrendlineSegment[];
  chartPatterns: ChartPatternDetection[];
  breakoutEvents: BreakoutRetestEvent[];
  vsaSignals: VsaSignal[];
}

function detectCandles(bars: AnalyzerBar[]): CandlePatternHit[] {
  const hits: CandlePatternHit[] = [];
  const start = Math.max(2, bars.length - 45);
  for (let i = start; i < bars.length; i++) {
    const c = bars[i];
    const p = bars[i - 1];
    const pp = bars[i - 2];
    if (c.possibleCorpActionGap || p.possibleCorpActionGap) continue;

    const range = Math.max(0.05, c.high - c.low);
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    if (lowerWick >= body * 2.1 && upperWick <= range * 0.22 && range >= c.atr14 * 0.65) {
      hits.push({ barIndex: i, date: c.date, pattern: 'Bullish Pin Bar', direction: 'bullish', price: c.low });
    } else if (upperWick >= body * 2.1 && lowerWick <= range * 0.22 && range >= c.atr14 * 0.65) {
      hits.push({ barIndex: i, date: c.date, pattern: 'Bearish Pin Bar', direction: 'bearish', price: c.high });
    }

    if (
      p.close < p.open &&
      c.close > c.open &&
      c.open <= p.close * 1.003 &&
      c.close >= p.open &&
      body >= Math.abs(p.close - p.open)
    ) {
      hits.push({ barIndex: i, date: c.date, pattern: 'Bullish Engulfing', direction: 'bullish', price: c.close });
    } else if (
      p.close > p.open &&
      c.close < c.open &&
      c.open >= p.close * 0.997 &&
      c.close <= p.open &&
      body >= Math.abs(p.close - p.open)
    ) {
      hits.push({ barIndex: i, date: c.date, pattern: 'Bearish Engulfing', direction: 'bearish', price: c.close });
    }

    if (c.high <= p.high && c.low >= p.low) {
      hits.push({ barIndex: i, date: c.date, pattern: 'Inside Bar', direction: 'neutral', price: c.close });
    }

    const ppBody = pp.close - pp.open;
    const pBody = Math.abs(p.close - p.open);
    const pRange = Math.max(0.05, p.high - p.low);
    if (ppBody < -pp.atr14 * 0.7 && pBody <= pRange * 0.35 && c.close - c.open > c.atr14 * 0.6 && c.close > (pp.open + pp.close) / 2) {
      hits.push({ barIndex: i, date: c.date, pattern: 'Morning Star', direction: 'bullish', price: c.close });
    } else if (ppBody > pp.atr14 * 0.7 && pBody <= pRange * 0.35 && c.open - c.close > c.atr14 * 0.6 && c.close < (pp.open + pp.close) / 2) {
      hits.push({ barIndex: i, date: c.date, pattern: 'Evening Star', direction: 'bearish', price: c.close });
    }
  }
  return hits;
}

function detectSrZones(
  bars: AnalyzerBar[],
  swings: SwingPoint[],
  cfg: AnalyzerConfig
): SRZone[] {
  const candidates = swings.filter((s) => s.tier !== 'minor');
  if (candidates.length === 0 || bars.length === 0) return [];
  const lastClose = bars[bars.length - 1].close;

  const clusters: Array<{ prices: number[]; dates: string[]; highTouches: number; lowTouches: number }> = [];
  for (const s of candidates) {
    let matched = false;
    for (const cl of clusters) {
      const mean = cl.prices.reduce((a, b) => a + b, 0) / cl.prices.length;
      if ((Math.abs(s.price - mean) / Math.max(0.1, mean)) * 100 <= cfg.srTolerancePct) {
        cl.prices.push(s.price);
        cl.dates.push(s.date);
        if (s.kind === 'high') cl.highTouches++;
        else cl.lowTouches++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({
        prices: [s.price],
        dates: [s.date],
        highTouches: s.kind === 'high' ? 1 : 0,
        lowTouches: s.kind === 'low' ? 1 : 0,
      });
    }
  }

  return clusters
    .filter((c) => c.prices.length >= 2)
    .map((cl, idx) => {
      const top = round2(Math.max(...cl.prices));
      const bottom = round2(Math.min(...cl.prices));
      const mid = round2((top + bottom) / 2);
      const isFlip = cl.highTouches >= 1 && cl.lowTouches >= 1;
      const kind: SRZone['kind'] = isFlip ? 'Flip' : lastClose >= mid ? 'Support' : 'Resistance';
      return {
        id: `SR-${idx}`,
        kind,
        top,
        bottom,
        mid,
        touches: cl.prices.length,
        strength0to100: Math.min(100, 35 + cl.prices.length * 16 + (isFlip ? 12 : 0)),
        lastTouchDate: cl.dates[cl.dates.length - 1],
      };
    })
    .sort((a, b) => b.strength0to100 - a.strength0to100)
    .slice(0, 8);
}

function detectTrendlines(swings: SwingPoint[]): TrendlineSegment[] {
  const out: TrendlineSegment[] = [];
  const lows = swings.filter((s) => s.kind === 'low' && s.tier !== 'minor').slice(-8);
  const highs = swings.filter((s) => s.kind === 'high' && s.tier !== 'minor').slice(-8);

  if (lows.length >= 2) {
    for (let i = lows.length - 2; i >= 0; i--) {
      const a = lows[i];
      const b = lows[lows.length - 1];
      if (b.barIndex - a.barIndex >= 5 && b.price > a.price) {
        out.push({
          id: `TL-sup-${a.barIndex}-${b.barIndex}`,
          kind: 'Ascending Support',
          startIndex: a.barIndex,
          startDate: a.date,
          startPrice: round2(a.price),
          endIndex: b.barIndex,
          endDate: b.date,
          endPrice: round2(b.price),
          slopePerBar: round2((b.price - a.price) / (b.barIndex - a.barIndex)),
        });
        break;
      }
    }
  }

  if (highs.length >= 2) {
    for (let i = highs.length - 2; i >= 0; i--) {
      const a = highs[i];
      const b = highs[highs.length - 1];
      if (b.barIndex - a.barIndex >= 5 && b.price < a.price) {
        out.push({
          id: `TL-res-${a.barIndex}-${b.barIndex}`,
          kind: 'Descending Resistance',
          startIndex: a.barIndex,
          startDate: a.date,
          startPrice: round2(a.price),
          endIndex: b.barIndex,
          endDate: b.date,
          endPrice: round2(b.price),
          slopePerBar: round2((b.price - a.price) / (b.barIndex - a.barIndex)),
        });
        break;
      }
    }
  }

  return out;
}

function detectChartPatterns(
  bars: AnalyzerBar[],
  swings: SwingPoint[],
  cfg: AnalyzerConfig
): ChartPatternDetection[] {
  const out: ChartPatternDetection[] = [];
  if (bars.length < 20) return out;

  const lastBar = bars[bars.length - 1];
  const highs = swings.filter((s) => s.kind === 'high' && s.tier !== 'minor').slice(-6);
  const lows = swings.filter((s) => s.kind === 'low' && s.tier !== 'minor').slice(-6);

  // Double Bottom
  if (lows.length >= 2) {
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];
    const diffPct = (Math.abs(l1.price - l2.price) / Math.max(0.1, l1.price)) * 100;
    if (l2.barIndex - l1.barIndex >= 6 && diffPct <= cfg.eqTolerancePct * 2.2) {
      const midPeak = Math.max(...bars.slice(l1.barIndex, l2.barIndex + 1).map((b) => b.high));
      const inv = round2(Math.min(l1.price, l2.price));
      out.push({
        id: `PAT-DB-${l1.barIndex}-${l2.barIndex}`,
        name: 'Double Bottom',
        direction: 'bullish',
        status: lastBar.close > midPeak ? 'Confirmed Breakout' : 'Forming',
        startIndex: l1.barIndex,
        startDate: l1.date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: round2(midPeak),
        invalidationPrice: inv,
        measuredTarget: round2(midPeak + (midPeak - inv)),
        points: [
          { barIndex: l1.barIndex, date: l1.date, price: l1.price },
          { barIndex: l2.barIndex, date: l2.date, price: l2.price },
        ],
      });
    }
  }

  // Double Top
  if (highs.length >= 2) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    const diffPct = (Math.abs(h1.price - h2.price) / Math.max(0.1, h1.price)) * 100;
    if (h2.barIndex - h1.barIndex >= 6 && diffPct <= cfg.eqTolerancePct * 2.2) {
      const midValley = Math.min(...bars.slice(h1.barIndex, h2.barIndex + 1).map((b) => b.low));
      const inv = round2(Math.max(h1.price, h2.price));
      out.push({
        id: `PAT-DT-${h1.barIndex}-${h2.barIndex}`,
        name: 'Double Top',
        direction: 'bearish',
        status: lastBar.close < midValley ? 'Confirmed Breakout' : 'Forming',
        startIndex: h1.barIndex,
        startDate: h1.date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: round2(midValley),
        invalidationPrice: inv,
        measuredTarget: round2(Math.max(1, midValley - (inv - midValley))),
        points: [
          { barIndex: h1.barIndex, date: h1.date, price: h1.price },
          { barIndex: h2.barIndex, date: h2.date, price: h2.price },
        ],
      });
    }
  }

  // Inverse Head & Shoulders / Head & Shoulders
  if (lows.length >= 3) {
    const [ls, head, rs] = lows.slice(-3);
    if (head.price < ls.price && head.price < rs.price && Math.abs(ls.price - rs.price) / head.price <= 0.05) {
      const neck = Math.max(...bars.slice(ls.barIndex, rs.barIndex + 1).map((b) => b.high));
      out.push({
        id: `PAT-IHS-${ls.barIndex}-${rs.barIndex}`,
        name: 'Inverse Head & Shoulders',
        direction: 'bullish',
        status: lastBar.close > neck ? 'Confirmed Breakout' : 'Forming',
        startIndex: ls.barIndex,
        startDate: ls.date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: round2(neck),
        invalidationPrice: round2(rs.price),
        measuredTarget: round2(neck + (neck - head.price)),
        points: [
          { barIndex: ls.barIndex, date: ls.date, price: ls.price },
          { barIndex: head.barIndex, date: head.date, price: head.price },
          { barIndex: rs.barIndex, date: rs.date, price: rs.price },
        ],
      });
    }
  }
  if (highs.length >= 3) {
    const [ls, head, rs] = highs.slice(-3);
    if (head.price > ls.price && head.price > rs.price && Math.abs(ls.price - rs.price) / head.price <= 0.05) {
      const neck = Math.min(...bars.slice(ls.barIndex, rs.barIndex + 1).map((b) => b.low));
      out.push({
        id: `PAT-HS-${ls.barIndex}-${rs.barIndex}`,
        name: 'Head & Shoulders',
        direction: 'bearish',
        status: lastBar.close < neck ? 'Confirmed Breakout' : 'Forming',
        startIndex: ls.barIndex,
        startDate: ls.date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: round2(neck),
        invalidationPrice: round2(rs.price),
        measuredTarget: round2(Math.max(1, neck - (head.price - neck))),
        points: [
          { barIndex: ls.barIndex, date: ls.date, price: ls.price },
          { barIndex: head.barIndex, date: head.date, price: head.price },
          { barIndex: rs.barIndex, date: rs.date, price: rs.price },
        ],
      });
    }
  }

  // Triangles & Wedges from last 2 highs + last 2 lows
  if (highs.length >= 2 && lows.length >= 2) {
    const [h1, h2] = highs.slice(-2);
    const [l1, l2] = lows.slice(-2);
    const hDiffPct = ((h2.price - h1.price) / Math.max(0.1, h1.price)) * 100;
    const lDiffPct = ((l2.price - l1.price) / Math.max(0.1, l1.price)) * 100;
    const startIdx = Math.min(h1.barIndex, l1.barIndex);
    const height = Math.max(h1.price, h2.price) - Math.min(l1.price, l2.price);

    if (Math.abs(hDiffPct) <= 1.2 && lDiffPct > 1.2) {
      const trig = round2(Math.max(h1.price, h2.price));
      out.push({
        id: `PAT-ASC-TRI-${startIdx}`,
        name: 'Ascending Triangle',
        direction: 'bullish',
        status: lastBar.close > trig ? 'Confirmed Breakout' : 'Forming',
        startIndex: startIdx,
        startDate: bars[startIdx].date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: trig,
        invalidationPrice: round2(l2.price),
        measuredTarget: round2(trig + height * 0.8),
        points: [
          { barIndex: l1.barIndex, date: l1.date, price: l1.price },
          { barIndex: l2.barIndex, date: l2.date, price: l2.price },
        ],
      });
    } else if (Math.abs(lDiffPct) <= 1.2 && hDiffPct < -1.2) {
      const trig = round2(Math.min(l1.price, l2.price));
      out.push({
        id: `PAT-DESC-TRI-${startIdx}`,
        name: 'Descending Triangle',
        direction: 'bearish',
        status: lastBar.close < trig ? 'Confirmed Breakout' : 'Forming',
        startIndex: startIdx,
        startDate: bars[startIdx].date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: trig,
        invalidationPrice: round2(h2.price),
        measuredTarget: round2(Math.max(1, trig - height * 0.8)),
        points: [
          { barIndex: h1.barIndex, date: h1.date, price: h1.price },
          { barIndex: h2.barIndex, date: h2.date, price: h2.price },
        ],
      });
    } else if (hDiffPct < -1.0 && lDiffPct > 1.0) {
      out.push({
        id: `PAT-SYM-TRI-${startIdx}`,
        name: 'Symmetrical Triangle',
        direction: lastBar.close >= h2.price ? 'bullish' : 'bearish',
        status: lastBar.close > h2.price || lastBar.close < l2.price ? 'Confirmed Breakout' : 'Forming',
        startIndex: startIdx,
        startDate: bars[startIdx].date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: round2(h2.price),
        invalidationPrice: round2(l2.price),
        measuredTarget: round2(h2.price + height * 0.7),
        points: [
          { barIndex: h1.barIndex, date: h1.date, price: h1.price },
          { barIndex: l2.barIndex, date: l2.date, price: l2.price },
        ],
      });
    } else if (hDiffPct < -1.2 && lDiffPct < -0.5 && lDiffPct > hDiffPct) {
      out.push({
        id: `PAT-FALL-WEDGE-${startIdx}`,
        name: 'Falling Wedge',
        direction: 'bullish',
        status: lastBar.close > h2.price ? 'Confirmed Breakout' : 'Forming',
        startIndex: startIdx,
        startDate: bars[startIdx].date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: round2(h2.price),
        invalidationPrice: round2(l2.price),
        measuredTarget: round2(h1.price),
        points: [
          { barIndex: h1.barIndex, date: h1.date, price: h1.price },
          { barIndex: l2.barIndex, date: l2.date, price: l2.price },
        ],
      });
    } else if (hDiffPct > 0.5 && lDiffPct > 1.2 && hDiffPct < lDiffPct) {
      out.push({
        id: `PAT-RISE-WEDGE-${startIdx}`,
        name: 'Rising Wedge',
        direction: 'bearish',
        status: lastBar.close < l2.price ? 'Confirmed Breakout' : 'Forming',
        startIndex: startIdx,
        startDate: bars[startIdx].date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: round2(l2.price),
        invalidationPrice: round2(h2.price),
        measuredTarget: round2(l1.price),
        points: [
          { barIndex: l1.barIndex, date: l1.date, price: l1.price },
          { barIndex: h2.barIndex, date: h2.date, price: h2.price },
        ],
      });
    }
  }

  // Bull Flag (impulse + tight drift lower over 5-12 bars)
  if (bars.length >= 25) {
    const poleSlice = bars.slice(-18, -8);
    const flagSlice = bars.slice(-8);
    const poleRet = ((poleSlice[poleSlice.length - 1].close - poleSlice[0].low) / Math.max(0.1, poleSlice[0].low)) * 100;
    const flagHigh = Math.max(...flagSlice.map((b) => b.high));
    const flagLow = Math.min(...flagSlice.map((b) => b.low));
    const flagRangePct = ((flagHigh - flagLow) / Math.max(0.1, flagLow)) * 100;
    if (poleRet >= 10 && flagRangePct <= 8 && flagSlice[flagSlice.length - 1].low > poleSlice[0].low) {
      out.push({
        id: `PAT-BFLAG-${bars.length - 18}`,
        name: 'Bull Flag',
        direction: 'bullish',
        status: lastBar.close >= flagHigh * 0.992 ? 'Confirmed Breakout' : 'Forming',
        startIndex: bars.length - 18,
        startDate: poleSlice[0].date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: round2(flagHigh),
        invalidationPrice: round2(flagLow),
        measuredTarget: round2(flagHigh + (poleSlice[poleSlice.length - 1].close - poleSlice[0].low) * 0.7),
        points: [
          { barIndex: bars.length - 18, date: poleSlice[0].date, price: poleSlice[0].low },
          { barIndex: bars.length - 8, date: flagSlice[0].date, price: flagHigh },
        ],
      });
    }
  }

  // Cup & Handle (40+ bars rounded recovery + shallow handle <= 12%)
  if (bars.length >= 42) {
    const cupSlice = bars.slice(-42, -7);
    const handleSlice = bars.slice(-7);
    const leftRim = Math.max(...cupSlice.slice(0, 8).map((b) => b.high));
    const cupBottom = Math.min(...cupSlice.slice(8, -6).map((b) => b.low));
    const rightRim = Math.max(...cupSlice.slice(-8).map((b) => b.high));
    const handleLow = Math.min(...handleSlice.map((b) => b.low));
    const handleDepthPct = ((rightRim - handleLow) / Math.max(0.1, rightRim)) * 100;
    const cupDepthPct = ((leftRim - cupBottom) / Math.max(0.1, leftRim)) * 100;
    if (
      cupDepthPct >= 10 &&
      cupDepthPct <= 35 &&
      Math.abs(leftRim - rightRim) / Math.max(0.1, leftRim) <= 0.04 &&
      handleDepthPct <= 11
    ) {
      const trig = round2(Math.max(leftRim, rightRim));
      out.push({
        id: `PAT-CUP-${bars.length - 42}`,
        name: 'Cup & Handle',
        direction: 'bullish',
        status: lastBar.close > trig ? 'Confirmed Breakout' : 'Forming',
        startIndex: bars.length - 42,
        startDate: cupSlice[0].date,
        endIndex: bars.length - 1,
        endDate: lastBar.date,
        necklineOrTrigger: trig,
        invalidationPrice: round2(handleLow),
        measuredTarget: round2(trig + (trig - cupBottom)),
        points: [
          { barIndex: bars.length - 42, date: cupSlice[0].date, price: leftRim },
          { barIndex: bars.length - 24, date: cupSlice[Math.floor(cupSlice.length / 2)].date, price: cupBottom },
        ],
      });
    }
  }

  return out;
}

function detectBreakoutAndVsa(
  bars: AnalyzerBar[],
  srZones: SRZone[]
): { breakoutEvents: BreakoutRetestEvent[]; vsaSignals: VsaSignal[] } {
  const breakoutEvents: BreakoutRetestEvent[] = [];
  const vsaSignals: VsaSignal[] = [];
  if (bars.length < 22) return { breakoutEvents, vsaSignals };

  const avgVol20 = (idx: number) => {
    const s = bars.slice(Math.max(0, idx - 20), idx);
    return s.length > 0 ? s.reduce((a, b) => a + b.volume, 0) / s.length : 1;
  };

  for (let i = Math.max(20, bars.length - 25); i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    if (b.possibleCorpActionGap) continue;

    const v20 = Math.max(1, avgVol20(i));
    const rvol = b.volume / v20;
    const range = Math.max(0.05, b.high - b.low);
    const closePos = (b.close - b.low) / range;

    // VSA Signals
    if (rvol >= 1.8 && b.close < prev.close && closePos >= 0.55) {
      vsaSignals.push({
        barIndex: i,
        date: b.date,
        kind: 'Stopping Volume',
        direction: 'bullish',
        detail: `${rvol.toFixed(1)}x volume on down bar closed in upper ${(closePos * 100).toFixed(0)}% (institutional absorption).`,
      });
    } else if (rvol <= 0.65 && b.close < b.open && closePos >= 0.5 && range < b.atr14 * 0.75) {
      vsaSignals.push({
        barIndex: i,
        date: b.date,
        kind: 'No Supply Test',
        direction: 'bullish',
        detail: `Dry volume (${rvol.toFixed(2)}x) narrow pullback closing mid/high signals seller exhaustion.`,
      });
    } else if (rvol >= 1.7 && closePos <= 0.25 && b.high > prev.high) {
      vsaSignals.push({
        barIndex: i,
        date: b.date,
        kind: 'Upthrust Distribution',
        direction: 'bearish',
        detail: `High volume (${rvol.toFixed(1)}x) reversal off new high closing in bottom ${(closePos * 100).toFixed(0)}%.`,
      });
    } else if (rvol >= 1.4 && b.close > b.open && closePos >= 0.75 && b.close - b.open >= b.atr14) {
      vsaSignals.push({
        barIndex: i,
        date: b.date,
        kind: 'Effort vs Result Bullish',
        direction: 'bullish',
        detail: `Strong bullish spread + ${rvol.toFixed(1)}x volume expansion.`,
      });
    }

    // Breakout / Retest / Fakeout against top S/R zones
    for (const z of srZones.slice(0, 4)) {
      if (prev.close <= z.top && b.close > z.top) {
        breakoutEvents.push({
          kind: 'Breakout',
          direction: 'bullish',
          barIndex: i,
          date: b.date,
          level: z.top,
          detail: `Closed above S/R zone ${z.bottom.toFixed(1)}–${z.top.toFixed(1)} (${rvol.toFixed(1)}x vol).`,
        });
      } else if (prev.close > z.top && b.low <= z.top && b.close > z.mid) {
        breakoutEvents.push({
          kind: 'Retest',
          direction: 'bullish',
          barIndex: i,
          date: b.date,
          level: z.top,
          detail: `Constructive retest holding top of flipped zone ${z.top.toFixed(1)}.`,
        });
      } else if (b.high > z.top && prev.close <= z.top && b.close < z.bottom) {
        breakoutEvents.push({
          kind: 'Fakeout',
          direction: 'bearish',
          barIndex: i,
          date: b.date,
          level: z.top,
          detail: `Failed breakout / bull trap back below ${z.bottom.toFixed(1)}.`,
        });
      }
    }
  }

  return { breakoutEvents, vsaSignals };
}

export function detectPriceAction(
  bars: AnalyzerBar[],
  swings: SwingPoint[],
  cfg: AnalyzerConfig
): PriceActionResult {
  const candlePatterns = detectCandles(bars);
  const srZones = detectSrZones(bars, swings, cfg);
  const trendlines = detectTrendlines(swings);
  const chartPatterns = detectChartPatterns(bars, swings, cfg);
  const { breakoutEvents, vsaSignals } = detectBreakoutAndVsa(bars, srZones);

  return {
    candlePatterns,
    srZones,
    trendlines,
    chartPatterns,
    breakoutEvents,
    vsaSignals,
  };
}
