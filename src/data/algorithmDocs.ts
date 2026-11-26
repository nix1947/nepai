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

export interface AlgorithmStep {
  step: string;
  title: string;
  detail: string;
  formula?: string;
}

export interface WorkedExample {
  title: string;
  scenario: string;
  math: string[];
  verdict: string;
}

export interface AlgorithmDoc {
  id: ScannerKind | 'turnover_direction' | 'weekly_turnover';
  name: string;
  category: 'Breakout' | 'Reversal' | 'Accumulation' | 'Momentum' | 'Turnover Flow';
  bias: 'Bullish' | 'Bearish' | 'Neutral';
  minHistoryDays: number;
  summary: string;
  thesis: string;
  steps: AlgorithmStep[];
  conditions: string[];
  scoringRubric?: ScoringComponent[];
  parameters: AlgorithmParamDoc[];
  signalGlossary?: SignalGlossaryItem[];
  workedExample: WorkedExample;
  whenToUse: string;
  avoidWhen: string;
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
    steps: [
      {
        step: '01',
        title: 'Filter Equities & Ensure Minimum History',
        detail:
          'Drops debentures and mutual funds when "Equities only" is enabled, then verifies the ticker has at least Base Min + 1 trading sessions ending on the target scan date.',
      },
      {
        step: '02',
        title: 'Search for Longest Tight Price Base',
        detail:
          'Walks backward from yesterday between Base Min (20d) and Base Max (90d) to find the longest contiguous window whose total price span stays inside Max Base Range %.',
        formula: '(Max High - Min Low) / Min Low × 100 <= Max Base Range % (default 12%)',
      },
      {
        step: '03',
        title: 'Enforce Base Liquidity Floor',
        detail:
          'Rejects illiquid micro-caps by checking that mean daily turnover across the identified base window meets or exceeds Min Avg Daily Turnover.',
        formula: 'mean(base.turnover) >= Min Avg Turnover',
      },
      {
        step: '04',
        title: 'Inspect Breakout Trigger or Coiled Setup',
        detail:
          'Checks the most recent Max Age (3) sessions for a green close strictly above base_high on >= Vol Mult (2.0x) base volume, while latest close holds >= base_high. If none fired, flags SETUP when price sits within Setup % below base_high.',
        formula: 'close > base_high AND diff > 0 AND vol >= 2.0 × mean(base.vol)',
      },
      {
        step: '05',
        title: 'Measure Pre-Breakout Contraction & Accumulation',
        detail:
          'Splits the base into thirds to check volatility squeeze, compares the last 5 base days vs full base volume for supply dry-up, and computes up-day vs down-day volume inside the base.',
      },
      {
        step: '06',
        title: 'Compute 100-Point Conviction Score & Rank',
        detail:
          'Sums 9 weighted factors (base length, squeeze, dry-up, accumulation, breakout surge, close strength, trade count expansion, MA120/180 trend, 52w proximity) and ranks BREAKOUT rows ahead of SETUP rows.',
      },
    ],
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
    workedExample: {
      title: 'Hydropower stock breaking out of a 42-day box',
      scenario: 'Ticker traded between Rs 490 and Rs 538 (9.8% span) for 42 sessions with 32,000 avg shares/day, then closes at Rs 554 on 105,600 shares.',
      math: [
        'Base span = (538 / 490 - 1) × 100 = 9.8% <= 12.0% ceiling (PASS)',
        'Breakout volume ratio = 105,600 / 32,000 = 3.30x >= 2.0x (16.5 / 20 pts)',
        'Base duration 42/60 × 15 = 10.5 pts; squeeze + dry-up + >MA120/MA180 add +28 pts',
        'Breakout closed at top 88% of range (+8.8 pts) with trades 2.1x average (+5 pts)',
      ],
      verdict: 'BREAKOUT flagged with ~79/100 Conviction Score and tags: long-base(42d), volatility-squeeze, more-trades(2.1x), >MA120, >MA180.',
    },
    whenToUse: 'Best during trending or early recovery markets when sector rotation launches multi-week swings out of tight bases.',
    avoidWhen: 'Broad market panic selloffs where breakouts routinely fail and fade back inside the base within 2 days.',
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
    steps: [
      {
        step: '01',
        title: 'Measure Current Unbroken Green Streak',
        detail:
          'Counts consecutive trading sessions backwards from the scan date where diff > 0. Requires streak length N >= Min Days (default 3).',
      },
      {
        step: '02',
        title: 'Locate Pre-Streak Support Floor',
        detail:
          'Slices the Lookback window (20 trading days) immediately prior to Day 1 of the bounce and records its lowest intraday low (support) and mean volume.',
        formula: 'support_low = min(prior_20d.low)',
      },
      {
        step: '03',
        title: 'Confirm Day-1 Support Touch',
        detail:
          'Checks that Day 1 of the winning streak dipped to within Tolerance % (3%) above or below support_low so bottom-fishing demand was tested at support.',
        formula: '|(day1.low - support_low) / support_low| × 100 <= 3.0%',
      },
      {
        step: '04',
        title: 'Verify Ignition + Follow-Through Volume',
        detail:
          'Requires Day 1 volume >= Vol Mult (1.5x) prior average AND every subsequent day in the streak to keep volume >= Sustain Mult (1.0x) prior average.',
      },
      {
        step: '05',
        title: 'Filter Move Size & Rank Quality',
        detail:
          'Confirms cumulative gain >= Min Move % (2%), latest close > support_low, and sorts candidates by vol_ratio × |move_pct|.',
      },
    ],
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
    workedExample: {
      title: 'Commercial bank rebounding off 20-day low of Rs 242',
      scenario: 'Prior 20-day low = Rs 242, avg vol = 40,000. Day 1 hits low Rs 245 (+1.2% from floor) and closes +2.8% on 72,000 vol; Days 2–3 close green on 55,000 and 48,000 vol up to Rs 260.',
      math: [
        'Support touch: |245 - 242| / 242 = 1.24% <= 3.0% (PASS)',
        'Day 1 ignition: 72,000 / 40,000 = 1.80x >= 1.5x (PASS)',
        'Follow-through min vol: 48,000 / 40,000 = 1.20x >= 1.0x (PASS)',
        'Cumulative move from pre-run Rs 244 to Rs 260 = +6.56% >= 2.0%',
      ],
      verdict: 'Ranked high with 3-day streak, 1.80x ignition volume, and +6.56% bounce off defended support.',
    },
    whenToUse: 'Ideal after market pullbacks when quality stocks stop falling at clear horizontal floors and volume steps in.',
    avoidWhen: 'Stocks already extended >12% off support after 5+ consecutive green days (risk of immediate profit booking).',
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
    steps: [
      {
        step: '01',
        title: 'Measure Current Unbroken Red Streak',
        detail:
          'Walks backwards from the scan date counting consecutive sessions where diff < 0 (Min Days defaults to 1 to catch sharp same-day reversals).',
      },
      {
        step: '02',
        title: 'Identify Prior Overhead Resistance',
        detail:
          'Computes the highest intraday high and baseline average volume across the 20 sessions before the selloff began.',
        formula: 'resistance_high = max(prior_20d.high)',
      },
      {
        step: '03',
        title: 'Confirm Resistance Rejection Touch',
        detail:
          'Checks that Day 1 intraday high reached within Tolerance % (3%) of resistance_high before reversing lower.',
      },
      {
        step: '04',
        title: 'Check Heavy Supply Volume',
        detail:
          'Verifies Day 1 volume >= 1.5x prior average and every subsequent red session kept volume >= 1.0x baseline.',
      },
      {
        step: '05',
        title: 'Rank by Selling Severity',
        detail:
          'Requires total decline >= Min Move % (3.0%) and sorts by vol_ratio × |move_pct| so high-volume rejections surface first.',
      },
    ],
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
    workedExample: {
      title: 'Microfinance ticker rejected at Rs 1,120 ceiling',
      scenario: 'Prior 20-day high = Rs 1,120, avg vol = 18,000. Day 1 spikes to Rs 1,112 intraday then closes down -3.9% at Rs 1,055 on 34,200 shares.',
      math: [
        'Resistance proximity: |1,112 - 1,120| / 1,120 = 0.71% <= 3.0% (PASS)',
        'Volume spike: 34,200 / 18,000 = 1.90x >= 1.5x (PASS)',
        'Drop magnitude: -3.90% <= -3.0% threshold',
      ],
      verdict: 'Bearish distribution alert triggered immediately on Day 1 with 1.90x rejection volume.',
    },
    whenToUse: 'Risk-management check on existing holdings approaching prior swing highs.',
    avoidWhen: 'Do not confuse normal dividend/bonus price adjustments with genuine resistance rejections without checking corporate actions.',
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
    steps: [
      {
        step: '01',
        title: 'Slice Prior Lookback Window',
        detail:
          'Takes the N sessions strictly before the latest trading day (default 20 days ≈ 1 NEPSE trading month).',
      },
      {
        step: '02',
        title: 'Compute Ceiling High & Baseline Liquidity',
        detail:
          'Finds max(high), mean(volume), and mean(turnover) across the prior N-day window.',
        formula: 'ceiling = max(prior_Nd.high)',
      },
      {
        step: '03',
        title: 'Check Liquidity & Green Breakout Close',
        detail:
          'Requires prior mean turnover >= Min Avg Turnover, latest diff > 0, and latest close strictly > ceiling.',
      },
      {
        step: '04',
        title: 'Validate Volume Surge & Sort',
        detail:
          'Confirms latest volume >= Vol Mult (2.0x) × prior mean volume and ranks by vol_ratio × breakout_margin_pct.',
      },
    ],
    conditions: [
      'Latest close > max(high) over the previous Lookback days.',
      'Latest session closed positive (diff > 0) and prior Lookback mean daily turnover >= Min Avg Turnover.',
      'Latest volume >= Vol Mult × average volume of the Lookback window.',
    ],
    parameters: [
      { name: 'Lookback days', defaultVal: '20', effect: 'Number of prior trading sessions used to compute the ceiling high (~1 month at 20d).' },
      { name: 'Volume ×', defaultVal: '2.0x', effect: 'Required breakout volume relative to the lookback average.' },
    ],
    workedExample: {
      title: '20-day Donchian breakout in an insurance stock',
      scenario: 'Highest intraday high over prior 20 days = Rs 780; 20-day avg vol = 22,000. Today closes at Rs 798 (+4.2%) on 55,000 shares.',
      math: [
        'Close Rs 798 > Rs 780 ceiling (+2.31% breakout margin)',
        'Volume ratio = 55,000 / 22,000 = 2.50x >= 2.0x (PASS)',
      ],
      verdict: 'Qualified High Breakout with 2.50x volume confirmation and clean +2.31% margin above prior ceiling.',
    },
    whenToUse: 'Fast momentum discovery when sectors break out simultaneously and you want zero base-shape restrictions.',
    avoidWhen: 'Late-stage vertical rallies that already jumped +9% to +10% above the ceiling on day one.',
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
    steps: [
      {
        step: '01',
        title: 'Compute Prior N-Day Floor',
        detail:
          'Calculates min(low), baseline volume, and baseline mean turnover over the prior Lookback days.',
        formula: 'floor = min(prior_Nd.low)',
      },
      {
        step: '02',
        title: 'Detect Breakdown Close',
        detail:
          'Flags tickers closing strictly below floor (close < floor) with diff < 0 and adequate prior turnover.',
      },
      {
        step: '03',
        title: 'Confirm Heavy Breakdown Volume',
        detail:
          'Requires latest volume >= Vol Mult (2.0x) × prior average volume so low-liquidity drift is ignored.',
      },
      {
        step: '04',
        title: 'Rank by Breakdown Intensity',
        detail:
          'Sorts results by vol_ratio × |pct_below_floor|.',
      },
    ],
    conditions: [
      'Latest close < min(low) over the previous Lookback days.',
      'Latest session closed negative (diff < 0) with prior mean daily turnover >= Min Avg Turnover.',
      'Latest volume >= Vol Mult × Lookback average volume.',
    ],
    parameters: [
      { name: 'Lookback days', defaultVal: '20', effect: 'Window defining the support floor.' },
      { name: 'Volume ×', defaultVal: '2.0x', effect: 'Volume confirmation threshold on the breakdown day.' },
    ],
    workedExample: {
      title: '20-day support floor cracked on 2.4x volume',
      scenario: 'Prior 20-day low = Rs 310, avg vol = 25,000. Today closes at Rs 298 (-4.8%) on 60,000 shares.',
      math: [
        'Close Rs 298 < Rs 310 floor (-3.87% below support)',
        'Volume ratio = 60,000 / 25,000 = 2.40x >= 2.0x (PASS)',
      ],
      verdict: 'Structural breakdown warning; prioritize reviewing stop-loss or book-closure dates.',
    },
    whenToUse: 'Daily portfolio defense scan to spot holdings losing multi-week support on institutional selling.',
    avoidWhen: 'Ex-bonus or right-share adjustment mornings where ShareSansar raw prices drop mechanically without true selling.',
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
    steps: [
      {
        step: '01',
        title: 'Split Recent Window & Prior Baseline',
        detail:
          'Takes the most recent Window days (default 10) for accumulation analysis and uses the prior 20 days as the volume baseline.',
      },
      {
        step: '02',
        title: 'Enforce Tight Price Box',
        detail:
          'Checks that total high-to-low range across the recent 10 days does not exceed Max Price Range % (8%).',
        formula: '(max(win.high) - min(win.low)) / min(win.low) × 100 <= 8.0%',
      },
      {
        step: '03',
        title: 'Separate Up-Day vs Down-Day Volume',
        detail:
          'Sums volume on green sessions (diff > 0) vs red sessions (diff < 0) and requires Up/Down Vol Ratio >= 1.5x.',
        formula: 'up_vol / max(down_vol, 1) >= 1.5',
      },
      {
        step: '04',
        title: 'Verify Volume Expansion vs Prior Baseline',
        detail:
          'Confirms recent window mean volume >= prior 20d mean volume (buying activity is waking up, not dying out) and ranks by Up/Down ratio.',
      },
    ],
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
    workedExample: {
      title: 'Stealth absorption inside a 5.2% band',
      scenario: 'Over 10 days, stock stays between Rs 382 and Rs 402 (5.2% span). 6 green days trade 240,000 shares total; 4 red days trade only 95,000 shares.',
      math: [
        'Price range = (402 / 382 - 1) × 100 = 5.24% <= 8.0% (PASS)',
        'Up/Down volume ratio = 240,000 / 95,000 = 2.53x >= 1.5x (PASS)',
        'Recent 10d avg vol (33.5k) >= prior 20d avg vol (26.0k) = 1.29x (PASS)',
      ],
      verdict: 'Quiet Accumulation candidate — add to watchlist and watch for a Volume Breakout trigger.',
    },
    whenToUse: 'Building a pre-breakout watchlist 1–3 weeks before major moves happen.',
    avoidWhen: 'Expecting instant next-day fireworks; accumulation plays require patience or pairing with an entry trigger.',
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
    steps: [
      {
        step: '01',
        title: 'Read Latest 52-Week High Field',
        detail:
          'Pulls ShareSansar w52_high from the latest session row and skips symbols missing annual high data.',
      },
      {
        step: '02',
        title: 'Measure Distance Below 52-Week Peak',
        detail:
          'Computes percentage gap required for latest close to reclaim or surpass the 52-week peak.',
        formula: '(w52_high - latest.close) / w52_high × 100 <= Within % (default 3%)',
      },
      {
        step: '03',
        title: 'Compare Recent 5-Day Turnover vs Baseline',
        detail:
          'Computes mean turnover of the last 5 sessions against the prior baseline (up to 25 sessions) and requires acceleration >= Turnover Boost × (1.3x).',
        formula: 'mean(last_5d.turnover) / mean(prior.turnover) >= 1.3',
      },
      {
        step: '04',
        title: 'Rank by Turnover Acceleration',
        detail:
          'Filters by Min Avg Turnover and ranks highest turnover boost leaders at the top.',
      },
    ],
    conditions: [
      'Proximity: (w52_high - Latest Close) / w52_high × 100 <= Within %.',
      'Turnover acceleration: Mean turnover of last 5 days >= Turnover Boost × prior baseline turnover.',
      'Liquidity floor: Recent 5-day mean turnover >= Min Avg Turnover.',
    ],
    parameters: [
      { name: 'Within % of 52w high', defaultVal: '3.0%', effect: 'Maximum percentage distance below the 52-week high.' },
      { name: 'Turnover boost ×', defaultVal: '1.3x', effect: 'Minimum acceleration of 5-day turnover vs prior sessions.' },
    ],
    workedExample: {
      title: 'Leader knocking on its Rs 920 annual peak',
      scenario: '52w high = Rs 920, latest close = Rs 904. Last 5 days avg turnover = Rs 4.8 cr vs prior 20-day avg Rs 2.6 cr.',
      math: [
        'Gap to 52w high = (920 - 904) / 920 × 100 = 1.74% <= 3.0% (PASS)',
        'Turnover boost = 4.8 / 2.6 = 1.85x >= 1.3x (PASS)',
      ],
      verdict: 'Blue-sky breakout watch candidate with minimal trapped overhead supply.',
    },
    whenToUse: 'Bull market leadership hunting — leaders making new annual highs often outperform lagging laggards.',
    avoidWhen: 'Bear markets where 52w-high retests routinely double-top; confirm with close > VWAP.',
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
    steps: [
      {
        step: '01',
        title: 'Anchor Each Stock to Pre-Window Close',
        detail:
          'Finds each symbol’s starting baseline using the first session’s prev_close (falling back to open) inside the N-day window.',
      },
      {
        step: '02',
        title: 'Compute Window Return % & Liquidity Filter',
        detail:
          'Calculates (Last Close / Start Baseline - 1) × 100 and keeps symbols meeting Min Avg Turnover and full session participation.',
      },
      {
        step: '03',
        title: 'Calculate Cross-Market Median Benchmark',
        detail:
          'Finds the statistical median N-day return across all qualifying stocks so NEPSE sideways/down regimes are cleanly normalized.',
        formula: 'market_median = median(all_qualifying_returns)',
      },
      {
        step: '04',
        title: 'Score Relative Alpha & Rank',
        detail:
          'Subtracts market median from each stock’s return to isolate true outperformance.',
        formula: 'RS Alpha = Stock Return % - Market Median %',
      },
    ],
    conditions: [
      'Stock traded for at least N days in the selected window and met Min Avg Turnover.',
      'Return % = (Last Close / First-Day Prev Close - 1) × 100.',
      'Score (Alpha) = Stock Return % - Median Return % across all qualifying equities.',
    ],
    parameters: [
      { name: 'Window days', defaultVal: '20', effect: 'Lookback horizon for comparing stock return against the market median.' },
    ],
    workedExample: {
      title: 'Outperforming during a sluggish 20-day NEPSE tape',
      scenario: 'Across 20 trading days, median qualifying NEPSE stock returned -1.8%, while Stock X rose from Rs 400 to Rs 452.',
      math: [
        'Stock X return = (452 / 400 - 1) × 100 = +13.0%',
        'RS Alpha = +13.0% - (-1.8%) = +14.8% relative outperformance',
      ],
      verdict: 'Ranked near top of Relative Strength table with +14.8% Alpha.',
    },
    whenToUse: 'Spotting sector leaders that refuse to drop during index dips or accelerate fastest when NEPSE turns green.',
    avoidWhen: 'Single-day hype spikes on low liquidity; inspect Stock Explorer to check smoothness of the uptrend.',
    cautions: 'Pure momentum ranking — pair with support/consolidation charts to avoid buying overextended parabolic spikes.',
  },
  {
    id: 'turnover_direction',
    name: 'Turnover × Direction — Momentum & Capital Flow',
    category: 'Turnover Flow',
    bias: 'Neutral',
    minHistoryDays: 1,
    summary:
      'Isolates the top X% highest-turnover equities in any date range, separates buying accumulation (UP) from supply pressure (DOWN), and ranks true momentum leaders using a 100-point multi-factor Conviction Score.',
    thesis:
      'Raw turnover alone can mislead — a stock can top turnover because insiders are dumping it or via a single block cross. Combining capital flow size, price expansion, green-day consistency, VWAP/close conviction, and MA120/52w alignment pinpoints genuine institutional momentum.',
    steps: [
      {
        step: '01',
        title: 'Aggregate Range Metrics & True Period Return',
        detail:
          'Sums turnover, volume, transactions, up_days, and down_days across the selected dates. Anchors period return to the close *before* Day 1 so Day 1’s move is captured accurately.',
        formula: 'Change % = (End Close / First-Day Prev Close - 1) × 100',
      },
      {
        step: '02',
        title: 'Compute Quantile Turnover Cutoff (Top X%)',
        detail:
          'Ranks all active stocks by total Rs turnover and computes the exact percentile cutoff so only the top X% most liquid names enter the flow analysis.',
        formula: 'cutoff = quantile(all.turnover, 1 - topPct / 100)',
      },
      {
        step: '03',
        title: 'Split UP Buying Flow vs DOWN Supply Flow',
        detail:
          'Partitions high-turnover stocks into Advancing (Change % > 0) and Declining (Change % < 0), summing Rs turnover on each side to expose the market’s Buying/Selling Capital Balance.',
      },
      {
        step: '04',
        title: 'Score Momentum Quality (0–100 Points)',
        detail:
          'Evaluates each stock across 5 weighted pillars: Turnover Dominance (30), Price Expansion (25), Direction Consistency (20), VWAP & Close Conviction (15), and MA120/52w Alignment (10).',
      },
      {
        step: '05',
        title: 'Flag Block Trades & Assign Flow Read Label',
        detail:
          'Checks Rs/Trade and transaction counts to flag single-block promoter crosses ("Block / Low Trades"), while labeling high-conviction names as "Momentum Leader", "Steady Accumulation", or "Breakout Surge".',
        formula: 'Block flag if trans < max(12, days × 10) AND avg_trade_size > Rs 5,00,000',
      },
      {
        step: '06',
        title: 'Optional Steady Trend Filter & Rank',
        detail:
          'If "Steady trend only" is toggled on, keeps only stocks closing in that direction on >= 60% of traded sessions, then sorts highest Momentum Score first.',
      },
    ],
    conditions: [
      'Period change % is anchored to the previous close before the selected range started: (Last Close / First-Day Prev Close - 1) × 100.',
      'High turnover cutoff = quantile(1 - Top X% / 100) across all active symbols in the date range.',
      'Close Position % = (Close - Low) / (High - Low) × 100 on the latest session.',
      'Steady Trend filter keeps stocks where directional_days / days_traded >= 60%.',
    ],
    scoringRubric: [
      {
        factor: 'Turnover Dominance',
        maxPoints: 30,
        formula: '30 × log10(stock turnover) / log10(max turnover in Top X%). Rewards institutional liquidity magnets.',
      },
      {
        factor: 'Price Expansion',
        maxPoints: 25,
        formula: '25 × min(|Change %| / 15, 1). Full 25 pts at ≥15% period move (scaled smoothly on single-day moves too).',
      },
      {
        factor: 'Session Consistency',
        maxPoints: 20,
        formula: '20 × (Directional Days / Days Traded). Full 20 pts when 100% of traded sessions closed in trend direction.',
      },
      {
        factor: 'VWAP & Close Conviction',
        maxPoints: 15,
        formula: '+8 pts if latest Close is aligned vs intraday VWAP, plus up to 7 pts for closing near session high (or low for DOWN).',
      },
      {
        factor: 'MA120 & 52-Week Alignment',
        maxPoints: 10,
        formula: '+5 pts if trading above MA120 (below for DOWN), plus +5 pts if within 10% of 52-week high (≥20% below for DOWN).',
      },
    ],
    parameters: [
      { name: 'High turnover top X%', defaultVal: '10%', effect: 'Percentile threshold defining high-turnover leaders (smaller = stricter institutional focus).' },
      { name: 'Steady trend filter', defaultVal: 'Off', effect: 'When enabled, filters for stocks moving in the same direction on ≥60% of days.' },
    ],
    signalGlossary: [
      { tag: 'Momentum Leader', meaning: 'Score >= 68 with >= 60% directional up-days — top institutional trend confirmation.' },
      { tag: 'Steady Accumulation', meaning: 'Consistent green closes (>= 60% of days) backed by top-tier turnover.' },
      { tag: 'Breakout Surge', meaning: 'Strong >= +4% expansion closing above intraday VWAP.' },
      { tag: 'Active Buying', meaning: 'Top-X% liquidity closing positive without triggering block warnings.' },
      { tag: 'Block / Low Trades', meaning: 'High turnover concentrated in very few large tickets (> Rs 5 lakh/trade) — inspect before chasing.' },
      { tag: 'Heavy Distribution', meaning: 'High turnover falling >= -3% on >= 60% red sessions.' },
      { tag: 'Intraday Fade', meaning: 'Closed >1% below intraday VWAP on high turnover (buyers trapped intraday).' },
    ],
    workedExample: {
      title: 'Spotting a clean momentum leader vs a block cross',
      scenario: 'Across 5 sessions (cutoff Rs 18 cr), Stock A trades Rs 48 cr across 2,400 trades (Rs 2.0 lakh/trade), rises +9.6% with 4/5 green days, closes +1.4% above VWAP at top 90% of range, above MA120 and 4% below 52w high.',
      math: [
        'Turnover dominance: ~29.2 / 30 pts (near top liquidity of the week)',
        'Price expansion: 25 × (9.6 / 15) = 16.0 / 25 pts',
        'Consistency: 20 × (4 / 5) = 16.0 / 20 pts',
        'VWAP + Close conviction: 8 + (7 × 0.90) = 14.3 / 15 pts',
        'Trend alignment (>MA120 + within 10% of 52w high): 5 + 5 = 10.0 / 10 pts',
      ],
      verdict: 'Total Momentum Score = 85.5/100 → Classified as "Momentum Leader". Meanwhile, a stock with Rs 35 cr across just 18 trades (Rs 1.94 cr/trade) is flagged "Block / Low Trades".',
    },
    whenToUse: 'Every trading evening after 15:40 NPT sync to see where big NEPSE money rotated today and over the last 5–20 sessions.',
    avoidWhen: 'Treating "Block / Low Trades" rows as organic retail/institutional momentum without checking floorsheet/news.',
    cautions: 'Always compare total turnover against single-day block/promoter trades using Rs/Trade and transaction counts.',
  },
  {
    id: 'weekly_turnover',
    name: 'Weekly Breakdown (Mon–Fri)',
    category: 'Turnover Flow',
    bias: 'Neutral',
    minHistoryDays: 5,
    summary:
      'Buckets daily trading sessions into Monday–Friday trading weeks and ranks weekly turnover leaders to visualize capital rotation across weeks.',
    thesis:
      'Tracking which tickers repeatedly appear in the weekly top-N turnover heatmap reveals sustained sector leadership and multi-week institutional rotation.',
    steps: [
      {
        step: '01',
        title: 'Align Calendar to Monday–Friday Trading Weeks',
        detail:
          'Rolls any chosen start date back to Monday and groups sessions into sequential Monday–Friday NEPSE trading buckets.',
      },
      {
        step: '02',
        title: 'Aggregate Weekly OHLC, Turnover & Return',
        detail:
          'Sums each symbol’s Rs turnover and shares across the week and measures weekly % return from pre-Monday close to Friday close.',
      },
      {
        step: '03',
        title: 'Rank Top-N Symbols per Week',
        detail:
          'Extracts the top N (default 15) turnover leaders inside every week bucket and maps their week-over-week capital concentration.',
      },
      {
        step: '04',
        title: 'Render Multi-Week Rotation Heatmap',
        detail:
          'Highlights repeat appearance streaks across consecutive weeks so persistent institutional favorites stand out visually.',
      },
    ],
    conditions: [
      'Each week starts on Monday and covers the Monday–Friday trading calendar.',
      'Aggregates total turnover, shares traded, and full-week percentage change from the pre-week close.',
    ],
    parameters: [
      { name: 'Top N per week', defaultVal: '15', effect: 'Number of top turnover symbols captured for each Monday–Friday week.' },
    ],
    workedExample: {
      title: 'Tracking sector rotation across 4 consecutive weeks',
      scenario: 'Hydropower stock ranks #12 in Week 1 (Rs 22 cr), #6 in Week 2 (Rs 34 cr), and #2 in Week 3 (Rs 58 cr).',
      math: [
        'Week-over-week turnover expansion: 22 → 34 → 58 cr (+163% acceleration)',
        'Heatmap row lights up across 3 consecutive columns, confirming sustained rotation',
      ],
      verdict: 'Multi-week capital magnet — higher conviction than a 1-day turnover spike.',
    },
    whenToUse: 'Reviewing medium-term (4–12 week) capital rotation across NEPSE sectors and marquee leaders.',
    avoidWhen: 'Comparing a 2-day Dashain/Tihar holiday week directly in raw Rs crores against a full 5-day week.',
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
