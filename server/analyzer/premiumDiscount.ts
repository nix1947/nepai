import type { PriceRow } from '../../src/types/market.ts';
import type {
  AnalyzerBar,
  PremiumDiscountProfile,
  SwingPoint,
  WeeklyPo3State,
} from '../../src/types/analyzer.ts';
import { aggregateOhlcv, round2 } from './config.ts';

function computeWeeklyPowerOf3(dailyRows: PriceRow[]): WeeklyPo3State {
  const weekly = aggregateOhlcv(dailyRows, '1W');
  const currW = weekly[weekly.length - 1];
  if (!currW) {
    return {
      weeklyOpen: null,
      weekHigh: null,
      weekLow: null,
      phase: 'Accumulation',
      note: 'Insufficient weekly data for Power of 3 phase.',
    };
  }

  const wo = currW.open;
  const wh = currW.high;
  const wl = currW.low;
  const wc = currW.close;

  if (wc >= wo && wl < wo * 0.992) {
    return {
      weeklyOpen: round2(wo),
      weekHigh: round2(wh),
      weekLow: round2(wl),
      phase: 'Expansion',
      note: `Price dipped below Weekly Open (${wo.toFixed(1)} -> low ${wl.toFixed(1)}, Judas swing) before expanding upward to ${wc.toFixed(1)}.`,
    };
  }
  if (wc < wo && wh > wo * 1.008) {
    return {
      weeklyOpen: round2(wo),
      weekHigh: round2(wh),
      weekLow: round2(wl),
      phase: 'Distribution',
      note: `Price spiked above Weekly Open (${wo.toFixed(1)} -> high ${wh.toFixed(1)}) before reversing lower to ${wc.toFixed(1)}.`,
    };
  }
  if (wc < wo) {
    return {
      weeklyOpen: round2(wo),
      weekHigh: round2(wh),
      weekLow: round2(wl),
      phase: 'Manipulation (Judas Swing)',
      note: `Trading below Weekly Open (${wo.toFixed(1)}); watch for reversal reclaim above open for bullish weekly PO3 expansion.`,
    };
  }
  return {
    weeklyOpen: round2(wo),
    weekHigh: round2(wh),
    weekLow: round2(wl),
    phase: 'Accumulation',
    note: `Holding near/above Weekly Open (${wo.toFixed(1)}) in early weekly range construction.`,
  };
}

export function analyzePremiumDiscount(
  bars: AnalyzerBar[],
  dailyRowsUpToAsOf: PriceRow[],
  swings: SwingPoint[],
  trendState: 'Bullish' | 'Bearish' | 'Ranging'
): PremiumDiscountProfile {
  const lookback = Math.min(bars.length, 40);
  const windowBars = bars.slice(-Math.max(5, lookback));

  // Use confirmed external swings if available, else dealing range over last 40 bars
  const extHighs = swings.filter((s) => s.tier === 'external' && s.kind === 'high');
  const extLows = swings.filter((s) => s.tier === 'external' && s.kind === 'low');

  const highFromBars = Math.max(...windowBars.map((b) => b.high));
  const lowFromBars = Math.min(...windowBars.map((b) => b.low));

  const lastExtHigh = extHighs[extHighs.length - 1]?.price;
  const lastExtLow = extLows[extLows.length - 1]?.price;

  const rangeHigh = round2(
    lastExtHigh && lastExtHigh >= lowFromBars ? Math.max(lastExtHigh, highFromBars * 0.95) : highFromBars
  );
  const rangeLow = round2(
    lastExtLow && lastExtLow <= rangeHigh * 0.99 ? Math.min(lastExtLow, lowFromBars * 1.05) : lowFromBars
  );

  const safeHigh = Math.max(rangeHigh, rangeLow + 1);
  const span = safeHigh - rangeLow;
  const equilibrium = round2(rangeLow + span * 0.5);

  // For bullish dealing range OTE = 62%–79% pullback from High down toward Low
  const oteLow = round2(safeHigh - span * 0.79);
  const oteHigh = round2(safeHigh - span * 0.62);

  const close = bars[bars.length - 1]?.close ?? equilibrium;
  const pctInRange = round2(Math.max(0, Math.min(100, ((close - rangeLow) / span) * 100)));

  let zoneLabel: PremiumDiscountProfile['zoneLabel'] = 'Equilibrium';
  if (pctInRange <= 21) zoneLabel = 'Deep Discount';
  else if (pctInRange <= 38) zoneLabel = 'Discount (OTE)';
  else if (pctInRange < 47) zoneLabel = 'Discount';
  else if (pctInRange <= 53) zoneLabel = 'Equilibrium';
  else if (pctInRange < 62) zoneLabel = 'Premium';
  else if (pctInRange <= 79) zoneLabel = 'Premium (OTE)';
  else zoneLabel = 'Deep Premium';

  const retraceRatios = [0.236, 0.382, 0.5, 0.618, 0.705, 0.786];
  const fibRetracements = retraceRatios.map((r) => ({
    ratio: r,
    label: `${(r * 100).toFixed(1)}%`,
    price: round2(
      trendState === 'Bearish' ? rangeLow + span * r : safeHigh - span * r
    ),
  }));

  const extRatios = [1.272, 1.618, 2.0];
  const fibExtensions = extRatios.map((r) => ({
    ratio: r,
    label: `${r.toFixed(3)}x`,
    price: round2(
      trendState === 'Bearish' ? safeHigh - span * r : rangeLow + span * r
    ),
  }));

  return {
    rangeLookbackBars: windowBars.length,
    rangeHigh: round2(safeHigh),
    rangeLow: round2(rangeLow),
    equilibrium,
    oteHigh,
    oteLow,
    pctInRange,
    zoneLabel,
    fibRetracements,
    fibExtensions,
    weeklyPo3: computeWeeklyPowerOf3(dailyRowsUpToAsOf),
  };
}
