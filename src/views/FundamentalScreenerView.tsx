import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart2,
  CalendarClock,
  CheckSquare,
  Download,
  FileSpreadsheet,
  Filter,
  Gem,
  GitCompare,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  TrendingUp,
} from 'lucide-react';
import {
  ColumnDef,
  createWatchlistColumn,
  DataTable,
} from '../components/DataTable';
import { CompanyFundamentalDetail } from '../components/screener/CompanyFundamentalDetail';
import {
  CompositeGrowthTrendCell,
  MetricTrendCell,
} from '../components/screener/GrowthTrendCell';
import { HiddenGemsKnowledgePanel } from '../components/screener/HiddenGemsKnowledgePanel';
import { ReportingMonitorPanel } from '../components/screener/ReportingMonitorPanel';
import {
  PeerComparisonArena,
  ValuationSensitivitySimulator,
} from '../components/screener/ScreenerComparisonAndSimulator';
import {
  QualityValuationScatterChart,
  TopStocksCompositeBarsChart,
} from '../components/screener/ScreenerVisualCharts';
import { useWatchlist } from '../hooks/useWatchlist';
import type {
  ConsensusTag,
  QuarterCode,
  RankingCategory,
  ScreenedCompanyRow,
  ScreenerOverviewResponse,
} from '../types/fundamental';

interface FundamentalScreenerViewProps {
  equityOnly: boolean;
  initialTarget?: { symbol: string; tick: number } | null;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer: (symbol: string) => void;
  onOpenValuation?: (symbol?: string) => void;
  onSymbolChange?: (symbol: string) => void;
}

type TableLens = 'overview' | 'growth' | 'valuation' | 'investors';

interface NumericFilterState {
  minPe: string;
  maxPe: string;
  maxPb: string;
  maxPeg: string;
  minEps: string;
  minRoe: string;
  minRoa: string;
  minNetMargin: string;
  minEpsQoq: string;
  minEpsYoy: string;
  minProfitYoy: string;
  minRevenueYoy: string;
  minCagr3y: string;
  maxDe: string;
  maxNpl: string;
  minMos: string;
  minQuality: string;
  improvingQoq: boolean;
}

const EMPTY_NUMERIC_FILTERS: NumericFilterState = {
  minPe: '',
  maxPe: '',
  maxPb: '',
  maxPeg: '',
  minEps: '',
  minRoe: '',
  minRoa: '',
  minNetMargin: '',
  minEpsQoq: '',
  minEpsYoy: '',
  minProfitYoy: '',
  minRevenueYoy: '',
  minCagr3y: '',
  maxDe: '',
  maxNpl: '',
  minMos: '',
  minQuality: '',
  improvingQoq: false,
};

interface StrategyPreset {
  id: string;
  label: string;
  hint: string;
  filters: Partial<NumericFilterState>;
  onlyEvaluated: boolean;
  lens?: TableLens;
  sortBy?: string;
}

const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'all',
    label: 'All Companies',
    hint: 'Reset parameter presets',
    filters: {},
    onlyEvaluated: false,
    sortBy: 'overallScore',
  },
  {
    id: 'garp',
    label: 'GARP Compounders',
    hint: 'PE ≤ 22 · PEG ≤ 1.2 · EPS YoY ≥ 10%',
    filters: { maxPe: '22', maxPeg: '1.2', minEpsYoy: '10' },
    onlyEvaluated: true,
    lens: 'growth',
    sortBy: 'overallScore',
  },
  {
    id: 'deep_value',
    label: 'Deep Value + MoS',
    hint: 'PE ≤ 15 · PB ≤ 1.8 · MoS ≥ 15%',
    filters: { maxPe: '15', maxPb: '1.8', minMos: '15' },
    onlyEvaluated: true,
    lens: 'valuation',
    sortBy: 'mos',
  },
  {
    id: 'roe_quality',
    label: 'High ROE Quality',
    hint: 'ROE ≥ 15% · Quality ≥ 65',
    filters: { minRoe: '15', minQuality: '65' },
    onlyEvaluated: true,
    lens: 'overview',
    sortBy: 'roe',
  },
  {
    id: 'qoq_accel',
    label: 'QoQ Accelerators',
    hint: 'EPS > Prev Q · Rising momentum',
    filters: { improvingQoq: true },
    onlyEvaluated: true,
    lens: 'growth',
    sortBy: 'epsQoq',
  },
  {
    id: 'clean_bfis',
    label: 'Clean BFIs',
    hint: 'NPL ≤ 3% · ROE ≥ 12%',
    filters: { maxNpl: '3', minRoe: '12' },
    onlyEvaluated: true,
    lens: 'valuation',
    sortBy: 'overallScore',
  },
];

const RANKING_TABS: Array<{ id: 'all' | RankingCategory; label: string }> = [
  { id: 'all', label: 'All Ranked' },
  { id: 'overall_top', label: 'Overall Top' },
  { id: 'fundamentally_strong', label: 'Fundamentally Strong' },
  { id: 'quality_compounders', label: 'Quality Compounders' },
  { id: 'undervalued', label: 'Undervalued / MoS' },
  { id: 'defensive_value', label: 'Defensive Value' },
  { id: 'high_growth', label: 'High-Growth' },
  { id: 'high_turnover_fundamental', label: 'High-Turnover' },
  { id: 'positive_momentum_fundamental', label: 'Positive Momentum' },
];

const CONSENSUS_OPTIONS: Array<{ id: 'all' | ConsensusTag; label: string }> = [
  { id: 'all', label: 'All Consensus Groups' },
  { id: 'buffett_munger', label: 'Buffett + Munger (Compounders)' },
  { id: 'graham_marks', label: 'Graham + Marks (Defensive Value)' },
  { id: 'lynch_fisher', label: 'Lynch + Fisher (Sustainable Growth)' },
  { id: 'greenblatt_graham', label: 'Greenblatt + Graham (Value + ROIC)' },
  { id: 'buffett_pabrai', label: 'Buffett + Pabrai (Quality + Asymmetric)' },
  { id: 'marks_templeton', label: 'Marks + Templeton (Contrarian)' },
];

const TABLE_LENSES: Array<{ id: TableLens; label: string }> = [
  { id: 'overview', label: 'Overview & Investors' },
  { id: 'growth', label: 'Growth & Prev-Quarter Δ' },
  { id: 'valuation', label: 'Valuation & Balance Sheet' },
  { id: 'investors', label: '9-Investor Matrix' },
];

function fmtNullable(v: number | null | undefined, suffix = '', digits = 1): string {
  return v !== null && v !== undefined && Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : '—';
}

function fmtSignedPct(v: number | null | undefined, suffix = '%', digits = 1): React.ReactNode {
  if (v === null || v === undefined || !Number.isFinite(v)) {
    return <span className="text-slate-400">—</span>;
  }
  const color =
    v > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : v < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-slate-600 dark:text-slate-300';
  return (
    <span className={color}>
      {v >= 0 ? `+${v.toFixed(digits)}${suffix}` : `${v.toFixed(digits)}${suffix}`}
    </span>
  );
}

function parseFilterNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function renderInvestorCell(score: number, hasData: boolean): React.ReactNode {
  if (!hasData) return <span className="text-slate-400">—</span>;
  const cls =
    score >= 70
      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
      : score >= 65
        ? 'text-blue-600 dark:text-blue-400 font-medium'
        : score < 45
          ? 'text-slate-400'
          : 'text-slate-700 dark:text-slate-300';
  return <span className={cls}>{score.toFixed(0)}</span>;
}

