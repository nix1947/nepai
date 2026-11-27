import type {
  AnalyzerConfig,
  AnalyzerDirection,
  AnalyzerTradePlan,
} from '../../src/types/analyzer.ts';
import { round2, roundToNepseTick } from './config.ts';

export function buildSetupTradePlan(params: {
  direction: AnalyzerDirection;
  entryLow: number;
  entryHigh: number;
  invalidationLevel: number;
  atr: number;
  target1Candidate: number;
  target2Candidate: number;
  cfg: AnalyzerConfig;
}): AnalyzerTradePlan {
  const {
    direction,
    entryLow,
    entryHigh,
    invalidationLevel,
    atr,
    target1Candidate,
    target2Candidate,
    cfg,
  } = params;

  const safeAtr = Math.max(0.5, atr);
  const atrBuffer = roundToNepseTick(safeAtr * cfg.stopAtrBuffer);
  const eLow = roundToNepseTick(Math.min(entryLow, entryHigh));
  const eHigh = roundToNepseTick(Math.max(entryLow, entryHigh));
  const eMid = roundToNepseTick((eLow + eHigh) / 2);

  if (direction === 'long') {
    const rawInv = Math.min(invalidationLevel, eLow - safeAtr * 0.4);
    const stopLoss = roundToNepseTick(Math.max(0.1, rawInv - atrBuffer));
    const risk = Math.max(0.2, eMid - stopLoss);

    const minT1 = roundToNepseTick(eMid + risk * Math.max(1.0, cfg.minRR * 0.75));
    const minT2 = roundToNepseTick(eMid + risk * cfg.minRR);

    const target1 = roundToNepseTick(Math.max(target1Candidate, minT1));
    const target2 = roundToNepseTick(Math.max(target2Candidate, target1 + risk * 0.5, minT2));

    const rrT1 = round2((target1 - eMid) / risk);
    const rrT2 = round2((target2 - eMid) / risk);

    const valid = rrT2 >= cfg.minRR && stopLoss < eMid && target1 > eMid;
    return {
      valid,
      rejectionReason: valid
        ? null
        : `Reward-to-Risk 1:${rrT2.toFixed(2)} is below minimum threshold 1:${cfg.minRR.toFixed(1)}.`,
      entryLow: eLow,
      entryHigh: eHigh,
      entryMid: eMid,
      stopLoss,
      invalidationLevel: roundToNepseTick(rawInv),
      atrBufferUsed: atrBuffer,
      target1,
      target2,
      rrT1,
      rrT2,
      tickSizeNpr: 0.1,
    };
  }

  // Bearish informational / exit-warning plan (stop sits invalidation + 0.25 ATR above)
  const rawInv = Math.max(invalidationLevel, eHigh + safeAtr * 0.4);
  const stopLoss = roundToNepseTick(rawInv + atrBuffer);
  const risk = Math.max(0.2, stopLoss - eMid);
  const target1 = roundToNepseTick(Math.max(1, Math.min(target1Candidate, eMid - risk * 1.1)));
  const target2 = roundToNepseTick(Math.max(1, Math.min(target2Candidate, target1 - risk * 0.6)));
  const rrT1 = round2((eMid - target1) / risk);
  const rrT2 = round2((eMid - target2) / risk);
  const valid = rrT2 >= cfg.minRR;

  return {
    valid,
    rejectionReason: valid
      ? null
      : `Downside target RR 1:${rrT2.toFixed(2)} is below 1:${cfg.minRR.toFixed(1)}.`,
    entryLow: eLow,
    entryHigh: eHigh,
    entryMid: eMid,
    stopLoss,
    invalidationLevel: roundToNepseTick(rawInv),
    atrBufferUsed: atrBuffer,
    target1,
    target2,
    rrT1,
    rrT2,
    tickSizeNpr: 0.1,
  };
}
