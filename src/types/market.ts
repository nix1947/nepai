export interface PriceRow {
  date: string;
  symbol: string;
  name: string;
  conf: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  ltp: number;
  close_ltp: number | null;
  close_ltp_pct: number | null;
  vwap: number | null;
  volume: number;
  prev_close: number;
  turnover: number;
  trans: number;
  diff: number;
  price_range: number | null;
  diff_pct: number | null;
  range_pct: number | null;
  vwap_pct: number | null;
  d120: number | null;
  d180: number | null;
  w52_high: number | null;
  w52_low: number | null;
}

export interface DailyAggregate {
  date: string;
  turnover: number;
  volume: number;
  companies: number;
  advancers: number;
  decliners: number;
  unchanged: number;
}

export interface RangeSummaryRow {
  symbol: string;
  name: string;
  sector?: string;
  ltp?: number;
  turnover: number;
  volume: number;
  trans: number;
  days_traded: number;
  up_days: number;
  down_days: number;
  start_price: number | null;
  end_price: number | null;
  change_pct: number | null;
  avg_price: number | null;
  avg_trade_size?: number;
  win_rate_pct?: number;
  vwap_pct?: number | null;
  vs_d120_pct?: number | null;
  gap_52h_pct?: number | null;
  close_pos_pct?: number;
  momentum_score?: number;
  flow_tag?: string;
  market_share_pct?: number;
}

export type TurnoverSignalType =
  | 'rising_turnover'
  | 'declining_activity'
  | 'volume_spike'
  | 'bullish_divergence'
  | 'bearish_divergence'
  | 'accumulation'
  | 'unusual_attention';

export interface TopTurnoverEnhancedRow extends RangeSummaryRow {
  sector: string;
  ltp: number;
  avg_daily_turnover: number;
  avg_daily_volume: number;
  prev_turnover: number | null;
  turnover_vs_prev_pct: number | null;
  prev_change_pct: number | null;
  avg_turnover_n: number;
  avg_volume_n: number;
  avg_price_n: number;
  turnover_vs_avg_n: number;
  volume_vs_avg_n: number;
  price_vs_avg_n_pct: number | null;
  up_down_vol_ratio: number;
  signals: TurnoverSignalType[];
  insight: string;
  sparkline_close: number[];
  sparkline_turnover: number[];
}

export interface TopTurnoverAnalyticsResponse {
  start: string;
  end: string;
  prevStart: string | null;
  prevEnd: string | null;
  nDays: number;
  total: number;
  marketTotalTurnover: number;
  prevMarketTotalTurnover: number | null;
  insights: string[];
  rows: TopTurnoverEnhancedRow[];
}

export interface WeeklyTopRow extends RangeSummaryRow {
  week_start: string;
  week_end: string;
  rank: number;
}

export interface SymbolInfo {
  symbol: string;
  name: string;
}

export type ScannerKind =
  | 'potential'
  | 'support'
  | 'selloff'
  | 'highbreak'
  | 'breakdown'
  | 'accumulation'
  | 'near52'
  | 'rs';

export interface ScannerResultRow {
  symbol: string;
  name: string | null;
  status?: 'BREAKOUT' | 'SETUP';
  score: number;
  last_close: number;
  move_pct?: number;
  vol_ratio?: number;
  base_days?: number;
  base_range_pct?: number;
  base_low?: number;
  base_high?: number;
  breakout_date?: string | null;
  days_ago?: number | null;
  signals?: string;
  start_date?: string;
  days?: number;
  level?: number;
  start_touch?: number;
  dist_from_level_pct?: number;
  run_turnover?: number;
  prior_high?: number;
  prior_low?: number;
  range_pct?: number;
  up_down_vol?: number;
  vol_vs_prior?: number;
  w52_high?: number;
  gap_to_high_pct?: number;
  turnover_boost?: number;
  return_pct?: number;
  market_median_pct?: number;
}

export type SchedulerSourceMode = 'sharesansar' | 'github' | 'both';

export interface SchedulerConfig {
  enabled: boolean;
  time: string;
  timezone: string;
  days: number[];
  retryIfNotUpdated: boolean;
  retryDelayMinutes: number;
  sourceMode: SchedulerSourceMode;
  githubRepo: string;
  githubBranch: string;
  githubDataPath: string;
  pushToGitHub: boolean;
  crawlKbDaily: boolean;
  autoCrawlOnSearch: boolean;
  autoPushOnSearchUpdate: boolean;
}

