import type {
  AnalyzerBar,
  DisplacementCandle,
  ImbalanceZone,
  OrderBlockZone,
  StructureBreak,
} from '../../src/types/analyzer.ts';
import { round2 } from './config.ts';

function evaluateBlockForward(
  ob: OrderBlockZone,
  bars: AnalyzerBar[],
  fromIndex: number
): { brokenAtIndex: number | null } {
  const height = Math.max(0.05, ob.top - ob.bottom);
  let maxPen = 0;

  for (let j = fromIndex; j < bars.length; j++) {
    const b = bars[j];
    if (b.possibleCorpActionGap) continue;

    if (ob.direction === 'bullish') {
      if (b.close < ob.bottom) {
        ob.status = 'broken';
        ob.mitigatedPct = 100;
        return { brokenAtIndex: j };
      }
      if (b.low < ob.top) {
        maxPen = Math.max(maxPen, Math.min(height, ob.top - b.low));
        ob.status = maxPen / height >= 0.6 ? 'mitigated' : 'tested';
        ob.mitigatedPct = round2((maxPen / height) * 100);
      }
    } else {
      if (b.close > ob.top) {
        ob.status = 'broken';
        ob.mitigatedPct = 100;
        return { brokenAtIndex: j };
      }
      if (b.high > ob.bottom) {
        maxPen = Math.max(maxPen, Math.min(height, b.high - ob.bottom));
        ob.status = maxPen / height >= 0.6 ? 'mitigated' : 'tested';
        ob.mitigatedPct = round2((maxPen / height) * 100);
      }
    }
  }

  return { brokenAtIndex: null };
}

