import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  ArrowLeft,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  CalendarClock,
  CandlestickChart,
  ChevronDown,
  ChevronRight,
  Compass,
  Crosshair,
  Database,
  FileText,
  FileWarning,
  Gauge,
  GitCompare,
  Globe,
  HelpCircle,
  Home,
  LayoutGrid,
  Menu,
  Moon,
  Radar,
  RefreshCw,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  CommandPaletteModal,
  type PaletteNavTarget,
} from './components/CommandPaletteModal';
import { CompareStocksDrawer } from './components/CompareStocksDrawer';
import { type FundamentalMenuId } from './components/FundamentalMenuBar';
import { InfoTip } from './components/InfoTip';
import {
  OnboardingGuideModal,
  OnboardingResumeBar,
  type GuideStepTarget,
} from './components/OnboardingGuideModal';
import { Stock360Bar, type Stock360Tab } from './components/Stock360Bar';
import { WatchlistAlertsDrawer } from './components/WatchlistAlertsDrawer';
import { useOnboardingGuide } from './hooks/useOnboardingGuide';
import { useTradingSettings } from './hooks/useTradingSettings';
import { useCompareList, useWatchlist } from './hooks/useWatchlist';
import type { MasterScreenerResponse } from './types/fundamental';
import type { DailyAggregate, SchedulerStatus, SymbolInfo } from './types/market';
import { formatTimeUntil } from './utils/format';
import { evaluateWatchlistAlerts } from './utils/plainEnglish';
import { AlgorithmsView } from './views/AlgorithmsView';
import { AnalyzerView } from './views/AnalyzerView';
import { AnnualReportView } from './views/AnnualReportView';
import { FinancialsVaultView } from './views/FinancialsVaultView';
import { FundamentalScreenerView } from './views/FundamentalScreenerView';
import { MacroRisksView } from './views/MacroRisksView';
import { MarketPulseView } from './views/MarketPulseView';
import { MasterScreenerView } from './views/MasterScreenerView';
import { OpportunityRadarView } from './views/OpportunityRadarView';
import { OverviewView } from './views/OverviewView';
import { PortfolioTradeDeskView } from './views/PortfolioTradeDeskView';
import {
  CompositeDoNotBuyView,
  FundamentallyRiskyView,
  MarketOpportunityVsRiskView,
  TechnicallyRiskyView,
} from './views/RiskIntelligenceViews';
import { ScannersView } from './views/ScannersView';
import { SchedulerView } from './views/SchedulerView';
import { SettingsView } from './views/SettingsView';
import { StockExplorerView } from './views/StockExplorerView';
import { StrategicOutlookView } from './views/StrategicOutlookView';
import { TodayBriefingView } from './views/TodayBriefingView';
import { TopTurnoverView } from './views/TopTurnoverView';
import { TurnoverDirectionView } from './views/TurnoverDirectionView';
import { ValuationView } from './views/ValuationView';

type NavTab =
  | 'today'
  | 'master-screener'
  | 'portfolio'
  | 'screener'
  | 'annual-reports'
  | 'strategic-outlook'
  | 'financials-vault'
  | 'valuation'
  | 'overview'
  | 'pulse'
  | 'turnover'
  | 'radar'
  | 'direction'
  | 'scanners'
  | 'explorer'
  | 'analyzer'
  | 'macro'
  | 'fundamentally-risky'
  | 'technically-risky'
  | 'do-not-buy'
  | 'opportunity-vs-risk'
  | 'algorithms'
  | 'settings'
  | 'scheduler';

type NavGroupId = 'start' | 'valuation' | 'market' | 'risk' | 'system';

interface NavGroupConfig {
  id: NavGroupId;
  label: string;
  items: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}

