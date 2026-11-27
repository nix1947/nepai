export type DataProvenance = 'Reported' | 'Calculated' | 'Estimate' | 'Unavailable';

export type QuarterCode = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Annual';

export type SectorGroup =
  | 'Banking'
  | 'Microfinance'
  | 'Insurance'
  | 'Hydropower'
  | 'Manufacturing'
  | 'Other';

export type ValidationStatus =
  | 'Verified'
  | 'CrossChecked'
  | 'Discrepancy'
  | 'Unverified'
  | 'Incomplete';

export type ReportMonitorStatus =
  | 'Published'
  | 'Pending'
  | 'Retrying'
  | 'Failed'
  | 'NotDue';

export type DataQualityFlag =
  | 'incomplete'
  | 'outdated'
  | 'inconsistent'
  | 'unverified';

export interface TrackedMetric {
  value: number | null;
  unit: string;
  provenance: DataProvenance;
  note?: string;
  period?: string;
  source?: string;
}

export interface NormalizedFinancialMetrics {
  // Per-share & profitability
  eps: TrackedMetric;
  netProfit: TrackedMetric; // NPR
  revenue: TrackedMetric; // NPR (Net Interest Income / Total Operating Income for BFIs, Net Premium for Insurance, Revenue for others)
  operatingProfit: TrackedMetric; // NPR
  ebit: TrackedMetric; // NPR
  netProfitMarginPct: TrackedMetric;
  roePct: TrackedMetric;
  roaPct: TrackedMetric;
  roicPct: TrackedMetric;

  // Balance sheet & capital structure
  bvps: TrackedMetric; // Net worth per share (NPR)
  netWorth: TrackedMetric; // Total Equity (NPR)
  totalAssets: TrackedMetric; // NPR
  totalLiabilities: TrackedMetric; // NPR
  reserves: TrackedMetric; // NPR
  retainedEarnings: TrackedMetric; // NPR
  shareCapital: TrackedMetric; // NPR
  outstandingShares: TrackedMetric; // Share count
  totalDebt: TrackedMetric; // NPR (borrowings / debt securities where applicable)
  cashAndEquivalents: TrackedMetric; // NPR
  currentAssets: TrackedMetric; // NPR
  currentLiabilities: TrackedMetric; // NPR
  debtToEquity: TrackedMetric; // Ratio (x) — N/A for deposit-taking BFIs/Insurance

  // Cash flows & owner earnings
  operatingCashFlow: TrackedMetric; // NPR
  capex: TrackedMetric; // NPR
  freeCashFlow: TrackedMetric; // NPR
  ownerEarnings: TrackedMetric; // NPR
  depreciation: TrackedMetric; // NPR
  interestExpense: TrackedMetric; // NPR

  // Valuation (reported or price-derived)
  reportedPe: TrackedMetric;
  reportedPb: TrackedMetric;
  dividendYieldPct: TrackedMetric;
  payoutRatioPct: TrackedMetric;

  // Sector-specific (Banking, Microfinance, Insurance, Hydropower)
  deposits: TrackedMetric; // NPR
  loans: TrackedMetric; // NPR
  nplPct: TrackedMetric; // %
  carPct: TrackedMetric; // Capital Adequacy Ratio %
  cdRatioPct: TrackedMetric; // Credit-to-Deposit %
  costOfFundsPct: TrackedMetric; // %
  netPremium: TrackedMetric; // NPR
  claimRatioPct: TrackedMetric; // %
  solvencyRatio: TrackedMetric; // x
  installedCapacityMw: TrackedMetric; // MW for hydropower
}

export interface StatementLineItem {
  tab: string;
  section: string;
  particulars: string;
  rawValue: string;
  numericValue: number | null;
}

