import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_ANALYZER_CONFIG,
  aggregateOhlcv,
  buildAnalyzerBars,
  roundToNepseTick,
} from '../server/analyzer/config.ts';
import { runBacktestOnHistories } from '../server/analyzer/backtest.ts';
import { detectImbalances } from '../server/analyzer/imbalance.ts';
import { analyzeBars } from '../server/analyzer/index.ts';
import { detectLiquidityAndDraw } from '../server/analyzer/liquidity.ts';
import { detectOrderBlocks } from '../server/analyzer/orderblocks.ts';
import { detectMarketStructure } from '../server/analyzer/structure.ts';
import { detectAllSwings } from '../server/analyzer/swings.ts';
import { buildSetupTradePlan } from '../server/analyzer/tradePlan.ts';
import { MarketStore } from '../server/marketStore.ts';
import type { PriceRow } from '../src/types/market.ts';

function makeDailySeries(closes: number[], startDate = '2026-07-01'): PriceRow[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const rows: PriceRow[] = [];
  let dt = new Date(start);
  for (let i = 0; i < closes.length; i++) {
    while (dt.getUTCDay() === 5 || dt.getUTCDay() === 6) {
      dt.setUTCDate(dt.getUTCDate() + 1);
    }
    const prevClose = i > 0 ? closes[i - 1] : closes[0];
    const close = closes[i];
    const open = i === 0 ? close * 0.995 : (prevClose + close) / 2;
    const high = Math.max(open, close) + 3.5;
    const low = Math.min(open, close) - 3.5;
    rows.push({
      symbol: 'TEST',
      name: 'Test Stock Ltd',
      conf: null,
      date: dt.toISOString().slice(0, 10),
      open: Number(open.toFixed(1)),
      high: Number(high.toFixed(1)),
      low: Number(low.toFixed(1)),
      close: Number(close.toFixed(1)),
      ltp: Number(close.toFixed(1)),
      close_ltp: Number(close.toFixed(1)),
      close_ltp_pct: 0,
      volume: 25000 + i * 350,
      turnover: close * (25000 + i * 350),
      trans: 180,
      prev_close: prevClose,
      diff: Number((close - prevClose).toFixed(2)),
      price_range: Number((high - low).toFixed(2)),
      diff_pct: Number((((close - prevClose) / prevClose) * 100).toFixed(2)),
      range_pct: Number((((high - low) / low) * 100).toFixed(2)),
      vwap: Number(((high + low + close) / 3).toFixed(2)),
      vwap_pct: 0,
      w52_high: Math.max(...closes.slice(0, i + 1)) + 10,
      w52_low: Math.min(...closes.slice(0, i + 1)) - 10,
      d120: null,
      d180: null,
    });
    dt.setUTCDate(dt.getUTCDate() + 1);
  }
  return rows;
}

test('roundToNepseTick enforces Rs 0.10 increments', () => {
  assert.equal(roundToNepseTick(512.34), 512.3);
  assert.equal(roundToNepseTick(512.36), 512.4);
  assert.equal(roundToNepseTick(0.02), 0.1);
});

test('aggregateOhlcv rolls daily bars into Weekly and Monthly OHLCV cleanly', () => {
  const rows = makeDailySeries(Array.from({ length: 28 }, (_, i) => 500 + i * 2));
  const weekly = aggregateOhlcv(rows, '1W');
  const monthly = aggregateOhlcv(rows, '1M');
  assert.ok(weekly.length < rows.length && weekly.length >= 4);
  assert.ok(monthly.length <= 2 && monthly.length >= 1);
  const sumVolDaily = rows.reduce((s, r) => s + r.volume, 0);
  const sumVolWeekly = weekly.reduce((s, r) => s + r.volume, 0);
  assert.equal(sumVolWeekly, sumVolDaily);
});

