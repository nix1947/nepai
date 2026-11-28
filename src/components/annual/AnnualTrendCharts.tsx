import React, { useMemo, useState } from 'react';
import type { AnnualTrendPoint, SectorGroup } from '../../types/fundamental';

interface AnnualTrendChartsProps {
  symbol: string;
  sectorGroup: SectorGroup;
  trendSeries: AnnualTrendPoint[];
  selectedFy?: string;
}

interface BarSeriesConfig {
  key: string;
  label: string;
  color: string;
  unit: string;
  digits?: number;
  extract: (p: AnnualTrendPoint) => number | null;
}

function fmtVal(v: number | null | undefined, unit: string, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (unit === 'Rs') return `Rs ${v.toFixed(digits)}`;
  if (unit === 'Cr') return `Rs ${v.toFixed(digits)} Cr`;
  return `${v.toFixed(digits)}${unit}`;
}

function niceMax(values: number[], allowZeroMin = true): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 100 };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = allowZeroMin ? Math.min(0, rawMin) : rawMin;
  const max = Math.max(allowZeroMin ? 0 : rawMax, rawMax);
  if (Math.abs(max - min) < 1e-6) {
    return { min: min >= 0 ? 0 : min * 1.2, max: max === 0 ? 10 : max * 1.2 };
  }
  const pad = (max - min) * 0.14;
  return {
    min: allowZeroMin && min >= 0 ? 0 : min - pad,
    max: max + pad,
  };
}

