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

export type ComingQuarterDirection =
  | 'Blow Up'
  | 'Moderate Upside'
  | 'Balanced'
  | 'Downside Risk'
  | 'Blow Down'
  | 'Insufficient Data';

export interface ComingQuarterReference {
  label: string;
  source: string;
  period: string | null;
  url: string | null;
}

export interface ComingQuarterOutlook {
  direction: ComingQuarterDirection;
  score: number; // -100 to +100
  signalStrength: number; // 0 to 100
  confidence: 'High' | 'Moderate' | 'Low';
  isCurrentFyQuarter: boolean;
  currentFy: string | null;
  currentQuarter: QuarterCode | null;
  currentPeriodLabel: string;
  comingQuarter: QuarterCode | null;
  comingFiscalYear: string | null;
  comingQuarterLabel: string;
  headline: string;
  reasons: string[];
  catalysts: string[];
  risks: string[];
  references: ComingQuarterReference[];
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
  reportWeighting: ReportWeightingInfo;
  recommendation: StockRecommendationExplanation;
  comingQuarterOutlook: ComingQuarterOutlook;
}

export type ReportWeightingBasis =
  | 'blended'
  | 'annual_only'
  | 'quarterly_only'
  | 'custom_period'
  | 'pending';

export interface ReportWeightingInfo {
  annualWeightPct: number;
  interimWeightPct: number;
  basis: ReportWeightingBasis;
  annualPeriodLabel: string | null;
  interimPeriodLabel: string | null;
  annualOverallScore: number | null;
  interimOverallScore: number | null;
  hasAnnualReport: boolean;
}

