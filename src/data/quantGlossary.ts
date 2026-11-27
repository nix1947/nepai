import type { GlossaryCategory, GlossaryEntry } from '../types/quant';

export const GLOSSARY_CATEGORIES: GlossaryCategory[] = [
  'Market Basics',
  'Fundamental Analysis',
  'Technical Analysis',
  'Indicators',
  'Trading Strategies',
  'Quantitative Analysis',
  'Statistics',
  'Risk Management',
  'Portfolio Management',
];

export interface ConceptualDistinction {
  id: string;
  title: string;
  leftLabel: string;
  leftSummary: string;
  rightLabel: string;
  rightSummary: string;
  practicalTakeaway: string;
  nepaliNote: string;
}

export const CONCEPTUAL_DISTINCTIONS: ConceptualDistinction[] = [
  {
    id: 'winrate-vs-probability',
    title: 'Historical Win Rate vs Future Probability',
    leftLabel: 'Historical Win Rate',
    leftSummary:
      'The percentage of past simulated trades that closed profitable under specific historical market conditions and rules.',
    rightLabel: 'Future Probability',
    rightSummary:
      'Unknown forward odds of a single upcoming trade succeeding, which can shift if market regime, liquidity, or policy changes.',
    practicalTakeaway:
      'Never treat a 62% historical win rate as a 62% guarantee on tomorrow’s trade. Always inspect the 95% confidence interval, sample size, and out-of-sample stability.',
    nepaliNote:
      'Purano data ma 60% trade jitnu bhaneko bholi ko trade pani 60% pakka jitxa bhanne hoina; bazar ko mahol badlida result farak parna sakxa.',
  },
  {
    id: 'technical-vs-stat-advantage',
    title: 'Technical Strength vs Statistical Advantage',
    leftLabel: 'Technical Strength (Score 0–100)',
    leftSummary:
      'Measures how strong current price, trend, relative strength, and volume look today on a single chart.',
    rightLabel: 'Statistical Advantage (Net Expectancy)',
    rightSummary:
      'Measures whether this exact setup historically earned positive average returns after NEPSE fees, taxes, and slippage across a meaningful sample.',
    practicalTakeaway:
      'A high technical score (e.g., 84/100) NEVER triggers a BUY by itself if the setup lacks statistical validation, liquidity, or a valid entry trigger.',
    nepaliNote:
      'Chart ramro dekhinu matra kafi hudaina; tyasto setup le atit ma fee ra tax katayera nafaa diyeko praman pani hunu parxa.',
  },
  {
    id: 'watchlist-vs-entry',
    title: 'Watchlist vs Actionable Entry',
    leftLabel: 'Watchlist / Forming Setup',
    leftSummary:
      'A healthy stock tightening near resistance or pulling back toward support that has NOT yet confirmed demand.',
    rightLabel: 'Actionable Entry (Confirmed)',
    rightSummary:
      'Price triggers the breakout or reversal condition with confirming volume inside an acceptable market regime and defined stop-loss.',
    practicalTakeaway:
      'Keep forming ideas on your Watchlist and wait patiently. Buying early before confirmation often traps capital in sideways chop or failed rallies.',
    nepaliNote:
      'Watchlist bhaneko najar rakhne suchi matra ho; price ra volume le spasta confirmation nadiye samma kinmel garnu hatar hunxa.',
  },
  {
    id: 'unrealized-vs-realized',
    title: 'Unrealized vs Realized Profit',
    leftLabel: 'Unrealized (Paper) P&L',
    leftSummary:
      'On-screen gain or loss based on today’s closing price while you still hold the shares; it fluctuates every session.',
    rightLabel: 'Realized Profit / Loss',
    leftSummaryShort: '',
    rightSummary:
      'Locked-in cash gain or loss only after shares are actually sold and NEPSE broker fees, SEBON fee, DP charge, and CGT are settled.',
    practicalTakeaway:
      'Do not count paper gains as permanent wealth or relax your trailing stop prematurely. Only realized exits protect capital.',
    nepaliNote:
      'Share nabeche samma dekhiyeko naafa (Unrealized) ghatna sakxa; bechera fee ra CGT katepachi matra pakka naafa (Realized) hunxa.',
  } as ConceptualDistinction,
  {
    id: 'gross-vs-net',
    title: 'Gross Return vs Net Return',
    leftLabel: 'Gross Return',
    leftSummary:
      'Raw percentage change between sell price and buy price before any trading costs.',
    rightLabel: 'Net Return (NEPSE Realistic)',
    rightSummary:
      'Actual return remaining after buy/sell broker commission (0.24%–0.36%), SEBON fee (0.015%), NPR 25 DP fee per side, slippage, and 7.5%/5% CGT.',
    practicalTakeaway:
      'Frequent tiny 1.5%–2% scalps in NEPSE often lose money net of round-trip fees (~0.8%–1.0%) and slippage. Targets must justify costs.',
    nepaliNote:
      'Share ko mulya 2% badhda pani kinmel ko broker commission, DP fee ra tax katda haat ma lagne suddha naafa dherai thorai hunxa.',
  },
  {
    id: 'market-vs-company-risk',
    title: 'Market Risk vs Company-Specific Risk',
    leftLabel: 'Market (Systematic) Risk',
    leftSummary:
      'Broad NEPSE downturns driven by NRB liquidity, interest rates, or political/macro shocks that pull down even strong companies.',
    rightLabel: 'Company-Specific (Idiosyncratic) Risk',
    rightSummary:
      'Risks unique to one company—such as weak earnings, rising NPLs, promoter lock-in expiry, right share dilution, or corporate governance issues.',
    practicalTakeaway:
      'Market Regime controls help manage market risk (cutting overall exposure in Bearish markets); Fundamental Audits and position caps limit company risk.',
    nepaliNote:
      'Bazar nai oralo lagda (Market risk) sabai share ghatna sakxan, tara kunai company ko aafnai kamjor report le (Company risk) tyasko share matra girauxa.',
  },
];