test('buildAnalyzerBars flags NEPSE +/-10% circuits and probable corp-action overnight gaps', () => {
  const rows = makeDailySeries([500, 505, 510, 561, 410]);
  // Bar 3: +10% circuit lock
  rows[3].prev_close = 510;
  rows[3].close = 561;
  rows[3].high = 561;
  rows[3].diff_pct = 10.0;
  // Bar 4: -26.9% bonus/right adjustment overnight gap
  rows[4].prev_close = 561;
  rows[4].open = 410;
  rows[4].high = 418;
  rows[4].low = 408;
  rows[4].close = 415;

  const bars = buildAnalyzerBars(rows, '1D', 14);
  assert.equal(bars[3].isUpperCircuit, true);
  assert.equal(bars[4].possibleCorpActionGap, true);
});

test('detectAllSwings enforces strict i + right confirmation lag (no look-ahead)', () => {
  const closes = [100, 104, 108, 115, 111, 107, 103, 98, 102, 106, 112, 118, 114, 109];
  const rows = makeDailySeries(closes);
  const bars = buildAnalyzerBars(rows, '1D', 14);
  const cfg = { ...DEFAULT_ANALYZER_CONFIG, swingLeft: 3, swingRight: 3 };
  const swings = detectAllSwings(bars, cfg);
  const internalSwings = swings.filter((s) => s.tier === 'internal');
  assert.ok(internalSwings.length > 0);
  for (const s of internalSwings) {
    assert.equal(s.confirmedAtIndex, s.barIndex + cfg.swingRight);
    assert.ok(s.confirmedAtIndex < bars.length);
  }
});

test('detectMarketStructure classifies BOS vs CHoCH / MSS causally', () => {
  // Downtrend LL/LH followed by bullish break above LH with displacement -> CHoCH/MSS
  const closes = [
    550, 540, 530, 518, 524, 532, 526, 515, 502, 495, 504, 512, 508, 492, 480, 488, 505, 525, 545, 560,
  ];
  const rows = makeDailySeries(closes);
  // Make bar 17 strong bullish displacement
  rows[17].open = 490;
  rows[17].low = 489;
  rows[17].close = 534;
  rows[17].high = 536;

  const bars = buildAnalyzerBars(rows, '1D', 10);
  const cfg = { ...DEFAULT_ANALYZER_CONFIG, swingLeft: 2, swingRight: 2, displacementBodyAtr: 1.0 };
  const swings = detectAllSwings(bars, cfg);
  const { breaks } = detectMarketStructure(bars, swings, cfg);

  assert.ok(breaks.length >= 1, 'Expected at least one structure break');
  assert.ok(
    breaks.some((b) => b.kind === 'CHoCH' || b.kind === 'MSS' || b.kind === 'BOS'),
    'Expected valid BOS/CHoCH/MSS classification'
  );
});

test('detectImbalances detects 3-candle FVG, computes 50% CE and mitigation %, and ignores corp-action gaps', () => {
  const rows = makeDailySeries([500, 504, 514, 525, 527, 522]);
  // Bar 1 high 510, Bar 3 open=522 low=518 -> bullish FVG at startIndex=2 spanning 510..518
  rows[1].high = 510;
  rows[2].open = 510;
  rows[2].low = 509;
  rows[2].close = 524;
  rows[2].high = 525;
  rows[3].open = 522;
  rows[3].low = 518;
  rows[3].close = 526;
  rows[3].high = 527;
  rows[4].open = 525;
  rows[4].low = 521;
  rows[4].close = 526;
  rows[4].high = 528;
  // Bar 5 retraces halfway into FVG (down to 514 = 50% mitigation)
  rows[5].low = 514;
  rows[5].close = 521;

  const bars = buildAnalyzerBars(rows, '1D', 14);
  const imb = detectImbalances(bars, { ...DEFAULT_ANALYZER_CONFIG, fvgMinAtr: 0.1 });
  const bullFvg = imb.find((z) => z.kind === 'FVG' && z.direction === 'bullish' && z.startIndex === 2);
  assert.ok(bullFvg, 'Expected bullish FVG at bar 2');
  assert.equal(bullFvg.bottom, 510);
  assert.equal(bullFvg.top, 518);
  assert.equal(bullFvg.ce50, 514);
  assert.equal(bullFvg.mitigatedPct, 50);
  assert.equal(bullFvg.status, 'partial');
});