export interface ScreenerOverviewResponse {
  generatedAt: string;
  marketDate: string | null;
  annualWeightPct: number;
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
    withAnnualReports: number;
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

export type RegulatoryAgency =
  | 'ICRA'
  | 'CARE'
  | 'NRB'
  | 'NIA'
  | 'SEBON'
  | 'NEPSE'
  | 'CDSC';

export type RegulatoryStanding = 'Clean' | 'Positive' | 'Watch' | 'Alert' | 'Unknown';

export type RatingOutlook = 'Positive' | 'Stable' | 'Negative' | 'Watch' | 'Not Rated';

export interface RegulatoryKbCitation {
  title: string;
  uri: string;
  agency: RegulatoryAgency;
}

export interface RegulatoryKbNotice {
  id: string;
  agency: RegulatoryAgency;
  title: string;
  publishedDate: string;
  summary: string;
  url: string | null;
  symbols: string[];
  sectorGroups: SectorGroup[];
  impact: 'Positive' | 'Neutral' | 'Negative' | 'Mixed';
  ratingGrade: string | null;
  ratingOutlook: RatingOutlook;
  retrievedAt: string;
  method: 'Direct Scrape' | 'Search Grounded' | 'Cached Macro';
}

export interface CompanyCreditRatingInfo {
  agency: 'ICRA' | 'CARE' | null;
  ratingGrade: string | null;
  outlook: RatingOutlook;
  ratingAction: string | null;
  rationale: string | null;
  lastRatedDate: string | null;
}

export interface CompanyKnowledgeBaseEntry {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  updatedAt: string;
  dataStatus: 'Live' | 'Cached' | 'Unavailable';
  creditRating: CompanyCreditRatingInfo;
  regulatoryStanding: RegulatoryStanding;
  nrbAssessment: string | null;
  niaAssessment: string | null;
  sebonStatus: string | null;
  nepseDisclosures: string | null;
  cdscStatus: string | null;
  lockInOverhangFlag: boolean;
  tailwinds: string[];
  riskFlags: string[];
  citations: RegulatoryKbCitation[];
}

export interface KnowledgeBaseSummary {
  totalCompaniesIndexed: number;
  totalNotices: number;
  byAgency: Record<RegulatoryAgency, number>;
  lastHarvestAt: string | null;
  agencyLastFetch: Partial<Record<RegulatoryAgency, string>>;
}

export interface KnowledgeBaseResponse {
  summary: KnowledgeBaseSummary;
  notices: RegulatoryKbNotice[];
  companies: CompanyKnowledgeBaseEntry[];
}

export type HiddenGemArchetype =
  | 'undiscovered_quality'
  | 'deep_value_mos'
  | 'earnings_inflection'
  | 'clean_bfi_yield'
  | 'insurance_float'
  | 'kb_tailwind';

export interface HiddenGemSubScores {
  valuationMispricing: number; // max 30
  qualityMoat: number; // max 25
  earningsInflection: number; // max 20
  crowdNeglectAlpha: number; // max 15
  knowledgeBaseConviction: number; // max 10
}

export interface HiddenGemCandidate {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  hiddenGemScore: number;
  subScores: HiddenGemSubScores;
  archetypes: HiddenGemArchetype[];
  primaryArchetype: HiddenGemArchetype;
  convictionTier: 'Tier 1 Gem' | 'Tier 2 Gem' | 'Emerging Watch';
  whyHiddenGem: string[];
  riskWatchouts: string[];
  turnoverRank: number | null;
  totalRankedByTurnover: number;
  earningsYieldSpreadPct: number | null;
  kbEntry: CompanyKnowledgeBaseEntry | null;
  screenerRow: ScreenedCompanyRow;
}

export interface HiddenGemsResponse {
  generatedAt: string;
  marketDate: string | null;
  benchmarkFdRatePct: number;
  annualWeightPct: number;
  totalEvaluated: number;
  totalGems: number;
  annualBackedCount: number;
  kbCoveredCount: number;
  archetypeCounts: Record<HiddenGemArchetype, number>;
  kbSummary: KnowledgeBaseSummary;
  gems: HiddenGemCandidate[];
}

export interface ValuationModelEstimate {
  id: string;
  name: string;
  category: 'Intrinsic' | 'Relative' | 'Earnings Power' | 'Dividend & Capital';
  price: number | null;
  upsidePct: number | null;
  weightPct: number;
  formula: string;
  inputsSummary: string;
  note: string;
  available: boolean;
}

export interface FutureWorthScenario {
  horizon: '1Y' | '3Y' | '5Y';
  bearPrice: number | null;
  basePrice: number | null;
  bullPrice: number | null;
  bearCagrPct: number | null;
  baseCagrPct: number | null;
  bullCagrPct: number | null;
  assumptions: string;
}

export interface ValuationSensitivityCell {
  kePct: number;
  growthPct: number;
  fairValue: number | null;
  mosPct: number | null;
}

export interface AnnualReportForensics {
  annualWeightPct: number;
  interimWeightPct: number;
  hasAnnualReport: boolean;
  annualPeriodLabel: string | null;
  interimPeriodLabel: string | null;
  annualEps: number | null;
  interimEps: number | null;
  annualRoePct: number | null;
  interimRoePct: number | null;
  annualBvps: number | null;
  interimBvps: number | null;
  annualNetProfitCr: number | null;
  interimNetProfitCr: number | null;
  annualVsInterimDivergence: {
    epsRunRateDiffPct: number | null;
    roeDiffPp: number | null;
    flag: 'Normal' | 'Interim Elevated' | 'Interim Soft' | 'Annual Only' | 'Interim Only';
    explanation: string;
  };
  capitalStructure: {
    shareCapitalCr: number | null;
    reservesCr: number | null;
    retainedEarningsCr: number | null;
    netWorthCr: number | null;
    totalAssetsCr: number | null;
    totalDebtCr: number | null;
    cashCr: number | null;
    reserveToCapitalRatio: number | null;
    dividendBonusCapacityRating:
      | 'High Bonus/Dividend Cushion'
      | 'Moderate Cushion'
      | 'Tight Reserves'
      | 'Unavailable';
    operatingCashFlowCr: number | null;
    netProfitToOcfPct: number | null;
    creditRatingLabel: string | null;
    regulatoryStanding: RegulatoryStanding;
  };
  historicalPeriods: Array<{
    periodLabel: string;
    fiscalYear: string;
    quarter: QuarterCode;
    isAnnual: boolean;
    eps: number | null;
    roePct: number | null;
    bvps: number | null;
    netProfitCr: number | null;
    revenueCr: number | null;
    nplPct: number | null;
    debtToEquity: number | null;
  }>;
}

export interface SwotAndFutureWorth {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  risks: string[];
  futureWorthVerdict: {
    convictionTier:
      | 'Core Long-Term Allocation'
      | 'Opportunistic Value Allocation'
      | 'Hold / Wait for Entry Zone'
      | 'Avoid / Capital Preservation';
    considerableInvestmentScore: number;
    headline: string;
    rationale: string;
    fairValueRangeLabel: string;
    idealEntryZoneLabel: string;
    opportunityCostVsFdSpreadPct: number | null;
  };
}

export interface AnnualReportAiDeepDive {
  symbol: string;
  generatedAt: string;
  model: string;
  cached: boolean;
  annualReportYear: string | null;
  executiveSummary: string;
  managementGuidanceAndCatalysts: string[];
  auditorAndGovernanceFindings: string[];
  dividendAndBonusHistory: string[];
  annualReportStrengths: string[];
  annualReportWeaknesses: string[];
  annualReportOpportunities: string[];
  annualReportRisks: string[];
  futureWorthOutlook: string;
  considerableInvestmentVerdict: string;
  citations: Array<{ title: string; uri: string }>;
}

export type HealthSignalStatus = 'Strong' | 'Solid' | 'Watch' | 'Fragile' | 'Unavailable';

export interface ValuationHealthMetricContribution {
  key: string;
  label: string;
  pillar: 'safety' | 'quality' | 'growth' | 'valuation';
  unit: string;
  companyValue: number | null;
  annualReportValue: number | null;
  industryAverage: number | null;
  weightPct: number;
  score: number | null;
  status: HealthSignalStatus;
  higherIsBetter: boolean;
  sourceBasis: string;
  note: string;
}

export interface ValuationHealthPillar {
  id: 'safety' | 'quality' | 'growth' | 'valuation';
  label: string;
  weightPct: number;
  score: number;
  status: Exclude<HealthSignalStatus, 'Unavailable'>;
  summary: string;
}

export interface ValuationHealthScore {
  overallScore: number;
  safetyScore: number;
  growthScore: number;
  valuationCushionScore: number;
  band: 'Fortress Value' | 'Healthy Compounder' | 'Balanced / Watch' | 'Elevated Risk';
  annualWeightPct: number;
  hasAnnualReport: boolean;
  annualPeriodLabel: string | null;
  interimPeriodLabel: string | null;
  dataCoveragePct: number;
  dataBasisNote: string;
  headline: string;
  pillars: ValuationHealthPillar[];
  metricsBreakdown: ValuationHealthMetricContribution[];
}

export interface AnnualDissectorMetricRow {
  key: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  companyValue: number | null;
  annualReportValue: number | null;
  interimValue: number | null;
  industryAverage: number | null;
  industryMedian: number | null;
  topQuartileValue: number | null;
  deltaVsIndustry: number | null;
  isBetterVsIndustry: boolean | null;
  percentileInIndustry: number | null;
  verdict: 'Outperforming' | 'In Line' | 'Lagging' | 'Unavailable';
}

export interface AnnualDissectorSection {
  id: 'profitability' | 'growth' | 'capital_solvency' | 'valuation';
  title: string;
  subtitle: string;
  metrics: AnnualDissectorMetricRow[];
}

export interface IndustryAverageMetrics {
  sector: string;
  sectorGroup: SectorGroup;
  peerCount: number;
  annualVerifiedPeerCount: number;
  healthScore: number | null;
  safetyScore: number | null;
  growthScore: number | null;
  eps: number | null;
  roePct: number | null;
  roaPct: number | null;
  netMarginPct: number | null;
  bvps: number | null;
  pe: number | null;
  pb: number | null;
  earningsYieldPct: number | null;
  marginOfSafetyPct: number | null;
  epsGrowthPct: number | null;
  revenueGrowthPct: number | null;
  reserveToCapitalRatio: number | null;
  nplPct: number | null;
  debtToEquity: number | null;
  carPct: number | null;
  ocfToProfitPct: number | null;
}

export interface AnnualDissectorPeerRow {
  symbol: string;
  companyName: string;
  isTarget: boolean;
  hasAnnualReport: boolean;
  annualPeriodLabel: string | null;
  ltp: number | null;
  healthScore: number;
  healthBand: ValuationHealthScore['band'];
  safetyScore: number;
  growthScore: number;
  eps: number | null;
  roePct: number | null;
  netMarginPct: number | null;
  pe: number | null;
  pb: number | null;
  reserveToCapitalRatio: number | null;
  epsGrowthPct: number | null;
  marginOfSafetyPct: number | null;
  nplPct: number | null;
  debtToEquity: number | null;
}

export interface AnnualReportDissector {
  sector: string;
  sectorGroup: SectorGroup;
  scopeLabel: string;
  peerCount: number;
  annualVerifiedPeerCount: number;
  companyRankByHealth: number | null;
  annualWeightPct: number;
  industryAverages: IndustryAverageMetrics;
  sections: AnnualDissectorSection[];
  peerMatrix: AnnualDissectorPeerRow[];
}

export interface CompanyValuationDossierResponse {
  generatedAt: string;
  marketDate: string | null;
  annualWeightPct: number;
  benchmarkFdRatePct: number;
  summary: ScreenedCompanyRow;
  valuation: ValuationBreakdown;
  compositeFairValue: number | null;
  fairValueLow: number | null;
  fairValueHigh: number | null;
  marginOfSafetyPct: number | null;
  pricingVerdict:
    | 'Deeply Undervalued'
    | 'Undervalued / Attractive'
    | 'Fairly Valued'
    | 'Richly Priced'
    | 'Insufficient Data';
  entryZones: {
    deepValuePrice: number | null;
    buyZonePrice: number | null;
    fairValuePrice: number | null;
    trimZonePrice: number | null;
  };
  valuationHealthScore: ValuationHealthScore;
  annualReportDissector: AnnualReportDissector;
  models: ValuationModelEstimate[];
  scenarios: FutureWorthScenario[];
  sensitivityGrid: {
    keValues: number[];
    growthValues: number[];
    cells: ValuationSensitivityCell[][];
  };
  forensics: AnnualReportForensics;
  swot: SwotAndFutureWorth;
  kbEntry: CompanyKnowledgeBaseEntry | null;
  peerBenchmark: SectorPeerBenchmark | null;
  aiDeepDive: AnnualReportAiDeepDive | null;
}

export interface ValuationUniverseCandidate {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  ltp: number | null;
  compositeFairValue: number | null;
  marginOfSafetyPct: number | null;
  pricingVerdict: CompanyValuationDossierResponse['pricingVerdict'];
  considerableInvestmentScore: number;
  convictionTier: SwotAndFutureWorth['futureWorthVerdict']['convictionTier'];
  valuationHealthScore: number;
  healthBand: ValuationHealthScore['band'];
  safetyScore: number;
  growthScore: number;
  hasAnnualReport: boolean;
  reportBasis: ReportWeightingBasis;
  reserveToCapitalRatio: number | null;
  overallScore: number;
  roePct: number | null;
  pe: number | null;
  pb: number | null;
  creditRatingLabel: string | null;
  hasAiDeepDive: boolean;
}

export interface ValuationUniverseResponse {
  generatedAt: string;
  marketDate: string | null;
  annualWeightPct: number;
  benchmarkFdRatePct: number;
  totalEvaluated: number;
  withAnnualReports: number;
  undervaluedCount: number;
  coreAllocationCount: number;
  candidates: ValuationUniverseCandidate[];
}

export type MasterScreenerPreset =
  | 'master_all'
  | 'player_liquidity'
  | 'best_valuation'
  | 'annual_gems'
  | 'fundamental_titans'
  | 'earnings_accelerators'
  | 'technical_breakouts'
  | 'future_10x'
  | 'coming_qtr_blowup'
  | 'coming_qtr_blowdown';

export type MasterTechnicalTrend =
  | 'Strong Uptrend'
  | 'Uptrend'
  | 'Pullback in Uptrend'
  | 'Base / Accumulation'
  | 'Downtrend';

export interface MasterTechnicalSnapshot {
  technicalScore: number;
  trendState: MasterTechnicalTrend;
  rsi14: number | null;
  ema20: number | null;
  aboveEma20: boolean;
  vsD120Pct: number | null;
  vsD180Pct: number | null;
  goldenCross: boolean;
  vwapPct: number | null;
  gap52hPct: number | null;
  pos52wPct: number | null;
  breakout20d: boolean;
  return5dPct: number | null;
  return20dPct: number | null;
  signals: string[];
}

export interface MasterLiquiditySnapshot {
  playerInterestScore: number;
  latestTurnoverCr: number;
  avgTurnover20Cr: number;
  turnoverSpikeMult: number | null;
  latestVolume: number;
  avgVolume20: number;
  volumeSpikeMult: number | null;
  avgTicketNpr: number | null;
  playerTier: 'Institutional / HNI Flow' | 'Active High Liquidity' | 'Moderate Retail' | 'Thin Liquidity';
  upDownVolRatio: number | null;
  accumulationFlag: boolean;
  turnoverRank: number | null;
}

export interface MasterTenXSnapshot {
  tenXScore: number;
  tier: 'High 10x Runway' | 'Emerging Multi-Bagger' | 'Steady Compounder' | 'Mature / Low Runway';
  marketCapCr: number | null;
  bull5yPrice: number | null;
  bull5yMultiple: number | null;
  bull5yCagrPct: number | null;
  catalysts: string[];
}

export interface MasterScreenerRow {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  ltp: number | null;
  changePct: number | null;
  hasFundamentalData: boolean;
  hasAnnualReport: boolean;
  annualPeriodLabel: string | null;
  masterScore: number;
  technical: MasterTechnicalSnapshot;
  liquidity: MasterLiquiditySnapshot;
  tenX: MasterTenXSnapshot;
  valuation: {
    compositeFairValue: number | null;
    marginOfSafetyPct: number | null;
    pricingVerdict: CompanyValuationDossierResponse['pricingVerdict'];
    inBuyZone: boolean;
    buyZonePrice: number | null;
    pe: number | null;
    pb: number | null;
    peg: number | null;
    earningsYieldPct: number | null;
    fdSpreadPct: number | null;
    valuationHealthScore: number | null;
    healthBand: ValuationHealthScore['band'] | null;
    safetyScore: number | null;
    growthScore: number | null;
  };
  fundamentals: {
    overallScore: number;
    qualityScore: number;
    passedInvestorCount: number;
    verdict: RecommendationVerdict;
    roePct: number | null;
    netMarginPct: number | null;
    reserveToCapitalRatio: number | null;
    nplPct: number | null;
    debtToEquity: number | null;
    carPct: number | null;
    creditRatingLabel: string | null;
    regulatoryStanding: RegulatoryStanding;
    lockInOverhangFlag: boolean;
  };
  earnings: {
    eps: number | null;
    bvps: number | null;
    epsYoyPct: number | null;
    epsCagr3yPct: number | null;
    revenueGrowthPct: number | null;
    netProfitYoyPct: number | null;
    epsVsQ4Avg3yPct: number | null;
    earningsMomentumScore: number;
  };
  gems: {
    hiddenGemScore: number | null;
    convictionTier: HiddenGemCandidate['convictionTier'] | null;
    archetypes: HiddenGemArchetype[];
    whyGem: string[];
  };
  comingQuarterOutlook: ComingQuarterOutlook;
  actionTags: string[];
}

export interface MasterScreenerResponse {
  generatedAt: string;
  marketDate: string | null;
  annualWeightPct: number;
  benchmarkFdRatePct: number;
  totalSymbols: number;
  presetCounts: Record<MasterScreenerPreset, number>;
  sectors: string[];
  sectorGroups: SectorGroup[];
  rows: MasterScreenerRow[];
}

export type AnnualReportPillarId =
  | 'managementQuality'
  | 'growth'
  | 'businessOpportunities'
  | 'risks'
  | 'weaknesses'
  | 'uncertainties'
  | 'upcomingBusinessPlans'
  | 'businessDirection';

export type AnnualReportPillarStatus = 'Strong' | 'Solid' | 'Watch' | 'Fragile';

export interface AnnualReportPillarAssessment {
  id: AnnualReportPillarId;
  title: string;
  subtitle: string;
  status: AnnualReportPillarStatus;
  summary: string;
  findings: string[];
  keyMetrics: Array<{ label: string; value: string; note?: string }>;
}

export interface AnnualReportAiFyDistillation {
  symbol: string;
  fiscalYear: string;
  generatedAt: string;
  model: string;
  cached: boolean;
  reportBasisLabel: string;
  executiveSummary: string;
  managementQualityNotes: string[];
  growthHighlights: string[];
  businessOpportunities: string[];
  keyRisks: string[];
  weaknesses: string[];
  uncertainties: string[];
  upcomingBusinessPlans: string[];
  businessDirection: string;
  strategicComparisonVsPriorFy: string[];
  auditorAndGovernanceNotes: string[];
  dividendAndBonusDeclared: string[];
  citations: Array<{ title: string; uri: string }>;
}

export interface FiscalYearMetricSnapshot {
  revenueCr: number | null;
  netProfitCr: number | null;
  operatingProfitCr: number | null;
  eps: number | null;
  bvps: number | null;
  netWorthCr: number | null;
  reservesCr: number | null;
  retainedEarningsCr: number | null;
  shareCapitalCr: number | null;
  totalAssetsCr: number | null;
  totalLiabilitiesCr: number | null;
  totalDebtCr: number | null;
  cashCr: number | null;
  debtToEquity: number | null;
  operatingCashFlowCr: number | null;
  freeCashFlowCr: number | null;
  roePct: number | null;
  roaPct: number | null;
  roicPct: number | null;
  netMarginPct: number | null;
  reportedPe: number | null;
  reportedPb: number | null;
  dividendYieldPct: number | null;
  payoutRatioPct: number | null;
  depositsCr: number | null;
  loansCr: number | null;
  nplPct: number | null;
  carPct: number | null;
  cdRatioPct: number | null;
  costOfFundsPct: number | null;
  netPremiumCr: number | null;
  claimRatioPct: number | null;
  solvencyRatio: number | null;
  installedCapacityMw: number | null;
}

export interface FiscalYearYoYDeltas {
  priorFiscalYear: string | null;
  revenueYoYPct: number | null;
  netProfitYoYPct: number | null;
  epsYoYPct: number | null;
  bvpsYoYPct: number | null;
  netWorthYoYPct: number | null;
  assetsYoYPct: number | null;
  roeDeltaPp: number | null;
  roaDeltaPp: number | null;
  netMarginDeltaPp: number | null;
  nplDeltaPp: number | null;
  carDeltaPp: number | null;
  debtToEquityDelta: number | null;
}

export interface FiscalYearReportAnalysis {
  fiscalYear: string;
  sortYear: number;
  isLatest: boolean;
  basis: 'Audited Annual' | 'Q4 Full-Year Unaudited' | 'Interim Quarterly';
  quarter: QuarterCode;
  periodLabel: string;
  publicationDate: string | null;
  collectionDate: string;
  dataSource: string;
  sourceUrl: string | null;
  validationStatus: ValidationStatus;
  validationNotes: string[];
  dataQualityFlags: DataQualityFlag[];
  metrics: FiscalYearMetricSnapshot;
  yoyDeltas: FiscalYearYoYDeltas;
  executiveSummary: string;
  pillars: Record<AnnualReportPillarId, AnnualReportPillarAssessment>;
  lineItemHighlights: Array<{ section: string; particulars: string; rawValue: string }>;
  quarterHistoryInFy: Array<{
    periodLabel: string;
    quarter: QuarterCode;
    eps: number | null;
    netProfitCr: number | null;
    revenueCr: number | null;
    roePct: number | null;
    bvps: number | null;
  }>;
  aiDistillation: AnnualReportAiFyDistillation | null;
}

export interface ComparisonMetricDeltaRow {
  key: string;
  label: string;
  unit: string;
  latestVal: number | null;
  priorVal: number | null;
  absDelta: number | null;
  pctDelta: number | null;
  direction: 'improved' | 'deteriorated' | 'neutral' | 'unavailable';
  interpretation: string;
}

export interface FiscalYearComparisonMatrix {
  latestFy: string;
  priorFy: string | null;
  hasMultiYearComparison: boolean;
  headlineSummary: string;
  metricDeltas: ComparisonMetricDeltaRow[];
  managementPerformanceShift: {
    status: 'Improving' | 'Stable' | 'Deteriorating' | 'Single-FY Only';
    summary: string;
    points: string[];
  };
  strategyAndDirectionShifts: string[];
  progressAgainstPriorPlans: string[];
  emergingOpportunities: string[];
  emergingRisksAndWeaknesses: string[];
  efficiencyAndCapitalTrend: string[];
}

export interface AnnualTrendPoint {
  fiscalYear: string;
  sortYear: number;
  basis: FiscalYearReportAnalysis['basis'];
  periodLabel: string;
  revenueCr: number | null;
  netProfitCr: number | null;
  revenueYoYPct: number | null;
  netProfitYoYPct: number | null;
  eps: number | null;
  bvps: number | null;
  netWorthCr: number | null;
  reservesCr: number | null;
  totalAssetsCr: number | null;
  totalDebtCr: number | null;
  debtToEquity: number | null;
  roePct: number | null;
  roaPct: number | null;
  netMarginPct: number | null;
  roicPct: number | null;
  depositsCr: number | null;
  loansCr: number | null;
  carPct: number | null;
  nplPct: number | null;
  netPremiumCr: number | null;
  claimRatioPct: number | null;
  solvencyRatio: number | null;
}

export interface NepalFiscalYearContext {
  asOfDate: string;
  currentFy: string;
  currentStartBs: number;
  latestCompletedFy: string;
  previousCompletedFy: string;
  poushEndApproxDate: string;
  poushEndPassed: boolean;
  daysUntilPoushEnd: number;
  ruleSummary: string;
}

export interface AnnualReportIntelligenceResponse {
  generatedAt: string;
  marketDate: string | null;
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  ltp: number | null;
  changePct: number | null;
  compositeFairValue: number | null;
  marginOfSafetyPct: number | null;
  pricingVerdict: CompanyValuationDossierResponse['pricingVerdict'];
  valuationHealthScore: ValuationHealthScore | null;
  kbEntry: CompanyKnowledgeBaseEntry | null;
  fiscalContext: NepalFiscalYearContext;
  recommendedAnnualFy: string | null;
  aiDistillTargetFy: string;
  currentInterimFy: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  hasAuditedAnnual: boolean;
  auditedFyCount: number;
  totalFyCount: number;
  latestFy: string | null;
  fiscalYears: FiscalYearReportAnalysis[];
  comparison: FiscalYearComparisonMatrix | null;
  trendSeries: AnnualTrendPoint[];
  legacyDeepDive: AnnualReportAiDeepDive | null;
}

export interface AnnualReportUniverseCandidate {
  symbol: string;
  companyName: string;
  sector: string;
  sectorGroup: SectorGroup;
  ltp: number | null;
  latestFy: string | null;
  aiDistillTargetFy: string;
  currentInterimFy: string | null;
  fallbackUsed: boolean;
  latestBasis: FiscalYearReportAnalysis['basis'] | null;
  totalFyCount: number;
  auditedFyCount: number;
  aiDistilledFyCount: number;
  eps: number | null;
  roePct: number | null;
  netProfitCr: number | null;
  revenueCr: number | null;
  creditRatingLabel: string | null;
  regulatoryStanding: RegulatoryStanding;
  healthScore: number | null;
}

export interface AnnualReportUniverseResponse {
  generatedAt: string;
  fiscalContext: NepalFiscalYearContext;
  totalCompanies: number;
  multiFyCount: number;
  auditedAnnualCount: number;
  aiDistilledCount: number;
  sectors: string[];
  candidates: AnnualReportUniverseCandidate[];
}

export interface AnnualReportIngestResponse {
  symbol: string;
  fiscalYear: string;
  sourceType: 'url' | 'upload';
  sourceUrl: string | null;
  savedFilePath: string;
  kbUpdated: boolean;
  aiDistilled: boolean;
  message: string;
  distillation: AnnualReportAiFyDistillation;
}


