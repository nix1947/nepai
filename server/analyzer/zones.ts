import type {
  AnalyzerBar,
  SupplyDemandZone,
  WyckoffPhaseRead,
} from '../../src/types/analyzer.ts';
import { round2 } from './config.ts';

function stampSdFreshness(zone: SupplyDemandZone, bars: AnalyzerBar[], fromIdx: number): void {
  const height = Math.max(0.05, zone.top - zone.bottom);
  let touches = 0;
  for (let j = fromIdx; j < bars.length; j++) {
    const b = bars[j];
    if (b.possibleCorpActionGap) continue;
    if (zone.kind === 'Demand') {
      if (b.close < zone.bottom) {
        zone.freshness = 'Mitigated';
        return;
      }
      if (b.low <= zone.top) {
        touches++;
        if (b.low <= zone.bottom + height * 0.25) {
          zone.freshness = 'Mitigated';
          return;
        }
      }
    } else {
      if (b.close > zone.top) {
        zone.freshness = 'Mitigated';
        return;
      }
      if (b.high >= zone.bottom) {
        touches++;
        if (b.high >= zone.top - height * 0.25) {
          zone.freshness = 'Mitigated';
          return;
        }
      }
    }
  }
  zone.freshness = touches > 0 ? 'Tested' : 'Fresh';
}

export function detectSupplyDemandZones(bars: AnalyzerBar[]): SupplyDemandZone[] {
  const out: SupplyDemandZone[] = [];
  if (bars.length < 8) return out;

  for (let i = 2; i < bars.length - 2; i++) {
    const legIn = bars[i - 1];
    const base = bars[i];
    const legOut = bars[i + 1];
    if (legIn.possibleCorpActionGap || base.possibleCorpActionGap || legOut.possibleCorpActionGap) {
      continue;
    }

    const atr = Math.max(0.5, base.atr14);
    const baseBody = Math.abs(base.close - base.open);
    const baseRange = base.high - base.low;
    const isTightBase = baseBody <= atr * 0.65 && baseRange <= atr * 1.15;
    if (!isTightBase) continue;

    const legInDir = legIn.close - legIn.open;
    const legOutDir = legOut.close - legOut.open;

    // Demand: Drop-Base-Rally (DBR) or Rally-Base-Rally (RBR)
    if (legOutDir >= atr * 1.1 && Math.abs(legInDir) >= atr * 0.6) {
      const pattern: SupplyDemandZone['pattern'] = legInDir > 0 ? 'RBR' : 'DBR';
      const z: SupplyDemandZone = {
        id: `SD-${pattern}-${i}`,
        pattern,
        kind: 'Demand',
        startIndex: i,
        startDate: base.date,
        endIndex: i,
        endDate: base.date,
        top: round2(Math.max(base.open, base.close, base.high - baseRange * 0.25)),
        bottom: round2(base.low),
        freshness: 'Fresh',
        impulseMultiple: round2(legOutDir / atr),
      };
      stampSdFreshness(z, bars, i + 2);
      out.push(z);
    }

    // Supply: Rally-Base-Drop (RBD) or Drop-Base-Drop (DBD)
    if (-legOutDir >= atr * 1.1 && Math.abs(legInDir) >= atr * 0.6) {
      const pattern: SupplyDemandZone['pattern'] = legInDir < 0 ? 'DBD' : 'RBD';
      const z: SupplyDemandZone = {
        id: `SD-${pattern}-${i}`,
        pattern,
        kind: 'Supply',
        startIndex: i,
        startDate: base.date,
        endIndex: i,
        endDate: base.date,
        top: round2(base.high),
        bottom: round2(Math.min(base.open, base.close, base.low + baseRange * 0.25)),
        freshness: 'Fresh',
        impulseMultiple: round2(-legOutDir / atr),
      };
      stampSdFreshness(z, bars, i + 2);
      out.push(z);
    }
  }

  return out.filter((z) => z.freshness !== 'Mitigated').slice(-12);
}

