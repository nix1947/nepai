import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart2,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  Globe,
  Landmark,
  RefreshCw,
  Scale,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { useTradingSettings } from '../hooks/useTradingSettings';
import type { DataFreshnessStatus, StockRecommendation, StockResearchResponse } from '../types/market';

interface StockRiskOpportunitiesPanelProps {
  symbol: string;
  companyName?: string;
  autoLoad?: boolean;
}

const clientStockCache = new Map<string, StockResearchResponse>();

type AssessmentSubTab = 'overview' | 'financials' | 'risks' | 'scenarios';

function freshnessBadgeClass(status: DataFreshnessStatus): string {
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

function recBadgeClass(rec: StockRecommendation): string {
  if (rec === 'BUY') {
    return 'bg-emerald-600 text-white';
  }
  if (rec === 'AVOID') {
    return 'bg-red-600 text-white';
  }
  if (rec === 'HOLD') {
    return 'bg-amber-500 text-white';
  }
  return 'bg-slate-700 dark:bg-slate-600 text-white';
}

export const StockRiskOpportunitiesPanel: React.FC<StockRiskOpportunitiesPanelProps> = ({
  symbol,
  companyName,
  autoLoad = true,
}) => {
  const { settings } = useTradingSettings();
  const [data, setData] = useState<StockResearchResponse | null>(
    () => (symbol ? clientStockCache.get(symbol) ?? null : null)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<AssessmentSubTab>('overview');

  const fetchResearch = useCallback(
    async (force = false) => {
      if (!symbol) return;
      if (!force && clientStockCache.has(symbol)) {
        setData(clientStockCache.get(symbol)!);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/research/stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, force, nDays: settings.lookbackDays }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `Request failed (${res.status})`);
        }
        clientStockCache.set(symbol, json);
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load fundamental research');
      } finally {
        setLoading(false);
      }
    },
    [symbol, settings.lookbackDays]
  );

  useEffect(() => {
    if (!symbol) return;
    const cached = clientStockCache.get(symbol);
    if (cached) {
      setData(cached);
      setError(null);
      return;
    }
    setData(null);
    if (!autoLoad) return;
    const timer = setTimeout(() => {
      void fetchResearch(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [symbol, autoLoad, fetchResearch]);

  if (!symbol) return null;

  const fm = data?.financialMetrics;
  const pc = data?.periodComparisons;
  const a9 = data?.assessment9Part;
  const oc = data?.opportunityCost;

  const metricCells: Array<{ label: string; value: string }> = fm
    ? [
        { label: 'Revenue / Interest Inc.', value: fm.revenue },
        { label: 'Net Profit', value: fm.netProfit },
        { label: 'EPS', value: fm.eps },
        { label: 'Net Worth / Share', value: fm.netWorthPerShare },
        { label: 'P/E Ratio', value: fm.pe },
        { label: 'P/B Ratio', value: fm.pb },
        { label: 'ROE', value: fm.roe },
        { label: 'ROA', value: fm.roa },
        { label: 'Reserves', value: fm.reserves },
        { label: 'Retained Earnings', value: fm.retainedEarnings },
        { label: 'Total Assets', value: fm.totalAssets },
        { label: 'Total Liabilities', value: fm.totalLiabilities },
        { label: 'Deposits', value: fm.deposits },
        { label: 'Loans & Advances', value: fm.loans },
        { label: 'NPL Ratio', value: fm.npl },
        { label: 'Capital Adequacy (CAR)', value: fm.car },
        { label: 'Liquidity / CCD', value: fm.liquidityRatio },
        { label: 'Operating Cash Flow', value: fm.cashFlow },
        { label: 'Dividend History', value: fm.dividendHistory },
        ...(fm.sectorSpecific || []),
      ]
    : [];

  return (
    <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {symbol} Institutional Fundamental, Macro &amp; Risk Analysis
            </h3>
            {data && (
              <>
                <span className={`px-2 py-0.5 text-[11px] font-bold rounded ${recBadgeClass(data.recommendation)}`}>
                  {data.recommendation}
                </span>
                <span
                  className={`px-2 py-0.5 text-[11px] font-medium rounded border ${freshnessBadgeClass(data.dataStatus)}`}
                >
                  {data.dataStatus}
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {companyName || data?.companyName || symbol}
            {data?.sector ? ` · ${data.sector}` : ''}
            {data && (
              <>
                {' · '}Report: <span className="font-medium text-slate-700 dark:text-slate-200">{data.reportingPeriod}</span>
                {' · '}Published: <span className="font-mono">{data.publicationDate}</span>
                {' · '}Retrieved:{' '}
                <span className="font-mono tabular-nums">
                  {new Date(data.retrievedAt || data.generatedAt).toLocaleString()}
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchResearch(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Retrieving reports…' : 'Refresh Live Fundamental Search'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void fetchResearch(true)}
            className="underline font-medium shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {data?.notice && (
        <div className="p-3 rounded-md border border-amber-200 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
          {data.notice}
        </div>
      )}

      {data && data.limitations && data.limitations.length > 0 && (
        <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-600 dark:text-slate-300 space-y-1">
          <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <span>Disclosure &amp; Data Limitations (No Fabricated Estimates)</span>
          </div>
          <ul className="list-disc pl-5 space-y-0.5">
            {data.limitations.map((lim, idx) => (
              <li key={idx}>{lim}</li>
            ))}
          </ul>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-44 animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
            <div className="h-44 animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
          </div>
        </div>
      ) : !data && !error ? (
        <div className="text-xs text-slate-500 py-4 flex flex-wrap items-center justify-between gap-3">
          <span>
            Search NEPSE, SEBON, and official quarterly/annual disclosures for {symbol}, benchmark
            against Nepal FD &amp; Treasury Bill rates, and generate a 9-part fundamental assessment.
          </span>
          <button
            type="button"
            onClick={() => void fetchResearch(false)}
            className="px-3.5 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700"
          >
            Run Deep Fundamental Audit for {symbol}
          </button>
        </div>
      ) : data ? (
        data.rawFallback ? (
          <div className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
            {data.rawFallback}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Risk Score vs Opportunity Score & Opportunity Cost Banner */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-red-700 dark:text-red-400">
                    Fundamental &amp; Total Risk Score
                  </span>
                  <span className="font-mono font-bold text-base text-slate-900 dark:text-slate-100 tabular-nums">
                    {data.riskScore} / 100
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      data.riskScore >= 65
                        ? 'bg-red-600'
                        : data.riskScore >= 45
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    }`}
                    style={{ width: `${data.riskScore}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Higher score = heavier earnings, balance sheet, governance, valuation, or macro risk.
                </p>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    Fundamental Opportunity Score
                  </span>
                  <span className="font-mono font-bold text-base text-slate-900 dark:text-slate-100 tabular-nums">
                    {data.opportunityScore} / 100
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${data.opportunityScore}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Higher score = stronger growth catalysts, ROE, margin of safety, and macro fit.
                </p>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-1.5 bg-slate-50 dark:bg-slate-950 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Fixed-Income Hurdle (FD / Bonds)</span>
                  </span>
                  {oc && oc.beatsFixedIncome !== null && (
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        oc.beatsFixedIncome
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {oc.beatsFixedIncome ? 'Beats FD/Bond' : 'Below FD Hurdle'}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  FD: {oc?.benchmarkFdRateText || 'Unavailable'} · T-Bill: {oc?.benchmarkTBillText || 'Unavailable'}
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-2">
                  {oc?.verdict || 'Run macro & stock search to benchmark expected equity return against Nepal FD/Bonds.'}
                </p>
              </div>
            </div>

            {data.summary && (
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {data.summary}
              </p>
            )}

            {/* Sub-navigation for the 9-part report */}
            <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
              {[
                { id: 'overview', label: '1–4. Health, Strengths & Catalysts', icon: BookOpen },
                { id: 'financials', label: '5–6. Financials, Trends & Valuation', icon: BarChart2 },
                { id: 'risks', label: 'Risks, Red Flags & Score Evidence', icon: ShieldAlert },
                { id: 'scenarios', label: '7–9. Scenarios, Watchlist & FD Test', icon: FileText },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = subTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSubTab(tab.id as AssessmentSubTab)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {subTab === 'overview' && (
              <div className="space-y-5">
                {a9 && (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2 text-xs">
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                      (1) Business &amp; Financial Health
                    </h4>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                      {a9.businessHealth}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>(2) Fundamental Strengths &amp; Tailwinds</span>
                    </div>
                    {a9?.fundamentalStrengths && a9.fundamentalStrengths.length > 0 && (
                      <ul className="list-disc pl-4 space-y-1 text-xs text-slate-700 dark:text-slate-300">
                        {a9.fundamentalStrengths.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    )}
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800/80 pt-1">
                      {data.opportunities.map((item, idx) => (
                        <li key={idx} className="py-2 first:pt-0 last:pb-0 space-y-1 text-xs">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {item.title}
                            </span>
                            <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
                              {item.impact}
                            </span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                            {item.detail}
                          </p>
                          {item.evidence && (
                            <p className="text-[11px] font-mono text-slate-400">{item.evidence}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
                      <TrendingUp className="w-4 h-4" />
                      <span>(4) Growth Opportunities &amp; Upcoming Catalysts</span>
                    </div>
                    {a9?.growthOpportunities && a9.growthOpportunities.length > 0 && (
                      <ul className="list-disc pl-4 space-y-1 text-xs text-slate-700 dark:text-slate-300">
                        {a9.growthOpportunities.map((g, i) => (
                          <li key={i}>{g}</li>
                        ))}
                      </ul>
                    )}
                    {data.catalysts.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          Catalyst Timeline
                        </div>
                        {data.catalysts.map((c, idx) => (
                          <div key={idx} className="flex items-start justify-between gap-3">
                            <span className="text-slate-700 dark:text-slate-200">{c.headline}</span>
                            <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400 shrink-0">
                              {c.timeframe}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {data.macroLinkage && (
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs space-y-1">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <Landmark className="w-3.5 h-3.5 text-slate-400" />
                          <span>NRB Policy, Rates &amp; Global Macro Sensitivity</span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                          {data.macroLinkage}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {subTab === 'financials' && (
              <div className="space-y-5 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                  {metricCells.map((m) => (
                    <div
                      key={m.label}
                      className="border border-slate-200 dark:border-slate-800 rounded-md p-2.5 bg-slate-50/70 dark:bg-slate-950/60"
                    >
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {m.label}
                      </div>
                      <div
                        className={`mt-0.5 font-mono font-semibold text-xs break-words ${
                          m.value === 'Unavailable'
                            ? 'text-slate-400 dark:text-slate-500 italic'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {m.value}
                      </div>
                    </div>
                  ))}
                </div>

                {pc && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Quarter-over-Quarter (QoQ)
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{pc.qoq}</p>
                    </div>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Year-over-Year Corresponding Quarter (YoY)
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{pc.yoy}</p>
                    </div>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Annual Report Comparison
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{pc.annual}</p>
                    </div>
                  </div>
                )}

                {a9 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-1.5">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        (5) Financial Trend Analysis &amp; Report Consistency
                      </h4>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                        {a9.financialTrendAnalysis}
                      </p>
                      {pc?.inconsistencies && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 pt-1">
                          Quarterly vs Annual Consistency: {pc.inconsistencies}
                        </p>
                      )}
                    </div>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-1.5">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        (6) Valuation Assessment
                      </h4>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                        {a9.valuationAssessment}
                      </p>
                    </div>
                  </div>
                )}

                {pc?.factsVsInterpretation && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2">
                      <h4 className="font-semibold text-emerald-700 dark:text-emerald-400">
                        Strictly Reported Facts (Cited Periods)
                      </h4>
                      <ul className="list-disc pl-4 space-y-1 text-slate-700 dark:text-slate-300">
                        {pc.factsVsInterpretation.facts.length > 0 ? (
                          pc.factsVsInterpretation.facts.map((f, i) => <li key={i}>{f}</li>)
                        ) : (
                          <li className="italic text-slate-400">No verified external figures extracted.</li>
                        )}
                      </ul>
                    </div>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2">
                      <h4 className="font-semibold text-blue-700 dark:text-blue-400">
                        AI Interpretations &amp; Assumptions
                      </h4>
                      <ul className="list-disc pl-4 space-y-1 text-slate-700 dark:text-slate-300">
                        {pc.factsVsInterpretation.interpretations.length > 0 ? (
                          pc.factsVsInterpretation.interpretations.map((f, i) => <li key={i}>{f}</li>)
                        ) : (
                          <li className="italic text-slate-400">None provided.</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {subTab === 'risks' && (
              <div className="space-y-5 text-xs">
                {(data.fundamentalRedFlags.length > 0 || data.governanceRegulatoryFlags.length > 0) && (
                  <div className="p-4 rounded-md border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/25 space-y-2">
                    <div className="font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4" />
                      <span>Confirmed Financial, Governance &amp; Regulatory Red Flags</span>
                    </div>
                    <ul className="list-disc pl-5 space-y-1 text-red-800 dark:text-red-200">
                      {[...data.fundamentalRedFlags, ...data.governanceRegulatoryFlags].map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                    <h4 className="font-semibold text-red-700 dark:text-red-400">
                      (3) Major Risks &amp; Warning Signs
                    </h4>
                    {a9?.majorRisksRedFlags && a9.majorRisksRedFlags.length > 0 && (
                      <ul className="list-disc pl-4 space-y-1 text-slate-700 dark:text-slate-300">
                        {a9.majorRisksRedFlags.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                      {data.risks.map((item, idx) => (
                        <li key={idx} className="py-2 first:pt-0 last:pb-0 space-y-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {item.title}
                            </span>
                            <span className="font-mono text-[11px] text-red-600 dark:text-red-400 shrink-0">
                              {item.impact}
                            </span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                            {item.detail}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2.5">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        Risk Score Breakdown ({data.riskScore}/100)
                      </h4>
                      {data.riskBreakdown.map((item, idx) => (
                        <div key={idx} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              {item.factor}{' '}
                              <span className="text-[10px] font-mono text-slate-400">[{item.sourceType}]</span>
                            </span>
                            <span className="font-mono font-semibold text-red-600 dark:text-red-400">
                              {item.score}/{item.maxScore}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.evidence}</p>
                        </div>
                      ))}
                    </div>

                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2.5">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        Opportunity Score Breakdown ({data.opportunityScore}/100)
                      </h4>
                      {data.opportunityBreakdown.map((item, idx) => (
                        <div key={idx} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              {item.factor}{' '}
                              <span className="text-[10px] font-mono text-slate-400">[{item.sourceType}]</span>
                            </span>
                            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                              {item.score}/{item.maxScore}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.evidence}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {subTab === 'scenarios' && (
              <div className="space-y-5 text-xs">
                {a9 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/15 rounded-md p-4 space-y-1.5">
                      <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                        (7a) Bull Scenario
                      </div>
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{a9.scenarios.bull}</p>
                    </div>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-1.5">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        (7b) Base Scenario
                      </div>
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{a9.scenarios.base}</p>
                    </div>
                    <div className="border border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/15 rounded-md p-4 space-y-1.5">
                      <div className="font-semibold text-red-700 dark:text-red-400">
                        (7c) Bear Scenario
                      </div>
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{a9.scenarios.bear}</p>
                    </div>
                  </div>
                )}

                {oc && (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2 bg-slate-50 dark:bg-slate-950">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        Equity vs Nepal Fixed-Income Opportunity-Cost Test (FD / T-Bills / Gov Bonds)
                      </h4>
                      <span
                        className={`font-mono font-semibold ${
                          oc.beatsFixedIncome === true
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : oc.beatsFixedIncome === false
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-slate-500'
                        }`}
                      >
                        {oc.beatsFixedIncome === true
                          ? 'Risk-Adjusted Premium Over FD'
                          : oc.beatsFixedIncome === false
                            ? 'Does Not Compensate Over Safer FD/Bonds'
                            : 'Benchmark Comparison Pending'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                      <div>Commercial Bank FD: {oc.benchmarkFdRateText}</div>
                      <div>T-Bills: {oc.benchmarkTBillText}</div>
                      <div>Gov Bond Yield: {oc.benchmarkBondYieldText}</div>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                      {oc.expectedReturnThesis}
                    </p>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{oc.verdict}</p>
                  </div>
                )}

                {a9 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        (8) Key Metrics to Monitor Next Quarter
                      </h4>
                      <ul className="list-disc pl-4 space-y-1 text-slate-700 dark:text-slate-300">
                        {a9.nextQuarterWatchlist.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                        (9) Overall Investment Outlook ({data.recommendation})
                      </h4>
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                        {a9.overallOutlook}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {data.sources.length > 0 && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Verified Source Documents &amp; Grounding Links
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                  {data.sources.slice(0, 10).map((src, i) => (
                    <a
                      key={i}
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline max-w-xs truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      {src.category && (
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">
                          [{src.category}]
                        </span>
                      )}
                      <span className="truncate">{src.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      ) : null}
    </section>
  );
};
