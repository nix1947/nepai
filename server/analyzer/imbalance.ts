import type {
  AnalyzerBar,
  AnalyzerConfig,
  ImbalanceZone,
} from '../../src/types/analyzer.ts';
import { round2 } from './config.ts';

function updateMitigationForward(
  zone: ImbalanceZone,
  bars: AnalyzerBar[],
  fromIndex: number
): void {
  const height = Math.max(0.05, zone.top - zone.bottom);
  let deepestPenetration = 0;

  for (let j = fromIndex; j < bars.length; j++) {
    const b = bars[j];
    if (b.possibleCorpActionGap) continue;

    if (zone.direction === 'bullish') {
      if (b.low < zone.top) {
        const pen = Math.min(height, zone.top - b.low);
        deepestPenetration = Math.max(deepestPenetration, pen);
      }
      if (b.close < zone.bottom && zone.kind === 'FVG') {
        zone.status = 'inverted';
        zone.mitigatedPct = 100;
        zone.mitigatedAtIndex = j;
        zone.mitigatedDate = b.date;
        return;
      }
      if (b.low <= zone.bottom) {
        zone.status = 'filled';
        zone.mitigatedPct = 100;
        zone.mitigatedAtIndex = j;
        zone.mitigatedDate = b.date;
        return;
      }
    } else {
      if (b.high > zone.bottom) {
        const pen = Math.min(height, b.high - zone.bottom);
        deepestPenetration = Math.max(deepestPenetration, pen);
      }
      if (b.close > zone.top && zone.kind === 'FVG') {
        zone.status = 'inverted';
        zone.mitigatedPct = 100;
        zone.mitigatedAtIndex = j;
        zone.mitigatedDate = b.date;
        return;
      }
      if (b.high >= zone.top) {
        zone.status = 'filled';
        zone.mitigatedPct = 100;
        zone.mitigatedAtIndex = j;
        zone.mitigatedDate = b.date;
        return;
      }
    }
  }

  zone.mitigatedPct = round2(Math.min(99, (deepestPenetration / height) * 100));
  zone.status = zone.mitigatedPct > 10 ? 'partial' : 'unmitigated';
}

