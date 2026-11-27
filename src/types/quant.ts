import type { DataFreshnessStatus } from './market';

export type MarketRegimeLabel = 'Bullish' | 'Neutral' | 'Bearish';

export type SetupStrategyKind = 'Breakout' | 'VCP' | 'Trend Pullback' | 'None';

export type TradeClassification =
  | 'STRONG BUY CANDIDATE'
  | 'BUY CANDIDATE'
  | 'WATCHLIST'
  | 'WAIT FOR CONFIRMATION'
  | 'HOLD'
  | 'REDUCE'
  | 'SELL'
  | 'REJECT';

export type LearningMode = 'beginner' | 'advanced';

export interface QuantWeightsConfig {
  trendStrength: number; // default 20
  momentum: number; // default 20
  relativeStrength: number; // default 15
  volumeStrength: number; // default 20
  breakoutStructure: number; // default 15
  vwapBehavior: number; // default 10
}

export interface QuantCostConfig {
  slippagePct: number; // e.g., 0.35% per side
  cgtRate: number; // 0.075 (<1yr) or 0.05 (>=1yr)
  maxVolumeParticipationPct: number; // e.g., 5% of 20d avg daily volume
}

export interface QuantBacktestConfig {
  holdingDays: number; // max holding period e.g. 15
  stopAtrMult: number; // e.g. 1.5
  target1R: number; // e.g. 1.5
  target2R: number; // e.g. 3.0
  minSampleSize: number; // e.g. 10
  inSampleRatio: number; // e.g. 0.6
  walkForwardFolds: number; // e.g. 3
  breakoutVolMult: number; // e.g. 1.5
  vcpMaxBaseRangePct: number; // e.g. 16
  pullbackMaxSmaDistPct: number; // e.g. 4
}

export interface QuantRiskConfig {
  portfolioValue: number; // NPR
  riskPctPerTrade: number; // %
  maxSingleStockPct: number; // %
  maxSectorConcentrationPct: number; // %
  maxPortfolioOpenRiskPct: number; // %
  enforceTenKitta: boolean; // optional 10-share lot rounding
  allowBearishNewEntries: boolean;
}

export interface QuantEngineConfig {
  minAvgDailyTurnover: number; // NPR e.g. 1_000_000 (10 lakh)
  minAvgDailyVolume: number; // shares e.g. 2000
  minDaysHistory: number; // e.g. 25
  bullishBreadthMinPct: number; // e.g. 55
  bearishBreadthMaxPct: number; // e.g. 40
  weights: QuantWeightsConfig;
  costs: QuantCostConfig;
  backtest: QuantBacktestConfig;
  risk: QuantRiskConfig;
}

export interface DataQualityIssue {
  symbol: string;
  date: string;
  category:
    | 'missing_record'
    | 'duplicate_entry'
    | 'stale_price'
    | 'anomalous_ohlc'
    | 'corporate_action_suspect'
    | 'missing_reference_field'
    | 'illiquid';
  severity: 'error' | 'warning' | 'info';
  detail: string;
}

export interface SymbolDataQuality {
  symbol: string;
  status: 'Valid' | 'Warning' | 'Excluded';
  totalSessionsPresent: number;
  expectedSessions: number;
  missingSessions: number;
  staleConsecutiveDays: number;
  anomalousBarCount: number;
  corporateActionSuspectCount: number;
  vwapSource: 'ShareSansar EOD VWAP' | 'OHLCV-Derived Approximation' | 'Unavailable';
  reasons: string[];
}

export interface DataQualityReport {
  asOfDate: string;
  totalSessionsInStore: number;
  dateRange: { start: string; end: string };
  totalSymbolsSeen: number;
  validSymbolsCount: number;
  warningSymbolsCount: number;
  excludedSymbolsCount: number;
  overallQualityScore: number; // 0-100
  issueCounts: {
    missingRecords: number;
    duplicateEntries: number;
    stalePrices: number;
    anomalousValues: number;
    corporateActionSuspects: number;
    missingReferenceFields: number;
    illiquidExcluded: number;
  };
  flaggedIssues: DataQualityIssue[];
  auditNote: string;
}

