import React, { useId } from 'react';
import type { ScreenedCompanyRow } from '../../types/fundamental';

interface SparkPoint {
  value: number;
  period: string;
}

export interface GrowthTrendSparklineProps {
  values: Array<number | null | undefined>;
  periods: string[];
  metricName: string;
  unit?: string;
  digits?: number;
  width?: number;
  height?: number;
  showArea?: boolean;
}

export const GrowthTrendSparkline: React.FC<GrowthTrendSparklineProps> = ({
  values,
  periods,
  metricName,
  unit = '',
  digits = 1,
  width = 56,
  height = 18,
  showArea = true,
}) => {
  const gradId = useId();

  const points: SparkPoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      points.push({
        value: v,
        period: periods[i] || `P${i + 1}`,
      });
    }
  }

  if (points.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0 overflow-visible"
        aria-label={`${metricName} trend unavailable`}
      >
        <title>{`${metricName}: No historical points collected`}</title>
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeDasharray="2 2"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const tooltipText = `${metricName}: ${points
    .map((p) => `${p.period} = ${p.value.toFixed(digits)}${unit}`)
    .join(' → ')}`;

  if (points.length === 1) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0 overflow-visible text-slate-400 dark:text-slate-500"
        aria-label={`${metricName} single period`}
      >
        <title>{`${tooltipText} (1 period collected)`}</title>
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeDasharray="2 2"
          strokeWidth={1}
        />
        <circle cx={width - 4} cy={height / 2} r={2.2} fill="currentColor" />
      </svg>
    );
  }

  const padX = 2.5;
  const padY = 2.5;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const minVal = Math.min(...points.map((p) => p.value));
  const maxVal = Math.max(...points.map((p) => p.value));
  const span = maxVal - minVal;

  const coords = points.map((p, idx) => {
    const x = padX + (idx / (points.length - 1)) * innerW;
    const normY = span === 0 ? 0.5 : (p.value - minVal) / span;
    const y = padY + (1 - normY) * innerH;
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
  });

  const firstVal = points[0].value;
  const lastVal = points[points.length - 1].value;
  const strokeColor =
    lastVal > firstVal
      ? '#10b981'
      : lastVal < firstVal
        ? '#ef4444'
        : '#64748b';

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPoints = `${coords[0].x},${height - 1} ${polylinePoints} ${coords[coords.length - 1].x},${height - 1}`;
  const lastCoord = coords[coords.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 overflow-visible"
      aria-label={`${metricName} trend sparkline`}
    >
      <title>{tooltipText}</title>
      {showArea && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} fill={`url(#${gradId})`} />
        </>
      )}
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polylinePoints}
      />
      <circle cx={lastCoord.x} cy={lastCoord.y} r={2.2} fill={strokeColor} />
    </svg>
  );
};

interface DeltaBadgeProps {
  prefix: 'Q' | 'Y';
  pct: number | null;
  baselineLabel: string | null;
  baselineValue: number | null;
  unit?: string;
  digits?: number;
}