export const FundamentalScreenerView: React.FC<FundamentalScreenerViewProps> = ({
  equityOnly,
  initialTarget,
  onInspectSymbol,
  onInspectInAnalyzer,
  onOpenValuation,
  onSymbolChange,
}) => {
  const [subView, setSubView] = useState<'screener' | 'gems' | 'monitor'>('screener');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  useEffect(() => {
    if (initialTarget?.symbol) {
      setSelectedSymbol(initialTarget.symbol);
    }
  }, [initialTarget?.symbol, initialTarget?.tick]);

  useEffect(() => {
    if (selectedSymbol) onSymbolChange?.(selectedSymbol);
  }, [selectedSymbol, onSymbolChange]);

  const [overview, setOverview] = useState<ScreenerOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Screener Filters & Lenses
  const [rankingTab, setRankingTab] = useState<'all' | RankingCategory>('all');
  const [consensusFilter, setConsensusFilter] = useState<'all' | ConsensusTag>('all');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [fiscalYearFilter, setFiscalYearFilter] = useState<string>('');
  const [quarterFilter, setQuarterFilter] = useState<'' | QuarterCode>('');
  const [annualWeightPct, setAnnualWeightPct] = useState<number>(70);
  const [onlyEvaluated, setOnlyEvaluated] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<string>('overallScore');

  const [activePreset, setActivePreset] = useState<string>('all');
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [numFilters, setNumFilters] = useState<NumericFilterState>(EMPTY_NUMERIC_FILTERS);
  const [tableLens, setTableLens] = useState<TableLens>('overview');

  const [showCharts, setShowCharts] = useState<boolean>(true);
  const [matrixExpanded, setMatrixExpanded] = useState<boolean>(false);
  const [showSimulator, setShowSimulator] = useState<boolean>(false);
  const [simulatorSymbol, setSimulatorSymbol] = useState<string | null>(null);
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchPulling, setBatchPulling] = useState<boolean>(false);

  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        equityOnly: String(equityOnly),
        sortBy,
        annualWeightPct: String(annualWeightPct),
      });
      if (fiscalYearFilter) qs.set('fiscalYear', fiscalYearFilter);
      if (quarterFilter) qs.set('quarter', quarterFilter);

      const res = await fetch(`/api/screener/overview?${qs.toString()}`);
      if (!res.ok) throw new Error('Failed to load fundamental screener overview');
      const data = (await res.json()) as ScreenerOverviewResponse;
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load screener');
    } finally {
      setLoading(false);
    }
  }, [annualWeightPct, equityOnly, fiscalYearFilter, quarterFilter, sortBy]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const top25Needed = useMemo(() => {
    if (!overview) return [];
    const { fiscalYear, quarter } = overview.activeFiscalQuarter;
    return [...overview.rows]
      .sort((a, b) => (b.market.turnover ?? 0) - (a.market.turnover ?? 0))
      .slice(0, 25)
      .filter(
        (r) =>
          !(
            r.hasFundamentalData &&
            r.latestPeriod.fiscalYear === fiscalYear &&
            r.latestPeriod.quarter === quarter
          )
      );
  }, [overview]);

  const triggerTop25Pull = async () => {
    if (top25Needed.length === 0 || batchPulling) return;
    setBatchPulling(true);
    setBatchMessage(null);
    try {
      const res = await fetch('/api/screener/refresh-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'top25', force: false }),
      });
      const data = await res.json();
      setBatchMessage(data.message || 'Started Top 25 quarterly collection.');
      setSubView('monitor');
    } catch (err) {
      setBatchMessage(err instanceof Error ? err.message : 'Failed to start collection');
    } finally {
      setBatchPulling(false);
    }
  };

  const applyPreset = (preset: StrategyPreset) => {
    setActivePreset(preset.id);
    setNumFilters({ ...EMPTY_NUMERIC_FILTERS, ...preset.filters });
    setOnlyEvaluated(preset.onlyEvaluated);
    if (preset.lens) setTableLens(preset.lens);
    if (preset.sortBy) setSortBy(preset.sortBy);
    if (preset.id !== 'all') {
      setFiltersOpen(true);
    }
  };

  const resetAllFilters = () => {
    setActivePreset('all');
    setNumFilters(EMPTY_NUMERIC_FILTERS);
    setRankingTab('all');
    setConsensusFilter('all');
    setSectorFilter('All');
    setSearchQuery('');
    setOnlyEvaluated(false);
  };

  const updateNumFilter = <K extends keyof NumericFilterState>(
    key: K,
    val: NumericFilterState[K]
  ) => {
    setActivePreset('custom');
    setNumFilters((prev) => ({ ...prev, [key]: val }));
  };

  const activeNumericFilterCount = useMemo(() => {
    let count = 0;
    for (const [k, v] of Object.entries(numFilters)) {
      if (k === 'improvingQoq') {
        if (v === true) count++;
      } else if (typeof v === 'string' && v.trim() !== '') {
        count++;
      }
    }
    return count;
  }, [numFilters]);

  const toggleCompareSymbol = useCallback((symbol: string) => {
    setCompareSymbols((prev) => {
      if (prev.includes(symbol)) {
        return prev.filter((s) => s !== symbol);
      }
      if (prev.length >= 4) {
        return [...prev.slice(1), symbol];
      }
      return [...prev, symbol];
    });
  }, []);

  const filteredRows = useMemo(() => {
    if (!overview) return [];
    let rows = overview.rows;

    if (onlyEvaluated) rows = rows.filter((r) => r.hasFundamentalData);
    if (sectorFilter !== 'All') {
      rows = rows.filter(
        (r) => r.sector === sectorFilter || r.sectorGroup === sectorFilter
      );
    }
    if (rankingTab !== 'all') {
      rows = rows.filter((r) => r.rankingQualifiers.includes(rankingTab));
    }
    if (consensusFilter !== 'all') {
      rows = rows.filter((r) =>
        r.consensusMatches.some((c) => c.id === consensusFilter && c.qualified)
      );
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.symbol.toLowerCase().includes(q) ||
          r.companyName.toLowerCase().includes(q) ||
          r.sector.toLowerCase().includes(q)
      );
    }

    const minPe = parseFilterNum(numFilters.minPe);
    const maxPe = parseFilterNum(numFilters.maxPe);
    const maxPb = parseFilterNum(numFilters.maxPb);
    const maxPeg = parseFilterNum(numFilters.maxPeg);
    const minEps = parseFilterNum(numFilters.minEps);
    const minRoe = parseFilterNum(numFilters.minRoe);
    const minRoa = parseFilterNum(numFilters.minRoa);
    const minNetMargin = parseFilterNum(numFilters.minNetMargin);
    const minEpsQoq = parseFilterNum(numFilters.minEpsQoq);
    const minEpsYoy = parseFilterNum(numFilters.minEpsYoy);
    const minProfitYoy = parseFilterNum(numFilters.minProfitYoy);
    const minRevenueYoy = parseFilterNum(numFilters.minRevenueYoy);
    const minCagr3y = parseFilterNum(numFilters.minCagr3y);
    const maxDe = parseFilterNum(numFilters.maxDe);
    const maxNpl = parseFilterNum(numFilters.maxNpl);
    const minMos = parseFilterNum(numFilters.minMos);
    const minQuality = parseFilterNum(numFilters.minQuality);

    if (minPe !== null) rows = rows.filter((r) => r.keyMetrics.pe !== null && r.keyMetrics.pe >= minPe);
    if (maxPe !== null) {
      rows = rows.filter((r) => r.keyMetrics.pe !== null && r.keyMetrics.pe > 0 && r.keyMetrics.pe <= maxPe);
    }
    if (maxPb !== null) {
      rows = rows.filter((r) => r.keyMetrics.pb !== null && r.keyMetrics.pb > 0 && r.keyMetrics.pb <= maxPb);
    }
    if (maxPeg !== null) {
      rows = rows.filter((r) => r.keyMetrics.peg !== null && r.keyMetrics.peg > 0 && r.keyMetrics.peg <= maxPeg);
    }
    if (minEps !== null) rows = rows.filter((r) => r.keyMetrics.eps !== null && r.keyMetrics.eps >= minEps);
    if (minRoe !== null) rows = rows.filter((r) => r.keyMetrics.roePct !== null && r.keyMetrics.roePct >= minRoe);
    if (minRoa !== null) rows = rows.filter((r) => r.keyMetrics.roaPct !== null && r.keyMetrics.roaPct >= minRoa);
    if (minNetMargin !== null) {
      rows = rows.filter((r) => r.keyMetrics.netMarginPct !== null && r.keyMetrics.netMarginPct >= minNetMargin);
    }
    if (minEpsQoq !== null) {
      rows = rows.filter((r) => r.keyMetrics.epsQoqPct !== null && r.keyMetrics.epsQoqPct >= minEpsQoq);
    }
    if (minEpsYoy !== null) {
      rows = rows.filter((r) => r.keyMetrics.epsYoyPct !== null && r.keyMetrics.epsYoyPct >= minEpsYoy);
    }
    if (minProfitYoy !== null) {
      rows = rows.filter(
        (r) => r.keyMetrics.netProfitYoyPct !== null && r.keyMetrics.netProfitYoyPct >= minProfitYoy
      );
    }
    if (minRevenueYoy !== null) {
      rows = rows.filter(
        (r) => r.keyMetrics.revenueYoyPct !== null && r.keyMetrics.revenueYoyPct >= minRevenueYoy
      );
    }
    if (minCagr3y !== null) {
      rows = rows.filter(
        (r) => r.keyMetrics.epsCagr3yPct !== null && r.keyMetrics.epsCagr3yPct >= minCagr3y
      );
    }
    if (maxDe !== null) {
      rows = rows.filter((r) => r.keyMetrics.debtToEquity === null || r.keyMetrics.debtToEquity <= maxDe);
    }
    if (maxNpl !== null) {
      rows = rows.filter((r) => r.keyMetrics.nplPct === null || r.keyMetrics.nplPct <= maxNpl);
    }
    if (minMos !== null) {
      rows = rows.filter((r) => (r.keyMetrics.marginOfSafetyPct ?? -999) >= minMos);
    }
    if (minQuality !== null) {
      rows = rows.filter((r) => r.scores.fundamentalQualityScore >= minQuality);
    }
    if (numFilters.improvingQoq) {
      rows = rows.filter((r) => r.keyMetrics.epsQoqPct !== null && r.keyMetrics.epsQoqPct > 0);
    }

    return rows;
  }, [
    overview,
    onlyEvaluated,
    sectorFilter,
    rankingTab,
    consensusFilter,
    searchQuery,
    numFilters,
  ]);

  const compareRows = useMemo(() => {
    if (!overview || compareSymbols.length === 0) return [];
    const bySym = new Map(overview.rows.map((r) => [r.symbol, r]));
    return compareSymbols
      .map((s) => bySym.get(s))
      .filter((r): r is ScreenedCompanyRow => Boolean(r));
  }, [overview, compareSymbols]);

  const evaluatedCandidates = useMemo(() => {
    if (!overview) return [];
    return overview.rows.filter((r) => r.hasFundamentalData && r.market.ltp !== null);
  }, [overview]);

  // "Aha!" Conviction Spotlights derived strictly from live evaluated dataset
  const spotlights = useMemo(() => {
    if (!overview) return null;
    const evaluated = overview.rows.filter((r) => r.hasFundamentalData);
    if (evaluated.length === 0) return null;

    const topConsensus = [...evaluated].sort(
      (a, b) =>
        b.passedInvestorCount - a.passedInvestorCount ||
        b.scores.overallScore - a.scores.overallScore
    )[0];

    const withGrowth = evaluated.filter(
      (r) => r.keyMetrics.epsQoqPct !== null || r.keyMetrics.epsYoyPct !== null
    );
    const fastestAccelerator = (withGrowth.length > 0 ? withGrowth : evaluated).sort((a, b) => {
      const ag = a.keyMetrics.epsQoqPct ?? a.keyMetrics.epsYoyPct ?? a.scores.growthScore;
      const bg = b.keyMetrics.epsQoqPct ?? b.keyMetrics.epsYoyPct ?? b.scores.growthScore;
      return bg - ag;
    })[0];

    const withMos = evaluated.filter(
      (r) =>
        r.keyMetrics.marginOfSafetyPct !== null &&
        r.scores.riskManagementScore >= 55
    );
    const widestMos = (withMos.length > 0 ? withMos : evaluated).sort(
      (a, b) =>
        (b.keyMetrics.marginOfSafetyPct ?? -999) - (a.keyMetrics.marginOfSafetyPct ?? -999)
    )[0];

    return { topConsensus, fastestAccelerator, widestMos };
  }, [overview]);

  const openSimulatorFor = useCallback((symbol: string) => {
    setSimulatorSymbol(symbol);
    setShowSimulator(true);
  }, []);

  const columns: ColumnDef<ScreenedCompanyRow>[] = useMemo(() => {
    const compareCol: ColumnDef<ScreenedCompanyRow> = {
      key: '_compare',
      label: 'Cmp',
      align: 'left',
      sortable: false,
      widthClass: 'w-9',
      render: (r) => {
        const checked = compareSymbols.includes(r.symbol);
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCompareSymbol(r.symbol);
            }}
            title={checked ? `Remove ${r.symbol} from comparison` : `Add ${r.symbol} to peer comparison (max 4)`}
            className={`p-0.5 transition-colors ${
              checked
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {checked ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
          </button>
        );
      },
    };

    const starCol = createWatchlistColumn<ScreenedCompanyRow>({
      getSymbol: (r) => r.symbol,
      hasSymbol,
      toggleSymbol,
    });

    const symbolCol: ColumnDef<ScreenedCompanyRow> = {
      key: 'symbol',
      label: 'Symbol',
      align: 'left',
      sortValue: (r) => r.symbol,
      csvValue: (r) => r.symbol,
      render: (r) => (
        <div>
          <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
            {r.symbol}
          </span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
            {r.sector}
          </span>
        </div>
      ),
    };

    if (tableLens === 'growth') {
      return [
        compareCol,
        starCol,
        symbolCol,
        {
          key: 'periods',
          label: 'Period · Prev Q · Last Yr',
          align: 'left',
          sortValue: (r) => r.latestPeriod.periodLabel,
          csvValue: (r) =>
            [
              r.latestPeriod.periodLabel,
              r.keyMetrics.prevPeriodLabel ? `Q:${r.keyMetrics.prevPeriodLabel}` : null,
              r.keyMetrics.yoyPeriodLabel ? `Y:${r.keyMetrics.yoyPeriodLabel}` : null,
            ]
              .filter(Boolean)
              .join(' | '),
          render: (r) => (
            <div className="text-[11px] font-mono">
              <div className="text-slate-800 dark:text-slate-200">{r.latestPeriod.periodLabel}</div>
              <div className="text-slate-400">
                Q: {r.keyMetrics.prevPeriodLabel ?? '—'} · Y: {r.keyMetrics.yoyPeriodLabel ?? '—'}
              </div>
            </div>
          ),
        },
        {
          key: 'epsTrend',
          label: 'EPS (Growth Trend)',
          align: 'right',
          sortValue: (r) => r.keyMetrics.eps,
          csvValue: (r) => r.keyMetrics.eps,
          render: (r) => (
            <MetricTrendCell
              metricName="EPS"
              currentValue={r.keyMetrics.eps}
              digits={2}
              qoqPct={r.keyMetrics.epsQoqPct}
              yoyPct={r.keyMetrics.epsYoyPct}
              prevPeriodLabel={r.keyMetrics.prevPeriodLabel}
              prevValue={r.keyMetrics.prevEps}
              yoyPeriodLabel={r.keyMetrics.yoyPeriodLabel}
              yoyValue={r.keyMetrics.yoyEps}
              series={r.keyMetrics.trends.eps}
              periods={r.keyMetrics.trends.periods}
            />
          ),
        },
        {
          key: 'epsBaselines',
          label: 'EPS Prev Q · Last Yr',
          align: 'right',
          sortValue: (r) => r.keyMetrics.epsYoyPct ?? r.keyMetrics.epsQoqPct,
          csvValue: (r) => r.keyMetrics.epsYoyPct,
          render: (r) => (
            <div className="text-[11px] font-mono tabular-nums">
              <div className="text-slate-600 dark:text-slate-300">
                Prev Q: {fmtNullable(r.keyMetrics.prevEps, '', 2)}
              </div>
              <div className="text-slate-400">
                Last Yr: {fmtNullable(r.keyMetrics.yoyEps, '', 2)}
              </div>
            </div>
          ),
        },
        {
          key: 'revenueTrend',
          label: 'Revenue (Growth Trend)',
          align: 'right',
          sortValue: (r) => r.keyMetrics.revenueCr,
          csvValue: (r) => r.keyMetrics.revenueCr,
          render: (r) => (
            <MetricTrendCell
              metricName="Revenue"
              currentValue={r.keyMetrics.revenueCr}
              unit=" Cr"
              digits={1}
              qoqPct={r.keyMetrics.revenueQoqPct}
              yoyPct={r.keyMetrics.revenueYoyPct}
              prevPeriodLabel={r.keyMetrics.prevPeriodLabel}
              prevValue={r.keyMetrics.prevRevenueCr}
              yoyPeriodLabel={r.keyMetrics.yoyPeriodLabel}
              yoyValue={r.keyMetrics.yoyRevenueCr}
              series={r.keyMetrics.trends.revenueCr}
              periods={r.keyMetrics.trends.periods}
            />
          ),
        },
        {
          key: 'revenueBaselines',
          label: 'Rev Prev Q · Last Yr',
          align: 'right',
          sortValue: (r) => r.keyMetrics.revenueYoyPct ?? r.keyMetrics.revenueQoqPct,
          csvValue: (r) => r.keyMetrics.revenueYoyPct,
          render: (r) => (
            <div className="text-[11px] font-mono tabular-nums">
              <div className="text-slate-600 dark:text-slate-300">
                Prev Q: {fmtNullable(r.keyMetrics.prevRevenueCr, ' Cr', 1)}
              </div>
              <div className="text-slate-400">
                Last Yr: {fmtNullable(r.keyMetrics.yoyRevenueCr, ' Cr', 1)}
              </div>
            </div>
          ),
        },
        {
          key: 'profitTrend',
          label: 'Net Profit (Growth Trend)',
          align: 'right',
          sortValue: (r) => r.keyMetrics.netProfitCr,
          csvValue: (r) => r.keyMetrics.netProfitCr,
          render: (r) => (
            <MetricTrendCell
              metricName="Net Profit"
              currentValue={r.keyMetrics.netProfitCr}
              unit=" Cr"
              digits={1}
              qoqPct={r.keyMetrics.netProfitQoqPct}
              yoyPct={r.keyMetrics.netProfitYoyPct}
              prevPeriodLabel={r.keyMetrics.prevPeriodLabel}
              prevValue={r.keyMetrics.prevNetProfitCr}
              yoyPeriodLabel={r.keyMetrics.yoyPeriodLabel}
              yoyValue={r.keyMetrics.yoyNetProfitCr}
              series={r.keyMetrics.trends.netProfitCr}
              periods={r.keyMetrics.trends.periods}
            />
          ),
        },
        {
          key: 'profitBaselines',
          label: 'NP Prev Q · Last Yr',
          align: 'right',
          sortValue: (r) => r.keyMetrics.netProfitYoyPct ?? r.keyMetrics.netProfitQoqPct,
          csvValue: (r) => r.keyMetrics.netProfitYoyPct,
          render: (r) => (
            <div className="text-[11px] font-mono tabular-nums">
              <div className="text-slate-600 dark:text-slate-300">
                Prev Q: {fmtNullable(r.keyMetrics.prevNetProfitCr, ' Cr', 1)}
              </div>
              <div className="text-slate-400">
                Last Yr: {fmtNullable(r.keyMetrics.yoyNetProfitCr, ' Cr', 1)}
              </div>
            </div>
          ),
        },
        {
          key: 'growthTrend',
          label: 'Growth Trend',
          align: 'left',
          sortValue: (r) => (r.hasFundamentalData ? r.scores.growthScore : -1),
          csvValue: (r) => r.scores.growthScore,
          render: (r) => <CompositeGrowthTrendCell row={r} />,
        },
        {
          key: 'cagr3y',
          label: '3Y EPS CAGR',
          align: 'right',
          sortValue: (r) => r.keyMetrics.epsCagr3yPct,
          csvValue: (r) => r.keyMetrics.epsCagr3yPct,
          render: (r) => fmtSignedPct(r.keyMetrics.epsCagr3yPct),
        },
        {
          key: 'roeDelta',
          label: 'ROE Δ pp',
          align: 'right',
          sortValue: (r) => r.keyMetrics.roeQoqDeltaPct,
          csvValue: (r) => r.keyMetrics.roeQoqDeltaPct,
          render: (r) => fmtSignedPct(r.keyMetrics.roeQoqDeltaPct, ' pp', 2),
        },
      ];
    }

    if (tableLens === 'valuation') {
      return [
        compareCol,
        starCol,
        symbolCol,
        {
          key: 'ltp',
          label: 'LTP',
          align: 'right',
          sortValue: (r) => r.market.ltp,
          render: (r) => fmtNullable(r.market.ltp),
        },
        {
          key: 'intrinsic',
          label: 'Intrinsic Range',
          align: 'right',
          sortValue: (r) => r.keyMetrics.intrinsicValue,
          csvValue: (r) => r.keyMetrics.intrinsicValue,
          render: (r) =>
            r.keyMetrics.intrinsicValue !== null ? (
              <div>
                <span>{r.keyMetrics.intrinsicValue.toFixed(1)}</span>
                {r.keyMetrics.intrinsicValueLow !== null && r.keyMetrics.intrinsicValueHigh !== null && (
                  <span className="block text-[10px] text-slate-400">
                    {r.keyMetrics.intrinsicValueLow.toFixed(0)}–{r.keyMetrics.intrinsicValueHigh.toFixed(0)}
                  </span>
                )}
              </div>
            ) : (
              '—'
            ),
        },
        {
          key: 'mos',
          label: 'MoS %',
          align: 'right',
          sortValue: (r) => r.keyMetrics.marginOfSafetyPct,
          render: (r) => fmtSignedPct(r.keyMetrics.marginOfSafetyPct),
        },
        {
          key: 'ey',
          label: 'Earn Yield',
          align: 'right',
          sortValue: (r) => r.keyMetrics.earningsYieldPct,
          render: (r) => fmtNullable(r.keyMetrics.earningsYieldPct, '%', 2),
        },
        {
          key: 'pe',
          label: 'P/E',
          align: 'right',
          sortValue: (r) => r.keyMetrics.pe,
          render: (r) => fmtNullable(r.keyMetrics.pe, 'x'),
        },
        {
          key: 'pb',
          label: 'P/B',
          align: 'right',
          sortValue: (r) => r.keyMetrics.pb,
          render: (r) => fmtNullable(r.keyMetrics.pb, 'x', 2),
        },
        {
          key: 'peg',
          label: 'PEG',
          align: 'right',
          sortValue: (r) => r.keyMetrics.peg,
          render: (r) => fmtNullable(r.keyMetrics.peg, 'x', 2),
        },
        {
          key: 'bvps',
          label: 'BVPS',
          align: 'right',
          sortValue: (r) => r.keyMetrics.bvps,
          render: (r) => fmtNullable(r.keyMetrics.bvps),
        },
        {
          key: 'netMargin',
          label: 'Net Margin',
          align: 'right',
          sortValue: (r) => r.keyMetrics.netMarginPct,
          render: (r) => fmtNullable(r.keyMetrics.netMarginPct, '%'),
        },
        {
          key: 'roa',
          label: 'ROA %',
          align: 'right',
          sortValue: (r) => r.keyMetrics.roaPct,
          render: (r) => fmtNullable(r.keyMetrics.roaPct, '%', 2),
        },
        {
          key: 'roic',
          label: 'ROIC %',
          align: 'right',
          sortValue: (r) => r.keyMetrics.roicPct,
          render: (r) => fmtNullable(r.keyMetrics.roicPct, '%', 1),
        },
        {
          key: 'de',
          label: 'D/E',
          align: 'right',
          sortValue: (r) => r.keyMetrics.debtToEquity,
          render: (r) => fmtNullable(r.keyMetrics.debtToEquity, 'x', 2),
        },
        {
          key: 'npl',
          label: 'NPL %',
          align: 'right',
          sortValue: (r) => r.keyMetrics.nplPct,
          render: (r) => fmtNullable(r.keyMetrics.nplPct, '%', 2),
        },
        {
          key: 'car',
          label: 'CAR %',
          align: 'right',
          sortValue: (r) => r.keyMetrics.carPct,
          render: (r) => fmtNullable(r.keyMetrics.carPct, '%', 1),
        },
      ];
    }

    if (tableLens === 'investors') {
      return [
        compareCol,
        starCol,
        symbolCol,
        {
          key: 'overallScore',
          label: 'Overall',
          align: 'right',
          sortValue: (r) => (r.hasFundamentalData ? r.scores.overallScore : -1),
          render: (r) =>
            r.hasFundamentalData ? (
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {r.scores.overallScore.toFixed(1)}
              </span>
            ) : (
              <span className="text-slate-400 text-[11px]">{r.reportingStatus}</span>
            ),
        },
        {
          key: 'consensus',
          label: 'Passed',
          align: 'right',
          sortValue: (r) => r.passedInvestorCount,
          render: (r) => (r.hasFundamentalData ? `${r.passedInvestorCount}/9` : '—'),
        },
        {
          key: 'buffett',
          label: 'Buffett',
          align: 'right',
          sortValue: (r) => r.investorScores.buffett,
          render: (r) => renderInvestorCell(r.investorScores.buffett, r.hasFundamentalData),
        },
        {
          key: 'munger',
          label: 'Munger',
          align: 'right',
          sortValue: (r) => r.investorScores.munger,
          render: (r) => renderInvestorCell(r.investorScores.munger, r.hasFundamentalData),
        },
        {
          key: 'graham',
          label: 'Graham',
          align: 'right',
          sortValue: (r) => r.investorScores.graham,
          render: (r) => renderInvestorCell(r.investorScores.graham, r.hasFundamentalData),
        },
        {
          key: 'lynch',
          label: 'Lynch',
          align: 'right',
          sortValue: (r) => r.investorScores.lynch,
          render: (r) => renderInvestorCell(r.investorScores.lynch, r.hasFundamentalData),
        },
        {
          key: 'marks',
          label: 'Marks',
          align: 'right',
          sortValue: (r) => r.investorScores.marks,
          render: (r) => renderInvestorCell(r.investorScores.marks, r.hasFundamentalData),
        },
        {
          key: 'fisher',
          label: 'Fisher',
          align: 'right',
          sortValue: (r) => r.investorScores.fisher,
          render: (r) => renderInvestorCell(r.investorScores.fisher, r.hasFundamentalData),
        },
        {
          key: 'greenblatt',
          label: 'Greenblatt',
          align: 'right',
          sortValue: (r) => r.investorScores.greenblatt,
          render: (r) => renderInvestorCell(r.investorScores.greenblatt, r.hasFundamentalData),
        },
        {
          key: 'templeton',
          label: 'Templeton',
          align: 'right',
          sortValue: (r) => r.investorScores.templeton,
          render: (r) => renderInvestorCell(r.investorScores.templeton, r.hasFundamentalData),
        },
        {
          key: 'pabrai',
          label: 'Pabrai',
          align: 'right',
          sortValue: (r) => r.investorScores.pabrai,
          render: (r) => renderInvestorCell(r.investorScores.pabrai, r.hasFundamentalData),
        },
      ];
    }

    // Default 'overview' lens
    return [
      compareCol,
      starCol,
      symbolCol,
      {
        key: 'overallScore',
        label: 'Overall',
        align: 'right',
        sortValue: (r) => (r.hasFundamentalData ? r.scores.overallScore : -1),
        render: (r) =>
          r.hasFundamentalData ? (
            <span
              className={`font-semibold ${
                r.scores.overallScore >= 65
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : r.scores.overallScore >= 50
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {r.scores.overallScore.toFixed(1)}
            </span>
          ) : (
            <span className="text-slate-400 text-[11px]">{r.reportingStatus}</span>
          ),
      },
      {
        key: 'verdict',
        label: 'Verdict · Inv',
        align: 'left',
        sortValue: (r) => r.passedInvestorCount,
        csvValue: (r) => `${r.recommendation.verdict} (${r.passedInvestorCount}/9)`,
        render: (r) => (
          <div>
            <span
              className={`text-[11px] font-semibold ${
                r.recommendation.verdict === 'STRONG BUY' || r.recommendation.verdict === 'BUY'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : r.recommendation.verdict === 'ACCUMULATE' || r.recommendation.verdict === 'WATCHLIST'
                    ? 'text-blue-600 dark:text-blue-400'
                    : r.recommendation.verdict === 'AVOID'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {r.recommendation.verdict}
            </span>
            <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400">
              {r.hasFundamentalData ? `${r.passedInvestorCount}/9 passed` : 'Pending'}
            </span>
          </div>
        ),
      },
      {
        key: 'ltp',
        label: 'LTP · Intrinsic',
        align: 'right',
        sortValue: (r) => r.market.ltp,
        csvValue: (r) => r.market.ltp,
        render: (r) => (
          <div>
            <span>{fmtNullable(r.market.ltp)}</span>
            <span className="block text-[10px] text-slate-400">
              IV {fmtNullable(r.keyMetrics.intrinsicValue)}
            </span>
          </div>
        ),
      },
      {
        key: 'mos',
        label: 'MoS %',
        align: 'right',
        sortValue: (r) => r.keyMetrics.marginOfSafetyPct,
        render: (r) => fmtSignedPct(r.keyMetrics.marginOfSafetyPct),
      },
      {
        key: 'pe',
        label: 'P/E · P/B',
        align: 'right',
        sortValue: (r) => r.keyMetrics.pe,
        csvValue: (r) => r.keyMetrics.pe,
        render: (r) => (
          <div>
            <span>{fmtNullable(r.keyMetrics.pe, 'x')}</span>
            <span className="block text-[10px] text-slate-400">
              P/B {fmtNullable(r.keyMetrics.pb, 'x', 2)}
            </span>
          </div>
        ),
      },
      {
        key: 'roe',
        label: 'ROE %',
        align: 'right',
        sortValue: (r) => r.keyMetrics.roePct,
        render: (r) => fmtNullable(r.keyMetrics.roePct, '%'),
      },
      {
        key: 'eps',
        label: 'EPS',
        align: 'right',
        sortValue: (r) => r.keyMetrics.eps,
        csvValue: (r) => r.keyMetrics.eps,
        render: (r) => (
          <MetricTrendCell
            metricName="EPS"
            currentValue={r.keyMetrics.eps}
            digits={2}
            qoqPct={r.keyMetrics.epsQoqPct}
            yoyPct={r.keyMetrics.epsYoyPct}
            prevPeriodLabel={r.keyMetrics.prevPeriodLabel}
            prevValue={r.keyMetrics.prevEps}
            yoyPeriodLabel={r.keyMetrics.yoyPeriodLabel}
            yoyValue={r.keyMetrics.yoyEps}
            series={r.keyMetrics.trends.eps}
            periods={r.keyMetrics.trends.periods}
          />
        ),
      },
      {
        key: 'revenue',
        label: 'Revenue',
        align: 'right',
        sortValue: (r) => r.keyMetrics.revenueCr,
        csvValue: (r) => r.keyMetrics.revenueCr,
        render: (r) => (
          <MetricTrendCell
            metricName="Revenue"
            currentValue={r.keyMetrics.revenueCr}
            unit=" Cr"
            digits={1}
            qoqPct={r.keyMetrics.revenueQoqPct}
            yoyPct={r.keyMetrics.revenueYoyPct}
            prevPeriodLabel={r.keyMetrics.prevPeriodLabel}
            prevValue={r.keyMetrics.prevRevenueCr}
            yoyPeriodLabel={r.keyMetrics.yoyPeriodLabel}
            yoyValue={r.keyMetrics.yoyRevenueCr}
            series={r.keyMetrics.trends.revenueCr}
            periods={r.keyMetrics.trends.periods}
          />
        ),
      },
      {
        key: 'netProfit',
        label: 'Net Profit',
        align: 'right',
        sortValue: (r) => r.keyMetrics.netProfitCr,
        csvValue: (r) => r.keyMetrics.netProfitCr,
        render: (r) => (
          <MetricTrendCell
            metricName="Net Profit"
            currentValue={r.keyMetrics.netProfitCr}
            unit=" Cr"
            digits={1}
            qoqPct={r.keyMetrics.netProfitQoqPct}
            yoyPct={r.keyMetrics.netProfitYoyPct}
            prevPeriodLabel={r.keyMetrics.prevPeriodLabel}
            prevValue={r.keyMetrics.prevNetProfitCr}
            yoyPeriodLabel={r.keyMetrics.yoyPeriodLabel}
            yoyValue={r.keyMetrics.yoyNetProfitCr}
            series={r.keyMetrics.trends.netProfitCr}
            periods={r.keyMetrics.trends.periods}
          />
        ),
      },
      {
        key: 'growthTrend',
        label: 'Growth Trend',
        align: 'left',
        sortValue: (r) => (r.hasFundamentalData ? r.scores.growthScore : -1),
        csvValue: (r) => r.scores.growthScore,
        render: (r) => <CompositeGrowthTrendCell row={r} />,
      },
      {
        key: 'period',
        label: 'Period · Report Weight',
        align: 'left',
        sortValue: (r) => r.latestPeriod.periodLabel,
        render: (r) => (
          <div className="flex items-center gap-2">
            <div>
              <span className="block text-[11px] font-mono text-slate-600 dark:text-slate-400">
                {r.latestPeriod.periodLabel} · {r.latestPeriod.validationStatus}
              </span>
              {r.hasFundamentalData && (
                <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  {r.reportWeighting.basis === 'blended'
                    ? `${r.reportWeighting.annualWeightPct}% Annual (${r.reportWeighting.annualPeriodLabel}) · ${r.reportWeighting.interimWeightPct}% Qtr`
                    : r.reportWeighting.basis === 'annual_only'
                      ? 'Annual / Q4 Report'
                      : r.reportWeighting.basis === 'quarterly_only'
                        ? 'Interim Qtr Only'
                        : 'Selected Period'}
                </span>
              )}
            </div>
            {r.hasFundamentalData && r.market.ltp !== null && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openSimulatorFor(r.symbol);
                }}
                title={`Open What-If Target Price Simulator for ${r.symbol}`}
                className="px-1.5 py-0.5 text-[10px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-700 whitespace-nowrap"
              >
                Sim
              </button>
            )}
          </div>
        ),
      },
    ];
  }, [
    compareSymbols,
    hasSymbol,
    openSimulatorFor,
    tableLens,
    toggleCompareSymbol,
    toggleSymbol,
  ]);

  if (selectedSymbol) {
    return (
      <CompanyFundamentalDetail
        symbol={selectedSymbol}
        equityOnly={equityOnly}
        onBack={() => setSelectedSymbol(null)}
        onInspectSymbol={onInspectSymbol}
        onInspectInAnalyzer={onInspectInAnalyzer}
        onOpenValuation={onOpenValuation}
        onDataUpdated={() => void loadOverview()}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header & Sub-View Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              NEPSE Fundamental Intelligence &amp; 9-Investor Screener
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Quarterly &amp; annual statement engine · Sector-adjusted valuation ·
            Buffett, Munger, Graham, Lynch, Marks, Fisher, Greenblatt, Templeton &amp; Pabrai rules
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setSubView('screener')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium whitespace-nowrap ${
                subView === 'screener'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Screener Dashboard</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('gems')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium whitespace-nowrap ${
                subView === 'gems'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Gem className="w-3.5 h-3.5" />
              <span>Hidden Gems &amp; Regulatory KB</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('monitor')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium whitespace-nowrap ${
                subView === 'monitor'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              <span>Quarterly Monitor ({overview?.universeStats.pendingActiveQuarter ?? 0} pending)</span>
            </button>
          </div>

          {onOpenValuation && (
            <button
              type="button"
              onClick={() => onOpenValuation()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 whitespace-nowrap"
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Pricing &amp; Valuation</span>
            </button>
          )}

          <a
            href={`/api/screener/export?format=csv&equityOnly=${equityOnly}&annualWeightPct=${annualWeightPct}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </a>
          <a
            href={`/api/screener/export?format=excel&equityOnly=${equityOnly}&annualWeightPct=${annualWeightPct}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Excel</span>
          </a>
        </div>
      </div>

      {batchMessage && (
        <div className="px-4 py-2.5 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-800 dark:text-blue-200">
          {batchMessage}
        </div>
      )}

      {subView === 'gems' ? (
        <HiddenGemsKnowledgePanel
          equityOnly={equityOnly}
          annualWeightPct={annualWeightPct}
          onChangeAnnualWeightPct={setAnnualWeightPct}
          onSelectCompanyDossier={(sym) => setSelectedSymbol(sym)}
          onInspectSymbol={onInspectSymbol}
          onInspectInAnalyzer={onInspectInAnalyzer}
        />
      ) : subView === 'monitor' ? (
        <ReportingMonitorPanel
          equityOnly={equityOnly}
          onSelectSymbol={(sym) => setSelectedSymbol(sym)}
          onDataUpdated={() => void loadOverview()}
        />
      ) : loading && !overview ? (
        <div className="space-y-4">
          <div className="h-24 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-72 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        </div>
      ) : error ? (
        <div className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-lg p-4 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : overview ? (
        <>
          {/* Universe Stats Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Active Cycle</div>
              <div className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {overview.activeFiscalQuarter.quarter} {overview.activeFiscalQuarter.fiscalYear}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                +15d check: {overview.activeFiscalQuarter.checkStartDate}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Analyzed Companies
              </div>
              <div className="text-lg font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                {overview.universeStats.withFundamentals}{' '}
                <span className="text-xs font-normal text-slate-400">
                  / {overview.universeStats.totalSymbols}
                </span>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Fundamentally Strong
              </div>
              <div className="text-lg font-mono font-semibold text-blue-600 dark:text-blue-400 tabular-nums mt-0.5">
                {overview.rankingCounts.fundamentally_strong}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Undervalued (MoS)
              </div>
              <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {overview.rankingCounts.undervalued}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Buffett + Munger Match
              </div>
              <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {overview.consensusCounts.buffett_munger}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Batch Pull</span>
                <span className="font-mono tabular-nums text-[10px]">
                  {25 - top25Needed.length}/25
                </span>
              </div>
              <button
                type="button"
                disabled={top25Needed.length === 0 || batchPulling}
                onClick={() => void triggerTop25Pull()}
                title={
                  top25Needed.length === 0
                    ? `All Top 25 stocks already have ${overview.activeFiscalQuarter.quarter} ${overview.activeFiscalQuarter.fiscalYear} data (GitHub workflow handles upcoming quarters).`
                    : `Pull missing ${overview.activeFiscalQuarter.quarter} ${overview.activeFiscalQuarter.fiscalYear} reports: ${top25Needed
                        .slice(0, 8)
                        .map((r) => r.symbol)
                        .join(', ')}${top25Needed.length > 8 ? '…' : ''}`
                }
                className="mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                <RefreshCw className={`w-3 h-3 ${batchPulling ? 'animate-spin' : ''}`} />
                <span>
                  {top25Needed.length === 0
                    ? `${overview.activeFiscalQuarter.quarter} Complete (25/25)`
                    : batchPulling
                      ? 'Pulling…'
                      : `Pull Top 25 (${top25Needed.length} due)`}
                </span>
              </button>
            </div>
          </div>

          {/* Conviction Spotlights ("Aha!" Intelligence Strip) */}
          {spotlights && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
              {[
                {
                  eyebrow: 'Top Multi-Investor Consensus',
                  row: spotlights.topConsensus,
                  headline: `${spotlights.topConsensus.passedInvestorCount}/9 investors passed · Score ${spotlights.topConsensus.scores.overallScore.toFixed(1)}`,
                  subline: `ROE ${fmtNullable(spotlights.topConsensus.keyMetrics.roePct, '%')} · PE ${fmtNullable(spotlights.topConsensus.keyMetrics.pe, 'x')} · ${spotlights.topConsensus.recommendation.verdict}`,
                },
                {
                  eyebrow: 'Fastest Earnings Momentum',
                  row: spotlights.fastestAccelerator,
                  headline:
                    spotlights.fastestAccelerator.keyMetrics.epsQoqPct !== null
                      ? `EPS QoQ ${spotlights.fastestAccelerator.keyMetrics.epsQoqPct >= 0 ? '+' : ''}${spotlights.fastestAccelerator.keyMetrics.epsQoqPct.toFixed(1)}%`
                      : spotlights.fastestAccelerator.keyMetrics.epsYoyPct !== null
                        ? `EPS YoY ${spotlights.fastestAccelerator.keyMetrics.epsYoyPct >= 0 ? '+' : ''}${spotlights.fastestAccelerator.keyMetrics.epsYoyPct.toFixed(1)}%`
                        : `Growth Score ${spotlights.fastestAccelerator.scores.growthScore.toFixed(0)} / 100`,
                  subline: `EPS ${fmtNullable(spotlights.fastestAccelerator.keyMetrics.eps)} · Profit ${fmtNullable(spotlights.fastestAccelerator.keyMetrics.netProfitCr, 'Cr')} · ${spotlights.fastestAccelerator.latestPeriod.periodLabel}`,
                },
                {
                  eyebrow: 'Widest Safe Margin of Safety',
                  row: spotlights.widestMos,
                  headline: `MoS ${
                    spotlights.widestMos.keyMetrics.marginOfSafetyPct !== null
                      ? `${spotlights.widestMos.keyMetrics.marginOfSafetyPct >= 0 ? '+' : ''}${spotlights.widestMos.keyMetrics.marginOfSafetyPct.toFixed(1)}%`
                      : '—'
                  } · Intrinsic ${fmtNullable(spotlights.widestMos.keyMetrics.intrinsicValue)}`,
                  subline: `LTP ${fmtNullable(spotlights.widestMos.market.ltp)} · PE ${fmtNullable(spotlights.widestMos.keyMetrics.pe, 'x')} · PEG ${fmtNullable(spotlights.widestMos.keyMetrics.peg, 'x', 2)}`,
                },
              ].map((card) => (
                <div key={card.eyebrow} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>{card.eyebrow}</span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedSymbol(card.row.symbol)}
                        className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {card.row.symbol}
                      </button>
                      <span className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums truncate">
                        {card.headline}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums truncate">
                      {card.subline}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleCompareSymbol(card.row.symbol)}
                      className={`px-2 py-0.5 text-[10px] font-medium rounded border whitespace-nowrap ${
                        compareSymbols.includes(card.row.symbol)
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {compareSymbols.includes(card.row.symbol) ? 'Comparing' : '+ Compare'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openSimulatorFor(card.row.symbol)}
                      className="px-2 py-0.5 text-[10px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      Simulate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 1-Click Strategy Presets + Annual Report Weighting */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                Presets:
              </span>
              {STRATEGY_PRESETS.map((preset) => {
                const isSelected = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.hint}
                    onClick={() => applyPreset(preset)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                        : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Report Weight:
              </span>
              {[
                { val: 70, label: '70% Annual / 30% Qtr' },
                { val: 100, label: '100% Annual' },
                { val: 50, label: '50 / 50' },
                { val: 0, label: 'Latest Qtr' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setAnnualWeightPct(opt.val)}
                  className={`px-2 py-1 rounded text-[11px] font-mono font-medium transition-colors whitespace-nowrap ${
                    annualWeightPct === opt.val
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 8 Ranking Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-3">
            {RANKING_TABS.map((tab) => {
              const count =
                tab.id === 'all'
                  ? overview.rows.filter((r) => (onlyEvaluated ? r.hasFundamentalData : true)).length
                  : overview.rankingCounts[tab.id];
              const active = rankingTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRankingTab(tab.id)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}{' '}
                  <span className={`font-mono text-[11px] ${active ? 'opacity-90' : 'text-slate-400'}`}>
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Primary Search, Consensus, Period & Multi-Parameter Controls */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search symbol or company…"
                  className="w-full pl-8 pr-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>

              <select
                value={consensusFilter}
                onChange={(e) => setConsensusFilter(e.target.value as 'all' | ConsensusTag)}
                className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                {CONSENSUS_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                    {opt.id !== 'all' ? ` (${overview.consensusCounts[opt.id]})` : ''}
                  </option>
                ))}
              </select>

              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                <option value="All">All Sectors</option>
                {overview.sectors.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={fiscalYearFilter}
                  onChange={(e) => setFiscalYearFilter(e.target.value)}
                  className="px-2 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                >
                  <option value="">Latest FY</option>
                  {overview.fiscalYears.map((fy) => (
                    <option key={fy} value={fy}>
                      {fy}
                    </option>
                  ))}
                </select>
                <select
                  value={quarterFilter}
                  onChange={(e) => setQuarterFilter(e.target.value as '' | QuarterCode)}
                  className="px-2 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                >
                  <option value="">All Qtr</option>
                  <option value="Q1">Q1</option>
                  <option value="Q2">Q2</option>
                  <option value="Q3">Q3</option>
                  <option value="Q4">Q4</option>
                  <option value="Annual">Annual</option>
                </select>
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-2 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                <option value="overallScore">Sort: Overall Score</option>
                <option value="quality">Sort: Fundamental Quality</option>
                <option value="value">Sort: Valuation Score</option>
                <option value="mos">Sort: Margin of Safety</option>
                <option value="pe">Sort: Lowest P/E</option>
                <option value="peg">Sort: Lowest PEG</option>
                <option value="eps">Sort: Highest EPS</option>
                <option value="epsQoq">Sort: EPS QoQ %</option>
                <option value="epsYoy">Sort: EPS YoY %</option>
                <option value="profitYoy">Sort: Profit YoY %</option>
                <option value="cagr3y">Sort: 3Y EPS CAGR %</option>
                <option value="roe">Sort: ROE %</option>
                <option value="growth">Sort: Growth Score</option>
                <option value="consensus">Sort: Consensus Count</option>
                <option value="turnover">Sort: Turnover</option>
              </select>

              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded border font-medium whitespace-nowrap transition-colors ${
                    filtersOpen || activeNumericFilterCount > 0
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>
                    Params{activeNumericFilterCount > 0 ? ` (${activeNumericFilterCount})` : ''}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSimulator((v) => !v)}
                  title="Toggle What-If Margin-of-Safety Simulator"
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded border font-medium whitespace-nowrap transition-colors ${
                    showSimulator
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>What-If</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowCharts((v) => !v)}
                  title="Toggle visual scatter & composite charts"
                  className={`p-1.5 rounded border transition-colors ${
                    showCharts
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 text-slate-500'
                  }`}
                >
                  <BarChart2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Expandable Multi-Parameter Screener Filter Matrix */}
            {filtersOpen && (
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min P/E (x)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={numFilters.minPe}
                      onChange={(e) => updateNumFilter('minPe', e.target.value)}
                      placeholder="e.g. 5"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Max P/E (x)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={numFilters.maxPe}
                      onChange={(e) => updateNumFilter('maxPe', e.target.value)}
                      placeholder="e.g. 20"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Max P/B (x)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={numFilters.maxPb}
                      onChange={(e) => updateNumFilter('maxPb', e.target.value)}
                      placeholder="e.g. 2.5"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Max PEG (x)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={numFilters.maxPeg}
                      onChange={(e) => updateNumFilter('maxPeg', e.target.value)}
                      placeholder="e.g. 1.2"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min EPS (NPR)
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={numFilters.minEps}
                      onChange={(e) => updateNumFilter('minEps', e.target.value)}
                      placeholder="e.g. 15"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min MoS (%)
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={numFilters.minMos}
                      onChange={(e) => updateNumFilter('minMos', e.target.value)}
                      placeholder="e.g. 15"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min ROE (%)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={numFilters.minRoe}
                      onChange={(e) => updateNumFilter('minRoe', e.target.value)}
                      placeholder="e.g. 12"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min ROA (%)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={numFilters.minRoa}
                      onChange={(e) => updateNumFilter('minRoa', e.target.value)}
                      placeholder="e.g. 1.0"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min Net Margin (%)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={numFilters.minNetMargin}
                      onChange={(e) => updateNumFilter('minNetMargin', e.target.value)}
                      placeholder="e.g. 10"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Max D/E (x)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={numFilters.maxDe}
                      onChange={(e) => updateNumFilter('maxDe', e.target.value)}
                      placeholder="e.g. 1.0"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Max NPL (%)
                    </label>
                    <input
                      type="number"
                      step="0.2"
                      value={numFilters.maxNpl}
                      onChange={(e) => updateNumFilter('maxNpl', e.target.value)}
                      placeholder="e.g. 3.5"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min Quality Score
                    </label>
                    <input
                      type="number"
                      step="5"
                      value={numFilters.minQuality}
                      onChange={(e) => updateNumFilter('minQuality', e.target.value)}
                      placeholder="e.g. 60"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min EPS QoQ (%)
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={numFilters.minEpsQoq}
                      onChange={(e) => updateNumFilter('minEpsQoq', e.target.value)}
                      placeholder="e.g. 5"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min EPS YoY (%)
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={numFilters.minEpsYoy}
                      onChange={(e) => updateNumFilter('minEpsYoy', e.target.value)}
                      placeholder="e.g. 10"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min Profit YoY (%)
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={numFilters.minProfitYoy}
                      onChange={(e) => updateNumFilter('minProfitYoy', e.target.value)}
                      placeholder="e.g. 10"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min Rev YoY (%)
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={numFilters.minRevenueYoy}
                      onChange={(e) => updateNumFilter('minRevenueYoy', e.target.value)}
                      placeholder="e.g. 8"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Min 3Y CAGR (%)
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={numFilters.minCagr3y}
                      onChange={(e) => updateNumFilter('minCagr3y', e.target.value)}
                      placeholder="e.g. 10"
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset All</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={numFilters.improvingQoq}
                      onChange={(e) => updateNumFilter('improvingQoq', e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Only companies improving EPS vs previous quarter (EPS QoQ &gt; 0%)</span>
                  </label>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    Matching {filteredRows.length} / {overview.rows.length} symbols
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Interactive What-If Valuation Simulator */}
          {showSimulator && (
            <ValuationSensitivitySimulator
              candidates={evaluatedCandidates}
              selectedSymbol={simulatorSymbol}
              onSelectSymbol={(sym) => setSimulatorSymbol(sym)}
              onInspectSymbol={(sym) => setSelectedSymbol(sym)}
            />
          )}

          {/* Interactive Peer Comparison Arena (when 1-4 stocks pinned) */}
          {compareRows.length > 0 && (
            <PeerComparisonArena
              rows={compareRows}
              onRemoveSymbol={(sym) => toggleCompareSymbol(sym)}
              onInspectSymbol={(sym) => setSelectedSymbol(sym)}
              onClear={() => setCompareSymbols([])}
            />
          )}

          {/* Visual Comparison Charts */}
          {showCharts && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <QualityValuationScatterChart
                rows={filteredRows}
                onSelectSymbol={(sym) => setSelectedSymbol(sym)}
                compareSymbols={compareSymbols}
                onToggleCompare={toggleCompareSymbol}
                onOpenSimulator={openSimulatorFor}
                isExpanded={matrixExpanded}
                onToggleExpand={() => setMatrixExpanded((v) => !v)}
              />
              <TopStocksCompositeBarsChart
                rows={filteredRows}
                onSelectSymbol={(sym) => setSelectedSymbol(sym)}
              />
            </div>
          )}

          {/* Table Lenses + Evaluated Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex flex-wrap rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-xs">
              {TABLE_LENSES.map((lens) => (
                <button
                  key={lens.id}
                  type="button"
                  onClick={() => setTableLens(lens.id)}
                  className={`px-3 py-1.5 rounded font-medium whitespace-nowrap transition-colors ${
                    tableLens === lens.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {lens.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyEvaluated}
                  onChange={(e) => setOnlyEvaluated(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Collected financials only</span>
              </label>
              <div className="flex items-center gap-1.5 text-[11px]">
                <GitCompare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Check Cmp (up to 4) to compare</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Click row for 9-investor dossier</span>
              </div>
            </div>
          </div>

          {/* Main Screener Table */}
          <DataTable
            rows={filteredRows}
            columns={columns}
            rowKey={(r) => r.symbol}
            onRowClick={(r) => setSelectedSymbol(r.symbol)}
            maxHeightClass="max-h-[580px]"
            exportFilename={`nepse_screener_${tableLens}.csv`}
            watchlistFilter={{
              watchlist,
              getSymbol: (r) => r.symbol,
            }}
          />
        </>
      ) : null}
    </div>
  );
};