export interface SchedulerLogEntry {
  id: string;
  timestamp: string;
  trigger: 'scheduled' | 'manual' | 'backfill' | 'upload' | 'github' | 'kb' | 'search';
  status: 'success' | 'skipped' | 'error';
  tradingDate: string | null;
  rowsSaved: number;
  durationMs: number;
  message: string;
}

export interface SchedulerStatus {
  config: SchedulerConfig;
  isRunning: boolean;
  hasGitHubToken: boolean;
  nextRunIso: string | null;
  lastRun: SchedulerLogEntry | null;
  history: SchedulerLogEntry[];
  loadedDates: string[];
  lastKbCrawlDate?: string | null;
  lastGitHubPushDate?: string | null;
  lastGitHubPushAt?: string | null;
  todaySearchedSymbolsCount?: number;
}

export interface BackfillStatus {
  active: boolean;
  from: string | null;
  to: string | null;
  totalDays: number;
  processedDays: number;
  savedDays: number;
  skippedDays: number;
  failedDays: number;
  currentDate: string | null;
  message: string;
}

export interface MarketPulseRow extends PriceRow {
  sector: string;
  avg_trade_size: number;
  close_pos_pct: number;
  pos_52w_pct: number | null;
  gap_52h_pct: number | null;
  vs_d120_pct: number | null;
  vs_d180_pct: number | null;
  turnover_vs_avg_n: number;
  volume_vs_avg_n: number;
}

export interface SectorPulseMetric {
  sector: string;
  stocks: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  turnover: number;
  turnoverSharePct: number;
  avgTurnoverShareN: number;
  rotationDeltaPct: number;
  turnoverVsAvgN: number;
  avgChangePct: number;
  aboveVwapPct: number;
  leaderSymbol: string;
  leaderChangePct: number;
}

export interface MarketPulseSummary {
  date: string;
  startDate: string;
  endDate: string;
  windowDays: number;
  nDays: number;
  total: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  adRatio: number;
  totalTurnover: number;
  totalVolume: number;
  totalTrades: number;
  turnoverVsAvgN: number;
  top5ConcentrationPct: number;
  top10ConcentrationPct: number;
  sentimentScore: number;
  sentimentLabel: 'Risk-On / Bullish' | 'Constructive' | 'Neutral / Selective' | 'Risk-Off / Cautious';
  aboveMa120: number;
  ma120Eligible: number;
  aboveMa180: number;
  ma180Eligible: number;
  goldenCross: number;
  maEligible: number;
  aboveVwap: number;
  vwapEligible: number;
  near52HighCount: number;
  near52LowCount: number;
  upperCircuitCount: number;
  lowerCircuitCount: number;
  medianAvgTradeSize: number;
  medianRangePct: number;
  ticketDistribution: {
    retailCount: number;      // < 50k NPR/tx
    midCount: number;         // 50k - 250k
    hniCount: number;         // 250k - 1M
    institutionalCount: number; // >= 1M
  };
}

export interface MarketPulseResponse {
  summary: MarketPulseSummary;
  sectors: SectorPulseMetric[];
  rows: MarketPulseRow[];
}

export interface RadarPoint {
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  close: number;
  changePct: number;
  periodReturnN: number;
  turnover: number;
  avgTurnoverN: number;
  turnoverMult: number;
  volumeMult: number;
  priceVsAvgNPct: number;
  upDownVolRatio: number;
  rangeCompressionRatio: number;
  vwapPct: number | null;
  gap52hPct: number | null;
  radarScore: number;
  category: 'acceleration' | 'accumulation' | 'bullish_div' | 'bearish_div' | 'breakout_watch';
  headline: string;
}

export interface SectorRotationQuadrantNode {
  sector: string;
  stockCount: number;
  rsRatio: number; // centered around 100
  rsMomentum: number; // centered around 100
  quadrant: 'Leading' | 'Improving' | 'Weakening' | 'Lagging';
  turnoverSharePct: number;
  rotationDeltaPct: number;
  avgChangePct: number;
  avgTradeSizeNpr: number;
  leaderSymbol: string;
  leaderChangePct: number;
}

