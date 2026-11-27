import type {
  AnalyzerBar,
  AnalyzerConfig,
  DisplacementCandle,
  StructureBreak,
  SwingPoint,
} from '../../src/types/analyzer.ts';
import { round2 } from './config.ts';

export interface StructureAnalysis {
  displacements: DisplacementCandle[];
  breaks: StructureBreak[];
  trendState: 'Bullish' | 'Bearish' | 'Ranging';
}

export function detectDisplacements(
  bars: AnalyzerBar[],
  cfg: AnalyzerConfig
): DisplacementCandle[] {
  const out: DisplacementCandle[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    if (b.possibleCorpActionGap) continue;
    const range = Math.max(0.01, b.high - b.low);
    const body = Math.abs(b.close - b.open);
    const bodyAtrMult = b.atr14 > 0 ? body / b.atr14 : 0;
    const bodyRatio = body / range;
    if (bodyAtrMult >= cfg.displacementBodyAtr && bodyRatio >= cfg.displacementBodyRatio) {
      out.push({
        barIndex: i,
        date: b.date,
        direction: b.close >= b.open ? 'bullish' : 'bearish',
        bodyAtrMult: round2(bodyAtrMult),
        closePosPct: round2(((b.close - b.low) / range) * 100),
      });
    }
  }
  return out;
}

function analyzeTierStructure(
  bars: AnalyzerBar[],
  swings: SwingPoint[],
  tier: 'internal' | 'external',
  dispMap: Map<number, DisplacementCandle>
): { breaks: StructureBreak[]; finalTrend: 'Bullish' | 'Bearish' | 'Ranging' } {
  const tierSwings = swings
    .filter((s) => s.tier === tier)
    .sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex);

  const breaks: StructureBreak[] = [];
  let trend: 'Bullish' | 'Bearish' | 'Ranging' = 'Ranging';
  let activeHigh: SwingPoint | null = null;
  let activeLow: SwingPoint | null = null;
  const brokenSwingIds = new Set<string>();
  let recentSweepBullBar = -99;
  let recentSweepBearBar = -99;

  // Track wick sweeps and confirmed swings causally bar by bar
  let swingCursor = 0;
  for (let i = 0; i < bars.length; i++) {
    while (swingCursor < tierSwings.length && tierSwings[swingCursor].confirmedAtIndex === i) {
      const s = tierSwings[swingCursor];
      if (s.kind === 'high') activeHigh = s;
      else activeLow = s;
      swingCursor++;
    }

    const bar = bars[i];
    if (bar.possibleCorpActionGap) continue;

    // Detect liquidity wick sweeps (pierce without closing beyond swing)
    if (activeLow && !brokenSwingIds.has(activeLow.id) && bar.low < activeLow.price && bar.close > activeLow.price) {
      recentSweepBullBar = i;
    }
    if (activeHigh && !brokenSwingIds.has(activeHigh.id) && bar.high > activeHigh.price && bar.close < activeHigh.price) {
      recentSweepBearBar = i;
    }

    const disp = dispMap.get(i);
    const prevDisp = dispMap.get(i - 1);
    const hasBullDisp = (disp?.direction === 'bullish') || (prevDisp?.direction === 'bullish');
    const hasBearDisp = (disp?.direction === 'bearish') || (prevDisp?.direction === 'bearish');

    if (activeHigh && !brokenSwingIds.has(activeHigh.id) && bar.close > activeHigh.price) {
      brokenSwingIds.add(activeHigh.id);
      const isReversal = trend === 'Bearish';
      const afterSweep = i - recentSweepBullBar <= 10;
      const kind: StructureBreak['kind'] =
        isReversal && hasBullDisp ? 'MSS' : isReversal ? 'CHoCH' : 'BOS';
      breaks.push({
        id: `${tier}-${kind}-bull-${i}`,
        kind,
        direction: 'bullish',
        tier,
        barIndex: i,
        date: bar.date,
        breakPrice: activeHigh.price,
        brokenSwingIndex: activeHigh.barIndex,
        brokenSwingDate: activeHigh.date,
        hasDisplacement: hasBullDisp,
        afterSweep,
        description: `${tier.toUpperCase()} Bullish ${kind} closed (${bar.close.toFixed(1)}) above swing high ${activeHigh.price.toFixed(1)} (${activeHigh.date})${afterSweep ? ' post-sweep' : ''}${hasBullDisp ? ' with displacement' : ''}.`,
      });
      trend = 'Bullish';
    }

    if (activeLow && !brokenSwingIds.has(activeLow.id) && bar.close < activeLow.price) {
      brokenSwingIds.add(activeLow.id);
      const isReversal = trend === 'Bullish';
      const afterSweep = i - recentSweepBearBar <= 10;
      const kind: StructureBreak['kind'] =
        isReversal && hasBearDisp ? 'MSS' : isReversal ? 'CHoCH' : 'BOS';
      breaks.push({
        id: `${tier}-${kind}-bear-${i}`,
        kind,
        direction: 'bearish',
        tier,
        barIndex: i,
        date: bar.date,
        breakPrice: activeLow.price,
        brokenSwingIndex: activeLow.barIndex,
        brokenSwingDate: activeLow.date,
        hasDisplacement: hasBearDisp,
        afterSweep,
        description: `${tier.toUpperCase()} Bearish ${kind} closed (${bar.close.toFixed(1)}) below swing low ${activeLow.price.toFixed(1)} (${activeLow.date})${afterSweep ? ' post-sweep' : ''}${hasBearDisp ? ' with displacement' : ''}.`,
      });
      trend = 'Bearish';
    }
  }

  return { breaks, finalTrend: trend };
}

export function detectMarketStructure(
  bars: AnalyzerBar[],
  swings: SwingPoint[],
  cfg: AnalyzerConfig
): StructureAnalysis {
  const displacements = detectDisplacements(bars, cfg);
  const dispMap = new Map<number, DisplacementCandle>();
  for (const d of displacements) dispMap.set(d.barIndex, d);

  const internalRes = analyzeTierStructure(bars, swings, 'internal', dispMap);
  const externalRes = analyzeTierStructure(bars, swings, 'external', dispMap);

  const breaks = [...internalRes.breaks, ...externalRes.breaks].sort(
    (a, b) => a.barIndex - b.barIndex
  );

  const trendState =
    externalRes.finalTrend !== 'Ranging' ? externalRes.finalTrend : internalRes.finalTrend;

  return { displacements, breaks, trendState };
}
