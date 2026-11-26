import React, { useMemo, useState } from 'react';
import type { DailyAggregate, PriceRow, RangeSummaryRow } from '../types/market';
import { CRORE, formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

// ---------------------------------------------------------------- Color helpers
function interpolateColor(pct: number, limit = 5): string {
  const clamped = Math.max(-limit, Math.min(limit, pct));
  const t = clamped / limit; // -1 to 1
  if (t >= 0) {
    // neutral #475569 -> emerald #15803d
    const r = Math.round(71 + (21 - 71) * t);
    const g = Math.round(85 + (128 - 85) * t);
    const b = Math.round(105 + (61 - 105) * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const k = -t;
    // neutral #475569 -> crimson #b91c1c
    const r = Math.round(71 + (185 - 71) * k);
    const g = Math.round(85 + (28 - 85) * k);
    const b = Math.round(105 + (28 - 105) * k);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

// ---------------------------------------------------------------- 1. Squarified Treemap
interface TreemapNode {
  symbol: string;
  name: string;
  turnover: number;
  diffPct: number;
  close: number;
}

interface LayoutRect extends TreemapNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarifyLayout(nodes: TreemapNode[], width: number, height: number): LayoutRect[] {
  const valid = nodes.filter((n) => n.turnover > 0);
  if (valid.length === 0) return [];
  const total = valid.reduce((s, n) => s + n.turnover, 0);
  const scale = (width * height) / total;
  const items = valid
    .map((n) => ({ ...n, area: n.turnover * scale }))
    .sort((a, b) => b.area - a.area);

  const rects: LayoutRect[] = [];

  function worstAspect(row: Array<TreemapNode & { area: number }>, side: number): number {
    if (row.length === 0 || side <= 0) return Infinity;
    const sum = row.reduce((s, r) => s + r.area, 0);
    const maxA = Math.max(...row.map((r) => r.area));
    const minA = Math.min(...row.map((r) => r.area));
    const s2 = side * side;
    return Math.max((s2 * maxA) / (sum * sum), (sum * sum) / (s2 * minA));
  }

  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let idx = 0;

  while (idx < items.length) {
    const horizontal = w >= h;
    const side = horizontal ? h : w;
    const row: Array<TreemapNode & { area: number }> = [items[idx]];
    idx++;

    while (idx < items.length) {
      const candidate = [...row, items[idx]];
      if (worstAspect(candidate, side) <= worstAspect(row, side)) {
        row.push(items[idx]);
        idx++;
      } else {
        break;
      }
    }

    const rowSum = row.reduce((s, r) => s + r.area, 0);
    const thickness = side > 0 ? rowSum / side : 0;

    let offset = 0;
    for (const item of row) {
      const len = thickness > 0 ? item.area / thickness : 0;
      if (horizontal) {
        rects.push({ ...item, x, y: y + offset, w: thickness, h: len });
      } else {
        rects.push({ ...item, x: x + offset, y, w: len, h: thickness });
      }
      offset += len;
    }

    if (horizontal) {
      x += thickness;
      w = Math.max(0, w - thickness);
    } else {
      y += thickness;
      h = Math.max(0, h - thickness);
    }
  }

  return rects;
}

export const TurnoverTreemap: React.FC<{
  rows: PriceRow[];
  onSelectSymbol?: (symbol: string) => void;
}> = ({ rows, onSelectSymbol }) => {
  const [hovered, setHovered] = useState<LayoutRect | null>(null);
  const W = 760;
  const H = 430;

  const rects = useMemo(() => {
    const top = [...rows]
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, 60)
      .map((r) => ({
        symbol: r.symbol,
        name: r.name,
        turnover: r.turnover,
        diffPct: r.diff_pct ?? 0,
        close: r.close,
      }));
    return squarifyLayout(top, W, H);
  }, [rows]);

  if (rects.length === 0) {
    return (
      <div className="h-[430px] flex items-center justify-center text-sm text-slate-400">
        No turnover data to display.
      </div>
    );
  }

  return (
    <div className="relative select-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-md overflow-hidden bg-slate-900">
        {rects.map((r) => {
          const pad = 1.2;
          const rw = Math.max(0, r.w - pad * 2);
          const rh = Math.max(0, r.h - pad * 2);
          const showSymbol = rw >= 38 && rh >= 22;
          const showPct = rw >= 48 && rh >= 36;
          return (
            <g
              key={r.symbol}
              onMouseEnter={() => setHovered(r)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelectSymbol?.(r.symbol)}
              className={onSelectSymbol ? 'cursor-pointer' : undefined}
            >
              <rect
                x={r.x + pad}
                y={r.y + pad}
                width={rw}
                height={rh}
                rx={3}
                fill={interpolateColor(r.diffPct, 5)}
                stroke={hovered?.symbol === r.symbol ? '#ffffff' : 'rgba(15,23,42,0.45)'}
                strokeWidth={hovered?.symbol === r.symbol ? 1.8 : 0.8}
              />
              {showSymbol && (
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h / 2 - (showPct ? 4 : -4)}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={rw > 85 ? 12 : 10}
                  fontWeight={600}
                  fontFamily="Plus Jakarta Sans, sans-serif"
                >
                  {r.symbol}
                </text>
              )}
              {showPct && (
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h / 2 + 12}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.9)"
                  fontSize={10}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {formatPct(r.diffPct)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-md bg-slate-100 dark:bg-slate-800/80 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{hovered.symbol}</span>
            {hovered.name && (
              <span className="text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                {hovered.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 font-mono tabular-nums">
            <span>Close: Rs {formatNum(hovered.close)}</span>
            <span
              className={
                hovered.diffPct >= 0
                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                  : 'text-red-600 dark:text-red-400 font-medium'
              }
            >
              {formatPct(hovered.diffPct)}
            </span>
            <span className="text-slate-700 dark:text-slate-200 font-medium">
              Rs {formatCrore(hovered.turnover)} cr
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- 2. Horizontal Turnover Bar Chart
export const HorizontalTurnoverBar: React.FC<{
  items: Array<{ symbol: string; turnover: number; pct: number }>;
  onSelectSymbol?: (symbol: string) => void;
}> = ({ items, onSelectSymbol }) => {
  const maxTurn = Math.max(...items.map((i) => i.turnover), 1);

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const widthPct = Math.max(2, (item.turnover / maxTurn) * 100);
        const up = item.pct >= 0;
        return (
          <div
            key={item.symbol}
            onClick={() => onSelectSymbol?.(item.symbol)}
            className={`group flex items-center gap-3 text-xs ${
              onSelectSymbol ? 'cursor-pointer' : ''
            }`}
          >
            <span className="w-16 font-semibold text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {item.symbol}
            </span>
            <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-800/70 rounded overflow-hidden">
              <div
                className={`h-full rounded transition-all duration-200 ${
                  up ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-red-600 dark:bg-red-500'
                }`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="w-16 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {formatCrore(item.turnover, 1)} cr
            </span>
            <span
              className={`w-14 text-right font-mono tabular-nums ${
                up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {formatPct(item.pct)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------- 3. Market History (Turnover & Breadth)
export const MarketHistoryCharts: React.FC<{ daily: DailyAggregate[] }> = ({ daily }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 560;
  const H = 220;
  const padL = 48;
  const padR = 14;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxTurnCr = Math.max(...daily.map((d) => d.turnover / CRORE), 1);
  const maxBreadth = Math.max(
    ...daily.flatMap((d) => [d.advancers, d.decliners]),
    10
  );

  const active = hoverIdx !== null && daily[hoverIdx] ? daily[hoverIdx] : daily[daily.length - 1];

  const xPos = (i: number) =>
    daily.length <= 1 ? padL + innerW / 2 : padL + (i / (daily.length - 1)) * innerW;

  const advPoints = daily
    .map((d, i) => `${xPos(i)},${padT + innerH - (d.advancers / maxBreadth) * innerH}`)
    .join(' ');
  const decPoints = daily
    .map((d, i) => `${xPos(i)},${padT + innerH - (d.decliners / maxBreadth) * innerH}`)
    .join(' ');

  const barW = Math.max(2, Math.min(18, innerW / Math.max(daily.length, 1) - 2));

  return (
    <div className="space-y-3">
      {active && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300 px-1">
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{active.date}</span>
          <div className="flex items-center gap-4 font-mono tabular-nums">
            <span>Turnover: Rs {formatCrore(active.turnover, 1)} cr</span>
            <span className="text-emerald-600 dark:text-emerald-400">Adv: {active.advancers}</span>
            <span className="text-red-600 dark:text-red-400">Dec: {active.decliners}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Daily Turnover (Rs crore)
          </h4>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const y = padT + innerH * (1 - t);
              return (
                <g key={t}>
                  <line
                    x1={padL}
                    x2={W - padR}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeDasharray="2 3"
                  />
                  <text
                    x={padL - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={10}
                    className="fill-slate-400 font-mono"
                  >
                    {(maxTurnCr * t).toFixed(0)}
                  </text>
                </g>
              );
            })}
            {daily.map((d, i) => {
              const val = d.turnover / CRORE;
              const bh = (val / maxTurnCr) * innerH;
              const cx = xPos(i);
              return (
                <rect
                  key={d.date}
                  x={cx - barW / 2}
                  y={padT + innerH - bh}
                  width={barW}
                  height={Math.max(1, bh)}
                  rx={1.5}
                  className={
                    hoverIdx === i
                      ? 'fill-blue-500'
                      : 'fill-blue-600/80 dark:fill-blue-500/75'
                  }
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              );
            })}
            {daily.length >= 2 && (
              <>
                <text x={padL} y={H - 8} fontSize={10} className="fill-slate-400 font-mono">
                  {daily[0].date}
                </text>
                <text
                  x={W - padR}
                  y={H - 8}
                  textAnchor="end"
                  fontSize={10}
                  className="fill-slate-400 font-mono"
                >
                  {daily[daily.length - 1].date}
                </text>
              </>
            )}
          </svg>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Market Breadth (Advancers vs Decliners)
            </h4>
            <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">Advancers</span>
              <span className="text-red-600 dark:text-red-400 font-medium">Decliners</span>
            </div>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const y = padT + innerH * (1 - t);
              return (
                <g key={t}>
                  <line
                    x1={padL}
                    x2={W - padR}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeDasharray="2 3"
                  />
                  <text
                    x={padL - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={10}
                    className="fill-slate-400 font-mono"
                  >
                    {Math.round(maxBreadth * t)}
                  </text>
                </g>
              );
            })}
            <polyline
              fill="none"
              stroke="#16a34a"
              strokeWidth={2}
              points={advPoints}
            />
            <polyline
              fill="none"
              stroke="#dc2626"
              strokeWidth={2}
              points={decPoints}
            />
            {daily.map((d, i) => (
              <rect
                key={d.date}
                x={xPos(i) - Math.max(4, innerW / daily.length / 2)}
                y={padT}
                width={Math.max(8, innerW / Math.max(daily.length, 1))}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            ))}
            {daily.length >= 2 && (
              <>
                <text x={padL} y={H - 8} fontSize={10} className="fill-slate-400 font-mono">
                  {daily[0].date}
                </text>
                <text
                  x={W - padR}
                  y={H - 8}
                  textAnchor="end"
                  fontSize={10}
                  className="fill-slate-400 font-mono"
                >
                  {daily[daily.length - 1].date}
                </text>
              </>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- 4. Weekly Heatmap
export const WeeklyHeatmapChart: React.FC<{
  weeks: Array<{ label: string; map: Record<string, number> }>;
  symbols: string[];
}> = ({ weeks, symbols }) => {
  const maxTurn = useMemo(() => {
    let m = 1;
    for (const w of weeks) {
      for (const s of symbols) {
        if ((w.map[s] || 0) > m) m = w.map[s];
      }
    }
    return m;
  }, [weeks, symbols]);

  if (weeks.length === 0 || symbols.length === 0) return null;

  return (
    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="text-left py-2 pr-3 font-medium text-slate-500 dark:text-slate-400">
              Symbol
            </th>
            {weeks.map((w) => (
              <th
                key={w.label}
                className="text-right px-2 py-2 font-mono font-normal text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap"
              >
                {w.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
          {symbols.map((sym) => (
            <tr key={sym}>
              <td className="py-1.5 pr-3 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                {sym}
              </td>
              {weeks.map((w) => {
                const val = w.map[sym] || 0;
                const intensity = val > 0 ? Math.max(0.08, Math.min(1, val / maxTurn)) : 0;
                return (
                  <td
                    key={w.label}
                    className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap rounded-sm"
                    style={{
                      backgroundColor:
                        intensity > 0
                          ? `rgba(37, 99, 235, ${(intensity * 0.85).toFixed(2)})`
                          : 'transparent',
                      color: intensity > 0.48 ? '#ffffff' : undefined,
                    }}
                  >
                    {val > 0 ? formatCrore(val, 1) : '–'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------- 5. Turnover vs Price Change Scatter
export const TurnoverScatterChart: React.FC<{
  all: RangeSummaryRow[];
  up: RangeSummaryRow[];
  down: RangeSummaryRow[];
}> = ({ all, up, down }) => {
  const [hovered, setHovered] = useState<RangeSummaryRow | null>(null);
  const W = 900;
  const H = 380;
  const padL = 62;
  const padR = 24;
  const padT = 22;
  const padB = 38;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const upSet = useMemo(() => new Set(up.map((r) => r.symbol)), [up]);
  const downSet = useMemo(() => new Set(down.map((r) => r.symbol)), [down]);
  const topLabels = useMemo(() => {
    const uTop = up.slice(0, 8).map((r) => r.symbol);
    const dTop = down.slice(0, 8).map((r) => r.symbol);
    return new Set([...uTop, ...dTop]);
  }, [up, down]);

  const valid = all.filter((r) => r.turnover > 0 && r.change_pct !== null);
  const minX = Math.min(-5, ...valid.map((r) => r.change_pct ?? 0));
  const maxX = Math.max(5, ...valid.map((r) => r.change_pct ?? 0));
  const logs = valid.map((r) => Math.log10(Math.max(r.turnover / CRORE, 0.01)));
  const minY = Math.min(-1, ...logs);
  const maxY = Math.max(1.5, ...logs);

  const mapX = (chg: number) => padL + ((chg - minX) / (maxX - minX || 1)) * innerW;
  const mapY = (turn: number) => {
    const ly = Math.log10(Math.max(turn / CRORE, 0.01));
    return padT + innerH - ((ly - minY) / (maxY - minY || 1)) * innerH;
  };

  const zeroX = mapX(0);

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
        <div className="flex items-center gap-4">
          <span className="font-medium text-emerald-600 dark:text-emerald-400">
            High turnover + Price UP ({up.length})
          </span>
          <span className="font-medium text-red-600 dark:text-red-400">
            High turnover + Price DOWN ({down.length})
          </span>
          <span className="text-slate-400">Other equities</span>
        </div>
        {hovered && (
          <div className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
            <span className="font-semibold">{hovered.symbol}</span> · {formatPct(hovered.change_pct)} · Rs{' '}
            {formatCrore(hovered.turnover)} cr
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        <line
          x1={zeroX}
          x2={zeroX}
          y1={padT}
          y2={padT + innerH}
          stroke="currentColor"
          className="text-slate-300 dark:text-slate-700"
          strokeDasharray="3 3"
        />
        {[-1, 0, 1, 2, 3].map((pow) => {
          if (pow < minY - 0.2 || pow > maxY + 0.2) return null;
          const y = padT + innerH - ((pow - minY) / (maxY - minY || 1)) * innerH;
          return (
            <g key={pow}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-slate-100 dark:text-slate-800"
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                className="fill-slate-400 font-mono"
              >
                {Math.pow(10, pow)} cr
              </text>
            </g>
          );
        })}

        {valid.map((r) => {
          const isUp = upSet.has(r.symbol);
          const isDown = downSet.has(r.symbol);
          const cx = mapX(r.change_pct ?? 0);
          const cy = mapY(r.turnover);
          const color = isUp ? '#16a34a' : isDown ? '#dc2626' : '#94a3b8';
          const radius = isUp || isDown ? 5.5 : 3;
          return (
            <g
              key={r.symbol}
              onMouseEnter={() => setHovered(r)}
              onMouseLeave={() => setHovered(null)}
            >
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={color}
                fillOpacity={isUp || isDown ? 0.9 : 0.35}
                stroke={isUp || isDown ? '#ffffff' : 'none'}
                strokeWidth={1}
              />
              {topLabels.has(r.symbol) && (
                <text
                  x={cx}
                  y={cy - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  className="fill-slate-700 dark:fill-slate-200 pointer-events-none"
                >
                  {r.symbol}
                </text>
              )}
            </g>
          );
        })}

        <text
          x={padL + innerW / 2}
          y={H - 8}
          textAnchor="middle"
          fontSize={11}
          className="fill-slate-500"
        >
          Price change % (from pre-period close)
        </text>
      </svg>
    </div>
  );
};

// ---------------------------------------------------------------- 6. Candlestick + Volume Technical Chart
export interface HorizontalLevel {
  label: string;
  value: number;
  color?: string;
}

export const CandlestickVolumeChart: React.FC<{
  history: PriceRow[];
  levels?: HorizontalLevel[];
  zone?: { low: number; high: number } | null;
  marker?: { date: string; label: string } | null;
}> = ({ history, levels = [], zone, marker }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 960;
  const priceH = 290;
  const volH = 95;
  const gap = 16;
  const padL = 62;
  const padR = 24;
  const padT = 20;
  const padB = 26;
  const totalH = padT + priceH + gap + volH + padB;
  const innerW = W - padL - padR;

  const { minP, maxP, maxVol, volAvg20 } = useMemo(() => {
    if (history.length === 0) {
      return { minP: 0, maxP: 100, maxVol: 1, volAvg20: [] as number[] };
    }
    const vals: number[] = [];
    for (const r of history) {
      vals.push(r.low, r.high);
      if (r.d120 && r.d120 > 0) vals.push(r.d120);
      if (r.d180 && r.d180 > 0) vals.push(r.d180);
    }
    for (const lv of levels) {
      if (Number.isFinite(lv.value)) vals.push(lv.value);
    }
    if (zone) {
      vals.push(zone.low, zone.high);
    }
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const pad = (rawMax - rawMin || rawMax * 0.05 || 1) * 0.06;
    const mv = Math.max(...history.map((r) => r.volume), 1);
    const vAvg = history.map((_, idx) => {
      const start = Math.max(0, idx - 19);
      const slice = history.slice(start, idx + 1);
      return slice.reduce((s, r) => s + r.volume, 0) / slice.length;
    });
    return { minP: rawMin - pad, maxP: rawMax + pad, maxVol: mv, volAvg20: vAvg };
  }, [history, levels, zone]);

  if (history.length === 0) {
    return (
      <div className="h-[360px] flex items-center justify-center text-sm text-slate-400">
        No price history available for chart.
      </div>
    );
  }

  const step = innerW / Math.max(history.length, 1);
  const candleW = Math.max(2, Math.min(11, step * 0.65));
  const xCenter = (i: number) => padL + step * i + step / 2;
  const yPrice = (p: number) => padT + priceH - ((p - minP) / (maxP - minP || 1)) * priceH;
  const volTop = padT + priceH + gap;
  const yVol = (v: number) => volTop + volH - (v / maxVol) * volH;

  const active =
    hoverIdx !== null && history[hoverIdx] ? history[hoverIdx] : history[history.length - 1];

  const ma120Pts = history
    .map((r, i) => (r.d120 && r.d120 > 0 ? `${xCenter(i)},${yPrice(r.d120)}` : null))
    .filter(Boolean)
    .join(' ');
  const ma180Pts = history
    .map((r, i) => (r.d180 && r.d180 > 0 ? `${xCenter(i)},${yPrice(r.d180)}` : null))
    .filter(Boolean)
    .join(' ');
  const vAvgPts = volAvg20
    .map((v, i) => `${xCenter(i)},${yVol(v)}`)
    .join(' ');

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2 text-xs">
        <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{active.date}</span>
          <span>O {formatNum(active.open)}</span>
          <span>H {formatNum(active.high)}</span>
          <span>L {formatNum(active.low)}</span>
          <span
            className={
              active.close >= active.prev_close
                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                : 'text-red-600 dark:text-red-400 font-semibold'
            }
          >
            C {formatNum(active.close)} ({formatPct(active.diff_pct)})
          </span>
          <span>Vol {formatInt(active.volume)}</span>
          <span>Turn Rs {formatCrore(active.turnover)} cr</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          {ma120Pts && <span className="text-blue-600 dark:text-blue-400 font-medium">MA120</span>}
          {ma180Pts && <span className="text-violet-600 dark:text-violet-400 font-medium">MA180</span>}
          <span className="text-amber-600 dark:text-amber-400 font-medium">Vol Avg(20)</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${totalH}`} className="w-full h-auto select-none">
        {/* Price grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const val = minP + (maxP - minP) * t;
          const y = yPrice(val);
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-slate-100 dark:text-slate-800"
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                className="fill-slate-400 font-mono"
              >
                {val.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Consolidation base zone */}
        {zone && (
          <rect
            x={padL}
            y={yPrice(zone.high)}
            width={innerW}
            height={Math.max(2, yPrice(zone.low) - yPrice(zone.high))}
            fill="#2563eb"
            fillOpacity={0.09}
          />
        )}

        {/* Horizontal support / resistance / 52w levels */}
        {levels.map((lv) => {
          const y = yPrice(lv.value);
          return (
            <g key={lv.label}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y}
                y2={y}
                stroke={lv.color ?? '#d97706'}
                strokeDasharray="4 4"
                strokeWidth={1.2}
              />
              <text
                x={padL + 6}
                y={y - 4}
                fontSize={10}
                fontWeight={500}
                fill={lv.color ?? '#d97706'}
                className="font-mono"
              >
                {lv.label} {formatNum(lv.value, 1)}
              </text>
            </g>
          );
        })}

        {/* Moving averages */}
        {ma120Pts && <polyline fill="none" stroke="#3b82f6" strokeWidth={1.3} points={ma120Pts} />}
        {ma180Pts && <polyline fill="none" stroke="#8b5cf6" strokeWidth={1.3} points={ma180Pts} />}

        {/* Candlesticks + Volume bars */}
        {history.map((r, i) => {
          const cx = xCenter(i);
          const isUp = r.close >= r.prev_close;
          const color = isUp ? '#16a34a' : '#dc2626';
          const bodyTop = yPrice(Math.max(r.open, r.close));
          const bodyBot = yPrice(Math.min(r.open, r.close));
          const bodyH = Math.max(1.5, bodyBot - bodyTop);
          const vTop = yVol(r.volume);
          const vH = volTop + volH - vTop;
          const isMarked = marker && marker.date === r.date;

          return (
            <g key={r.date}>
              {hoverIdx === i && (
                <line
                  x1={cx}
                  x2={cx}
                  y1={padT}
                  y2={volTop + volH}
                  stroke="currentColor"
                  className="text-slate-300 dark:text-slate-700"
                  strokeDasharray="2 2"
                />
              )}
              <line x1={cx} x2={cx} y1={yPrice(r.high)} y2={yPrice(r.low)} stroke={color} strokeWidth={1.1} />
              <rect
                x={cx - candleW / 2}
                y={bodyTop}
                width={candleW}
                height={bodyH}
                fill={color}
                rx={0.5}
              />
              <rect
                x={cx - candleW / 2}
                y={vTop}
                width={candleW}
                height={Math.max(1, vH)}
                fill={color}
                fillOpacity={0.78}
                rx={0.5}
              />
              {isMarked && (
                <g>
                  <polygon
                    points={`${cx},${yPrice(r.high) - 5} ${cx - 5},${yPrice(r.high) - 13} ${cx + 5},${yPrice(r.high) - 13}`}
                    fill="#d97706"
                  />
                  <text
                    x={cx}
                    y={yPrice(r.high) - 16}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill="#d97706"
                  >
                    {marker.label}
                  </text>
                </g>
              )}
              <rect
                x={padL + step * i}
                y={padT}
                width={step}
                height={priceH + gap + volH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            </g>
          );
        })}

        {/* 20-day Volume Avg */}
        {history.length >= 2 && (
          <polyline
            fill="none"
            stroke="#f59e0b"
            strokeWidth={1.2}
            strokeDasharray="3 3"
            points={vAvgPts}
          />
        )}

        {/* X axis date ticks */}
        {history.length >= 2 && (
          <>
            <text x={padL} y={totalH - 6} fontSize={10} className="fill-slate-400 font-mono">
              {history[0].date}
            </text>
            {history.length >= 6 && (
              <text
                x={padL + innerW / 2}
                y={totalH - 6}
                textAnchor="middle"
                fontSize={10}
                className="fill-slate-400 font-mono"
              >
                {history[Math.floor(history.length / 2)].date}
              </text>
            )}
            <text
              x={W - padR}
              y={totalH - 6}
              textAnchor="end"
              fontSize={10}
              className="fill-slate-400 font-mono"
            >
              {history[history.length - 1].date}
            </text>
          </>
        )}
      </svg>
    </div>
  );
};
