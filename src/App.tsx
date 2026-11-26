import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarClock,
  CandlestickChart,
  Compass,
  Gauge,
  Globe,
  Menu,
  Moon,
  Radar,
  RefreshCw,
  Search,
  Star,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { useWatchlist } from './hooks/useWatchlist';
import type { AppLanguage, DailyAggregate, SchedulerStatus, SymbolInfo } from './types/market';
import { formatTimeUntil } from './utils/format';
import { biText, NAV_LABELS } from './utils/i18n';
import { AlgorithmsView } from './views/AlgorithmsView';
import { MacroRisksView } from './views/MacroRisksView';
import { MarketPulseView } from './views/MarketPulseView';
import { OverviewView } from './views/OverviewView';
import { ScannersView } from './views/ScannersView';
import { SchedulerView } from './views/SchedulerView';
import { StockExplorerView } from './views/StockExplorerView';
import { TopTurnoverView } from './views/TopTurnoverView';
import { TurnoverDirectionView } from './views/TurnoverDirectionView';

type NavTab =
  | 'overview'
  | 'pulse'
  | 'turnover'
  | 'direction'
  | 'scanners'
  | 'explorer'
  | 'macro'
  | 'algorithms'
  | 'scheduler';

const NAV_ITEMS: Array<{ id: NavTab; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', icon: BarChart3 },
  { id: 'pulse', icon: Gauge },
  { id: 'turnover', icon: TrendingUp },
  { id: 'direction', icon: Activity },
  { id: 'scanners', icon: Radar },
  { id: 'explorer', icon: CandlestickChart },
  { id: 'macro', icon: Globe },
  { id: 'algorithms', icon: BookOpen },
  { id: 'scheduler', icon: CalendarClock },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [dates, setDates] = useState<string[]>([]);
  const [daily, setDaily] = useState<DailyAggregate[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [equityOnly, setEquityOnly] = useState<boolean>(true);
  const [explorerSymbol, setExplorerSymbol] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState<boolean>(true);
  const [pulling, setPulling] = useState<boolean>(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [lang, setLang] = useState<AppLanguage>('bi');
  const [allSymbols, setAllSymbols] = useState<SymbolInfo[]>([]);
  const [quickQuery, setQuickQuery] = useState<string>('');
  const [quickOpen, setQuickOpen] = useState<boolean>(false);
  const quickInputRef = useRef<HTMLInputElement | null>(null);
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  const loadMeta = useCallback(async () => {
    try {
      const [metaRes, schedRes] = await Promise.all([
        fetch('/api/meta'),
        fetch('/api/scheduler/status'),
      ]);
      const meta = await metaRes.json();
      const sched = await schedRes.json();
      setDates(meta.dates || []);
      setDaily(meta.daily || []);
      setSchedulerStatus(sched);
    } finally {
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

  const inspectSymbol = (symbol: string) => {
    setExplorerSymbol(symbol);
    setActiveTab('explorer');
  };

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab)!;
  const currentNavLabel = biText(
    NAV_LABELS[currentNav.id].en,
    NAV_LABELS[currentNav.id].ne,
    lang
  );
  const needsMarketData =
    activeTab !== 'algorithms' && activeTab !== 'scheduler' && activeTab !== 'macro';

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
          const lbl = NAV_LABELS[item.id];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{biText(lbl.en, lbl.ne, lang)}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-4 text-xs">
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Language · भाषा
          </div>
          <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[11px]">
            {(
              [
                { id: 'bi', label: 'EN+ने' },
                { id: 'en', label: 'English' },
                { id: 'ne', label: 'नेपाली' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setLang(opt.id)}
                className={`py-1 rounded font-medium transition-colors whitespace-nowrap ${
                  lang === opt.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={equityOnly}
            onChange={(e) => setEquityOnly(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
          />
          <span>
            <span className="font-medium block">{biText('Equities only', 'इक्विटी मात्र', lang)}</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug block">
              Exclude funds &amp; debentures
            </span>
          </span>
        </label>

        <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800/70">
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
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
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

      {/* Main Content */}
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
            <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline whitespace-nowrap">
                NEPSE
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {currentNavLabel}
              </h1>
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
                  onOpenScheduler={() => setActiveTab('scheduler')}
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
                  lang={lang}
                  onInspectSymbol={inspectSymbol}
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
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'explorer' && (
                <StockExplorerView
                  dates={dates}
                  equityOnly={equityOnly}
                  lang={lang}
                  initialSymbol={explorerSymbol}
                />
              )}
              {activeTab === 'macro' && (
                <MacroRisksView
                  dates={dates}
                  equityOnly={equityOnly}
                  lang={lang}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'algorithms' && (
                <AlgorithmsView
                  dates={dates}
                  equityOnly={equityOnly}
                  lang={lang}
                  onInspectSymbol={inspectSymbol}
                />
              )}
              {activeTab === 'scheduler' && <SchedulerView onDataChanged={loadMeta} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
