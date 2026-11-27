import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarClock,
  CandlestickChart,
  Compass,
  Crosshair,
  FileWarning,
  Gauge,
  Globe,
  Menu,
  Moon,
  Radar,
  RefreshCw,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { InfoTip } from './components/InfoTip';
import { useTradingSettings } from './hooks/useTradingSettings';
import { useWatchlist } from './hooks/useWatchlist';
import type { DailyAggregate, SchedulerStatus, SymbolInfo } from './types/market';
import { formatTimeUntil } from './utils/format';
import { AlgorithmsView } from './views/AlgorithmsView';
import { AnalyzerView } from './views/AnalyzerView';
import { MacroRisksView } from './views/MacroRisksView';
import { MarketPulseView } from './views/MarketPulseView';
import { OpportunityRadarView } from './views/OpportunityRadarView';
import { OverviewView } from './views/OverviewView';
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
import { TopTurnoverView } from './views/TopTurnoverView';
import { TurnoverDirectionView } from './views/TurnoverDirectionView';

type NavTab =
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

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'pulse', label: 'Market Pulse', icon: Gauge },
  { id: 'turnover', label: 'Top Turnover', icon: TrendingUp },
  { id: 'radar', label: 'Opportunity Radar', icon: Sparkles },
  { id: 'direction', label: 'Turnover × Direction', icon: Activity },
  { id: 'scanners', label: 'Scanners', icon: Radar },
  { id: 'explorer', label: 'Stock Explorer', icon: CandlestickChart },
  { id: 'analyzer', label: 'Auto Analyzer', icon: Crosshair },
  { id: 'macro', label: 'Macro & Risks', icon: Globe },
  { id: 'fundamentally-risky', label: 'Fundamentally Risky Stocks', icon: FileWarning },
  { id: 'technically-risky', label: 'Technically Risky Stocks', icon: ShieldAlert },
  { id: 'do-not-buy', label: 'DO NOT BUY – High Risk Stocks', icon: AlertOctagon },
  { id: 'opportunity-vs-risk', label: 'Market Opportunity vs Risk', icon: Scale },
  { id: 'algorithms', label: 'Algorithms', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'scheduler', label: 'Scheduler & Data', icon: CalendarClock },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [dates, setDates] = useState<string[]>([]);
  const [daily, setDaily] = useState<DailyAggregate[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [equityOnly, setEquityOnly] = useState<boolean>(true);
  const [explorerSymbol, setExplorerSymbol] = useState<string | null>(null);
  const [quantSymbol, setQuantSymbol] = useState<string | null>(null);
  const [quantNavTick, setQuantNavTick] = useState<number>(0);
  const [navHistory, setNavHistory] = useState<
    Array<{ tab: NavTab; explorerSymbol: string | null; quantSymbol: string | null }>
  >([]);
  const [loadingMeta, setLoadingMeta] = useState<boolean>(true);
  const [pulling, setPulling] = useState<boolean>(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [allSymbols, setAllSymbols] = useState<SymbolInfo[]>([]);
  const [quickQuery, setQuickQuery] = useState<string>('');
  const [quickOpen, setQuickOpen] = useState<boolean>(false);
  const quickInputRef = useRef<HTMLInputElement | null>(null);
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();
  const { settings } = useTradingSettings();

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

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

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

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
        quickInputRef.current?.focus();
        setQuickOpen(true);
      } else if (e.key === 'Escape') {
        setQuickOpen(false);
        quickInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const quickMatches = useMemo(() => {
    const q = quickQuery.trim().toLowerCase();
    if (!q) return [];
    return allSymbols
      .filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ae = a.symbol.toLowerCase().startsWith(q) ? 0 : 1;
        const be = b.symbol.toLowerCase().startsWith(q) ? 0 : 1;
        return ae - be || a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 8);
  }, [allSymbols, quickQuery]);

  const handleQuickPull = async () => {
    setPulling(true);
    setToast(null);
    try {
      const res = await fetch('/api/scraper/latest', { method: 'POST' });
      const data = await res.json();
      if (data.entry?.status === 'success') {
        setToast({ kind: 'success', text: data.entry.message });
        await loadMeta();
      } else {
        setToast({ kind: 'error', text: data.entry?.message || 'Pull failed' });
      }
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Network error pulling ShareSansar',
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
    navigateTo('explorer', { explorerSymbol: symbol });
  };

  const inspectInQuant = (symbol: string) => {
    navigateTo('scanners', { quantSymbol: symbol, bumpQuantTick: true });
  };

  const inspectInAnalyzer = (symbol: string) => {
    navigateTo('analyzer', { explorerSymbol: symbol });
  };

  const previousNavItem =
    navHistory.length > 0
      ? NAV_ITEMS.find((n) => n.id === navHistory[navHistory.length - 1].tab) ?? null
      : null;

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab)!;
  const needsMarketData =
    activeTab !== 'algorithms' &&
    activeTab !== 'scheduler' &&
    activeTab !== 'macro' &&
    activeTab !== 'settings';

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <Compass className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            NEPSE Workbench
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
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
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
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
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-4 text-xs">
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
              <span>ShareSansar EOD</span>
              <InfoTip
                title="EOD / Historical Data Policy"
                body="All prices, volumes, and rolling N-day signals are computed from loaded ShareSansar End-of-Day (EOD) CSV sessions rather than live streaming ticks."
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
            <span>Watchlist</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {watchlist.length}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 pt-1">
            <span>Daily pull</span>
            <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
              {schedulerStatus?.config.enabled
                ? `${schedulerStatus.config.time} (${formatTimeUntil(schedulerStatus.nextRunIso)})`
                : 'Paused'}
            </span>
          </div>
        </div>
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
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
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
                <span className="hidden md:inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  EOD: {dates[dates.length - 1]}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {allSymbols.length > 0 && (
              <div className="relative hidden sm:block">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={quickInputRef}
                  type="text"
                  value={quickQuery}
                  onFocus={() => setQuickOpen(true)}
                  onBlur={() => setTimeout(() => setQuickOpen(false), 160)}
                  onChange={(e) => {
                    setQuickQuery(e.target.value);
                    setQuickOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && quickMatches.length > 0) {
                      inspectSymbol(quickMatches[0].symbol);
                      setQuickQuery('');
                      setQuickOpen(false);
                    }
                  }}
                  placeholder="Jump ticker (⌘K)…"
                  className="w-44 lg:w-56 pl-8 pr-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
                {quickOpen && quickMatches.length > 0 && (
                  <div className="absolute right-0 mt-1 w-72 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg z-50 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                    {quickMatches.map((m) => {
                      const starred = hasSymbol(m.symbol);
                      return (
                        <div
                          key={m.symbol}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/70"
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              inspectSymbol(m.symbol);
                              setQuickQuery('');
                              setQuickOpen(false);
                            }}
                            className="flex-1 min-w-0 text-left flex items-center gap-2"
                          >
                            <span className="font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                              {m.symbol}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400 truncate">
                              {m.name}
                            </span>
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              toggleSymbol(m.symbol);
                            }}
                            aria-label={`Star ${m.symbol}`}
                            className="p-0.5 text-slate-400 hover:text-amber-500 shrink-0"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${starred ? 'fill-amber-500 text-amber-500' : ''}`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setDarkMode((v) => !v)}
              aria-label="Toggle theme"
              className="p-2 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
                Pull today&apos;s market table directly from ShareSansar, backfill a multi-month
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
                  <span>{pulling ? 'Pulling ShareSansar…' : 'Pull Latest from ShareSansar'}</span>
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
                />
              )}
              {activeTab === 'direction' && (
                <TurnoverDirectionView
                  dates={dates}
                  equityOnly={equityOnly}
                  onInspectSymbol={inspectSymbol}
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
                />
              )}
              {activeTab === 'analyzer' && (
                <AnalyzerView
                  dates={dates}
                  equityOnly={equityOnly}
                  allSymbols={allSymbols}
                  initialSymbol={explorerSymbol}
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
    </div>
  );
}