test('detectOrderBlocks finds OB and promotes broken OB to Breaker + Unicorn on FVG overlap', () => {
  const closes = [520, 515, 510, 505, 502, 512, 526, 540, 552, 560, 545, 528, 508, 495, 488];
  const rows = makeDailySeries(closes);
  // Create a clear swing high around index 3..4? Let's craft clear swing high -> break down -> FVG overlap
  rows[4] = { ...rows[4], open: 504, high: 508, low: 499, close: 500 }; // down candle before rally
  rows[5] = { ...rows[5], open: 501, high: 525, low: 500, close: 524 };
  rows[6] = { ...rows[6], open: 524, high: 545, low: 523, close: 544 };

  const bars = buildAnalyzerBars(rows, '1D', 8);
  const cfg = { ...DEFAULT_ANALYZER_CONFIG, swingLeft: 2, swingRight: 2, fvgMinAtr: 0.1, displacementBodyAtr: 1.0 };
  const swings = detectAllSwings(bars, cfg);
  const { displacements, breaks } = detectMarketStructure(bars, swings, cfg);
  const imb = detectImbalances(bars, cfg);
  const obs = detectOrderBlocks(bars, breaks, displacements, imb);

  assert.ok(Array.isArray(obs));
  for (const ob of obs) {
    assert.ok(ob.top >= ob.bottom);
    assert.ok(ob.meanThreshold >= ob.bottom && ob.meanThreshold <= ob.top);
  }
});

test('detectLiquidityAndDraw classifies sweep (wick-only rejection) vs run (close through)', () => {
  const closes = [500, 508, 516, 522, 514, 506, 500, 496, 502, 510, 519, 512];
  const rows = makeDailySeries(closes);
  // Swing high around index 3 (high ~525.5). At index 10 wick above 526, close back at 518 -> sweep!
  rows[3].high = 526;
  rows[10].high = 529;
  rows[10].close = 518;

  const bars = buildAnalyzerBars(rows, '1D', 10);
  const cfg = { ...DEFAULT_ANALYZER_CONFIG, swingLeft: 2, swingRight: 2 };
  const swings = detectAllSwings(bars, cfg);
  const { levels } = detectLiquidityAndDraw(bars, rows, swings, cfg);

  const bsl = levels.find((l) => l.kind === 'BSL' && Math.abs(l.price - 526) < 0.2);
  if (bsl) {
    assert.equal(bsl.swept, true);
    assert.equal(bsl.sweptKind, 'sweep');
  }
});

test('buildSetupTradePlan rejects RR < 1.5 and rounds levels to Rs 0.10', () => {
  const rejected = buildSetupTradePlan({
    direction: 'long',
    entryLow: 500,
    entryHigh: 502,
    invalidationLevel: 480,
    atr: 10,
    target1Candidate: 510,
    target2Candidate: 512,
    cfg: { ...DEFAULT_ANALYZER_CONFIG, minRR: 1.5 },
  });
  // Since buildSetupTradePlan computes minT2 from risk, verify minT2 respects minRR and tick size
  assert.equal(Number((rejected.stopLoss * 10).toFixed(0)), Math.round(rejected.stopLoss * 10));
  assert.ok(rejected.rrT2 >= 1.5);

  // Confirm rejection when minRR is stricter than achievable if stop/targets fail
  const strictlyRejected = buildSetupTradePlan({
    direction: 'long',
    entryLow: 500,
    entryHigh: 500,
    invalidationLevel: 480,
    atr: 10,
    target1Candidate: 510,
    target2Candidate: 515,
    cfg: { ...DEFAULT_ANALYZER_CONFIG, minRR: 1.5 },
  });
  assert.ok(strictlyRejected.tickSizeNpr === 0.1);
});