const DeltaIndicator: React.FC<DeltaBadgeProps> = ({
  prefix,
  pct,
  baselineLabel,
  baselineValue,
  unit = '',
  digits = 1,
}) => {
  const baselineInfo =
    baselineLabel && baselineValue !== null
      ? `vs ${baselineLabel}: ${baselineValue.toFixed(digits)}${unit}`
      : prefix === 'Q'
        ? 'Previous quarter disclosure not yet collected'
        : 'Same quarter last year disclosure not yet collected';

  if (pct === null || !Number.isFinite(pct)) {
    return (
      <span
        title={baselineInfo}
        className="text-slate-400 dark:text-slate-500"
      >
        {prefix} —
      </span>
    );
  }

  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '·';
  const colorCls =
    pct > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : pct < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-slate-500 dark:text-slate-400';

  return (
    <span title={`${prefix === 'Q' ? 'Quarter-on-Quarter' : 'Year-over-Year'} (${baselineInfo})`} className={colorCls}>
      {prefix} {arrow}
      {pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`}
    </span>
  );
};

export interface MetricTrendCellProps {
  metricName: string;
  currentValue: number | null;
  unit?: string;
  digits?: number;
  qoqPct: number | null;
  yoyPct: number | null;
  prevPeriodLabel: string | null;
  prevValue: number | null;
  yoyPeriodLabel: string | null;
  yoyValue: number | null;
  series: Array<number | null>;
  periods: string[];
}

export const MetricTrendCell: React.FC<MetricTrendCellProps> = ({
  metricName,
  currentValue,
  unit = '',
  digits = 1,
  qoqPct,
  yoyPct,
  prevPeriodLabel,
  prevValue,
  yoyPeriodLabel,
  yoyValue,
  series,
  periods,
}) => {
  return (
    <div className="inline-flex flex-col items-end gap-0.5 min-w-[116px]">
      <div className="flex items-center justify-end gap-2 w-full">
        <GrowthTrendSparkline
          values={series}
          periods={periods}
          metricName={metricName}
          unit={unit}
          digits={digits}
          width={48}
          height={16}
        />
        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
          {currentValue !== null && Number.isFinite(currentValue)
            ? `${currentValue.toFixed(digits)}${unit}`
            : '—'}
        </span>
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[10px] font-mono tabular-nums whitespace-nowrap">
        <DeltaIndicator
          prefix="Q"
          pct={qoqPct}
          baselineLabel={prevPeriodLabel}
          baselineValue={prevValue}
          unit={unit}
          digits={digits}
        />
        <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
          ·
        </span>
        <DeltaIndicator
          prefix="Y"
          pct={yoyPct}
          baselineLabel={yoyPeriodLabel}
          baselineValue={yoyValue}
          unit={unit}
          digits={digits}
        />
      </div>
    </div>
  );
};

export interface CompositeGrowthTrendCellProps {
  row: ScreenedCompanyRow;
}

export const CompositeGrowthTrendCell: React.FC<CompositeGrowthTrendCellProps> = ({ row }) => {
  const km = row.keyMetrics;
  if (!row.hasFundamentalData) {
    return <span className="text-slate-400 text-[11px]">Pending</span>;
  }

  const lines: Array<{
    tag: string;
    series: Array<number | null>;
    unit: string;
    digits: number;
    qoq: number | null;
    yoy: number | null;
  }> = [
    {
      tag: 'OP',
      series: km.trends.operatingProfitCr ?? [],
      unit: ' Cr',
      digits: 1,
      qoq: km.operatingProfitQoqPct,
      yoy: km.operatingProfitYoyPct,
    },
    {
      tag: 'EPS',
      series: km.trends.eps,
      unit: '',
      digits: 2,
      qoq: km.epsQoqPct,
      yoy: km.epsYoyPct,
    },
    {
      tag: 'REV',
      series: km.trends.revenueCr,
      unit: ' Cr',
      digits: 1,
      qoq: km.revenueQoqPct,
      yoy: km.revenueYoyPct,
    },
    {
      tag: 'NP',
      series: km.trends.netProfitCr,
      unit: ' Cr',
      digits: 1,
      qoq: km.netProfitQoqPct,
      yoy: km.netProfitYoyPct,
    },
  ];

  return (
    <div className="inline-flex flex-col gap-0.5 min-w-[148px]">
      {lines.map((l) => {
        const primaryPct = l.yoy ?? l.qoq;
        const pctTag = l.yoy !== null ? 'YoY' : l.qoq !== null ? 'QoQ' : '';
        const pctColor =
          primaryPct === null
            ? 'text-slate-400'
            : primaryPct > 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : primaryPct < 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-500';
        return (
          <div key={l.tag} className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
            <span className="text-slate-500 dark:text-slate-400 w-6 text-left">{l.tag}</span>
            <GrowthTrendSparkline
              values={l.series}
              periods={km.trends.periods}
              metricName={l.tag}
              unit={l.unit}
              digits={l.digits}
              width={44}
              height={11}
              showArea={false}
            />
            <span className={`w-16 text-right ${pctColor}`}>
              {primaryPct !== null
                ? `${pctTag} ${primaryPct >= 0 ? '+' : ''}${primaryPct.toFixed(0)}%`
                : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
};