export interface QuarterlyStatementRecord {
  id: string; // `${symbol}:${fiscalYear}:${quarter}`
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  fiscalYear: string; // e.g. "2083/84"
  quarter: QuarterCode;
  periodLabel: string;
  sortKey: number; // e.g. 2083 * 10 + 1
  publicationDate: string | null;
  collectionDate: string;
  dataSource: 'ShareSansar' | 'ShareSansar + Official Search' | 'Cached Audit' | 'NEPSE/Official';
  sourceUrl: string | null;
  validationStatus: ValidationStatus;
  validationNotes: string[];
  dataQualityFlags: DataQualityFlag[];
  metrics: NormalizedFinancialMetrics;
  lineItemsCount: number;
  rawLineItems?: StatementLineItem[];
}

export interface Q4FiscalYearPoint {
  fiscalYear: string;
  quarter: QuarterCode;
  periodLabel: string;
  eps: number | null;
  netProfitCr: number | null;
  revenueCr: number | null;
  roePct: number | null;
  netMarginPct: number | null;
  bvps: number | null;
  ocfCr: number | null;
  nplPct: number | null;
}

export interface Q4ThreeYearBenchmark {
  basisLabel: string;
  yearsCount: number;
  yearsUsed: string[];
  annualizedFactorApplied: number;
  currentAnnualizedEps: number | null;
  currentAnnualizedNetProfitCr: number | null;
  currentAnnualizedRevenueCr: number | null;
  currentRoePct: number | null;
  currentNetMarginPct: number | null;
  currentBvps: number | null;
  currentOcfCr: number | null;
  currentNplPct: number | null;
  avgEps: number | null;
  avgNetProfitCr: number | null;
  avgRevenueCr: number | null;
  avgRoePct: number | null;
  avgNetMarginPct: number | null;
  avgBvps: number | null;
  avgOcfCr: number | null;
  avgNplPct: number | null;
  epsVsAvgPct: number | null;
  netProfitVsAvgPct: number | null;
  revenueVsAvgPct: number | null;
  roeVsAvgDeltaPp: number | null;
  marginVsAvgDeltaPp: number | null;
  bvpsVsAvgPct: number | null;
  nplVsAvgDeltaPp: number | null;
  historyPoints: Q4FiscalYearPoint[];
}

export interface GrowthComparisons {
  epsQoqPct: number | null;
  epsYoyPct: number | null;
  epsCagr3yPct: number | null;
  epsCagr5yPct: number | null;
  netProfitQoqPct: number | null;
  netProfitYoyPct: number | null;
  netProfitCagr3yPct: number | null;
  netProfitCagr5yPct: number | null;
  revenueQoqPct: number | null;
  revenueYoyPct: number | null;
  revenueCagr3yPct: number | null;
  revenueCagr5yPct: number | null;
  bvpsYoyPct: number | null;
  bvpsCagr3yPct: number | null;
  bvpsCagr5yPct: number | null;
  periodsAvailable: number;
  fiscalYearsAvailable: number;
  q4Benchmark: Q4ThreeYearBenchmark;
}

export interface ValuationBreakdown {
  method: string;
  sectorMethodologyNote: string;
  currentPrice: number | null;
  livePe: number | null;
  livePb: number | null;
  livePeg: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  earningsYieldPct: number | null;
  earningsYieldBasis: string;
  ncavPerShare: number | null;
  intrinsicValue: number | null;
  intrinsicValueLow: number | null;
  intrinsicValueHigh: number | null;
  marginOfSafetyPct: number | null;
  provenance: DataProvenance;
  formulaInputs: Array<{
    label: string;
    value: string;
    provenance: DataProvenance;
  }>;
  assumptions: string[];
  limitations: string[];
}

export type InvestorId =
  | 'buffett'
  | 'munger'
  | 'graham'
  | 'lynch'
  | 'marks'
  | 'fisher'
  | 'greenblatt'
  | 'templeton'
  | 'pabrai';

export interface InvestorCriterionResult {
  key: string;
  label: string;
  weight: number;
  earnedPoints: number;
  status: 'passed' | 'failed' | 'unavailable';
  actualDisplay: string;
  thresholdDisplay: string;
  provenance: DataProvenance;
  explanation: string;
}

