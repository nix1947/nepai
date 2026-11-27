import type { PriceRow } from '../../src/types/market.ts';
import type {
  AnalyzerBar,
  AnalyzerConfig,
  DrawOnLiquidityTarget,
  LiquidityLevel,
  SwingPoint,
} from '../../src/types/analyzer.ts';
import { aggregateOhlcv, round2 } from './config.ts';

function stampLevelSweep(lvl: LiquidityLevel, bars: AnalyzerBar[], fromIndex: number): void {
  for (let j = fromIndex; j < bars.length; j++) {
    const b = bars[j];
    if (b.possibleCorpActionGap) continue;
    if (lvl.side === 'buyside' && b.high > lvl.price) {
      lvl.swept = true;
      lvl.sweptAtIndex = j;
      lvl.sweptDate = b.date;
      // Sweep = wicked above and closed back below level; Run = closed decisively above
      lvl.sweptKind = b.close <= lvl.price ? 'sweep' : 'run';
      if (lvl.sweptKind === 'sweep' && j - lvl.startIndex >= 15) {
        lvl.turtleSoup = true;
      }
      return;
    }
    if (lvl.side === 'sellside' && b.low < lvl.price) {
      lvl.swept = true;
      lvl.sweptAtIndex = j;
      lvl.sweptDate = b.date;
      lvl.sweptKind = b.close >= lvl.price ? 'sweep' : 'run';
      if (lvl.sweptKind === 'sweep' && j - lvl.startIndex >= 15) {
        lvl.turtleSoup = true;
      }
      return;
    }
  }
}