export interface NepseIndexPoint {
  date: string;
  equalWeightedIndex: number;
  turnoverWeightedIndex: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  adRatio: number;
  advancers: number;
  decliners: number;
  totalTurnover: number;
  drawdownPct: number;
}

export interface SectorRegimeStrength {
  sector: string;
  stockCount: number;
  return20dPct: number | null;
  return5dPct: number | null;
  breadthAboveSma20Pct: number;
  turnoverSharePct: number;
  relativeStrengthVsMarket: number | null;
  regime: MarketRegimeLabel;
}

export interface MarketRegimeReport {
  asOfDate: string;
  regime: MarketRegimeLabel;
  regimeScore: number; // 0-100
  recommendedExposureMinPct: number;
  recommendedExposureMaxPct: number;
  recommendedExposureTargetPct: number;
  indexProxyLabel: string;
  indexCurrent: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  sma200Available: boolean;
  sma20SlopePct: number | null;
  sma50SlopePct: number | null;
  breadthAboveSma20Pct: number;
  breadthAboveSma50Pct: number;
  breadthAboveMa120Pct: number;
  breadthAboveMa180Pct: number;
  adRatio: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  marketTurnover: number;
  marketTurnoverAvg20: number;
  turnoverVsAvg20: number;
  marketVolume: number;
  marketVolumeAvg20: number;
  volatility20dPct: number;
  maxDrawdownWindowPct: number;
  currentDrawdownPct: number;
  topSectors: SectorRegimeStrength[];
  weakSectors: SectorRegimeStrength[];
  rationale: string[];
  series: NepseIndexPoint[];
}

export interface TechnicalComponentScore {
  key: keyof QuantWeightsConfig;
  label: string;
  weightPct: number;
  rawScore0to100: number;
  weightedPoints: number;
  metrics: Record<string, string | number | null>;
  explanation: string;
}

export interface StockIndicatorsSnapshot {
  close: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  dayChangePct: number;
  volume: number;
  turnover: number;
  trans: number;
  avgTurnover20: number;
  avgVolume20: number;
  relativeVolume: number;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  ma120: number | null;
  ma180: number | null;
  sma20SlopePct: number | null;
  sma50SlopePct: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  atr14: number | null;
  atrPct: number | null;
  adx14: number | null;
  vwap: number | null;
  vwapSource: 'ShareSansar EOD VWAP' | 'OHLCV-Derived Approximation' | 'Unavailable';
  vwapPct: number | null;
  vwapRising: boolean | null;
  return10dPct: number | null;
  return20dPct: number | null;
  return60dPct: number | null;
  rsVsNepse20dPct: number | null;
  rsPercentile: number; // 0-100
  upDownVolRatio20: number;
  w52High: number | null;
  w52Low: number | null;
  gap52HighPct: number | null;
  resistance20: number | null;
  support20: number | null;
  vcpDetected: boolean;
  vcpContractions: number;
  vcpDryUpRatio: number | null;
  accumulationPattern: 'Accumulation' | 'Distribution' | 'Neutral';
}

export interface EntryConditionCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface EntryTimingPlan {
  setupType: SetupStrategyKind;
  setupStatus: 'Confirmed' | 'Forming / Watch' | 'None';
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  triggerPrice: number | null;
  invalidationLevel: number | null;
  confirmationConditions: EntryConditionCheck[];
  supportingReasons: string[];
  rejectionReasons: string[];
}

export interface ExitManagementPlan {
  initialStopLoss: number;
  stopDistancePct: number;
  target1: number;
  target2: number;
  partialProfitRule: string;
  trailingStopLevel: number | null;
  trailingStopRule: string;
  maBreakdownRule: string;
  regimeAlertRule: string;
  invalidationRule: string;
  neverWidenStopPolicy: string;
}