export interface InvestorScoreResult {
  investorId: InvestorId;
  investorName: string;
  philosophy: string;
  score: number; // 0-100 normalized
  rawWeightedScore: number;
  dataCoveragePct: number; // 0-100
  qualified: boolean;
  summary: string;
  criteria: InvestorCriterionResult[];
}

export type ConsensusTag =
  | 'buffett_munger'
  | 'graham_marks'
  | 'lynch_fisher'
  | 'greenblatt_graham'
  | 'buffett_pabrai'
  | 'marks_templeton';

export interface ConsensusMatch {
  id: ConsensusTag;
  label: string;
  theme: string;
  investors: [string, string];
  combinedScore: number;
  qualified: boolean;
  reason: string;
}

export type RankingCategory =
  | 'overall_top'
  | 'fundamentally_strong'
  | 'high_growth'
  | 'undervalued'
  | 'defensive_value'
  | 'high_turnover_fundamental'
  | 'positive_momentum_fundamental'
  | 'quality_compounders';

export interface CompositeScores {
  fundamentalQualityScore: number;
  valueScore: number;
  growthScore: number;
  riskManagementScore: number;
  valuationAttractivenessScore: number;
  longTermCompoundingScore: number;
  overallScore: number;
}

export interface MarketOverlay {
  date: string | null;
  ltp: number | null;
  changePct: number | null;
  turnover: number | null;
  volume: number | null;
  avgTurnoverN: number | null;
  turnoverMultN: number | null;
  periodReturnNPct: number | null;
  vsD120Pct: number | null;
  vsD180Pct: number | null;
  w52High: number | null;
  w52Low: number | null;
  gap52hPct: number | null;
  momentumScore: number | null;
  liquidityTier: 'High' | 'Moderate' | 'Low' | 'Unavailable';
}

export interface GreenblattRankInfo {
  earningsYieldPct: number | null;
  roicOrRoePct: number | null;
  roicMetricLabel: string;
  earningsYieldRank: number | null;
  roicRank: number | null;
  combinedRank: number | null;
  totalRanked: number;
}

export type RecommendationVerdict =
  | 'STRONG BUY'
  | 'BUY'
  | 'ACCUMULATE'
  | 'WATCHLIST'
  | 'HOLD'
  | 'AVOID'
  | 'INSUFFICIENT DATA';

export interface StockRecommendationExplanation {
  verdict: RecommendationVerdict;
  whyQualifies: string;
  passedPhilosophies: string[];
  supportingMetrics: string[];
  strengths: string[];
  weaknesses: string[];
  downsideRisks: string[];
  missingOrUnverified: string[];
}

