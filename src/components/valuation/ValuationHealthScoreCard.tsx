import React, { useState } from 'react';
import { ShieldCheck, TrendingUp, Scale, CheckCircle2, AlertTriangle, Activity } from 'lucide-react';
import type {
  HealthSignalStatus,
  IndustryAverageMetrics,
  ValuationHealthScore,
} from '../../types/fundamental';

interface ValuationHealthScoreCardProps {
  symbol: string;
  health: ValuationHealthScore;
  industryAverages: IndustryAverageMetrics;
}

function bandColors(band: ValuationHealthScore['band']): {
  stroke: string;
  text: string;
  surface: string;
  bar: string;
} {
  switch (band) {
    case 'Fortress Value':
      return {
        stroke: 'stroke-emerald-600 dark:stroke-emerald-400',
        text: 'text-emerald-700 dark:text-emerald-300',
        surface: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900',
        bar: 'bg-emerald-600 dark:bg-emerald-500',
      };
    case 'Healthy Compounder':
      return {
        stroke: 'stroke-blue-600 dark:stroke-blue-400',
        text: 'text-blue-700 dark:text-blue-300',
        surface: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900',
        bar: 'bg-blue-600 dark:bg-blue-500',
      };
    case 'Balanced / Watch':
      return {
        stroke: 'stroke-amber-600 dark:stroke-amber-400',
        text: 'text-amber-700 dark:text-amber-300',
        surface: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900',
        bar: 'bg-amber-600 dark:bg-amber-500',
      };
    default:
      return {
        stroke: 'stroke-red-600 dark:stroke-red-400',
        text: 'text-red-700 dark:text-red-300',
        surface: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900',
        bar: 'bg-red-600 dark:bg-red-500',
      };
  }
}

function statusMeta(status: HealthSignalStatus): {
  text: string;
  bar: string;
  labelClass: string;
} {
  switch (status) {
    case 'Strong':
      return {
        text: 'text-emerald-700 dark:text-emerald-300',
        bar: 'bg-emerald-600 dark:bg-emerald-500',
        labelClass:
          'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
      };
    case 'Solid':
      return {
        text: 'text-blue-700 dark:text-blue-300',
        bar: 'bg-blue-600 dark:bg-blue-500',
        labelClass:
          'border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300',
      };
    case 'Watch':
      return {
        text: 'text-amber-700 dark:text-amber-300',
        bar: 'bg-amber-600 dark:bg-amber-500',
        labelClass:
          'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
      };
    case 'Fragile':
      return {
        text: 'text-red-700 dark:text-red-300',
        bar: 'bg-red-600 dark:bg-red-500',
        labelClass:
          'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300',
      };
    default:
      return {
        text: 'text-slate-500 dark:text-slate-400',
        bar: 'bg-slate-400 dark:bg-slate-600',
        labelClass:
          'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
      };
  }
}

function fmtMetricVal(val: number | null | undefined, unit: string): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const digits = unit === 'x' ? 2 : unit === 'Rs' ? 1 : 1;
  if (unit === 'Rs') return `Rs ${val.toFixed(digits)}`;
  return `${val.toFixed(digits)}${unit}`;
}

