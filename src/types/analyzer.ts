export type AnalyzerTimeframe = '1D' | '1W' | '1M';

export type AnalyzerStrategyFilter = 'All' | 'ICT' | 'SMC' | 'Price Action' | 'Wyckoff';

export type AnalyzerGrade = 'A' | 'B' | 'C' | 'D';

export type AnalyzerDirection = 'long' | 'short_warning';

export interface AnalyzerConfig {
  swingLeft: number; // bars left of pivot (default 3)
  swingRight: number; // confirmation bars right of pivot — strict no look-ahead (default 3)
  externalSwingLeft: number; // major structure left bars (default 6)
  externalSwingRight: number; // major structure right bars (default 6)
  atrPeriod: number; // default 14
  fvgMinAtr: number; // minimum gap size in ATR multiples (default 0.15)
  displacementBodyAtr: number; // minimum candle body / ATR (default 1.25)
  displacementBodyRatio: number; // body / range (default 0.6)
  eqTolerancePct: number; // equal highs/lows tolerance % (default 0.65)
  srTolerancePct: number; // S/R cluster tolerance % (default 1.5)
  minRR: number; // minimum acceptable R:R before rejection (default 1.5)
  stopAtrBuffer: number; // invalidation +/- buffer in ATR (default 0.25)
  maxZoneAgeBars: number; // horizon to render active zones (default 90)
  minDailyTurnoverNpr: number; // liquidity threshold (default 1_500_000)
  scoringWeights: {
    htfAlignment: number; // 14
    sweep: number; // 12
    displacementMss: number; // 14
    poiQuality: number; // 12
    premiumDiscount: number; // 10
    structure: number; // 10
    volume: number; // 8
    candlePattern: number; // 6
    srConfluence: number; // 6
    rrRoom: number; // 4
    liquidity: number; // 4
  };
}

export interface OverlayToggleState {
  swings: boolean;
  structureBreaks: boolean; // BOS / CHoCH / MSS
  displacement: boolean;
  fvg: boolean;
  ifvgAndBpr: boolean;
  volumeImbalanceAndVoids: boolean;
  orderBlocks: boolean;
  advancedBlocks: boolean; // Breaker, Mitigation, Rejection, Propulsion, Vacuum, Unicorn
  liquidityLevels: boolean; // BSL/SSL, EQH/EQL, PDH/PWH/PMH/52W
  sweepsAndInducement: boolean; // ✕ sweeps, IDM, Turtle Soup
  premiumDiscountOte: boolean; // Equilibrium, OTE 0.62-0.79, Fibs, PO3
  candlePatterns: boolean;
  srZones: boolean;
  trendlinesAndChannels: boolean;
  chartPatterns: boolean;
  supplyDemand: boolean;
  wyckoff: boolean;
  tradeBox: boolean;
}

export interface AnalyzerBar {
  idx: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  trans: number;
  vwap: number | null;
  w52_high: number | null;
  w52_low: number | null;
  diff_pct: number | null;
  atr14: number;
  isUpperCircuit: boolean;
  isLowerCircuit: boolean;
  possibleCorpActionGap: boolean;
  corpActionNote: string | null;
}

export interface SwingPoint {
  id: string;
  tier: 'minor' | 'internal' | 'external';
  kind: 'high' | 'low';
  label: 'HH' | 'HL' | 'LH' | 'LL' | 'H' | 'L';
  barIndex: number;
  date: string;
  price: number;
  confirmedAtIndex: number;
  confirmedDate: string;
  sweptAtIndex: number | null;
  sweptDate: string | null;
}

export interface StructureBreak {
  id: string;
  kind: 'BOS' | 'CHoCH' | 'MSS';
  direction: 'bullish' | 'bearish';
  tier: 'internal' | 'external';
  barIndex: number;
  date: string;
  breakPrice: number;
  brokenSwingIndex: number;
  brokenSwingDate: string;
  hasDisplacement: boolean;
  afterSweep: boolean;
  description: string;
}

export interface DisplacementCandle {
  barIndex: number;
  date: string;
  direction: 'bullish' | 'bearish';
  bodyAtrMult: number;
  closePosPct: number;
}

