import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  ArrowUpRight,
  Banknote,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileSearch,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { useTradingSettings } from '../hooks/useTradingSettings';
import type {
  CohortAuditResponse,
  CompositeDoNotBuyResponse,
  DataFreshnessStatus,
  FundamentallyRiskyResponse,
  MarketOpportunityVsRiskResponse,
  TechnicallyRiskyResponse,
} from '../types/market';
import { formatNum } from '../utils/format';

interface SharedRiskViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

function statusBadge(status: DataFreshnessStatus): string {
  if (status === 'Live') {
    return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900';
  }
  if (status === 'Cached') {
    return 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900';
  }
  if (status === 'Historical') {
    return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';
  }
  return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';
}

function scoreColor(score: number): string {
  if (score >= 65) return 'text-red-600 dark:text-red-400';
  if (score >= 45) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function pctFmt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// 1. FUNDAMENTALLY RISKY STOCKS
// ---------------------------------------------------------------------------
export const FundamentallyRiskyView: React.FC<SharedRiskViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const { settings } = useTradingSettings();
  const latestDay = dates[dates.length - 1] || '';
  const [data, setData] = useState<FundamentallyRiskyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [auditInput, setAuditInput] = useState('');
  const [auditMsg, setAuditMsg] = useState<string | null>(null);
  const [filterQ, setFilterQ] = useState('');
  const [minScore, setMinScore] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        equityOnly: String(equityOnly),
        ...(latestDay ? { day: latestDay } : {}),
      });
      const res = await fetch(`/api/risk/fundamental?${qs.toString()}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [equityOnly, latestDay]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runBatchAudit = async (symbolsToAudit: string[]) => {
    const syms = symbolsToAudit.map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 5);
    if (syms.length === 0) return;
    setAuditing(true);
    setAuditMsg(null);
    try {
      const res = await fetch('/api/risk/audit-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: syms, nDays: settings.lookbackDays }),
      });
      const json = (await res.json()) as CohortAuditResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Audit failed');
      const okCount = json.audited.filter((a) => a.ok).length;
      const fails = json.audited.filter((a) => !a.ok).map((a) => `${a.symbol}: ${a.error}`);
      setAuditMsg(
        `Completed audit for ${okCount}/${json.audited.length} stock(s).${
          fails.length > 0 ? ` Errors: ${fails.join(' | ')}` : ''
        }`
      );
      await loadData();
    } catch (err) {
      setAuditMsg(err instanceof Error ? err.message : 'Batch audit failed');
    } finally {
      setAuditing(false);
    }
  };

  const filtered = useMemo(() => {
    const q = filterQ.trim().toLowerCase();
    return (data?.rows || []).filter((r) => {
      if (r.fundamentalRiskScore < minScore) return false;
      if (!q) return true;
      return (
        r.symbol.toLowerCase().includes(q) ||
        r.companyName.toLowerCase().includes(q) ||
        r.sector.toLowerCase().includes(q)
      );
    });
  }, [data, filterQ, minScore]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Fundamentally Risky Stocks
            </h2>
            <InfoTip
              title="Strict Anti-Fabrication Policy"
              body="Fundamental red flags (declining EPS, rising NPL, negative cash flow, weak net worth, audit qualifications, governance issues) are displayed ONLY from verified retrieved quarterly/annual reports. Short-term technical price dips are never misclassified as fundamental weakness."
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Verified quarterly &amp; annual financial health audits across NEPSE disclosures (EPS,
            NPL, Cash Flow, Debt, Net Worth, Audit &amp; Regulatory Flags)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={auditInput}
            onChange={(e) => setAuditInput(e.target.value)}
            placeholder="Audit symbols (e.g. NICA, UPPER)…"
            className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 w-56"
          />
          <button
            type="button"
            disabled={auditing}
            onClick={() => {
              const typed = auditInput
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              const fallback = (data?.candidateSymbols || []).slice(0, 3).map((c) => c.symbol);
              void runBatchAudit(typed.length > 0 ? typed : fallback);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            <FileSearch className={`w-3.5 h-3.5 ${auditing ? 'animate-pulse' : ''}`} />
            <span>
              {auditing
                ? 'Auditing Reports…'
                : auditInput.trim()
                  ? 'Audit Typed Symbols'
                  : 'Audit Top 3 Unaudited Leaders'}
            </span>
          </button>
        </div>
      </div>

      {auditMsg && (
        <div className="p-3 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-800 dark:text-blue-200">
          {auditMsg}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Audited Securities</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {data?.auditedCount ?? 0}
          </div>
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Elevated Risk / Red Flags</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600 dark:text-red-400 tabular-nums">
            {data?.flaggedCount ?? 0}
          </div>
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Price Date Join</div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">
            {data?.date || '—'}
          </div>
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Unaudited Active Candidates</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {data?.candidateSymbols.length ?? 0}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            placeholder="Filter audited companies…"
            className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 w-60"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">Show:</span>
          {[
            { label: 'All Audited', val: 0 },
            { label: 'Risk ≥ 45', val: 45 },
            { label: 'Severe Risk ≥ 65', val: 65 },
          ].map((opt) => (
            <button
              key={opt.val}
              type="button"
              onClick={() => setMinScore(opt.val)}
              className={`px-2.5 py-1 rounded-md border ${
                minScore === opt.val
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="h-48 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : filtered.length === 0 ? (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            No fundamental audits match this filter yet
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-2xl">
            To uphold strict financial integrity, this workbench never fabricates EPS, NPL, cash
            flow, or audit opinions. Click any top-turnover or candidate stock below (or open a
            stock in Stock Explorer) to retrieve its latest NEPSE/SEBON quarterly &amp; annual
            disclosures via Google Search Grounding.
          </p>
          {data && data.candidateSymbols.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {data.candidateSymbols.slice(0, 12).map((c) => (
                <button
                  key={c.symbol}
                  type="button"
                  disabled={auditing}
                  onClick={() => void runBatchAudit([c.symbol])}
                  className="px-2.5 py-1.5 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  + Audit {c.symbol} (Rs {formatNum(c.ltp)})
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((row) => (
            <article
              key={row.symbol}
              className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onInspectSymbol(row.symbol)}
                      className="text-base font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                      <span>{row.symbol}</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {row.companyName}
                    </span>
                    <span className="text-xs text-slate-400">· {row.sector}</span>
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded border ${statusBadge(row.dataStatus)}`}>
                      {row.dataStatus}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    LTP: {row.ltp !== null ? `Rs ${formatNum(row.ltp)}` : 'Unavailable'} (
                    {pctFmt(row.changePct)}) · Report: {row.reportingPeriod} · Published:{' '}
                    {row.publicationDate}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-[11px] text-slate-400">Fundamental Risk</div>
                    <div className={`font-mono text-xl font-bold tabular-nums ${scoreColor(row.fundamentalRiskScore)}`}>
                      {row.fundamentalRiskScore} / 100
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded text-xs font-bold ${
                      row.recommendation === 'AVOID'
                        ? 'bg-red-600 text-white'
                        : row.recommendation === 'BUY'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-amber-500 text-white'
                    }`}
                  >
                    {row.recommendation}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {row.whyRisky}
              </p>

              {(row.redFlags.length > 0 || row.governanceFlags.length > 0) && (
                <div className="p-3 rounded-md bg-red-50/70 dark:bg-red-950/25 border border-red-200 dark:border-red-900/70 text-xs space-y-1">
                  <div className="font-semibold text-red-700 dark:text-red-400">
                    Confirmed Financial &amp; Governance Red Flags
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-red-800 dark:text-red-200">
                    {[...row.redFlags, ...row.governanceFlags].map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
                {[
                  { k: 'EPS', v: row.keyMetrics.eps },
                  { k: 'P/E', v: row.keyMetrics.pe },
                  { k: 'P/B', v: row.keyMetrics.pb },
                  { k: 'ROE', v: row.keyMetrics.roe },
                  { k: 'NPL', v: row.keyMetrics.npl },
                  { k: 'Cash Flow', v: row.keyMetrics.cashFlow },
                  { k: 'Net Worth', v: row.keyMetrics.netWorthPerShare },
                  { k: 'Dividends', v: row.keyMetrics.dividendHistory },
                ].map((m) => (
                  <div
                    key={m.k}
                    className="border border-slate-100 dark:border-slate-800 rounded p-2 bg-slate-50/60 dark:bg-slate-950/50"
                  >
                    <div className="text-[10px] text-slate-400">{m.k}</div>
                    <div className="font-mono font-medium text-slate-800 dark:text-slate-200 truncate" title={m.v}>
                      {m.v}
                    </div>
                  </div>
                ))}
              </div>

              {row.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-[11px] pt-1">
                  <span className="text-slate-400">Sources:</span>
                  {row.sources.slice(0, 4).map((s, idx) => (
                    <a
                      key={idx}
                      href={s.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline max-w-[220px] truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{s.title}</span>
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. TECHNICALLY RISKY STOCKS
// ---------------------------------------------------------------------------
export const TechnicallyRiskyView: React.FC<SharedRiskViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const { settings } = useTradingSettings();
  const latestDay = dates[dates.length - 1] || '';
  const [data, setData] = useState<TechnicallyRiskyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [sectorFilter, setSectorFilter] = useState('All');
  const [levelFilter, setLevelFilter] = useState<'All' | 'Severe' | 'High' | 'Moderate'>('All');
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!latestDay) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        day: latestDay,
        nDays: String(settings.lookbackDays),
        equityOnly: String(equityOnly),
      });
      const res = await fetch(`/api/risk/technical?${qs.toString()}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [latestDay, settings.lookbackDays, equityOnly]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const sectors = useMemo(() => {
    const set = new Set((data?.rows || []).map((r) => r.sector));
    return ['All', ...Array.from(set).sort()];
  }, [data]);

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return (data?.rows || []).filter((r) => {
      if (sectorFilter !== 'All' && r.sector !== sectorFilter) return false;
      if (levelFilter !== 'All' && r.riskLevel !== levelFilter) return false;
      if (!q) return true;
      return r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    });
  }, [data, searchQ, sectorFilter, levelFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Technically Risky Stocks
            </h2>
            <span className={`px-2 py-0.5 text-[11px] font-medium rounded border ${statusBadge(data?.dataStatus || 'Historical')}`}>
              {data?.dataStatus || 'Historical'} EOD
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Deterministic ShareSansar screening across {settings.lookbackDays}-day rolling
            breakdowns: MA120/MA180 structure, selling pressure, support breaks, negative
            volume-price divergence &amp; volatility
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Recalculate</span>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Screened Active Stocks</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {data?.totalScreened ?? 0}
          </div>
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Severe Technical Risk (≥65)</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600 dark:text-red-400 tabular-nums">
            {data?.severeCount ?? 0}
          </div>
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">High Technical Risk (45–64)</div>
          <div className="mt-1 font-mono text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
            {data?.highCount ?? 0}
          </div>
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Rolling Window</div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-900 dark:text-slate-100">
            N = {data?.nDays ?? settings.lookbackDays} days
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Filter ticker or name…"
              className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 w-52"
            />
          </div>
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
          >
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s === 'All' ? 'All Sectors' : s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          {(['All', 'Severe', 'High', 'Moderate'] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevelFilter(lvl)}
              className={`px-2.5 py-1 rounded-md border ${
                levelFilter === lvl
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="h-64 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Symbol</th>
                <th className="px-3 py-3 text-right">LTP</th>
                <th className="px-3 py-3 text-right">1D %</th>
                <th className="px-3 py-3 text-right">{settings.lookbackDays}D %</th>
                <th className="px-3 py-3 text-right">vs MA120</th>
                <th className="px-3 py-3 text-right">Up/Dn Vol</th>
                <th className="px-3 py-3 text-right">Risk Score</th>
                <th className="px-4 py-3">Key Technical Warning Signals</th>
                <th className="px-3 py-3 text-right">Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.slice(0, 80).map((r) => {
                const isOpen = expanded === r.symbol;
                return (
                  <React.Fragment key={r.symbol}>
                    <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onInspectSymbol(r.symbol)}
                          className="font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                        >
                          <span>{r.symbol}</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                        <div className="text-[11px] text-slate-400 truncate max-w-[160px]">
                          {r.sector}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {formatNum(r.ltp)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-mono tabular-nums ${
                          r.changePct < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {pctFmt(r.changePct)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-mono tabular-nums ${
                          (r.periodReturnNPct ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {pctFmt(r.periodReturnNPct)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-red-600 dark:text-red-400">
                        {pctFmt(r.vsD120Pct)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {r.upDownVolRatio.toFixed(2)}x
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`font-mono font-bold tabular-nums ${scoreColor(r.technicalRiskScore)}`}>
                          {r.technicalRiskScore}
                        </span>
                        <div className="text-[10px] text-slate-400">{r.riskLevel}</div>
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <div className="flex flex-wrap gap-1 mb-1">
                          {r.warningTags.map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200/80 dark:border-red-900"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                          {r.explanation}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : r.symbol)}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500"
                          aria-label="Toggle technical score breakdown"
                        >
                          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/80 dark:bg-slate-950/60">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                            {r.breakdown.map((b) => (
                              <div
                                key={b.factor}
                                className="border border-slate-200 dark:border-slate-800 rounded p-2.5 bg-white dark:bg-slate-900 space-y-1"
                              >
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {b.factor}
                                  </span>
                                  <span className="font-mono font-bold text-red-600 dark:text-red-400">
                                    {b.score}/{b.maxScore}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {b.evidence}
                                </p>
                              </div>
                            ))}
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
  );
};

// ---------------------------------------------------------------------------
// 3. DO NOT BUY – HIGH RISK STOCKS (COMPOSITE)
// ---------------------------------------------------------------------------
export const CompositeDoNotBuyView: React.FC<SharedRiskViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const { settings } = useTradingSettings();
  const latestDay = dates[dates.length - 1] || '';
  const [data, setData] = useState<CompositeDoNotBuyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [auditNote, setAuditNote] = useState<string | null>(null);
  const [onlyAudited, setOnlyAudited] = useState(false);
  const [searchQ, setSearchQ] = useState('');

  const loadData = useCallback(async () => {
    if (!latestDay) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        day: latestDay,
        nDays: String(settings.lookbackDays),
        equityOnly: String(equityOnly),
      });
      const res = await fetch(`/api/risk/do-not-buy?${qs.toString()}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [latestDay, settings.lookbackDays, equityOnly]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const auditPriorityCandidates = async (symbols: string[]) => {
    const syms = symbols.slice(0, 4);
    if (syms.length === 0) return;
    setAuditing(true);
    setAuditNote(null);
    try {
      const res = await fetch('/api/risk/audit-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: syms, nDays: settings.lookbackDays }),
      });
      const json = (await res.json()) as CohortAuditResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Audit failed');
      const ok = json.audited.filter((a) => a.ok).length;
      setAuditNote(`Audited ${ok}/${json.audited.length} high-risk candidate(s). Composite scores refreshed.`);
      await loadData();
    } catch (err) {
      setAuditNote(err instanceof Error ? err.message : 'Batch audit failed');
    } finally {
      setAuditing(false);
    }
  };

  const filtered = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return (data?.rows || []).filter((r) => {
      if (onlyAudited && !r.hasFundamentalAudit) return false;
      if (!q) return true;
      return (
        r.symbol.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.sector.toLowerCase().includes(q)
      );
    });
  }, [data, onlyAudited, searchQ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-red-600 dark:text-red-400" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              DO NOT BUY – High Risk Stocks
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Composite risk matrix combining verified Fundamental/Regulatory Red Flags (55%),
            Technical Breakdown ({settings.lookbackDays}d ShareSansar, 30%), and Liquidity &amp;
            Governance Risk (15%)
          </p>
        </div>

        {data && data.priorityAuditSymbols.length > 0 && (
          <button
            type="button"
            disabled={auditing}
            onClick={() => void auditPriorityCandidates(data.priorityAuditSymbols)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            <FileSearch className={`w-3.5 h-3.5 ${auditing ? 'animate-pulse' : ''}`} />
            <span>
              {auditing
                ? 'Auditing Risky Candidates…'
                : `Verify Fundamentals for Top ${Math.min(4, data.priorityAuditSymbols.length)} Tech-Flagged`}
            </span>
          </button>
        )}
      </div>

      {auditNote && (
        <div className="p-3 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-800 dark:text-blue-200">
          {auditNote}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search symbol or sector…"
            className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 w-56"
          />
        </div>

        <label className="inline-flex items-center gap-2 text-xs cursor-pointer text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={onlyAudited}
            onChange={(e) => setOnlyAudited(e.target.checked)}
            className="rounded border-slate-300 text-red-600 focus:ring-red-600"
          />
          <span>Show only stocks with verified fundamental audits ({data?.auditedCount ?? 0})</span>
        </label>
      </div>

      {loading && !data ? (
        <div className="h-64 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : filtered.length === 0 ? (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-6 text-xs text-slate-500">
          No composite high-risk stocks match the current filter.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.slice(0, 50).map((row) => (
            <article
              key={row.symbol}
              className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onInspectSymbol(row.symbol)}
                      className="text-base font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                      <span>{row.symbol}</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {row.name}
                    </span>
                    <span className="text-xs text-slate-400">· {row.sector}</span>
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded border ${statusBadge(row.dataStatus)}`}>
                      {row.hasFundamentalAudit ? `${row.dataStatus} Audit` : 'Technical EOD Only'}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    LTP: {row.ltp !== null ? `Rs ${formatNum(row.ltp)}` : 'Unavailable'} (
                    {pctFmt(row.changePct)}) · Report: {row.reportingPeriod} · Published:{' '}
                    {row.publicationDate}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-right">
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Fundamental</div>
                    <div className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {row.fundamentalRiskScore !== null ? `${row.fundamentalRiskScore}/100` : 'Unaudited'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Technical</div>
                    <div className="font-mono text-sm font-semibold text-amber-600 dark:text-amber-400">
                      {row.technicalRiskScore}/100
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Composite Risk</div>
                    <div className={`font-mono text-xl font-bold tabular-nums ${scoreColor(row.compositeRiskScore)}`}>
                      {row.compositeRiskScore} / 100
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Why Not Buy?
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{row.whyNotBuy}</p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap gap-1.5">
                  {row.confirmedRedFlags.map((flag, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 text-[11px] font-medium rounded bg-red-600 text-white"
                    >
                      Fundamental: {flag}
                    </span>
                  ))}
                  {row.technicalWarnings.map((w) => (
                    <span
                      key={w}
                      className="px-2 py-0.5 text-[11px] font-medium rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900"
                    >
                      Tech: {w}
                    </span>
                  ))}
                </div>

                {!row.hasFundamentalAudit && (
                  <button
                    type="button"
                    disabled={auditing}
                    onClick={() => void auditPriorityCandidates([row.symbol])}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                  >
                    + Run Fundamental Audit
                  </button>
                )}
              </div>

              {row.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="text-slate-400">Sources:</span>
                  {row.sources.slice(0, 4).map((s, idx) => (
                    <a
                      key={idx}
                      href={s.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline max-w-[220px] truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{s.title}</span>
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 4. MARKET OPPORTUNITY VS RISK (FIXED-INCOME OPPORTUNITY COST BENCHMARKED)
// ---------------------------------------------------------------------------
export const MarketOpportunityVsRiskView: React.FC<SharedRiskViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const { settings } = useTradingSettings();
  const latestDay = dates[dates.length - 1] || '';
  const [data, setData] = useState<MarketOpportunityVsRiskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [refreshingMacro, setRefreshingMacro] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!latestDay) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        day: latestDay,
        nDays: String(settings.lookbackDays),
        equityOnly: String(equityOnly),
      });
      const res = await fetch(`/api/risk/opportunity-vs-risk?${qs.toString()}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [latestDay, settings.lookbackDays, equityOnly]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const refreshMacroRates = async () => {
    setRefreshingMacro(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/research/macro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || 'Macro rate search failed');
      }
      setStatusMsg('Updated Nepal Treasury Bill, Gov Bond, and Commercial Bank FD benchmarks.');
      await loadData();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to refresh macro rates');
    } finally {
      setRefreshingMacro(false);
    }
  };

  const runOpportunityAudits = async (symbols: string[]) => {
    const syms = symbols.slice(0, 4);
    if (syms.length === 0) return;
    setAuditing(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/risk/audit-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: syms, nDays: settings.lookbackDays }),
      });
      const json = (await res.json()) as CohortAuditResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Audit failed');
      const ok = json.audited.filter((a) => a.ok).length;
      setStatusMsg(`Completed fundamental & FD opportunity-cost audit for ${ok}/${json.audited.length} candidate(s).`);
      await loadData();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setAuditing(false);
    }
  };

  const fi = data?.fixedIncomeBenchmarks;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Market Opportunity vs Risk
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Compares fundamental strength, ShareSansar technical confirmation, and macro tailwinds
            against safer Nepal Bank FD, Treasury Bill, and Government Bond yields
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={refreshingMacro}
            onClick={() => void refreshMacroRates()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Banknote className={`w-3.5 h-3.5 ${refreshingMacro ? 'animate-pulse' : ''}`} />
            <span>{refreshingMacro ? 'Fetching FD/T-Bill…' : 'Sync FD & Bond Yields'}</span>
          </button>

          {data && data.candidateAuditSymbols.length > 0 && (
            <button
              type="button"
              disabled={auditing}
              onClick={() => void runOpportunityAudits(data.candidateAuditSymbols)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${auditing ? 'animate-pulse' : ''}`} />
              <span>
                {auditing
                  ? 'Auditing Opportunities…'
                  : `Audit Top ${Math.min(4, data.candidateAuditSymbols.length)} Breakout Candidates`}
              </span>
            </button>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-800 dark:text-blue-200">
          {statusMsg}
        </div>
      )}

      {/* Fixed Income Hurdle Benchmark Strip */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Banknote className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Nepal Risk-Free &amp; Fixed-Income Opportunity-Cost Hurdle</span>
            <span className={`px-2 py-0.5 text-[11px] font-medium rounded border ${statusBadge(data?.macroDataStatus || 'Unavailable')}`}>
              {data?.macroDataStatus || 'Unavailable'}
            </span>
          </div>
          {data?.macroRetrievedAt && (
            <span className="text-[11px] font-mono text-slate-400">
              Retrieved: {new Date(data.macroRetrievedAt).toLocaleString()}
            </span>
          )}
        </div>

        {fi ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5 bg-slate-50 dark:bg-slate-950">
              <div className="text-[11px] text-slate-400">Bank Individual FD</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {fi.bankFdIndividualRate}
              </div>
            </div>
            <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5 bg-slate-50 dark:bg-slate-950">
              <div className="text-[11px] text-slate-400">91d / 364d T-Bills</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {fi.tbill91d} / {fi.tbill364d}
              </div>
            </div>
            <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5 bg-slate-50 dark:bg-slate-950">
              <div className="text-[11px] text-slate-400">Gov Bond Yield</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {fi.govBondYield}
              </div>
            </div>
            <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5 bg-slate-50 dark:bg-slate-950">
              <div className="text-[11px] text-slate-400">NRB Policy Rate</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {fi.nrbPolicyRate}
              </div>
            </div>
            <div className="border border-slate-100 dark:border-slate-800 rounded p-2.5 bg-slate-50 dark:bg-slate-950">
              <div className="text-[11px] text-slate-400">Rate Cycle Trend</div>
              <div className="font-mono font-semibold text-blue-600 dark:text-blue-400 mt-0.5">
                {fi.rateTrend}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Fixed-income rates have not been fetched yet. Click &ldquo;Sync FD &amp; Bond
            Yields&rdquo; above to retrieve current Nepal Rastra Bank T-Bill, Government Bond, and
            Commercial Bank FD benchmarks.
          </p>
        )}
      </section>

      {loading && !data ? (
        <div className="h-64 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : (
        <div className="space-y-6">
          {/* Opportunities Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              <TrendingUp className="w-4 h-4" />
              <span>
                Actionable Opportunity Leaders &amp; High-Probability Setups ({data?.opportunities.length ?? 0})
              </span>
            </div>

            {!data || data.opportunities.length === 0 ? (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 text-xs text-slate-500">
                No qualifying setups detected on {latestDay}. Try refreshing or expanding N-day lookback in Settings.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.opportunities.slice(0, 20).map((row) => (
                  <article
                    key={row.symbol}
                    className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onInspectSymbol(row.symbol)}
                            className="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                          >
                            <span>{row.symbol}</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                          <span className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[180px]">
                            {row.name}
                          </span>
                          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${statusBadge(row.dataStatus)}`}>
                            {row.hasFundamentalAudit ? `${row.dataStatus} Audit` : 'Tech Setup'}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                          LTP Rs {formatNum(row.ltp)} ({pctFmt(row.changePct)}) · {settings.lookbackDays}d:{' '}
                          {pctFmt(row.periodReturnNPct)} · Turn: {row.technicalSnapshot.turnoverMultN.toFixed(1)}x
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          Opp {row.opportunityScore}/100
                        </div>
                        <div className="font-mono text-[11px] text-slate-400">
                          Risk {row.riskScore}/100
                        </div>
                      </div>
                    </div>

                    <div className="p-2.5 rounded bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-900/50">
                      <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                        Why Consider Buying:{' '}
                      </span>
                      <span className="text-slate-700 dark:text-slate-300">{row.whyConsiderBuying}</span>
                    </div>

                    <div className="text-[11px] text-slate-600 dark:text-slate-300">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Opportunity Cost vs FD/Bonds:{' '}
                      </span>
                      {row.opportunityCostVerdict}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
                      <span>
                        Report: {row.reportingPeriod} · Published: {row.publicationDate}
                      </span>
                      {!row.hasFundamentalAudit && (
                        <button
                          type="button"
                          disabled={auditing}
                          onClick={() => void runOpportunityAudits([row.symbol])}
                          className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                        >
                          + Audit Fundamentals
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Insufficient Compensation vs FD/Bonds */}
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
              <TrendingDown className="w-4 h-4" />
              <span>
                Insufficient Risk-Adjusted Compensation vs FD / Government Bonds (
                {data?.insufficientCompensation.length ?? 0})
              </span>
            </div>

            {!data || data.insufficientCompensation.length === 0 ? (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 text-xs text-slate-500">
                Audited stocks whose expected return or dividend/earnings yield fails to beat Nepal
                FD/Gov Bond benchmarks (or carry HOLD/AVOID risk-reward) appear here automatically.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.insufficientCompensation.map((row) => (
                  <article
                    key={row.symbol}
                    className="border border-amber-200 dark:border-amber-900/60 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onInspectSymbol(row.symbol)}
                          className="font-bold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {row.symbol}
                        </button>
                        <span className="text-slate-600 dark:text-slate-300">{row.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-mono text-[10px]">
                          {row.recommendation}
                        </span>
                      </div>
                      <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                        Risk {row.riskScore} vs Opp {row.opportunityScore}
                      </span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300">{row.opportunityCostVerdict}</p>
                    <div className="text-[11px] font-mono text-slate-400">
                      LTP Rs {formatNum(row.ltp)} · Report: {row.reportingPeriod}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
