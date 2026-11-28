import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpDown,
  Award,
  CandlestickChart,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Download,
  Filter,
  Flame,
  Gem,
  GitCompare,
  Layers,
  RefreshCw,
  Rocket,
  RotateCcw,
  Scale,
  Search,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { useCompareList } from '../hooks/useWatchlist';
import type {
  MasterScreenerPreset,
  MasterScreenerResponse,
  MasterScreenerRow,
  MasterTechnicalTrend,
} from '../types/fundamental';

interface MasterScreenerViewProps {
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer: (symbol: string) => void;
  onOpenValuation: (symbol: string) => void;
  onInspectInScreener: (symbol: string) => void;
}

type SortKey =
  | 'masterScore'
  | 'ltp'
  | 'changePct'
  | 'playerInterestScore'
  | 'avgTurnover20Cr'
  | 'turnoverSpikeMult'
  | 'technicalScore'
  | 'rsi14'
  | 'marginOfSafetyPct'
  | 'valuationHealthScore'
  | 'pe'
  | 'roePct'
  | 'earningsMomentumScore'
  | 'epsGrowth'
  | 'hiddenGemScore'
  | 'tenXScore'
  | 'bull5yMultiple';

const PRESET_MENUS: Array<{
  id: MasterScreenerPreset;
  label: string;
  subtitle: string;
  defaultSort: SortKey;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'master_all',
    label: 'Master Confluence',
    subtitle: 'Balanced best across Valuation, Fundamentals, Technicals & Player Flow',
    defaultSort: 'masterScore',
    icon: Layers,
  },
  {
    id: 'player_liquidity',
    label: 'Player Flow & Liquidity',
    subtitle: 'Active institutional/HNI ticket sizes, volume spikes & smart-money accumulation',
    defaultSort: 'playerInterestScore',
    icon: Flame,
  },
  {
    id: 'best_valuation',
    label: 'Best Valuation',
    subtitle: 'Deep Margin of Safety, Buy Zone entries, low P/E & FD yield spread',
    defaultSort: 'marginOfSafetyPct',
    icon: Scale,
  },
  {
    id: 'annual_gems',
    label: 'Annual Report Gems',
    subtitle: 'Annual/Q4 verified reports, high Reserve/Capital bonus cushions & hidden gems',
    defaultSort: 'hiddenGemScore',
    icon: Gem,
  },
  {
    id: 'fundamental_titans',
    label: 'Fundamental Titans',
    subtitle: '9-Investor framework qualifiers, high ROE moats & clean solvency',
    defaultSort: 'valuationHealthScore',
    icon: Award,
  },
  {
    id: 'earnings_accelerators',
    label: 'Earnings & Growth',
    subtitle: 'High EPS power, ROE compounding, FD spread & accelerating earnings momentum',
    defaultSort: 'earningsMomentumScore',
    icon: TrendingUp,
  },
  {
    id: 'technical_breakouts',
    label: 'Technical Breakouts',
    subtitle: '20D volume breakouts, Strong Uptrends, EMA20 & D120/D180 Golden Cross',
    defaultSort: 'technicalScore',
    icon: Activity,
  },
  {
    id: 'future_10x',
    label: 'Future 10x Runway',
    subtitle: 'Small/mid-cap runway, ROE compounding, earnings inflection & 5Y Bull upside',
    defaultSort: 'tenXScore',
    icon: Rocket,
  },
];

function fmtRs(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `Rs ${v.toFixed(digits)}`;
}

function fmtNum(v: number | null | undefined, digits = 1, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${suffix}`;
}

function fmtSigned(v: number | null | undefined, digits = 1, suffix = '%'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}${suffix}`;
}

function scoreTone(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'text-slate-400';
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400 font-bold';
  if (score >= 55) return 'text-blue-600 dark:text-blue-400 font-semibold';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-slate-500 dark:text-slate-400';
}

function trendBadgeTone(trend: MasterTechnicalTrend): string {
  switch (trend) {
    case 'Strong Uptrend':
      return 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300';
    case 'Uptrend':
      return 'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300';
    case 'Pullback in Uptrend':
      return 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300';
    case 'Base / Accumulation':
      return 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
    default:
      return 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300';
  }
}