export function detectImbalances(
  bars: AnalyzerBar[],
  cfg: AnalyzerConfig
): ImbalanceZone[] {
  const zones: ImbalanceZone[] = [];
  const fvgs: ImbalanceZone[] = [];

  // 1. 3-Candle FVG & IFVG (confirmed strictly at bar i+2)
  for (let i = 0; i + 2 < bars.length; i++) {
    const b1 = bars[i];
    const b2 = bars[i + 1];
    const b3 = bars[i + 2];
    if (b1.possibleCorpActionGap || b2.possibleCorpActionGap || b3.possibleCorpActionGap) {
      continue;
    }

    const minSize = Math.max(0.2, b2.atr14 * cfg.fvgMinAtr);

    // Bullish FVG: b1.high < b3.low
    if (b3.low > b1.high && b3.low - b1.high >= minSize && b2.close > b2.open) {
      const z: ImbalanceZone = {
        id: `FVG-bull-${i + 1}`,
        kind: 'FVG',
        direction: 'bullish',
        startIndex: i + 1,
        startDate: b2.date,
        endIndex: i + 2,
        endDate: b3.date,
        top: round2(b3.low),
        bottom: round2(b1.high),
        ce50: round2((b3.low + b1.high) / 2),
        mitigatedPct: 0,
        status: 'unmitigated',
        mitigatedAtIndex: null,
        mitigatedDate: null,
        corpActionFlagged: false,
        label: `Bull FVG (${b1.high.toFixed(1)}–${b3.low.toFixed(1)})`,
      };
      updateMitigationForward(z, bars, i + 3);
      zones.push(z);
      fvgs.push(z);

      // Inversion FVG (IFVG) if a subsequent candle decisively closed below bullish FVG bottom
      if (z.status === 'inverted' && z.mitigatedAtIndex !== null) {
        const invBar = bars[z.mitigatedAtIndex];
        const inv: ImbalanceZone = {
          id: `IFVG-bear-${z.mitigatedAtIndex}`,
          kind: 'IFVG',
          direction: 'bearish',
          startIndex: z.mitigatedAtIndex,
          startDate: invBar.date,
          endIndex: z.mitigatedAtIndex,
          endDate: invBar.date,
          top: z.top,
          bottom: z.bottom,
          ce50: z.ce50,
          mitigatedPct: 0,
          status: 'unmitigated',
          mitigatedAtIndex: null,
          mitigatedDate: null,
          corpActionFlagged: false,
          label: `Bearish IFVG (${z.bottom.toFixed(1)}–${z.top.toFixed(1)})`,
        };
        updateMitigationForward(inv, bars, z.mitigatedAtIndex + 1);
        zones.push(inv);
      }
    }

    // Bearish FVG: b1.low > b3.high
    if (b1.low > b3.high && b1.low - b3.high >= minSize && b2.close < b2.open) {
      const z: ImbalanceZone = {
        id: `FVG-bear-${i + 1}`,
        kind: 'FVG',
        direction: 'bearish',
        startIndex: i + 1,
        startDate: b2.date,
        endIndex: i + 2,
        endDate: b3.date,
        top: round2(b1.low),
        bottom: round2(b3.high),
        ce50: round2((b1.low + b3.high) / 2),
        mitigatedPct: 0,
        status: 'unmitigated',
        mitigatedAtIndex: null,
        mitigatedDate: null,
        corpActionFlagged: false,
        label: `Bear FVG (${b3.high.toFixed(1)}–${b1.low.toFixed(1)})`,
      };
      updateMitigationForward(z, bars, i + 3);
      zones.push(z);
      fvgs.push(z);

      if (z.status === 'inverted' && z.mitigatedAtIndex !== null) {
        const invBar = bars[z.mitigatedAtIndex];
        const inv: ImbalanceZone = {
          id: `IFVG-bull-${z.mitigatedAtIndex}`,
          kind: 'IFVG',
          direction: 'bullish',
          startIndex: z.mitigatedAtIndex,
          startDate: invBar.date,
          endIndex: z.mitigatedAtIndex,
          endDate: invBar.date,
          top: z.top,
          bottom: z.bottom,
          ce50: z.ce50,
          mitigatedPct: 0,
          status: 'unmitigated',
          mitigatedAtIndex: null,
          mitigatedDate: null,
          corpActionFlagged: false,
          label: `Bullish IFVG (${z.bottom.toFixed(1)}–${z.top.toFixed(1)})`,
        };
        updateMitigationForward(inv, bars, z.mitigatedAtIndex + 1);
        zones.push(inv);
      }
    }
  }

  // 2. Balanced Price Range (BPR): recent overlapping bullish + bearish FVGs within 25 bars
  for (let i = 0; i < fvgs.length; i++) {
    for (let j = i + 1; j < fvgs.length; j++) {
      const a = fvgs[i];
      const b = fvgs[j];
      if (a.direction === b.direction) continue;
      if (b.startIndex - a.startIndex > 25) continue;
      const overlapBottom = Math.max(a.bottom, b.bottom);
      const overlapTop = Math.min(a.top, b.top);
      if (overlapTop > overlapBottom) {
        const bpr: ImbalanceZone = {
          id: `BPR-${a.startIndex}-${b.startIndex}`,
          kind: 'BPR',
          direction: b.direction,
          startIndex: b.startIndex,
          startDate: b.startDate,
          endIndex: b.endIndex,
          endDate: b.endDate,
          top: round2(overlapTop),
          bottom: round2(overlapBottom),
          ce50: round2((overlapTop + overlapBottom) / 2),
          mitigatedPct: 0,
          status: 'unmitigated',
          mitigatedAtIndex: null,
          mitigatedDate: null,
          corpActionFlagged: false,
          label: `${b.direction === 'bullish' ? 'Bull' : 'Bear'} BPR`,
        };
        updateMitigationForward(bpr, bars, b.endIndex + 1);
        zones.push(bpr);
      }
    }
  }

  // 3. Volume Imbalance & Overnight Gaps (guarded for NEPSE corp actions)
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    const prevBodyTop = Math.max(prev.open, prev.close);
    const prevBodyBot = Math.min(prev.open, prev.close);
    const currBodyTop = Math.max(curr.open, curr.close);
    const currBodyBot = Math.min(curr.open, curr.close);

    if (curr.possibleCorpActionGap) {
      zones.push({
        id: `CORP-GAP-${i}`,
        kind: 'Gap',
        direction: curr.close >= prev.close ? 'bullish' : 'bearish',
        startIndex: i - 1,
        startDate: prev.date,
        endIndex: i,
        endDate: curr.date,
        top: round2(Math.max(prev.close, curr.open)),
        bottom: round2(Math.min(prev.close, curr.open)),
        ce50: round2((prev.close + curr.open) / 2),
        mitigatedPct: 100,
        status: 'filled',
        mitigatedAtIndex: i,
        mitigatedDate: curr.date,
        corpActionFlagged: true,
        label: 'Possible Bonus/Right Gap (Excluded from FVG)',
      });
      continue;
    }

    // Normal wick-free price gap
    if (curr.low > prev.high && curr.low - prev.high >= curr.atr14 * 0.2) {
      const gap: ImbalanceZone = {
        id: `GAP-bull-${i}`,
        kind: 'Gap',
        direction: 'bullish',
        startIndex: i - 1,
        startDate: prev.date,
        endIndex: i,
        endDate: curr.date,
        top: round2(curr.low),
        bottom: round2(prev.high),
        ce50: round2((curr.low + prev.high) / 2),
        mitigatedPct: 0,
        status: 'unmitigated',
        mitigatedAtIndex: null,
        mitigatedDate: null,
        corpActionFlagged: false,
        label: 'Bullish Opening Gap',
      };
      updateMitigationForward(gap, bars, i + 1);
      zones.push(gap);
    } else if (currBodyBot > prevBodyTop && currBodyBot - prevBodyTop >= curr.atr14 * 0.15) {
      // Volume imbalance: gap between real bodies with overlapping wicks
      const vi: ImbalanceZone = {
        id: `VI-bull-${i}`,
        kind: 'VolumeImbalance',
        direction: 'bullish',
        startIndex: i - 1,
        startDate: prev.date,
        endIndex: i,
        endDate: curr.date,
        top: round2(currBodyBot),
        bottom: round2(prevBodyTop),
        ce50: round2((currBodyBot + prevBodyTop) / 2),
        mitigatedPct: 0,
        status: 'unmitigated',
        mitigatedAtIndex: null,
        mitigatedDate: null,
        corpActionFlagged: false,
        label: 'Bull Vol Imbalance',
      };
      updateMitigationForward(vi, bars, i + 1);
      zones.push(vi);
    } else if (currBodyTop < prevBodyBot && prevBodyBot - currBodyTop >= curr.atr14 * 0.15) {
      const vi: ImbalanceZone = {
        id: `VI-bear-${i}`,
        kind: 'VolumeImbalance',
        direction: 'bearish',
        startIndex: i - 1,
        startDate: prev.date,
        endIndex: i,
        endDate: curr.date,
        top: round2(prevBodyBot),
        bottom: round2(currBodyTop),
        ce50: round2((prevBodyBot + currBodyTop) / 2),
        mitigatedPct: 0,
        status: 'unmitigated',
        mitigatedAtIndex: null,
        mitigatedDate: null,
        corpActionFlagged: false,
        label: 'Bear Vol Imbalance',
      };
      updateMitigationForward(vi, bars, i + 1);
      zones.push(vi);
    }
  }

  // 4. Liquidity Voids: 2+ consecutive wide displacement candles in the same direction
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 1];
    const b = bars[i];
    if (a.possibleCorpActionGap || b.possibleCorpActionGap) continue;
    const bodyA = a.close - a.open;
    const bodyB = b.close - b.open;
    if (bodyA > a.atr14 * 1.1 && bodyB > b.atr14 * 1.1) {
      const lv: ImbalanceZone = {
        id: `VOID-bull-${i}`,
        kind: 'LiquidityVoid',
        direction: 'bullish',
        startIndex: i - 1,
        startDate: a.date,
        endIndex: i,
        endDate: b.date,
        top: round2(b.close),
        bottom: round2(a.open),
        ce50: round2((b.close + a.open) / 2),
        mitigatedPct: 0,
        status: 'unmitigated',
        mitigatedAtIndex: null,
        mitigatedDate: null,
        corpActionFlagged: false,
        label: 'Bullish Liquidity Void',
      };
      updateMitigationForward(lv, bars, i + 1);
      zones.push(lv);
    } else if (-bodyA > a.atr14 * 1.1 && -bodyB > b.atr14 * 1.1) {
      const lv: ImbalanceZone = {
        id: `VOID-bear-${i}`,
        kind: 'LiquidityVoid',
        direction: 'bearish',
        startIndex: i - 1,
        startDate: a.date,
        endIndex: i,
        endDate: b.date,
        top: round2(a.open),
        bottom: round2(b.close),
        ce50: round2((a.open + b.close) / 2),
        mitigatedPct: 0,
        status: 'unmitigated',
        mitigatedAtIndex: null,
        mitigatedDate: null,
        corpActionFlagged: false,
        label: 'Bearish Liquidity Void',
      };
      updateMitigationForward(lv, bars, i + 1);
      zones.push(lv);
    }
  }

  return zones.sort((a, b) => a.startIndex - b.startIndex);
}
