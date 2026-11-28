import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CandlestickChart,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Download,
  ExternalLink,
  FileSpreadsheet,
  HelpCircle,
  RefreshCw,
  Scale,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type {
  CompanyFundamentalDetailResponse,
  DataProvenance,
  InvestorId,
  InvestorScoreResult,
  ScreenedCompanyRow,
  TrackedMetric,
} from '../../types/fundamental';
import { CompanyHistoricalTrendChart } from './ScreenerVisualCharts';

interface CompanyFundamentalDetailProps {
  symbol: string;
  equityOnly: boolean;
  onBack: () => void;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer: (symbol: string) => void;
  onOpenValuation?: (symbol: string) => void;
  onDataUpdated: () => void;
}

const INVESTOR_ORDER: InvestorId[] = [
  'buffett',
  'munger',
  'graham',
  'lynch',
  'marks',
  'fisher',
  'greenblatt',
  'templeton',
  'pabrai',
];

function provenanceStyle(p: DataProvenance): string {
  switch (p) {
    case 'Reported':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'Calculated':
      return 'text-blue-700 dark:text-blue-400';
    case 'Estimate':
      return 'text-amber-700 dark:text-amber-400';
    default:
      return 'text-slate-400 dark:text-slate-500';
  }
}

function fmtMetricValue(m: TrackedMetric, crore = false): string {
  if (m.value === null || !Number.isFinite(m.value)) return 'Unavailable';
  if (crore && m.unit === 'NPR') {
    return `Rs ${(m.value / 1e7).toFixed(2)} Cr`;
  }
  if (m.unit === '%') return `${m.value.toFixed(2)}%`;
  if (m.unit === 'x') return `${m.value.toFixed(2)}x`;
  if (m.unit === 'shares') return m.value.toLocaleString();
  if (m.unit === 'MW') return `${m.value.toFixed(1)} MW`;
  return `Rs ${m.value.toFixed(2)}`;
}

