import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CandlestickChart,
  Check,
  CheckCircle2,
  Compass,
  HelpCircle,
  Home,
  Scale,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';

export interface GuideStepTarget {
  label: string;
  tabId?: string;
  action?: 'palette' | 'watchlist' | 'compare';
}

interface GuideStep {
  id: string;
  stepNum: string;
  title: string;
  tagline: string;
  summary: string;
  icon: React.ComponentType<{ className?: string }>;
  howTo: Array<{ title: string; detail: string }>;
  highlights: Array<{ label: string; desc: string }>;
  relatedTabs: string[];
  tryTargets: GuideStepTarget[];
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'today',
    stepNum: '01',
    title: 'Today Briefing & Market Command',
    tagline: 'Read NEPSE volume, turnover spikes, heat maps & daily leaders in under a minute',
    summary:
      'Your home base aggregates daily NEPSE market breadth, money flow comparisons against prior sessions, unusual stock surges, and a 3-step guided stock picker.',
    icon: Home,
    howTo: [
      {
        title: 'Compare liquidity vs history',
        detail:
          'Check Today Turnover & Volume against Previous Day, 5D Avg, and 20D Norm. Click any bar in the 14-session pulse strip to inspect that past session.',
      },
      {
        title: 'Spot Blow-Out & Short/Trap scripts',
        detail:
          'Review the top bullish expansion candidates alongside high-volume distribution or upper-wick trap alerts with VWAP and close-position telemetry.',
      },
      {
        title: 'Drill into Sector & Top 60 Heat Maps',
        detail:
          'Click any sector tile to reveal its active stocks, or switch to Top 60 Stocks and hover tiles for instant spike multipliers.',
      },
    ],
    highlights: [
      { label: 'Up vs Down Tilt', desc: 'Tracks net rupees flowing into green vs red stocks' },
      { label: 'Unusual Activity', desc: 'Filters liquid equities with dual volume & turnover spikes' },
      { label: 'Find -> Verify -> Time', desc: 'Guided 3-column wizard linking goals to value & chart entry' },
    ],
    relatedTabs: ['today'],
    tryTargets: [{ label: 'View Today Briefing', tabId: 'today' }],
  },
  {
    id: 'discovery',
    stepNum: '02',
    title: 'Screeners & Institutional Flow',
    tagline: 'Rank 200+ NEPSE equities by blended fundamentals, player flow & momentum',
    summary:
      'Narrow the entire market down to high-conviction setups using Master Screener confluence, Opportunity Radar, and Turnover × Direction quadrants.',
    icon: SlidersHorizontal,
    howTo: [
      {
        title: 'Filter by goal in Master Screener',
        detail:
          'Sort across Master Score, Margin of Safety, Valuation Health, 10x multi-bagger runway, and Player Flow while filtering out lock-in risks.',
      },
      {
        title: 'Track Money Rotation in Turnover × Direction',
        detail:
          'Separate Quiet Accumulation and Breakout Accumulation from Heavy Distribution before committing capital.',
      },
      {
        title: 'Scan breakouts with Opportunity Radar & Scanners',
        detail:
          'Surface 20D/52W breakouts, volume expansions, and multi-factor setups across your chosen rolling window.',
      },
    ],
    highlights: [
      { label: 'Master Screener', desc: 'Unified table combining Value, Annual Health, Flow & Chart' },
      { label: 'Opportunity Radar', desc: 'Curates high-conviction setups across technical & value lenses' },
      { label: 'Scanners', desc: 'Rule-based technical, turnover, and accumulation screens' },
    ],
    relatedTabs: ['master-screener', 'radar', 'direction', 'scanners'],
    tryTargets: [
      { label: 'Open Master Screener', tabId: 'master-screener' },
      { label: 'Open Opportunity Radar', tabId: 'radar' },
      { label: 'Turnover × Direction', tabId: 'direction' },
    ],
  },
  {
    id: 'fundamentals',
    stepNum: '03',
    title: 'Valuation, 9-Investor & Annual Reports',
    tagline: 'Switch seamlessly across every fundamental lens with the Stock 360° Bar',
    summary:
      'Once you pick a ticker, the sticky Stock 360° Bar lets you jump between Fair Value modeling, 9-Investor quality rules, and multi-year Annual Report intelligence without losing context.',
    icon: Scale,
    howTo: [
      {
        title: 'Check Fair Value & Buy Zone',
        detail:
          'Pricing & Valuation blends DCF, Graham, DDM, and PB-ROE (weighted 70% Annual / 30% Quarterly) to estimate Margin of Safety and Buy Zone prices.',
      },
      {
        title: 'Inspect the 9-Investor Dossier',
        detail:
          'See how a company scores across Buffet, Graham, Lynch, Piotroski, Greenblatt, and NEPSE-specific capital & reserve strength rules.',
      },
      {
        title: 'Distill Multi-Year Annual Reports',
        detail:
          'Compare audited fiscal years side-by-side across Management Quality, Growth, Risks, Weaknesses, Plans, and optional on-demand AI deep dives.',
      },
    ],
    highlights: [
      { label: 'Stock 360° Bar', desc: 'One-click context switcher across 5 single-stock views' },
      { label: '70/30 Basis', desc: 'Prioritizes audited annual filings while factoring latest quarters' },
      { label: 'Historical FY Tabs', desc: 'Track YoY revenue, EPS, net worth & efficiency shifts' },
    ],
    relatedTabs: ['valuation', 'screener', 'annual-reports'],
    tryTargets: [
      { label: 'Open Pricing & Valuation', tabId: 'valuation' },
      { label: 'Open Fundamental Screener', tabId: 'screener' },
      { label: 'Open Annual Reports', tabId: 'annual-reports' },
    ],
  },
  {
    id: 'charts',
    stepNum: '04',
    title: 'Charts & ICT/SMC Trade Plans',
    tagline: 'Time disciplined entries with interactive charts and causal market structure',
    summary:
      'Pair fundamental conviction with technical execution using TradingView-powered price action, support/resistance, and automated ICT/SMC setups.',
    icon: CandlestickChart,
    howTo: [
      {
        title: 'Inspect trend & levels in Stock Explorer',
        detail:
          'Examine candlestick history with EMA 20/50/200 overlays, VWAP anchor, RSI-14, 52W highs/lows, and volume spike bars.',
      },
      {
        title: 'Build causal trade plans in Auto Analyzer',
        detail:
          'Inspect zero-look-ahead Swings, BOS/CHoCH structure breaks, Order Blocks, Fair Value Gaps (FVG), and Liquidity Sweeps.',
      },
      {
        title: 'Validate Risk-to-Reward & NEPSE ticks',
        detail:
          'Every setup snaps entry, stop-loss, and targets to Rs 0.10 NEPSE tick rules and rejects trades below minimum R:R.',
      },
    ],
    highlights: [
      { label: 'Zero Look-Ahead', desc: 'Swings and zones confirm strictly using prior bars only' },
      { label: 'Liquidity Sweeps vs Runs', desc: 'Distinguishes wick rejections from true breakouts' },
      { label: 'Annotated PNG Export', desc: 'Download charts with OHLCV, setups & drawings baked in' },
    ],
    relatedTabs: ['explorer', 'analyzer', 'pulse', 'turnover'],
    tryTargets: [
      { label: 'Open Stock Explorer', tabId: 'explorer' },
      { label: 'Open Auto Analyzer', tabId: 'analyzer' },
    ],
  },
  {
    id: 'risk',
    stepNum: '05',
    title: 'Macro Context, Risk Shields & Methodology',
    tagline: 'Avoid promoter lock-in overhangs, weak balance sheets & blow-off traps',
    summary:
      'Capital preservation comes first. Dedicated risk views flag regulatory alerts, macro interest-rate headwinds, and stocks failing both technical and fundamental checks.',
    icon: ShieldAlert,
    howTo: [
      {
        title: 'Monitor NRB & Macro Risks',
        detail:
          'Compare stock earnings yields against Nepal Bank FD rates and review regulatory KB notices and lock-in expiry schedules.',
      },
      {
        title: 'Review the DO NOT BUY & Risk lists',
        detail:
          'Cross-check watchlist ideas against Fundamentally Risky, Technically Risky, and Composite DO NOT BUY screens before placing orders.',
      },
      {
        title: 'Tune formulas in Settings & Algorithms',
        detail:
          'Inspect exact formulas in Algorithms and customize your N-day lookback window or risk defaults in Settings.',
      },
    ],
    highlights: [
      { label: 'Lock-in Overhang Alerts', desc: 'Flags upcoming promoter/local share unlocks' },
      { label: 'FD Spread Check', desc: 'Measures whether equity earnings beat risk-free FD yields' },
      { label: 'Transparent Formulas', desc: 'Every score and multiplier is documented openly' },
    ],
    relatedTabs: ['macro', 'fundamentally-risky', 'technically-risky', 'do-not-buy', 'algorithms', 'settings'],
    tryTargets: [
      { label: 'Open Macro & Risks', tabId: 'macro' },
      { label: 'Open DO NOT BUY Guard', tabId: 'do-not-buy' },
      { label: 'Open Algorithms', tabId: 'algorithms' },
    ],
  },
  {
    id: 'shortcuts',
    stepNum: '06',
    title: 'Power Tools, Shortcuts & Daily Sync',
    tagline: 'Navigate at keyboard speed with ⌘K, Watchlist Alerts, Compare & Pull Latest',
    summary:
      'Use global header tools from any screen to jump directly to stocks, track custom buy-zone alerts, compare peers side-by-side, and keep market CSV data up to date.',
    icon: Search,
    howTo: [
      {
        title: 'Press ⌘K (or Ctrl+K) anywhere',
        detail:
          'Search any NEPSE symbol or workspace screen and jump straight to its Valuation, Dossier, Annual Report, Chart, or Analyzer in one keystroke.',
      },
      {
        title: 'Set Watchlist Buy-Zone & Breakout Alerts',
        detail:
          'Star stocks across tables and configure target buy/sell prices or automated Buy-Zone alerts inside the Watchlist drawer.',
      },
      {
        title: 'Compare up to 4 stocks & Pull Latest EOD',
        detail:
          'Add 2–4 peers to Compare side-by-side, toggle Equities Only in the sidebar, switch Light/Dark theme, or run Pull Latest / Scheduler.',
      },
    ],
    highlights: [
      { label: '⌘K / Ctrl+K', desc: 'Global quick jump for all tickers and 22 screens' },
      { label: 'Portfolio & Trade Desk', desc: 'NEPSE after-tax WACC, risk audit, cash deployer & journal' },
      { label: 'Auto Scheduler', desc: 'Daily EOD data refresh & historical CSV backfill control' },
    ],
    relatedTabs: ['portfolio', 'scheduler'],
    tryTargets: [
      { label: 'Open Portfolio & Trade Desk', tabId: 'portfolio' },
      { label: 'Try ⌘K Jump Palette', action: 'palette' },
      { label: 'Open Watchlist Drawer', action: 'watchlist' },
    ],
  },
];

