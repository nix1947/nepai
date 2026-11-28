import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  Bell,
  CandlestickChart,
  CheckCircle2,
  Compass,
  Crosshair,
  Flame,
  Gem,
  GitCompare,
  Rocket,
  Scale,
  SlidersHorizontal,
  Star,
} from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { useCompareList, useWatchlist } from '../hooks/useWatchlist';
import type { MasterScreenerResponse, MasterScreenerRow } from '../types/fundamental';
import type { DailyAggregate } from '../types/market';
import { buildPlainEnglishVerdict, evaluateWatchlistAlerts } from '../utils/plainEnglish';

interface TodayBriefingViewProps {
  daily: DailyAggregate[];
  masterData: MasterScreenerResponse | null;
  loadingMaster: boolean;
  onOpenMasterScreener: () => void;
  onOpenValuation: (symbol: string) => void;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer: (symbol: string) => void;
  onInspectInScreener: (symbol: string) => void;
  onOpenWatchlistDrawer: () => void;
  onOpenCompareDrawer: () => void;
}

type WizardGoal = 'value_compounder' | 'player_breakout' | 'future_10x' | 'beats_fd';

const GOAL_OPTIONS: Array<{
  id: WizardGoal;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'value_compounder',
    label: 'Safe Undervalued Compounders',
    desc: 'Positive Margin of Safety, healthy annual fundamentals, clean CDSC/NRB status',
    icon: Scale,
  },
  {
    id: 'player_breakout',
    label: 'Active Player Breakouts',
    desc: 'High 20D turnover, institutional ticket flow & bullish chart breakouts',
    icon: Flame,
  },
  {
    id: 'future_10x',
    label: 'Future 10x Multi-Baggers',
    desc: 'Small/mid-cap runway, strong ROE compounding & 5Y bull upside',
    icon: Rocket,
  },
  {
    id: 'beats_fd',
    label: 'High Earnings Yield (> Bank FD)',
    desc: 'Annual verified earners whose earnings yield exceeds Nepal FD rates',
    icon: Gem,
  },
];

