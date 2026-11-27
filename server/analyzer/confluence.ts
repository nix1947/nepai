import type {
  AnalyzerConfig,
  AnalyzerDirection,
  AnalyzerGrade,
  AnalyzerTradePlan,
  HtfBiasSummary,
  ScoreComponentDetail,
  ScorePenaltyDetail,
} from '../../src/types/analyzer.ts';
import { round2 } from './config.ts';

export interface ScoringInputs {
  direction: AnalyzerDirection;
  htfBias: HtfBiasSummary;
  hasLiquiditySweep: boolean;
  hasDisplacementMss: boolean;
  poiFreshness: 'Fresh' | 'Unmitigated' | 'Partial' | 'Weak';
  inFavorableDiscountOrPremium: boolean;
  inOteZone: boolean;
  hasAlignedStructure: boolean;
  volumeConfirmRatio: number; // latest / 20d avg
  hasConfirmingCandle: boolean;
  hasSrConfluence: boolean;
  tradePlan: AnalyzerTradePlan;
  avgTurnover20Npr: number;
  lastBarCircuitLocked: boolean;
  hasCorpGapNearPoi: boolean;
  distanceFromEntryAtr?: number;
  cfg: AnalyzerConfig;
}

export function scoreAnalyzerSetup(input: ScoringInputs): {
  score: number;
  rawScore: number;
  totalPenalties: number;
  grade: AnalyzerGrade;
  breakdown: ScoreComponentDetail[];
  penalties: ScorePenaltyDetail[];
} {
  const w = input.cfg.scoringWeights;
  const isLong = input.direction === 'long';

  const htfAlignedPts = isLong
    ? input.htfBias.alignmentLabel === 'Full Bullish Alignment'
      ? w.htfAlignment
      : input.htfBias.alignmentLabel === 'HTF Bullish / LTF Pullback'
        ? Math.round(w.htfAlignment * 0.75)
        : input.htfBias.alignmentLabel === 'Mixed / Transitional'
          ? Math.round(w.htfAlignment * 0.35)
          : 0
    : input.htfBias.alignmentLabel === 'Bearish Alignment'
      ? w.htfAlignment
      : Math.round(w.htfAlignment * 0.4);

  const sweepPts = input.hasLiquiditySweep ? w.sweep : 0;
  const dispPts = input.hasDisplacementMss ? w.displacementMss : 0;
  const poiPts =
    input.poiFreshness === 'Fresh' || input.poiFreshness === 'Unmitigated'
      ? w.poiQuality
      : input.poiFreshness === 'Partial'
        ? Math.round(w.poiQuality * 0.6)
        : 2;

  const pdPts = input.inOteZone
    ? w.premiumDiscount
    : input.inFavorableDiscountOrPremium
      ? Math.round(w.premiumDiscount * 0.75)
      : 0;

  const structPts = input.hasAlignedStructure ? w.structure : 0;
  const volPts =
    input.volumeConfirmRatio >= 1.5
      ? w.volume
      : input.volumeConfirmRatio >= 1.05
        ? Math.round(w.volume * 0.65)
        : 0;
  const candlePts = input.hasConfirmingCandle ? w.candlePattern : 0;
  const srPts = input.hasSrConfluence ? w.srConfluence : 0;
  const rrPts =
    input.tradePlan.rrT2 >= 2.5
      ? w.rrRoom
      : input.tradePlan.rrT2 >= input.cfg.minRR
        ? Math.round(w.rrRoom * 0.7)
        : 0;
  const liqPts =
    input.avgTurnover20Npr >= input.cfg.minDailyTurnoverNpr * 3
      ? w.liquidity
      : input.avgTurnover20Npr >= input.cfg.minDailyTurnoverNpr
        ? Math.round(w.liquidity * 0.75)
        : 0;

  const breakdown: ScoreComponentDetail[] = [
    {
      key: 'htfAlignment',
      label: 'M/W/D HTF Alignment',
      maxPoints: w.htfAlignment,
      pointsAwarded: htfAlignedPts,
      detail: input.htfBias.alignmentLabel,
    },
    {
      key: 'sweep',
      label: 'Liquidity Sweep / Grab',
      maxPoints: w.sweep,
      pointsAwarded: sweepPts,
      detail: input.hasLiquiditySweep ? 'Recent BSL/SSL sweep confirmed' : 'No clear stop-run preceding POI',
    },
    {
      key: 'displacementMss',
      label: 'Displacement & MSS',
      maxPoints: w.displacementMss,
      pointsAwarded: dispPts,
      detail: input.hasDisplacementMss ? 'Energetic displacement + structure shift' : 'Moderate follow-through',
    },
    {
      key: 'poiQuality',
      label: 'POI Freshness & Confluence',
      maxPoints: w.poiQuality,
      pointsAwarded: poiPts,
      detail: `Zone state: ${input.poiFreshness}`,
    },
    {
      key: 'premiumDiscount',
      label: 'Premium / Discount & OTE',
      maxPoints: w.premiumDiscount,
      pointsAwarded: pdPts,
      detail: input.inOteZone
        ? 'Inside 0.62–0.79 OTE pocket'
        : input.inFavorableDiscountOrPremium
          ? 'Favorable dealing range half'
          : 'Unfavorable range location',
    },
    {
      key: 'structure',
      label: 'Market Structure State',
      maxPoints: w.structure,
      pointsAwarded: structPts,
      detail: input.hasAlignedStructure ? 'Aligned BOS / HH-HL sequence' : 'Counter-structure',
    },
    {
      key: 'volume',
      label: 'Volume / VSA Backing',
      maxPoints: w.volume,
      pointsAwarded: volPts,
      detail: `Recent vol ${round2(input.volumeConfirmRatio)}x 20d avg`,
    },
    {
      key: 'candlePattern',
      label: 'Trigger Candle Confirmation',
      maxPoints: w.candlePattern,
      pointsAwarded: candlePts,
      detail: input.hasConfirmingCandle ? 'Pin/Engulfing/Star at POI' : 'Pending candle trigger',
    },
    {
      key: 'srConfluence',
      label: 'S/R & Pattern Confluence',
      maxPoints: w.srConfluence,
      pointsAwarded: srPts,
      detail: input.hasSrConfluence ? 'Overlaps multi-touch S/R or pattern level' : 'Standalone zone',
    },
    {
      key: 'rrRoom',
      label: 'Draw-on-Liquidity R:R Room',
      maxPoints: w.rrRoom,
      pointsAwarded: rrPts,
      detail: `Target 2 net R:R 1:${input.tradePlan.rrT2.toFixed(2)}`,
    },
    {
      key: 'liquidity',
      label: 'Stock Liquidity',
      maxPoints: w.liquidity,
      pointsAwarded: liqPts,
      detail: `20d avg turnover Rs ${(input.avgTurnover20Npr / 1e5).toFixed(1)}L`,
    },
  ];

  const rawScore = breakdown.reduce((s, b) => s + b.pointsAwarded, 0);

  const penalties: ScorePenaltyDetail[] = [];
  if (input.lastBarCircuitLocked) {
    penalties.push({
      label: 'NEPSE ±10% Circuit Lock',
      pointsDeducted: 12,
      reason: 'Latest candle closed locked at ±10% circuit band — execution slippage/fill risk.',
    });
  }
  if (!input.tradePlan.valid) {
    penalties.push({
      label: `R:R Below ${input.cfg.minRR}:1`,
      pointsDeducted: 18,
      reason: input.tradePlan.rejectionReason || 'Insufficient reward-to-risk headroom.',
    });
  }
  if (input.avgTurnover20Npr < input.cfg.minDailyTurnoverNpr) {
    penalties.push({
      label: 'Thin Daily Liquidity',
      pointsDeducted: 15,
      reason: `20d avg turnover below Rs ${(input.cfg.minDailyTurnoverNpr / 1e5).toFixed(0)}L floor.`,
    });
  }
  if (input.hasCorpGapNearPoi) {
    penalties.push({
      label: 'Adjacent Corp-Action Gap',
      pointsDeducted: 10,
      reason: 'Possible bonus/right price adjustment near recent bars — verify NEPSE book-close date.',
    });
  }
  if (isLong && input.htfBias.alignmentLabel === 'Bearish Alignment') {
    penalties.push({
      label: 'Counter-Trend HTF Headwind',
      pointsDeducted: 10,
      reason: 'Monthly and Weekly structure remain bearish.',
    });
  }
  if (typeof input.distanceFromEntryAtr === 'number' && input.distanceFromEntryAtr > 2.2) {
    penalties.push({
      label: 'Extended Above POI Entry',
      pointsDeducted: 14,
      reason: `Close sits ${input.distanceFromEntryAtr.toFixed(1)}x ATR away from optimal entry zone — wait for pullback.`,
    });
  }

  const totalPenalties = penalties.reduce((s, p) => s + p.pointsDeducted, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore - totalPenalties)));
  const grade: AnalyzerGrade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';

  return { score, rawScore, totalPenalties, grade, breakdown, penalties };
}
