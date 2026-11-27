import type { PriceRow } from '../../src/types/market.ts';
import type { AnalyzerBar, AnalyzerConfig, AnalyzerTimeframe } from '../../src/types/analyzer.ts';

export const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
  swingLeft: 3,
  swingRight: 3,
  externalSwingLeft: 6,
  externalSwingRight: 6,
  atrPeriod: 14,
  fvgMinAtr: 0.15,
  displacementBodyAtr: 1.25,
  displacementBodyRatio: 0.58,
  eqTolerancePct: 0.65,
  srTolerancePct: 1.5,
  minRR: 1.5,
  stopAtrBuffer: 0.25,
  maxZoneAgeBars: 90,
  minDailyTurnoverNpr: 1_500_000,
  scoringWeights: {
    htfAlignment: 14,
    sweep: 12,
    displacementMss: 14,
    poiQuality: 12,
    premiumDiscount: 10,
    structure: 10,
    volume: 8,
    candlePattern: 6,
    srConfluence: 6,
    rrRoom: 4,
    liquidity: 4,
  },
};

export function roundToNepseTick(price: number): number {
  if (!Number.isFinite(price)) return 0;
  return Math.max(0.1, Math.round(price * 10) / 10);
}

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function mergeAnalyzerConfig(partial?: Partial<AnalyzerConfig>): AnalyzerConfig {
  if (!partial) return DEFAULT_ANALYZER_CONFIG;
  const clamp = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  return {
    swingLeft: Math.round(clamp(partial.swingLeft, 2, 10, DEFAULT_ANALYZER_CONFIG.swingLeft)),
    swingRight: Math.round(clamp(partial.swingRight, 2, 10, DEFAULT_ANALYZER_CONFIG.swingRight)),
    externalSwingLeft: Math.round(
      clamp(partial.externalSwingLeft, 4, 18, DEFAULT_ANALYZER_CONFIG.externalSwingLeft)
    ),
    externalSwingRight: Math.round(
      clamp(partial.externalSwingRight, 4, 18, DEFAULT_ANALYZER_CONFIG.externalSwingRight)
    ),
    atrPeriod: Math.round(clamp(partial.atrPeriod, 5, 30, DEFAULT_ANALYZER_CONFIG.atrPeriod)),
    fvgMinAtr: clamp(partial.fvgMinAtr, 0.02, 1.0, DEFAULT_ANALYZER_CONFIG.fvgMinAtr),
    displacementBodyAtr: clamp(
      partial.displacementBodyAtr,
      0.8,
      2.5,
      DEFAULT_ANALYZER_CONFIG.displacementBodyAtr
    ),
    displacementBodyRatio: clamp(
      partial.displacementBodyRatio,
      0.4,
      0.9,
      DEFAULT_ANALYZER_CONFIG.displacementBodyRatio
    ),
    eqTolerancePct: clamp(partial.eqTolerancePct, 0.2, 2.5, DEFAULT_ANALYZER_CONFIG.eqTolerancePct),
    srTolerancePct: clamp(partial.srTolerancePct, 0.4, 4.0, DEFAULT_ANALYZER_CONFIG.srTolerancePct),
    minRR: clamp(partial.minRR, 1.0, 5.0, DEFAULT_ANALYZER_CONFIG.minRR),
    stopAtrBuffer: clamp(partial.stopAtrBuffer, 0.05, 1.0, DEFAULT_ANALYZER_CONFIG.stopAtrBuffer),
    maxZoneAgeBars: Math.round(
      clamp(partial.maxZoneAgeBars, 20, 250, DEFAULT_ANALYZER_CONFIG.maxZoneAgeBars)
    ),
    minDailyTurnoverNpr: clamp(
      partial.minDailyTurnoverNpr,
      100_000,
      100_000_000,
      DEFAULT_ANALYZER_CONFIG.minDailyTurnoverNpr
    ),
    scoringWeights: {
      ...DEFAULT_ANALYZER_CONFIG.scoringWeights,
      ...(partial.scoringWeights ?? {}),
    },
  };
}

function getWeekMondayKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