export function detectLiquidityAndDraw(
  bars: AnalyzerBar[],
  dailyRowsUpToAsOf: PriceRow[],
  swings: SwingPoint[],
  cfg: AnalyzerConfig
): {
  levels: LiquidityLevel[];
  drawOnLiquidity: DrawOnLiquidityTarget[];
} {
  if (bars.length === 0) return { levels: [], drawOnLiquidity: [] };

  const levels: LiquidityLevel[] = [];
  const lastIdx = bars.length - 1;
  const lastBar = bars[lastIdx];

  // 1. BSL / SSL from external and recent internal swings
  const poolSwings = swings.filter((s) => s.tier === 'external' || s.tier === 'internal').slice(-36);
  for (const s of poolSwings) {
    const lvl: LiquidityLevel = {
      id: `${s.kind === 'high' ? 'BSL' : 'SSL'}-${s.id}`,
      kind: s.kind === 'high' ? 'BSL' : 'SSL',
      side: s.kind === 'high' ? 'buyside' : 'sellside',
      price: round2(s.price),
      startIndex: s.barIndex,
      startDate: s.date,
      swept: false,
      sweptKind: null,
      sweptAtIndex: null,
      sweptDate: null,
      turtleSoup: false,
      label: `${s.kind === 'high' ? 'BSL' : 'SSL'} (${s.label} ${s.price.toFixed(1)})`,
    };
    stampLevelSweep(lvl, bars, s.confirmedAtIndex + 1);
    levels.push(lvl);
  }

  // 2. Equal Highs (EQH) / Equal Lows (EQL)
  const highs = swings.filter((s) => s.kind === 'high' && s.tier !== 'minor').slice(-18);
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const a = highs[i];
      const b = highs[j];
      if (b.barIndex - a.barIndex < 4) continue;
      const diffPct = (Math.abs(a.price - b.price) / Math.max(0.1, a.price)) * 100;
      if (diffPct <= cfg.eqTolerancePct) {
        const avgP = round2((a.price + b.price) / 2);
        const eqh: LiquidityLevel = {
          id: `EQH-${a.barIndex}-${b.barIndex}`,
          kind: 'EQH',
          side: 'buyside',
          price: round2(Math.max(a.price, b.price)),
          startIndex: b.barIndex,
          startDate: b.date,
          swept: false,
          sweptKind: null,
          sweptAtIndex: null,
          sweptDate: null,
          turtleSoup: false,
          label: `EQH ~${avgP.toFixed(1)}`,
        };
        stampLevelSweep(eqh, bars, b.confirmedAtIndex + 1);
        levels.push(eqh);
        break;
      }
    }
  }

  const lows = swings.filter((s) => s.kind === 'low' && s.tier !== 'minor').slice(-18);
  for (let i = 0; i < lows.length; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      const a = lows[i];
      const b = lows[j];
      if (b.barIndex - a.barIndex < 4) continue;
      const diffPct = (Math.abs(a.price - b.price) / Math.max(0.1, a.price)) * 100;
      if (diffPct <= cfg.eqTolerancePct) {
        const avgP = round2((a.price + b.price) / 2);
        const eql: LiquidityLevel = {
          id: `EQL-${a.barIndex}-${b.barIndex}`,
          kind: 'EQL',
          side: 'sellside',
          price: round2(Math.min(a.price, b.price)),
          startIndex: b.barIndex,
          startDate: b.date,
          swept: false,
          sweptKind: null,
          sweptAtIndex: null,
          sweptDate: null,
          turtleSoup: false,
          label: `EQL ~${avgP.toFixed(1)}`,
        };
        stampLevelSweep(eql, bars, b.confirmedAtIndex + 1);
        levels.push(eql);
        break;
      }
    }
  }

  // 3. Inducement (IDM): most recent minor pivot sitting ahead of current structural swing
  const recentMinor = swings.filter((s) => s.tier === 'minor' && s.confirmedAtIndex >= Math.max(0, lastIdx - 25));
  const lastMinorLow = [...recentMinor].reverse().find((s) => s.kind === 'low');
  if (lastMinorLow) {
    const idm: LiquidityLevel = {
      id: `IDM-low-${lastMinorLow.barIndex}`,
      kind: 'Inducement',
      side: 'sellside',
      price: round2(lastMinorLow.price),
      startIndex: lastMinorLow.barIndex,
      startDate: lastMinorLow.date,
      swept: false,
      sweptKind: null,
      sweptAtIndex: null,
      sweptDate: null,
      turtleSoup: false,
      label: `IDM SSL (${lastMinorLow.price.toFixed(1)})`,
    };
    stampLevelSweep(idm, bars, lastMinorLow.confirmedAtIndex + 1);
    levels.push(idm);
  }
  const lastMinorHigh = [...recentMinor].reverse().find((s) => s.kind === 'high');
  if (lastMinorHigh) {
    const idm: LiquidityLevel = {
      id: `IDM-high-${lastMinorHigh.barIndex}`,
      kind: 'Inducement',
      side: 'buyside',
      price: round2(lastMinorHigh.price),
      startIndex: lastMinorHigh.barIndex,
      startDate: lastMinorHigh.date,
      swept: false,
      sweptKind: null,
      sweptAtIndex: null,
      sweptDate: null,
      turtleSoup: false,
      label: `IDM BSL (${lastMinorHigh.price.toFixed(1)})`,
    };
    stampLevelSweep(idm, bars, lastMinorHigh.confirmedAtIndex + 1);
    levels.push(idm);
  }

  // 4. PDH/PDL, PWH/PWL, PMH/PML, 52W High/Low
  const mapDateToBarIdx = (d: string) => {
    const found = bars.findIndex((b) => b.date >= d);
    return found >= 0 ? found : Math.max(0, lastIdx - 1);
  };

  if (dailyRowsUpToAsOf.length >= 2) {
    const pd = dailyRowsUpToAsOf[dailyRowsUpToAsOf.length - 2];
    const startIdx = Math.max(0, lastIdx - 1);
    const pdh: LiquidityLevel = {
      id: `PDH-${pd.date}`,
      kind: 'PDH',
      side: 'buyside',
      price: round2(pd.high),
      startIndex: startIdx,
      startDate: bars[startIdx].date,
      swept: lastBar.high > pd.high,
      sweptKind: lastBar.high > pd.high ? (lastBar.close <= pd.high ? 'sweep' : 'run') : null,
      sweptAtIndex: lastBar.high > pd.high ? lastIdx : null,
      sweptDate: lastBar.high > pd.high ? lastBar.date : null,
      turtleSoup: false,
      label: `PDH ${pd.high.toFixed(1)}`,
    };
    const pdl: LiquidityLevel = {
      id: `PDL-${pd.date}`,
      kind: 'PDL',
      side: 'sellside',
      price: round2(pd.low),
      startIndex: startIdx,
      startDate: bars[startIdx].date,
      swept: lastBar.low < pd.low,
      sweptKind: lastBar.low < pd.low ? (lastBar.close >= pd.low ? 'sweep' : 'run') : null,
      sweptAtIndex: lastBar.low < pd.low ? lastIdx : null,
      sweptDate: lastBar.low < pd.low ? lastBar.date : null,
      turtleSoup: false,
      label: `PDL ${pd.low.toFixed(1)}`,
    };
    levels.push(pdh, pdl);
  }

  const weeklyRows = aggregateOhlcv(dailyRowsUpToAsOf, '1W');
  if (weeklyRows.length >= 2) {
    const pw = weeklyRows[weeklyRows.length - 2];
    const startIdx = mapDateToBarIdx(pw.date);
    const pwh: LiquidityLevel = {
      id: `PWH-${pw.date}`,
      kind: 'PWH',
      side: 'buyside',
      price: round2(pw.high),
      startIndex: startIdx,
      startDate: bars[startIdx].date,
      swept: false,
      sweptKind: null,
      sweptAtIndex: null,
      sweptDate: null,
      turtleSoup: false,
      label: `PWH ${pw.high.toFixed(1)}`,
    };
    const pwl: LiquidityLevel = {
      id: `PWL-${pw.date}`,
      kind: 'PWL',
      side: 'sellside',
      price: round2(pw.low),
      startIndex: startIdx,
      startDate: bars[startIdx].date,
      swept: false,
      sweptKind: null,
      sweptAtIndex: null,
      sweptDate: null,
      turtleSoup: false,
      label: `PWL ${pw.low.toFixed(1)}`,
    };
    stampLevelSweep(pwh, bars, Math.min(lastIdx, startIdx + 1));
    stampLevelSweep(pwl, bars, Math.min(lastIdx, startIdx + 1));
    levels.push(pwh, pwl);
  }

  const monthlyRows = aggregateOhlcv(dailyRowsUpToAsOf, '1M');
  if (monthlyRows.length >= 2) {
    const pm = monthlyRows[monthlyRows.length - 2];
    const startIdx = mapDateToBarIdx(pm.date);
    const pmh: LiquidityLevel = {
      id: `PMH-${pm.date}`,
      kind: 'PMH',
      side: 'buyside',
      price: round2(pm.high),
      startIndex: startIdx,
      startDate: bars[startIdx].date,
      swept: false,
      sweptKind: null,
      sweptAtIndex: null,
      sweptDate: null,
      turtleSoup: false,
      label: `PMH ${pm.high.toFixed(1)}`,
    };
    const pml: LiquidityLevel = {
      id: `PML-${pm.date}`,
      kind: 'PML',
      side: 'sellside',
      price: round2(pm.low),
      startIndex: startIdx,
      startDate: bars[startIdx].date,
      swept: false,
      sweptKind: null,
      sweptAtIndex: null,
      sweptDate: null,
      turtleSoup: false,
      label: `PML ${pm.low.toFixed(1)}`,
    };
    stampLevelSweep(pmh, bars, Math.min(lastIdx, startIdx + 1));
    stampLevelSweep(pml, bars, Math.min(lastIdx, startIdx + 1));
    levels.push(pmh, pml);
  }

  if (lastBar.w52_high && lastBar.w52_high > 0) {
    levels.push({
      id: 'W52H',
      kind: 'W52H',
      side: 'buyside',
      price: round2(lastBar.w52_high),
      startIndex: Math.max(0, lastIdx - 20),
      startDate: bars[Math.max(0, lastIdx - 20)].date,
      swept: lastBar.high >= lastBar.w52_high,
      sweptKind: lastBar.high >= lastBar.w52_high ? 'run' : null,
      sweptAtIndex: lastBar.high >= lastBar.w52_high ? lastIdx : null,
      sweptDate: lastBar.high >= lastBar.w52_high ? lastBar.date : null,
      turtleSoup: false,
      label: `52W High ${lastBar.w52_high.toFixed(1)}`,
    });
  }
  if (lastBar.w52_low && lastBar.w52_low > 0) {
    levels.push({
      id: 'W52L',
      kind: 'W52L',
      side: 'sellside',
      price: round2(lastBar.w52_low),
      startIndex: Math.max(0, lastIdx - 20),
      startDate: bars[Math.max(0, lastIdx - 20)].date,
      swept: lastBar.low <= lastBar.w52_low,
      sweptKind: lastBar.low <= lastBar.w52_low ? 'run' : null,
      sweptAtIndex: lastBar.low <= lastBar.w52_low ? lastIdx : null,
      sweptDate: lastBar.low <= lastBar.w52_low ? lastBar.date : null,
      turtleSoup: false,
      label: `52W Low ${lastBar.w52_low.toFixed(1)}`,
    });
  }

  // 5. Draw-on-Liquidity (nearest unswept targets above and below)
  const priceNow = lastBar.close;
  const drawOnLiquidity: DrawOnLiquidityTarget[] = [];
  const unsweptAbove = levels
    .filter((l) => !l.swept && l.side === 'buyside' && l.price > priceNow)
    .sort((a, b) => a.price - b.price);
  const unsweptBelow = levels
    .filter((l) => !l.swept && l.side === 'sellside' && l.price < priceNow)
    .sort((a, b) => b.price - a.price);

  for (const t of unsweptAbove.slice(0, 3)) {
    drawOnLiquidity.push({
      side: 'buyside',
      price: t.price,
      label: t.label,
      distancePct: round2(((t.price - priceNow) / Math.max(0.1, priceNow)) * 100),
    });
  }
  for (const t of unsweptBelow.slice(0, 2)) {
    drawOnLiquidity.push({
      side: 'sellside',
      price: t.price,
      label: t.label,
      distancePct: round2(((t.price - priceNow) / Math.max(0.1, priceNow)) * 100),
    });
  }

  return { levels, drawOnLiquidity };
}