const NAV_GROUPS: NavGroupConfig[] = [
  {
    id: 'start',
    label: 'Start & Discovery',
    items: [
      { id: 'today', label: 'Today Briefing', icon: Home },
      { id: 'master-screener', label: 'Master Screener', icon: SlidersHorizontal },
      { id: 'portfolio', label: 'Portfolio & Trade Desk', icon: Briefcase },
    ],
  },
  {
    id: 'valuation',
    label: 'Valuation & Fundamentals',
    items: [
      { id: 'valuation', label: 'Pricing & Valuation', icon: Scale },
      { id: 'screener', label: 'Fundamental Screener', icon: Award },
      { id: 'annual-reports', label: 'Annual Reports', icon: FileText },
      { id: 'strategic-outlook', label: 'Strategic Outlook Heat Map', icon: LayoutGrid },
      { id: 'financials-vault', label: 'Quarterly Financials Vault', icon: Database },
      { id: 'radar', label: 'Opportunity Radar', icon: Sparkles },
    ],
  },
  {
    id: 'market',
    label: 'Market Flow & Charts',
    items: [
      { id: 'overview', label: 'Overview', icon: BarChart3 },
      { id: 'pulse', label: 'Market Pulse', icon: Gauge },
      { id: 'turnover', label: 'Top Turnover', icon: TrendingUp },
      { id: 'direction', label: 'Turnover × Direction', icon: Activity },
      { id: 'scanners', label: 'Scanners', icon: Radar },
      { id: 'explorer', label: 'Stock Explorer', icon: CandlestickChart },
      { id: 'analyzer', label: 'Auto Analyzer', icon: Crosshair },
    ],
  },
  {
    id: 'risk',
    label: 'Risk & Macro',
    items: [
      { id: 'macro', label: 'Macro & Risks', icon: Globe },
      { id: 'fundamentally-risky', label: 'Fundamentally Risky Stocks', icon: FileWarning },
      { id: 'technically-risky', label: 'Technically Risky Stocks', icon: ShieldAlert },
      { id: 'do-not-buy', label: 'DO NOT BUY – High Risk Stocks', icon: AlertOctagon },
      { id: 'opportunity-vs-risk', label: 'Market Opportunity vs Risk', icon: Scale },
    ],
  },
  {
    id: 'system',
    label: 'Methodology & System',
    items: [
      { id: 'algorithms', label: 'Algorithms', icon: BookOpen },
      { id: 'settings', label: 'Settings', icon: Settings },
      { id: 'scheduler', label: 'Scheduler & Data', icon: CalendarClock },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const PALETTE_NAV_ITEMS: PaletteNavTarget[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((item) => ({ id: item.id, label: item.label, group: g.label }))
);

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('today');
  const [expandedGroups, setExpandedGroups] = useState<Record<NavGroupId, boolean>>({
    start: true,
    valuation: true,
    market: false,
    risk: false,
    system: false,
  });

  const [dates, setDates] = useState<string[]>([]);
  const [daily, setDaily] = useState<DailyAggregate[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [equityOnly, setEquityOnly] = useState<boolean>(true);
  const [explorerSymbol, setExplorerSymbol] = useState<string | null>(null);
  const [valuationSymbol, setValuationSymbol] = useState<string | null>(null);
  const [annualReportSymbol, setAnnualReportSymbol] = useState<string | null>(null);
  const [vaultSymbol, setVaultSymbol] = useState<string | null>(null);
  const [screenerTarget, setScreenerTarget] = useState<{ symbol: string; tick: number } | null>(null);
  const [screenerSubViewTarget, setScreenerSubViewTarget] = useState<{
    view: 'screener' | 'gems' | 'monitor';
    tick: number;
  } | null>(null);
  const [quantSymbol, setQuantSymbol] = useState<string | null>(null);
  const [quantNavTick, setQuantNavTick] = useState<number>(0);
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [navHistory, setNavHistory] = useState<
    Array<{ tab: NavTab; explorerSymbol: string | null; quantSymbol: string | null }>
  >([]);
  const [loadingMeta, setLoadingMeta] = useState<boolean>(true);
  const [pulling, setPulling] = useState<boolean>(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [allSymbols, setAllSymbols] = useState<SymbolInfo[]>([]);

  const [masterData, setMasterData] = useState<MasterScreenerResponse | null>(null);
  const [loadingMaster, setLoadingMaster] = useState<boolean>(true);

  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [watchlistOpen, setWatchlistOpen] = useState<boolean>(false);
  const [compareOpen, setCompareOpen] = useState<boolean>(false);

  const { watchlist, alertRules } = useWatchlist();
  const { compareSymbols } = useCompareList();
  const { settings } = useTradingSettings();
  const {
    onboardingState,
    guideOpen,
    pausedAtStep,
    markTabVisited,
    setCurrentStep,
    completeGuide,
    skipGuide,
    pauseAndTryInApp,
    openGuide,
    resumeGuide,
    dismissPausedBanner,
  } = useOnboardingGuide();

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // Auto-expand sidebar group containing activeTab & record explored tab
  useEffect(() => {
    const parent = NAV_GROUPS.find((g) => g.items.some((i) => i.id === activeTab));
    if (parent) {
      setExpandedGroups((prev) => (prev[parent.id] ? prev : { ...prev, [parent.id]: true }));
    }
    markTabVisited(activeTab);
  }, [activeTab, markTabVisited]);

  const loadMeta = useCallback(async (attempt = 0) => {
    try {
      const [metaRes, schedRes] = await Promise.all([
        fetch('/api/meta'),
        fetch('/api/scheduler/status'),
      ]);
      if (!metaRes.ok || !schedRes.ok) {
        throw new Error('Market server returned an unexpected response');
      }
      const meta = await metaRes.json();
      const sched = await schedRes.json();
      setDates(meta.dates || []);
      setDaily(meta.daily || []);
      setSchedulerStatus(sched);
      setLoadingMeta(false);
    } catch (err) {
      if (attempt < 2) {
        setTimeout(() => {
          void loadMeta(attempt + 1);
        }, 1000);
        return;
      }
      setToast({
        kind: 'error',
        text: err instanceof Error ? `Unable to reach server: ${err.message}` : 'Unable to reach server',
      });
      setLoadingMeta(false);
    }
  }, []);

  const loadMasterData = useCallback(async () => {
    setLoadingMaster(true);
    try {
      const res = await fetch(`/api/master-screener?equityOnly=${equityOnly}&annualWeightPct=70`);
      if (res.ok) {
        const body = (await res.json()) as MasterScreenerResponse;
        setMasterData(body);
      }
    } catch {
      // Non-fatal; individual views can also fetch their own datasets
    } finally {
      setLoadingMaster(false);
    }
  }, [equityOnly]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadMasterData();
  }, [loadMasterData]);

  useEffect(() => {
    const latest = dates[dates.length - 1];
    if (!latest) return;
    fetch(`/api/symbols?day=${encodeURIComponent(latest)}&equityOnly=${equityOnly}`)
      .then((r) => r.json())
      .then((d) => setAllSymbols(d.symbols || []))
      .catch(() => null);
  }, [dates, equityOnly]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleQuickPull = async () => {
    setPulling(true);
    setToast(null);
    try {
      const res = await fetch('/api/scraper/latest', { method: 'POST' });
      const data = await res.json();
      if (data.entry?.status === 'success') {
        setToast({ kind: 'success', text: data.entry.message });
        await Promise.all([loadMeta(), loadMasterData()]);
      } else {
        setToast({ kind: 'error', text: data.entry?.message || 'Pull failed' });
      }
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Network error pulling latest data',
      });
    } finally {
      setPulling(false);
    }
  };

  const navigateTo = useCallback(
    (
      nextTab: NavTab,
      opts?: { explorerSymbol?: string | null; quantSymbol?: string | null; bumpQuantTick?: boolean }
    ) => {
      const nextExp = opts?.explorerSymbol !== undefined ? opts.explorerSymbol : explorerSymbol;
      const nextQuant = opts?.quantSymbol !== undefined ? opts.quantSymbol : quantSymbol;
      if (
        nextTab === activeTab &&
        nextExp === explorerSymbol &&
        nextQuant === quantSymbol
      ) {
        return;
      }
      setNavHistory((prev) => [
        ...prev.slice(-29),
        { tab: activeTab, explorerSymbol, quantSymbol },
      ]);
      if (opts?.explorerSymbol !== undefined) setExplorerSymbol(opts.explorerSymbol);
      if (opts?.quantSymbol !== undefined) setQuantSymbol(opts.quantSymbol);
      if (opts?.bumpQuantTick) setQuantNavTick((n) => n + 1);
      setActiveTab(nextTab);
    },
    [activeTab, explorerSymbol, quantSymbol]
  );

  const handleBack = useCallback(() => {
    setNavHistory((prev) => {
      if (prev.length === 0) return prev;
      const target = prev[prev.length - 1];
      setExplorerSymbol(target.explorerSymbol);
      setQuantSymbol(target.quantSymbol);
      setActiveTab(target.tab);
      return prev.slice(0, -1);
    });
  }, []);

  const inspectSymbol = (symbol: string) => {
    const clean = symbol.toUpperCase();
    setActiveTicker(clean);
    navigateTo('explorer', { explorerSymbol: clean });
  };

  const inspectInQuant = (symbol: string) => {
    const clean = symbol.toUpperCase();
    setActiveTicker(clean);
    navigateTo('scanners', { quantSymbol: clean, bumpQuantTick: true });
  };

  const inspectInAnalyzer = (symbol: string) => {
    const clean = symbol.toUpperCase();
    setActiveTicker(clean);
    navigateTo('analyzer', { explorerSymbol: clean });
  };

  const inspectInValuation = (symbol?: string) => {
    if (symbol) {
      const clean = symbol.toUpperCase();
      setActiveTicker(clean);
      setValuationSymbol(clean);
    }
    navigateTo('valuation');
  };

  const inspectInScreener = (symbol: string) => {
    const clean = symbol.toUpperCase();
    setActiveTicker(clean);
    setScreenerTarget({ symbol: clean, tick: Date.now() });
    navigateTo('screener');
  };

  const inspectInAnnualReports = (symbol?: string) => {
    if (symbol) {
      const clean = symbol.toUpperCase();
      setActiveTicker(clean);
      setAnnualReportSymbol(clean);
    }
    navigateTo('annual-reports');
  };

  const inspectInFinancialsVault = (symbol?: string) => {
    if (symbol) {
      const clean = symbol.toUpperCase();
      setActiveTicker(clean);
      setVaultSymbol(clean);
    }
    navigateTo('financials-vault');
  };

  const handleSelectFundamentalMenu = (target: FundamentalMenuId, symbol?: string | null) => {
    const clean = symbol ? symbol.toUpperCase() : undefined;
    if (target === 'valuation') {
      inspectInValuation(clean);
    } else if (target === 'annual-reports') {
      inspectInAnnualReports(clean);
    } else if (target === 'strategic-outlook') {
      if (clean) setActiveTicker(clean);
      navigateTo('strategic-outlook');
    } else if (target === 'financials-vault') {
      inspectInFinancialsVault(clean);
    } else {
      if (clean) setActiveTicker(clean);
      setScreenerTarget(null);
      setScreenerSubViewTarget({ view: target, tick: Date.now() });
      navigateTo('screener');
    }
  };

  const handleStock360Switch = (view: Stock360Tab, sym: string) => {
    const clean = sym.toUpperCase();
    if (view === 'valuation') inspectInValuation(clean);
    else if (view === 'screener') inspectInScreener(clean);
    else if (view === 'annual-reports') inspectInAnnualReports(clean);
    else if (view === 'financials-vault') inspectInFinancialsVault(clean);
    else if (view === 'explorer') inspectSymbol(clean);
    else inspectInAnalyzer(clean);
  };

  const handleTryGuideTarget = (target: GuideStepTarget, stepIndex: number) => {
    pauseAndTryInApp(stepIndex);
    if (target.action === 'palette') {
      setPaletteOpen(true);
    } else if (target.action === 'watchlist') {
      setWatchlistOpen(true);
    } else if (target.action === 'compare') {
      setCompareOpen(true);
    } else if (target.tabId) {
      navigateTo(target.tabId as NavTab);
    }
  };

  const masterRowMap = useMemo(() => {
    const m = new Map<string, NonNullable<typeof masterData>['rows'][number]>();
    for (const r of masterData?.rows ?? []) m.set(r.symbol, r);
    return m;
  }, [masterData]);

  const watchlistAlertCount = useMemo(() => {
    let count = 0;
    for (const sym of watchlist) {
      count += evaluateWatchlistAlerts(masterRowMap.get(sym), alertRules[sym]).length;
    }
    return count;
  }, [watchlist, masterRowMap, alertRules]);

  const previousNavItem =
    navHistory.length > 0
      ? NAV_ITEMS.find((n) => n.id === navHistory[navHistory.length - 1].tab) ?? null
      : null;

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab)!;
  const needsMarketData =
    activeTab !== 'today' &&
    activeTab !== 'algorithms' &&
    activeTab !== 'scheduler' &&
    activeTab !== 'macro' &&
    activeTab !== 'master-screener' &&
    activeTab !== 'portfolio' &&
    activeTab !== 'screener' &&
    activeTab !== 'annual-reports' &&
    activeTab !== 'strategic-outlook' &&
    activeTab !== 'financials-vault' &&
    activeTab !== 'valuation' &&
    activeTab !== 'settings';

  const stock360View: Stock360Tab | null =
    activeTab === 'valuation' ||
    activeTab === 'screener' ||
    activeTab === 'annual-reports' ||
    activeTab === 'financials-vault' ||
    activeTab === 'explorer' ||
    activeTab === 'analyzer'
      ? activeTab
      : null;

  const resolved360Ticker =
    activeTicker ||
    (activeTab === 'valuation' ? valuationSymbol : null) ||
    (activeTab === 'annual-reports' ? annualReportSymbol : null) ||
    (activeTab === 'financials-vault' ? vaultSymbol : null) ||
    (activeTab === 'explorer' || activeTab === 'analyzer' ? explorerSymbol : null);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            navigateTo('today');
            setMobileMenuOpen(false);
          }}
          className="flex items-center gap-2.5 min-w-0 text-left"
        >
          <Compass className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            NEPSE Workbench
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-2 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const isOpen = expandedGroups[group.id];
          const hasActive = group.items.some((i) => i.id === activeTab);
          return (
            <div key={group.id} className="space-y-0.5">
              <button
                type="button"
                onClick={() =>
                  setExpandedGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                }
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
              >
                <span className={hasActive ? 'text-blue-600 dark:text-blue-400' : ''}>
                  {group.label}
                </span>
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                )}
              </button>

              {isOpen && (
                <div className="space-y-0.5 pl-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          navigateTo(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs">
        <label className="flex items-start gap-2.5 cursor-pointer text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={equityOnly}
            onChange={(e) => setEquityOnly(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
          />
          <span>
            <span className="font-medium block">Equities only</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug block">
              Exclude funds &amp; debentures
            </span>
          </span>
        </label>

        <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800/70">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span>Data feed</span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-slate-700 dark:text-slate-300">
              <span>NEPSE EOD</span>
              <InfoTip
                title="EOD / Historical Data Policy"
                body="All prices, volumes, and rolling N-day signals are computed from loaded End-of-Day (EOD) CSV sessions rather than live streaming ticks."
                align="left"
              />
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span>Rolling window</span>
            <button
              type="button"
              onClick={() => {
                navigateTo('settings');
                setMobileMenuOpen(false);
              }}
              className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
            >
              N = {settings.lookbackDays}d
            </button>
          </div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span>Sessions loaded</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {dates.length}
            </span>
          </div>
          {dates.length > 0 && (
            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {dates[0]} → {dates[dates.length - 1]}
            </div>
          )}
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 pt-1">
            <span>Daily pull</span>
            <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
              {schedulerStatus?.config.enabled
                ? `${schedulerStatus.config.time} (${formatTimeUntil(schedulerStatus.nextRunIso)})`
                : 'Paused'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            openGuide(0);
            setMobileMenuOpen(false);
          }}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          <span className="inline-flex items-center gap-1.5 font-medium">
            <HelpCircle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>App Guide &amp; Tour</span>
          </span>
          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
            {onboardingState.visitedTabs.length} views
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 h-full">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            {navHistory.length > 0 && (
              <button
                type="button"
                onClick={handleBack}
                title={previousNavItem ? `Back to ${previousNavItem.label}` : 'Go back'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {previousNavItem ? `Back · ${previousNavItem.label}` : 'Back'}
                </span>
                <span className="sm:hidden">Back</span>
              </button>
            )}
            <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline whitespace-nowrap">
                NEPSE
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {currentNav.label}
              </h1>
              {dates.length > 0 && (
                <span className="hidden md:inline text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                  · EOD {dates[dates.length - 1]}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden sm:inline">Jump ticker or screen…</span>
              <span className="sm:hidden">Jump</span>
              <span className="hidden md:inline font-mono text-[10px] text-slate-400">⌘K</span>
            </button>

            <button
              type="button"
              onClick={() => setWatchlistOpen(true)}
              title="Open Watchlist & Smart Alerts"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Bell className="w-3.5 h-3.5 text-amber-500" />
              <span className="hidden sm:inline">Watchlist</span>
              <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                {watchlist.length}
                {watchlistAlertCount > 0 ? ` (${watchlistAlertCount})` : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              title="Compare 2 to 4 stocks side by side"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 ${
                compareSymbols.length >= 2
                  ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Compare</span>
              <span className="font-mono tabular-nums text-[11px]">{compareSymbols.length}</span>
            </button>

            <button
              type="button"
              onClick={() => openGuide(0)}
              title="Open interactive walkthrough & feature guide"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <HelpCircle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span className="hidden md:inline">Guide</span>
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((v) => !v)}
              aria-label="Toggle theme"
              className="p-2 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={handleQuickPull}
              disabled={pulling}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${pulling ? 'animate-spin' : ''}`} />
              <span>{pulling ? 'Pulling…' : 'Pull Latest'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto space-y-6">
          {toast && (
            <div
              className={`px-4 py-2.5 rounded-md border text-xs flex items-center justify-between gap-4 ${
                toast.kind === 'error'
                  ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              <span>{toast.text}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-current opacity-70 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
          )}

          {stock360View && resolved360Ticker && (
            <Stock360Bar
              symbol={resolved360Ticker}
              activeView={stock360View}
              row={masterRowMap.get(resolved360Ticker)}
              onSwitchView={handleStock360Switch}
              onOpenCompareDrawer={() => setCompareOpen(true)}
            />
          )}

          {loadingMeta ? (
            <div className="space-y-4">
              <div className="h-8 w-56 animate-pulse bg-slate-200 dark:bg-slate-800 rounded" />
              <div className="h-64 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
            </div>
          ) : needsMarketData && dates.length === 0 ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-8 max-w-2xl mx-auto mt-8 space-y-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                No NEPSE trading data loaded yet
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Pull today&apos;s market table directly, backfill a multi-month
                range for technical scanners, or import local <code className="font-mono">YYYY-MM-DD.csv</code>{' '}
                files. The daily scheduler is active and will keep your dataset updated automatically.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleQuickPull}
                  disabled={pulling}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${pulling ? 'animate-spin' : ''}`} />
                  <span>{pulling ? 'Pulling Latest…' : 'Pull Latest'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('scheduler')}
                  className="px-4 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Open Scheduler &amp; Backfill
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('algorithms')}
                  className="px-4 py-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Browse Algorithm Methodology
                </button>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'today' && (
                <TodayBriefingView
                  daily={daily}
                  equityOnly={equityOnly}
                  masterData={masterData}
                  loadingMaster={loadingMaster}
                  onOpenMasterScreener={() => navigateTo('master-screener')}
                  onOpenValuation={inspectInValuation}
                  onInspectSymbol={inspectSymbol}
                  onInspectInAnalyzer={inspectInAnalyzer}
                  onInspectInScreener={inspectInScreener}
                  onOpenAnnualReports={inspectInAnnualReports}
                  onOpenWatchlistDrawer={() => setWatchlistOpen(true)}
                  onOpenCompareDrawer={() => setCompareOpen(true)}
                />
              )}
              {activeTab === 'overview' && (
                <OverviewView
                  dates={dates}
                  daily={daily}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                  onInspectInQuant={inspectInQuant}
                  onInspectInAnalyzer={inspectInAnalyzer}
                  onOpenScheduler={() => navigateTo('scheduler')}
                />
              )}
              {activeTab === 'master-screener' && (
                <MasterScreenerView
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                  onInspectInAnalyzer={inspectInAnalyzer}
                  onOpenValuation={inspectInValuation}
                  onInspectInScreener={inspectInScreener}
                />
              )}
              {activeTab === 'portfolio' && (
                <PortfolioTradeDeskView
                  masterData={masterData}
                  loadingMaster={loadingMaster}
                  onInspectSymbol={inspectSymbol}
                  onInspectInAnalyzer={inspectInAnalyzer}
                  onOpenValuation={inspectInValuation}
                  onInspectInScreener={inspectInScreener}
                />
              )}
              {activeTab === 'screener' && (
                <FundamentalScreenerView
                  equityOnly={equityOnly}
                  initialTarget={screenerTarget}
                  initialSubView={screenerSubViewTarget}
                  onInspectSymbol={inspectSymbol}
                  onInspectInAnalyzer={inspectInAnalyzer}
                  onOpenValuation={inspectInValuation}
                  onSymbolChange={(sym) => setActiveTicker(sym)}
                  onSelectFundamentalMenu={handleSelectFundamentalMenu}
                />
              )}
              {activeTab === 'annual-reports' && (
                <AnnualReportView
                  equityOnly={equityOnly}
                  initialSymbol={annualReportSymbol || valuationSymbol || explorerSymbol}
                  onSymbolChange={(sym) => {
                    setActiveTicker(sym);
                    setAnnualReportSymbol(sym);
                  }}
                  onOpenValuation={inspectInValuation}
                  onInspectInScreener={inspectInScreener}
                  onSelectFundamentalMenu={handleSelectFundamentalMenu}
                />
              )}
              {activeTab === 'strategic-outlook' && (
                <StrategicOutlookView
                  equityOnly={equityOnly}
                  initialSymbol={activeTicker || annualReportSymbol || valuationSymbol || explorerSymbol}
                  onSymbolChange={(sym) => setActiveTicker(sym)}
                  onOpenAnnualReports={inspectInAnnualReports}
                  onOpenValuation={inspectInValuation}
                  onInspectSymbol={inspectSymbol}
                  onInspectInScreener={inspectInScreener}
                  onSelectFundamentalMenu={handleSelectFundamentalMenu}
                />
              )}
              {activeTab === 'financials-vault' && (
                <FinancialsVaultView
                  allSymbols={allSymbols}
                  initialSymbol={vaultSymbol || activeTicker || valuationSymbol || annualReportSymbol || explorerSymbol}
                  onSymbolChange={(sym) => {
                    setActiveTicker(sym);
                    setVaultSymbol(sym);
                  }}
                  onInspectChart={inspectSymbol}
                  onSelectFundamentalMenu={handleSelectFundamentalMenu}
                />
              )}
              {activeTab === 'valuation' && (
                <ValuationView
                  equityOnly={equityOnly}
                  initialSymbol={valuationSymbol || explorerSymbol}
                  onInspectSymbol={inspectSymbol}
                  onInspectInAnalyzer={inspectInAnalyzer}
                  onInspectInScreener={inspectInScreener}
                  onSymbolChange={(sym) => {
                    setActiveTicker(sym);
                    setValuationSymbol(sym);
                  }}
                  onSelectFundamentalMenu={handleSelectFundamentalMenu}
                />
              )}
              {activeTab === 'pulse' && (
                <MarketPulseView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'turnover' && (
                <TopTurnoverView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'radar' && (
                <OpportunityRadarView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                  onInspectInQuant={inspectInQuant}
                  onInspectInAnalyzer={inspectInAnalyzer}
                />
              )}
              {activeTab === 'direction' && (
                <TurnoverDirectionView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                  onInspectInQuant={inspectInQuant}
                  onInspectInAnalyzer={inspectInAnalyzer}
                />
              )}
              {activeTab === 'scanners' && (
                <ScannersView
                  dates={dates}
                  equityOnly={equityOnly}
                  initialQuantSymbol={quantSymbol}
                  initialQuantTick={quantNavTick}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'explorer' && (
                <StockExplorerView
                  dates={dates}
                  equityOnly={equityOnly}
                  initialSymbol={explorerSymbol}
                  onInspectInQuant={inspectInQuant}
                  onSymbolChange={(sym) => {
                    setActiveTicker(sym);
                    setExplorerSymbol(sym);
                  }}
                />
              )}
              {activeTab === 'analyzer' && (
                <AnalyzerView
                  dates={dates}
                  equityOnly={equityOnly}
                  allSymbols={allSymbols}
                  initialSymbol={explorerSymbol}
                  onSymbolChange={(sym) => {
                    setActiveTicker(sym);
                    setExplorerSymbol(sym);
                  }}
                />
              )}
              {activeTab === 'macro' && (
                <MacroRisksView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'fundamentally-risky' && (
                <FundamentallyRiskyView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'technically-risky' && (
                <TechnicallyRiskyView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'do-not-buy' && (
                <CompositeDoNotBuyView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'opportunity-vs-risk' && (
                <MarketOpportunityVsRiskView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'algorithms' && (
                <AlgorithmsView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'settings' && <SettingsView />}
              {activeTab === 'scheduler' && <SchedulerView onDataChanged={loadMeta} />}
            </>
          )}
        </main>
      </div>

      <CommandPaletteModal
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        symbols={allSymbols}
        navItems={PALETTE_NAV_ITEMS}
        onNavigateTab={(id) => navigateTo(id as NavTab)}
        onOpenValuation={inspectInValuation}
        onInspectInScreener={inspectInScreener}
        onOpenAnnualReports={inspectInAnnualReports}
        onInspectSymbol={inspectSymbol}
        onInspectInAnalyzer={inspectInAnalyzer}
      />

      <WatchlistAlertsDrawer
        open={watchlistOpen}
        onClose={() => setWatchlistOpen(false)}
        rows={masterData?.rows ?? []}
        onOpenValuation={inspectInValuation}
        onInspectSymbol={inspectSymbol}
        onOpenCompareDrawer={() => setCompareOpen(true)}
      />

      <CompareStocksDrawer
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        rows={masterData?.rows ?? []}
        onOpenValuation={inspectInValuation}
        onInspectSymbol={inspectSymbol}
      />

      <OnboardingGuideModal
        open={guideOpen && !loadingMeta}
        initialStep={onboardingState.lastStep}
        visitedTabs={onboardingState.visitedTabs}
        completedSteps={onboardingState.completedSteps}
        onStepChange={setCurrentStep}
        onComplete={completeGuide}
        onSkip={skipGuide}
        onTryTarget={handleTryGuideTarget}
      />

      <OnboardingResumeBar
        stepIndex={pausedAtStep}
        onResume={resumeGuide}
        onDismiss={dismissPausedBanner}
      />
    </div>
  );
}
