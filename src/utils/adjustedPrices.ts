import type { CorporateActionRecord } from '../types/fundamental';
import type { PriceRow } from '../types/market';

export interface AppliedPriceAdjustment {
  id: string;
  effectiveDate: string;
  actionType: CorporateActionRecord['actionType'];
  headline: string;
  factor: number; // multiplier applied to dates strictly before effectiveDate
  label: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Computes NEPSE back-adjustment multiplier for a bonus/right issue.
 * - Bonus X%: Pre-adjustment price scaled by 1 / (1 + X / 100).
 * - Right share R% (par Rs 100) approximated conservatively for continuous charting
 *   when closing price at book closure is available: (P_pre + 100*(R/100)) / (P_pre * (1 + R/100)).
 */
export function computeActionAdjustmentFactor(
  action: CorporateActionRecord,
  prePrice: number | null
): { factor: number; label: string } | null {
  const bonusPct = action.bonusPct && action.bonusPct > 0 ? action.bonusPct : 0;
  const rightPct = action.rightRatioPct && action.rightRatioPct > 0 ? action.rightRatioPct : 0;

  if (bonusPct <= 0 && rightPct <= 0) return null;

  let factor = 1;
  const parts: string[] = [];

  if (bonusPct > 0) {
    factor *= 1 / (1 + bonusPct / 100);
    parts.push(`${bonusPct}% Bonus`);
  }

  if (rightPct > 0) {
    const r = rightPct / 100;
    if (prePrice && prePrice > 100) {
      factor *= (prePrice + 100 * r) / (prePrice * (1 + r));
    } else {
      factor *= 1 / (1 + r * 0.5);
    }
    parts.push(`${rightPct}% Right`);
  }

  if (!(factor > 0 && factor < 0.9999)) return null;

  return {
    factor,
    label: parts.join(' + '),
  };
}

/**
 * Applies cumulative corporate action back-adjustments to chronological OHLC price bars
 * strictly prior to each action's exDate or bookClosureDate so historical trends stay continuous.
 */
export function applyCorporateActionAdjustments(
  history: PriceRow[],
  actions: CorporateActionRecord[]
): {
  adjustedHistory: PriceRow[];
  applied: AppliedPriceAdjustment[];
} {
  if (history.length === 0 || actions.length === 0) {
    return { adjustedHistory: history, applied: [] };
  }

  const firstDate = history[0].date;
  const lastDate = history[history.length - 1].date;

  const events: Array<{
    action: CorporateActionRecord;
    effectiveDate: string;
    factor: number;
    label: string;
  }> = [];

  for (const act of actions) {
    const effectiveDate = act.exDate || act.bookClosureDate;
    if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) continue;
    if (effectiveDate <= firstDate || effectiveDate > lastDate) continue;

    // Look up last closing price before effectiveDate
    let preClose: number | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].date < effectiveDate && history[i].close > 0) {
        preClose = history[i].close;
        break;
      }
    }

    const adj = computeActionAdjustmentFactor(act, preClose);
    if (!adj) continue;

    events.push({
      action: act,
      effectiveDate,
      factor: adj.factor,
      label: adj.label,
    });
  }

  if (events.length === 0) {
    return { adjustedHistory: history, applied: [] };
  }

  events.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  const adjustedHistory = history.map((row) => {
    let mult = 1;
    for (const ev of events) {
      if (row.date < ev.effectiveDate) {
        mult *= ev.factor;
      }
    }
    if (mult >= 0.9999) return row;

    return {
      ...row,
      open: round2(row.open * mult),
      high: round2(row.high * mult),
      low: round2(row.low * mult),
      close: round2(row.close * mult),
      ltp: round2(row.ltp * mult),
      prev_close: round2(row.prev_close * mult),
      vwap: row.vwap !== null ? round2(row.vwap * mult) : null,
      d120: row.d120 !== null ? round2(row.d120 * mult) : null,
      d180: row.d180 !== null ? round2(row.d180 * mult) : null,
      w52_high: row.w52_high !== null ? round2(row.w52_high * mult) : null,
      w52_low: row.w52_low !== null ? round2(row.w52_low * mult) : null,
      diff: round2(row.diff * mult),
      price_range: row.price_range !== null ? round2(row.price_range * mult) : null,
    };
  });

  return {
    adjustedHistory,
    applied: events.map((ev) => ({
      id: ev.action.id,
      effectiveDate: ev.effectiveDate,
      actionType: ev.action.actionType,
      headline: ev.action.headline,
      factor: Number(ev.factor.toFixed(4)),
      label: ev.label,
    })),
  };
}