export interface SmartMoneyRadarRow {
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  changePct: number;
  smartMoneyScore: number;
  avgTradeSizeNpr: number;
  avgTradeSizeMult: number;
  upDownVolRatio: number;
  pocketPivot: boolean;
  stage2ProxyScore: number;
  vwapPct: number | null;
}

export interface OpportunityRadarResponse {
  date: string;
  nDays: number;
  points: RadarPoint[];
  accelerationAlerts: RadarPoint[];
  stealthAccumulation: RadarPoint[];
  divergences: RadarPoint[];
  breakoutWatchlist: RadarPoint[];
  sectorLeaders: SectorPulseMetric[];
  sectorRotationMatrix?: SectorRotationQuadrantNode[];
  smartMoneyLeaders?: SmartMoneyRadarRow[];
}

export interface CompareStockSummary {
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  close: number;
  dayChangePct: number;
  returnNPct: number | null;
  avgTurnoverN: number;
  avgVolumeN: number;
  latestTurnover: number;
  turnoverMultN: number;
  volumeMultN: number;
  vwapPct: number | null;
  vsD120Pct: number | null;
  pos52wPct: number | null;
  avgTradeSize: number;
  upDaysN: number;
  daysN: number;
  series: Array<{ date: string; close: number; indexedPct: number; turnover: number }>;
}

export interface StockComparisonResponse {
  nDays: number;
  dates: string[];
  stocks: CompareStockSummary[];
}

export type DataFreshnessStatus = 'Live' | 'Cached' | 'Historical' | 'Unavailable';

export interface ResearchSource {
  title: string;
  uri: string;
  category?: 'Company/IR' | 'NEPSE/SEBON' | 'NRB/Gov' | 'Financial Portal' | 'Web';
}

export interface ResearchPoint {
  title: string;
  detail: string;
  impact: 'High' | 'Medium' | 'Low';
  evidence?: string;
}

export interface FixedIncomeBenchmarks {
  tbill28d: string;
  tbill91d: string;
  tbill182d: string;
  tbill364d: string;
  govBondYield: string;
  devBondYield: string;
  bankFdIndividualRate: string;
  bankFdInstitutionalRate: string;
  nrbPolicyRate: string;
  rateTrend: 'Falling / Easing' | 'Stable' | 'Rising / Tightening' | 'Mixed / Unavailable';
  asOfDate: string;
  sourceNote: string;
}

export interface MacroIndicators {
  cdRatio: string;
  bankingLiquidity: string;
  cpiInflation: string;
  fxReserves: string;
  creditGrowth: string;
  remittanceTrend: string;
  fiscalCapex: string;
}

export interface RegulatoryUpdate {
  authority: 'NRB' | 'NIA' | 'SEBON' | 'NEPSE' | 'MoF/PDMO' | 'Other';
  date: string;
  title: string;
  summary: string;
  impact: 'Positive' | 'Negative' | 'Neutral' | 'Mixed';
  impactedSectors: string[];
}

export interface MacroResearchResponse {
  generatedAt: string;
  retrievedAt: string;
  dataStatus: DataFreshnessStatus;
  model: string;
  cached: boolean;
  searchGrounded?: boolean;
  notice?: string;
  nepalSummary: string;
  worldSummary: string;
  fixedIncomeBenchmarks?: FixedIncomeBenchmarks;
  macroIndicators?: MacroIndicators;
  regulatoryUpdates?: RegulatoryUpdate[];
  nepalOpportunities: ResearchPoint[];
  nepalRisks: ResearchPoint[];
  worldOpportunities: ResearchPoint[];
  worldRisks: ResearchPoint[];
  sectorsToWatch: Array<{
    sector: string;
    stance: 'Positive' | 'Neutral' | 'Cautious';
    reason: string;
  }>;
  sources: ResearchSource[];
  rawFallback?: string;
}

