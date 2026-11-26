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
  time: string; // HH:mm in timezone
  timezone: string; // e.g. 'Asia/Kathmandu'
  days: number[]; // 0 = Sun ... 6 = Sat (NEPSE trading days: [0, 1, 2, 3, 4])
  retryIfNotUpdated: boolean;
  retryDelayMinutes: number;
  sourceMode: SchedulerSourceMode;
  githubRepo: string; // e.g. 'username/nepse-data'
  githubBranch: string; // e.g. 'main'
  githubDataPath: string; // e.g. 'data'
  pushToGitHub: boolean;
}

export interface SchedulerLogEntry {
  id: string;
  timestamp: string;
  trigger: 'scheduled' | 'manual' | 'backfill' | 'upload' | 'github';
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
  avg_trade_size: number;
  close_pos_pct: number;
  pos_52w_pct: number | null;
  gap_52h_pct: number | null;
  vs_d120_pct: number | null;
  vs_d180_pct: number | null;
}

export interface MarketPulseSummary {
  date: string;
  total: number;
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
}

export interface MarketPulseResponse {
  summary: MarketPulseSummary;
  rows: MarketPulseRow[];
}

export interface ResearchSource {
  title: string;
  uri: string;
}

export interface ResearchPoint {
  title: string;
  detail: string;
  impact: 'High' | 'Medium' | 'Low';
}

export interface MacroResearchResponse {
  generatedAt: string;
  model: string;
  cached: boolean;
  nepalSummary: string;
  worldSummary: string;
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

export interface StockResearchResponse {
  symbol: string;
  companyName: string;
  generatedAt: string;
  model: string;
  cached: boolean;
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



