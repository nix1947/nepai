import type {
  AnalyzerBar,
  AnalyzerConfig,
  AnalyzerDirection,
  AnalyzerSetup,
  AnalyzerStrategyFilter,
  BreakoutRetestEvent,
  CandlePatternHit,
  ChartPatternDetection,
  DisplacementCandle,
  DrawOnLiquidityTarget,
  HtfBiasSummary,
  ImbalanceZone,
  LiquidityLevel,
  OrderBlockZone,
  PremiumDiscountProfile,
  SetupChecklistItem,
  SRZone,
  StructureBreak,
  SupplyDemandZone,
  WyckoffPhaseRead,
} from '../../src/types/analyzer.ts';
import { scoreAnalyzerSetup } from './confluence.ts';
import { buildSetupTradePlan } from './tradePlan.ts';

export interface StrategyBuildContext {
  bars: AnalyzerBar[];
  strategyFilter: AnalyzerStrategyFilter;
  htfBias: HtfBiasSummary;
  trendState: 'Bullish' | 'Bearish' | 'Ranging';
  breaks: StructureBreak[];
  displacements: DisplacementCandle[];
  imbalances: ImbalanceZone[];
  orderBlocks: OrderBlockZone[];
  liquidityLevels: LiquidityLevel[];
  drawOnLiquidity: DrawOnLiquidityTarget[];
  premiumDiscount: PremiumDiscountProfile;
  candlePatterns: CandlePatternHit[];
  srZones: SRZone[];
  chartPatterns: ChartPatternDetection[];
  breakoutEvents: BreakoutRetestEvent[];
  supplyDemandZones: SupplyDemandZone[];
  wyckoff: WyckoffPhaseRead;
  avgTurnover20Npr: number;
  cfg: AnalyzerConfig;
}