export interface ImbalanceZone {
  id: string;
  kind: 'FVG' | 'IFVG' | 'BPR' | 'VolumeImbalance' | 'Gap' | 'LiquidityVoid';
  direction: 'bullish' | 'bearish';
  startIndex: number;
  startDate: string;
  endIndex: number;
  endDate: string;
  top: number;
  bottom: number;
  ce50: number;
  mitigatedPct: number;
  status: 'unmitigated' | 'partial' | 'filled' | 'inverted';
  mitigatedAtIndex: number | null;
  mitigatedDate: string | null;
  corpActionFlagged: boolean;
  label: string;
}

export interface OrderBlockZone {
  id: string;
  kind: 'OB' | 'Breaker' | 'Mitigation' | 'Rejection' | 'Propulsion' | 'Vacuum' | 'Unicorn';
  direction: 'bullish' | 'bearish';
  startIndex: number;
  startDate: string;
  endIndex: number;
  endDate: string;
  top: number;
  bottom: number;
  meanThreshold: number;
  mitigatedPct: number;
  status: 'fresh' | 'tested' | 'mitigated' | 'broken';
  linkedBreakKind: 'BOS' | 'CHoCH' | 'MSS' | null;
  unicornOverlapFvgId: string | null;
  label: string;
}

export interface LiquidityLevel {
  id: string;
  kind:
    | 'BSL'
    | 'SSL'
    | 'EQH'
    | 'EQL'
    | 'PDH'
    | 'PDL'
    | 'PWH'
    | 'PWL'
    | 'PMH'
    | 'PML'
    | 'W52H'
    | 'W52L'
    | 'Inducement';
  side: 'buyside' | 'sellside';
  price: number;
  startIndex: number;
  startDate: string;
  swept: boolean;
  sweptKind: 'sweep' | 'run' | null;
  sweptAtIndex: number | null;
  sweptDate: string | null;
  turtleSoup: boolean;
  label: string;
}

export interface DrawOnLiquidityTarget {
  side: 'buyside' | 'sellside';
  price: number;
  label: string;
  distancePct: number;
}

export interface FibLevel {
  ratio: number;
  label: string;
  price: number;
}

export interface WeeklyPo3State {
  weeklyOpen: number | null;
  weekHigh: number | null;
  weekLow: number | null;
  phase: 'Accumulation' | 'Manipulation (Judas Swing)' | 'Expansion' | 'Distribution';
  note: string;
}

export interface PremiumDiscountProfile {
  rangeLookbackBars: number;
  rangeHigh: number;
  rangeLow: number;
  equilibrium: number;
  oteHigh: number; // 0.79 retrace from swing
  oteLow: number; // 0.62 retrace from swing
  pctInRange: number; // 0 (low) -> 100 (high)
  zoneLabel:
    | 'Deep Discount'
    | 'Discount (OTE)'
    | 'Discount'
    | 'Equilibrium'
    | 'Premium'
    | 'Premium (OTE)'
    | 'Deep Premium';
  fibRetracements: FibLevel[];
  fibExtensions: FibLevel[];
  weeklyPo3: WeeklyPo3State;
}

export interface CandlePatternHit {
  barIndex: number;
  date: string;
  pattern:
    | 'Bullish Pin Bar'
    | 'Bearish Pin Bar'
    | 'Bullish Engulfing'
    | 'Bearish Engulfing'
    | 'Inside Bar'
    | 'Morning Star'
    | 'Evening Star';
  direction: 'bullish' | 'bearish' | 'neutral';
  price: number;
}

export interface SRZone {
  id: string;
  kind: 'Support' | 'Resistance' | 'Flip';
  top: number;
  bottom: number;
  mid: number;
  touches: number;
  strength0to100: number;
  lastTouchDate: string;
}

export interface TrendlineSegment {
  id: string;
  kind: 'Ascending Support' | 'Descending Resistance' | 'Channel Top' | 'Channel Bottom';
  startIndex: number;
  startDate: string;
  startPrice: number;
  endIndex: number;
  endDate: string;
  endPrice: number;
  slopePerBar: number;
}

