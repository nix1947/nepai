import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Database,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import type {
  CatalystCalendarResponse,
  CorporateActionRecord,
  LockInEventRecord,
} from '../types/fundamental';
import { formatInt, formatNum, formatPct } from '../utils/format';

interface CatalystCalendarViewProps {
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
  onOpenValuation?: (symbol: string) => void;
}

type CatalystFilterTab =
  | 'all'
  | 'lockins'
  | 'actions'
  | 'deadlines'
  | 'triggers';

function safeExternalHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    return null;
  }
  return null;
}

function formatCountdown(days: number | undefined): string {
  if (days === undefined || !Number.isFinite(days)) return '—';
  if (days === 0) return 'Today';
  if (days > 0) return `In ${days}d`;
  return `${Math.abs(days)}d ago`;
}

function overhangTone(tier: LockInEventRecord['overhangTier']): string {
  switch (tier) {
    case 'Critical (<30d)':
      return 'text-rose-700 dark:text-rose-400 font-semibold';
    case 'Near-Term (<90d)':
      return 'text-amber-700 dark:text-amber-400 font-semibold';
    case 'Unlocked':
      return 'text-slate-500 dark:text-slate-400';
    default:
      return 'text-slate-700 dark:text-slate-300';
  }
}

export const CatalystCalendarView: React.FC<CatalystCalendarViewProps> = ({
  equityOnly,
  onInspectSymbol,
  onOpenValuation,
}) => {
  const [data, setData] = useState<CatalystCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CatalystFilterTab>('all');
  const [query, setQuery] = useState('');

  const loadCatalysts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/intelligence/catalysts?equityOnly=${equityOnly}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as CatalystCalendarResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalyst calendar');
    } finally {
      setLoading(false);
    }
  }, [equityOnly]);

  useEffect(() => {
    void loadCatalysts();
  }, [loadCatalysts]);

  const handleFetchAndPushKb = async () => {
    setCrawling(true);
    setCrawlMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/knowledge-base/crawl-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          force: true,
          equityOnly,
          includeQuarterly: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const noticesAdded = Number(body.addedNotices ?? 0);
      const companiesUpdated = Number(body.companiesUpdated ?? 0);
      const totalActions = Number(body.summary?.totalCorporateActions ?? 0);
      const totalLockIns = Number(body.summary?.totalLockInEvents ?? 0);
      const pushNote = body.githubPushed
        ? 'Changes committed & pushed to GitHub.'
        : body.githubPushMessage || 'Saved to local knowledge base.';
      setCrawlMessage(
        `Sync complete: ${noticesAdded} new disclosures, ${companiesUpdated} companies updated, ${totalActions} corporate actions & ${totalLockIns} lock-in schedules indexed. ${pushNote}`
      );
      await loadCatalysts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Knowledge base sync failed');
    } finally {
      setCrawling(false);
    }
  };

  const qNorm = query.trim().toLowerCase();

  const filteredLockIns = useMemo(() => {
    const list = data?.lockInEvents ?? [];
    if (!qNorm) return list;
    return list.filter(
      (item) =>
        item.symbol.toLowerCase().includes(qNorm) ||
        item.companyName.toLowerCase().includes(qNorm) ||
        item.shareholderCategory.toLowerCase().includes(qNorm) ||
        item.headline.toLowerCase().includes(qNorm)
    );
  }, [data, qNorm]);

  const filteredActions = useMemo(() => {
    const list = data?.corporateActions ?? [];
    if (!qNorm) return list;
    return list.filter(
      (item) =>
        item.symbol.toLowerCase().includes(qNorm) ||
        item.companyName.toLowerCase().includes(qNorm) ||
        item.actionType.toLowerCase().includes(qNorm) ||
        item.headline.toLowerCase().includes(qNorm)
    );
  }, [data, qNorm]);

  const filteredDeadlines = useMemo(() => {
    const list = data?.fiscalDeadlines ?? [];
    if (!qNorm) return list;
    return list.filter(
      (item) =>
        item.title.toLowerCase().includes(qNorm) ||
        item.category.toLowerCase().includes(qNorm) ||
        item.description.toLowerCase().includes(qNorm)
    );
  }, [data, qNorm]);

  const filteredTriggers = useMemo(() => {
    const list = data?.valuationTriggers ?? [];
    if (!qNorm) return list;
    return list.filter(
      (item) =>
        item.symbol.toLowerCase().includes(qNorm) ||
        item.companyName.toLowerCase().includes(qNorm) ||
        item.sector.toLowerCase().includes(qNorm) ||
        item.triggerType.toLowerCase().includes(qNorm) ||
        item.headline.toLowerCase().includes(qNorm)
    );
  }, [data, qNorm]);

  const filteredNotices = useMemo(() => {
    const list = data?.recentNotices ?? [];
    if (!qNorm) return list;
    return list.filter(
      (n) =>
        n.title.toLowerCase().includes(qNorm) ||
        n.agency.toLowerCase().includes(qNorm) ||
        n.summary.toLowerCase().includes(qNorm) ||
        n.symbols.some((s) => s.toLowerCase().includes(qNorm))
    );
  }, [data, qNorm]);

  const renderActionStats = (a: CorporateActionRecord): string => {
    const parts: string[] = [];
    if (a.bonusPct && a.bonusPct > 0) parts.push(`${formatNum(a.bonusPct, 1)}% Bonus`);
    if (a.cashPct && a.cashPct > 0) parts.push(`${formatNum(a.cashPct, 1)}% Cash`);
    if (a.rightRatioPct && a.rightRatioPct > 0) parts.push(`${formatNum(a.rightRatioPct, 0)}% Right`);
    return parts.length > 0 ? parts.join(' · ') : 'Disclosure';
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Action */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Catalysts, Promoter Lock-Ins &amp; Corporate Calendar
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-3xl">
            Live NEPSE Corporate Portal disclosures, Google Search grounded distillation, promoter unlock overhang countdowns, book-closure / AGM dates, fiscal reporting cutoffs, and deep buy-zone triggers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadCatalysts()}
            disabled={loading || crawling}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Reload Calendar</span>
          </button>
          <button
            type="button"
            onClick={() => void handleFetchAndPushKb()}
            disabled={crawling}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Database className={`w-3.5 h-3.5 ${crawling ? 'animate-spin' : ''}`} />
            <span>
              {crawling
                ? 'Fetching & Distilling…'
                : 'Fetch Disclosures, Distill & Push GitHub'}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {crawlMessage && (
        <div className="px-4 py-3 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{crawlMessage}</span>
        </div>
      )}

      {/* Summary KPI Cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Nepal Fiscal Year &amp; Poush Cutoff
            </div>
            <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              FY {data.fiscalContext.currentFy}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Poush End ~{data.fiscalContext.poushEndApproxDate} (
              {data.fiscalContext.daysUntilPoushEnd >= 0
                ? `${data.fiscalContext.daysUntilPoushEnd}d left`
                : 'Passed'}
              )
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Promoter Lock-In Overhangs
            </div>
            <div className="text-lg font-mono font-bold text-amber-600 dark:text-amber-400 tabular-nums">
              {data.kbSummary.upcomingLockInsCount}{' '}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                upcoming / {data.kbSummary.totalLockInEvents} indexed
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Supply unlock watch inside 180d
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Dividends, Rights &amp; AGMs
            </div>
            <div className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 tabular-nums">
              {data.kbSummary.upcomingBookClosuresCount}{' '}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                active / {data.kbSummary.totalCorporateActions} actions
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Feeds bonus-adjusted chart back-adjustment
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Knowledge Base &amp; Sync
            </div>
            <div className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {data.kbSummary.totalNotices} disclosures
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {data.kbSummary.totalCompaniesIndexed} companies · Search{' '}
              {data.geminiConfigured ? 'Ready' : 'Standard'} · GitHub{' '}
              {data.hasGitHubToken ? 'Connected' : 'Local'}
            </div>
          </div>
        </div>
      )}

      {/* Search & Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 border border-slate-200 dark:border-slate-800 rounded-md p-1 bg-white dark:bg-slate-900">
          {(
            [
              ['all', 'All Catalysts'],
              ['lockins', `Lock-Ins (${filteredLockIns.length})`],
              ['actions', `Dividends & AGM (${filteredActions.length})`],
              ['deadlines', `Timeline (${filteredDeadlines.length})`],
              ['triggers', `Buy-Zone & Q4 Beats (${filteredTriggers.length})`],
            ] as Array<[CatalystFilterTab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter ticker, sector, or event…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </div>
      </div>

      {loading && !data ? (
        <div className="space-y-3">
          <div className="h-28 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
          <div className="h-64 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Section 1: Promoter Lock-In Schedule */}
          {(activeTab === 'all' || activeTab === 'lockins') && (
            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Promoter, Local &amp; Anchor Lock-In Countdown
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {filteredLockIns.length} events
                </span>
              </div>
              {filteredLockIns.length === 0 ? (
                <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
                  No lock-in unlock schedules matched. Click &ldquo;Fetch Disclosures, Distill &amp; Push GitHub&rdquo; above to harvest live CDSC &amp; corporate portal notices.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/50">
                        <th className="py-2.5 px-3 font-medium">Ticker</th>
                        <th className="py-2.5 px-3 font-medium">Category</th>
                        <th className="py-2.5 px-3 font-medium">Unlock Date</th>
                        <th className="py-2.5 px-3 font-medium text-right">Countdown</th>
                        <th className="py-2.5 px-3 font-medium">Overhang Risk</th>
                        <th className="py-2.5 px-3 font-medium text-right">Locked Shares / %</th>
                        <th className="py-2.5 px-3 font-medium">Disclosure</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {filteredLockIns.map((item) => {
                        const href = safeExternalHref(item.sourceUrl);
                        return (
                          <tr
                            key={item.id}
                            className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => onInspectSymbol(item.symbol)}
                                className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {item.symbol}
                              </button>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[160px]">
                                {item.companyName}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                              {item.shareholderCategory}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {item.unlockDate}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                              {formatCountdown(item.daysRemaining)}
                            </td>
                            <td className={`py-2.5 px-3 whitespace-nowrap ${overhangTone(item.overhangTier)}`}>
                              {item.overhangTier || 'Upcoming'}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {item.lockedShares
                                ? formatInt(item.lockedShares)
                                : item.pctOfTotalShares
                                  ? `${formatNum(item.pctOfTotalShares, 1)}%`
                                  : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-md">
                              <div className="line-clamp-2">{item.headline}</div>
                              {href && (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-[11px] text-blue-600 dark:text-blue-400 hover:underline mt-0.5"
                                >
                                  <span>{item.sourceLabel}</span>
                                  <ArrowUpRight className="w-3 h-3" />
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Section 2: Corporate Actions (Dividends, Bonus, Right Share, AGM) */}
          {(activeTab === 'all' || activeTab === 'actions') && (
            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Corporate Actions, Dividends, Right Shares &amp; Book Closures
                </h3>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {filteredActions.length} records
                </span>
              </div>
              {filteredActions.length === 0 ? (
                <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
                  No corporate action announcements matched. Run a Knowledge Base sync to ingest proposed dividends, AGMs, and book-closure dates.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/50">
                        <th className="py-2.5 px-3 font-medium">Ticker</th>
                        <th className="py-2.5 px-3 font-medium">Type</th>
                        <th className="py-2.5 px-3 font-medium">FY</th>
                        <th className="py-2.5 px-3 font-medium">Distribution / Ratio</th>
                        <th className="py-2.5 px-3 font-medium">Book Closure / Ex</th>
                        <th className="py-2.5 px-3 font-medium">AGM Date</th>
                        <th className="py-2.5 px-3 font-medium">Status</th>
                        <th className="py-2.5 px-3 font-medium">Summary</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {filteredActions.slice(0, 60).map((a) => {
                        const href = safeExternalHref(a.sourceUrl);
                        return (
                          <tr
                            key={a.id}
                            className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => onInspectSymbol(a.symbol)}
                                className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                {a.symbol}
                              </button>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300 font-medium">
                              {a.actionType}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap font-mono tabular-nums text-slate-600 dark:text-slate-400">
                              {a.fiscalYear || '—'}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap font-mono tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
                              {renderActionStats(a)}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {a.bookClosureDate || a.exDate || '—'}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {a.agmDate || '—'}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-slate-700 dark:text-slate-300">
                              {a.status}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-md">
                              <div className="line-clamp-2">{a.headline}</div>
                              {href && (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-[11px] text-blue-600 dark:text-blue-400 hover:underline mt-0.5"
                                >
                                  <span>{a.sourceLabel}</span>
                                  <ArrowUpRight className="w-3 h-3" />
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Section 3: Valuation & 3Y Q4 Earnings Triggers */}
          {(activeTab === 'all' || activeTab === 'triggers') && (
            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Buy-Zone Margin of Safety &amp; 3Y Q4 Baseline Triggers
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {filteredTriggers.length} candidates
                </span>
              </div>
              {filteredTriggers.length === 0 ? (
                <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
                  No valuation or 3Y Q4 earnings triggers matched current filter criteria.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/50">
                        <th className="py-2.5 px-3 font-medium">Ticker</th>
                        <th className="py-2.5 px-3 font-medium">Trigger Type</th>
                        <th className="py-2.5 px-3 font-medium text-right">LTP</th>
                        <th className="py-2.5 px-3 font-medium text-right">Fair Value</th>
                        <th className="py-2.5 px-3 font-medium text-right">MoS %</th>
                        <th className="py-2.5 px-3 font-medium text-right">EPS vs 3Y Q4</th>
                        <th className="py-2.5 px-3 font-medium text-right">OpProfit vs 3Y Q4</th>
                        <th className="py-2.5 px-3 font-medium">Catalyst Note</th>
                        <th className="py-2.5 px-3 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {filteredTriggers.map((t) => (
                        <tr
                          key={`${t.symbol}-${t.triggerType}`}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onInspectSymbol(t.symbol)}
                              className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {t.symbol}
                            </button>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {t.sector}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-800 dark:text-slate-200">
                            {t.triggerType}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                            {t.ltp !== null ? formatNum(t.ltp, 1) : '—'}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                            {t.compositeFairValue !== null
                              ? formatNum(t.compositeFairValue, 0)
                              : '—'}
                          </td>
                          <td
                            className={`py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums font-medium ${
                              (t.marginOfSafetyPct ?? 0) >= 15
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {t.marginOfSafetyPct !== null ? formatPct(t.marginOfSafetyPct) : '—'}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                            {t.epsVsQ4Avg3yPct !== null ? formatPct(t.epsVsQ4Avg3yPct) : '—'}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                            {t.operatingProfitVsQ4Avg3yPct !== null
                              ? formatPct(t.operatingProfitVsQ4Avg3yPct)
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-sm">
                            {t.headline}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-right">
                            {onOpenValuation && (
                              <button
                                type="button"
                                onClick={() => onOpenValuation(t.symbol)}
                                className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                              >
                                Valuation →
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Section 4: Chronological Calendar & Fiscal Deadlines */}
          {(activeTab === 'all' || activeTab === 'deadlines') && (
            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Chronological Catalyst &amp; Reporting Timeline
                </h3>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {filteredDeadlines.length} milestones
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/50">
                      <th className="py-2.5 px-3 font-medium">Date</th>
                      <th className="py-2.5 px-3 font-medium">Window</th>
                      <th className="py-2.5 px-3 font-medium">Category</th>
                      <th className="py-2.5 px-3 font-medium">Milestone</th>
                      <th className="py-2.5 px-3 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredDeadlines.map((d) => (
                      <tr
                        key={d.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {d.date}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {formatCountdown(d.daysRemaining)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-800 dark:text-slate-200">
                          {d.category}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                          {d.title}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                          {d.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Section 5: Recent Official Disclosures */}
          {activeTab === 'all' && filteredNotices.length > 0 && (
            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Latest Regulatory &amp; Disclosure Feed
                </h3>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  Showing {filteredNotices.length}
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredNotices.slice(0, 12).map((n) => {
                  const href = safeExternalHref(n.url);
                  return (
                    <div
                      key={n.id}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                            {n.agency}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {n.publishedDate}
                          </span>
                          {n.symbols.slice(0, 4).map((sym) => (
                            <button
                              key={sym}
                              type="button"
                              onClick={() => onInspectSymbol(sym)}
                              className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {sym}
                            </button>
                          ))}
                        </div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {n.title}
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 line-clamp-2">
                          {n.summary}
                        </p>
                      </div>
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline shrink-0 whitespace-nowrap"
                        >
                          <span>Source</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
};