const CORE_EXPLORATION_MODULES: Array<{ id: string; label: string }> = [
  { id: 'today', label: 'Today Briefing' },
  { id: 'master-screener', label: 'Master Screener' },
  { id: 'valuation', label: 'Pricing & Valuation' },
  { id: 'annual-reports', label: 'Annual Reports' },
  { id: 'explorer', label: 'Stock Explorer' },
  { id: 'analyzer', label: 'Auto Analyzer' },
];

interface OnboardingGuideModalProps {
  open: boolean;
  initialStep?: number;
  visitedTabs: string[];
  completedSteps: number[];
  onStepChange: (stepIndex: number) => void;
  onComplete: () => void;
  onSkip: () => void;
  onTryTarget: (target: GuideStepTarget, stepIndex: number) => void;
}

export const OnboardingGuideModal: React.FC<OnboardingGuideModalProps> = ({
  open,
  initialStep = 0,
  visitedTabs,
  completedSteps,
  onStepChange,
  onComplete,
  onSkip,
  onTryTarget,
}) => {
  const [stepIdx, setStepIdx] = useState<number>(initialStep);

  useEffect(() => {
    if (open) {
      const clamped = Math.max(0, Math.min(GUIDE_STEPS.length - 1, initialStep));
      setStepIdx(clamped);
      onStepChange(clamped);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStep]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSkip();
      } else if (e.key === 'ArrowRight') {
        setStepIdx((prev) => {
          const next = Math.min(GUIDE_STEPS.length - 1, prev + 1);
          onStepChange(next);
          return next;
        });
      } else if (e.key === 'ArrowLeft') {
        setStepIdx((prev) => {
          const next = Math.max(0, prev - 1);
          onStepChange(next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onSkip, onStepChange]);

  if (!open) return null;

  const currentStep = GUIDE_STEPS[stepIdx];
  const StepIcon = currentStep.icon;
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === GUIDE_STEPS.length - 1;
  const exploredCount = CORE_EXPLORATION_MODULES.filter((m) =>
    visitedTabs.includes(m.id)
  ).length;

  const goToStep = (next: number) => {
    const clamped = Math.max(0, Math.min(GUIDE_STEPS.length - 1, next));
    setStepIdx(clamped);
    onStepChange(clamped);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-guide-title"
    >
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-[1px]"
        onClick={onSkip}
      />

      <div className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <Compass className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <div className="flex flex-wrap items-center gap-x-2 text-xs">
              <span className="font-display font-bold text-slate-900 dark:text-slate-100">
                NEPSE Workbench Guide
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Step {stepIdx + 1} of {GUIDE_STEPS.length}
              </span>
              <span aria-hidden="true" className="hidden sm:inline text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span className="hidden sm:inline font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {exploredCount}/{CORE_EXPLORATION_MODULES.length} core views explored
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onSkip}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Skip Tutorial
            </button>
            <button
              type="button"
              onClick={onSkip}
              aria-label="Close guide"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: Left Step Rail + Active Step Stage */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12">
          {/* Left Navigation Rail */}
          <aside className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 p-3 sm:p-4">
            <div className="hidden md:block text-[11px] font-semibold text-slate-500 dark:text-slate-400 px-2 mb-2">
              Walkthrough Roadmap
            </div>
            <div className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-x-visible pb-1 md:pb-0">
              {GUIDE_STEPS.map((s, idx) => {
                const active = idx === stepIdx;
                const seen = completedSteps.includes(idx);
                const exploredHere = s.relatedTabs.some((t) => visitedTabs.includes(t));
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => goToStep(idx)}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md text-left transition-colors shrink-0 md:shrink md:w-full ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`font-mono text-[11px] font-bold tabular-nums shrink-0 ${
                          active
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {s.stepNum}
                      </span>
                      <span className="text-xs font-medium truncate max-w-[140px] md:max-w-none">
                        {s.title}
                      </span>
                    </div>
                    {(seen || exploredHere) && !active && (
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 hidden md:block" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="hidden md:block mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 px-2 space-y-2">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Core Views Explored
              </div>
              <div className="space-y-1.5">
                {CORE_EXPLORATION_MODULES.map((m) => {
                  const visited = visitedTabs.includes(m.id);
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400"
                    >
                      <span>{m.label}</span>
                      <span
                        className={`font-mono ${
                          visited
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-slate-400 dark:text-slate-600'
                        }`}
                      >
                        {visited ? 'Visited' : 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Right Main Stage */}
          <div className="md:col-span-8 p-5 sm:p-6 space-y-5">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-medium">
                <StepIcon className="w-4 h-4 shrink-0" />
                <span className="font-mono tabular-nums">Section {currentStep.stepNum}</span>
                <span aria-hidden="true">·</span>
                <span>Interactive Tour</span>
              </div>
              <h2
                id="onboarding-guide-title"
                className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100"
              >
                {currentStep.title}
              </h2>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {currentStep.tagline}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {currentStep.summary}
              </p>
            </div>

            {/* 3-Point Practical Playbook */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/40 dark:bg-slate-950/30">
              {currentStep.howTo.map((item, i) => (
                <div key={item.title} className="p-3.5 flex items-start gap-3">
                  <span className="font-mono text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400 pt-0.5 shrink-0">
                    0{i + 1}
                  </span>
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {item.title}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Key Capabilities */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {currentStep.highlights.map((h) => (
                <div
                  key={h.label}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1"
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {h.label}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                    {h.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Interactive Jump Targets */}
            {currentStep.tryTargets.length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Try this feature live:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {currentStep.tryTargets.map((target) => (
                    <button
                      key={target.label}
                      type="button"
                      onClick={() => onTryTarget(target, stepIdx)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>{target.label}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Controls */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
            Once skipped or completed, this guide stays out of your way — reopen anytime via Guide in the header.
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {!isFirst && (
              <button
                type="button"
                onClick={() => goToStep(stepIdx - 1)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>
            )}

            <button
              type="button"
              onClick={onSkip}
              className="px-3 py-2 text-xs font-medium rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Skip
            </button>

            {isLast ? (
              <button
                type="button"
                onClick={onComplete}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Finish &amp; Explore</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goToStep(stepIdx + 1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0"
              >
                <span>Next Step</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface OnboardingResumeBarProps {
  stepIndex: number | null;
  onResume: () => void;
  onDismiss: () => void;
}

export const OnboardingResumeBar: React.FC<OnboardingResumeBarProps> = ({
  stepIndex,
  onResume,
  onDismiss,
}) => {
  if (stepIndex === null) return null;
  const step = GUIDE_STEPS[stepIndex];
  if (!step) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg px-3.5 py-2.5 flex items-center gap-3">
      <HelpCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
      <div className="text-xs min-w-0">
        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
          Guide · {step.stepNum}. {step.title}
        </div>
      </div>
      <button
        type="button"
        onClick={onResume}
        className="px-2.5 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap shrink-0"
      >
        Resume
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Skip remaining guide"
        className="px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap shrink-0"
      >
        Skip
      </button>
    </div>
  );
};