export interface ScreenedCompanyRow {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  reportingStatus: ReportMonitorStatus;
  hasFundamentalData: boolean;
  latestPeriod: {
    fiscalYear: string | null;
    quarter: QuarterCode | null;
    periodLabel: string;
    publicationDate: string | null;
    collectionDate: string | null;
    dataSource: string;
    validationStatus: ValidationStatus;
    freshnessDays: number | null;
    dataQualityFlags: DataQualityFlag[];
  };
  keyMetrics: {
    eps: number | null;
    netProfitCr: number | null;
    revenueCr: number | null;
    netMarginPct: number | null;
    roePct: number | null;
    roaPct: number | null;
    roicPct: number | null;
    pe: number | null;
    pb: number | null;
    peg: number | null;
    bvps: number | null;
    debtToEquity: number | null;
    nplPct: number | null;
    carPct: number | null;
    ocfCr: number | null;
    fcfCr: number | null;
    intrinsicValue: number | null;
    intrinsicValueLow: number | null;
    intrinsicValueHigh: number | null;
    marginOfSafetyPct: number | null;
    earningsYieldPct: number | null;
    epsQoqPct: number | null;
    epsYoyPct: number | null;
    epsCagr3yPct: number | null;
    epsCagr5yPct: number | null;
    netProfitQoqPct: number | null;
    netProfitYoyPct: number | null;
    netProfitCagr3yPct: number | null;
    revenueQoqPct: number | null;
    revenueYoyPct: number | null;
    revenueCagr3yPct: number | null;
    bvpsYoyPct: number | null;
    prevPeriodLabel: string | null;
    prevEps: number | null;
    prevNetProfitCr: number | null;
    prevRevenueCr: number | null;
    prevRoePct: number | null;
    roeQoqDeltaPct: number | null;
    prevNplPct: number | null;
    nplQoqDeltaPct: number | null;
    yoyPeriodLabel: string | null;
    yoyEps: number | null;
    yoyNetProfitCr: number | null;
    yoyRevenueCr: number | null;
    epsVsQ4Avg3yPct: number | null;
    netProfitVsQ4Avg3yPct: number | null;
    revenueVsQ4Avg3yPct: number | null;
    roeVsQ4Avg3yDelta: number | null;
    q4AvgEps3y: number | null;
    q4AvgNetProfitCr3y: number | null;
    q4AvgRevenueCr3y: number | null;
    q4AvgYearsCount: number;
    periodsAvailable: number;
    trends: {
      periods: string[];
      eps: Array<number | null>;
      revenueCr: Array<number | null>;
      netProfitCr: Array<number | null>;
    };
  };
  market: MarketOverlay;
  scores: CompositeScores;
  investorScores: Record<InvestorId, number>;
  passedInvestorCount: number;
  passedInvestors: InvestorId[];
  consensusMatches: ConsensusMatch[];
  rankingQualifiers: RankingCategory[];
  greenblatt: GreenblattRankInfo;
  recommendation: StockRecommendationExplanation;
}

export interface ScreenerOverviewResponse {
  generatedAt: string;
  marketDate: string | null;
  activeFiscalQuarter: {
    fiscalYear: string;
    quarter: QuarterCode;
    quarterEndApprox: string;
    checkStartDate: string;
    isDueNow: boolean;
    daysSinceQuarterEnd: number;
  };
  universeStats: {
    totalSymbols: number;
    withFundamentals: number;
    publishedActiveQuarter: number;
    pendingActiveQuarter: number;
    retryingCount: number;
    failedCount: number;
    incompleteCount: number;
    outdatedCount: number;
  };
  sectors: string[];
  fiscalYears: string[];
  rankingCounts: Record<RankingCategory, number>;
  consensusCounts: Record<ConsensusTag, number>;
  rows: ScreenedCompanyRow[];
}

export interface CompanyFundamentalDetailResponse {
  summary: ScreenedCompanyRow;
  valuation: ValuationBreakdown;
  growth: GrowthComparisons;
  investorDetails: Record<InvestorId, InvestorScoreResult>;
  statements: QuarterlyStatementRecord[];
  officialSources: Array<{ title: string; uri: string; category: string }>;
}

export interface SectorPeerMetricsAvg {
  sector: string;
  sectorGroup: SectorGroup;
  peerCountWithFundamentals: number;
  totalSectorPeers: number;
  avgOverallScore: number | null;
  avgEps: number | null;
  avgRoePct: number | null;
  avgPe: number | null;
  avgPb: number | null;
  avgNetMarginPct: number | null;
  avgMosPct: number | null;
  avgNplPct: number | null;
}

export interface SectorPeerSnapshot {
  symbol: string;
  companyName: string;
  ltp: number | null;
  changePct: number | null;
  overallScore: number;
  verdict: RecommendationVerdict;
  eps: number | null;
  roePct: number | null;
  pe: number | null;
  pb: number | null;
  marginOfSafetyPct: number | null;
  epsVsQ4Avg3yPct: number | null;
  passedInvestorCount: number;
}

export interface SectorPeerBenchmark {
  rankInSector: number | null;
  rankedTotal: number;
  averages: SectorPeerMetricsAvg;
  topPeers: SectorPeerSnapshot[];
}

export interface ExplorerDecisionPillar {
  key: 'quality' | 'valuation' | 'growth' | 'technical';
  label: string;
  score: number;
  status: 'Strong' | 'Constructive' | 'Neutral' | 'Caution';
  headline: string;
}