export interface PositionSizingPlan {
  portfolioValue: number;
  riskPct: number;
  riskCapitalNpr: number;
  plannedEntry: number;
  stopLoss: number;
  riskPerShare: number;
  rawQuantity: number;
  finalQuantity: number; // whole shares respecting capital, max exposure, liquidity
  cappingReason: string | null;
  investmentAmountNpr: number; // shares * entry
  estimatedBuyFeeNpr: number;
  totalCashRequiredNpr: number;
  portfolioAllocationPct: number;
  maxAcceptableLossNetNpr: number;
  grossRiskReward: number;
  netRiskRewardT1: number;
  netRiskRewardT2: number;
  liquidityDaysToExit: number;
  priceLimitNotice: string;
}

export interface RegimeConditionalStat {
  regime: MarketRegimeLabel;
  sampleSize: number;
  winRatePct: number | null;
  netExpectancyPct: number | null;
  profitFactor: number | null;
}

export interface SetupStatisticalSummary {
  setupType: Exclude<SetupStrategyKind, 'None'>;
  sampleSize: number;
  wins: number;
  losses: number;
  historicalWinRatePct: number | null;
  winRateCi95LowPct: number | null;
  winRateCi95HighPct: number | null;
  avgWinGrossPct: number | null;
  avgLossGrossPct: number | null;
  avgWinNetPct: number | null;
  avgLossNetPct: number | null;
  grossExpectancyPct: number | null;
  netExpectancyPct: number | null;
  netExpectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  avgHoldingDays: number | null;
  inSampleNetExpectancyPct: number | null;
  outOfSampleSampleSize: number;
  outOfSampleWinRatePct: number | null;
  outOfSampleNetExpectancyPct: number | null;
  outOfSampleProfitFactor: number | null;
  overfittingRisk: 'Low' | 'Moderate' | 'High' | 'Insufficient Sample';
  statisticallyFavorable: boolean;
  reliabilityLabel: 'Statistically Validated' | 'Marginal / Unproven' | 'Negative Expectancy' | 'Insufficient Sample';
  reliabilityNotes: string[];
  byRegime: RegimeConditionalStat[];
}

export interface QuantStockCandidate {
  symbol: string;
  name: string;
  sector: string;
  asOfDate: string;
  dataTimestamp: string;
  dataQuality: SymbolDataQuality;
  fundamentalStatus: {
    hasAudit: boolean;
    dataStatus: DataFreshnessStatus;
    reportingPeriod: string;
    publicationDate: string;
    recommendation: string | null;
    riskScore: number | null;
    opportunityScore: number | null;
    redFlags: string[];
  };
  indicators: StockIndicatorsSnapshot;
  technicalScore: number; // 0-100 weighted
  scoreBreakdown: TechnicalComponentScore[];
  patternTags: string[];
  setupType: SetupStrategyKind;
  classification: TradeClassification;
  classificationReason: string;
  entryPlan: EntryTimingPlan;
  exitPlan: ExitManagementPlan | null;
  positionSizing: PositionSizingPlan | null;
  setupStats: SetupStatisticalSummary | null;
  stockHistoricalOccurrences: number;
  stockHistoricalWinRatePct: number | null;
  stockHistoricalNetExpectancyPct: number | null;
  estimatedModelConfidenceLabel: string;
  fiveQuestionsSummary: {
    hasStatisticalAdvantage: string;
    isMarketFavorable: string;
    isEntryValid: string;
    allocationAndMaxLoss: string;
    exitTriggers: string;
  };
}

export interface SimulatedTradeRecord {
  id: string;
  symbol: string;
  sector: string;
  setupType: Exclude<SetupStrategyKind, 'None'>;
  regimeAtEntry: MarketRegimeLabel;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  sharesSimulated: number;
  grossReturnPct: number;
  netReturnPct: number;
  rMultipleNet: number;
  holdingDays: number;
  exitReason: 'Target 2' | 'Target 1 + Trail' | 'Initial Stop-Loss' | 'Trailing Stop' | 'MA Breakdown' | 'Max Hold Exit';
  isOutOfSample: boolean;
  costsNpr: number;
}