const MultiBarCard: React.FC<{
  title: string;
  subtitle: string;
  points: AnnualTrendPoint[];
  series: BarSeriesConfig[];
  selectedFy?: string;
}> = ({ title, subtitle, points, series, selectedFy }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 540;
  const H = 220;
  const padL = 52;
  const padR = 16;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const activeSeries = useMemo(
    () => series.filter((s) => points.some((p) => s.extract(p) !== null)),
    [series, points]
  );

  const allValues = useMemo(() => {
    const out: number[] = [];
    for (const p of points) {
      for (const s of activeSeries) {
        const v = s.extract(p);
        if (v !== null && Number.isFinite(v)) out.push(v);
      }
    }
    return out;
  }, [points, activeSeries]);

  const { min, max } = useMemo(() => niceMax(allValues, true), [allValues]);
  const span = Math.max(1e-6, max - min);
  const yOf = (val: number) => padT + ((max - val) / span) * plotH;
  const zeroY = yOf(0);

  const activePoint =
    hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : points[points.length - 1] ?? null;

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        {activePoint && activeSeries.length > 0 && (
          <div className="text-right text-xs font-mono tabular-nums space-y-0.5">
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              FY {activePoint.fiscalYear}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[11px]">
              {activeSeries.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                  <span
                    className="inline-block w-2 h-2 rounded-xs shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span>{s.label}:</span>
                  <strong className="text-slate-900 dark:text-slate-100">
                    {fmtVal(s.extract(activePoint), s.unit, s.digits ?? 1)}
                  </strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {activeSeries.length === 0 || points.length === 0 ? (
        <div className="h-[190px] flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-md">
          Metric series unavailable in stored statements for this company.
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible select-none">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const val = min + (1 - t) * span;
            const y = padT + t * plotH;
            return (
              <g key={t}>
                <line
                  x1={padL}
                  y1={y}
                  x2={W - padR}
                  y2={y}
                  className="stroke-slate-200 dark:stroke-slate-800"
                  strokeDasharray={t === 1 ? undefined : '2 3'}
                  strokeWidth={1}
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono tabular-nums"
                >
                  {Math.abs(val) >= 1000
                    ? `${(val / 1000).toFixed(1)}k`
                    : Math.abs(val) >= 100
                      ? val.toFixed(0)
                      : val.toFixed(1)}
                </text>
              </g>
            );
          })}

          {min < 0 && max > 0 && (
            <line
              x1={padL}
              y1={zeroY}
              x2={W - padR}
              y2={zeroY}
              className="stroke-slate-400 dark:stroke-slate-600"
              strokeWidth={1}
            />
          )}

          {points.map((pt, idx) => {
            const groupW = plotW / Math.max(1, points.length);
            const groupLeft = padL + idx * groupW;
            const maxBarSpace = Math.min(groupW * 0.72, activeSeries.length * 34);
            const barW = Math.max(8, Math.min(28, (maxBarSpace - (activeSeries.length - 1) * 4) / activeSeries.length));
            const totalBarsW = activeSeries.length * barW + (activeSeries.length - 1) * 4;
            const startX = groupLeft + (groupW - totalBarsW) / 2;
            const isSelected = selectedFy === pt.fiscalYear;
            const isHovered = hoverIdx === idx;

            return (
              <g
                key={pt.fiscalYear}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
                className="cursor-pointer"
              >
                {(isSelected || isHovered) && (
                  <rect
                    x={groupLeft + 2}
                    y={padT}
                    width={Math.max(0, groupW - 4)}
                    height={plotH}
                    rx={4}
                    className="fill-slate-100/70 dark:fill-slate-800/40"
                  />
                )}
                {activeSeries.map((s, sIdx) => {
                  const val = s.extract(pt);
                  if (val === null || !Number.isFinite(val)) return null;
                  const yVal = yOf(val);
                  const rectY = Math.min(yVal, zeroY);
                  const rectH = Math.max(2, Math.abs(zeroY - yVal));
                  const x = startX + sIdx * (barW + 4);
                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={rectY}
                      width={barW}
                      height={rectH}
                      rx={2}
                      fill={s.color}
                      opacity={hoverIdx !== null && !isHovered ? 0.65 : 0.92}
                    />
                  );
                })}
                <text
                  x={groupLeft + groupW / 2}
                  y={H - 14}
                  textAnchor="middle"
                  className={`text-[10px] font-mono tabular-nums ${
                    isSelected
                      ? 'fill-blue-600 dark:fill-blue-400 font-semibold'
                      : 'fill-slate-500 dark:fill-slate-400'
                  }`}
                >
                  {pt.fiscalYear}
                </text>
                <text
                  x={groupLeft + groupW / 2}
                  y={H - 3}
                  textAnchor="middle"
                  className="fill-slate-400 dark:fill-slate-500 text-[9px]"
                >
                  {pt.basis === 'Audited Annual' ? 'Annual' : pt.periodLabel.split(' ')[0]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

const RatioLineCard: React.FC<{
  title: string;
  subtitle: string;
  points: AnnualTrendPoint[];
  series: BarSeriesConfig[];
  selectedFy?: string;
}> = ({ title, subtitle, points, series, selectedFy }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 540;
  const H = 220;
  const padL = 48;
  const padR = 20;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const activeSeries = useMemo(
    () => series.filter((s) => points.some((p) => s.extract(p) !== null)),
    [series, points]
  );

  const allValues = useMemo(() => {
    const out: number[] = [];
    for (const p of points) {
      for (const s of activeSeries) {
        const v = s.extract(p);
        if (v !== null && Number.isFinite(v)) out.push(v);
      }
    }
    return out;
  }, [points, activeSeries]);

  const { min, max } = useMemo(() => niceMax(allValues, true), [allValues]);
  const span = Math.max(1e-6, max - min);
  const yOf = (val: number) => padT + ((max - val) / span) * plotH;
  const xOf = (idx: number) =>
    points.length <= 1 ? padL + plotW / 2 : padL + (idx / (points.length - 1)) * plotW;

  const activePoint =
    hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : points[points.length - 1] ?? null;

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        {activePoint && activeSeries.length > 0 && (
          <div className="text-right text-xs font-mono tabular-nums space-y-0.5">
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              FY {activePoint.fiscalYear}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-[11px]">
              {activeSeries.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                  <span
                    className="inline-block w-2.5 h-0.5 shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span>{s.label}:</span>
                  <strong className="text-slate-900 dark:text-slate-100">
                    {fmtVal(s.extract(activePoint), s.unit, s.digits ?? 1)}
                  </strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {activeSeries.length === 0 || points.length === 0 ? (
        <div className="h-[190px] flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-md">
          Ratio history unavailable in stored statements.
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible select-none">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const val = min + (1 - t) * span;
            const y = padT + t * plotH;
            return (
              <g key={t}>
                <line
                  x1={padL}
                  y1={y}
                  x2={W - padR}
                  y2={y}
                  className="stroke-slate-200 dark:stroke-slate-800"
                  strokeDasharray={t === 1 ? undefined : '2 3'}
                  strokeWidth={1}
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono tabular-nums"
                >
                  {val.toFixed(1)}
                </text>
              </g>
            );
          })}

          {activeSeries.map((s) => {
            const coords = points
              .map((p, i) => {
                const v = s.extract(p);
                return v !== null && Number.isFinite(v) ? { x: xOf(i), y: yOf(v), idx: i } : null;
              })
              .filter((c): c is { x: number; y: number; idx: number } => c !== null);

            if (coords.length === 0) return null;
            const pathD = coords
              .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
              .join(' ');

            return (
              <g key={s.key}>
                {coords.length > 1 && (
                  <path
                    d={pathD}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {coords.map((c) => {
                  const isActive = hoverIdx === c.idx || selectedFy === points[c.idx].fiscalYear;
                  return (
                    <circle
                      key={c.idx}
                      cx={c.x}
                      cy={c.y}
                      r={isActive ? 5 : 3.5}
                      fill={s.color}
                      stroke="white"
                      strokeWidth={1.5}
                    />
                  );
                })}
              </g>
            );
          })}

          {points.map((pt, idx) => {
            const cx = xOf(idx);
            const sliceW = points.length <= 1 ? plotW : plotW / points.length;
            return (
              <g
                key={pt.fiscalYear}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
                className="cursor-pointer"
              >
                <rect
                  x={cx - sliceW / 2}
                  y={padT}
                  width={sliceW}
                  height={plotH}
                  fill="transparent"
                />
                <text
                  x={cx}
                  y={H - 14}
                  textAnchor="middle"
                  className={`text-[10px] font-mono tabular-nums ${
                    selectedFy === pt.fiscalYear
                      ? 'fill-blue-600 dark:fill-blue-400 font-semibold'
                      : 'fill-slate-500 dark:fill-slate-400'
                  }`}
                >
                  {pt.fiscalYear}
                </text>
                <text
                  x={cx}
                  y={H - 3}
                  textAnchor="middle"
                  className="fill-slate-400 dark:fill-slate-500 text-[9px]"
                >
                  {pt.basis === 'Audited Annual' ? 'Annual' : pt.periodLabel.split(' ')[0]}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

export const AnnualTrendCharts: React.FC<AnnualTrendChartsProps> = ({
  symbol,
  sectorGroup,
  trendSeries,
  selectedFy,
}) => {
  const [growthMode, setGrowthMode] = useState<'amount' | 'yoy'>('amount');
  const isBfi = sectorGroup === 'Banking' || sectorGroup === 'Microfinance';
  const isInsurer = sectorGroup === 'Insurance';
  const hasYoY = trendSeries.some(
    (p) => p.revenueYoYPct !== null || p.netProfitYoYPct !== null
  );

  const revenueProfitSeries: BarSeriesConfig[] =
    growthMode === 'yoy' && hasYoY
      ? [
          {
            key: 'revYoy',
            label: 'Revenue YoY',
            color: '#2563eb',
            unit: '%',
            digits: 1,
            extract: (p) => p.revenueYoYPct,
          },
          {
            key: 'npYoy',
            label: 'Net Profit YoY',
            color: '#16a34a',
            unit: '%',
            digits: 1,
            extract: (p) => p.netProfitYoYPct,
          },
        ]
      : [
          {
            key: 'rev',
            label: 'Revenue',
            color: '#2563eb',
            unit: 'Cr',
            digits: 1,
            extract: (p) => p.revenueCr,
          },
          {
            key: 'np',
            label: 'Net Profit',
            color: '#16a34a',
            unit: 'Cr',
            digits: 1,
            extract: (p) => p.netProfitCr,
          },
        ];

  const epsBvpsSeries: BarSeriesConfig[] = [
    {
      key: 'eps',
      label: 'EPS',
      color: '#2563eb',
      unit: 'Rs',
      digits: 2,
      extract: (p) => p.eps,
    },
    {
      key: 'bvps',
      label: 'BVPS',
      color: '#0f766e',
      unit: 'Rs',
      digits: 1,
      extract: (p) => p.bvps,
    },
  ];

  const balanceSheetSeries: BarSeriesConfig[] = [
    {
      key: 'assets',
      label: 'Total Assets',
      color: '#475569',
      unit: 'Cr',
      digits: 1,
      extract: (p) => p.totalAssetsCr,
    },
    {
      key: 'nw',
      label: 'Net Worth',
      color: '#2563eb',
      unit: 'Cr',
      digits: 1,
      extract: (p) => p.netWorthCr,
    },
    {
      key: 'res',
      label: 'Reserves',
      color: '#16a34a',
      unit: 'Cr',
      digits: 1,
      extract: (p) => p.reservesCr,
    },
  ];

  const positionSeries: BarSeriesConfig[] = isBfi
    ? [
        {
          key: 'dep',
          label: 'Deposits',
          color: '#2563eb',
          unit: 'Cr',
          digits: 1,
          extract: (p) => p.depositsCr,
        },
        {
          key: 'loans',
          label: 'Loans',
          color: '#0d9488',
          unit: 'Cr',
          digits: 1,
          extract: (p) => p.loansCr,
        },
      ]
    : isInsurer
      ? [
          {
            key: 'prem',
            label: 'Net Premium',
            color: '#2563eb',
            unit: 'Cr',
            digits: 1,
            extract: (p) => p.netPremiumCr,
          },
          {
            key: 'nw2',
            label: 'Net Worth',
            color: '#16a34a',
            unit: 'Cr',
            digits: 1,
            extract: (p) => p.netWorthCr,
          },
        ]
      : [
          {
            key: 'debt',
            label: 'Total Debt',
            color: '#dc2626',
            unit: 'Cr',
            digits: 1,
            extract: (p) => p.totalDebtCr,
          },
          {
            key: 'nw3',
            label: 'Net Worth',
            color: '#2563eb',
            unit: 'Cr',
            digits: 1,
            extract: (p) => p.netWorthCr,
          },
        ];

  const ratioSeries: BarSeriesConfig[] = isBfi
    ? [
        {
          key: 'roe',
          label: 'ROE %',
          color: '#2563eb',
          unit: '%',
          digits: 1,
          extract: (p) => p.roePct,
        },
        {
          key: 'car',
          label: 'CAR %',
          color: '#16a34a',
          unit: '%',
          digits: 1,
          extract: (p) => p.carPct,
        },
        {
          key: 'npl',
          label: 'NPL %',
          color: '#dc2626',
          unit: '%',
          digits: 2,
          extract: (p) => p.nplPct,
        },
        {
          key: 'margin',
          label: 'Net Margin %',
          color: '#d97706',
          unit: '%',
          digits: 1,
          extract: (p) => p.netMarginPct,
        },
      ]
    : [
        {
          key: 'roe',
          label: 'ROE %',
          color: '#2563eb',
          unit: '%',
          digits: 1,
          extract: (p) => p.roePct,
        },
        {
          key: 'margin',
          label: 'Net Margin %',
          color: '#16a34a',
          unit: '%',
          digits: 1,
          extract: (p) => p.netMarginPct,
        },
        {
          key: 'roa',
          label: 'ROA %',
          color: '#d97706',
          unit: '%',
          digits: 2,
          extract: (p) => p.roaPct,
        },
        {
          key: 'roic',
          label: 'ROIC %',
          color: '#7c3aed',
          unit: '%',
          digits: 1,
          extract: (p) => p.roicPct,
        },
      ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Multi-Year Financial &amp; Operational Visualizations
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {symbol} across {trendSeries.length} indexed fiscal year{trendSeries.length === 1 ? '' : 's'} · Hover any fiscal year column to inspect exact values
          </p>
        </div>

        {hasYoY && (
          <div className="inline-flex items-center gap-1 p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => setGrowthMode('amount')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                growthMode === 'amount'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Rs Cr Scale
            </button>
            <button
              type="button"
              onClick={() => setGrowthMode('yoy')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                growthMode === 'yoy'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              YoY Growth %
            </button>
          </div>
        )}
      </div>

      {trendSeries.length === 1 && (
        <div className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs text-slate-600 dark:text-slate-300">
          Currently showing 1 fiscal year ({trendSeries[0].fiscalYear}) on file in the vault. Multi-year trend slopes and YoY bars populate automatically as prior or upcoming annual disclosures are added.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <MultiBarCard
          title="Revenue & Net Profit Growth"
          subtitle={
            growthMode === 'yoy' && hasYoY
              ? 'Year-over-year percentage growth rate'
              : 'Top-line revenue vs bottom-line net profit (Rs Crore)'
          }
          points={trendSeries}
          series={revenueProfitSeries}
          selectedFy={selectedFy}
        />

        <RatioLineCard
          title="EPS & Book Value (BVPS) Trajectory"
          subtitle="Per-share earnings power and intrinsic book value (NPR)"
          points={trendSeries}
          series={epsBvpsSeries}
          selectedFy={selectedFy}
        />

        <MultiBarCard
          title="Net Worth, Reserves & Asset Scale"
          subtitle="Balance-sheet compounding across assets, equity, and retained reserves (Rs Crore)"
          points={trendSeries}
          series={balanceSheetSeries}
          selectedFy={selectedFy}
        />

        <MultiBarCard
          title={
            isBfi
              ? 'Banking Book & Deposit/Loan Position'
              : isInsurer
                ? 'Underwriting Scale & Net Worth Position'
                : 'Debt & Equity Capital Position'
          }
          subtitle={
            isBfi
              ? 'Core customer deposits vs loans & advances (Rs Crore)'
              : isInsurer
                ? 'Net underwriting premium vs shareholder net worth (Rs Crore)'
                : 'Total debt obligations vs shareholder net worth (Rs Crore)'
          }
          points={trendSeries}
          series={positionSeries}
          selectedFy={selectedFy}
        />
      </div>

      <RatioLineCard
        title={
          isBfi
            ? 'Profitability, Capital Adequacy & Asset Quality Ratios'
            : 'Profitability & Capital Efficiency Ratios'
        }
        subtitle={
          isBfi
            ? 'ROE %, Capital Adequacy (CAR %), NPL %, and Net Margin %'
            : 'ROE %, Net Profit Margin %, ROA %, and ROIC %'
        }
        points={trendSeries}
        series={ratioSeries}
        selectedFy={selectedFy}
      />
    </section>
  );
};