export function aggregateOhlcv(rows: PriceRow[], tf: AnalyzerTimeframe): PriceRow[] {
  const clean = rows
    .filter((r) => r.close > 0 && r.open > 0 && r.high > 0 && r.low > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (tf === '1D' || clean.length === 0) return clean;

  const grouped = new Map<string, PriceRow[]>();
  for (const r of clean) {
    const key = tf === '1W' ? getWeekMondayKey(r.date) : r.date.slice(0, 7);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(r);
    else grouped.set(key, [r]);
  }

  const out: PriceRow[] = [];
  for (const bucket of grouped.values()) {
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    const high = Math.max(...bucket.map((b) => b.high));
    const low = Math.min(...bucket.map((b) => b.low));
    const volume = bucket.reduce((s, b) => s + (b.volume || 0), 0);
    const turnover = bucket.reduce((s, b) => s + (b.turnover || 0), 0);
    const trans = bucket.reduce((s, b) => s + (b.trans || 0), 0);
    const prevClose = first.prev_close;
    const diff = prevClose && prevClose > 0 ? round2(last.close - prevClose) : round2(last.close - first.open);
    const diffPct =
      prevClose && prevClose > 0
        ? round2(((last.close - prevClose) / prevClose) * 100)
        : first.open > 0
          ? round2(((last.close - first.open) / first.open) * 100)
          : null;

    out.push({
      ...last,
      date: last.date,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      turnover,
      trans,
      vwap: volume > 0 && turnover > 0 ? round2(turnover / volume) : last.vwap,
      diff,
      diff_pct: diffPct,
      price_range: round2(high - low),
      range_pct: low > 0 ? round2(((high - low) / low) * 100) : null,
      prev_close: prevClose,
    });
  }
  return out;
}

export function buildAnalyzerBars(
  dailyRows: PriceRow[],
  tf: AnalyzerTimeframe,
  atrPeriod = 14
): AnalyzerBar[] {
  const agg = aggregateOhlcv(dailyRows, tf);
  if (agg.length === 0) return [];

  // Flag probable bonus / rights / corporate-action adjustment gaps ONLY on 1D overnight discontinuities
  // where jump exceeds 11% (above NEPSE ±10% daily price circuit limit!).
  const corpGapFlags = new Map<string, string>();
  const sortedDaily = [...dailyRows]
    .filter((r) => r.close > 0 && r.open > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 1; i < sortedDaily.length; i++) {
    const prev = sortedDaily[i - 1];
    const curr = sortedDaily[i];
    const overnightPct = ((curr.close - prev.close) / Math.max(0.1, prev.close)) * 100;
    const openGapPct = ((curr.open - prev.close) / Math.max(0.1, prev.close)) * 100;
    // NEPSE enforces ±10% single-session price band; any >10.8% discontinuity is exchange adjustment (bonus/right/dividend)
    if (Math.abs(openGapPct) >= 10.8 || Math.abs(overnightPct) >= 11.2) {
      corpGapFlags.set(
        curr.date,
        `Overnight ${openGapPct.toFixed(1)}% dislocation exceeds NEPSE ±10% circuit limit — likely bonus/right price adjustment.`
      );
    }
  }

  // Compute causal True Range & Wilder ATR
  const tr: number[] = [];
  for (let i = 0; i < agg.length; i++) {
    const b = agg[i];
    if (i === 0) {
      tr.push(Math.max(0.1, b.high - b.low));
    } else {
      const prevClose = agg[i - 1].close;
      // If corporate-action adjusted gap occurred, cap TR contribution at current candle range so ATR isn't distorted
      if (corpGapFlags.has(b.date)) {
        tr.push(Math.max(0.1, b.high - b.low));
      } else {
        tr.push(
          Math.max(
            0.1,
            b.high - b.low,
            Math.abs(b.high - prevClose),
            Math.abs(b.low - prevClose)
          )
        );
      }
    }
  }

  const atr: number[] = new Array(agg.length).fill(0);
  let sum = 0;
  for (let i = 0; i < agg.length; i++) {
    if (i < atrPeriod) {
      sum += tr[i];
      atr[i] = sum / (i + 1);
    } else if (i === atrPeriod) {
      sum += tr[i] - tr[0];
      atr[i] = sum / atrPeriod;
    } else {
      atr[i] = (atr[i - 1] * (atrPeriod - 1) + tr[i]) / atrPeriod;
    }
  }

  return agg.map((r, idx) => {
    const chgPct = r.diff_pct ?? 0;
    const isUpperCircuit =
      tf === '1D' && chgPct >= 9.6 && Math.abs(r.high - r.close) <= Math.max(0.2, r.close * 0.002);
    const isLowerCircuit =
      tf === '1D' && chgPct <= -9.6 && Math.abs(r.low - r.close) <= Math.max(0.2, r.close * 0.002);
    const corpNote = corpGapFlags.get(r.date) ?? null;

    return {
      idx,
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      turnover: r.turnover,
      trans: r.trans,
      vwap: r.vwap,
      w52_high: r.w52_high,
      w52_low: r.w52_low,
      diff_pct: r.diff_pct,
      atr14: round2(atr[idx]),
      isUpperCircuit,
      isLowerCircuit,
      possibleCorpActionGap: corpNote !== null,
      corpActionNote: corpNote,
    };
  });
}