export interface WalkForwardFold {
  foldIndex: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainTrades: number;
  trainWinRatePct: number | null;
  trainNetExpectancyPct: number | null;
  testTrades: number;
  testWinRatePct: number | null;
  testNetExpectancyPct: number | null;
  testProfitFactor: number | null;
}

export interface MonteCarloStressSummary {
  trials: number;
  tradeCount: number;
  positionWeightPct: number;
  initialEquityNpr: number;
  observedFinalEquityNpr: number;
  observedMaxDrawdownPct: number;
  medianFinalEquityNpr: number;
  p5FinalEquityNpr: number;
  p95FinalEquityNpr: number;
  medianMaxDrawdownPct: number;
  p95WorstDrawdownPct: number;
  p99WorstDrawdownPct: number;
  probabilityOfProfitPct: number;
  maxConsecutiveLossesP95: number;
  methodologyNote: string;
}

export interface BacktestResponse {
  generatedAt: string;
  asOfDate: string;
  configUsed: QuantEngineConfig;
  totalSignalsTested: number;
  setupSummaries: SetupStatisticalSummary[];
  walkForwardFolds: WalkForwardFold[];
  equityCurve: Array<{
    tradeIndex: number;
    date: string;
    equityNpr: number;
    drawdownPct: number;
    isOutOfSample: boolean;
  }>;
  monteCarlo?: MonteCarloStressSummary;
  recentTrades: SimulatedTradeRecord[];
  methodologySafeguards: string[];
  limitations: string[];
}

export interface QuantEngineResponse {
  generatedAt: string;
  asOfDate: string;
  dataTimestamp: string;
  config: QuantEngineConfig;
  dataQuality: DataQualityReport;
  marketRegime: MarketRegimeReport;
  candidates: QuantStockCandidate[];
  excludedStocks: QuantStockCandidate[];
  topOpportunities: QuantStockCandidate[];
  breakoutWatchlist: QuantStockCandidate[];
  vcpWatchlist: QuantStockCandidate[];
  pullbackWatchlist: QuantStockCandidate[];
  relativeStrengthLeaders: QuantStockCandidate[];
  accumulationLeaders: QuantStockCandidate[];
  distributionWarnings: QuantStockCandidate[];
  backtestSummary: BacktestResponse;
}

export interface TradeJournalEntry {
  id: string;
  createdAt: string;
  symbol: string;
  sector: string;
  setupType: SetupStrategyKind;
  regimeAtEntry: MarketRegimeLabel;
  status: 'PLANNED' | 'OPEN' | 'PARTIAL' | 'CLOSED' | 'CANCELLED';
  entryDate: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  quantity: number;
  remainingQuantity: number;
  exitDate?: string;
  exitPrice?: number;
  realizedPnlNpr: number;
  notes: string;
  isPaperTrade: true;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType: 'SCAN_RUN' | 'BACKTEST_RUN' | 'CONFIG_CHANGE' | 'JOURNAL_ACTION';
  asOfDate: string;
  summary: string;
  details?: string;
}

export type GlossaryCategory =
  | 'Market Basics'
  | 'Fundamental Analysis'
  | 'Technical Analysis'
  | 'Indicators'
  | 'Trading Strategies'
  | 'Quantitative Analysis'
  | 'Statistics'
  | 'Risk Management'
  | 'Portfolio Management';

export interface GlossaryEntry {
  id: string;
  term: string;
  fullName: string;
  category: GlossaryCategory;
  simpleDefinition: string;
  nepaliExplanation: string;
  whyItMatters: string;
  howCalculated: string;
  formula?: string;
  interpretation: string;
  hypotheticalExample: string;
  tradingDecisionImpact: string;
  commonMistakes: string;
  limitations: string;
  advancedExplanation: string;
  relatedTerms: string[];
}