export interface ChartPatternDetection {
  id: string;
  name:
    | 'Double Bottom'
    | 'Double Top'
    | 'Head & Shoulders'
    | 'Inverse Head & Shoulders'
    | 'Ascending Triangle'
    | 'Descending Triangle'
    | 'Symmetrical Triangle'
    | 'Bull Flag'
    | 'Bear Flag'
    | 'Rising Wedge'
    | 'Falling Wedge'
    | 'Cup & Handle';
  direction: 'bullish' | 'bearish';
  status: 'Confirmed Breakout' | 'Forming';
  startIndex: number;
  startDate: string;
  endIndex: number;
  endDate: string;
  necklineOrTrigger: number;
  invalidationPrice: number;
  measuredTarget: number;
  points: Array<{ barIndex: number; date: string; price: number }>;
}

export interface BreakoutRetestEvent {
  kind: 'Breakout' | 'Retest' | 'Fakeout';
  direction: 'bullish' | 'bearish';
  barIndex: number;
  date: string;
  level: number;
  detail: string;
}

export interface VsaSignal {
  barIndex: number;
  date: string;
  kind:
    | 'Stopping Volume'
    | 'No Supply Test'
    | 'No Demand'
    | 'Upthrust Distribution'
    | 'Effort vs Result Bullish'
    | 'Climax Churn';
  direction: 'bullish' | 'bearish';
  detail: string;
}

export interface SupplyDemandZone {
  id: string;
  pattern: 'RBR' | 'DBD' | 'RBD' | 'DBR';
  kind: 'Demand' | 'Supply';
  startIndex: number;
  startDate: string;
  endIndex: number;
  endDate: string;
  top: number;
  bottom: number;
  freshness: 'Fresh' | 'Tested' | 'Mitigated';
  impulseMultiple: number;
}

export interface WyckoffPhaseRead {
  experimental: true;
  regimePhase:
    | 'Phase A (Stopping / SC)'
    | 'Phase B (Cause Building)'
    | 'Phase C (Spring / Upthrust Test)'
    | 'Phase D (SOS / LPS Markup)'
    | 'Phase E (Trend Continuation)'
    | 'Indeterminate Range';
  bias: 'Accumulation' | 'Distribution' | 'Neutral';
  events: Array<{
    barIndex: number;
    date: string;
    event: 'SC' | 'AR' | 'ST' | 'Spring' | 'SOS' | 'LPS' | 'BC' | 'UT' | 'UTAD' | 'SOW';
    price: number;
  }>;
  summary: string;
}

export interface SetupChecklistItem {
  label: string;
  passed: boolean;
  weight: number;
  pointsAwarded: number;
  detail: string;
}

export interface ScoreComponentDetail {
  key: string;
  label: string;
  maxPoints: number;
  pointsAwarded: number;
  detail: string;
}

export interface ScorePenaltyDetail {
  label: string;
  pointsDeducted: number;
  reason: string;
}

export interface AnalyzerTradePlan {
  valid: boolean;
  rejectionReason: string | null;
  entryLow: number;
  entryHigh: number;
  entryMid: number;
  stopLoss: number;
  invalidationLevel: number;
  atrBufferUsed: number;
  target1: number;
  target2: number;
  rrT1: number;
  rrT2: number;
  tickSizeNpr: number;
}

export interface AnalyzerSetup {
  id: string;
  strategy: Exclude<AnalyzerStrategyFilter, 'All'>;
  name: string;
  direction: AnalyzerDirection;
  isLongOnlyWarning: boolean;
  grade: AnalyzerGrade;
  score: number; // 0-100 after penalties
  rawScore: number;
  totalPenalties: number;
  scoreBreakdown: ScoreComponentDetail[];
  penalties: ScorePenaltyDetail[];
  checklist: SetupChecklistItem[];
  tradePlan: AnalyzerTradePlan;
  explanation: string;
  tags: string[];
}

export interface TimeframeBiasSnapshot {
  timeframe: AnalyzerTimeframe;
  trend: 'Bullish' | 'Bearish' | 'Ranging';
  lastBreakKind: 'BOS' | 'CHoCH' | 'MSS' | null;
  lastBreakDate: string | null;
  inDiscount: boolean;
  summary: string;
}