export function detectWyckoffExperimental(bars: AnalyzerBar[]): WyckoffPhaseRead {
  if (bars.length < 30) {
    return {
      experimental: true,
      regimePhase: 'Indeterminate Range',
      bias: 'Neutral',
      events: [],
      summary: 'Insufficient sessions (<30) for experimental Wyckoff phase classification.',
    };
  }

  const window = bars.slice(-60);
  const offset = bars.length - window.length;
  const avgVol = window.reduce((s, b) => s + b.volume, 0) / Math.max(1, window.length);
  const events: WyckoffPhaseRead['events'] = [];

  // Selling Climax (SC) or Buying Climax (BC)
  let scIdx = -1;
  let bcIdx = -1;
  for (let i = 2; i < window.length - 5; i++) {
    const b = window[i];
    if (b.possibleCorpActionGap) continue;
    if (b.volume >= avgVol * 1.8 && b.close < b.open && (b.close - b.low) / Math.max(0.1, b.high - b.low) >= 0.45) {
      if (scIdx === -1 || b.low < window[scIdx].low) scIdx = i;
    }
    if (b.volume >= avgVol * 1.8 && b.close > b.open && (b.high - b.close) / Math.max(0.1, b.high - b.low) >= 0.45) {
      if (bcIdx === -1 || b.high > window[bcIdx].high) bcIdx = i;
    }
  }

  const last = window[window.length - 1];
  const midLow = Math.min(...window.slice(0, -10).map((b) => b.low));
  const midHigh = Math.max(...window.slice(0, -10).map((b) => b.high));

  if (scIdx >= 0) {
    events.push({
      barIndex: offset + scIdx,
      date: window[scIdx].date,
      event: 'SC',
      price: round2(window[scIdx].low),
    });
    const arSlice = window.slice(scIdx + 1, Math.min(window.length, scIdx + 10));
    if (arSlice.length > 0) {
      const arBar = arSlice.reduce((best, b) => (b.high > best.high ? b : best), arSlice[0]);
      const arGlobal = bars.findIndex((x) => x.date === arBar.date);
      events.push({ barIndex: arGlobal, date: arBar.date, event: 'AR', price: round2(arBar.high) });
    }
  }
  if (bcIdx >= 0) {
    events.push({
      barIndex: offset + bcIdx,
      date: window[bcIdx].date,
      event: 'BC',
      price: round2(window[bcIdx].high),
    });
  }

  // Detect Phase C Spring or Upthrust in the last 10 bars
  let hasSpring = false;
  let hasUt = false;
  let hasSos = false;

  for (let i = Math.max(10, window.length - 12); i < window.length; i++) {
    const b = window[i];
    if (b.low < midLow && b.close >= midLow) {
      hasSpring = true;
      events.push({ barIndex: offset + i, date: b.date, event: 'Spring', price: round2(b.low) });
    }
    if (b.high > midHigh && b.close <= midHigh) {
      hasUt = true;
      events.push({ barIndex: offset + i, date: b.date, event: 'UTAD', price: round2(b.high) });
    }
    if (b.close > midHigh && b.volume >= avgVol * 1.35) {
      hasSos = true;
      events.push({ barIndex: offset + i, date: b.date, event: 'SOS', price: round2(b.close) });
    }
  }

  if (hasSos && last.close > midHigh * 0.98) {
    return {
      experimental: true,
      regimePhase: 'Phase D (SOS / LPS Markup)',
      bias: 'Accumulation',
      events,
      summary: 'Experimental Wyckoff read: Sign of Strength (SOS) expansion above trading range ceiling with volume support.',
    };
  }
  if (hasSpring) {
    return {
      experimental: true,
      regimePhase: 'Phase C (Spring / Upthrust Test)',
      bias: 'Accumulation',
      events,
      summary: 'Experimental Wyckoff read: Phase C Spring shook below range support and closed back inside range.',
    };
  }
  if (hasUt) {
    return {
      experimental: true,
      regimePhase: 'Phase C (Spring / Upthrust Test)',
      bias: 'Distribution',
      events,
      summary: 'Experimental Wyckoff warning: Upthrust (UTAD) pierced ceiling and rejected back inside range.',
    };
  }
  if (scIdx >= 0 && last.close > window[scIdx].low) {
    return {
      experimental: true,
      regimePhase: 'Phase B (Cause Building)',
      bias: 'Accumulation',
      events,
      summary: 'Experimental Wyckoff read: Building lateral cause above prior Selling Climax (SC) floor.',
    };
  }

  return {
    experimental: true,
    regimePhase: 'Indeterminate Range',
    bias: 'Neutral',
    events,
    summary: 'Experimental Wyckoff read: No clear climax/spring/SOS signature isolated within the trailing 60-bar range.',
  };
}