export function generateStrategySetups(ctx: StrategyBuildContext): AnalyzerSetup[] {
  const { bars, cfg } = ctx;
  if (bars.length < 15) return [];

  const lastBar = bars[bars.length - 1];
  const close = lastBar.close;
  const atr = Math.max(0.5, lastBar.atr14);
  const avgVol20 =
    bars.slice(-20).reduce((s, b) => s + b.volume, 0) / Math.max(1, Math.min(20, bars.length));
  const recentVolRatio = lastBar.volume / Math.max(1, avgVol20);

  const recentBullSweep = ctx.liquidityLevels.some(
    (l) => l.side === 'sellside' && l.sweptKind === 'sweep' && l.sweptAtIndex !== null && bars.length - 1 - l.sweptAtIndex <= 15
  );
  const recentBearSweep = ctx.liquidityLevels.some(
    (l) => l.side === 'buyside' && l.sweptKind === 'sweep' && l.sweptAtIndex !== null && bars.length - 1 - l.sweptAtIndex <= 15
  );

  const recentBullMss = ctx.breaks.some(
    (b) => b.direction === 'bullish' && (b.kind === 'MSS' || b.kind === 'CHoCH') && bars.length - 1 - b.barIndex <= 18
  );
  const recentBearMss = ctx.breaks.some(
    (b) => b.direction === 'bearish' && (b.kind === 'MSS' || b.kind === 'CHoCH') && bars.length - 1 - b.barIndex <= 18
  );

  const recentBullCandle = ctx.candlePatterns.some(
    (c) => c.direction === 'bullish' && bars.length - 1 - c.barIndex <= 3
  );
  const recentBearCandle = ctx.candlePatterns.some(
    (c) => c.direction === 'bearish' && bars.length - 1 - c.barIndex <= 3
  );
  const nearSr = ctx.srZones.some(
    (z) => close >= z.bottom * 0.98 && close <= z.top * 1.02
  );
  const hasCorpGapNear = bars.slice(-8).some((b) => b.possibleCorpActionGap);
  const inDiscount = ctx.premiumDiscount.pctInRange <= 52;
  const inOteLong = close >= ctx.premiumDiscount.oteLow && close <= ctx.premiumDiscount.oteHigh;
  const inPremium = ctx.premiumDiscount.pctInRange >= 48;

  const nextBsl = ctx.drawOnLiquidity.find((d) => d.side === 'buyside')?.price ?? close + atr * 3.5;
  const nextBsl2 =
    ctx.drawOnLiquidity.filter((d) => d.side === 'buyside')[1]?.price ?? nextBsl + atr * 2.5;
  const nextSsl = ctx.drawOnLiquidity.find((d) => d.side === 'sellside')?.price ?? Math.max(1, close - atr * 3);

  const setups: AnalyzerSetup[] = [];

  const pushSetup = (opts: {
    id: string;
    strategy: Exclude<AnalyzerStrategyFilter, 'All'>;
    name: string;
    direction: AnalyzerDirection;
    entryLow: number;
    entryHigh: number;
    invalidation: number;
    target1: number;
    target2: number;
    poiFreshness: 'Fresh' | 'Unmitigated' | 'Partial' | 'Weak';
    hasSweep: boolean;
    hasDispMss: boolean;
    inFavZone: boolean;
    inOte: boolean;
    hasStruct: boolean;
    hasCandle: boolean;
    hasSr: boolean;
    checklist: SetupChecklistItem[];
    explanation: string;
    tags: string[];
  }) => {
    const plan = buildSetupTradePlan({
      direction: opts.direction,
      entryLow: opts.entryLow,
      entryHigh: opts.entryHigh,
      invalidationLevel: opts.invalidation,
      atr,
      target1Candidate: opts.target1,
      target2Candidate: opts.target2,
      cfg,
    });

    const distAtr =
      close > plan.entryHigh
        ? (close - plan.entryHigh) / atr
        : close < plan.entryLow
          ? (plan.entryLow - close) / atr
          : 0;

    const scored = scoreAnalyzerSetup({
      direction: opts.direction,
      htfBias: ctx.htfBias,
      hasLiquiditySweep: opts.hasSweep,
      hasDisplacementMss: opts.hasDispMss,
      poiFreshness: opts.poiFreshness,
      inFavorableDiscountOrPremium: opts.inFavZone,
      inOteZone: opts.inOte,
      hasAlignedStructure: opts.hasStruct,
      volumeConfirmRatio: recentVolRatio,
      hasConfirmingCandle: opts.hasCandle,
      hasSrConfluence: opts.hasSr,
      tradePlan: plan,
      avgTurnover20Npr: ctx.avgTurnover20Npr,
      lastBarCircuitLocked: lastBar.isUpperCircuit || lastBar.isLowerCircuit,
      hasCorpGapNearPoi: hasCorpGapNear,
      distanceFromEntryAtr: distAtr,
      cfg,
    });

    setups.push({
      id: opts.id,
      strategy: opts.strategy,
      name: opts.name,
      direction: opts.direction,
      isLongOnlyWarning: opts.direction === 'short_warning',
      grade: scored.grade,
      score: scored.score,
      rawScore: scored.rawScore,
      totalPenalties: scored.totalPenalties,
      scoreBreakdown: scored.breakdown,
      penalties: scored.penalties,
      checklist: opts.checklist,
      tradePlan: plan,
      explanation: opts.explanation,
      tags: opts.tags,
    });
  };

  // ---------------- ICT SETUPS ----------------
  const activeBullFvg = [...ctx.imbalances]
    .reverse()
    .find(
      (f) =>
        (f.kind === 'FVG' || f.kind === 'IFVG') &&
        f.direction === 'bullish' &&
        (f.status === 'unmitigated' || f.status === 'partial') &&
        bars.length - 1 - f.startIndex <= cfg.maxZoneAgeBars
    );

  const activeBullUnicorn = [...ctx.orderBlocks]
    .reverse()
    .find((o) => o.kind === 'Unicorn' && o.direction === 'bullish' && o.status !== 'broken');

  if (activeBullUnicorn) {
    pushSetup({
      id: `ict-unicorn-${activeBullUnicorn.id}`,
      strategy: 'ICT',
      name: 'ICT Bullish Unicorn (Breaker + FVG)',
      direction: 'long',
      entryLow: activeBullUnicorn.bottom,
      entryHigh: activeBullUnicorn.top,
      invalidation: activeBullUnicorn.bottom,
      target1: nextBsl,
      target2: nextBsl2,
      poiFreshness: activeBullUnicorn.status === 'fresh' ? 'Fresh' : 'Partial',
      hasSweep: recentBullSweep,
      hasDispMss: true,
      inFavZone: inDiscount,
      inOte: inOteLong,
      hasStruct: ctx.trendState === 'Bullish' || recentBullMss,
      hasCandle: recentBullCandle,
      hasSr: true,
      checklist: [
        { label: 'Breaker + Overlapping FVG', passed: true, weight: 30, pointsAwarded: 30, detail: activeBullUnicorn.label },
        { label: 'Sell-Side Sweep Context', passed: recentBullSweep, weight: 20, pointsAwarded: recentBullSweep ? 20 : 0, detail: recentBullSweep ? 'SSL swept prior to shift' : 'Pending clean SSL sweep' },
        { label: 'Discount / OTE Location', passed: inDiscount || inOteLong, weight: 25, pointsAwarded: inDiscount || inOteLong ? 25 : 8, detail: ctx.premiumDiscount.zoneLabel },
        { label: 'Volume Confirmation', passed: recentVolRatio >= 1.1, weight: 25, pointsAwarded: recentVolRatio >= 1.1 ? 25 : 10, detail: `${recentVolRatio.toFixed(2)}x 20d vol` },
      ],
      explanation: `A Bullish Breaker Block overlaps an active Fair Value Gap (${activeBullUnicorn.bottom.toFixed(1)}–${activeBullUnicorn.top.toFixed(1)}), forming a high-confluence Unicorn entry targeting upside liquidity at ${nextBsl.toFixed(1)}.`,
      tags: ['ICT', 'Unicorn', 'Breaker+FVG'],
    });
  }

  if (activeBullFvg) {
    pushSetup({
      id: `ict-fvg-${activeBullFvg.id}`,
      strategy: 'ICT',
      name: 'ICT Sweep + MSS + FVG Discount Entry',
      direction: 'long',
      entryLow: activeBullFvg.bottom,
      entryHigh: activeBullFvg.ce50,
      invalidation: activeBullFvg.bottom,
      target1: nextBsl,
      target2: nextBsl2,
      poiFreshness: activeBullFvg.status === 'unmitigated' ? 'Unmitigated' : 'Partial',
      hasSweep: recentBullSweep,
      hasDispMss: recentBullMss || ctx.displacements.some((d) => d.direction === 'bullish' && bars.length - 1 - d.barIndex <= 15),
      inFavZone: inDiscount,
      inOte: inOteLong,
      hasStruct: ctx.trendState === 'Bullish' || recentBullMss,
      hasCandle: recentBullCandle,
      hasSr: nearSr,
      checklist: [
        { label: 'Active Bullish FVG / IFVG', passed: true, weight: 25, pointsAwarded: 25, detail: `${activeBullFvg.label} (${activeBullFvg.mitigatedPct}% filled)` },
        { label: 'Prior SSL Liquidity Sweep', passed: recentBullSweep, weight: 25, pointsAwarded: recentBullSweep ? 25 : 5, detail: recentBullSweep ? 'Wick sweep below low detected' : 'No recent SSL sweep' },
        { label: 'MSS / Displacement Leg', passed: recentBullMss, weight: 25, pointsAwarded: recentBullMss ? 25 : 10, detail: recentBullMss ? 'Bullish CHoCH/MSS confirmed' : 'Trend BOS leg' },
        { label: 'Discount / OTE Pricing', passed: inDiscount, weight: 25, pointsAwarded: inDiscount ? 25 : 5, detail: `${ctx.premiumDiscount.pctInRange}% of range (${ctx.premiumDiscount.zoneLabel})` },
      ],
      explanation: `Bullish imbalance zone sits at ${activeBullFvg.bottom.toFixed(1)}–${activeBullFvg.top.toFixed(1)} (50% CE at ${activeBullFvg.ce50.toFixed(1)}). ${recentBullSweep ? 'Preceded by sell-side liquidity sweep.' : ''} Targets draw-on-liquidity at ${nextBsl.toFixed(1)}.`,
      tags: ['ICT', activeBullFvg.kind, ctx.premiumDiscount.zoneLabel],
    });
  }

  const bullTurtle = [...ctx.liquidityLevels]
    .reverse()
    .find((l) => l.side === 'sellside' && l.turtleSoup && l.sweptAtIndex !== null && bars.length - 1 - l.sweptAtIndex <= 6);
  if (bullTurtle) {
    pushSetup({
      id: `ict-ts-bull-${bullTurtle.id}`,
      strategy: 'ICT',
      name: 'ICT Bullish Turtle Soup Reversal',
      direction: 'long',
      entryLow: close * 0.992,
      entryHigh: close,
      invalidation: lastBar.low,
      target1: ctx.premiumDiscount.equilibrium,
      target2: nextBsl,
      poiFreshness: 'Fresh',
      hasSweep: true,
      hasDispMss: recentBullMss,
      inFavZone: inDiscount,
      inOte: inOteLong,
      hasStruct: recentBullMss,
      hasCandle: recentBullCandle,
      hasSr: nearSr,
      checklist: [
        { label: '20+ Bar SSL Swept & Reclaimed', passed: true, weight: 40, pointsAwarded: 40, detail: `Swept ${bullTurtle.label} on ${bullTurtle.sweptDate}` },
        { label: 'Deep Discount Position', passed: inDiscount, weight: 30, pointsAwarded: inDiscount ? 30 : 10, detail: `${ctx.premiumDiscount.pctInRange}% in dealing range` },
        { label: 'Bullish Reversal Bar', passed: recentBullCandle || lastBar.close > lastBar.open, weight: 30, pointsAwarded: recentBullCandle ? 30 : 15, detail: 'Closed back above swept level' },
      ],
      explanation: `False breakdown ("Turtle Soup") swept resting sell-stops below ${bullTurtle.price.toFixed(1)} and closed back above, trapping breakdown sellers.`,
      tags: ['ICT', 'Turtle Soup', 'Sweep'],
    });
  }

  if (
    ctx.premiumDiscount.weeklyPo3.weeklyOpen &&
    ctx.premiumDiscount.weeklyPo3.phase === 'Expansion' &&
    close <= ctx.premiumDiscount.weeklyPo3.weeklyOpen + atr * 1.8
  ) {
    pushSetup({
      id: 'ict-weekly-po3',
      strategy: 'ICT',
      name: 'ICT Weekly Power of 3 Expansion',
      direction: 'long',
      entryLow: ctx.premiumDiscount.weeklyPo3.weeklyOpen,
      entryHigh: close,
      invalidation: ctx.premiumDiscount.weeklyPo3.weekLow ?? lastBar.low,
      target1: nextBsl,
      target2: nextBsl2,
      poiFreshness: 'Fresh',
      hasSweep: recentBullSweep,
      hasDispMss: recentBullMss,
      inFavZone: inDiscount,
      inOte: inOteLong,
      hasStruct: ctx.trendState === 'Bullish',
      hasCandle: recentBullCandle,
      hasSr: nearSr,
      checklist: [
        { label: 'Weekly Open Judas Dip + Reclaim', passed: true, weight: 50, pointsAwarded: 50, detail: ctx.premiumDiscount.weeklyPo3.note },
        { label: 'HTF Alignment', passed: ctx.htfBias.alignmentScore0to100 >= 60, weight: 50, pointsAwarded: ctx.htfBias.alignmentScore0to100 >= 60 ? 50 : 25, detail: ctx.htfBias.alignmentLabel },
      ],
      explanation: ctx.premiumDiscount.weeklyPo3.note,
      tags: ['ICT', 'Weekly PO3'],
    });
  }

  // ---------------- SMC SETUPS ----------------
  const freshBullOb = [...ctx.orderBlocks]
    .reverse()
    .find(
      (o) =>
        (o.kind === 'OB' || o.kind === 'Propulsion' || o.kind === 'Rejection') &&
        o.direction === 'bullish' &&
        (o.status === 'fresh' || o.status === 'tested') &&
        bars.length - 1 - o.startIndex <= cfg.maxZoneAgeBars
    );

  if (freshBullOb) {
    pushSetup({
      id: `smc-ob-${freshBullOb.id}`,
      strategy: 'SMC',
      name:
        freshBullOb.linkedBreakKind === 'CHoCH' || freshBullOb.linkedBreakKind === 'MSS'
          ? 'SMC CHoCH → Fresh Order Block Entry'
          : 'SMC BOS → Internal OB Pullback',
      direction: 'long',
      entryLow: freshBullOb.bottom,
      entryHigh: freshBullOb.meanThreshold,
      invalidation: freshBullOb.bottom,
      target1: nextBsl,
      target2: nextBsl2,
      poiFreshness: freshBullOb.status === 'fresh' ? 'Fresh' : 'Partial',
      hasSweep: recentBullSweep,
      hasDispMss: recentBullMss,
      inFavZone: inDiscount,
      inOte: inOteLong,
      hasStruct: ctx.trendState === 'Bullish' || recentBullMss,
      hasCandle: recentBullCandle,
      hasSr: nearSr,
      checklist: [
        { label: 'Unbroken Bullish Order Block', passed: true, weight: 35, pointsAwarded: 35, detail: freshBullOb.label },
        { label: 'Structure Break Backing', passed: freshBullOb.linkedBreakKind !== null, weight: 30, pointsAwarded: freshBullOb.linkedBreakKind ? 30 : 15, detail: freshBullOb.linkedBreakKind ?? 'Propulsion/Rejection leg' },
        { label: 'Discount Range Alignment', passed: inDiscount, weight: 35, pointsAwarded: inDiscount ? 35 : 12, detail: ctx.premiumDiscount.zoneLabel },
      ],
      explanation: `${freshBullOb.label} formed prior to institutional ${freshBullOb.linkedBreakKind ?? 'impulse'} departure. Retest toward Mean Threshold (${freshBullOb.meanThreshold.toFixed(1)}) offers structured long entry.`,
      tags: ['SMC', freshBullOb.kind, freshBullOb.status],
    });
  }

  const bullSd = [...ctx.supplyDemandZones]
    .reverse()
    .find((z) => z.kind === 'Demand' && z.freshness !== 'Mitigated');
  if (bullSd) {
    pushSetup({
      id: `smc-sd-${bullSd.id}`,
      strategy: 'SMC',
      name: `SMC Demand Zone (${bullSd.pattern}) Pullback`,
      direction: 'long',
      entryLow: bullSd.bottom,
      entryHigh: bullSd.top,
      invalidation: bullSd.bottom,
      target1: nextBsl,
      target2: nextBsl2,
      poiFreshness: bullSd.freshness === 'Fresh' ? 'Fresh' : 'Partial',
      hasSweep: recentBullSweep,
      hasDispMss: bullSd.impulseMultiple >= 1.5,
      inFavZone: inDiscount,
      inOte: inOteLong,
      hasStruct: ctx.trendState === 'Bullish',
      hasCandle: recentBullCandle,
      hasSr: nearSr,
      checklist: [
        { label: `${bullSd.pattern} Demand Base`, passed: true, weight: 40, pointsAwarded: 40, detail: `Impulse ${bullSd.impulseMultiple.toFixed(1)}x ATR (${bullSd.freshness})` },
        { label: 'HTF Supportive Trend', passed: ctx.htfBias.alignmentScore0to100 >= 55, weight: 30, pointsAwarded: ctx.htfBias.alignmentScore0to100 >= 55 ? 30 : 10, detail: ctx.htfBias.alignmentLabel },
        { label: 'Price Inside/Near Demand', passed: close <= bullSd.top * 1.04, weight: 30, pointsAwarded: close <= bullSd.top * 1.04 ? 30 : 10, detail: `Current ${close.toFixed(1)} vs ${bullSd.top.toFixed(1)}` },
      ],
      explanation: `Institutional ${bullSd.pattern} Demand zone (${bullSd.bottom.toFixed(1)}–${bullSd.top.toFixed(1)}) launched a ${bullSd.impulseMultiple.toFixed(1)}× ATR leg-out and remains ${bullSd.freshness.toLowerCase()}.`,
      tags: ['SMC', 'Demand', bullSd.pattern],
    });
  }

  // ---------------- PRICE ACTION SETUPS ----------------
  const bullPattern = [...ctx.chartPatterns]
    .reverse()
    .find((p) => p.direction === 'bullish');
  if (bullPattern) {
    pushSetup({
      id: `pa-pat-${bullPattern.id}`,
      strategy: 'Price Action',
      name: `Price Action: ${bullPattern.name} (${bullPattern.status})`,
      direction: 'long',
      entryLow: bullPattern.necklineOrTrigger * 0.99,
      entryHigh: bullPattern.necklineOrTrigger * 1.01,
      invalidation: bullPattern.invalidationPrice,
      target1: (bullPattern.necklineOrTrigger + bullPattern.measuredTarget) / 2,
      target2: bullPattern.measuredTarget,
      poiFreshness: bullPattern.status === 'Confirmed Breakout' ? 'Fresh' : 'Partial',
      hasSweep: recentBullSweep,
      hasDispMss: bullPattern.status === 'Confirmed Breakout',
      inFavZone: true,
      inOte: false,
      hasStruct: ctx.trendState === 'Bullish',
      hasCandle: recentBullCandle,
      hasSr: true,
      checklist: [
        { label: `${bullPattern.name} Geometry`, passed: true, weight: 40, pointsAwarded: 40, detail: `Neckline ${bullPattern.necklineOrTrigger.toFixed(1)} · Target ${bullPattern.measuredTarget.toFixed(1)}` },
        { label: 'Breakout Confirmation', passed: bullPattern.status === 'Confirmed Breakout', weight: 30, pointsAwarded: bullPattern.status === 'Confirmed Breakout' ? 30 : 12, detail: bullPattern.status },
        { label: 'Volume Expansion', passed: recentVolRatio >= 1.2, weight: 30, pointsAwarded: recentVolRatio >= 1.2 ? 30 : 10, detail: `${recentVolRatio.toFixed(2)}x 20d avg vol` },
      ],
      explanation: `${bullPattern.name} structure (${bullPattern.startDate} → ${bullPattern.endDate}) with trigger near ${bullPattern.necklineOrTrigger.toFixed(1)} and measured objective ${bullPattern.measuredTarget.toFixed(1)}.`,
      tags: ['Price Action', bullPattern.name],
    });
  }

  const recentBreakoutRetest = [...ctx.breakoutEvents]
    .reverse()
    .find((e) => e.direction === 'bullish' && (e.kind === 'Breakout' || e.kind === 'Retest'));
  if (recentBreakoutRetest || (recentBullCandle && nearSr)) {
    const supportLvl = ctx.srZones.find((z) => z.mid <= close * 1.02);
    const refLevel = recentBreakoutRetest?.level ?? supportLvl?.top ?? close * 0.98;
    pushSetup({
      id: `pa-sr-${lastBar.date}`,
      strategy: 'Price Action',
      name: recentBreakoutRetest
        ? `Price Action: S/R ${recentBreakoutRetest.kind} Confluence`
        : 'Price Action: Candle Reversal at Support',
      direction: 'long',
      entryLow: refLevel * 0.995,
      entryHigh: close,
      invalidation: supportLvl ? supportLvl.bottom : lastBar.low,
      target1: nextBsl,
      target2: nextBsl2,
      poiFreshness: 'Fresh',
      hasSweep: recentBullSweep,
      hasDispMss: recentVolRatio >= 1.2,
      inFavZone: inDiscount,
      inOte: inOteLong,
      hasStruct: ctx.trendState === 'Bullish',
      hasCandle: recentBullCandle,
      hasSr: true,
      checklist: [
        { label: 'Key S/R Zone Reaction', passed: true, weight: 35, pointsAwarded: 35, detail: recentBreakoutRetest?.detail ?? `Support near ${refLevel.toFixed(1)}` },
        { label: 'Candlestick Trigger', passed: recentBullCandle, weight: 35, pointsAwarded: recentBullCandle ? 35 : 12, detail: recentBullCandle ? 'Pin bar / Engulfing / Star confirmed' : 'Await reversal close' },
        { label: 'Volume Confirmation', passed: recentVolRatio >= 1.1, weight: 30, pointsAwarded: recentVolRatio >= 1.1 ? 30 : 12, detail: `${recentVolRatio.toFixed(2)}x 20d vol` },
      ],
      explanation: `Price reacting constructively around key structural S/R (${refLevel.toFixed(1)})${recentBullCandle ? ' with bullish candle confirmation' : ''}.`,
      tags: ['Price Action', recentBreakoutRetest?.kind ?? 'S/R Bounce'],
    });
  }

  // ---------------- WYCKOFF (EXPERIMENTAL) ----------------
  if (ctx.wyckoff.bias === 'Accumulation') {
    const springEv = ctx.wyckoff.events.find((e) => e.event === 'Spring' || e.event === 'SOS');
    pushSetup({
      id: `wyckoff-acc-${lastBar.date}`,
      strategy: 'Wyckoff',
      name: `Wyckoff (Exp.): ${ctx.wyckoff.regimePhase}`,
      direction: 'long',
      entryLow: close * 0.985,
      entryHigh: close,
      invalidation: springEv ? springEv.price : lastBar.low,
      target1: nextBsl,
      target2: nextBsl2,
      poiFreshness: 'Fresh',
      hasSweep: ctx.wyckoff.events.some((e) => e.event === 'Spring'),
      hasDispMss: ctx.wyckoff.events.some((e) => e.event === 'SOS'),
      inFavZone: inDiscount,
      inOte: inOteLong,
      hasStruct: ctx.trendState !== 'Bearish',
      hasCandle: recentBullCandle,
      hasSr: nearSr,
      checklist: [
        { label: 'Experimental Wyckoff Phase', passed: true, weight: 50, pointsAwarded: 50, detail: ctx.wyckoff.summary },
        { label: 'Accumulation Volume Footprint', passed: recentVolRatio >= 1.0, weight: 50, pointsAwarded: recentVolRatio >= 1.0 ? 50 : 25, detail: `${ctx.wyckoff.events.map((e) => e.event).join(' → ')}` },
      ],
      explanation: ctx.wyckoff.summary,
      tags: ['Wyckoff (Exp.)', ctx.wyckoff.bias],
    });
  }

  // ---------------- BEARISH SETUPS -> NEPSE LONG-ONLY EXIT / TAKE-PROFIT WARNINGS ----------------
  const activeBearFvg = [...ctx.imbalances]
    .reverse()
    .find((f) => (f.kind === 'FVG' || f.kind === 'IFVG') && f.direction === 'bearish' && f.status !== 'filled' && f.status !== 'inverted');
  const activeBearOb = [...ctx.orderBlocks]
    .reverse()
    .find((o) => o.direction === 'bearish' && o.status !== 'broken');

  if (recentBearSweep || recentBearMss || (activeBearOb && inPremium) || ctx.wyckoff.bias === 'Distribution') {
    const resLvl = activeBearOb?.top ?? activeBearFvg?.top ?? lastBar.high;
    pushSetup({
      id: `exit-warning-${lastBar.date}`,
      strategy: recentBearMss || activeBearFvg ? 'ICT' : 'SMC',
      name: recentBearSweep
        ? 'Exit Warning: BSL Sweep + Bearish Supply Rejection'
        : 'Exit Warning: Bearish Order Block / Distribution',
      direction: 'short_warning',
      entryLow: activeBearOb?.bottom ?? activeBearFvg?.bottom ?? close,
      entryHigh: resLvl,
      invalidation: resLvl,
      target1: nextSsl,
      target2: Math.max(1, nextSsl - atr * 2),
      poiFreshness: 'Fresh',
      hasSweep: recentBearSweep,
      hasDispMss: recentBearMss,
      inFavZone: inPremium,
      inOte: false,
      hasStruct: ctx.trendState === 'Bearish' || recentBearMss,
      hasCandle: recentBearCandle,
      hasSr: nearSr,
      checklist: [
        { label: 'NEPSE Long-Only Note', passed: true, weight: 40, pointsAwarded: 40, detail: 'Retail cannot short NEPSE; use as take-profit / tighten-stop signal.' },
        { label: 'Overhead Supply / BSL Sweep', passed: recentBearSweep || Boolean(activeBearOb), weight: 30, pointsAwarded: 30, detail: `Supply ceiling ~${resLvl.toFixed(1)}` },
        { label: 'Bearish Structure Shift', passed: recentBearMss, weight: 30, pointsAwarded: recentBearMss ? 30 : 12, detail: recentBearMss ? 'Bearish MSS/CHoCH active' : 'Premium distribution caution' },
      ],
      explanation: `NEPSE Long-Only Warning: Overhead supply (${resLvl.toFixed(1)}) with ${recentBearSweep ? 'recent buy-side sweep' : 'bearish reaction'}. Consider trailing stops or taking partial profits on existing longs toward ${nextSsl.toFixed(1)}.`,
      tags: ['Long-Only Exit Warning', 'Bearish Confluence'],
    });
  }

  const filtered =
    ctx.strategyFilter === 'All'
      ? setups
      : setups.filter((s) => s.strategy === ctx.strategyFilter);

  return filtered.sort((a, b) => {
    // Rank actionable long setups ahead of long-only exit warnings unless both have same tier
    if (a.isLongOnlyWarning !== b.isLongOnlyWarning) {
      return a.isLongOnlyWarning ? 1 : -1;
    }
    return b.score - a.score;
  });
}