export interface HtfBiasSummary {
  monthly: TimeframeBiasSnapshot;
  weekly: TimeframeBiasSnapshot;
  daily: TimeframeBiasSnapshot;
  alignmentLabel: 'Full Bullish Alignment' | 'HTF Bullish / LTF Pullback' | 'Mixed / Transitional' | 'Bearish Alignment';
  alignmentScore0to100: number;
}

export interface IntradayCapabilityItem {
  concept: string;
  status: 'Not Available (EOD Only)';
  eodEquivalent: string;
}

export interface AnalyzerBacktestTrade {
  id: string;
  setupName: string;
  strategy: Exclude<AnalyzerStrategyFilter, 'All'>;
  grade: AnalyzerGrade;
  score: number;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  target2: number;
  exitReason: 'Target 2' | 'Target 1 + Trail' | 'Stop Loss' | 'Max Hold';
  grossReturnPct: number;
  netReturnPct: number;
  rMultipleNet: number;
  holdingDays: number;
}

export interface AnalyzerBacktestSummary {
  symbol: string | 'MARKET_COHORT';
  tf: AnalyzerTimeframe;
  strategy: AnalyzerStrategyFilter;
  holdoutRatio: number;
  totalBars: number;
  holdoutStartDate: string | null;
  holdoutEndDate: string | null;
  totalSetups: number;
  gradeABSetups: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  avgNetReturnPct: number | null;
  avgRMultiple: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number | null;
  equityCurve: Array<{ index: number; date: string; equityNpr: number; drawdownPct: number }>;
  sampleTrades: AnalyzerBacktestTrade[];
  note: string;
}

export interface AnalyzerResponse {
  symbol: string;
  name: string;
  sector: string;
  tf: AnalyzerTimeframe;
  strategy: AnalyzerStrategyFilter;
  asOfDate: string;
  availableDates: string[];
  configUsed: AnalyzerConfig;
  bars: AnalyzerBar[];
  htfBias: HtfBiasSummary;
  swings: SwingPoint[];
  structureBreaks: StructureBreak[];
  trendState: 'Bullish' | 'Bearish' | 'Ranging';
  displacements: DisplacementCandle[];
  imbalances: ImbalanceZone[];
  orderBlocks: OrderBlockZone[];
  liquidityLevels: LiquidityLevel[];
  drawOnLiquidity: DrawOnLiquidityTarget[];
  premiumDiscount: PremiumDiscountProfile;
  candlePatterns: CandlePatternHit[];
  srZones: SRZone[];
  trendlines: TrendlineSegment[];
  chartPatterns: ChartPatternDetection[];
  breakoutEvents: BreakoutRetestEvent[];
  vsaSignals: VsaSignal[];
  supplyDemandZones: SupplyDemandZone[];
  wyckoff: WyckoffPhaseRead;
  setups: AnalyzerSetup[];
  topLongSetup: AnalyzerSetup | null;
  bearishExitWarnings: AnalyzerSetup[];
  narrative: string[];
  warnings: string[];
  eodLimits: IntradayCapabilityItem[];
  liquidityStats: {
    latestTurnoverNpr: number;
    avgTurnover20Npr: number;
    avgVolume20: number;
    passesLiquidityFilter: boolean;
    circuitLockedBarsCount: number;
    corpActionGapCount: number;
  };
  disclaimer: string;
}

export interface AnalyzerScanRow {
  symbol: string;
  name: string;
  sector: string;
  asOfDate: string;
  tf: AnalyzerTimeframe;
  close: number;
  avgTurnover20Npr: number;
  setupName: string;
  strategy: Exclude<AnalyzerStrategyFilter, 'All'>;
  grade: AnalyzerGrade;
  score: number;
  entryMid: number;
  stopLoss: number;
  target1: number;
  target2: number;
  rrT2: number;
  htfAlignment: string;
  hasBearishWarning: boolean;
  tags: string[];
}

export interface AnalyzerScanResponse {
  asOfDate: string;
  tf: AnalyzerTimeframe;
  strategy: AnalyzerStrategyFilter;
  minGrade: 'A' | 'B' | 'C';
  scannedSymbols: number;
  qualifyingCount: number;
  rows: AnalyzerScanRow[];
  warnings: string[];
}