export interface ExplorerDecisionPlaybook {
  actionPosture:
    | 'High-Conviction Buy'
    | 'Accumulate on Pullback'
    | 'Value Watchlist (Wait for Structure)'
    | 'Momentum Trade Only (Price > Fair Value)'
    | 'Avoid / Capital Preservation'
    | 'Technical Only (Pending Fundamentals)';
  confluenceScore: number;
  summaryHeadline: string;
  pillars: ExplorerDecisionPillar[];
  bullPoints: string[];
  riskPoints: string[];
  executionGuidance: string;
  fdSpreadPct: number | null;
  benchmarkFdRatePct: number;
}

export interface ExplorerTechnicalSummary {
  asOfDate: string;
  tf: '1D';
  trendState: 'Bullish' | 'Bearish' | 'Ranging';
  htfAlignmentLabel: string;
  monthlyTrend: 'Bullish' | 'Bearish' | 'Ranging';
  weeklyTrend: 'Bullish' | 'Bearish' | 'Ranging';
  dailyTrend: 'Bullish' | 'Bearish' | 'Ranging';
  pctInRange: number;
  zoneLabel: string;
  rangeLow: number;
  rangeHigh: number;
  passesLiquidityFilter: boolean;
  avgTurnover20Npr: number;
  topSetup: {
    name: string;
    strategy: string;
    grade: 'A' | 'B' | 'C' | 'D';
    score: number;
    entryLow: number;
    entryHigh: number;
    entryMid: number;
    stopLoss: number;
    target1: number;
    target2: number;
    rrT1: number;
    rrT2: number;
    explanation: string;
  } | null;
  bearishWarningsCount: number;
  narrative: string[];
  warnings: string[];
}

export interface ExplorerOverviewResponse {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  hasFundamentalData: boolean;
  pendingSummary: ScreenedCompanyRow | null;
  fundamental: CompanyFundamentalDetailResponse | null;
  sectorBenchmark: SectorPeerBenchmark | null;
  technical: ExplorerTechnicalSummary | null;
  decisionPlaybook: ExplorerDecisionPlaybook;
  benchmarkFdRatePct: number;
}

export interface MonitorSymbolEntry {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  status: ReportMonitorStatus;
  latestFiscalYear: string | null;
  latestQuarter: QuarterCode | null;
  latestPublicationDate: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRetryAt: string | null;
  retryCount: number;
  lastError: string | null;
  validationStatus: ValidationStatus;
  dataQualityFlags: DataQualityFlag[];
}

export interface MonitorCollectionLog {
  id: string;
  timestamp: string;
  trigger: 'scheduled' | 'manual-single' | 'manual-batch' | 'retry' | 'cli';
  symbol: string | null;
  status: 'success' | 'skipped' | 'error';
  message: string;
  durationMs: number;
}

export interface MonitorConfig {
  enabled: boolean;
  cronTime: string;
  timezone: string;
  delayDaysAfterQuarterEnd: number; // default 15
  maxRetries: number;
  retryDelayMinutes: number;
  crossValidateWithSearch: boolean;
}

export interface MonitorBatchStatus {
  active: boolean;
  mode: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped?: number;
  currentSymbol: string | null;
  message: string;
  startedAt: string | null;
}

export interface FundamentalMonitorResponse {
  config: MonitorConfig;
  activeQuarter: {
    fiscalYear: string;
    quarter: QuarterCode;
    quarterEndApprox: string;
    checkStartDate: string;
    isDueNow: boolean;
    daysSinceQuarterEnd: number;
  };
  upcomingQuarter?: {
    fiscalYear: string;
    quarter: QuarterCode;
    quarterEndApprox: string;
    checkStartDate: string;
    isDueNow: boolean;
    daysSinceQuarterEnd: number;
  };
  batch: MonitorBatchStatus;
  counts: {
    total: number;
    published: number;
    pending: number;
    retrying: number;
    failed: number;
    notDue: number;
  };
  symbols: MonitorSymbolEntry[];
  logs: MonitorCollectionLog[];
}