export interface StockFinancialMetrics {
  reportingPeriod: string;
  publicationDate: string;
  reportType: 'Quarterly' | 'Annual' | 'Mixed' | 'Unavailable';
  revenue: string;
  netProfit: string;
  eps: string;
  netWorthPerShare: string;
  pe: string;
  pb: string;
  roe: string;
  roa: string;
  reserves: string;
  retainedEarnings: string;
  totalAssets: string;
  totalLiabilities: string;
  deposits: string;
  loans: string;
  npl: string;
  car: string;
  liquidityRatio: string;
  cashFlow: string;
  dividendHistory: string;
  sectorSpecific: Array<{ label: string; value: string }>;
}

export interface StockPeriodComparisons {
  qoq: string;
  yoy: string;
  annual: string;
  inconsistencies: string;
  factsVsInterpretation: {
    facts: string[];
    interpretations: string[];
  };
}

export interface StockAssessment9Part {
  businessHealth: string;
  fundamentalStrengths: string[];
  majorRisksRedFlags: string[];
  growthOpportunities: string[];
  financialTrendAnalysis: string;
  valuationAssessment: string;
  scenarios: {
    bull: string;
    base: string;
    bear: string;
  };
  nextQuarterWatchlist: string[];
  overallOutlook: string;
}

export interface OpportunityCostAssessment {
  benchmarkFdRateText: string;
  benchmarkTBillText: string;
  benchmarkBondYieldText: string;
  benchmarkFdPct: number | null;
  stockEarningsYieldPct: number | null;
  expectedReturnThesis: string;
  beatsFixedIncome: boolean | null;
  verdict: string;
}

export interface ScoreFactorItem {
  factor: string;
  score: number;
  maxScore: number;
  evidence: string;
  sourceType: 'Reported' | 'Technical' | 'Macro' | 'Governance';
}

export type StockRecommendation = 'BUY' | 'HOLD' | 'WATCHLIST' | 'AVOID';

export interface StockResearchResponse {
  symbol: string;
  companyName: string;
  sector?: string;
  generatedAt: string;
  retrievedAt: string;
  dataStatus: DataFreshnessStatus;
  model: string;
  cached: boolean;
  searchGrounded?: boolean;
  notice?: string;
  reportingPeriod: string;
  publicationDate: string;
  reportType: 'Quarterly' | 'Annual' | 'Mixed' | 'Unavailable';
  limitations: string[];
  recommendation: StockRecommendation;
  riskScore: number;
  opportunityScore: number;
  riskBreakdown: ScoreFactorItem[];
  opportunityBreakdown: ScoreFactorItem[];
  fundamentalRedFlags: string[];
  governanceRegulatoryFlags: string[];
  financialMetrics?: StockFinancialMetrics;
  periodComparisons?: StockPeriodComparisons;
  assessment9Part?: StockAssessment9Part;
  opportunityCost?: OpportunityCostAssessment;
  summary: string;
  stance: 'Bullish' | 'Neutral' | 'Cautious';
  opportunities: ResearchPoint[];
  risks: ResearchPoint[];
  macroLinkage: string;
  catalysts: Array<{
    headline: string;
    timeframe: string;
  }>;
  sources: ResearchSource[];
  rawFallback?: string;
}

export interface TechnicalRiskRow {
  symbol: string;
  name: string;
  sector: string;
  date: string;
  ltp: number;
  changePct: number;
  periodReturnNPct: number | null;
  turnover: number;
  turnoverMultN: number;
  volMultN: number;
  vwapPct: number | null;
  vsD120Pct: number | null;
  vsD180Pct: number | null;
  pos52wPct: number | null;
  gap52hPct: number | null;
  upDownVolRatio: number;
  avgVolatilityPct: number;
  supportBreakPct: number | null;
  technicalRiskScore: number;
  riskLevel: 'Severe' | 'High' | 'Moderate';
  breakdown: ScoreFactorItem[];
  warningTags: string[];
  explanation: string;
  dataStatus: DataFreshnessStatus;
}

export interface TechnicallyRiskyResponse {
  date: string;
  nDays: number;
  totalScreened: number;
  severeCount: number;
  highCount: number;
  dataStatus: DataFreshnessStatus;
  rows: TechnicalRiskRow[];
}