export const MasterScreenerView: React.FC<MasterScreenerViewProps> = ({
  equityOnly,
  onInspectSymbol,
  onInspectInAnalyzer,
  onOpenValuation,
  onInspectInScreener,
}) => {
  const { hasCompare, toggleCompare } = useCompareList();
  const [annualWeightPct, setAnnualWeightPct] = useState<number>(70);
  const [data, setData] = useState<MasterScreenerResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [preset, setPreset] = useState<MasterScreenerPreset>('master_all');
  const [sortKey, setSortKey] = useState<SortKey>('masterScore');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [showFilters, setShowFilters] = useState<boolean>(true);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  // Filter States across all requested domains
  const [search, setSearch] = useState<string>('');
  const [sectorFilter, setSectorFilter] = useState<string>('ALL');
  const [annualOnly, setAnnualOnly] = useState<boolean>(false);
  const [excludeRiskFlags, setExcludeRiskFlags] = useState<boolean>(false);

  // Liquidity / Player filters
  const [minAvgTurnoverCr, setMinAvgTurnoverCr] = useState<string>('');
  const [minVolSpike, setMinVolSpike] = useState<string>('');
  const [accumulationOnly, setAccumulationOnly] = useState<boolean>(false);
  const [playerTierFilter, setPlayerTierFilter] = useState<string>('ALL');

  // Valuation filters
  const [minMosPct, setMinMosPct] = useState<string>('');
  const [maxPe, setMaxPe] = useState<string>('');
  const [maxPb, setMaxPb] = useState<string>('');
  const [minHealthScore, setMinHealthScore] = useState<string>('');
  const [inBuyZoneOnly, setInBuyZoneOnly] = useState<boolean>(false);
  const [beatsFdOnly, setBeatsFdOnly] = useState<boolean>(false);

  // Technical filters
  const [trendFilter, setTrendFilter] = useState<string>('ALL');
  const [rsiBand, setRsiBand] = useState<'ALL' | 'sweet_spot' | 'oversold' | 'momentum'>('ALL');
  const [aboveEma20Only, setAboveEma20Only] = useState<boolean>(false);
  const [breakout20dOnly, setBreakout20dOnly] = useState<boolean>(false);

  // Fundamental, Earnings, Gems & 10x filters
  const [minRoePct, setMinRoePct] = useState<string>('');
  const [minPassedInvestors, setMinPassedInvestors] = useState<string>('');
  const [minReserveCap, setMinReserveCap] = useState<string>('');
  const [minEpsGrowth, setMinEpsGrowth] = useState<string>('');
  const [positiveEpsOnly, setPositiveEpsOnly] = useState<boolean>(false);
  const [minTenXScore, setMinTenXScore] = useState<string>('');
  const [maxMarketCapCr, setMaxMarketCapCr] = useState<string>('');
  const [minBullMultiple, setMinBullMultiple] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/master-screener?equityOnly=${equityOnly}&annualWeightPct=${annualWeightPct}`
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body as MasterScreenerResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load master screener');
    } finally {
      setLoading(false);
    }
  }, [equityOnly, annualWeightPct]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSelectPreset = (p: MasterScreenerPreset) => {
    setPreset(p);
    const meta = PRESET_MENUS.find((m) => m.id === p);
    if (meta) {
      setSortKey(meta.defaultSort);
      setSortAsc(false);
    }
  };

  const resetAllFilters = () => {
    setSearch('');
    setSectorFilter('ALL');
    setAnnualOnly(false);
    setExcludeRiskFlags(false);
    setMinAvgTurnoverCr('');
    setMinVolSpike('');
    setAccumulationOnly(false);
    setPlayerTierFilter('ALL');
    setMinMosPct('');
    setMaxPe('');
    setMaxPb('');
    setMinHealthScore('');
    setInBuyZoneOnly(false);
    setBeatsFdOnly(false);
    setTrendFilter('ALL');
    setRsiBand('ALL');
    setAboveEma20Only(false);
    setBreakout20dOnly(false);
    setMinRoePct('');
    setMinPassedInvestors('');
    setMinReserveCap('');
    setMinEpsGrowth('');
    setPositiveEpsOnly(false);
    setMinTenXScore('');
    setMaxMarketCapCr('');
    setMinBullMultiple('');
  };

  const activeFilterCount = useMemo(() => {
    const flags = [
      search.trim() !== '',
      sectorFilter !== 'ALL',
      annualOnly,
      excludeRiskFlags,
      minAvgTurnoverCr !== '',
      minVolSpike !== '',
      accumulationOnly,
      playerTierFilter !== 'ALL',
      minMosPct !== '',
      maxPe !== '',
      maxPb !== '',
      minHealthScore !== '',
      inBuyZoneOnly,
      beatsFdOnly,
      trendFilter !== 'ALL',
      rsiBand !== 'ALL',
      aboveEma20Only,
      breakout20dOnly,
      minRoePct !== '',
      minPassedInvestors !== '',
      minReserveCap !== '',
      minEpsGrowth !== '',
      positiveEpsOnly,
      minTenXScore !== '',
      maxMarketCapCr !== '',
      minBullMultiple !== '',
    ];
    return flags.filter(Boolean).length;
  }, [
    search,
    sectorFilter,
    annualOnly,
    excludeRiskFlags,
    minAvgTurnoverCr,
    minVolSpike,
    accumulationOnly,
    playerTierFilter,
    minMosPct,
    maxPe,
    maxPb,
    minHealthScore,
    inBuyZoneOnly,
    beatsFdOnly,
    trendFilter,
    rsiBand,
    aboveEma20Only,
    breakout20dOnly,
    minRoePct,
    minPassedInvestors,
    minReserveCap,
    minEpsGrowth,
    positiveEpsOnly,
    minTenXScore,
    maxMarketCapCr,
    minBullMultiple,
  ]);

  const numOrNull = (s: string): number | null => {
    if (!s.trim()) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const filteredAndSorted = useMemo(() => {
    if (!data) return [];

    const q = search.trim().toLowerCase();
    const nMinTurn = numOrNull(minAvgTurnoverCr);
    const nMinSpike = numOrNull(minVolSpike);
    const nMinMos = numOrNull(minMosPct);
    const nMaxPe = numOrNull(maxPe);
    const nMaxPb = numOrNull(maxPb);
    const nMinHealth = numOrNull(minHealthScore);
    const nMinRoe = numOrNull(minRoePct);
    const nMinPassed = numOrNull(minPassedInvestors);
    const nMinRes = numOrNull(minReserveCap);
    const nMinEpsG = numOrNull(minEpsGrowth);
    const nMin10x = numOrNull(minTenXScore);
    const nMaxCap = numOrNull(maxMarketCapCr);
    const nMinMult = numOrNull(minBullMultiple);

    const out = data.rows.filter((r) => {
      // Preset Gate
      if (preset === 'player_liquidity') {
        if (r.liquidity.playerInterestScore < 55 && r.liquidity.avgTurnover20Cr < 1.0) return false;
      } else if (preset === 'best_valuation') {
        if ((r.valuation.marginOfSafetyPct ?? -999) < 8 && !r.valuation.inBuyZone) return false;
      } else if (preset === 'annual_gems') {
        if (
          !r.hasAnnualReport &&
          (r.gems.hiddenGemScore ?? 0) < 58 &&
          (r.fundamentals.reserveToCapitalRatio ?? 0) < 0.75
        ) {
          return false;
        }
      } else if (preset === 'fundamental_titans') {
        if (
          !r.hasFundamentalData ||
          r.fundamentals.overallScore < 58 ||
          r.fundamentals.passedInvestorCount < 3
        ) {
          return false;
        }
      } else if (preset === 'earnings_accelerators') {
        if (
          (r.earnings.epsYoyPct ?? -999) < 10 &&
          (r.earnings.epsCagr3yPct ?? -999) < 10 &&
          r.earnings.earningsMomentumScore < 60
        ) {
          return false;
        }
      } else if (preset === 'technical_breakouts') {
        if (
          !r.technical.breakout20d &&
          r.technical.trendState !== 'Strong Uptrend' &&
          r.technical.trendState !== 'Uptrend'
        ) {
          return false;
        }
      } else if (preset === 'future_10x') {
        if (r.tenX.tenXScore < 55) return false;
      }

      // Search & Sector
      if (q) {
        const hit =
          r.symbol.toLowerCase().includes(q) ||
          r.companyName.toLowerCase().includes(q) ||
          r.sector.toLowerCase().includes(q) ||
          r.actionTags.some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (sectorFilter !== 'ALL' && r.sector !== sectorFilter) return false;
      if (annualOnly && !r.hasAnnualReport) return false;
      if (
        excludeRiskFlags &&
        (r.fundamentals.lockInOverhangFlag || r.fundamentals.regulatoryStanding === 'Alert')
      ) {
        return false;
      }

      // Liquidity & Player Flow
      if (nMinTurn !== null && r.liquidity.avgTurnover20Cr < nMinTurn) return false;
      if (
        nMinSpike !== null &&
        (r.liquidity.turnoverSpikeMult ?? 0) < nMinSpike &&
        (r.liquidity.volumeSpikeMult ?? 0) < nMinSpike
      ) {
        return false;
      }
      if (accumulationOnly && !r.liquidity.accumulationFlag) return false;
      if (playerTierFilter !== 'ALL' && r.liquidity.playerTier !== playerTierFilter) return false;

      // Valuation
      if (nMinMos !== null && (r.valuation.marginOfSafetyPct ?? -999) < nMinMos) return false;
      if (nMaxPe !== null && (r.valuation.pe === null || r.valuation.pe <= 0 || r.valuation.pe > nMaxPe)) {
        return false;
      }
      if (nMaxPb !== null && (r.valuation.pb === null || r.valuation.pb <= 0 || r.valuation.pb > nMaxPb)) {
        return false;
      }
      if (nMinHealth !== null && (r.valuation.valuationHealthScore ?? 0) < nMinHealth) return false;
      if (inBuyZoneOnly && !r.valuation.inBuyZone) return false;
      if (beatsFdOnly && (r.valuation.fdSpreadPct ?? -999) <= 0) return false;

      // Technicals
      if (trendFilter !== 'ALL' && r.technical.trendState !== trendFilter) return false;
      if (rsiBand === 'sweet_spot') {
        if (r.technical.rsi14 === null || r.technical.rsi14 < 50 || r.technical.rsi14 > 68) {
          return false;
        }
      } else if (rsiBand === 'oversold') {
        if (r.technical.rsi14 === null || r.technical.rsi14 > 35) return false;
      } else if (rsiBand === 'momentum') {
        if (r.technical.rsi14 === null || r.technical.rsi14 < 60) return false;
      }
      if (aboveEma20Only && !r.technical.aboveEma20) return false;
      if (breakout20dOnly && !r.technical.breakout20d) return false;

      // Fundamentals & Earnings & 10x
      if (nMinRoe !== null && (r.fundamentals.roePct ?? -999) < nMinRoe) return false;
      if (nMinPassed !== null && r.fundamentals.passedInvestorCount < nMinPassed) return false;
      if (nMinRes !== null && (r.fundamentals.reserveToCapitalRatio ?? -999) < nMinRes) return false;
      if (positiveEpsOnly && (r.earnings.eps ?? 0) <= 0) return false;
      if (nMinEpsG !== null) {
        const g = r.earnings.epsCagr3yPct ?? r.earnings.epsYoyPct ?? -999;
        if (g < nMinEpsG) return false;
      }
      if (nMin10x !== null && r.tenX.tenXScore < nMin10x) return false;
      if (nMaxCap !== null && (r.tenX.marketCapCr === null || r.tenX.marketCapCr > nMaxCap)) {
        return false;
      }
      if (nMinMult !== null && (r.tenX.bull5yMultiple ?? 0) < nMinMult) return false;

      return true;
    });

    const valForSort = (r: MasterScreenerRow, key: SortKey): number | null => {
      switch (key) {
        case 'masterScore':
          return r.masterScore;
        case 'ltp':
          return r.ltp;
        case 'changePct':
          return r.changePct;
        case 'playerInterestScore':
          return r.liquidity.playerInterestScore;
        case 'avgTurnover20Cr':
          return r.liquidity.avgTurnover20Cr;
        case 'turnoverSpikeMult':
          return r.liquidity.turnoverSpikeMult;
        case 'technicalScore':
          return r.technical.technicalScore;
        case 'rsi14':
          return r.technical.rsi14;
        case 'marginOfSafetyPct':
          return r.valuation.marginOfSafetyPct;
        case 'valuationHealthScore':
          return r.valuation.valuationHealthScore;
        case 'pe':
          return r.valuation.pe;
        case 'roePct':
          return r.fundamentals.roePct;
        case 'earningsMomentumScore':
          return r.earnings.earningsMomentumScore;
        case 'epsGrowth':
          return r.earnings.epsCagr3yPct ?? r.earnings.epsYoyPct;
        case 'hiddenGemScore':
          return r.gems.hiddenGemScore;
        case 'tenXScore':
          return r.tenX.tenXScore;
        case 'bull5yMultiple':
          return r.tenX.bull5yMultiple;
      }
    };

    out.sort((a, b) => {
      const av = valForSort(a, sortKey);
      const bv = valForSort(b, sortKey);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return sortAsc ? av - bv : bv - av;
    });

    return out;
  }, [
    data,
    preset,
    search,
    sectorFilter,
    annualOnly,
    excludeRiskFlags,
    minAvgTurnoverCr,
    minVolSpike,
    accumulationOnly,
    playerTierFilter,
    minMosPct,
    maxPe,
    maxPb,
    minHealthScore,
    inBuyZoneOnly,
    beatsFdOnly,
    trendFilter,
    rsiBand,
    aboveEma20Only,
    breakout20dOnly,
    minRoePct,
    minPassedInvestors,
    minReserveCap,
    minEpsGrowth,
    positiveEpsOnly,
    minTenXScore,
    maxMarketCapCr,
    minBullMultiple,
    sortKey,
    sortAsc,
  ]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(key === 'pe');
    }
  };

  const handleExportCsv = () => {
    if (filteredAndSorted.length === 0) return;
    const headers = [
      'Symbol',
      'Name',
      'Sector',
      'LTP',
      'ChangePct',
      'MasterScore',
      'PlayerScore',
      'AvgTurnover20Cr',
      'TurnSpikeX',
      'TechScore',
      'Trend',
      'RSI14',
      'FairValue',
      'MoSPct',
      'HealthScore',
      'PE',
      'PB',
      'FundScore',
      'ROE',
      'EPS',
      'EPSGrowthPct',
      'GemScore',
      'TenXScore',
      'Bull5YMultiple',
      'AnnualReport',
    ];
    const csvRows = [
      headers.join(','),
      ...filteredAndSorted.map((r) =>
        [
          r.symbol,
          `"${r.companyName.replace(/"/g, '""')}"`,
          `"${r.sector.replace(/"/g, '""')}"`,
          r.ltp ?? '',
          r.changePct ?? '',
          r.masterScore,
          r.liquidity.playerInterestScore,
          r.liquidity.avgTurnover20Cr,
          r.liquidity.turnoverSpikeMult ?? '',
          r.technical.technicalScore,
          `"${r.technical.trendState}"`,
          r.technical.rsi14 ?? '',
          r.valuation.compositeFairValue ?? '',
          r.valuation.marginOfSafetyPct ?? '',
          r.valuation.valuationHealthScore ?? '',
          r.valuation.pe ?? '',
          r.valuation.pb ?? '',
          r.fundamentals.overallScore,
          r.fundamentals.roePct ?? '',
          r.earnings.eps ?? '',
          r.earnings.epsCagr3yPct ?? r.earnings.epsYoyPct ?? '',
          r.gems.hiddenGemScore ?? '',
          r.tenX.tenXScore,
          r.tenX.bull5yMultiple ?? '',
          r.hasAnnualReport ? 'Yes' : 'No',
        ].join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nepse-master-screener-${preset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-16 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-28 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-96 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Master Multi-Factor Screener &amp; 10x Discovery Hub
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Confluence of Player Liquidity, Technical Breakouts, 6-Model Valuation, {annualWeightPct}% Annual Report Gems, Earnings Acceleration &amp; Future 10x Runway
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-[11px]">
            {[
              { pct: 70, label: '70% Annual / 30% Qtr' },
              { pct: 100, label: '100% Annual' },
              { pct: 0, label: 'Latest Qtr' },
            ].map((w) => (
              <button
                key={w.pct}
                type="button"
                onClick={() => setAnnualWeightPct(w.pct)}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                  annualWeightPct === w.pct
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredAndSorted.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-lg p-4 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 8 Strategy Menu Lenses */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
          {PRESET_MENUS.map((m) => {
            const Icon = m.icon;
            const active = preset === m.id;
            const count = data.presetCounts[m.id] ?? 0;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelectPreset(m.id)}
                title={m.subtitle}
                className={`px-3 py-2.5 rounded-lg border text-left transition-colors flex flex-col justify-between gap-1 ${
                  active
                    ? 'border-blue-600 bg-blue-50/80 dark:bg-blue-950/40'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'
                    }`}
                  />
                  <span className="font-mono text-[11px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
                    {count}
                  </span>
                </div>
                <div
                  className={`text-xs font-semibold leading-tight truncate ${
                    active ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-200'
                  }`}
                >
                  {m.label}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Search + Sector + Filter Drawer Toggle */}
      {data && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
          <div className="p-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
              <div className="relative flex-1 max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search symbol, company, sector, tag…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              >
                <option value="ALL">All Sectors ({data.sectors.length})</option>
                {data.sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={annualOnly}
                  onChange={(e) => setAnnualOnly(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Annual / Q4 Verified</span>
              </label>

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={inBuyZoneOnly}
                  onChange={(e) => setInBuyZoneOnly(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>In Buy Zone (MoS ≥ 15%)</span>
              </label>

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={accumulationOnly}
                  onChange={(e) => setAccumulationOnly(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Player Accumulation</span>
              </label>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset ({activeFilterCount})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Filter className="w-3.5 h-3.5" />
                <span>{showFilters ? 'Hide Filter Menus' : 'All Filter Menus'}</span>
                {showFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Structured Multi-Domain Filter Menus */}
          {showFilters && (
            <div className="p-3.5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 bg-slate-50/50 dark:bg-slate-950/40 text-xs">
              {/* 1. Player Flow & Liquidity Menu */}
              <div className="space-y-2">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  1. Player Interest &amp; Liquidity
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">
                      Min 20D Turn (Cr)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={minAvgTurnoverCr}
                      onChange={(e) => setMinAvgTurnoverCr(e.target.value)}
                      placeholder="e.g. 1.5"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">
                      Min Vol/Turn Spike
                    </label>
                    <input
                      type="number"
                      step="0.2"
                      value={minVolSpike}
                      onChange={(e) => setMinVolSpike(e.target.value)}
                      placeholder="e.g. 1.5x"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
                <select
                  value={playerTierFilter}
                  onChange={(e) => setPlayerTierFilter(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                >
                  <option value="ALL">All Player Flow Tiers</option>
                  <option value="Institutional / HNI Flow">Institutional / HNI Flow</option>
                  <option value="Active High Liquidity">Active High Liquidity</option>
                  <option value="Moderate Retail">Moderate Retail</option>
                </select>
              </div>

              {/* 2. Valuation Metrics Menu */}
              <div className="space-y-2">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  2. Valuation &amp; Health Cushion
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">
                      Min MoS %
                    </label>
                    <input
                      type="number"
                      value={minMosPct}
                      onChange={(e) => setMinMosPct(e.target.value)}
                      placeholder="e.g. 10"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">
                      Min Health Score
                    </label>
                    <input
                      type="number"
                      value={minHealthScore}
                      onChange={(e) => setMinHealthScore(e.target.value)}
                      placeholder="e.g. 60"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Max P/E</label>
                    <input
                      type="number"
                      value={maxPe}
                      onChange={(e) => setMaxPe(e.target.value)}
                      placeholder="e.g. 22"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Max P/B</label>
                    <input
                      type="number"
                      step="0.2"
                      value={maxPb}
                      onChange={(e) => setMaxPb(e.target.value)}
                      placeholder="e.g. 2.5"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={beatsFdOnly}
                    onChange={(e) => setBeatsFdOnly(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Earnings Yield Beats Nepal FD ({data.benchmarkFdRatePct}%)</span>
                </label>
              </div>

              {/* 3. Technical Analysis Menu */}
              <div className="space-y-2">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  3. Technical Trend &amp; Breakouts
                </div>
                <select
                  value={trendFilter}
                  onChange={(e) => setTrendFilter(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                >
                  <option value="ALL">All Trend States</option>
                  <option value="Strong Uptrend">Strong Uptrend</option>
                  <option value="Uptrend">Uptrend</option>
                  <option value="Pullback in Uptrend">Pullback in Uptrend</option>
                  <option value="Base / Accumulation">Base / Accumulation</option>
                  <option value="Downtrend">Downtrend</option>
                </select>
                <select
                  value={rsiBand}
                  onChange={(e) =>
                    setRsiBand(e.target.value as 'ALL' | 'sweet_spot' | 'oversold' | 'momentum')
                  }
                  className="w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                >
                  <option value="ALL">All RSI-14 Zones</option>
                  <option value="sweet_spot">Bullish Sweet Spot (RSI 50–68)</option>
                  <option value="oversold">Oversold Reversal (RSI ≤ 35)</option>
                  <option value="momentum">Strong Momentum (RSI ≥ 60)</option>
                </select>
                <div className="flex flex-wrap gap-3 pt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aboveEma20Only}
                      onChange={(e) => setAboveEma20Only(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Above EMA20</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={breakout20dOnly}
                      onChange={(e) => setBreakout20dOnly(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>20D Vol Breakout</span>
                  </label>
                </div>
              </div>

              {/* 4. Fundamentals, Earnings, Gems & Future 10x Menu */}
              <div className="space-y-2">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  4. Fundamentals, Earnings &amp; 10x Runway
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Min ROE%</label>
                    <input
                      type="number"
                      value={minRoePct}
                      onChange={(e) => setMinRoePct(e.target.value)}
                      placeholder="12"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">EPS Gr%</label>
                    <input
                      type="number"
                      value={minEpsGrowth}
                      onChange={(e) => setMinEpsGrowth(e.target.value)}
                      placeholder="10"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Res/Cap</label>
                    <input
                      type="number"
                      step="0.2"
                      value={minReserveCap}
                      onChange={(e) => setMinReserveCap(e.target.value)}
                      placeholder="0.7"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Min 10x</label>
                    <input
                      type="number"
                      value={minTenXScore}
                      onChange={(e) => setMinTenXScore(e.target.value)}
                      placeholder="60"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Max Cap Cr</label>
                    <input
                      type="number"
                      value={maxMarketCapCr}
                      onChange={(e) => setMaxMarketCapCr(e.target.value)}
                      placeholder="2000"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">5Y Mult</label>
                    <input
                      type="number"
                      step="0.5"
                      value={minBullMultiple}
                      onChange={(e) => setMinBullMultiple(e.target.value)}
                      placeholder="2.0"
                      className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 pt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={positiveEpsOnly}
                      onChange={(e) => setPositiveEpsOnly(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>EPS &gt; 0</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={excludeRiskFlags}
                      onChange={(e) => setExcludeRiskFlags(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Clean CDSC/NRB</span>
                  </label>
                  <select
                    value={minPassedInvestors}
                    onChange={(e) => setMinPassedInvestors(e.target.value)}
                    className="px-1.5 py-0.5 text-[11px] rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                  >
                    <option value="">Any Investors</option>
                    <option value="3">≥ 3/9 Investors</option>
                    <option value="5">≥ 5/9 Investors</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results Header & Master Table */}
      {data && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="text-slate-600 dark:text-slate-300">
              Showing{' '}
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                {filteredAndSorted.length}
              </span>{' '}
              of {data.totalSymbols} scripts ·{' '}
              <span className="text-slate-500 dark:text-slate-400">
                {PRESET_MENUS.find((p) => p.id === preset)?.subtitle}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Click any row to inspect 4-pillar signals or jump directly to Detail Labs
            </div>
          </div>

          {filteredAndSorted.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No scripts match the active filter combination
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Loosen one of your minimum thresholds or switch back to Master Confluence.
              </p>
              <button
                type="button"
                onClick={resetAllFilters}
                className="mt-2 px-3 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2 text-left font-medium">Script</th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleSort('ltp')}
                        className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>LTP</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleSort('masterScore')}
                          className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Master</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                        <InfoTip glossaryKey="masterScore" />
                      </span>
                    </th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleSort('playerInterestScore')}
                          className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Player</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                        <InfoTip glossaryKey="playerInterestScore" />
                      </span>
                    </th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleSort('avgTurnover20Cr')}
                        className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>20D Turn</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleSort('technicalScore')}
                        className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>Tech / RSI</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleSort('marginOfSafetyPct')}
                          className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Fair / MoS</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                        <InfoTip glossaryKey="marginOfSafetyPct" align="right" />
                      </span>
                    </th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleSort('valuationHealthScore')}
                          className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>Health</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                        <InfoTip glossaryKey="valuationHealthScore" align="right" />
                      </span>
                    </th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleSort('pe')}
                        className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>P/E · ROE</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <button
                        type="button"
                        onClick={() => handleSort('earningsMomentumScore')}
                        className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        <span>EPS / Earn</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="px-2.5 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleSort('tenXScore')}
                          className="inline-flex items-center gap-0.5 hover:text-slate-900 dark:hover:text-white"
                        >
                          <span>10x / 5Y</span>
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                        <InfoTip glossaryKey="tenXScore" align="right" />
                      </span>
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {filteredAndSorted.slice(0, 150).map((r) => {
                    const expanded = expandedSymbol === r.symbol;
                    const epsG = r.earnings.epsCagr3yPct ?? r.earnings.epsYoyPct;
                    return (
                      <React.Fragment key={r.symbol}>
                        <tr
                          onClick={() =>
                            setExpandedSymbol((prev) => (prev === r.symbol ? null : r.symbol))
                          }
                          className={`cursor-pointer transition-colors ${
                            expanded
                              ? 'bg-blue-50/50 dark:bg-blue-950/20'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/35'
                          }`}
                        >
                          <td className="px-3 py-2 font-sans">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                {r.symbol}
                              </span>
                              {r.hasAnnualReport && (
                                <span className="text-[10px] font-mono font-semibold text-blue-600 dark:text-blue-400">
                                  ANNUAL
                                </span>
                              )}
                              {r.valuation.inBuyZone && (
                                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  BUY ZONE
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[170px]">
                              {r.sector}
                            </div>
                          </td>

                          <td className="px-2.5 py-2 text-right whitespace-nowrap">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              {fmtRs(r.ltp, 0)}
                            </div>
                            <div
                              className={`text-[10px] ${
                                (r.changePct ?? 0) > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : (r.changePct ?? 0) < 0
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-slate-400'
                              }`}
                            >
                              {fmtSigned(r.changePct, 1, '%')}
                            </div>
                          </td>

                          <td className={`px-2.5 py-2 text-right ${scoreTone(r.masterScore)}`}>
                            {r.masterScore.toFixed(0)}
                          </td>

                          <td className="px-2.5 py-2 text-right whitespace-nowrap">
                            <div className={scoreTone(r.liquidity.playerInterestScore)}>
                              {r.liquidity.playerInterestScore.toFixed(0)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {r.liquidity.turnoverSpikeMult !== null
                                ? `${r.liquidity.turnoverSpikeMult.toFixed(1)}x spk`
                                : '—'}
                            </div>
                          </td>

                          <td className="px-2.5 py-2 text-right whitespace-nowrap">
                            <div className="text-slate-800 dark:text-slate-200">
                              {r.liquidity.avgTurnover20Cr.toFixed(2)}Cr
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {r.liquidity.upDownVolRatio !== null
                                ? `U/D ${r.liquidity.upDownVolRatio.toFixed(1)}x`
                                : '—'}
                            </div>
                          </td>

                          <td className="px-2.5 py-2 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className={scoreTone(r.technical.technicalScore)}>
                                {r.technical.technicalScore.toFixed(0)}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                R:{r.technical.rsi14 !== null ? r.technical.rsi14.toFixed(0) : '—'}
                              </span>
                            </div>
                            <div className="font-sans mt-0.5">
                              <span
                                className={`inline-block px-1 py-0.5 text-[9px] font-medium rounded border ${trendBadgeTone(
                                  r.technical.trendState
                                )}`}
                              >
                                {r.technical.trendState}
                              </span>
                            </div>
                          </td>

                          <td className="px-2.5 py-2 text-right whitespace-nowrap">
                            <div className="text-slate-900 dark:text-slate-100">
                              {fmtRs(r.valuation.compositeFairValue, 0)}
                            </div>
                            <div
                              className={`text-[10px] font-semibold ${
                                (r.valuation.marginOfSafetyPct ?? -999) >= 10
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : (r.valuation.marginOfSafetyPct ?? 0) < -10
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-slate-500'
                              }`}
                            >
                              {fmtSigned(r.valuation.marginOfSafetyPct, 1, '%')}
                            </div>
                          </td>

                          <td
                            className={`px-2.5 py-2 text-right ${scoreTone(
                              r.valuation.valuationHealthScore
                            )}`}
                          >
                            {r.valuation.valuationHealthScore !== null
                              ? r.valuation.valuationHealthScore.toFixed(0)
                              : '—'}
                          </td>

                          <td className="px-2.5 py-2 text-right whitespace-nowrap">
                            <div className="text-slate-800 dark:text-slate-200">
                              {fmtNum(r.valuation.pe, 1, 'x')}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              ROE {fmtNum(r.fundamentals.roePct, 1, '%')}
                            </div>
                          </td>

                          <td className="px-2.5 py-2 text-right whitespace-nowrap">
                            <div
                              className={
                                (r.earnings.eps ?? 0) > 0
                                  ? 'text-slate-900 dark:text-slate-100 font-semibold'
                                  : 'text-red-600 dark:text-red-400'
                              }
                            >
                              {fmtRs(r.earnings.eps, 1)}
                            </div>
                            <div
                              className={`text-[10px] ${
                                epsG !== null
                                  ? epsG >= 12
                                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                    : epsG < 0
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-slate-400'
                                  : scoreTone(r.earnings.earningsMomentumScore)
                              }`}
                            >
                              {epsG !== null
                                ? `Gr ${fmtSigned(epsG, 1, '%')}`
                                : `Earn ${r.earnings.earningsMomentumScore.toFixed(0)}`}
                            </div>
                          </td>

                          <td className="px-2.5 py-2 text-right whitespace-nowrap">
                            <div className={scoreTone(r.tenX.tenXScore)}>
                              {r.tenX.tenXScore.toFixed(0)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {r.tenX.bull5yMultiple !== null
                                ? `${r.tenX.bull5yMultiple.toFixed(1)}x`
                                : '—'}
                            </div>
                          </td>

                          <td
                            className="px-3 py-2 text-right font-sans whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onOpenValuation(r.symbol)}
                                title="Open Pricing, Health Score & Annual Report Dissector"
                                className="p-1 rounded border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                              >
                                <Scale className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onInspectInScreener(r.symbol)}
                                title="Open 9-Investor Fundamental Dossier"
                                className="p-1 rounded border border-slate-200 dark:border-slate-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                              >
                                <Award className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onInspectSymbol(r.symbol)}
                                title="Open Technical Chart Explorer"
                                className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <CandlestickChart className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onInspectInAnalyzer(r.symbol)}
                                title="Open ICT/SMC Trade Analyzer"
                                className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Crosshair className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleCompare(r.symbol)}
                                title={hasCompare(r.symbol) ? 'Remove from Compare' : 'Add to Side-by-Side Compare'}
                                className={`p-1 rounded border ${
                                  hasCompare(r.symbol)
                                    ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                <GitCompare className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expandable 4-Pillar Quick Dossier Drawer */}
                        {expanded && (
                          <tr className="bg-slate-50/70 dark:bg-slate-950/60 font-sans">
                            <td colSpan={12} className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800">
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-xs">
                                <div className="space-y-1">
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Player Flow &amp; Technicals
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                                    {r.liquidity.playerTier} · Avg Ticket{' '}
                                    {r.liquidity.avgTicketNpr
                                      ? `Rs ${(r.liquidity.avgTicketNpr / 1000).toFixed(0)}k`
                                      : '—'}
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                    5D {fmtSigned(r.technical.return5dPct, 1, '%')} · 20D{' '}
                                    {fmtSigned(r.technical.return20dPct, 1, '%')} · vs D120{' '}
                                    {fmtSigned(r.technical.vsD120Pct, 1, '%')} · 52W Pos{' '}
                                    {fmtNum(r.technical.pos52wPct, 0, '%')}
                                  </div>
                                  {r.technical.signals.length > 0 && (
                                    <div className="text-[11px] text-blue-600 dark:text-blue-400">
                                      {r.technical.signals.join(' · ')}
                                    </div>
                                  )}
                                </div>

                                <div className="space-y-1">
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Valuation &amp; Health Cushion
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                                    Buy Zone ≤ {fmtRs(r.valuation.buyZonePrice, 0)} · P/B{' '}
                                    {fmtNum(r.valuation.pb, 2, 'x')} · FD Spread{' '}
                                    {fmtSigned(r.valuation.fdSpreadPct, 2, '%')}
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                    Health {r.valuation.healthBand ?? '—'} (Safety{' '}
                                    {r.valuation.safetyScore?.toFixed(0) ?? '—'} / Growth{' '}
                                    {r.valuation.growthScore?.toFixed(0) ?? '—'})
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Annual Fundamentals &amp; Gems
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                                    {r.fundamentals.passedInvestorCount}/9 Investors ({r.fundamentals.verdict}) · Res/Cap{' '}
                                    {fmtNum(r.fundamentals.reserveToCapitalRatio, 2, 'x')}
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Gem Score: {r.gems.hiddenGemScore?.toFixed(1) ?? '—'} ·{' '}
                                    {r.gems.whyGem[0] ?? 'Inspect Annual Dissector for full ledger history.'}
                                  </div>
                                </div>

                                <div className="space-y-1.5">
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Future 10x Multi-Bagger Thesis ({r.tenX.tier})
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                                    Mkt Cap {r.tenX.marketCapCr ? `Rs ${r.tenX.marketCapCr.toFixed(0)} Cr` : '—'} · 5Y Bull{' '}
                                    {fmtRs(r.tenX.bull5yPrice, 0)} ({fmtNum(r.tenX.bull5yCagrPct, 1, '%/yr')})
                                  </div>
                                  {r.tenX.catalysts.length > 0 && (
                                    <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                                      {r.tenX.catalysts.join(' · ')}
                                    </div>
                                  )}
                                  <div className="flex flex-wrap gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => onOpenValuation(r.symbol)}
                                      className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white"
                                    >
                                      Open Valuation &amp; Dissector
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onInspectInScreener(r.symbol)}
                                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      9-Investor Dossier
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onInspectSymbol(r.symbol)}
                                      className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      Chart &amp; Analyzer
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
