import type { AnalyzerBar, AnalyzerConfig, SwingPoint } from '../../src/types/analyzer.ts';

function detectTierSwings(
  bars: AnalyzerBar[],
  left: number,
  right: number,
  tier: SwingPoint['tier']
): SwingPoint[] {
  const n = bars.length;
  if (n < left + right + 1) return [];

  const raw: SwingPoint[] = [];
  let lastHighPrice: number | null = null;
  let lastLowPrice: number | null = null;

  // Causal guarantee: bar `i` is ONLY confirmed once bar `i + right` exists (< n).
  // No bar after `i + right` is ever inspected to classify `i`.
  for (let i = left; i <= n - 1 - right; i++) {
    const center = bars[i];
    let isPivotHigh = true;
    let isPivotLow = true;

    for (let k = i - left; k <= i + right; k++) {
      if (k === i) continue;
      if (bars[k].high >= center.high) isPivotHigh = false;
      if (bars[k].low <= center.low) isPivotLow = false;
      if (!isPivotHigh && !isPivotLow) break;
    }

    const confirmedAtIndex = i + right;
    const confirmedDate = bars[confirmedAtIndex].date;

    if (isPivotHigh) {
      let label: SwingPoint['label'] = 'H';
      if (lastHighPrice !== null) {
        label = center.high >= lastHighPrice ? 'HH' : 'LH';
      }
      lastHighPrice = center.high;
      raw.push({
        id: `${tier}-H-${i}`,
        tier,
        kind: 'high',
        label,
        barIndex: i,
        date: center.date,
        price: center.high,
        confirmedAtIndex,
        confirmedDate,
        sweptAtIndex: null,
        sweptDate: null,
      });
    }

    if (isPivotLow) {
      let label: SwingPoint['label'] = 'L';
      if (lastLowPrice !== null) {
        label = center.low >= lastLowPrice ? 'HL' : 'LL';
      }
      lastLowPrice = center.low;
      raw.push({
        id: `${tier}-L-${i}`,
        tier,
        kind: 'low',
        label,
        barIndex: i,
        date: center.date,
        price: center.low,
        confirmedAtIndex,
        confirmedDate,
        sweptAtIndex: null,
        sweptDate: null,
      });
    }
  }

  // Causal sweep stamp: only mark swept if a bar >= confirmedAtIndex + 1 exceeds the pivot
  for (const s of raw) {
    for (let j = s.confirmedAtIndex + 1; j < n; j++) {
      if (s.kind === 'high' && bars[j].high > s.price) {
        s.sweptAtIndex = j;
        s.sweptDate = bars[j].date;
        break;
      }
      if (s.kind === 'low' && bars[j].low < s.price) {
        s.sweptAtIndex = j;
        s.sweptDate = bars[j].date;
        break;
      }
    }
  }

  return raw;
}

export function detectAllSwings(bars: AnalyzerBar[], cfg: AnalyzerConfig): SwingPoint[] {
  const minor = detectTierSwings(bars, 2, 2, 'minor');
  const internal = detectTierSwings(bars, cfg.swingLeft, cfg.swingRight, 'internal');
  const external = detectTierSwings(bars, cfg.externalSwingLeft, cfg.externalSwingRight, 'external');

  // Sort strictly by barIndex so downstream consumers iterate causally
  return [...minor, ...internal, ...external].sort(
    (a, b) => a.confirmedAtIndex - b.confirmedAtIndex || a.barIndex - b.barIndex
  );
}