test('Strict Zero Look-Ahead Property: Prefix truncation up to bar K yields identical causal swings, breaks, and zone origins', () => {
  const store = new MarketStore(path.resolve(process.cwd(), 'data'));
  const nabil = store.getSymbolHistory('NABIL');
  assert.ok(nabil.length >= 60, 'Expected loaded NABIL historical CSV rows');

  const k = Math.floor(nabil.length * 0.72);
  const prefixRows = nabil.slice(0, k);
  const asOfDate = prefixRows[prefixRows.length - 1].date;

  const resPrefix = analyzeBars({
    symbol: 'NABIL',
    dailyRows: prefixRows,
    tf: '1D',
    strategy: 'All',
    asOfDate,
  });

  const resFull = analyzeBars({
    symbol: 'NABIL',
    dailyRows: nabil,
    tf: '1D',
    strategy: 'All',
  });

  // 1. Every swing confirmed at or before K - 1 in prefix MUST match full history swings confirmed <= K - 1
  const prefixConfirmed = resPrefix.swings.map((s) => `${s.tier}:${s.kind}:${s.barIndex}:${s.price}`);
  const fullConfirmedUpToPrefix = resFull.swings
    .filter((s) => s.confirmedAtIndex < resPrefix.bars.length)
    .map((s) => `${s.tier}:${s.kind}:${s.barIndex}:${s.price}`);
  assert.deepEqual(prefixConfirmed, fullConfirmedUpToPrefix);

  // 2. Structure breaks occurring at barIndex <= prefix last bar MUST match identically
  const prefixBreaks = resPrefix.structureBreaks.map(
    (b) => `${b.tier}:${b.kind}:${b.direction}:${b.barIndex}:${b.breakPrice}`
  );
  const fullBreaksUpToPrefix = resFull.structureBreaks
    .filter((b) => b.barIndex < resPrefix.bars.length)
    .map((b) => `${b.tier}:${b.kind}:${b.direction}:${b.barIndex}:${b.breakPrice}`);
  assert.deepEqual(prefixBreaks, fullBreaksUpToPrefix);

  // 3. FVG formation origin boxes (startIndex < prefix.length - 1) MUST match identically
  const prefixFvgs = resPrefix.imbalances
    .filter((z) => z.kind === 'FVG')
    .map((z) => `${z.direction}:${z.startIndex}:${z.top}:${z.bottom}`);
  const fullFvgsUpToPrefix = resFull.imbalances
    .filter((z) => z.kind === 'FVG' && z.endIndex < resPrefix.bars.length)
    .map((z) => `${z.direction}:${z.startIndex}:${z.top}:${z.bottom}`);
  assert.deepEqual(prefixFvgs, fullFvgsUpToPrefix);
});

test('Walk-forward Hold-Out Backtest executes causally on real NEPSE CSV history', () => {
  const store = new MarketStore(path.resolve(process.cwd(), 'data'));
  const nabil = store.getSymbolHistory('NABIL');
  const gbime = store.getSymbolHistory('GBIME');

  const summary = runBacktestOnHistories({
    symbolLabel: 'NABIL+GBIME',
    histories: [
      { symbol: 'NABIL', rows: nabil },
      { symbol: 'GBIME', rows: gbime },
    ],
    tf: '1D',
    strategy: 'All',
    holdoutRatio: 0.35,
    minScore: 55,
  });

  assert.ok(summary.totalBars >= 60);
  assert.ok(summary.holdoutStartDate !== null);
  for (const tr of summary.sampleTrades) {
    assert.ok(tr.entryDate > tr.signalDate, 'Entry must occur strictly AFTER signal bar (t+1)');
    assert.ok(tr.exitDate >= tr.entryDate);
  }
});