export interface FundamentalRiskRow {
  symbol: string;
  companyName: string;
  sector: string;
  ltp: number | null;
  changePct: number | null;
  reportingPeriod: string;
  publicationDate: string;
  retrievedAt: string;
  dataStatus: DataFreshnessStatus;
  fundamentalRiskScore: number;
  recommendation: StockRecommendation;
  redFlags: string[];
  governanceFlags: string[];
  keyMetrics: {
    eps: string;
    pe: string;
    pb: string;
    roe: string;
    npl: string;
    cashFlow: string;
    netWorthPerShare: string;
    dividendHistory: string;
  };
  limitations: string[];
  whyRisky: string;
  sources: ResearchSource[];
}

export interface FundamentallyRiskyResponse {
  date: string;
  auditedCount: number;
  flaggedCount: number;
  rows: FundamentalRiskRow[];
  candidateSymbols: Array<{ symbol: string; name: string; sector: string; ltp: number; changePct: number }>;
}

export interface CompositeDoNotBuyRow {
  symbol: string;
  name: string;
  sector: string;
  ltp: number | null;
  changePct: number | null;
  compositeRiskScore: number;
  fundamentalRiskScore: number | null;
  technicalRiskScore: number;
  liquidityGovernanceScore: number;
  hasFundamentalAudit: boolean;
  confirmedRedFlags: string[];
  technicalWarnings: string[];
  whyNotBuy: string;
  reportingPeriod: string;
  publicationDate: string;
  retrievedAt: string | null;
  dataStatus: DataFreshnessStatus;
  technicalSnapshot: {
    vwapPct: number | null;
    vsD120Pct: number | null;
    upDownVolRatio: number;
    turnoverMultN: number;
  };
  sources: ResearchSource[];
}

export interface CompositeDoNotBuyResponse {
  date: string;
  nDays: number;
  auditedCount: number;
  rows: CompositeDoNotBuyRow[];
  priorityAuditSymbols: string[];
}

export interface MarketOpportunityRow {
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  changePct: number;
  periodReturnNPct: number | null;
  opportunityScore: number;
  riskScore: number;
  hasFundamentalAudit: boolean;
  recommendation: StockRecommendation | 'TECHNICAL_SETUP';
  whyConsiderBuying: string;
  opportunityCostVerdict: string;
  beatsFixedIncome: boolean | null;
  reportingPeriod: string;
  publicationDate: string;
  retrievedAt: string | null;
  dataStatus: DataFreshnessStatus;
  technicalSnapshot: {
    vwapPct: number | null;
    vsD120Pct: number | null;
    turnoverMultN: number;
    upDownVolRatio: number;
  };
  keyMetrics: {
    eps: string;
    pe: string;
    roe: string;
    dividendHistory: string;
  } | null;
  sources: ResearchSource[];
}

export interface MarketOpportunityVsRiskResponse {
  date: string;
  nDays: number;
  macroAvailable: boolean;
  macroRetrievedAt: string | null;
  macroDataStatus: DataFreshnessStatus;
  fixedIncomeBenchmarks: FixedIncomeBenchmarks | null;
  opportunities: MarketOpportunityRow[];
  insufficientCompensation: MarketOpportunityRow[];
  candidateAuditSymbols: string[];
}

export interface CohortAuditResponse {
  audited: Array<{
    symbol: string;
    ok: boolean;
    dataStatus?: DataFreshnessStatus;
    riskScore?: number;
    opportunityScore?: number;
    recommendation?: StockRecommendation;
    error?: string;
  }>;
}

export interface HomepageHistoryPoint {
  date: string;
  turnover: number;
  volume: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  turnoverVsPrevPct: number | null;
  volumeVsPrevPct: number | null;
}

export interface HomepageScriptSpotlight {
  symbol: string;
  name: string;
  sector: string;
  bias: 'blowout' | 'short';
  setupLabel: string;
  ltp: number;
  diffPct: number;
  turnover: number;
  volume: number;
  prevTurnover: number | null;
  prevVolume: number | null;
  turnoverVsPrevPct: number | null;
  volumeVsPrevPct: number | null;
  turnoverMultN: number;
  volumeMultN: number;
  closePosPct: number;
  rangePct: number;
  vwapPct: number | null;
  avgTradeSize: number;
  score: number;
  headline: string;
  triggers: string[];
}