function fmtRs(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `Rs ${v.toFixed(digits)}`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export const TodayBriefingView: React.FC<TodayBriefingViewProps> = ({
  daily,
  masterData,
  loadingMaster,
  onOpenMasterScreener,
  onOpenValuation,
  onInspectSymbol,
  onInspectInAnalyzer,
  onInspectInScreener,
  onOpenWatchlistDrawer,
  onOpenCompareDrawer,
}) => {
  const { watchlist, hasSymbol, toggleSymbol, alertRules } = useWatchlist();
  const { compareSymbols, hasCompare, toggleCompare } = useCompareList();

  const [wizardGoal, setWizardGoal] = useState<WizardGoal>('value_compounder');
  const [wizardSector, setWizardSector] = useState<string>('ALL');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const latestDaily = daily.length > 0 ? daily[daily.length - 1] : null;
  const rows = masterData?.rows ?? [];

  const wizardCandidates = useMemo(() => {
    const base = rows.filter((r) => {
      if (wizardSector !== 'ALL' && r.sector !== wizardSector) return false;
      if (
        wizardGoal === 'value_compounder' &&
        (r.fundamentals.lockInOverhangFlag || r.fundamentals.regulatoryStanding === 'Alert')
      ) {
        return false;
      }
      return true;
    });

    const scored = [...base];
    if (wizardGoal === 'value_compounder') {
      scored.sort((a, b) => {
        const av =
          (a.valuation.marginOfSafetyPct ?? -30) * 0.6 +
          (a.valuation.valuationHealthScore ?? 30) * 0.8 +
          (a.hasAnnualReport ? 10 : 0);
        const bv =
          (b.valuation.marginOfSafetyPct ?? -30) * 0.6 +
          (b.valuation.valuationHealthScore ?? 30) * 0.8 +
          (b.hasAnnualReport ? 10 : 0);
        return bv - av;
      });
    } else if (wizardGoal === 'player_breakout') {
      scored.sort((a, b) => {
        const av =
          a.liquidity.playerInterestScore * 0.55 +
          a.technical.technicalScore * 0.45 +
          (a.technical.breakout20d ? 12 : 0);
        const bv =
          b.liquidity.playerInterestScore * 0.55 +
          b.technical.technicalScore * 0.45 +
          (b.technical.breakout20d ? 12 : 0);
        return bv - av;
      });
    } else if (wizardGoal === 'future_10x') {
      scored.sort((a, b) => b.tenX.tenXScore - a.tenX.tenXScore);
    } else {
      scored.sort((a, b) => {
        const av = (a.valuation.fdSpreadPct ?? -20) * 3 + (a.valuation.valuationHealthScore ?? 30);
        const bv = (b.valuation.fdSpreadPct ?? -20) * 3 + (b.valuation.valuationHealthScore ?? 30);
        return bv - av;
      });
    }

    return scored.slice(0, 6);
  }, [rows, wizardGoal, wizardSector]);

  const activeCandidate: MasterScreenerRow | null = useMemo(() => {
    if (selectedSymbol) {
      const hit = rows.find((r) => r.symbol === selectedSymbol);
      if (hit) return hit;
    }
    return wizardCandidates[0] ?? null;
  }, [rows, selectedSymbol, wizardCandidates]);

  const activeVerdict = useMemo(
    () => (activeCandidate ? buildPlainEnglishVerdict(activeCandidate) : null),
    [activeCandidate]
  );

  const watchlistAlertSummary = useMemo(() => {
    const map = new Map(rows.map((r) => [r.symbol, r]));
    let triggeredSymbols = 0;
    let totalAlerts = 0;
    const items: Array<{ row: MasterScreenerRow; firstAlert: string; severity: string }> = [];
    for (const sym of watchlist) {
      const r = map.get(sym);
      const alerts = evaluateWatchlistAlerts(r, alertRules[sym]);
      if (alerts.length > 0 && r) {
        triggeredSymbols += 1;
        totalAlerts += alerts.length;
        items.push({ row: r, firstAlert: alerts[0].label, severity: alerts[0].severity });
      }
    }
    return { triggeredSymbols, totalAlerts, items: items.slice(0, 4) };
  }, [rows, watchlist, alertRules]);

  const topConfluence = useMemo(() => rows.slice(0, 5), [rows]);

  const topValueGems = useMemo(
    () =>
      [...rows]
        .filter(
          (r) =>
            r.hasFundamentalData &&
            !r.fundamentals.lockInOverhangFlag &&
            (r.valuation.marginOfSafetyPct ?? -99) >= 5
        )
        .sort(
          (a, b) =>
            (b.valuation.marginOfSafetyPct ?? -99) * 0.6 +
            (b.valuation.valuationHealthScore ?? 0) * 0.4 -
            ((a.valuation.marginOfSafetyPct ?? -99) * 0.6 +
              (a.valuation.valuationHealthScore ?? 0) * 0.4)
        )
        .slice(0, 5),
    [rows]
  );

  const topFlowMovers = useMemo(
    () =>
      [...rows]
        .filter((r) => r.liquidity.playerInterestScore >= 55)
        .sort(
          (a, b) =>
            b.liquidity.playerInterestScore +
            b.technical.technicalScore -
            (a.liquidity.playerInterestScore + a.technical.technicalScore)
        )
        .slice(0, 5),
    [rows]
  );

  if (loadingMaster && !masterData) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-72 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-64 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Daily Pulse Header Strip */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Compass className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>NEPSE Guided Research Briefing</span>
            {masterData?.marketDate && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">EOD {masterData.marketDate}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>70% Annual / 30% Quarterly Basis</span>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Find undervalued NEPSE leaders, verify annual health, and time clean entries
          </h2>
          {latestDaily && (
            <p className="text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
              Market Breadth: {latestDaily.advancers} Advancers · {latestDaily.decliners} Decliners ·{' '}
              Turnover Rs {(latestDaily.turnover / 1e7).toFixed(1)} Cr ·{' '}
              {masterData?.totalSymbols ?? 0} scripts ranked
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenWatchlistDrawer}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Bell className="w-3.5 h-3.5 text-amber-500" />
            <span>
              Watchlist ({watchlist.length}
              {watchlistAlertSummary.totalAlerts > 0
                ? ` · ${watchlistAlertSummary.totalAlerts} alert${
                    watchlistAlertSummary.totalAlerts === 1 ? '' : 's'
                  }`
                : ''}
              )
            </span>
          </button>

          {compareSymbols.length >= 2 && (
            <button
              type="button"
              onClick={onOpenCompareDrawer}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <GitCompare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Compare ({compareSymbols.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenMasterScreener}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Open Master Screener</span>
          </button>
        </div>
      </div>

      {/* Watchlist Active Alerts Bar (only shown if user has active watchlist hits) */}
      {watchlistAlertSummary.items.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Watchlist Alerts Today:
            </span>
            {watchlistAlertSummary.items.map((item) => (
              <button
                key={item.row.symbol}
                type="button"
                onClick={() => onOpenValuation(item.row.symbol)}
                className="inline-flex items-center gap-1.5 font-mono hover:underline"
              >
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {item.row.symbol}
                </span>
                <span
                  className={
                    item.severity === 'risk'
                      ? 'text-red-600 dark:text-red-400'
                      : item.severity === 'caution'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                  }
                >
                  {item.firstAlert}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onOpenWatchlistDrawer}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            Manage Alerts →
          </button>
        </div>
      )}

      {/* Guided 3-Step Workflow Wizard: Find -> Verify -> Time */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Guided 3-Step Research Workflow: Find → Verify → Time
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pick your goal in Step 1, review plain-English fundamentals in Step 2, and confirm chart entry timing in Step 3
            </p>
          </div>
          {masterData && (
            <select
              value={wizardSector}
              onChange={(e) => {
                setWizardSector(e.target.value);
                setSelectedSymbol(null);
              }}
              aria-label="Filter wizard by sector"
              className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="ALL">All Sectors ({masterData.sectors.length})</option>
              {masterData.sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Step 1: Find */}
          <div className="xl:col-span-4 p-4 space-y-3">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              01. Choose Goal &amp; Pick a Candidate
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {GOAL_OPTIONS.map((g) => {
                const Icon = g.icon;
                const active = wizardGoal === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setWizardGoal(g.id);
                      setSelectedSymbol(null);
                    }}
                    title={g.desc}
                    className={`p-2 rounded-md border text-left transition-colors space-y-1 ${
                      active
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <div className="text-[11px] font-semibold leading-tight">{g.label}</div>
                  </button>
                );
              })}
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
              {wizardCandidates.length === 0 ? (
                <div className="p-4 text-xs text-slate-500 text-center">
                  No scripts match this sector filter. Switch back to All Sectors.
                </div>
              ) : (
                wizardCandidates.map((c) => {
                  const isSel = activeCandidate?.symbol === c.symbol;
                  return (
                    <button
                      key={c.symbol}
                      type="button"
                      onClick={() => setSelectedSymbol(c.symbol)}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors ${
                        isSel
                          ? 'bg-blue-50/80 dark:bg-blue-950/35'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                            {c.symbol}
                          </span>
                          <span className="text-[10px] text-slate-500 truncate">{c.sector}</span>
                        </div>
                        <div className="font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                          LTP {fmtRs(c.ltp)} · MoS {fmtPct(c.valuation.marginOfSafetyPct, 0)} · Health{' '}
                          {c.valuation.valuationHealthScore?.toFixed(0) ?? '—'}
                        </div>
                      </div>
                      <ArrowRight
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSel ? 'text-blue-600 dark:text-blue-400' : 'text-slate-300'
                        }`}
                      />
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Step 2: Verify */}
          <div className="xl:col-span-4 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                02. Verify Fundamentals &amp; Value
              </div>
              {activeCandidate && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleSymbol(activeCandidate.symbol)}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border ${
                      hasSymbol(activeCandidate.symbol)
                        ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Star
                      className={`w-3 h-3 ${
                        hasSymbol(activeCandidate.symbol) ? 'fill-amber-500 text-amber-500' : ''
                      }`}
                    />
                    <span>{hasSymbol(activeCandidate.symbol) ? 'Saved' : 'Watch'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleCompare(activeCandidate.symbol)}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border ${
                      hasCompare(activeCandidate.symbol)
                        ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <GitCompare className="w-3 h-3" />
                    <span>{hasCompare(activeCandidate.symbol) ? 'Added' : 'Compare'}</span>
                  </button>
                </div>
              )}
            </div>

            {activeCandidate && activeVerdict ? (
              <div className="space-y-3">
                <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                      {activeCandidate.symbol}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        activeVerdict.tone === 'emerald'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : activeVerdict.tone === 'red'
                            ? 'text-red-600 dark:text-red-400'
                            : activeVerdict.tone === 'amber'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-blue-600 dark:text-blue-400'
                      }`}
                    >
                      {activeVerdict.actionCue}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {activeVerdict.summary}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      <span>Fair Value / MoS</span>
                      <InfoTip glossaryKey="marginOfSafetyPct" />
                    </div>
                    <div className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                      {fmtRs(activeCandidate.valuation.compositeFairValue)}{' '}
                      <span
                        className={
                          (activeCandidate.valuation.marginOfSafetyPct ?? 0) >= 10
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-500'
                        }
                      >
                        ({fmtPct(activeCandidate.valuation.marginOfSafetyPct, 0)})
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      <span>Health Score</span>
                      <InfoTip glossaryKey="valuationHealthScore" />
                    </div>
                    <div className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                      {activeCandidate.valuation.valuationHealthScore?.toFixed(0) ?? '—'} / 100 ·{' '}
                      <span className="font-normal text-[11px] text-slate-500">
                        {activeCandidate.valuation.healthBand ?? '—'}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      <span>ROE &amp; Res/Cap</span>
                      <InfoTip glossaryKey="reserveToCapitalRatio" />
                    </div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                      {activeCandidate.fundamentals.roePct !== null
                        ? `${activeCandidate.fundamentals.roePct.toFixed(1)}%`
                        : '—'}{' '}
                      ·{' '}
                      {activeCandidate.fundamentals.reserveToCapitalRatio !== null
                        ? `${activeCandidate.fundamentals.reserveToCapitalRatio.toFixed(2)}x`
                        : '—'}
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      <span>9-Investor &amp; Risk</span>
                      <InfoTip glossaryKey="lockInOverhang" />
                    </div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                      {activeCandidate.fundamentals.passedInvestorCount}/9 Pass ·{' '}
                      {activeCandidate.fundamentals.lockInOverhangFlag
                        ? 'Lock-in Flag'
                        : activeCandidate.fundamentals.regulatoryStanding}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenValuation(activeCandidate.symbol)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Scale className="w-3.5 h-3.5" />
                    <span>Open Valuation &amp; Dissector</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onInspectInScreener(activeCandidate.symbol)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>9-Investor Dossier</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-8 text-center">
                Select a candidate on the left to verify fundamentals.
              </div>
            )}
          </div>

          {/* Step 3: Time Entry */}
          <div className="xl:col-span-4 p-4 space-y-3">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              03. Time Entry &amp; Technical Alignment
            </div>

            {activeCandidate ? (
              <div className="space-y-3">
                <ul className="space-y-2 text-xs">
                  <li className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 dark:border-slate-800">
                    <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <CheckCircle2
                        className={`w-3.5 h-3.5 ${
                          activeCandidate.valuation.inBuyZone
                            ? 'text-emerald-600'
                            : 'text-slate-400'
                        }`}
                      />
                      <span>Buy Zone Discipline</span>
                      <InfoTip glossaryKey="buyZonePrice" align="right" />
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      LTP {fmtRs(activeCandidate.ltp)} vs ≤{' '}
                      {fmtRs(activeCandidate.valuation.buyZonePrice)}
                    </span>
                  </li>

                  <li className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 dark:border-slate-800">
                    <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <CheckCircle2
                        className={`w-3.5 h-3.5 ${
                          activeCandidate.technical.aboveEma20
                            ? 'text-emerald-600'
                            : 'text-slate-400'
                        }`}
                      />
                      <span>Trend &amp; RSI-14</span>
                      <InfoTip glossaryKey="rsi14" align="right" />
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {activeCandidate.technical.trendState} · RSI{' '}
                      {activeCandidate.technical.rsi14?.toFixed(0) ?? '—'}
                    </span>
                  </li>

                  <li className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 dark:border-slate-800">
                    <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <CheckCircle2
                        className={`w-3.5 h-3.5 ${
                          activeCandidate.liquidity.accumulationFlag ||
                          activeCandidate.technical.breakout20d
                            ? 'text-emerald-600'
                            : 'text-slate-400'
                        }`}
                      />
                      <span>Player Flow &amp; Volume</span>
                      <InfoTip glossaryKey="playerInterestScore" align="right" />
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      Score {activeCandidate.liquidity.playerInterestScore.toFixed(0)} ·{' '}
                      {activeCandidate.liquidity.avgTurnover20Cr.toFixed(1)} Cr/d
                    </span>
                  </li>

                  <li className="flex items-center justify-between gap-2 py-1">
                    <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <CheckCircle2
                        className={`w-3.5 h-3.5 ${
                          activeCandidate.tenX.tenXScore >= 60
                            ? 'text-emerald-600'
                            : 'text-slate-400'
                        }`}
                      />
                      <span>5Y Bull Runway</span>
                      <InfoTip glossaryKey="tenXScore" align="right" />
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {fmtRs(activeCandidate.tenX.bull5yPrice)} (
                      {activeCandidate.tenX.bull5yMultiple !== null
                        ? `${activeCandidate.tenX.bull5yMultiple.toFixed(1)}x`
                        : '—'}
                      )
                    </span>
                  </li>
                </ul>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onInspectSymbol(activeCandidate.symbol)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <CandlestickChart className="w-3.5 h-3.5" />
                    <span>Open Chart &amp; S/R</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onInspectInAnalyzer(activeCandidate.symbol)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>ICT/SMC Trade Plan</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 py-8 text-center">
                Pick a candidate to inspect entry levels.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 3 Curated Today Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[
          {
            title: 'Top Confluence Leaders',
            subtitle: 'Balanced best across Value, Annual Health, Chart & Player Flow',
            list: topConfluence,
            metricLabel: (r: MasterScreenerRow) => `Master ${r.masterScore.toFixed(0)}`,
          },
          {
            title: 'Best Undervalued Annual Gems',
            subtitle: 'Clean discounts to Fair Value with verified Annual strength',
            list: topValueGems,
            metricLabel: (r: MasterScreenerRow) =>
              `MoS ${fmtPct(r.valuation.marginOfSafetyPct, 0)}`,
          },
          {
            title: 'Active Player Flow & Breakouts',
            subtitle: 'High 20D turnover, institutional flow & bullish trend momentum',
            list: topFlowMovers,
            metricLabel: (r: MasterScreenerRow) =>
              `Flow ${r.liquidity.playerInterestScore.toFixed(0)}`,
          },
        ].map((col) => (
          <div
            key={col.title}
            className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden flex flex-col"
          >
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                {col.title}
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {col.subtitle}
              </p>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
              {col.list.length === 0 ? (
                <div className="p-4 text-xs text-slate-500">No matching candidates today.</div>
              ) : (
                col.list.map((r) => {
                  const v = buildPlainEnglishVerdict(r);
                  return (
                    <div
                      key={r.symbol}
                      className="px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/35 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenValuation(r.symbol)}
                          className="font-mono font-bold text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {r.symbol}{' '}
                          <span className="font-sans font-normal text-slate-500 dark:text-slate-400">
                            · {r.sector}
                          </span>
                        </button>
                        <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {fmtRs(r.ltp)}
                          </span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                            {col.metricLabel(r)}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                        {v.headline}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono text-slate-500 tabular-nums">
                          Health {r.valuation.valuationHealthScore?.toFixed(0) ?? '—'} · 10x{' '}
                          {r.tenX.tenXScore.toFixed(0)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => toggleSymbol(r.symbol)}
                            title="Toggle Watchlist"
                            className="p-1 text-slate-400 hover:text-amber-500"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                hasSymbol(r.symbol) ? 'fill-amber-500 text-amber-500' : ''
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCompare(r.symbol)}
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${
                              hasCompare(r.symbol)
                                ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {hasCompare(r.symbol) ? 'Added' : '+ Compare'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