export function detectOrderBlocks(
  bars: AnalyzerBar[],
  breaks: StructureBreak[],
  displacements: DisplacementCandle[],
  imbalances: ImbalanceZone[]
): OrderBlockZone[] {
  const out: OrderBlockZone[] = [];
  const seenKey = new Set<string>();
  const dispSet = new Set(displacements.map((d) => `${d.barIndex}:${d.direction}`));
  const fvgs = imbalances.filter((z) => z.kind === 'FVG');

  // 1. Classic OB + Breaker + Mitigation + Propulsion + Unicorn
  for (const br of breaks) {
    const searchStart = Math.max(0, br.barIndex - 12);
    let obIndex = -1;
    for (let k = br.barIndex - 1; k >= searchStart; k--) {
      const cand = bars[k];
      if (cand.possibleCorpActionGap) continue;
      if (br.direction === 'bullish' && cand.close < cand.open) {
        obIndex = k;
        break;
      }
      if (br.direction === 'bearish' && cand.close > cand.open) {
        obIndex = k;
        break;
      }
    }
    if (obIndex === -1) continue;

    const key = `${br.direction}:${obIndex}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);

    const obBar = bars[obIndex];
    const top = round2(obBar.high);
    const bottom = round2(obBar.low);
    const mt = round2((top + bottom) / 2);

    const isMitigationStyle = br.kind === 'CHoCH' && !br.afterSweep;
    const obKind: OrderBlockZone['kind'] = isMitigationStyle ? 'Mitigation' : 'OB';

    const ob: OrderBlockZone = {
      id: `${obKind}-${br.direction}-${obIndex}`,
      kind: obKind,
      direction: br.direction,
      startIndex: obIndex,
      startDate: obBar.date,
      endIndex: obIndex,
      endDate: obBar.date,
      top,
      bottom,
      meanThreshold: mt,
      mitigatedPct: 0,
      status: 'fresh',
      linkedBreakKind: br.kind,
      unicornOverlapFvgId: null,
      label: `${br.direction === 'bullish' ? 'Bull' : 'Bear'} ${obKind} (${bottom.toFixed(1)}–${top.toFixed(1)})`,
    };

    const { brokenAtIndex } = evaluateBlockForward(ob, bars, br.barIndex + 1);
    out.push(ob);

    // Breaker Block + Unicorn check when an OB is cleanly broken
    if (brokenAtIndex !== null) {
      const flipDir: 'bullish' | 'bearish' = br.direction === 'bullish' ? 'bearish' : 'bullish';
      const brkBar = bars[brokenAtIndex];
      const hasDispBreak = dispSet.has(`${brokenAtIndex}:${flipDir}`) || dispSet.has(`${brokenAtIndex - 1}:${flipDir}`);
      if (hasDispBreak || br.kind !== 'BOS') {
        const breaker: OrderBlockZone = {
          id: `Breaker-${flipDir}-${obIndex}-${brokenAtIndex}`,
          kind: 'Breaker',
          direction: flipDir,
          startIndex: brokenAtIndex,
          startDate: brkBar.date,
          endIndex: brokenAtIndex,
          endDate: brkBar.date,
          top,
          bottom,
          meanThreshold: mt,
          mitigatedPct: 0,
          status: 'fresh',
          linkedBreakKind: br.kind,
          unicornOverlapFvgId: null,
          label: `${flipDir === 'bullish' ? 'Bull' : 'Bear'} Breaker`,
        };
        evaluateBlockForward(breaker, bars, brokenAtIndex + 1);
        out.push(breaker);

        // Unicorn = Breaker overlapping a same-direction FVG formed near the break
        const matchingFvg = fvgs.find(
          (f) =>
            f.direction === flipDir &&
            Math.abs(f.startIndex - brokenAtIndex) <= 6 &&
            Math.min(f.top, breaker.top) > Math.max(f.bottom, breaker.bottom)
        );
        if (matchingFvg) {
          const uTop = round2(Math.min(matchingFvg.top, breaker.top));
          const uBot = round2(Math.max(matchingFvg.bottom, breaker.bottom));
          const unicorn: OrderBlockZone = {
            id: `Unicorn-${flipDir}-${brokenAtIndex}`,
            kind: 'Unicorn',
            direction: flipDir,
            startIndex: Math.max(breaker.startIndex, matchingFvg.startIndex),
            startDate: bars[Math.max(breaker.startIndex, matchingFvg.startIndex)].date,
            endIndex: Math.max(breaker.startIndex, matchingFvg.startIndex),
            endDate: bars[Math.max(breaker.startIndex, matchingFvg.startIndex)].date,
            top: uTop,
            bottom: uBot,
            meanThreshold: round2((uTop + uBot) / 2),
            mitigatedPct: 0,
            status: 'fresh',
            linkedBreakKind: br.kind,
            unicornOverlapFvgId: matchingFvg.id,
            label: `${flipDir === 'bullish' ? 'Bull' : 'Bear'} Unicorn (Breaker+FVG)`,
          };
          evaluateBlockForward(unicorn, bars, unicorn.startIndex + 1);
          out.push(unicorn);
        }
      }
    }

    // Propulsion Block: a secondary opposite candle within 8 bars launching aggressively off OB
    for (let p = br.barIndex + 2; p <= Math.min(bars.length - 3, br.barIndex + 12); p++) {
      const pb = bars[p];
      if (pb.possibleCorpActionGap) continue;
      const touchesOb = ob.direction === 'bullish'
        ? pb.low <= ob.top && pb.close >= ob.bottom && pb.close < pb.open
        : pb.high >= ob.bottom && pb.close <= ob.top && pb.close > pb.open;
      const nextFollow = ob.direction === 'bullish'
        ? bars[p + 1].close > pb.high
        : bars[p + 1].close < pb.low;
      if (touchesOb && nextFollow) {
        const prop: OrderBlockZone = {
          id: `Propulsion-${ob.direction}-${p}`,
          kind: 'Propulsion',
          direction: ob.direction,
          startIndex: p,
          startDate: pb.date,
          endIndex: p,
          endDate: pb.date,
          top: round2(pb.high),
          bottom: round2(pb.low),
          meanThreshold: round2((pb.high + pb.low) / 2),
          mitigatedPct: 0,
          status: 'fresh',
          linkedBreakKind: null,
          unicornOverlapFvgId: null,
          label: `${ob.direction === 'bullish' ? 'Bull' : 'Bear'} Propulsion`,
        };
        evaluateBlockForward(prop, bars, p + 2);
        out.push(prop);
        break;
      }
    }
  }

  // 2. Rejection Blocks (long-wick rejection candles >= 45% wick leading to impulse)
  for (let i = 2; i < bars.length - 1; i++) {
    const b = bars[i];
    if (b.possibleCorpActionGap) continue;
    const range = Math.max(0.05, b.high - b.low);
    const bodyLow = Math.min(b.open, b.close);
    const bodyHigh = Math.max(b.open, b.close);
    const lowerWick = bodyLow - b.low;
    const upperWick = b.high - bodyHigh;

    if (lowerWick / range >= 0.48 && range >= b.atr14 * 0.9 && bars[i + 1].close > b.high) {
      const rej: OrderBlockZone = {
        id: `Rejection-bull-${i}`,
        kind: 'Rejection',
        direction: 'bullish',
        startIndex: i,
        startDate: b.date,
        endIndex: i,
        endDate: b.date,
        top: round2(bodyLow),
        bottom: round2(b.low),
        meanThreshold: round2((bodyLow + b.low) / 2),
        mitigatedPct: 0,
        status: 'fresh',
        linkedBreakKind: null,
        unicornOverlapFvgId: null,
        label: 'Bull Rejection Block',
      };
      evaluateBlockForward(rej, bars, i + 2);
      out.push(rej);
    } else if (upperWick / range >= 0.48 && range >= b.atr14 * 0.9 && bars[i + 1].close < b.low) {
      const rej: OrderBlockZone = {
        id: `Rejection-bear-${i}`,
        kind: 'Rejection',
        direction: 'bearish',
        startIndex: i,
        startDate: b.date,
        endIndex: i,
        endDate: b.date,
        top: round2(b.high),
        bottom: round2(bodyHigh),
        meanThreshold: round2((b.high + bodyHigh) / 2),
        mitigatedPct: 0,
        status: 'fresh',
        linkedBreakKind: null,
        unicornOverlapFvgId: null,
        label: 'Bear Rejection Block',
      };
      evaluateBlockForward(rej, bars, i + 2);
      out.push(rej);
    }
  }

  // 3. Vacuum Blocks (isolated high-momentum gap-like expansion candles >= 1.9 ATR)
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    if (b.possibleCorpActionGap) continue;
    const body = Math.abs(b.close - b.open);
    if (b.atr14 > 0 && body / b.atr14 >= 1.95) {
      const dir: 'bullish' | 'bearish' = b.close > b.open ? 'bullish' : 'bearish';
      const vac: OrderBlockZone = {
        id: `Vacuum-${dir}-${i}`,
        kind: 'Vacuum',
        direction: dir,
        startIndex: i,
        startDate: b.date,
        endIndex: i,
        endDate: b.date,
        top: round2(Math.max(b.open, b.close)),
        bottom: round2(Math.min(b.open, b.close)),
        meanThreshold: round2((b.open + b.close) / 2),
        mitigatedPct: 0,
        status: 'fresh',
        linkedBreakKind: null,
        unicornOverlapFvgId: null,
        label: `${dir === 'bullish' ? 'Bull' : 'Bear'} Vacuum Block`,
      };
      evaluateBlockForward(vac, bars, i + 1);
      out.push(vac);
    }
  }

  return out.sort((a, b) => a.startIndex - b.startIndex);
}
