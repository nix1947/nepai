import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Play,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react';
import type {
  FundamentalMonitorResponse,
  MonitorConfig,
  ReportMonitorStatus,
} from '../../types/fundamental';

interface ReportingMonitorPanelProps {
  equityOnly: boolean;
  onSelectSymbol: (symbol: string) => void;
  onDataUpdated: () => void;
}

export const ReportingMonitorPanel: React.FC<ReportingMonitorPanelProps> = ({
  equityOnly,
  onSelectSymbol,
  onDataUpdated,
}) => {
  const [monitor, setMonitor] = useState<FundamentalMonitorResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<'All' | ReportMonitorStatus>('All');
  const [query, setQuery] = useState<string>('');
  const [refreshingSymbol, setRefreshingSymbol] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadMonitor = async () => {
    try {
      const res = await fetch(`/api/screener/monitor?equityOnly=${equityOnly}`);
      if (!res.ok) throw new Error('Failed to load monitor state');
      const data = (await res.json()) as FundamentalMonitorResponse;
      setMonitor(data);
    } catch (err) {
      setMessage({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Unable to reach reporting monitor',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMonitor();
  }, [equityOnly]);

  // Poll live batch progress while active
  useEffect(() => {
    if (!monitor?.batch.active) return;
    const t = setInterval(() => {
      void loadMonitor();
    }, 2000);
    return () => clearInterval(t);
  }, [monitor?.batch.active, equityOnly]);

  const triggerBatch = async (mode: 'pending' | 'top25' | 'top50' | 'all') => {
    setMessage(null);
    try {
      const res = await fetch('/api/screener/refresh-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, force: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to launch batch pull');
      if (data.message && !data.active) {
        setMessage({ kind: 'ok', text: data.message });
      }
      await loadMonitor();
      onDataUpdated();
    } catch (err) {
      setMessage({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Batch pull failed',
      });
    }
  };

  const refreshSingle = async (symbol: string) => {
    setRefreshingSymbol(symbol);
    setMessage(null);
    try {
      const res = await fetch(`/api/screener/refresh/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Refresh failed for ${symbol}`);
      setMessage({
        kind: 'ok',
        text: data.skipped
          ? `${symbol}: skipped fetching (${monitor?.activeQuarter.quarter ?? ''} FY ${monitor?.activeQuarter.fiscalYear ?? ''} already populated).`
          : `${symbol}: collected ${data.periodsAdded} period(s) (${data.validationStatus}).`,
      });
      await loadMonitor();
      onDataUpdated();
    } catch (err) {
      setMessage({
        kind: 'err',
        text: err instanceof Error ? err.message : `Failed refreshing ${symbol}`,
      });
      await loadMonitor();
    } finally {
      setRefreshingSymbol(null);
    }
  };

  const saveConfigPatch = async (patch: Partial<MonitorConfig>) => {
    setSavingConfig(true);
    try {
      const res = await fetch('/api/screener/monitor/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed updating monitor configuration');
      await loadMonitor();
      setMessage({ kind: 'ok', text: 'Automated quarter-end monitor schedule updated.' });
    } catch (err) {
      setMessage({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Config update failed',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const filteredSymbols = useMemo(() => {
    if (!monitor) return [];
    const q = query.trim().toLowerCase();
    return monitor.symbols.filter((s) => {
      if (statusFilter !== 'All' && s.status !== statusFilter) return false;
      if (q) {
        return (
          s.symbol.toLowerCase().includes(q) ||
          s.companyName.toLowerCase().includes(q) ||
          s.sector.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [monitor, statusFilter, query]);

  const missingActiveQuarterCount = useMemo(() => {
    if (!monitor) return 0;
    const { fiscalYear, quarter } = monitor.activeQuarter;
    return monitor.symbols.filter(
      (s) => !(s.latestFiscalYear === fiscalYear && s.latestQuarter === quarter)
    ).length;
  }, [monitor]);

  if (loading || !monitor) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="h-72 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {message && (
        <div
          className={`px-4 py-2.5 rounded-md border text-xs flex items-center justify-between gap-3 ${
            message.kind === 'err'
              ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
              : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          <span>{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Quarter-end + 15 Days Reporting Window Summary */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <CalendarClock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>
              Active Fiscal Cycle: {monitor.activeQuarter.quarter} FY{' '}
              {monitor.activeQuarter.fiscalYear}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Approx. Quarter End: {monitor.activeQuarter.quarterEndApprox} · Monitoring Starts (+
            {monitor.config.delayDaysAfterQuarterEnd}d): {monitor.activeQuarter.checkStartDate} ·{' '}
            {monitor.activeQuarter.isDueNow
              ? `Active (${monitor.activeQuarter.daysSinceQuarterEnd}d post quarter-end)`
              : 'Waiting for +15d window'}
          </p>
          {monitor.upcomingQuarter && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Upcoming Scheduled Quarter: {monitor.upcomingQuarter.quarter} FY{' '}
              {monitor.upcomingQuarter.fiscalYear} · Window opens{' '}
              {monitor.upcomingQuarter.checkStartDate} (existing quarter records skipped automatically)
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={monitor.batch.active || monitor.counts.pending + monitor.counts.retrying === 0}
            onClick={() => triggerBatch('pending')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Refresh Pending ({monitor.counts.pending + monitor.counts.retrying})</span>
          </button>
          <button
            type="button"
            disabled={monitor.batch.active || missingActiveQuarterCount === 0}
            onClick={() => triggerBatch('top25')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${monitor.batch.active ? 'animate-spin' : ''}`} />
            <span>Top 25 by Turnover</span>
          </button>
          <button
            type="button"
            disabled={monitor.batch.active || missingActiveQuarterCount === 0}
            onClick={() => triggerBatch('all')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <span>
              {missingActiveQuarterCount === 0
                ? `${monitor.activeQuarter.quarter} Complete`
                : `Pull Missing (${missingActiveQuarterCount})`}
            </span>
          </button>
        </div>
      </div>

      {monitor.batch.active && (
        <div className="border border-blue-200 dark:border-blue-900 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-blue-800 dark:text-blue-200">
              {monitor.batch.message}
            </span>
            <span className="font-mono tabular-nums text-blue-700 dark:text-blue-300">
              {monitor.batch.processed}/{monitor.batch.total} ({monitor.batch.succeeded} ok ·{' '}
              {monitor.batch.skipped ?? 0} skip · {monitor.batch.failed} err)
            </span>
          </div>
          <div className="h-1.5 rounded bg-blue-100 dark:bg-blue-900 overflow-hidden">
            <div
              className="h-full bg-blue-600 dark:bg-blue-400 transition-all"
              style={{
                width: `${
                  monitor.batch.total > 0
                    ? Math.round((monitor.batch.processed / monitor.batch.total) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Status KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Tracked', value: monitor.counts.total, tone: 'text-slate-900 dark:text-slate-100' },
          { label: 'Published', value: monitor.counts.published, tone: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Pending', value: monitor.counts.pending, tone: 'text-amber-600 dark:text-amber-400' },
          { label: 'Retrying', value: monitor.counts.retrying, tone: 'text-blue-600 dark:text-blue-400' },
          { label: 'Failed', value: monitor.counts.failed, tone: 'text-red-600 dark:text-red-400' },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3.5 py-2.5"
          >
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{kpi.label}</div>
            <div className={`text-lg font-mono font-semibold tabular-nums mt-0.5 ${kpi.tone}`}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Automation Settings */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
          <Settings2 className="w-4 h-4 text-slate-500" />
          <span>Primary Collector &amp; Auto-Retry Rules</span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={monitor.config.enabled}
              disabled={savingConfig}
              onChange={(e) => void saveConfigPatch({ enabled: e.target.checked })}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span className="text-slate-700 dark:text-slate-300">
              Daily Monitor ({monitor.config.cronTime} NPT)
            </span>
          </label>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={monitor.config.crossValidateWithSearch}
              disabled={savingConfig}
              onChange={(e) => void saveConfigPatch({ crossValidateWithSearch: e.target.checked })}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span className="text-slate-700 dark:text-slate-300">
              Cross-check single refreshes with Official NEPSE/Company Search
            </span>
          </label>

          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
            <span>Quarter-end offset:</span>
            <select
              value={monitor.config.delayDaysAfterQuarterEnd}
              disabled={savingConfig}
              onChange={(e) =>
                void saveConfigPatch({ delayDaysAfterQuarterEnd: Number(e.target.value) })
              }
              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
            >
              <option value={10}>+10d</option>
              <option value={15}>+15d (Default)</option>
              <option value={21}>+21d</option>
              <option value={30}>+30d</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tracked Companies Reporting Status Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter company or sector…"
                className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 w-52 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5 text-[11px]">
              {(['All', 'Published', 'Pending', 'Retrying', 'Failed'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded font-medium whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {filteredSymbols.length} companies
          </span>
        </div>

        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Symbol</th>
                <th className="px-3 py-2 font-medium">Sector</th>
                <th className="px-3 py-2 font-medium">Report Status</th>
                <th className="px-3 py-2 font-medium">Latest Period</th>
                <th className="px-3 py-2 font-medium">Validation</th>
                <th className="px-3 py-2 font-medium">Last Collected</th>
                <th className="px-3 py-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredSymbols.slice(0, 120).map((s) => (
                <tr
                  key={s.symbol}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSelectSymbol(s.symbol)}
                      className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {s.symbol}
                    </button>
                    <span className="text-slate-500 dark:text-slate-400 ml-2 text-[11px]">
                      {s.companyName !== s.symbol ? s.companyName.slice(0, 26) : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                    {s.sector}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        s.status === 'Published'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : s.status === 'Failed'
                            ? 'text-red-600 dark:text-red-400'
                            : s.status === 'Retrying'
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {s.status === 'Published' ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : s.status === 'Failed' ? (
                        <AlertTriangle className="w-3.5 h-3.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {s.status}
                        {s.retryCount > 0 ? ` (#${s.retryCount})` : ''}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-700 dark:text-slate-300">
                    {s.latestQuarter && s.latestFiscalYear
                      ? `${s.latestQuarter} ${s.latestFiscalYear}`
                      : 'None'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`text-[11px] font-medium ${
                        s.validationStatus === 'CrossChecked' || s.validationStatus === 'Verified'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : s.validationStatus === 'Discrepancy'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {s.validationStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {s.lastSuccessAt ? s.lastSuccessAt.slice(0, 10) : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    {s.latestFiscalYear === monitor.activeQuarter.fiscalYear &&
                    s.latestQuarter === monitor.activeQuarter.quarter ? (
                      <button
                        type="button"
                        disabled
                        title={`${monitor.activeQuarter.quarter} FY ${monitor.activeQuarter.fiscalYear} already populated`}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Synced</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={refreshingSymbol === s.symbol || monitor.batch.active}
                        onClick={() => void refreshSingle(s.symbol)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${refreshingSymbol === s.symbol ? 'animate-spin' : ''}`}
                        />
                        <span>Fetch</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collection Logs */}
      {monitor.logs.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Recent Collection &amp; Retry Activity
          </h3>
          <div className="space-y-1 max-h-44 overflow-auto text-[11px] font-mono">
            {monitor.logs.slice(0, 20).map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between gap-3 py-1 border-b border-slate-100 dark:border-slate-800/60 last:border-0"
              >
                <span
                  className={
                    log.status === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : log.status === 'skipped'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-700 dark:text-slate-300'
                  }
                >
                  [{log.trigger}] {log.message}
                </span>
                <span className="text-slate-400 shrink-0 tabular-nums">
                  {log.timestamp.slice(11, 19)} ({log.durationMs}ms)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