export interface HomepageUnusualStockRow {
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  diffPct: number;
  turnover: number;
  volume: number;
  trans: number;
  prevTurnover: number | null;
  prevVolume: number | null;
  turnoverVsPrevPct: number | null;
  volumeVsPrevPct: number | null;
  turnoverMultN: number;
  volumeMultN: number;
  closePosPct: number;
  vwapPct: number | null;
  avgTradeSize: number;
  activityTag:
    | 'Breakout Spike'
    | 'Accumulation Surge'
    | 'Silent Absorption'
    | 'Heavy Distribution'
    | 'Wick Churn / Trap';
}

export interface HomepageTopTurnoverRow {
  rank: number;
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  diffPct: number;
  turnover: number;
  marketSharePct: number;
  volume: number;
  trans: number;
  prevTurnover: number | null;
  turnoverVsPrevPct: number | null;
  turnoverMultN: number;
  volumeMultN: number;
  closePosPct: number;
  vwapPct: number | null;
  avgTradeSize: number;
}

export interface HomepageSectorHeatmapRow extends SectorPulseMetric {
  volume: number;
  prevTurnover: number | null;
  prevVolume: number | null;
  turnoverVsPrevPct: number | null;
  volumeVsPrevPct: number | null;
}

export interface HomepageHeatmapStock {
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  diffPct: number;
  turnover: number;
  turnoverSharePct: number;
  volume: number;
  turnoverMultN: number;
  volumeMultN: number;
  turnoverVsPrevPct: number | null;
  closePosPct: number;
  vwapPct: number | null;
}

export interface HomepageWowInsight {
  id: string;
  category: string;
  title: string;
  detail: string;
  symbol?: string;
  tone: 'emerald' | 'blue' | 'amber' | 'red';
}

export interface HomepageSmartMoneyFootprint {
  symbol: string;
  name: string;
  sector: string;
  ltp: number;
  diffPct: number;
  turnover: number;
  volume: number;
  avgTradeSize: number;
  avgTradeSizeMult: number;
  upDownVolRatio: number;
  turnoverMultN: number;
  volumeMultN: number;
  closePosPct: number;
  vwapPct: number | null;
  pocketPivot: boolean;
  smartMoneyScore: number;
  footprintTag:
    | 'Pocket Pivot'
    | 'Block Accumulation'
    | 'Silent Absorption'
    | 'Institutional Buying'
    | 'Big-Ticket Exit';
}

export interface HomepagePulseResponse {
  summary: {
    date: string;
    prevDate: string | null;
    nDays: number;
    totalStocks: number;
    advancers: number;
    decliners: number;
    unchanged: number;
    adRatio: number;
    todayTurnover: number;
    prevTurnover: number | null;
    avg5dTurnover: number;
    avgNdTurnover: number;
    turnoverVsPrevPct: number | null;
    turnoverVs5dPct: number | null;
    turnoverVsNdPct: number | null;
    todayVolume: number;
    prevVolume: number | null;
    avg5dVolume: number;
    avgNdVolume: number;
    volumeVsPrevPct: number | null;
    volumeVs5dPct: number | null;
    volumeVsNdPct: number | null;
    todayTrades: number;
    prevTrades: number | null;
    tradesVsPrevPct: number | null;
    upTurnover: number;
    downTurnover: number;
    flatTurnover: number;
    netFlowTiltPct: number;
    sentimentScore: number;
    sentimentLabel: MarketPulseSummary['sentimentLabel'];
    aboveVwap: number;
    vwapEligible: number;
    aboveMa120: number;
    ma120Eligible: number;
    upperCircuitCount: number;
    lowerCircuitCount: number;
    medianAvgTradeSize: number;
    top5ConcentrationPct: number;
    ticketDistribution: MarketPulseSummary['ticketDistribution'];
    smartMoneyAccumCount: number;
    smartMoneyExitCount: number;
  };
  historyStrip: HomepageHistoryPoint[];
  blowoutScripts: HomepageScriptSpotlight[];
  shortScripts: HomepageScriptSpotlight[];
  unusualActivity: HomepageUnusualStockRow[];
  smartMoneyFootprints: HomepageSmartMoneyFootprint[];
  topTurnoverUp: HomepageTopTurnoverRow[];
  topTurnoverDown: HomepageTopTurnoverRow[];
  sectorHeatmap: HomepageSectorHeatmapRow[];
  stockHeatmap: HomepageHeatmapStock[];
  wowInsights: HomepageWowInsight[];
}