export const ValuationHealthScoreCard: React.FC<ValuationHealthScoreCardProps> = ({
  symbol,
  health,
  industryAverages,
}) => {
  const [viewMode, setViewMode] = useState<'pillars' | 'weights'>('pillars');
  const [pillarFilter, setPillarFilter] = useState<'all' | 'safety' | 'quality' | 'growth' | 'valuation'>('all');

  const colors = bandColors(health.band);
  const clampedScore = Math.max(0, Math.min(100, health.overallScore));
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clampedScore / 100) * circumference;

  const safetyMeta = statusMeta(
    health.safetyScore >= 75
      ? 'Strong'
      : health.safetyScore >= 58
        ? 'Solid'
        : health.safetyScore >= 42
          ? 'Watch'
          : 'Fragile'
  );
  const growthMeta = statusMeta(
    health.growthScore >= 75
      ? 'Strong'
      : health.growthScore >= 58
        ? 'Solid'
        : health.growthScore >= 42
          ? 'Watch'
          : 'Fragile'
  );
  const cushionMeta = statusMeta(
    health.valuationCushionScore >= 75
      ? 'Strong'
      : health.valuationCushionScore >= 58
        ? 'Solid'
        : health.valuationCushionScore >= 42
          ? 'Watch'
          : 'Fragile'
  );

  const visibleMetrics =
    pillarFilter === 'all'
      ? health.metricsBreakdown
      : health.metricsBreakdown.filter((m) => m.pillar === pillarFilter);

  const deltaIndustryHealth =
    industryAverages.healthScore !== null
      ? health.overallScore - industryAverages.healthScore
      : null;

  return (
    <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      {/* Header Strip */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Valuation Health Score &amp; Annual Safety / Growth Gauge
            </h4>
            <span className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${colors.surface} ${colors.text}`}>
              {health.band}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {health.dataBasisNote} · Industry Avg Health:{' '}
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
              {industryAverages.healthScore !== null ? `${industryAverages.healthScore.toFixed(1)}/100` : '—'}
            </span>
          </p>
        </div>

        <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5 text-[11px] shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('pillars')}
            className={`px-2.5 py-1 rounded font-medium whitespace-nowrap transition-colors ${
              viewMode === 'pillars'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            4 Weighted Pillars
          </button>
          <button
            type="button"
            onClick={() => setViewMode('weights')}
            className={`px-2.5 py-1 rounded font-medium whitespace-nowrap transition-colors ${
              viewMode === 'weights'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Metric Weights ({health.metricsBreakdown.length})
          </button>
        </div>
      </div>

      {/* Consolidated Visual Gauge + Safety / Growth / Valuation Bars */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center border-b border-slate-100 dark:border-slate-800">
        {/* Radial Consolidated Health Dial */}
        <div className="lg:col-span-4 flex items-center gap-4">
          <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96" aria-hidden="true">
              <circle
                cx="48"
                cy="48"
                r={radius}
                fill="none"
                strokeWidth="8"
                className="stroke-slate-100 dark:stroke-slate-800"
              />
              <circle
                cx="48"
                cy="48"
                r={radius}
                fill="none"
                strokeWidth="8"
                strokeLinecap="butt"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className={`${colors.stroke} transition-all duration-300`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-xl font-mono font-bold tabular-nums leading-none ${colors.text}`}>
                {health.overallScore.toFixed(0)}
              </span>
              <span className="text-[10px] font-mono text-slate-400 mt-0.5">/ 100</span>
            </div>
          </div>

          <div className="space-y-1 min-w-0">
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              {symbol} Overall Health
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
              {health.headline}
            </p>
            {deltaIndustryHealth !== null && (
              <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                vs Industry Avg:{' '}
                <span
                  className={
                    deltaIndustryHealth >= 0
                      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                      : 'text-amber-600 dark:text-amber-400 font-semibold'
                  }
                >
                  {deltaIndustryHealth >= 0 ? '+' : ''}
                  {deltaIndustryHealth.toFixed(1)} pts
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Consolidated 3-Vector Indicators: Financial Safety, Growth Potential, Valuation Cushion */}
        <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Financial Safety Indicator */}
          <div className="space-y-1.5 sm:border-l sm:border-slate-100 dark:sm:border-slate-800 sm:pl-4">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                <span>Financial Safety</span>
              </span>
              <span className={`font-mono font-bold tabular-nums ${safetyMeta.text}`}>
                {health.safetyScore.toFixed(1)}
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className={`h-full ${safetyMeta.bar}`}
                style={{ width: `${Math.max(4, Math.min(100, health.safetyScore))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>50% Weight (Reserves + Asset Quality)</span>
              <span>
                Ind {industryAverages.safetyScore !== null ? industryAverages.safetyScore.toFixed(0) : '—'}
              </span>
            </div>
          </div>

          {/* Growth Potential Indicator */}
          <div className="space-y-1.5 sm:border-l sm:border-slate-100 dark:sm:border-slate-800 sm:pl-4">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
                <span>Growth Potential</span>
              </span>
              <span className={`font-mono font-bold tabular-nums ${growthMeta.text}`}>
                {health.growthScore.toFixed(1)}
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className={`h-full ${growthMeta.bar}`}
                style={{ width: `${Math.max(4, Math.min(100, health.growthScore))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>25% Weight (EPS / Rev / Reinvest)</span>
              <span>
                Ind {industryAverages.growthScore !== null ? industryAverages.growthScore.toFixed(0) : '—'}
              </span>
            </div>
          </div>

          {/* Valuation Cushion Indicator */}
          <div className="space-y-1.5 sm:border-l sm:border-slate-100 dark:sm:border-slate-800 sm:pl-4">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                <Scale className="w-3.5 h-3.5 text-slate-400" />
                <span>Valuation Cushion</span>
              </span>
              <span className={`font-mono font-bold tabular-nums ${cushionMeta.text}`}>
                {health.valuationCushionScore.toFixed(1)}
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className={`h-full ${cushionMeta.bar}`}
                style={{ width: `${Math.max(4, Math.min(100, health.valuationCushionScore))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>25% Weight (MoS + FD Yield Spread)</span>
              <span>Cov {health.dataCoveragePct.toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Lower Detail Zone: 4 Weighted Pillars OR Itemized Metric Weights Table */}
      {viewMode === 'pillars' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-slate-800">
          {health.pillars.map((p) => {
            const meta = statusMeta(p.status);
            return (
              <div key={p.id} className="p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                    {p.label}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border whitespace-nowrap ${meta.labelClass}`}
                  >
                    {p.status === 'Strong' || p.status === 'Solid' ? (
                      <CheckCircle2 className="w-2.5 h-2.5" />
                    ) : (
                      <AlertTriangle className="w-2.5 h-2.5" />
                    )}
                    <span>{p.status}</span>
                  </span>
                </div>

                <div className="flex items-baseline justify-between font-mono tabular-nums">
                  <span className={`text-base font-bold ${meta.text}`}>
                    {p.score.toFixed(1)}
                    <span className="text-[10px] font-normal text-slate-400"> /100</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Weight {p.weightPct}%</span>
                </div>

                <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                  <div
                    className={`h-full ${meta.bar}`}
                    style={{ width: `${Math.max(4, Math.min(100, p.score))}%` }}
                  />
                </div>

                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 leading-snug">
                  {p.summary}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Weighted Annual Report sub-metrics feeding the consolidated Valuation Health Score
            </span>
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'safety', label: 'Safety' },
                  { id: 'quality', label: 'Quality' },
                  { id: 'growth', label: 'Growth' },
                  { id: 'valuation', label: 'Valuation' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPillarFilter(tab.id)}
                  className={`px-2 py-0.5 rounded border font-medium whitespace-nowrap ${
                    pillarFilter === tab.id
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 border-y border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2 text-left font-medium">Annual Report Factor</th>
                  <th className="px-3 py-2 text-right font-medium">Weight</th>
                  <th className="px-3 py-2 text-right font-medium">Weighted</th>
                  <th className="px-3 py-2 text-right font-medium">Annual Only</th>
                  <th className="px-3 py-2 text-right font-medium">Industry Avg</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleMetrics.map((m) => {
                  const meta = statusMeta(m.status);
                  return (
                    <tr key={m.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{m.label}</div>
                        <div className="text-[10px] text-slate-400">{m.note}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">
                        {m.weightPct}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {fmtMetricVal(m.companyValue, m.unit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-blue-600 dark:text-blue-400">
                        {fmtMetricVal(m.annualReportValue, m.unit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {fmtMetricVal(m.industryAverage, m.unit)}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${meta.text}`}>
                        {m.score !== null ? `${m.score.toFixed(0)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded border ${meta.labelClass}`}
                        >
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