function fmtPctSigned(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'Unavailable';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function verdictTone(verdict: ScreenedCompanyRow['recommendation']['verdict']): string {
  switch (verdict) {
    case 'STRONG BUY':
    case 'BUY':
      return 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800';
    case 'ACCUMULATE':
    case 'WATCHLIST':
      return 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800';
    case 'HOLD':
      return 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800';
    case 'AVOID':
      return 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800';
    default:
      return 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
  }
}

export const CompanyFundamentalDetail: React.FC<CompanyFundamentalDetailProps> = ({
  symbol,
  equityOnly,
  onBack,
  onInspectSymbol,
  onInspectInAnalyzer,
  onOpenValuation,
  onDataUpdated,
}) => {
  const [detail, setDetail] = useState<CompanyFundamentalDetailResponse | null>(null);
  const [pendingRow, setPendingRow] = useState<ScreenedCompanyRow | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [expandedInvestor, setExpandedInvestor] = useState<InvestorId | null>('buffett');
  const [showRawLines, setShowRawLines] = useState<boolean>(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPendingRow(null);
    try {
      const res = await fetch(
        `/api/screener/company/${encodeURIComponent(symbol)}?equityOnly=${equityOnly}`
      );
      const body = await res.json();
      if (!res.ok) {
        if (body.pendingSummary) {
          setPendingRow(body.pendingSummary as ScreenedCompanyRow);
        }
        throw new Error(body.error || `No fundamental ledger loaded for ${symbol}`);
      }
      setDetail(body as CompanyFundamentalDetailResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load fundamental details');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, equityOnly]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleRefreshLive = async () => {
    setRefreshing(true);
    setToast(null);
    try {
      const res = await fetch(`/api/screener/refresh/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Report fetch failed');
      setToast({
        kind: 'ok',
        text: `Updated ${symbol}: ${body.periodsAdded} fiscal period(s) saved (${body.validationStatus}).`,
      });
      await loadDetail();
      onDataUpdated();
    } catch (err) {
      setToast({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Refresh failed',
      });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 w-72 animate-pulse bg-slate-200 dark:bg-slate-800 rounded" />
        <div className="h-44 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="h-72 animate-pulse bg-slate-200 dark:bg-slate-800 rounded-lg" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Screener</span>
        </button>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {symbol} {pendingRow ? `· ${pendingRow.companyName}` : ''}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {pendingRow ? `${pendingRow.sector} · Status: ${pendingRow.reportingStatus}` : error}
            </p>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {error ||
              'Financial statements have not yet been fetched for this symbol.'}
          </p>
          {toast && (
            <div className="text-xs text-red-600 dark:text-red-400">{toast.text}</div>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void handleRefreshLive()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>
                {refreshing ? 'Fetching Quarterly Reports…' : 'Fetch Quarterly Reports'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onInspectSymbol(symbol)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <CandlestickChart className="w-3.5 h-3.5" />
              <span>Price Chart</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { summary, valuation, growth, investorDetails, statements, officialSources } = detail;
  const latestStatement = statements[0];
  const m = latestStatement.metrics;

  return (
    <div className="space-y-5">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Screener</span>
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {summary.symbol}
              </h2>
              <span className="text-sm text-slate-600 dark:text-slate-300 truncate">
                {summary.companyName}
              </span>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${verdictTone(
                  summary.recommendation.verdict
                )}`}
              >
                {summary.recommendation.verdict}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              {summary.sector} ({summary.sectorGroup} Rules) · Period: {summary.latestPeriod.periodLabel}{' '}
              · Source: {summary.latestPeriod.dataSource.replace(/ShareSansar/gi, 'Quarterly Filing')} · Collected:{' '}
              {summary.latestPeriod.collectionDate?.slice(0, 10) || '—'}
              {summary.latestPeriod.publicationDate
                ? ` · Published: ${summary.latestPeriod.publicationDate}`
                : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleRefreshLive()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing…' : 'Live Refresh'}</span>
          </button>
          <a
            href={`/api/screener/export?format=csv&symbol=${encodeURIComponent(summary.symbol)}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </a>
          <a
            href={`/api/screener/export?format=excel&symbol=${encodeURIComponent(summary.symbol)}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Excel</span>
          </a>
          <button
            type="button"
            onClick={() => onInspectSymbol(summary.symbol)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <CandlestickChart className="w-3.5 h-3.5" />
            <span>Chart</span>
          </button>
          {onOpenValuation && (
            <button
              type="button"
              onClick={() => onOpenValuation(summary.symbol)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 whitespace-nowrap"
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Pricing &amp; Valuation</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onInspectInAnalyzer(summary.symbol)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Analyzer</span>
          </button>
        </div>
      </div>

      {toast && (
        <div
          className={`px-4 py-2.5 rounded-md border text-xs flex items-center justify-between gap-3 ${
            toast.kind === 'err'
              ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
              : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Data Quality & Validation Banner */}
      {(summary.latestPeriod.dataQualityFlags.length > 0 ||
        latestStatement.validationNotes.length > 0) && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3.5 flex flex-wrap items-start justify-between gap-3 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>
                Validation: {summary.latestPeriod.validationStatus} ·{' '}
                {summary.latestPeriod.dataQualityFlags.length > 0
                  ? `Flags: ${summary.latestPeriod.dataQualityFlags.join(', ')}`
                  : 'All accounting checks passed'}
              </span>
            </div>
            <ul className="text-[11px] text-slate-600 dark:text-slate-400 list-disc pl-5 space-y-0.5">
              {latestStatement.validationNotes.slice(0, 4).map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Provenance legend:{' '}
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">Reported</span> ·{' '}
            <span className="text-blue-600 dark:text-blue-400 font-medium">Calculated</span> ·{' '}
            <span className="text-amber-600 dark:text-amber-400 font-medium">Estimate</span>
          </div>
        </div>
      )}

      {/* Earnings Quality & Operating Profit Focus Banner */}
      {growth.earningsQuality &&
        (growth.earningsQuality.hasNonOperatingCaution ||
          growth.earningsQuality.status === 'Watch') && (
          <div
            className={`border rounded-lg p-3.5 space-y-2 text-xs ${
              growth.earningsQuality.hasNonOperatingCaution
                ? 'border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30'
                : 'border-slate-200 dark:border-slate-800 bg-amber-50/40 dark:bg-amber-950/15'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  {growth.earningsQuality.cautionTitle ??
                    'Operating Profit Focus · Non-Operating Distortion Check'}
                </span>
              </div>
              <span className="text-[11px] font-mono text-amber-800 dark:text-amber-300 tabular-nums">
                Valuation Focus: {growth.earningsQuality.focusMetric}
              </span>
            </div>
            {growth.earningsQuality.cautionMessage && (
              <p className="text-xs text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
                {growth.earningsQuality.cautionMessage}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1 text-[11px] font-mono tabular-nums text-amber-900 dark:text-amber-200">
              <span>
                Op. Profit:{' '}
                <strong>
                  {growth.earningsQuality.operatingProfitCr !== null
                    ? `Rs ${growth.earningsQuality.operatingProfitCr.toFixed(1)} Cr`
                    : '—'}
                </strong>
              </span>
              <span>
                Op. Margin:{' '}
                <strong>
                  {growth.earningsQuality.operatingMarginPct !== null
                    ? `${growth.earningsQuality.operatingMarginPct.toFixed(1)}%`
                    : '—'}
                </strong>
              </span>
              <span>
                Net / Op Ratio:{' '}
                <strong>
                  {growth.earningsQuality.netToOperatingProfitRatioPct !== null
                    ? `${growth.earningsQuality.netToOperatingProfitRatioPct.toFixed(0)}%`
                    : '—'}
                </strong>
              </span>
              {growth.earningsQuality.nonOperatingIncomeCr !== null && (
                <span>
                  Non-Op / Disposal Gain:{' '}
                  <strong>
                    Rs {growth.earningsQuality.nonOperatingIncomeCr.toFixed(1)} Cr
                  </strong>
                </span>
              )}
            </div>
          </div>
        )}

      {/* Fundamental Scores vs Separate Market Overlay */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Fundamental Composite Scores (Separated from Price Momentum)
            </h3>
            <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400 tabular-nums">
              Overall {summary.scores.overallScore.toFixed(1)} / 100
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Fundamental Quality', val: summary.scores.fundamentalQualityScore },
              { label: 'Value Score', val: summary.scores.valueScore },
              { label: 'Growth Score', val: summary.scores.growthScore },
              { label: 'Risk Control', val: summary.scores.riskManagementScore },
              { label: 'Valuation Attractiveness', val: summary.scores.valuationAttractivenessScore },
              { label: 'Long-Term Compounding', val: summary.scores.longTermCompoundingScore },
            ].map((item) => (
              <div
                key={item.label}
                className="border border-slate-100 dark:border-slate-800 rounded-md p-2.5 bg-slate-50/60 dark:bg-slate-950/60"
              >
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{item.label}</div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-base font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {item.val.toFixed(1)}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">/100</span>
                </div>
                <div className="h-1.5 rounded bg-slate-200 dark:bg-slate-800 mt-1.5 overflow-hidden">
                  <div
                    className={`h-full ${
                      item.val >= 65
                        ? 'bg-emerald-600 dark:bg-emerald-500'
                        : item.val >= 45
                          ? 'bg-blue-600 dark:bg-blue-500'
                          : 'bg-amber-500'
                    }`}
                    style={{ width: `${Math.min(100, item.val)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Recommendation Explanation */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                Explainable Evaluation Rationale
              </div>
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                {summary.recommendation.whyQualifies}
              </p>
              {summary.recommendation.supportingMetrics.length > 0 && (
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1">
                  {summary.recommendation.supportingMetrics.join(' · ')}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              {summary.recommendation.downsideRisks.length > 0 && (
                <div>
                  <div className="font-semibold text-red-600 dark:text-red-400">
                    Downside &amp; Fundamental Risks
                  </div>
                  <ul className="list-disc pl-4 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                    {summary.recommendation.downsideRisks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.recommendation.missingOrUnverified.length > 0 && (
                <div>
                  <div className="font-semibold text-amber-600 dark:text-amber-400">
                    Missing / Unverified Disclosures
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {summary.recommendation.missingOrUnverified.join(' · ')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Separate Market Overlay Card */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Market Overlay (EOD Separate)
            </h3>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {summary.market.date || 'No EOD'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-y-2.5 gap-x-3 text-xs">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Market LTP</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {summary.market.ltp !== null ? `Rs ${summary.market.ltp.toFixed(1)}` : 'Unavailable'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">20D Return</div>
              <div
                className={`font-mono font-semibold tabular-nums ${
                  (summary.market.periodReturnNPct ?? 0) >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {fmtPctSigned(summary.market.periodReturnNPct)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Daily Turnover</div>
              <div className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                {summary.market.turnover !== null
                  ? `Rs ${(summary.market.turnover / 1e7).toFixed(2)} Cr`
                  : 'Unavailable'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Liquidity Tier</div>
              <div className="font-medium text-slate-800 dark:text-slate-200">
                {summary.market.liquidityTier}{' '}
                {summary.market.turnoverMultN !== null
                  ? `(${summary.market.turnoverMultN.toFixed(2)}x avg)`
                  : ''}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">52W Range</div>
              <div className="font-mono text-slate-700 dark:text-slate-300 tabular-nums text-[11px]">
                {summary.market.w52Low !== null && summary.market.w52High !== null
                  ? `${summary.market.w52Low.toFixed(0)} – ${summary.market.w52High.toFixed(0)}`
                  : 'Unavailable'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Gap vs 52W High</div>
              <div className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                {summary.market.gap52hPct !== null ? `${summary.market.gap52hPct.toFixed(1)}%` : 'Unavailable'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">vs MA120 / MA180</div>
              <div className="font-mono text-slate-700 dark:text-slate-300 tabular-nums text-[11px]">
                {summary.market.vsD120Pct !== null
                  ? `${summary.market.vsD120Pct >= 0 ? '+' : ''}${summary.market.vsD120Pct.toFixed(1)}% / ${summary.market.vsD180Pct !== null ? `${summary.market.vsD180Pct.toFixed(1)}%` : '—'}`
                  : 'Unavailable'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Momentum Score</div>
              <div className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                {summary.market.momentumScore !== null
                  ? `${summary.market.momentumScore.toFixed(1)}/100`
                  : 'Unavailable'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Coming Quarter Potential Blow-Up / Blow-Down Outlook (With Reasons & References) */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Coming Quarter Potential Blow-Up / Blow-Down Outlook ({summary.comingQuarterOutlook.comingQuarterLabel})
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Projected from current-FY {summary.comingQuarterOutlook.currentPeriodLabel} · Confidence{' '}
              {summary.comingQuarterOutlook.confidence}
            </p>
          </div>
          <div className="text-right font-mono tabular-nums">
            <span
              className={`text-sm font-bold ${
                summary.comingQuarterOutlook.direction === 'Blow Up' ||
                summary.comingQuarterOutlook.direction === 'Moderate Upside'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : summary.comingQuarterOutlook.direction === 'Blow Down' ||
                      summary.comingQuarterOutlook.direction === 'Downside Risk'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {summary.comingQuarterOutlook.direction}
            </span>
            <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
              ({summary.comingQuarterOutlook.score >= 0 ? '+' : ''}
              {summary.comingQuarterOutlook.score})
            </span>
          </div>
        </div>

        <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
          {summary.comingQuarterOutlook.headline}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              Upside Blow-Up Catalysts ({summary.comingQuarterOutlook.catalysts.length})
            </div>
            {summary.comingQuarterOutlook.catalysts.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                No dominant sequential or regulatory upside catalyst triggered in the current quarter.
              </p>
            ) : (
              <ol className="space-y-1.5 text-[11px] text-slate-700 dark:text-slate-300 list-decimal list-inside">
                {summary.comingQuarterOutlook.catalysts.map((c, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {c}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-red-600 dark:text-red-400">
              Downside Blow-Down Risks ({summary.comingQuarterOutlook.risks.length})
            </div>
            {summary.comingQuarterOutlook.risks.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                No severe quarterly contraction or regulatory overhang flagged in current disclosures.
              </p>
            ) : (
              <ol className="space-y-1.5 text-[11px] text-slate-700 dark:text-slate-300 list-decimal list-inside">
                {summary.comingQuarterOutlook.risks.map((rk, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {rk}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {summary.comingQuarterOutlook.references.length > 0 && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">References:</span>
            {summary.comingQuarterOutlook.references.map((ref, idx) =>
              ref.url ? (
                <a
                  key={idx}
                  href={ref.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline font-mono"
                >
                  {ref.label} ({ref.period})
                </a>
              ) : (
                <span key={idx} className="font-mono">
                  {ref.label} · {ref.source} ({ref.period})
                </span>
              )
            )}
          </div>
        )}
      </div>

      {/* Valuation & Intrinsic Value Breakdown */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Intrinsic Value, Valuation Multiples &amp; Sector Methodology ({summary.sectorGroup})
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {valuation.method}
            </p>
          </div>
          {valuation.intrinsicValue !== null && (
            <div className="text-right font-mono tabular-nums">
              <span className="text-xs text-slate-500 dark:text-slate-400 mr-2">
                Intrinsic Estimate:
              </span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Rs {valuation.intrinsicValue.toFixed(1)}
              </span>
              {valuation.marginOfSafetyPct !== null && (
                <span
                  className={`ml-2 text-xs font-semibold ${
                    valuation.marginOfSafetyPct >= 15
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : valuation.marginOfSafetyPct >= 0
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  (MoS {valuation.marginOfSafetyPct >= 0 ? '+' : ''}
                  {valuation.marginOfSafetyPct.toFixed(1)}%)
                </span>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2.5">
          {valuation.sectorMethodologyNote}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
          {[
            { label: 'Live P/E', val: valuation.livePe !== null ? `${valuation.livePe.toFixed(2)}x` : 'Unavailable' },
            { label: 'Live P/B', val: valuation.livePb !== null ? `${valuation.livePb.toFixed(2)}x` : 'Unavailable' },
            { label: 'PEG Ratio', val: valuation.livePeg !== null ? `${valuation.livePeg.toFixed(2)}x` : 'Unavailable' },
            { label: 'Earnings Yield', val: valuation.earningsYieldPct !== null ? `${valuation.earningsYieldPct.toFixed(2)}%` : 'Unavailable' },
            {
              label: 'Valuation Range',
              val:
                valuation.intrinsicValueLow !== null && valuation.intrinsicValueHigh !== null
                  ? `Rs ${valuation.intrinsicValueLow.toFixed(0)}–${valuation.intrinsicValueHigh.toFixed(0)}`
                  : 'Unavailable',
            },
            {
              label: 'NCAV / Share',
              val: valuation.ncavPerShare !== null ? `Rs ${valuation.ncavPerShare.toFixed(1)}` : 'N/A',
            },
            {
              label: 'Magic Rank',
              val: summary.greenblatt.combinedRank
                ? `#${summary.greenblatt.earningsYieldRank}+#${summary.greenblatt.roicRank} / ${summary.greenblatt.totalRanked}`
                : 'N/A',
            },
          ].map((k) => (
            <div key={k.label} className="border border-slate-100 dark:border-slate-800 rounded p-2">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{k.label}</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                {k.val}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-slate-600 dark:text-slate-400 pt-1">
          <div>
            <span className="font-semibold text-slate-800 dark:text-slate-200 block mb-1">
              Inputs &amp; Assumptions
            </span>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1">
              {valuation.formulaInputs.map((fi) => (
                <span key={fi.label} className="font-mono">
                  {fi.label}: <strong className="text-slate-800 dark:text-slate-200">{fi.value}</strong>{' '}
                  <span className={provenanceStyle(fi.provenance)}>({fi.provenance})</span>
                </span>
              ))}
            </div>
            {valuation.assumptions.map((a, i) => (
              <div key={i}>• {a}</div>
            ))}
          </div>
          <div>
            <span className="font-semibold text-slate-800 dark:text-slate-200 block mb-1">
              Disclosure &amp; Model Limitations
            </span>
            {valuation.limitations.length === 0 ? (
              <div>No critical valuation input gaps for latest period.</div>
            ) : (
              valuation.limitations.map((l, i) => <div key={i}>• {l}</div>)
            )}
          </div>
        </div>
      </div>

      {/* Multi-Investor Consensus Matrix */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
        <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
          Multi-Investor Consensus Screening ({summary.passedInvestorCount} of 9 Investor Models Qualified)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
          {summary.consensusMatches.map((cm) => (
            <div
              key={cm.id}
              className={`rounded-md border p-2.5 ${
                cm.qualified
                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {cm.label}
                </span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    cm.qualified
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {cm.combinedScore.toFixed(1)} {cm.qualified ? '· MATCH' : ''}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {cm.theme}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                {cm.reason}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 9 Expandable Investor Evaluation Scorecards */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Nine Quantitative Investor Frameworks — Transparent Rule Breakdown
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Sector-aware rulebooks with exact weights, thresholds, and reported vs. calculated provenance
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {INVESTOR_ORDER.map((invId) => {
            const inv: InvestorScoreResult = investorDetails[invId];
            const isOpen = expandedInvestor === invId;
            return (
              <div key={invId}>
                <button
                  type="button"
                  onClick={() => setExpandedInvestor(isOpen ? null : invId)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {inv.investorName}
                      </span>
                      <span
                        className={`text-[11px] font-medium ${
                          inv.qualified
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {inv.qualified ? 'Qualified' : 'Not Qualified'}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        Coverage {inv.dataCoveragePct.toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {inv.philosophy}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-24 hidden sm:block h-1.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full ${
                          inv.score >= 62
                            ? 'bg-emerald-600 dark:bg-emerald-500'
                            : inv.score >= 45
                              ? 'bg-blue-600 dark:bg-blue-500'
                              : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.min(100, inv.score)}%` }}
                      />
                    </div>
                    <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums w-12 text-right">
                      {inv.score.toFixed(1)}
                    </span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-slate-50/70 dark:bg-slate-950/60 space-y-2.5">
                    <p className="text-xs text-slate-600 dark:text-slate-300">{inv.summary}</p>
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-900">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Criterion</th>
                            <th className="px-3 py-1.5 font-medium text-right">Weight</th>
                            <th className="px-3 py-1.5 font-medium text-right">Actual</th>
                            <th className="px-3 py-1.5 font-medium">Threshold</th>
                            <th className="px-3 py-1.5 font-medium">Provenance</th>
                            <th className="px-3 py-1.5 font-medium">Result &amp; Explanation</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {inv.criteria.map((c) => (
                            <tr key={c.key}>
                              <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                {c.label}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                                {c.earnedPoints}/{c.weight}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                {c.actualDisplay}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                                {c.thresholdDisplay}
                              </td>
                              <td className={`px-3 py-2 text-[11px] font-medium whitespace-nowrap ${provenanceStyle(c.provenance)}`}>
                                {c.provenance}
                              </td>
                              <td className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300">
                                <span className="inline-flex items-center gap-1 mr-1.5">
                                  {c.status === 'passed' ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 inline" />
                                  ) : c.status === 'failed' ? (
                                    <XCircle className="w-3.5 h-3.5 text-red-500 inline" />
                                  ) : (
                                    <HelpCircle className="w-3.5 h-3.5 text-slate-400 inline" />
                                  )}
                                </span>
                                {c.explanation}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Historical Multi-Period Trajectory & YoY/QoQ/CAGR */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CompanyHistoricalTrendChart
          statements={statements}
          q4Benchmark={growth.q4Benchmark}
        />

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Multi-Horizon Growth Matrix (QoQ · YoY · 3Y/5Y CAGR · vs 3Y 4Q Avg)
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              {growth.periodsAvailable} period(s) / {growth.fiscalYearsAvailable} FY(s)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
                <tr>
                  <th className="py-1.5 font-medium">Metric</th>
                  <th className="py-1.5 font-medium text-right">QoQ</th>
                  <th className="py-1.5 font-medium text-right">YoY</th>
                  <th className="py-1.5 font-medium text-right">3Y CAGR</th>
                  <th className="py-1.5 font-medium text-right">5Y CAGR</th>
                  <th className="py-1.5 font-medium text-right">vs 3Y 4Q Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                {[
                  {
                    label: 'Operating Profit (Core Focus)',
                    qoq: growth.operatingProfitQoqPct,
                    yoy: growth.operatingProfitYoyPct,
                    c3: growth.operatingProfitCagr3yPct,
                    c5: growth.operatingProfitCagr5yPct,
                    vsQ4: growth.q4Benchmark?.operatingProfitVsAvgPct ?? null,
                  },
                  {
                    label: 'EPS',
                    qoq: growth.epsQoqPct,
                    yoy: growth.epsYoyPct,
                    c3: growth.epsCagr3yPct,
                    c5: growth.epsCagr5yPct,
                    vsQ4: growth.q4Benchmark?.epsVsAvgPct ?? null,
                  },
                  {
                    label: 'Net Profit',
                    qoq: growth.netProfitQoqPct,
                    yoy: growth.netProfitYoyPct,
                    c3: growth.netProfitCagr3yPct,
                    c5: growth.netProfitCagr5yPct,
                    vsQ4: growth.q4Benchmark?.netProfitVsAvgPct ?? null,
                  },
                  {
                    label: 'Revenue',
                    qoq: growth.revenueQoqPct,
                    yoy: growth.revenueYoyPct,
                    c3: growth.revenueCagr3yPct,
                    c5: growth.revenueCagr5yPct,
                    vsQ4: growth.q4Benchmark?.revenueVsAvgPct ?? null,
                  },
                  {
                    label: 'BVPS',
                    qoq: null,
                    yoy: growth.bvpsYoyPct,
                    c3: growth.bvpsCagr3yPct,
                    c5: growth.bvpsCagr5yPct,
                    vsQ4: growth.q4Benchmark?.bvpsVsAvgPct ?? null,
                  },
                ].map((row) => (
                  <tr key={row.label}>
                    <td className="py-2 font-sans font-medium text-slate-800 dark:text-slate-200">
                      {row.label}
                    </td>
                    {[row.qoq, row.yoy, row.c3, row.c5, row.vsQ4].map((val, idx) => (
                      <td
                        key={idx}
                        className={`py-2 text-right ${
                          val === null
                            ? 'text-slate-400'
                            : val >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {fmtPctSigned(val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {growth.q4Benchmark && growth.q4Benchmark.yearsCount > 0 && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-300 font-mono tabular-nums">
              <span className="font-sans font-medium text-amber-700 dark:text-amber-300">
                {growth.q4Benchmark.basisLabel}:
              </span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Op. Profit Avg:{' '}
                  <strong>
                    {growth.q4Benchmark.avgOperatingProfitCr !== null
                      ? `Rs ${growth.q4Benchmark.avgOperatingProfitCr.toFixed(1)} Cr`
                      : '—'}
                  </strong>
                </span>
                <span>
                  EPS Avg:{' '}
                  <strong>
                    {growth.q4Benchmark.avgEps !== null
                      ? growth.q4Benchmark.avgEps.toFixed(1)
                      : '—'}
                  </strong>
                </span>
                <span>
                  ROE Avg:{' '}
                  <strong>
                    {growth.q4Benchmark.avgRoePct !== null
                      ? `${growth.q4Benchmark.avgRoePct.toFixed(1)}%`
                      : '—'}
                  </strong>
                </span>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
            <div>
              <span className="text-slate-500">Assets:</span>{' '}
              <span className="font-mono font-medium tabular-nums">{fmtMetricValue(m.totalAssets, true)}</span>
            </div>
            <div>
              <span className="text-slate-500">Liabilities:</span>{' '}
              <span className="font-mono font-medium tabular-nums">{fmtMetricValue(m.totalLiabilities, true)}</span>
            </div>
            <div>
              <span className="text-slate-500">Net Worth:</span>{' '}
              <span className="font-mono font-medium tabular-nums">{fmtMetricValue(m.netWorth, true)}</span>
            </div>
            <div>
              <span className="text-slate-500">Op. Margin:</span>{' '}
              <span className="font-mono font-medium tabular-nums">
                {growth.operatingMarginPct !== null
                  ? `${growth.operatingMarginPct.toFixed(1)}%`
                  : '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Reserves:</span>{' '}
              <span className="font-mono font-medium tabular-nums">{fmtMetricValue(m.reserves, true)}</span>
            </div>
            <div>
              <span className="text-slate-500">Operating Cash Flow:</span>{' '}
              <span className="font-mono font-medium tabular-nums">{fmtMetricValue(m.operatingCashFlow, true)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stored Quarterly & Annual Statement Ledger Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Archived Quarterly &amp; Annual Financial Statements (Deduplicated by FY × Quarter)
          </h3>
          {latestStatement.rawLineItems && latestStatement.rawLineItems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRawLines((v) => !v)}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {showRawLines
                ? 'Hide Line Items'
                : `View ${latestStatement.rawLineItems.length} Line Items`}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium text-right">EPS</th>
                <th className="px-3 py-2 font-medium text-right">Op. Profit</th>
                <th className="px-3 py-2 font-medium text-right">Net Profit</th>
                <th className="px-3 py-2 font-medium text-right">Revenue</th>
                <th className="px-3 py-2 font-medium text-right">Net Margin</th>
                <th className="px-3 py-2 font-medium text-right">ROE</th>
                <th className="px-3 py-2 font-medium text-right">ROA</th>
                <th className="px-3 py-2 font-medium text-right">BVPS</th>
                <th className="px-3 py-2 font-medium text-right">
                  {summary.sectorGroup === 'Banking' || summary.sectorGroup === 'Microfinance'
                    ? 'NPL / CAR'
                    : 'D/E'}
                </th>
                <th className="px-3 py-2 font-medium text-right">OCF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
              {statements.map((st) => (
                <tr key={st.id}>
                  <td className="px-3 py-2 font-sans font-medium whitespace-nowrap text-slate-900 dark:text-slate-100">
                    {st.periodLabel}
                  </td>
                  <td className="px-3 py-2 font-sans text-[11px] text-slate-500 whitespace-nowrap">
                    {st.dataSource.replace(/ShareSansar/gi, 'Quarterly Filing')}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtMetricValue(st.metrics.eps)}</td>
                  <td className="px-3 py-2 text-right">{fmtMetricValue(st.metrics.operatingProfit, true)}</td>
                  <td className="px-3 py-2 text-right">{fmtMetricValue(st.metrics.netProfit, true)}</td>
                  <td className="px-3 py-2 text-right">{fmtMetricValue(st.metrics.revenue, true)}</td>
                  <td className="px-3 py-2 text-right">{fmtMetricValue(st.metrics.netProfitMarginPct)}</td>
                  <td className="px-3 py-2 text-right">{fmtMetricValue(st.metrics.roePct)}</td>
                  <td className="px-3 py-2 text-right">{fmtMetricValue(st.metrics.roaPct)}</td>
                  <td className="px-3 py-2 text-right">{fmtMetricValue(st.metrics.bvps)}</td>
                  <td className="px-3 py-2 text-right">
                    {summary.sectorGroup === 'Banking' || summary.sectorGroup === 'Microfinance'
                      ? `${st.metrics.nplPct.value !== null ? `${st.metrics.nplPct.value.toFixed(2)}%` : '—'} / ${st.metrics.carPct.value !== null ? `${st.metrics.carPct.value.toFixed(1)}%` : '—'}`
                      : fmtMetricValue(st.metrics.debtToEquity)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtMetricValue(st.metrics.operatingCashFlow, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showRawLines && latestStatement.rawLineItems && (
          <div className="border-t border-slate-200 dark:border-slate-800 p-4 max-h-80 overflow-auto bg-slate-50 dark:bg-slate-950">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-1 pr-3 font-medium">Statement Tab</th>
                  <th className="py-1 pr-3 font-medium">Section</th>
                  <th className="py-1 pr-3 font-medium">Particulars</th>
                  <th className="py-1 text-right font-medium">Reported Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                {latestStatement.rawLineItems.map((li, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3 text-slate-500 whitespace-nowrap">{li.tab}</td>
                    <td className="py-1 pr-3 text-slate-500 whitespace-nowrap">{li.section}</td>
                    <td className="py-1 pr-3 text-slate-800 dark:text-slate-200">{li.particulars}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{li.rawValue || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sources */}
      {officialSources.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Verified Financial Sources &amp; Disclosures
          </h3>
          <div className="flex flex-wrap gap-3 text-xs">
            {officialSources.map((src) => (
              <a
                key={src.uri}
                href={src.uri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
              >
                <span>
                  [{src.category}] {src.title.replace(/\s*[—-]\s*ShareSansar/gi, '')}
                </span>
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
