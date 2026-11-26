import type { ScannerKind } from '../types/market';

export interface AlgorithmParamDoc {
  name: string;
  defaultVal: string;
  effect: string;
}

export interface ScoringComponent {
  factor: string;
  maxPoints: number;
  formula: string;
}

export interface SignalGlossaryItem {
  tag: string;
  meaning: string;
}

export interface AlgorithmDoc {
  id: ScannerKind | 'turnover_direction' | 'weekly_turnover';
  name: string;
  category: 'Breakout' | 'Reversal' | 'Accumulation' | 'Momentum' | 'Turnover Flow';
  bias: 'Bullish' | 'Bearish' | 'Neutral';
  minHistoryDays: number;
  summary: string;
  thesis: string;
  conditions: string[];
  scoringRubric?: ScoringComponent[];
  parameters: AlgorithmParamDoc[];
  signalGlossary?: SignalGlossaryItem[];
  cautions: string;
}

export const ALGORITHM_DOCS: AlgorithmDoc[] = [
  {
    id: 'potential',
    name: 'Consolidation → Volume Breakout (+ Setups)',
    category: 'Breakout',
    bias: 'Bullish',
    minHistoryDays: 25,
    summary:
      'Detects stocks that built a tight multi-week price base (20–90 days within a narrow high-to-low ceiling) and either broke above resistance on surging volume (BREAKOUT) or sit coiled just beneath the upper boundary (SETUP).',
    thesis:
      'Extended sideways compression absorbs overhead supply as impatient sellers exit and institutional buyers accumulate quietly. When price finally closes above the multi-week ceiling on 2x+ average volume, trapped shorts and sidelined buyers create sustained directional momentum.',
    conditions: [
      'Base window: Longest contiguous lookback window (between Base Min and Base Max trading days) where (Max High / Min Low - 1) × 100 <= Max Base Range %.',
      'Liquidity floor: Mean daily turnover across the base window must meet or exceed Min Avg Daily Turnover.',
      'BREAKOUT trigger: Within the last Max Age days, close > base_high, daily diff > 0, breakout volume >= Vol Mult × base average volume, and latest close remains >= base_high.',
      'SETUP trigger (if enabled): No recent breakout yet, but current price sits inside a valid base and within Setup % below base_high.',
    ],
    scoringRubric: [
      {
        factor: 'Base Duration',
        maxPoints: 15,
        formula: '15 × min(base_days, 60) / 60. Longer bases build stronger structural support.',
      },
      {
        factor: 'Volatility Squeeze',
        maxPoints: 10,
        formula: 'Compares average intraday range % of the final third of the base vs the first third; full 10 pts at ≥40% contraction.',
      },
      {
        factor: 'Volume Dry-Up',
        maxPoints: 10,
        formula: 'Compares last 5 base days volume vs base average; full 10 pts when pre-breakout volume contracts ≥40% (seller exhaustion).',
      },
      {
        factor: 'Base Accumulation',
        maxPoints: 10,
        formula: 'Ratio of up-day volume to down-day volume inside the base; full 10 pts at ≥2.0x.',
      },
      {
        factor: 'Breakout Volume Surge',
        maxPoints: 20,
        formula: 'Breakout-day volume divided by base average volume; full 20 pts at ≥4.0x (BREAKOUT only).',
      },
      {
        factor: 'Strong Close',
        maxPoints: 10,
        formula: '(Close - Low) / (High - Low) on the breakout candle; rewards closing near the session high.',
      },
      {
        factor: 'Broad Participation',
        maxPoints: 5,
        formula: '5 pts awarded if breakout transaction count >= 1.5x base average (broad buying rather than a single block trade).',
      },
      {
        factor: 'Long-Term Trend (MA120 / MA180)',
        maxPoints: 10,
        formula: '5 pts for close > 120-day moving average + 5 pts for close > 180-day moving average.',
      },
      {
        factor: '52-Week High Proximity',
        maxPoints: 10,
        formula: '10 pts if within 5% of 52w high (minimal overhead supply), 5 pts if within 15%.',
      },
    ],
    parameters: [
      { name: 'Min base days', defaultVal: '20', effect: 'Minimum trading days required in the tight range before a breakout counts.' },
      { name: 'Max base range %', defaultVal: '12.0%', effect: 'Maximum high-to-low percentage span allowed across the base.' },
      { name: 'Breakout volume ×', defaultVal: '2.0x', effect: 'Required multiple over base average volume on the breakout day.' },
      { name: 'Max breakout age', defaultVal: '3 days', effect: 'How recently the breakout occurred so you catch fresh moves.' },
      { name: 'Setup proximity %', defaultVal: '3.0%', effect: 'How close a coiled SETUP stock must close below base high.' },
    ],
    signalGlossary: [
      { tag: 'long-base(Nd)', meaning: 'Base persisted for 40+ trading days, increasing structural reliability.' },
      { tag: 'volatility-squeeze', meaning: 'Daily high-low spread shrank by >20% into the end of the base.' },
      { tag: 'volume-dry-up', meaning: 'Last 5 days of base volume dropped >20% below average, indicating scarce supply.' },
      { tag: 'accumulation(Nx)', meaning: 'Up-day volume inside the base exceeded down-day volume by ≥1.3x.' },
      { tag: 'strong-close', meaning: 'Breakout candle closed in the top 30% of its intraday range.' },
      { tag: 'more-trades(Nx)', meaning: 'Transaction count expanded ≥1.5x over base average.' },
      { tag: 'closed-above-VWAP', meaning: 'Breakout close finished above the session volume-weighted average price.' },
      { tag: '>MA120 / >MA180', meaning: 'Price is trading above its 120-day and/or 180-day moving average.' },
      { tag: 'near-52w-high', meaning: 'Price is within 5% of its 52-week peak with low overhead resistance.' },
    ],
    cautions: 'In thin NEPSE sessions, single-day circuit hits (+10%) can occur with low transaction counts. Prefer BREAKOUT rows showing "more-trades" and "strong-close".',
  },
  {
    id: 'support',
    name: 'Support + Volume Breakout',
    category: 'Reversal',
    bias: 'Bullish',
    minHistoryDays: 12,
    summary:
      'Finds stocks currently on an unbroken streak of N+ up-days whose first up-day bounced directly off the prior lookback support zone on a volume spike and maintained above-average volume on every subsequent day.',
    thesis:
      'A high-volume bounce right at a well-defined multi-week low followed by sustained follow-through volume indicates institutional defense of support and a high-conviction swing reversal.',
    conditions: [
      'Unbroken run: Latest N consecutive sessions (N >= Min Days) all closed higher (diff > 0).',
      'Support touch: Day 1 of the run had its intraday low within Tolerance % of the prior Lookback period lowest low.',
      'Ignition + follow-through: Day 1 volume >= Vol Mult × prior Lookback average volume, and every later day kept volume >= Sustain Mult × base average.',
      'Net expansion: Cumulative return from pre-run close to latest close >= Min Move %, and latest close > support level.',
    ],
    parameters: [
      { name: 'Min days in run', defaultVal: '3', effect: 'Minimum consecutive green sessions up to the scan date.' },
      { name: 'Lookback days', defaultVal: '20', effect: 'Prior window used to define the support low and baseline average volume.' },
      { name: 'Day-1 volume ×', defaultVal: '1.5x', effect: 'Volume spike multiplier required on the first bounce session.' },
      { name: 'At level within %', defaultVal: '3.0%', effect: 'Maximum distance above support low for Day 1 to qualify as touching support.' },
      { name: 'Min move %', defaultVal: '2.0%', effect: 'Minimum cumulative gain across the winning streak.' },
    ],
    cautions: 'Ranked by vol_ratio × |move_pct|. Watch dist_from_level_pct to avoid chasing stocks already extended >12% off support.',
  },
  {
    id: 'selloff',
    name: 'Heavy Selloff at Resistance',
    category: 'Reversal',
    bias: 'Bearish',
    minHistoryDays: 12,
    summary:
      'Detects distribution and supply rejection: stocks whose current red streak began by touching the recent lookback high (resistance) on heavy volume and kept declining on above-average volume.',
    thesis:
      'When a rally stalls into prior highs on surging volume and reverses downward for consecutive sessions, buyers are trapped at the top and smart money is distributing.',
    conditions: [
      'Unbroken down run: Latest N consecutive sessions (N >= Min Days) closed negative (diff < 0).',
      'Resistance rejection: Day 1 intraday high reached within Tolerance % of the prior Lookback highest high.',
      'Heavy supply: Day 1 volume >= Vol Mult × prior average, and all subsequent down days sustained >= Sustain Mult × base average.',
      'Net drop: Cumulative percentage decline <= -Min Move %.',
    ],
    parameters: [
      { name: 'Min days in run', defaultVal: '1', effect: 'Minimum consecutive down sessions (1 catches immediate sharp rejections).' },
      { name: 'Lookback days', defaultVal: '20', effect: 'Prior window defining overhead resistance and baseline volume.' },
      { name: 'Day-1 volume ×', defaultVal: '1.5x', effect: 'Volume surge required on the rejection candle.' },
      { name: 'At level within %', defaultVal: '3.0%', effect: 'How close Day 1 high must get to prior resistance.' },
      { name: 'Min move %', defaultVal: '3.0%', effect: 'Minimum magnitude of the selloff.' },
    ],
    cautions: 'Useful for risk management and profit-taking alerts on existing holdings rather than shorting (short-selling is unavailable on NEPSE).',
  },
  {
    id: 'highbreak',
    name: 'High Breakout (N-Day)',
    category: 'Breakout',
    bias: 'Bullish',
    minHistoryDays: 21,
    summary:
      'Classic Donchian/momentum breakout: flags stocks whose latest close decisively cleared the highest intraday high of the preceding N trading days on a 2x+ volume expansion.',
    thesis:
      'Fresh multi-week closing highs backed by institutional turnover indicate a regime shift from range-bound trading into trend expansion.',
    conditions: [
      'Latest close > max(high) over the previous Lookback days.',
      'Latest session closed positive (diff > 0) and prior Lookback mean daily turnover >= Min Avg Turnover.',
      'Latest volume >= Vol Mult × average volume of the Lookback window.',
    ],
    parameters: [
      { name: 'Lookback days', defaultVal: '20', effect: 'Number of prior trading sessions used to compute the ceiling high (~1 month at 20d).' },
      { name: 'Volume ×', defaultVal: '2.0x', effect: 'Required breakout volume relative to the lookback average.' },
    ],
    cautions: 'Check whether the breakout is early (just cleared prior high) or already hit a +10% upper circuit.',
  },
  {
    id: 'breakdown',
    name: 'Support Breakdown (Bearish)',
    category: 'Reversal',
    bias: 'Bearish',
    minHistoryDays: 21,
    summary:
      'Flags stocks closing below the lowest intraday low of the previous N trading days on a heavy volume surge.',
    thesis:
      'A high-volume close beneath established multi-week support triggers stop-losses and signals structural weakness.',
    conditions: [
      'Latest close < min(low) over the previous Lookback days.',
      'Latest session closed negative (diff < 0) with prior mean daily turnover >= Min Avg Turnover.',
      'Latest volume >= Vol Mult × Lookback average volume.',
    ],
    parameters: [
      { name: 'Lookback days', defaultVal: '20', effect: 'Window defining the support floor.' },
      { name: 'Volume ×', defaultVal: '2.0x', effect: 'Volume confirmation threshold on the breakdown day.' },
    ],
    cautions: 'Verify if the drop coincides with ex-dividend/book-closure price adjustments on NEPSE before treating it as pure technical weakness.',
  },
  {
    id: 'accumulation',
    name: 'Quiet Accumulation',
    category: 'Accumulation',
    bias: 'Bullish',
    minHistoryDays: 15,
    summary:
      'Spots stealth institutional buying before price breaks out: stocks trading in a narrow range over N days while volume on up-days significantly outweighs volume on down-days.',
    thesis:
      'Large buyers accumulate positions patiently without chasing price up, creating asymmetric green-day volume vs red-day volume inside a flat consolidation.',
    conditions: [
      'Tight range: (Window High / Window Low - 1) × 100 <= Max Price Range %.',
      'Volume skew: Total volume on up-days (diff > 0) / down-days (diff < 0) >= Min Up/Down Vol.',
      'Rising activity: Recent window average volume >= prior 20-day average volume.',
    ],
    parameters: [
      { name: 'Window days', defaultVal: '10', effect: 'Recent trading window inspected for quiet absorption.' },
      { name: 'Max price range %', defaultVal: '8.0%', effect: 'Keeps the scan focused on flat/quiet price action.' },
      { name: 'Up/down volume ≥', defaultVal: '1.5x', effect: 'Minimum bullish-to-bearish volume imbalance.' },
    ],
    cautions: 'Early-stage signal — stocks can stay in accumulation for weeks before a catalyst sparks an actual breakout.',
  },
  {
    id: 'near52',
    name: 'Near 52-Week High',
    category: 'Momentum',
    bias: 'Bullish',
    minHistoryDays: 10,
    summary:
      'Screens for market leaders trading within X% of their 52-week peak while experiencing a sharp 5-day surge in daily turnover.',
    thesis:
      'Stocks near annual highs carry virtually no trapped overhead sellers; when 5-day turnover accelerates >= 1.3x above the prior baseline, a continuation breakout is often imminent.',
    conditions: [
      'Proximity: (52w High / Latest Close - 1) × 100 <= Within %.',
      'Turnover acceleration: Mean turnover of last 5 days >= Turnover Boost × prior baseline turnover.',
      'Liquidity floor: Recent 5-day mean turnover >= Min Avg Turnover.',
    ],
    parameters: [
      { name: 'Within % of 52w high', defaultVal: '3.0%', effect: 'Maximum percentage distance below the 52-week high.' },
      { name: 'Turnover boost ×', defaultVal: '1.3x', effect: 'Minimum acceleration of 5-day turnover vs prior sessions.' },
    ],
    cautions: 'Requires ShareSansar 52-week high field (`w52_high > 0`).',
  },
  {
    id: 'rs',
    name: 'Relative Strength Leaders',
    category: 'Momentum',
    bias: 'Bullish',
    minHistoryDays: 20,
    summary:
      'Ranks liquid equities by their N-day percentage return minus the market median return across the same window.',
    thesis:
      'Stocks that hold up or advance while the broader NEPSE index consolidates or pulls back tend to lead the next market leg higher.',
    conditions: [
      'Stock traded for at least N days in the selected window and met Min Avg Turnover.',
      'Return % = (Last Close / First-Day Prev Close - 1) × 100.',
      'Score (Alpha) = Stock Return % - Median Return % across all qualifying equities.',
    ],
    parameters: [
      { name: 'Window days', defaultVal: '20', effect: 'Lookback horizon for comparing stock return against the market median.' },
    ],
    cautions: 'Pure momentum ranking — pair with support/consolidation charts to avoid buying overextended parabolic spikes.',
  },
  {
    id: 'turnover_direction',
    name: 'Turnover × Direction & Steady Trend',
    category: 'Turnover Flow',
    bias: 'Neutral',
    minHistoryDays: 1,
    summary:
      'Isolates the top X% most actively traded companies in a period and separates them into institutional accumulation (Price UP) vs heavy distribution (Price DOWN).',
    thesis:
      'Price moves without turnover lack conviction; turnover spikes identify where big money is actively rotating in or exiting.',
    conditions: [
      'Period change % is anchored to the previous close *before* the selected range started: (Last Close / First-Day Prev Close - 1) × 100.',
      'High turnover cutoff = quantile(1 - Top X% / 100) across all active symbols in the date range.',
      'Optional Steady Trend filter requires >= 60% of traded sessions in the period to close in the selected direction.',
    ],
    parameters: [
      { name: 'High turnover top X%', defaultVal: '10%', effect: 'Percentile threshold defining high-turnover leaders.' },
      { name: 'Steady trend filter', defaultVal: 'Off', effect: 'When enabled, filters for stocks moving in the same direction on ≥60% of days.' },
    ],
    cautions: 'Always compare total turnover against single-day block/promoter trades using transaction counts (`trans`).',
  },
  {
    id: 'weekly_turnover',
    name: 'Weekly Breakdown (NEPSE Sun–Sat)',
    category: 'Turnover Flow',
    bias: 'Neutral',
    minHistoryDays: 5,
    summary:
      'Buckets daily trading sessions into Nepal Stock Exchange weeks (Sunday through Saturday) and ranks weekly turnover leaders to visualize capital rotation across weeks.',
    thesis:
      'Tracking which tickers repeatedly appear in the weekly top-N turnover heatmap reveals sustained sector leadership and multi-week institutional rotation.',
    conditions: [
      'Each week starts on Sunday and ends on Saturday (aligned to NEPSE Sun–Thu trading calendar).',
      'Aggregates total turnover, shares traded, and full-week percentage change from the pre-week close.',
    ],
    parameters: [
      { name: 'Top N per week', defaultVal: '15', effect: 'Number of top turnover symbols captured for each Sunday–Saturday week.' },
    ],
    cautions: 'Short holiday weeks will naturally show lower absolute Rs crore values in the heatmap.',
  },
];

export const SCANNER_DOC_MAP: Record<ScannerKind, AlgorithmDoc> = ALGORITHM_DOCS.reduce(
  (acc, doc) => {
    if (
      doc.id === 'potential' ||
      doc.id === 'support' ||
      doc.id === 'selloff' ||
      doc.id === 'highbreak' ||
      doc.id === 'breakdown' ||
      doc.id === 'accumulation' ||
      doc.id === 'near52' ||
      doc.id === 'rs'
    ) {
      acc[doc.id] = doc;
    }
    return acc;
  },
  {} as Record<ScannerKind, AlgorithmDoc>
);