export const QUANT_GLOSSARY: GlossaryEntry[] = [
  // ------------------------------------------------------------------ Market Basics
  {
    id: 'ohlcv',
    term: 'OHLCV',
    fullName: 'Open, High, Low, Close, and Volume',
    category: 'Market Basics',
    simpleDefinition:
      'The five core daily price and trading activity numbers recorded for each stock on every NEPSE session.',
    nepaliExplanation:
      'Pratyek din ko trading ma share khuleko (Open), sabse mathi pugeko (High), sabse tala jhareko (Low), antim ma banda bhayeko mulya (Close), ra kati kitta kinmel bhayo (Volume) ko purai bibran.',
    whyItMatters:
      'Every candlestick chart, moving average, volatility estimate, and volume confirmation check is built directly from clean OHLCV data.',
    howCalculated:
      'Recorded directly from ShareSansar / NEPSE End-of-Day exchange trade logs (validated so Low <= Open/Close <= High).',
    interpretation:
      'Close near High on rising Volume suggests buyers controlled the close; Close near Low on high Volume warns of distribution.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Stock ABC opens at NPR 400, hits High 420, dips to Low 395, closes at 416 with Volume 85,000 shares.',
    tradingDecisionImpact:
      'Broken OHLCV bars (e.g., High < Low or negative price) are flagged and quarantined before scanning.',
    commonMistakes:
      'Ignoring Volume or trusting unadjusted Close jumps caused by bonus shares or rights adjustments.',
    limitations:
      'Daily OHLCV hides intraday order-book sweeps and circuit-locked queues (upper/lower ±10% freezes).',
    advancedExplanation:
      'Serves as the canonical discrete-time state vector for causal indicator filters and next-session execution simulations.',
    relatedTerms: ['vwap', 'liquidity', 'turnover', 'volume-strength'],
  },
  {
    id: 'liquidity',
    term: 'Liquidity',
    fullName: 'Market Liquidity (Ease of Entering & Exiting)',
    category: 'Market Basics',
    simpleDefinition:
      'How quickly and smoothly you can buy or sell shares at near the current market price without moving the price sharply against yourself.',
    nepaliExplanation:
      'Tapai le chaheko bela thulo mulya ghatbadh nagarai sajilai share kinna wa bechna sakne kshamata.',
    whyItMatters:
      'Illiquid stocks trap traders when trying to exit on a stop-loss, causing severe slippage.',
    howCalculated:
      'Measured by 20-day average daily turnover (NPR), 20-day average traded shares, and how many days of volume your position represents.',
    formula: 'Days to Exit = Position Shares / 20-Day Avg Daily Volume',
    interpretation:
      'Positions exceeding ~5% of average daily volume face higher exit friction in NEPSE.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Buying 10,000 shares of a stock trading only 2,000 shares/day equals 5 full days of average volume — dangerously illiquid.',
    tradingDecisionImpact:
      'This engine excludes stocks below minimum turnover/volume floors and caps position size at 5% of 20-day average volume.',
    commonMistakes:
      'Sizing a large position in a thinly traded micro-cap or promoter share that shows high paper gains but zero buyers at exit.',
    limitations:
      '20-day averages can drop suddenly during bearish market freezes or ±10% lower-circuit lockouts.',
    advancedExplanation:
      'Acts as a hard capacity constraint in position sizing and backtest fill feasibility.',
    relatedTerms: ['turnover', 'slippage', 'position-sizing'],
  },
  {
    id: 'turnover',
    term: 'Turnover',
    fullName: 'Daily Traded Turnover (NPR Value)',
    category: 'Market Basics',
    simpleDefinition:
      'The total Nepalese Rupee value of shares bought and sold for a stock or the entire NEPSE market in a day.',
    nepaliExplanation:
      'Ek din ma kunai share wa purai bazar ma bhayeko kul kinmel ko rakam (Rupaiya ma).',
    whyItMatters:
      'Price rallies backed by strong rupee turnover attract institutional and serious capital rather than thin retail spikes.',
    howCalculated:
      'Sum of (Trade Price × Traded Shares) across all transactions in the session.',
    formula: 'Turnover ≈ VWAP × Volume',
    interpretation:
      'Market-wide turnover rising above its 20-day average confirms healthy participation during Bullish regimes.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: If 50,000 shares trade at an average price of NPR 600, daily turnover is NPR 3.00 Crore.',
    tradingDecisionImpact:
      'Used both as a minimum stock filter (e.g., ≥ NPR 10 Lakh/day) and a Market Regime breadth/participation input.',
    commonMistakes:
      'Confusing share Volume with rupee Turnover—100,000 shares of an NPR 120 stock is smaller capital flow than 40,000 shares of an NPR 900 stock.',
    limitations:
      'Single-day floor-sheet block/cross deals can temporarily inflate turnover without broad demand.',
    advancedExplanation:
      'Turnover-weighted NEPSE proxies track institutional capital rotation across sectors.',
    relatedTerms: ['liquidity', 'relative-volume', 'vwap'],
  },
  {
    id: 'transaction-costs',
    term: 'Transaction Costs',
    fullName: 'NEPSE Brokerage, SEBON Fee, DP Charge & CGT',
    category: 'Market Basics',
    simpleDefinition:
      'The mandatory fees and taxes paid whenever you buy or sell shares in Nepal.',
    nepaliExplanation:
      'Share kinda ra bechda lagne broker commission, SEBON fee, DP charge (Rs 25), ra naafa ma lagne CGT tax.',
    whyItMatters:
      'Ignoring round-trip costs turns slightly positive gross strategies into net losing strategies.',
    howCalculated:
      'Buy side: SEBON-slab broker fee (0.24%–0.36%, min NPR 10) + 0.015% SEBON fee + NPR 25 DP. Sell side: same fees + 7.5% (<1 yr) or 5% (≥1 yr) Capital Gains Tax on net gain.',
    formula: 'Total Buy Cost = Gross + Broker + 0.015% SEBON + NPR 25',
    interpretation:
      'A round-trip trade under 1 year needs roughly ~0.85% price rise just to break even before slippage.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Buying NPR 100,000 costs ~NPR 370 in buy fees; selling at NPR 110,000 incurs ~NPR 390 sell fees plus 7.5% CGT (~NPR 693) on net profit.',
    tradingDecisionImpact:
      'Every backtest expectancy, profit factor, and Risk/Reward ratio in this engine is computed NET of NEPSE costs.',
    commonMistakes:
      'Evaluating trades on gross price change without factoring broker slabs, DP fees on small lots, and CGT.',
    limitations:
      'CGT rate depends on actual Demat holding duration (365+ days qualifies for 5%).',
    advancedExplanation:
      'Creates a non-linear fixed-cost drag (NPR 25 DP + min NPR 10 broker) that severely penalizes undersized positions.',
    relatedTerms: ['slippage', 'expectancy', 'risk-reward-ratio'],
  },

  // ------------------------------------------------------------------ Fundamental Analysis
  {
    id: 'sepa',
    term: 'SEPA',
    fullName: 'Specific Entry Point Analysis (Mark Minervini)',
    category: 'Fundamental Analysis',
    simpleDefinition:
      'A disciplined stock-selection method combining healthy Stage-2 uptrends, tight price bases, and fundamental quality before entering near low-risk pivot points.',
    nepaliExplanation:
      'Mark Minervini ko niyam anusar baliyo badhdo trend ra sano price consolidation bhitra surakshit entry khojne paddhati.',
    whyItMatters:
      'Helps avoid buying falling or sideways stocks too early while demanding strict risk control.',
    howCalculated:
      'Combines trend alignment (Close > rising 50-day SMA), contraction bases (VCP), relative strength leadership, and optional fundamental audit verification.',
    interpretation:
      'Best candidates show strong technical posture paired with clean fundamental audit scores (no severe NPL, regulatory, or dilution red flags).',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: A bank in an uptrend forms 3 tighter pullbacks (12%, 6%, 3%) above its 50-day SMA, passes fundamental checks, and breaks out on 2x volume.',
    tradingDecisionImpact:
      'Inspires the Trend Strength weighting, VCP detector, and Fundamental Risk Reject gate.',
    commonMistakes:
      'Chasing extended stocks far above their 50-day SMA instead of waiting for tight contraction pivots.',
    limitations:
      'In this app, fundamental statement audits exist only for audited stocks; others rely on price/volume EOD data.',
    advancedExplanation:
      'Targets asymmetric positive skewness where small initial stop-losses protect against large downside tails.',
    relatedTerms: ['can-slim', 'vcp', 'trend-strength'],
  },
  {
    id: 'can-slim',
    term: 'CAN SLIM',
    fullName: "William O'Neil Growth & Leadership Framework",
    category: 'Fundamental Analysis',
    simpleDefinition:
      'A checklist emphasizing earnings/fundamental strength, new highs or breakouts, institutional accumulation, relative strength leadership, and overall market direction.',
    nepaliExplanation:
      'Company ko aamdani, naya uchai (high), thulo lagani (volume), ra bazar ko disha herera agrani share chinne tarika.',
    whyItMatters:
      'Reminds traders that even strong charts struggle when the overall market direction (M) turns Bearish.',
    howCalculated:
      'Evaluated here via Relative Strength vs NEPSE, Accumulation/Distribution volume, Near-52W High positioning, Market Regime classification, and cached Fundamental Intel audits.',
    interpretation:
      'Look for alignment between Market Regime (Bullish/Neutral), Leadership (RS > 75th percentile), and Volume Accumulation.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: During a Bullish NEPSE regime, a stock near its 52-week high breaks out on 2.2x average volume with clean fundamental metrics.',
    tradingDecisionImpact:
      'Drives our Market Regime gate and Relative Strength + Accumulation weights.',
    commonMistakes:
      'Ignoring the "M" (Market Regime) and buying aggressive breakouts during a Bearish downtrend.',
    limitations:
      'Quarterly EPS/revenue series are not natively stored inside daily ShareSansar price CSVs; fundamental coverage is limited to cached audit records.',
    advancedExplanation:
      'Pairs cross-sectional momentum leadership with regime-conditional exposure scaling.',
    relatedTerms: ['sepa', 'relative-strength', 'market-breadth'],
  },

  // ------------------------------------------------------------------ Technical Analysis
  {
    id: 'support',
    term: 'Support',
    fullName: 'Technical Support Zone',
    category: 'Technical Analysis',
    simpleDefinition:
      'A price floor or area where buying interest has historically been strong enough to stop prices from falling further.',
    nepaliExplanation:
      'Mulya tala jhardai jada kinne manche haru aayera mulya rokkine wa pharkine aadhar thau.',
    whyItMatters:
      'Provides logical reference points for Trend Pullback entries and Stop-Loss / Invalidation placement.',
    howCalculated:
      'Computed causally from prior 20-day swing lows, consolidation base lows, and rising 20-day / 50-day moving averages.',
    interpretation:
      'Holding above support on shrinking volume shows selling pressure is drying up; breaking support on heavy volume warns of breakdown.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: A stock bounces twice from NPR 480–485; NPR 480 acts as support for placing a protective stop slightly below at NPR 472.',
    tradingDecisionImpact:
      'Used to anchor invalidation levels and Trend Pullback zones.',
    commonMistakes:
      'Buying automatically at support without waiting for reversal confirmation while price is still crashing.',
    limitations:
      'Support is a zone, not an exact single rupee, and breaks rapidly during panic selling.',
    advancedExplanation:
      'Represents clustered demand liquidity and prior equilibrium price memory.',
    relatedTerms: ['resistance', 'pullback', 'invalidation-level'],
  },
  {
    id: 'resistance',
    term: 'Resistance',
    fullName: 'Technical Resistance Ceiling',
    category: 'Technical Analysis',
    simpleDefinition:
      'A price ceiling where selling supply has previously halted upward rallies.',
    nepaliExplanation:
      'Mulya mathi jadai jada bechne manche badhera mulya rokkine mathillo taha.',
    whyItMatters:
      'Clearing resistance on strong volume signals that overhead supply has been absorbed by stronger demand.',
    howCalculated:
      'Calculated from prior N-day closing/intraday highs (excluding today so there is zero look-ahead) and 52-week highs.',
    interpretation:
      'Repeated tests of resistance with shallower pullbacks suggest imminent breakout pressure.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Stock XYZ stalls three times near NPR 550 over 20 days; a close at NPR 558 on 1.9x volume breaks resistance.',
    tradingDecisionImpact:
      'Defines exact Breakout trigger prices and Target reference zones.',
    commonMistakes:
      'Buying right below heavy resistance without confirmation, or chasing 8% above resistance.',
    limitations:
      'False breakouts ("bull traps") occur frequently in low-breadth markets if volume fails to follow through.',
    advancedExplanation:
      'Overhead supply resistance is priced causally using `max(high[t-20..t-1])` strictly prior to bar `t`.',
    relatedTerms: ['support', 'breakout', 'vcp'],
  },
  {
    id: 'breakout',
    term: 'Breakout',
    fullName: 'Resistance Breakout Strategy',
    category: 'Trading Strategies',
    simpleDefinition:
      'When a stock decisively closes above an established price ceiling (resistance) backed by above-average volume.',
    nepaliExplanation:
      'Mulya le purano mathillo taha (resistance) lai thulo volume sahit mathi katne awastha.',
    whyItMatters:
      'Signals a potential shift from sideways supply absorption into a fresh upward expansion phase.',
    howCalculated:
      'Requires Close > prior 20-day resistance ceiling, Relative Volume >= 1.5x (configurable), rising Relative Strength, and non-Bearish Market/Sector conditions.',
    interpretation:
      'High-volume breakouts with strong close near session high carry higher follow-through than weak low-volume pokes.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Stock MNB breaks above NPR 620 resistance to close at NPR 632 on 2.1x 20-day average volume while NEPSE is Bullish.',
    tradingDecisionImpact:
      'One of the three core Entry Timing strategies tested in historical backtests.',
    commonMistakes:
      'Chasing stocks already 10%+ above the breakout pivot, which stretches distance to stop-loss.',
    limitations:
      'Breakout win rates frequently fall below 50%; profitability relies on cutting failed breakouts fast and letting winners reach 2R–3R.',
    advancedExplanation:
      'Evaluated causally with entry simulated at `t+1` open/next price so today’s close signal never cheats.',
    relatedTerms: ['resistance', 'relative-volume', 'vcp'],
  },
  {
    id: 'pullback',
    term: 'Pullback',
    fullName: 'Trend Pullback Strategy',
    category: 'Trading Strategies',
    simpleDefinition:
      'A temporary, controlled dip inside an existing healthy uptrend toward a rising moving average or support zone, followed by renewed buying.',
    nepaliExplanation:
      'Badhdo trend bhitra mulya kehi din thorai ghatdai support ma aayera feri mathi pharkine awastha.',
    whyItMatters:
      'Offers tighter stop-loss distances and calmer fills than chasing vertical breakout days.',
    howCalculated:
      'Requires price > rising 50-day SMA, dip near 20-day SMA/EMA or support on declining sell volume, and a reversal bar closing near the upper half of its range.',
    interpretation:
      'Healthy pullbacks show light volume on red days and expanding volume on the bounce.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: After rallying to NPR 740, a stock drifts on low volume to its rising 20-day SMA at NPR 702, then rebounds to close at NPR 714.',
    tradingDecisionImpact:
      'Core Entry Timing strategy that often remains viable during Neutral market regimes when breakouts struggle.',
    commonMistakes:
      'Confusing a genuine trend breakdown on heavy selling volume with a gentle pullback.',
    limitations:
      'If the broader market rolls into a Bearish shock, pullbacks can keep sliding right through support.',
    advancedExplanation:
      'Uses mean-reversion entry timing conditioned on positive medium-term trend slope.',
    relatedTerms: ['support', 'sma', 'ema', 'trend-strength'],
  },
  {
    id: 'vcp',
    term: 'VCP',
    fullName: 'Volatility Contraction Pattern',
    category: 'Trading Strategies',
    simpleDefinition:
      'A chart consolidation pattern where price swings become progressively smaller from left to right and volume dries up before an upward breakout.',
    nepaliExplanation:
      'Share ko mulya ghatbadh hune dayara (range) kramasha sano hudai jane ra volume sukdai jane shanta awastha, jun breakout aghi dekhinxa.',
    whyItMatters:
      'Tightening price swings prove sellers are exhausted, meaning even modest new demand can trigger an explosive move with a tight stop-loss.',
    howCalculated:
      'Compares recent 10-day price range % vs prior 20-day range %, checks progressive contraction count, and checks volume dry-up ratio (<0.85x prior baseline).',
    interpretation:
      'True VCP occurs inside an uptrend (above rising SMA50) — tightening range + shrinking volume + intact trend = coiled spring.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Swing 1 drops 14%, Swing 2 drops 7%, Swing 3 tightens to 3% with volume at 0.65x average just under NPR 800 resistance.',
    tradingDecisionImpact:
      'Powers both the VCP Watchlist ("Forming") and Confirmed VCP Breakout triggers.',
    commonMistakes:
      'Labeling any messy sideways range in a Stage-4 downtrend as a VCP.',
    limitations:
      'VCPs fail quickly if triggered into weak market breadth without confirming breakout volume.',
    advancedExplanation:
      'Quantifies volatility compression ratios across nested rolling lookback windows.',
    relatedTerms: ['sepa', 'breakout', 'volatility'],
  },
  {
    id: 'accumulation',
    term: 'Accumulation',
    fullName: 'Institutional / Quiet Accumulation',
    category: 'Technical Analysis',
    simpleDefinition:
      'Quiet, steady buying where up-days consistently attract noticeably heavier volume than down-days while price holds firm or edges higher.',
    nepaliExplanation:
      'Thulo laganikarta le halla nagari chupchap share batulne prakriya, jaha badhne din ko volume ghatne din bhanda dherai hunxa.',
    whyItMatters:
      'Volume often leads price breakouts when informed buyers absorb available supply steadily.',
    howCalculated:
      'Measured by Up/Down Volume Ratio over 20 sessions (total volume on positive close days divided by volume on negative close days) plus price resilience above VWAP/SMA20.',
    formula: 'Up/Down Vol Ratio = Sum(Volume on Up Days) / Sum(Volume on Down Days)',
    interpretation:
      'Ratio >= 1.35x with rising closes indicates healthy accumulation.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Over 20 days, a stock trades 900k shares on up days vs 550k on down days (1.64x ratio) within an 8% tight range.',
    tradingDecisionImpact:
      'Boosts the 20% Volume Strength component score and surfaces candidates on the Accumulation Watchlist.',
    commonMistakes:
      'Assuming accumulation means immediate tomorrow breakout; accumulation phases can last weeks.',
    limitations:
      'Cannot distinguish one large operator from broad institutional participation without floor-sheet broker data.',
    advancedExplanation:
      'Captures signed volume imbalance prior to range expansion.',
    relatedTerms: ['distribution', 'relative-volume', 'volume-strength'],
  },
  {
    id: 'distribution',
    term: 'Distribution',
    fullName: 'Supply Distribution Warning',
    category: 'Technical Analysis',
    simpleDefinition:
      'Heavy selling pressure where down-days attract much higher volume than up-days, signaling strong holders are exiting.',
    nepaliExplanation:
      'Thulo matra ma share bechiyeko awastha, jaha mulya ghatne din ko volume badhne din bhanda dherai hunxa.',
    whyItMatters:
      'Clustered distribution days warn traders to avoid new buys, tighten stops, or reduce exposure.',
    howCalculated:
      'Detected when 20-day Up/Down Volume Ratio falls <= 0.78x and price weakens below VWAP or 20-day SMA.',
    interpretation:
      'Strong distribution below key moving averages triggers REDUCE or SELL risk flags.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: A stock falls 3% twice on 2.0x volume while rebounds occur on weak 0.6x volume (Up/Dn ratio 0.62x).',
    tradingDecisionImpact:
      'Penalizes Volume Strength scores and triggers Distribution Warnings / REDUCE classifications.',
    commonMistakes:
      'Holding stubbornly through heavy distribution expecting an immediate bounce.',
    limitations:
      'Temporary profit-taking after huge rallies can mimic distribution briefly before support holds.',
    advancedExplanation:
      'Negative signed-volume flow coupled with deteriorating price momentum.',
    relatedTerms: ['accumulation', 'selloff', 'stop-loss'],
  },
  {
    id: 'moving-average-slope',
    term: 'Moving-Average Slope',
    fullName: 'Direction & Rate of Change of a Moving Average',
    category: 'Technical Analysis',
    simpleDefinition:
      'Whether a moving average line is pointing upward, flat, or downward over recent sessions.',
    nepaliExplanation:
      'Moving average rekha mathi tir chadhdaixa, sidha xa ki oralo jhardaixa bhanne gati.',
    whyItMatters:
      'Price merely sitting above a falling moving average is much weaker than price riding above a steadily rising moving average.',
    howCalculated:
      'Percentage change in the 20-day or 50-day SMA compared to 10 trading sessions ago.',
    formula: 'SMA Slope % = ((SMA_today - SMA_10d_ago) / SMA_10d_ago) × 100',
    interpretation:
      'Positive 50-day SMA slope confirms a durable intermediate uptrend; negative slope signals structural drag.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: If 50-day SMA rose from NPR 500 to NPR 515 over 10 days, the slope is +3.0% (strong uptrend).',
    tradingDecisionImpact:
      'Core input to both Market Regime detection and the Trend Strength (20%) technical score.',
    commonMistakes:
      'Using moving average crossovers without checking whether the longer average is actually sloping upward.',
    limitations:
      'Slopes lag sharp V-shaped market bottoms by several sessions.',
    advancedExplanation:
      'First discrete derivative of the smoothed price trend filter.',
    relatedTerms: ['sma', 'trend-strength'],
  },
  {
    id: 'trend-strength',
    term: 'Trend Strength',
    fullName: 'Trend Strength Component (20% Weight)',
    category: 'Technical Analysis',
    simpleDefinition:
      'Measures how clearly, smoothly, and persistently a stock is moving in an upward trend above its key moving averages.',
    nepaliExplanation:
      'Share ko badhdo trend kati spasta, baliyo ra tikau xa bhanne maapan.',
    whyItMatters:
      'Trading in the direction of an established trend puts underlying momentum at your back.',
    howCalculated:
      'Combines Close vs SMA20/SMA50, SMA20 > SMA50 alignment, SMA20 & SMA50 positive slopes, and ADX trend intensity (weighted 20% of the 100-point technical score).',
    interpretation:
      'Scores above 70 indicate clean Stage-2 uptrend alignment; scores below 40 reflect downtrend or choppy weakness.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Price NPR 560 > SMA20 (542) > SMA50 (518), both slopes positive, ADX 28 => Trend Strength scores ~88/100 (17.6/20 weighted points).',
    tradingDecisionImpact:
      'Contributes 20% of the candidate’s composite technical score.',
    commonMistakes:
      'Assuming a 95/100 Trend Strength means "buy immediately" — strong trends can be overextended and still need a pullback or base.',
    limitations:
      'Trend metrics lag sudden reversals at cycle peaks.',
    advancedExplanation:
      'Blends moving-average ordering, gradient, and directional movement strength (ADX).',
    relatedTerms: ['sma', 'adx', 'moving-average-slope'],
  },
  {
    id: 'momentum',
    term: 'Momentum',
    fullName: 'Price Momentum Component (20% Weight)',
    category: 'Technical Analysis',
    simpleDefinition:
      'The speed and persistence of recent price gains measured across multi-week returns and momentum oscillators.',
    nepaliExplanation:
      'Pachillo kehi hapta ma share ko mulya kati gati le mathi badhdaixa bhanne teji.',
    whyItMatters:
      'Stocks displaying healthy, non-exhausted momentum tend to continue attracting buyers over short-to-medium horizons.',
    howCalculated:
      'Evaluates 10-day and 20-day returns, RSI(14) positioned in the productive 50–70 zone (penalizing extreme >80 exhaustion), and positive MACD histogram.',
    interpretation:
      'Constructive momentum sits in RSI 52–72 with expanding MACD histogram; RSI > 80 signals short-term overextension.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: +7.5% over 20 days, RSI 63, MACD histogram +2.1 => healthy bullish momentum without parabolic exhaustion.',
    tradingDecisionImpact:
      'Contributes 20% of the composite technical score and flags overextended chase risk.',
    commonMistakes:
      'Blindly buying when RSI is 85+ right after a 3-day circuit spike.',
    limitations:
      'Momentum reverses sharply during macro shocks or liquidity crunches.',
    advancedExplanation:
      'Balances return velocity with mean-reversion exhaustion penalties.',
    relatedTerms: ['rsi', 'macd', 'relative-strength'],
  },

  // ------------------------------------------------------------------ Indicators
  {
    id: 'vwap',
    term: 'VWAP',
    fullName: 'Volume-Weighted Average Price',
    category: 'Indicators',
    simpleDefinition:
      'The true average price paid per share during the day, giving more weight to prices where larger share volumes traded.',
    nepaliExplanation:
      'Din bhari bhayeko kul rakam (turnover) lai kul kitta (volume) le bhag garda aaune sabse yathartha ausat kinmel mulya.',
    whyItMatters:
      'Shows whether today’s buyers actually ended the day in profit relative to the average rupee traded.',
    howCalculated:
      'Uses ShareSansar EOD VWAP column directly when present; if missing or zero, falls back to an explicitly labeled OHLCV-Derived Approximation `(H+L+C)/3` or `Turnover/Volume`.',
    formula: 'VWAP = Total Traded Turnover (NPR) / Total Traded Volume (Shares)',
    interpretation:
      'Closing above a rising VWAP indicates buyers accepted higher prices throughout the session; closing far below VWAP signals intraday rejection.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Even if a stock touches NPR 520 briefly, if heavy volume traded at NPR 504 and Close is NPR 512 (> VWAP 505), buyers hold an advantage.',
    tradingDecisionImpact:
      'Accounts for 10% of the technical score (VWAP Behaviour) and checks intraday closing quality.',
    commonMistakes:
      'Treating VWAP from a single day as multi-month support like a 50-day SMA.',
    limitations:
      'Where ShareSansar CSV omits VWAP, OHLCV typical-price approximation cannot capture exact intraday tick weighting.',
    advancedExplanation:
      'Acts as a daily execution benchmark and supply-demand equilibrium proxy.',
    relatedTerms: ['ohlcv', 'turnover', 'accumulation'],
  },
  {
    id: 'sma',
    term: 'SMA',
    fullName: 'Simple Moving Average (20-day, 50-day, 200-day)',
    category: 'Indicators',
    simpleDefinition:
      'The straightforward average of closing prices over the last N trading sessions (e.g., 20 days ≈ 1 month, 50 days ≈ 2.5 months, 200 days ≈ 10 months).',
    nepaliExplanation:
      'Pachillo N din ko antim mulya (Close) jodera N le bhag garda aaune ausat mulya rekha.',
    whyItMatters:
      'Smooths out daily noise so you can clearly see short-term (20d), medium-term (50d), and long-term (200d) trend direction.',
    howCalculated:
      'Sum of last N closing prices divided by N. If fewer than 200 trading days exist in the CSV store, SMA200 is honestly labeled Unavailable.',
    formula: 'SMA(N) = (C_1 + C_2 + ... + C_N) / N',
    interpretation:
      'Price above rising SMA20 & SMA50 signals an active uptrend; breaking below SMA50 on heavy volume is a classic exit warning.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: If closing prices over 20 sessions average NPR 450 and today’s close is NPR 468, the stock trades +4% above SMA20.',
    tradingDecisionImpact:
      'Powers Market Regime index filters, Trend Strength scoring, Trend Pullback zones, and MA breakdown exits.',
    commonMistakes:
      'Expecting SMA200 to appear accurately when only 95 days of historical data are loaded.',
    limitations:
      'Gives equal weight to old and recent bars inside the window, causing slight lag on fast turns.',
    advancedExplanation:
      'Zero-lookahead rectangular moving-average filter computed strictly on `bars[0..t]`.',
    relatedTerms: ['ema', 'moving-average-slope', 'pullback'],
  },
  {
    id: 'ema',
    term: 'EMA',
    fullName: 'Exponential Moving Average',
    category: 'Indicators',
    simpleDefinition:
      'A moving average that places extra importance on the most recent trading days so it reacts faster to price turns than an SMA.',
    nepaliExplanation:
      'Pachilla din haru ko mulya lai dherai mahatwa diyera chhito pratikriya dine ausat mulya rekha.',
    whyItMatters:
      'Helps spot trend acceleration, pullback rebounds, and faster momentum shifts inside active swings.',
    howCalculated:
      'Recursive weighting using smoothing factor k = 2 / (N + 1). Also forms the backbone of MACD (EMA12 & EMA26).',
    formula: 'EMA_t = Close_t × k + EMA_(t-1) × (1 - k)',
    interpretation:
      'Fast trends often bounce neatly near EMA20 before hitting the slower SMA50.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: After a fast 15% run, price dips for 3 days onto rising EMA20 at NPR 610 and bounces cleanly.',
    tradingDecisionImpact:
      'Guides short-term pullback monitoring, MACD calculation, and trailing stop tightening.',
    commonMistakes:
      'Over-reacting to single-day EMA whipsaws during sideways range-bound markets.',
    limitations:
      'More sensitive than SMA to short-term false spikes.',
    advancedExplanation:
      'First-order infinite impulse response (IIR) low-pass price filter.',
    relatedTerms: ['sma', 'macd', 'pullback'],
  },
  {
    id: 'rsi',
    term: 'RSI',
    fullName: 'Relative Strength Index (14-Period)',
    category: 'Indicators',
    simpleDefinition:
      'A momentum score from 0 to 100 comparing the size of recent up-days against recent down-days.',
    nepaliExplanation:
      '0 dekhi 100 samma ko ank ma pachillo 14 din ma kinne ra bechne chap madhye kun baliyo xa bhanne dekhaucha.',
    whyItMatters:
      'Shows whether bullish momentum is healthy (50–70), dangerously overheated (>80), or trapped in bearish weakness (<40).',
    howCalculated:
      'Wilder’s 14-day smoothed average gains divided by smoothed average losses, converted to a 0–100 scale.',
    formula: 'RSI = 100 - [100 / (1 + AvgGain14 / AvgLoss14)]',
    interpretation:
      'In uptrends, RSI 52–72 is constructive strength; RSI < 40 warns of weak momentum; RSI > 80 warns of chasing risk.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: A stock breaking out with RSI at 64 has room to run, whereas a stock surging vertically with RSI 87 risks an immediate pullback.',
    tradingDecisionImpact:
      'Feeds the Momentum component (20% weight) and penalizes extreme overextension.',
    commonMistakes:
      'Selling a strong leader merely because RSI crossed 70, or buying a crashing downtrend stock just because RSI hit 25.',
    limitations:
      'In strong bull runs, RSI can stay above 70 for weeks without dropping immediately.',
    advancedExplanation:
      'Wilder-smoothed bounded momentum oscillator; not to be confused with Relative Strength vs NEPSE.',
    relatedTerms: ['momentum', 'macd', 'relative-strength'],
  },
  {
    id: 'macd',
    term: 'MACD',
    fullName: 'Moving Average Convergence Divergence (12, 26, 9)',
    category: 'Indicators',
    simpleDefinition:
      'Measures the gap between a fast 12-day EMA and slower 26-day EMA to show when trend momentum is accelerating or fading.',
    nepaliExplanation:
      'Chhito (12 din) ra dhilo (26 din) EMA bich ko antar herera mulya ko teji badhdaixa ki ghatdaixa bhanne dekhaucha.',
    whyItMatters:
      'A rising positive MACD histogram confirms trend acceleration alongside price breakouts.',
    howCalculated:
      'MACD Line = EMA(12) - EMA(26); Signal Line = EMA(9) of MACD Line; Histogram = MACD Line - Signal Line.',
    formula: 'MACD Hist = (EMA12 - EMA26) - EMA9(EMA12 - EMA26)',
    interpretation:
      'MACD > Signal (positive Histogram) confirms bullish momentum alignment; negative MACD warns of momentum loss.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: EMA12 is NPR 512, EMA26 is NPR 502 => MACD = +10.0; Signal = +7.5 => Histogram = +2.5 (expanding bullish momentum).',
    tradingDecisionImpact:
      'Part of the 20% Momentum score.',
    commonMistakes:
      'Trading MACD crossovers blindly in choppy sideways markets where EMAs cross back and forth repeatedly.',
    limitations:
      'Lags sudden single-session breakouts because it uses 12- and 26-day averages.',
    advancedExplanation:
      'Band-pass momentum difference filter scaled in absolute NPR price units.',
    relatedTerms: ['ema', 'momentum', 'rsi'],
  },
  {
    id: 'atr',
    term: 'ATR',
    fullName: 'Average True Range (14-Period)',
    category: 'Indicators',
    simpleDefinition:
      'The average rupee movement (High to Low, including overnight gaps) a stock normally makes in a single trading day.',
    nepaliExplanation:
      'Ek din ma kunai share ausat ma kati rupaiya tala-mathi chalxa bhanne samanya ghatbadh ko maap.',
    whyItMatters:
      'Lets you place stop-losses beyond normal daily noise so you do not get shaken out by ordinary swings.',
    howCalculated:
      '14-day Wilder smoothed average of True Range = max(High-Low, |High-PrevClose|, |Low-PrevClose|). Also shown as ATR% = ATR/Close.',
    formula: 'ATR% = (ATR14 / Close) × 100',
    interpretation:
      'Higher ATR% means wider daily swings and calls for slightly wider stops with proportionally smaller share quantities.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Stock at NPR 500 with ATR14 = NPR 15 (3%) normally moves ±15/day; placing a stop 1.5× ATR (NPR 22.50 below entry) avoids normal noise.',
    tradingDecisionImpact:
      'Sets volatility-adjusted Initial Stop-Loss (`1.5 × ATR`), Trailing Stop (`2.0 × ATR`), and Target distances.',
    commonMistakes:
      'Using the same fixed 3% stop on both a calm commercial bank (ATR 1.4%) and a volatile hydropower stock (ATR 4.8%).',
    limitations:
      'ATR measures total movement size regardless of direction (up or down).',
    advancedExplanation:
      'Volatility normalization scale factor driving risk parity in position sizing.',
    relatedTerms: ['volatility', 'stop-loss', 'trailing-stop'],
  },
  {
    id: 'adx',
    term: 'ADX',
    fullName: 'Average Directional Index (14-Period)',
    category: 'Indicators',
    simpleDefinition:
      'Measures how strong a price trend is from 0 to 100 — regardless of whether the trend is going up or down.',
    nepaliExplanation:
      'Bazar wa share ma chalirakheko trend (mathi wa tala) kati baliyo xa bhanne maap.',
    whyItMatters:
      'Separates strong directional trends (ADX > 20–25) from directionless sideways drift (ADX < 15).',
    howCalculated:
      'Wilder 14-day smoothed ratio of positive (+DI) vs negative (-DI) directional movement.',
    interpretation:
      'ADX >= 25 with Close > SMA50 confirms strong trending conditions; ADX < 15 suggests a range-bound market.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: A hydropower stock in an uptrend with ADX rising from 18 to 29 shows strengthening directional trend commitment.',
    tradingDecisionImpact:
      'Contributes to the Trend Strength (20%) score.',
    commonMistakes:
      'Assuming a high ADX always means bullish — a crashing downtrend also produces a high ADX!',
    limitations:
      'Requires at least ~28–30 daily sessions to warm up cleanly.',
    advancedExplanation:
      'Normalized trend persistence ratio independent of sign; always pair with +DI / SMA slope.',
    relatedTerms: ['trend-strength', 'atr', 'sma'],
  },
  {
    id: 'relative-strength',
    term: 'Relative Strength',
    fullName: 'Relative Strength vs NEPSE Market Proxy',
    category: 'Indicators',
    simpleDefinition:
      'Compares how much a stock outperformed or underperformed the broader NEPSE market over the same period (distinct from RSI).',
    nepaliExplanation:
      'Purai NEPSE bazar ko tulana ma yo share kati ramro wa kamjor chalirakheko xa bhanne tulana.',
    whyItMatters:
      'Market leaders tend to hold firm when the index dips and lead upside advances when breadth improves.',
    howCalculated:
      'Stock 20-day % return minus NEPSE Equal-Weighted Proxy 20-day % return, ranked as a cross-sectional percentile (0–100) across all valid NEPSE stocks.',
    formula: 'RS Excess % = Stock_20d_Return% - NEPSE_Proxy_20d_Return%',
    interpretation:
      'RS Percentile >= 75 means the stock outperformed 75% of all liquid NEPSE stocks.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: If NEPSE drops -1.5% over 20 days while Stock DEF gains +6.5%, RS Excess = +8.0%.',
    tradingDecisionImpact:
      'Carries 15% of the composite technical score and powers the Relative Strength Rankings leaderboard.',
    commonMistakes:
      'Confusing Relative Strength (comparison against the index) with RSI (internal up/down days indicator).',
    limitations:
      'Short-window RS can spike briefly from one illiquid jump unless filtered by turnover.',
    advancedExplanation:
      'Cross-sectional momentum rank across the valid equity universe.',
    relatedTerms: ['can-slim', 'rsi', 'market-breadth'],
  },
  {
    id: 'relative-volume',
    term: 'Relative Volume',
    fullName: 'Relative Volume (RVOL vs 20-Day Average)',
    category: 'Indicators',
    simpleDefinition:
      'Shows whether today’s traded share volume is unusually quiet or unusually heavy compared to the stock’s own 20-day normal daily volume.',
    nepaliExplanation:
      'Aaja ko volume pachillo 20 din ko samanya volume bhanda kati guna dherai wa thorai xa bhanne anupat.',
    whyItMatters:
      'Authentic breakouts typically arrive with RVOL >= 1.5x; pullbacks work best when selling RVOL dries up below 0.9x.',
    howCalculated:
      'Today’s Volume divided by the average Volume of the immediately preceding 20 sessions.',
    formula: 'RVOL = Volume_today / Avg_Volume_prior_20_days',
    interpretation:
      '>= 1.5x confirms active institutional/crowd participation; < 0.7x indicates quiet consolidation or dry-up.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Average 20-day volume is 40,000 shares; today trades 84,000 shares => RVOL = 2.10x.',
    tradingDecisionImpact:
      'Mandatory confirmation check for Breakout setups and key component of Volume Strength (20%).',
    commonMistakes:
      'Treating 2.5x RVOL on a giant red reversal bar as bullish — heavy volume on down closes signals distribution!',
    limitations:
      'Excludes prior day’s own spike cleanly, yet bonus/IPO listing days can distort 20-day baselines briefly.',
    advancedExplanation:
      'Baseline-normalized liquidity surprise metric computed causally.',
    relatedTerms: ['accumulation', 'breakout', 'turnover'],
  },
  {
    id: 'market-breadth',
    term: 'Market Breadth',
    fullName: 'Market Breadth (% of Stocks Above Moving Averages)',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'Measures how many NEPSE stocks are actually participating in an uptrend (e.g., % trading above their 20-day or 50-day SMA) rather than just 2–3 heavyweights moving the index.',
    nepaliExplanation:
      'Kewal kehi thula share matra hoina, bazar ka kul madhye kati pratishat share badhdo disha ma xan bhanne sankhya.',
    whyItMatters:
      'Healthy bull markets lift a broad majority (>55%) of stocks; narrow rallies often fail silently.',
    howCalculated:
      'Percentage of valid liquid NEPSE stocks trading above SMA20, SMA50, and ShareSansar 120-day / 180-day MAs.',
    formula: 'Breadth % = (Count of Stocks with Close > SMA) / Total Valid Stocks × 100',
    interpretation:
      'Breadth > 55% supports Bullish exposure; breadth < 40% signals Bearish contraction and defensive cash protection.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: If 156 out of 240 valid stocks trade above their 20-day SMA, Market Breadth is 65.0% (broad Bullish strength).',
    tradingDecisionImpact:
      'Directly drives Market Regime classification and recommended portfolio exposure limits.',
    commonMistakes:
      'Thinking the market is strong just because 2 hydropower or bank heavyweights gained while 70% of stocks are falling.',
    limitations:
      'Breadth extremes can stay oversold briefly before turning.',
    advancedExplanation:
      'Cross-sectional diffusion index eliminating market-cap concentration bias.',
    relatedTerms: ['advance-decline-ratio', 'sma', 'maximum-exposure'],
  },
  {
    id: 'advance-decline-ratio',
    term: 'Advance/Decline Ratio',
    fullName: 'Daily Advancing vs Declining Issues Ratio',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'Compares the number of stocks that closed higher today against the number of stocks that closed lower today.',
    nepaliExplanation:
      'Aaja mulya badheka share ko sankhya ra mulya ghateka share ko sankhya bich ko anupat.',
    whyItMatters:
      'Gives an instant daily pulse of whether broad buying or broad selling dominated NEPSE.',
    howCalculated:
      'Advancers (Close > Prev Close) divided by Decliners (Close < Prev Close).',
    formula: 'A/D Ratio = Advancing Stocks / max(1, Declining Stocks)',
    interpretation:
      'A/D > 1.3 shows broad buying breadth; A/D < 0.75 shows broad market selling pressure.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: 144 stocks gain while 72 fall => A/D Ratio = 2.00 (2 advancers for every decliner).',
    tradingDecisionImpact:
      'Included in the Market Regime scoring model alongside breadth and turnover.',
    commonMistakes:
      'Judging a multi-week trend from a single day’s A/D ratio alone.',
    limitations:
      'Unchanged stocks are tracked separately and excluded from the numerator/denominator.',
    advancedExplanation:
      'Cross-sectional sign-count ratio measuring daily participation symmetry.',
    relatedTerms: ['market-breadth', 'volatility'],
  },
  {
    id: 'volatility',
    term: 'Volatility',
    fullName: 'Annualized & Daily Return Volatility',
    category: 'Statistics',
    simpleDefinition:
      'How widely and unpredictably prices swing up and down over time.',
    nepaliExplanation:
      'Share wa bazar ko mulya kati chhito ra dherai tala-mathi hallinxa bhanne sthirata ko maap.',
    whyItMatters:
      'High-volatility environments cause wider stop-outs and require smaller position sizes to keep rupee risk constant.',
    howCalculated:
      'Standard deviation of daily percentage returns over the trailing 20 sessions (and annualized by √250 trading days), plus stock ATR%.',
    formula: 'Annualized Vol = StdDev(Daily Returns) × √250',
    interpretation:
      'Calm upward trends show moderate volatility; spiking volatility (>30% annualized) signals fear or unstable whipsaws.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Market daily return std dev of 1.8% equals ~28.5% annualized volatility — elevated risk.',
    tradingDecisionImpact:
      'Adjusts Market Regime scores, stop-loss widths (ATR), and position share counts.',
    commonMistakes:
      'Equating volatility directly with permanent loss — tight upward trends have low downside volatility.',
    limitations:
      'Standard deviation treats big upside gains the same as big downside drops (unlike Sortino ratio).',
    advancedExplanation:
      'Second central moment of the empirical daily log/simple return distribution.',
    relatedTerms: ['atr', 'sortino-ratio', 'drawdown'],
  },
  {
    id: 'drawdown',
    term: 'Drawdown',
    fullName: 'Peak-to-Trough Portfolio or Index Decline',
    category: 'Risk Management',
    simpleDefinition:
      'How far an index, stock, or account balance has fallen below its highest previous peak.',
    nepaliExplanation:
      'Kunai share wa kul lagani ko mulya aafno sabse mathillo bindu (peak) bata kati pratishat tala jhareko xa bhanne ghatti.',
    whyItMatters:
      'Losses hurt asymmetrically: a 50% drawdown requires a +100% gain just to get back to even.',
    howCalculated:
      'Current value minus highest running peak divided by that running peak.',
    formula: 'Drawdown % = ((Current - Peak) / Peak) × 100',
    interpretation:
      'Keeping portfolio drawdowns shallow (<10%–15%) through strict stop-losses and regime exposure caps preserves compounding.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: If a portfolio peaks at NPR 550,000 and drops to NPR 495,000, current drawdown is -10.0%.',
    tradingDecisionImpact:
      'Tracked both on the NEPSE Regime Index and across the Backtest equity curve.',
    commonMistakes:
      'Averaging down aggressively on deep -30% losers, deepening drawdown exponentially.',
    limitations:
      'Only captures drop from peak; does not specify recovery duration.',
    advancedExplanation:
      'Running pathwise shortfall relative to the high-water mark.',
    relatedTerms: ['maximum-drawdown', 'stop-loss', 'risk-capital'],
  },

  // ------------------------------------------------------------------ Quantitative & Statistics
  {
    id: 'expectancy',
    term: 'Expectancy',
    fullName: 'Mathematical Expectancy per Trade',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'The average percentage (or R-multiple) a trading strategy earns or loses per trade over many repetitions after all fees, taxes, and slippage.',
    nepaliExplanation:
      'Dherai patak tyahi niyam anusar trade garda pratyek trade bata ausat ma kati naafa wa noksaan hunxa bhanne hisab (fee ra tax katayera).',
    whyItMatters:
      'Win rate alone is meaningless without knowing how big wins are compared to losses. Expectancy combines both into one bottom-line truth.',
    howCalculated:
      '(Win Rate × Average Win %) − ((1 − Win Rate) × |Average Loss %|), computed strictly NET of NEPSE costs.',
    formula: 'Expectancy = (Win% × AvgWin) - (Loss% × |AvgLoss|)',
    interpretation:
      'Positive net expectancy (> +0.35% net or > +0.10R per trade) indicates a genuine statistical edge; negative expectancy loses capital over time even with a high win rate.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: 45% Win Rate with +8% Avg Win and -4% Avg Loss => (0.45 × 8) - (0.55 × 4) = 3.6 - 2.2 = +1.40% positive expectancy.',
    tradingDecisionImpact:
      'Primary statistical validation gate: setups with <= 0 net expectancy are NEVER classified as BUY CANDIDATE.',
    commonMistakes:
      'Chasing a 75% win rate system whose tiny +1.5% wins get wiped out by rare -10% losses (negative expectancy).',
    limitations:
      'Sensitive to small sample sizes and extreme outlier winners; verify median/Profit Factor too.',
    advancedExplanation:
      'Empirical first moment of net trade returns; directly governs long-run geometric wealth growth.',
    relatedTerms: ['win-rate', 'profit-factor', 'sample-size'],
  },
  {
    id: 'win-rate',
    term: 'Win Rate',
    fullName: 'Historical Win Rate (%)',
    category: 'Statistics',
    simpleDefinition:
      'The percentage of completed historical trades in a setup cohort that ended with a net profit after fees and taxes.',
    nepaliExplanation:
      'Atit ma garieka kul trade haru madhye kati pratishat trade naafa ma banda bhaye bhanne ank.',
    whyItMatters:
      'Helps set realistic emotional expectations — knowing a 45%–55% trend system naturally has losing streaks stops you from abandoning rules prematurely.',
    howCalculated:
      'Number of net-profitable simulated trades divided by total trades tested, shown with a 95% Wilson Confidence Interval.',
    formula: 'Win Rate % = (Winning Trades / Total Trades) × 100',
    interpretation:
      'Must always be read alongside Average Win, Average Loss, Sample Size, and 95% CI — never as a guaranteed future prediction.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: 18 wins out of 32 simulated trades = 56.3% historical win rate (95% CI: 39.3% to 71.8%).',
    tradingDecisionImpact:
      'Displayed explicitly with confidence bands so users understand uncertainty.',
    commonMistakes:
      'Assuming a 65% historical win rate guarantees a 65% chance tomorrow, or preferring high win rate over positive Expectancy.',
    limitations:
      'Ignores trade magnitude completely.',
    advancedExplanation:
      'Binomial proportion MLE accompanied by finite-sample Wilson score bounds.',
    relatedTerms: ['expectancy', 'confidence-interval', 'probability'],
  },
  {
    id: 'average-win',
    term: 'Average Win',
    fullName: 'Average Winning Return (Gross & Net)',
    category: 'Statistics',
    simpleDefinition:
      'The mean percentage gain across all profitable trades in a strategy’s test history.',
    nepaliExplanation:
      'Naafa bhayeka trade haru le ausat ma kati pratishat kamai gare bhanne ank.',
    whyItMatters:
      'Strong trend systems make their money from Average Win being significantly larger than Average Loss.',
    howCalculated:
      'Sum of net returns across all winning trades divided by the count of winning trades.',
    formula: 'Avg Win = Sum(Winning Net Returns) / Win Count',
    interpretation:
      'Compare Avg Win / |Avg Loss| (Payoff Ratio); ratios >= 1.5 provide strong margin of safety.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Five winning trades earn +6%, +11%, +8%, +5%, +10% => Average Win = +8.0%.',
    tradingDecisionImpact:
      'Feeds Expectancy and Profit Factor calculations.',
    commonMistakes:
      'Cutting winners too early at +2% out of fear, starving the system of the big winners needed to cover losses.',
    limitations:
      'A single massive outlier winner in a tiny sample can artificially inflate Average Win.',
    advancedExplanation:
      'Conditional expectation E[R | R > 0].',
    relatedTerms: ['average-loss', 'expectancy', 'profit-factor'],
  },
  {
    id: 'average-loss',
    term: 'Average Loss',
    fullName: 'Average Losing Return (Gross & Net)',
    category: 'Statistics',
    simpleDefinition:
      'The mean percentage loss across all losing trades when stops are respected.',
    nepaliExplanation:
      'Noksaan bhayeka trade haru ma stop-loss lagayepachi ausat ma kati pratishat ghatti bhayo bhanne ank.',
    whyItMatters:
      'Controlling Average Loss through disciplined stop-losses is the single variable most directly under a trader’s control.',
    howCalculated:
      'Mean net return across all trades that closed <= 0% net after NEPSE fees and slippage.',
    formula: 'Avg Loss = Sum(Losing Net Returns) / Loss Count',
    interpretation:
      'Should stay tightly bounded near your planned initial stop risk (e.g., -3% to -6% rather than -20% uncontrolled crashes).',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Losing trades exit at -3.5%, -4.2%, -4.8% => Average Loss = -4.17%.',
    tradingDecisionImpact:
      'Evaluated in Expectancy and validates whether stop-loss rules prevent catastrophic tail losses.',
    commonMistakes:
      'Widening or deleting a stop-loss on a loser, turning a controlled -4% loss into a -28% portfolio scar.',
    limitations:
      'Overnight gap downs or ±10% lower-circuit locks can occasionally make real exit losses slightly worse than the exact stop price.',
    advancedExplanation:
      'Conditional expectation E[R | R <= 0] incorporating transaction cost drag.',
    relatedTerms: ['average-win', 'stop-loss', 'slippage'],
  },
  {
    id: 'profit-factor',
    term: 'Profit Factor',
    fullName: 'Gross Wins Divided by Gross Losses (Net of Costs)',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'How many rupees a strategy won for every 1 rupee it lost across all historical trades.',
    nepaliExplanation:
      'Kul noksaan bhayeko 1 rupaiya ko tulana ma strategy le kul kati rupaiya naafa kamayo bhanne anupat.',
    whyItMatters:
      'Summarizes total edge cleanly: < 1.0 loses money, 1.0–1.2 is marginal, >= 1.35+ shows healthy net cushion.',
    howCalculated:
      'Total net % gains summed across all winning trades divided by total absolute net % losses across all losing trades.',
    formula: 'Profit Factor = Sum(Winning Net Returns) / |Sum(Losing Net Returns)|',
    interpretation:
      'Requires at least 1.15–1.3+ out-of-sample with adequate sample size to trust after real-world friction.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Total gains across winners = +84%, total losses across losers = -42% => Profit Factor = 2.00.',
    tradingDecisionImpact:
      'Used alongside Net Expectancy and Sample Size to mark setups Statistically Validated.',
    commonMistakes:
      'Getting excited by a Profit Factor of 5.0 computed from only 3 trades.',
    limitations:
      'Unbounded when zero losing trades occurred in a tiny sample (handled carefully by Sample Size thresholds).',
    advancedExplanation:
      'Gain-to-pain ratio per unit of realized downside.',
    relatedTerms: ['expectancy', 'sample-size', 'sortino-ratio'],
  },
  {
    id: 'sharpe-ratio',
    term: 'Sharpe Ratio',
    fullName: 'Risk-Adjusted Return per Unit of Total Volatility',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'Measures how much return a strategy delivered relative to how bumpy (volatile) the ride was.',
    nepaliExplanation:
      'Strategy le liyeako jhokhim (utarchadhav) ko tulana ma kati ramro pratiphal diyo bhanne maap.',
    whyItMatters:
      'Helps compare two strategies fairly — a smoother steady return scores higher than a wild roller-coaster with the same ending return.',
    howCalculated:
      'Mean net trade return divided by the standard deviation of net trade returns, scaled to annualized trade frequency.',
    formula: 'Sharpe ≈ (Mean Net Return / StdDev Net Return) × √(Trades/Year)',
    interpretation:
      'Higher is better (> 1.0 healthy, > 1.5 strong); negative Sharpe indicates losing net expectancy.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Mean net trade return +1.2% with std dev 4.0% across ~16 trades/yr => ~1.20 annualized trade Sharpe.',
    tradingDecisionImpact:
      'Displayed on every setup summary and backtest comparison table.',
    commonMistakes:
      'Relying on Sharpe from < 10 trades or forgetting it penalizes big upside wins just as much as losses.',
    limitations:
      'Assumes return symmetry; trend strategies with large positive skewness look better under Sortino.',
    advancedExplanation:
      'Signal-to-noise ratio of excess return per unit of total dispersion.',
    relatedTerms: ['sortino-ratio', 'volatility', 'expectancy'],
  },
  {
    id: 'sortino-ratio',
    term: 'Sortino Ratio',
    fullName: 'Downside-Risk-Adjusted Return Ratio',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'Similar to Sharpe Ratio, except it ONLY penalizes harmful downside volatility while ignoring big upside winning swings.',
    nepaliExplanation:
      'Sharpe jastai tara yo le ghatne noksaan ko jhokhim lai matra danda dinxa, thulo naafa badhda hoina.',
    whyItMatters:
      'Breakout and VCP strategies naturally produce occasional big +15% winners; Sortino judges them fairly on downside pain.',
    howCalculated:
      'Mean net trade return divided by Downside Deviation (standard deviation calculated only over negative trade returns below 0%).',
    formula: 'Sortino ≈ (Mean Net Return / Downside Deviation) × √(Trades/Year)',
    interpretation:
      'Sortino significantly higher than Sharpe signals healthy positive asymmetry (controlled stops + strong winners).',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Small -4% stops keep downside deviation at 2.4%, while big winners lift mean return to +1.4%, yielding Sortino ~2.3.',
    tradingDecisionImpact:
      'Complements Sharpe on all backtest and strategy reliability scorecards.',
    commonMistakes:
      'Interpreting an inflated Sortino when only 1–2 small losses occurred in a very short window.',
    limitations:
      'Needs sufficient losing trades to estimate downside deviation reliably.',
    advancedExplanation:
      'Return per unit of semi-deviation below Minimum Acceptable Return (MAR = 0%).',
    relatedTerms: ['sharpe-ratio', 'drawdown', 'average-loss'],
  },
  {
    id: 'maximum-drawdown',
    term: 'Maximum Drawdown',
    fullName: 'Worst Historical Peak-to-Trough Equity Drop (%)',
    category: 'Risk Management',
    simpleDefinition:
      'The single worst percentage drop from any equity peak to the subsequent lowest point experienced during a backtest.',
    nepaliExplanation:
      'Test garieko sabai samaya ma khata aafno sabse mathillo bindu bata sabse dherai kati pratishat tala jhareko thiyo bhanne ank.',
    whyItMatters:
      'Tells you the worst pain a strategy actually suffered historically so you know whether you can stay disciplined during inevitable losing streaks.',
    howCalculated:
      'Max of `(Peak_Equity - Equity_t) / Peak_Equity × 100` across the simulated equity curve.',
    interpretation:
      'Strategies with lower Max Drawdown are easier to execute without panic-quitting.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Strategy equity grew from NPR 500k to 580k, dropped to 533.6k during a losing streak, then hit 610k => Max Drawdown = -8.0%.',
    tradingDecisionImpact:
      'Surfaced in Backtesting & Model Reliability to guard against fragile high-drawdown rules.',
    commonMistakes:
      'Ignoring Max Drawdown in short 3-month backtests — future bear markets can exceed past drawdowns.',
    limitations:
      'Path-dependent metric sensitive to start/end dates and sizing assumptions.',
    advancedExplanation:
      'Global supremum of historical underwater equity depth.',
    relatedTerms: ['drawdown', 'risk-capital', 'maximum-exposure'],
  },
  {
    id: 'sample-size',
    term: 'Sample Size',
    fullName: 'Number of Independent Simulated Trades (N)',
    category: 'Statistics',
    simpleDefinition:
      'How many historical setup occurrences actually happened and were tested.',
    nepaliExplanation:
      'Kunai strategy kati patak ghatyo ra test gariyo bhanne kul trade ko sankhya (N).',
    whyItMatters:
      'Three lucky trades prove nothing; larger sample sizes reduce the chance that positive results came from luck.',
    howCalculated:
      'Count of closed historical simulated trades matching the setup criteria within the available CSV window.',
    interpretation:
      'N < 8 is flagged Insufficient Sample; N >= 30+ across multiple regimes provides stronger statistical confidence.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: A setup winning 4 of 4 times (100% win rate, N=4) is too small to trust compared to 19 of 34 wins (55.9%, N=34).',
    tradingDecisionImpact:
      'Setups failing minimum sample size are blocked from "Statistically Validated" status.',
    commonMistakes:
      'Trusting a 90% win rate built from only 5 or 6 trades.',
    limitations:
      'With ~95 daily sessions loaded in local CSVs, rare setups may show modest sample sizes.',
    advancedExplanation:
      'Governs standard error shrinkage (`1 / √N`) and Wilson interval width.',
    relatedTerms: ['confidence-interval', 'statistical-significance', 'overfitting'],
  },
  {
    id: 'confidence-interval',
    term: 'Confidence Interval',
    fullName: '95% Statistical Confidence Interval (Wilson Score)',
    category: 'Statistics',
    simpleDefinition:
      'An honest range around a historical win rate showing where the true underlying rate likely sits given the sample size.',
    nepaliExplanation:
      'Thulo sankhya na-huda win rate ekdam thik ank hoina, tyo kati dekhi kati pratishat ko dayara bhitra huna sakxa bhanne andaj.',
    whyItMatters:
      'Prevents false precision — small samples have very wide intervals, reminding you of real uncertainty.',
    howCalculated:
      '95% Wilson score binomial interval computed from Wins and Sample Size N.',
    interpretation:
      'Wide bands (e.g., 30%–75%) warn that the true win rate is still uncertain; narrower bands come from larger samples.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: 12 wins in 20 trades gives 60.0% win rate, with a 95% confidence interval spanning 38.7% to 78.1%.',
    tradingDecisionImpact:
      'Shown directly beside every win rate across the engine.',
    commonMistakes:
      'Focusing solely on the 60% midpoint while ignoring that the lower bound is 38.7%.',
    limitations:
      'Assumes independent trade outcomes; correlated market-wide rallies shrink effective sample size.',
    advancedExplanation:
      'Asymmetric exact-ish score interval reliable even for small N or extreme proportions.',
    relatedTerms: ['sample-size', 'win-rate', 'statistical-significance'],
  },
  {
    id: 'probability',
    term: 'Probability',
    fullName: 'Estimated Probability vs Historical Frequency',
    category: 'Statistics',
    simpleDefinition:
      'Likelihood of an outcome expressed from 0% to 100%; in financial markets, true future probability is never known with certainty.',
    nepaliExplanation:
      'Bhavisya ma kunai ghatana hune sambhavana; share bazar ma purano ank bata andaj matra garna sakinxa, pakka bhanna sakidaina.',
    whyItMatters:
      'Forces disciplined risk sizing because even a 70% probable setup still fails 30% of the time.',
    howCalculated:
      'This engine NEVER markets historical frequency as guaranteed future probability; it presents historical win rates + CIs + model labels separately.',
    interpretation:
      'Think in distributions over 20–50 trades, not single-trade certainty.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Even with a historical 58% win rate, losing 4 trades in a row happens ~3.1% of the time naturally.',
    tradingDecisionImpact:
      'Justifies risking only 1%–2% per trade no matter how attractive one chart appears.',
    commonMistakes:
      'Betting 50% of capital on one stock because its past pattern won 60% of the time.',
    limitations:
      'Non-stationary markets shift probabilities whenever interest rates, liquidity, or regulations change.',
    advancedExplanation:
      'Non-ergodic regime-switching return dynamics forbid naive IID probability guarantees.',
    relatedTerms: ['win-rate', 'confidence-interval', 'expectancy'],
  },
  {
    id: 'statistical-significance',
    term: 'Statistical Significance',
    fullName: 'Evidence Against Pure Random Chance',
    category: 'Statistics',
    simpleDefinition:
      'Confidence that a strategy’s net profits came from a genuine recurring pattern rather than a lucky coin-flip streak.',
    nepaliExplanation:
      'Strategy ko naafa sanjog matra nabhayera sacho karan le bhayeko ho bhanne ganitiya praman.',
    whyItMatters:
      'Stops you from risking real money on random backtest noise.',
    howCalculated:
      'Assessed jointly via minimum Sample Size, positive Out-of-Sample Expectancy, Profit Factor > 1.15, and Walk-Forward fold consistency.',
    interpretation:
      'A setup is marked "Statistically Validated" only when sample size, net expectancy, profit factor, and OOS checks align.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: N=42 trades, +1.15% net expectancy, PF 1.52, and positive out-of-sample expectancy passes validation.',
    tradingDecisionImpact:
      'Required gate before any setup can earn BUY CANDIDATE or STRONG BUY CANDIDATE.',
    commonMistakes:
      'Testing 200 parameter combinations until one accidentally looks profitable (data mining bias).',
    limitations:
      'Short historical histories limit statistical power on rare strategies.',
    advancedExplanation:
      'Guards against Type-I false discovery under finite-horizon NEPSE data.',
    relatedTerms: ['sample-size', 'out-of-sample-testing', 'overfitting'],
  },
  {
    id: 'out-of-sample-testing',
    term: 'Out-of-Sample Testing',
    fullName: 'Hold-Out Testing on Unseen Future Dates',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'Evaluating strategy statistics on a later block of dates that were kept completely separate from the earlier training/inspection window.',
    nepaliExplanation:
      'Purano samaya ma heriyeko niyam lai pachillo naya samaya ko data ma parikshan garne tarika.',
    whyItMatters:
      'Proves whether a strategy holds up when applied forward instead of only fitting past charts.',
    howCalculated:
      'Splits chronological simulation signals into In-Sample (first 60% by default) and Out-of-Sample (most recent 40%) and compares net expectancy and profit factor.',
    interpretation:
      'If In-Sample looks great (+2.0%) while Out-of-Sample turns negative (-0.8%), overfitting risk is flagged High.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: July–Sept (In-Sample) expectancy +1.1%, Oct–Nov (Out-of-Sample) expectancy +0.9% => stable edge.',
    tradingDecisionImpact:
      'Displayed side-by-side in Backtesting & Model Reliability and factored into Overfitting Risk rating.',
    commonMistakes:
      'Tweaking parameters repeatedly after peaking at Out-of-Sample results (turning OOS into In-Sample).',
    limitations:
      'Market regimes can differ between split halves (e.g., Bullish first half vs Bearish second half).',
    advancedExplanation:
      'Chronological holdout validation enforcing strict temporal causality.',
    relatedTerms: ['walk-forward-validation', 'overfitting', 'look-ahead-bias'],
  },
  {
    id: 'walk-forward-validation',
    term: 'Walk-Forward Validation',
    fullName: 'Rolling Chronological Train/Test Folds',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'Repeating out-of-sample tests across multiple rolling time windows in sequence to verify consistency across changing market conditions.',
    nepaliExplanation:
      'Ek patak matra hoina, samaya agadi badhdai jada kramasha dherai khanda haru ma strategy check garne paddhati.',
    whyItMatters:
      'Shows if performance stayed steady across several months rather than relying on one single lucky rally.',
    howCalculated:
      'Divides sorted trading history into consecutive expanding train / test folds and evaluates trades strictly inside each test window.',
    interpretation:
      'Consistent positive expectancy across most folds signals higher robustness than one giant fold carrying everything.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Fold 1 (+0.8%), Fold 2 (+1.1%), Fold 3 (+0.6%) shows steady resilience across 3 sequential windows.',
    tradingDecisionImpact:
      'Shown in the Walk-Forward Folds table inside the Backtest & Reliability tab.',
    commonMistakes:
      'Using randomized K-fold cross-validation on time series, which leaks future bars into training.',
    limitations:
      'Fewer folds are possible when total dataset length is ~95 sessions.',
    advancedExplanation:
      'Anchored/rolling chronological evaluation preserving time-ordering.',
    relatedTerms: ['out-of-sample-testing', 'overfitting', 'look-ahead-bias'],
  },
  {
    id: 'overfitting',
    term: 'Overfitting',
    fullName: 'Curve-Fitting Noise in Historical Data',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'Adding too many hyper-specific rules just to make a past backtest look amazing — which then collapses in live trading.',
    nepaliExplanation:
      'Purano chart ma ramro dekhauna dherai jatil sart haru thapera naya bazar ma kaam nagarne banaunu.',
    whyItMatters:
      'Overfitted strategies look unbeatable on paper and lose money immediately afterward.',
    howCalculated:
      'Monitored by comparing In-Sample vs Out-of-Sample expectancy degradation and enforcing minimum Sample Size requirements.',
    interpretation:
      'Simpler, economically logical rules (trend + base + volume + stop) generalize far better than 10-indicator magic numbers.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Requiring "RSI between 57.3 and 59.8 on Tuesdays" gets 100% backtest wins on 4 trades but fails completely next month.',
    tradingDecisionImpact:
      'Overfitting Risk indicator warns High whenever OOS performance collapses or sample size is too tiny.',
    commonMistakes:
      'Optimizing sliders endlessly until Backtest Profit Factor peaks, then assuming live results will match.',
    limitations:
      'Cannot be detected by looking at total backtest return alone.',
    advancedExplanation:
      'Excess generalization error stemming from excessive effective degrees of freedom relative to sample size.',
    relatedTerms: ['out-of-sample-testing', 'walk-forward-validation', 'sample-size'],
  },
  {
    id: 'survivorship-bias',
    term: 'Survivorship Bias',
    fullName: 'Distortion From Ignoring Delisted or Inactive Stocks',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'Testing only stocks that still actively survive today while ignoring failed, merged, or delisted companies from earlier dates.',
    nepaliExplanation:
      'Aaja tikirakheka ramra company matra herera atit ma dubeka wa hataiyeka company haru birsanu.',
    whyItMatters:
      'Hides real historical losers and artificially inflates backtest returns.',
    howCalculated:
      'Prevented here by scanning every symbol actually present on each historical date’s raw CSV (`data/YYYY-MM-DD.csv`) rather than filtering by today’s symbol list.',
    interpretation:
      'Merged/suspended symbols present on earlier CSVs still participate up to their last valid session.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: If a company stopped trading in September after a slump, including its July–August trades prevents hiding those losses.',
    tradingDecisionImpact:
      'Explicitly preserved in backtest trade logs and documented in Methodology Safeguards.',
    commonMistakes:
      'Fetching today’s index constituents and running a 5-year test backwards on only those survivors.',
    limitations:
      'Still bounded by whatever dates exist in the user’s local `/data` CSV archive.',
    advancedExplanation:
      'Eliminates point-in-time universe selection conditioning.',
    relatedTerms: ['look-ahead-bias', 'out-of-sample-testing'],
  },
  {
    id: 'look-ahead-bias',
    term: 'Look-Ahead Bias',
    fullName: 'Accidental Use of Future Information in Past Decisions',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'A subtle backtesting bug where a rule accidentally peeks at tomorrow’s price, future highs/lows, or future splits when pretending to decide today.',
    nepaliExplanation:
      'Aaja ko nirnaya garna bholi ko price wa bhavisya ko jankari jhukkiyera prayog hunu (galat backtest).',
    whyItMatters:
      'Creates fake "crystal ball" backtests that are impossible to replicate in real life.',
    howCalculated:
      'Prevented strictly: indicators on date `t` inspect ONLY `bars[0..t]`; corporate-action jumps are quarantined without retroactively rewriting prior dates; entries fill at `t+1` open/price.',
    interpretation:
      'Every signal on date `t` executes on date `t+1`, never at yesterday’s or today’s already-closed hindsight.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Signal fires after market close on Monday -> Backtest enters on Tuesday’s open + slippage, never Monday’s intraday low.',
    tradingDecisionImpact:
      'Core architectural invariant across `server/quantEngine.ts`.',
    commonMistakes:
      'Normalizing prices across an entire dataset using the future maximum price, or entering at the same closing price that generated the signal without noting execution timing.',
    limitations:
      'Intraday tick sequences between Open, High, Low, Close within bar `t+k` use conservative stop-first ordering if both stop and target lie inside one daily bar.',
    advancedExplanation:
      'Enforces strict filtration measurability at decision time `t`.',
    relatedTerms: ['survivorship-bias', 'slippage', 'out-of-sample-testing'],
  },
  {
    id: 'slippage',
    term: 'Slippage',
    fullName: 'Execution Price Gap vs Reference Quote',
    category: 'Quantitative Analysis',
    simpleDefinition:
      'The unfavorable price difference between the price you expected when placing an order and the actual fill price in the order book.',
    nepaliExplanation:
      'Socheko mulya bhanda market ma ali mahango ma kinnu wa ali sasto ma bechnu parne farak.',
    whyItMatters:
      'Thin NEPSE order books and ±10% circuit swings mean real fills are often 0.25%–0.5%+ worse than closing prices.',
    howCalculated:
      'Entry fill = Base Price × (1 + slippage%); Exit fill = Base Price × (1 − slippage%). Default configurable 0.35% per side.',
    formula: 'Buy Fill = Price × (1 + Slippage%) | Sell Fill = Price × (1 - Slippage%)',
    interpretation:
      'Strategies that survive realistic slippage assumptions have genuine durability.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: At NPR 500 quote with 0.35% slippage, simulated entry pays NPR 501.75 and simulated stop exit receives slightly below stop price.',
    tradingDecisionImpact:
      'Applied on both entry and exit in Backtests and Position Sizing Net R:R.',
    commonMistakes:
      'Running 0% slippage backtests on mid/small-cap NEPSE stocks.',
    limitations:
      'During sudden ±10% lower-circuit freezes, actual slippage can exceed 0.35% until buyers return.',
    advancedExplanation:
      'Models order-book impact and bid-ask spread crossing.',
    relatedTerms: ['transaction-costs', 'liquidity', 'expectancy'],
  },

  // ------------------------------------------------------------------ Risk & Portfolio Management
  {
    id: 'risk-capital',
    term: 'Risk Capital',
    fullName: 'Maximum Acceptable Rupee Loss on One Trade',
    category: 'Risk Management',
    simpleDefinition:
      'The fixed rupee amount (usually 1%–2% of your portfolio) you agree to lose if a trade hits its stop-loss.',
    nepaliExplanation:
      'Euta trade galat bhaye ma tapai le sahana sakne kul rupaiya noksaan ko sima (kul punji ko 1%–2%).',
    whyItMatters:
      'Capping loss per trade at 1.5% means even 8 losing trades in a row only reduce your account by ~11.5%, keeping you in the game.',
    howCalculated:
      'Total Portfolio Value multiplied by Risk Percentage Per Trade.',
    formula: 'Risk Capital = Portfolio Value × Risk %',
    interpretation:
      'Risk Capital is NOT the total rupee amount you invest in the stock — it is only the loss from Entry down to Stop-Loss.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Portfolio = NPR 500,000 and Risk % = 1.5% => Risk Capital = NPR 7,500 maximum planned loss.',
    tradingDecisionImpact:
      'First step in the exact Position Sizing engine formula.',
    commonMistakes:
      'Confusing Risk Capital (NPR 7,500) with Investment Amount (e.g., NPR 100,000 worth of shares).',
    limitations:
      'Gaps past stop-loss or trading fees slightly increase actual realized loss beyond raw stop distance.',
    advancedExplanation:
      'Fixed-fractional equity risk budget per independent bet.',
    relatedTerms: ['position-sizing', 'stop-loss', 'portfolio-risk'],
  },
  {
    id: 'position-sizing',
    term: 'Position Sizing',
    fullName: 'Risk-Based Share Quantity Calculation',
    category: 'Risk Management',
    simpleDefinition:
      'Calculating the exact number of shares to buy so that if your stop-loss is hit, your rupee loss equals your planned Risk Capital.',
    nepaliExplanation:
      'Stop-loss hit huda pani socheko bhanda dherai noksaan na-hos bhanera thik kati kitta share kinne bhanne hisab.',
    whyItMatters:
      'Automatically makes you buy fewer shares of risky/wide-stop stocks and prevents one bad stock from sinking your portfolio.',
    howCalculated:
      'Position Quantity = Risk Capital ÷ (Entry Price − Stop-Loss Price), then capped by Single-Stock Max %, Sector Max %, Available Cash, and 5% Daily Volume liquidity limit.',
    formula: 'Qty = floor(Risk Capital / (Entry - Stop-Loss))',
    interpretation:
      'Never size every trade with a fixed rupee amount regardless of stop distance — risk-adjusted sizing equalizes risk across all trades.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Risk Capital NPR 7,500, Entry NPR 500, Stop NPR 475 (Risk/share = NPR 25) => 7,500 ÷ 25 = 300 shares (Investment = NPR 150,000).',
    tradingDecisionImpact:
      'Automatically computed for every candidate and editable in the Position Sizing Calculator.',
    commonMistakes:
      'Dividing portfolio equally by 5 without checking stop-loss distance or market liquidity.',
    limitations:
      'Whole-share or optional 10-kitta rounding slightly adjusts exact exposure on high-priced stocks.',
    advancedExplanation:
      'Volatility-parity share scaling constrained by concentration and liquidity bounds.',
    relatedTerms: ['risk-capital', 'stop-loss', 'maximum-exposure'],
  },
  {
    id: 'stop-loss',
    term: 'Stop-Loss',
    fullName: 'Predefined Protective Exit Price',
    category: 'Risk Management',
    simpleDefinition:
      'A pre-planned price below your entry where you immediately exit a losing trade to protect your remaining capital.',
    nepaliExplanation:
      'Mulya socheko bhanda tala jharema thulo noksaan bata bachna pahile nai tokiyeako bechne mulya.',
    whyItMatters:
      'Small losses are recoverable; big unchecked losses destroy portfolios.',
    howCalculated:
      'Placed below technical support / invalidation level or `Entry − 1.5 × ATR14`, whichever respects disciplined structural invalidation.',
    interpretation:
      'Policy: NEVER widen a stop-loss downward on a losing position. You may only move stops upward to protect profits.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Buy at NPR 600 with Initial Stop-Loss at NPR 576 (-4%). If price closes or breaks NPR 576, exit without hesitation.',
    tradingDecisionImpact:
      'Mandatory output for every candidate and enforced inside Paper Trade Journal tracking.',
    commonMistakes:
      'Moving a stop lower ("just giving it a little more room") until a -4% mistake becomes -30%.',
    limitations:
      'In NEPSE, sudden bad news causing a -10% lower-circuit lock can delay execution until selling liquidity clears.',
    advancedExplanation:
      'Truncates the left tail of the trade return distribution.',
    relatedTerms: ['trailing-stop', 'invalidation-level', 'risk-capital'],
  },
  {
    id: 'trailing-stop',
    term: 'Trailing Stop',
    fullName: 'Dynamic Profit-Protecting Stop Level',
    category: 'Risk Management',
    simpleDefinition:
      'A stop-loss that moves upward step-by-step as a winning stock climbs, locking in gains while never moving back down.',
    nepaliExplanation:
      'Naafa badhdai jada sathai mathi sardai jane suraksha stop, jasle bhayeko naafa bachauxa.',
    whyItMatters:
      'Lets strong winners keep running without giving back all hard-earned paper profits when the trend finally ends.',
    howCalculated:
      'Calculated using `max(Prior Trailing Stop, Close − 2.0 × ATR14)` or moving up to breakeven after Target 1 is hit.',
    interpretation:
      'Once Target 1 (1.5R) is reached, moving stop to breakeven removes initial downside risk on the remaining half.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Entered at 500 (Stop 475). Stock reaches 560; trailing stop rises to 528, guaranteeing at least +28/share profit.',
    tradingDecisionImpact:
      'Integrated into Exit Management Plans and backtest partial-profit logic.',
    commonMistakes:
      'Setting the trailing stop too tight right after entry so normal daily fluctuations knock you out early.',
    limitations:
      'Wide gaps can trigger exits slightly below the trailing mark.',
    advancedExplanation:
      'Monotonic non-decreasing ratchet exit rule.',
    relatedTerms: ['stop-loss', 'atr', 'risk-reward-ratio'],
  },
  {
    id: 'risk-reward-ratio',
    term: 'Risk/Reward Ratio',
    fullName: 'Potential Net Reward vs Initial Net Risk (R:R)',
    category: 'Risk Management',
    simpleDefinition:
      'Compares how many rupees you stand to make at your Target against how many rupees you risk losing at your Stop-Loss.',
    nepaliExplanation:
      '1 rupaiya jhokhim uthaunda kati rupaiya naafa hune sambhavana xa bhanne anupat.',
    whyItMatters:
      'With a 1:2.5 net Risk/Reward, you can be wrong over half the time and still grow capital steadily.',
    howCalculated:
      'Net Expected Profit at Target (after fees/CGT/slippage) divided by Net Loss at Stop-Loss.',
    formula: 'Net R:R = Net Profit at Target / Net Loss at Stop',
    interpretation:
      'Aim for at least 1:1.5 at Target 1 and 1:2.5+ at Target 2; trades with < 1:1.1 R:R rarely justify costs.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Risking NPR 7,500 at stop for a net Target 2 gain of NPR 22,500 equals 1 : 3.00 R:R.',
    tradingDecisionImpact:
      'Required check before any setup can qualify as STRONG BUY CANDIDATE.',
    commonMistakes:
      'Inventing an unrealistic sky-high target just to make the R:R ratio look good on paper.',
    limitations:
      'R:R only measures payoff if hit; always evaluate it alongside Win Rate via Expectancy.',
    advancedExplanation:
      'Defines the minimum break-even win rate `1 / (1 + R:R)`.',
    relatedTerms: ['expectancy', 'stop-loss', 'position-sizing'],
  },
  {
    id: 'entry-zone',
    term: 'Entry Zone',
    fullName: 'Acceptable Price Window for Execution',
    category: 'Trading Strategies',
    simpleDefinition:
      'The narrow rupee range near a breakout pivot or pullback support where buying keeps your stop-loss distance and Risk/Reward favorable.',
    nepaliExplanation:
      'Surakshit risk-reward milne gari share kinna upayukta tokieako mulya ko sano dayara.',
    whyItMatters:
      'Paying above the Entry Zone ("chasing") balloons your risk per share and ruins Risk/Reward.',
    howCalculated:
      'Defined tightly around the resistance trigger (e.g., pivot to +2.5%) for Breakouts/VCP, or around support/SMA20 for Trend Pullbacks.',
    interpretation:
      'If price already ran far above `entryZoneHigh`, wait for a fresh consolidation rather than chasing.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Breakout trigger is NPR 600; Entry Zone is NPR 600–615. At NPR 640 (+6.7%), the entry is overextended.',
    tradingDecisionImpact:
      'Generated cleanly for every candidate in Entry Timing.',
    commonMistakes:
      'Chasing +8% gaps far beyond the Entry Zone while still keeping the original tight stop.',
    limitations:
      'Fast circuit rallies in NEPSE can skip past entry zones on day 1.',
    advancedExplanation:
      'Adverse selection boundary preserving planned payoff asymmetry.',
    relatedTerms: ['invalidation-level', 'breakout', 'pullback'],
  },
  {
    id: 'invalidation-level',
    term: 'Invalidation Level',
    fullName: 'Price Where the Trade Thesis Is Proven Wrong',
    category: 'Risk Management',
    simpleDefinition:
      'The exact price level where the chart pattern fails completely — telling you objectively that your trade idea was wrong.',
    nepaliExplanation:
      'Share ko mulya tyo bindu bhanda tala gaye ma hamro strategy ko tark nai galat siddha hune bindu.',
    whyItMatters:
      'Removes emotion and guesswork: if the thesis is broken, capital belongs in cash or better setups.',
    howCalculated:
      'Anchored beneath the breakout base midpoint/low, VCP final contraction low, or Trend Pullback support floor.',
    interpretation:
      'Stop-loss should never be placed *wider* than the invalidation zone.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: A VCP contraction tightened between NPR 760 and NPR 790; closing below NPR 755 invalidates the pattern.',
    tradingDecisionImpact:
      'Displayed alongside every setup’s Entry Zone and Exit Plan.',
    commonMistakes:
      'Holding on with "hope" after price decisively slices below structural invalidation.',
    limitations:
      'Sudden illiquid wicks can briefly poke an invalidation point intraday.',
    advancedExplanation:
      'Structural falsification threshold for the trade hypothesis.',
    relatedTerms: ['stop-loss', 'support', 'entry-zone'],
  },
  {
    id: 'maximum-exposure',
    term: 'Maximum Exposure',
    fullName: 'Regime-Adjusted Portfolio Deployment Limit (%)',
    category: 'Portfolio Management',
    simpleDefinition:
      'The upper limit on what percentage of your total capital should be invested in stocks based on current NEPSE Market Regime conditions.',
    nepaliExplanation:
      'Bazar ko awastha (Bullish, Neutral, Bearish) herera kul punji ko kati pratishat samma matra share ma lagani rakhne bhanne sima.',
    whyItMatters:
      'Staying 100% invested during a Bearish downtrend exposes your entire wealth to falling breadth; holding cash protects capital for the next uptrend.',
    howCalculated:
      'Dynamic exposure band from the Market Regime Engine (e.g., Bullish 70–100%, Neutral 35–65%, Bearish 0–25%).',
    interpretation:
      'Compare your current Portfolio Monitor open exposure % against the Market Regime target ceiling.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: If NEPSE flips Bearish (max exposure 25%) while your paper portfolio is 60% invested, pause new buys and trim weak positions.',
    tradingDecisionImpact:
      'Enforced in Portfolio Risk Monitor alerts and Bearish Regime entry blocks.',
    commonMistakes:
      'Ignoring macro market deterioration and deploying every rupee of cash in a Bearish regime.',
    limitations:
      'Rapid regime rebounds can lag until breadth recovers above threshold.',
    advancedExplanation:
      'Dynamic beta scaling governed by cross-sectional market regime telemetry.',
    relatedTerms: ['market-breadth', 'portfolio-risk', 'sector-concentration'],
  },
  {
    id: 'sector-concentration',
    term: 'Sector Concentration',
    fullName: 'Maximum Allocation to One NEPSE Industry Sector (%)',
    category: 'Portfolio Management',
    simpleDefinition:
      'How much of your portfolio is clustered into a single NEPSE sector such as Hydropower, Commercial Banks, or Microfinance.',
    nepaliExplanation:
      'Tapai ko kul lagani madhye eautai kshetra (jasto Hydropower wa Bank) ma kati pratishat punji kendrit bhayeko xa bhanne maap.',
    whyItMatters:
      'Stocks inside one NEPSE sector move together sharply on policy or NRB news — owning 4 Hydropower stocks is often one disguised single bet.',
    howCalculated:
      'Sum of open position values in each sector divided by Total Portfolio Value.',
    formula: 'Sector % = (Sum of Sector Position Values / Portfolio Value) × 100',
    interpretation:
      'Default warning cap is 35% per sector to prevent hidden correlated blowups.',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Three Hydropower trades totaling NPR 210,000 inside an NPR 500,000 portfolio = 42% sector concentration (exceeds 35% cap).',
    tradingDecisionImpact:
      'Tracked live inside Portfolio Risk Monitor and flags over-concentrated sectors.',
    commonMistakes:
      'Thinking owning 5 different stocks gives diversification when all 5 belong to the same sector.',
    limitations:
      'During broad panic, cross-sector correlations still spike.',
    advancedExplanation:
      'Controls common-factor sector variance inside portfolio construction.',
    relatedTerms: ['portfolio-risk', 'maximum-exposure', 'position-sizing'],
  },
  {
    id: 'portfolio-risk',
    term: 'Portfolio Risk',
    fullName: 'Total Open Risk Across All Active Positions (%)',
    category: 'Portfolio Management',
    simpleDefinition:
      'The combined rupee amount your entire portfolio would lose if every open position hit its Stop-Loss simultaneously.',
    nepaliExplanation:
      'Khulla bhayeka sabai trade haru ekai sath stop-loss ma pugema kul punji ma hune jamma pratishat noksaan.',
    whyItMatters:
      'Measures true simultaneous downside exposure far more accurately than simply counting how many stocks you own.',
    howCalculated:
      'Sum over all open positions of `max(0, (Entry - Current_Stop) × Remaining_Qty)` divided by Portfolio Value.',
    formula: 'Open Portfolio Risk % = Sum((Entry - Stop) × Shares) / Portfolio × 100',
    interpretation:
      'Keep total open stop risk below ~6% (and raise stops as trades profit so open risk drops toward zero!).',
    hypotheticalExample:
      'HYPOTHETICAL EXAMPLE — NOT ACTUAL MARKET DATA: Four open trades each risking NPR 7,500 => total open portfolio risk is NPR 30,000 (6.0% of NPR 500,000).',
    tradingDecisionImpact:
      'Monitored continuously in the Portfolio Risk Monitor tab.',
    commonMistakes:
      'Opening 10 trades at 1.5% risk each (15% simultaneous risk) right before a market-wide shock.',
    limitations:
      'Actual shock losses can slightly exceed stop risk if stocks gap below stops.',
    advancedExplanation:
      'Aggregate stop-bounded Value-at-Risk proxy across active positions.',
    relatedTerms: ['risk-capital', 'maximum-exposure', 'sector-concentration'],
  },
];

export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(
  QUANT_GLOSSARY.map((entry) => [entry.id, entry])
);
