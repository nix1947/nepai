import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Compass,
  Crosshair,
  Layers,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';
import type { AnalyzerScanRow } from '../../types/analyzer';
import type { ScreenedCompanyRow } from '../../types/fundamental';
import type { RangeSummaryRow } from '../../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../../utils/format';

export interface DirectionEnrichedRow {
  symbol: string;
  name: string;
  sector: string;
  row: RangeSummaryRow;
  directionGroup: 'up' | 'down' | 'base';
  inTopTurnover: boolean;
  turnover: number;
  turnoverCr: number;
  cutoffMult: number;
  marketSharePct: number;
  changePct: number;
  upDays: number;
  downDays: number;
  daysTraded: number;
  winRatePct: number;
  vwapPct: number | null;
  closePosPct: number;
  avgTradeSize: number;
  endPrice: number | null;
  vsD120Pct: number | null;
  gap52hPct: number | null;
  momentumScore: number;
  signedFlowScore: number;
  convictionScore: number;
  flowTag: string;
  isBlockWarning: boolean;
  isInstitutionalTicket: boolean;
  fundamental?: ScreenedCompanyRow;
  technical?: AnalyzerScanRow;
  fundScore: number | null;
  techScore: number | null;
  isDualConfluence: boolean;
  isQualityPullback: boolean;
  isHollowRally: boolean;
}

export function buildDirectionUniverse(
  all: RangeSummaryRow[],
  up: RangeSummaryRow[],
  down: RangeSummaryRow[],
  cutoff: number,
  fundamentals: ScreenedCompanyRow[],
  analyzerRows: AnalyzerScanRow[]
): DirectionEnrichedRow[] {
  const upMap = new Map(up.map((r) => [r.symbol.toUpperCase(), r]));
  const downMap = new Map(down.map((r) => [r.symbol.toUpperCase(), r]));
  const fundMap = new Map(fundamentals.map((f) => [f.symbol.toUpperCase(), f]));
  const techMap = new Map(analyzerRows.map((a) => [a.symbol.toUpperCase(), a]));

  const totalTurn = all.reduce((s, r) => s + (r.turnover || 0), 0);

  return all.map((r) => {
    const sym = r.symbol.toUpperCase();
    const u = upMap.get(sym);
    const d = downMap.get(sym);
    const src = u ?? d ?? r;

    const directionGroup: 'up' | 'down' | 'base' = u ? 'up' : d ? 'down' : 'base';
    const inTopTurnover = u !== undefined || d !== undefined;
    const chg = src.change_pct ?? 0;
    const days = Math.max(1, src.days_traded || 1);
    const dirDays = chg >= 0 ? src.up_days : src.down_days;
    const winRatePct = src.win_rate_pct ?? Math.round((src.up_days / days) * 1000) / 10;
    const dirCons = (dirDays / days) * 100;
    const closePosPct = src.close_pos_pct ?? 50;
    const vwapPct = src.vwap_pct ?? null;
    const avgTradeSize = src.avg_trade_size ?? (src.trans > 0 ? src.turnover / src.trans : 0);

    // Conviction Score (0-100): measures true tape control (Close position + VWAP control + directional win consistency)
    const vwapEdge = vwapPct === null ? 50 : Math.max(0, Math.min(100, 50 + vwapPct * 12));
    const directionalClose = chg >= 0 ? closePosPct : closePosPct; // High closePos = buyers in control even on red days
    const convictionRaw = directionalClose * 0.45 + vwapEdge * 0.35 + winRatePct * 0.2;
    const convictionScore = Math.round(Math.max(0, Math.min(100, convictionRaw)) * 10) / 10;

    const baseScore =
      src.momentum_score ??
      Math.round(
        Math.min(
          65,
          Math.abs(chg) * 3.2 + (dirCons * 0.25) + (cutoff > 0 ? Math.min(18, (src.turnover / cutoff) * 14) : 5)
        ) * 10
      ) / 10;

    const signedFlowScore =
      directionGroup === 'up'
        ? baseScore
        : directionGroup === 'down'
          ? -baseScore
          : chg >= 0
            ? Math.round(baseScore * 0.65 * 10) / 10
            : -Math.round(baseScore * 0.65 * 10) / 10;

    const flowTag =
      src.flow_tag ||
      (chg > 0 ? 'Moderate Buying' : chg < 0 ? 'Mild Supply' : 'Flat Churn');
    const isBlockWarning = flowTag.includes('Block');
    const isInstitutionalTicket = avgTradeSize >= 250_000 && !isBlockWarning;

    const fundamental = fundMap.get(sym);
    const technical = techMap.get(sym);
    const fundScore =
      fundamental && fundamental.hasFundamentalData ? fundamental.scores.overallScore : null;
    const techScore = technical ? technical.score : null;

    const isDualConfluence =
      directionGroup === 'up' &&
      !isBlockWarning &&
      fundScore !== null &&
      fundScore >= 55 &&
      technical !== undefined &&
      (technical.grade === 'A' || technical.grade === 'B' || technical.grade === 'C');

    const isQualityPullback =
      directionGroup === 'down' &&
      fundScore !== null &&
      fundScore >= 58 &&
      ((fundamental?.keyMetrics.marginOfSafetyPct ?? -99) > 0 ||
        fundamental?.recommendation.verdict === 'STRONG BUY' ||
        fundamental?.recommendation.verdict === 'BUY');

    const isHollowRally =
      directionGroup === 'up' &&
      (isBlockWarning || (closePosPct < 38 && (vwapPct ?? 0) < 0));

    return {
      symbol: sym,
      name: src.name || fundamental?.companyName || technical?.name || sym,
      sector: src.sector || fundamental?.sector || technical?.sector || 'Other',
      row: src,
      directionGroup,
      inTopTurnover,
      turnover: src.turnover,
      turnoverCr: src.turnover / 1e7,
      cutoffMult: cutoff > 0 ? Math.round((src.turnover / cutoff) * 100) / 100 : 1,
      marketSharePct: totalTurn > 0 ? Math.round((src.turnover / totalTurn) * 1000) / 10 : 0,
      changePct: chg,
      upDays: src.up_days,
      downDays: src.down_days,
      daysTraded: days,
      winRatePct,
      vwapPct,
      closePosPct,
      avgTradeSize,
      endPrice: src.end_price ?? null,
      vsD120Pct: src.vs_d120_pct ?? null,
      gap52hPct: src.gap_52h_pct ?? null,
      momentumScore: baseScore,
      signedFlowScore,
      convictionScore,
      flowTag,
      isBlockWarning,
      isInstitutionalTicket,
      fundamental,
      technical,
      fundScore,
      techScore,
      isDualConfluence,
      isQualityPullback,
      isHollowRally,
    };
  });
}

interface LabelPlacement {
  symbol: string;
  lx: number;
  ly: number;
  anchor: 'start' | 'middle' | 'end';
  px: number;
  py: number;
  r: number;
  color: string;
}

function resolveSmartLabels(
  candidates: Array<{
    symbol: string;
    x: number;
    y: number;
    r: number;
    priority: number;
    color: string;
    forced: boolean;
  }>,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  maxLabels: number
): LabelPlacement[] {
  const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const results: LabelPlacement[] = [];
  const sorted = [...candidates].sort((a, b) => {
    if (a.forced !== b.forced) return a.forced ? -1 : 1;
    return b.priority - a.priority;
  });

  const offsets: Array<{ dx: number; dy: number; anchor: 'start' | 'middle' | 'end' }> = [
    { dx: 0, dy: -1, anchor: 'middle' },
    { dx: 1, dy: 0.35, anchor: 'start' },
    { dx: -1, dy: 0.35, anchor: 'end' },
    { dx: 0, dy: 1.35, anchor: 'middle' },
    { dx: 1.2, dy: -0.9, anchor: 'start' },
    { dx: -1.2, dy: -0.9, anchor: 'end' },
    { dx: 1.4, dy: 1.2, anchor: 'start' },
    { dx: -1.4, dy: 1.2, anchor: 'end' },
  ];

  for (const pt of sorted) {
    if (!pt.forced && results.length >= maxLabels) break;
    const textW = pt.symbol.length * 6.3 + 6;
    const textH = 12;

    let chosen: LabelPlacement | null = null;
    for (const off of offsets) {
      const dist = pt.r + 7;
      const lx = pt.x + off.dx * dist;
      const ly = pt.y + off.dy * dist;
      const x1 =
        off.anchor === 'middle' ? lx - textW / 2 : off.anchor === 'start' ? lx : lx - textW;
      const x2 = x1 + textW;
      const y1 = ly - textH + 2;
      const y2 = ly + 2;

      if (x1 < bounds.minX || x2 > bounds.maxX || y1 < bounds.minY || y2 > bounds.maxY) {
        continue;
      }

      const collides = placedBoxes.some(
        (b) => !(x2 + 2 < b.x1 || x1 - 2 > b.x2 || y2 + 2 < b.y1 || y1 - 2 > b.y2)
      );
      if (!collides) {
        placedBoxes.push({ x1, y1, x2, y2 });
        chosen = {
          symbol: pt.symbol,
          lx,
          ly,
          anchor: off.anchor,
          px: pt.x,
          py: pt.y,
          r: pt.r,
          color: pt.color,
        };
        break;
      }
    }

    if (chosen) {
      results.push(chosen);
    } else if (pt.forced) {
      const ly = Math.max(bounds.minY + 10, pt.y - pt.r - 6);
      results.push({
        symbol: pt.symbol,
        lx: Math.min(bounds.maxX - 24, Math.max(bounds.minX + 24, pt.x)),
        ly,
        anchor: 'middle',
        px: pt.x,
        py: pt.y,
        r: pt.r,
        color: pt.color,
      });
    }
  }

  return results;
}

type MatrixLens = 'direction_turnover' | 'conviction_return' | 'fund_flow';
type MatrixFilter =
  | 'all'
  | 'top_pct'
  | 'dual_confluence'
  | 'quality_pullback'
  | 'institutional'
  | 'clean_up';
type LabelMode = 'smart' | 'focus' | 'all';

function getPointColor(item: DirectionEnrichedRow): string {
  if (item.isDualConfluence) return '#10b981'; // Emerald — Dual-engine quality + flow + setup
  if (item.isQualityPullback) return '#2563eb'; // Cobalt blue — Undervalued strong fundamental pullback
  if (item.directionGroup === 'up') {
    if (item.isBlockWarning) return '#d97706'; // Amber — Block/hollow caution
    return '#0d9488'; // Teal — High-turnover buyer
  }
  if (item.directionGroup === 'down') {
    return '#ef4444'; // Crimson — High-turnover supply pressure
  }
  return '#94a3b8'; // Slate — Below turnover cutoff
}

// ------------------------------------------------------------------ 1. Hero Matrix + 3-Pillar Dossier
export const TurnoverDirectionMatrix: React.FC<{
  items: DirectionEnrichedRow[];
  cutoff: number;
  topPct: number;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer?: (symbol: string) => void;
  onInspectInQuant?: (symbol: string) => void;
}> = ({
  items,
  cutoff,
  topPct,
  onInspectSymbol,
  onInspectInAnalyzer,
  onInspectInQuant,
}) => {
  const [lens, setLens] = useState<MatrixLens>('direction_turnover');
  const [filterMode, setFilterMode] = useState<MatrixFilter>('all');
  const [labelMode, setLabelMode] = useState<LabelMode>('smart');
  const [searchText, setSearchText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [lockedSymbol, setLockedSymbol] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const W = isExpanded ? 980 : 700;
  const H = isExpanded ? 460 : 390;
  const PAD = { t: 28, r: 28, b: 44, l: 56 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const filteredItems = useMemo(() => {
    const q = searchText.trim().toUpperCase();
    return items.filter((it) => {
      if (filterMode === 'top_pct' && !it.inTopTurnover) return false;
      if (filterMode === 'dual_confluence' && !it.isDualConfluence) return false;
      if (filterMode === 'quality_pullback' && !it.isQualityPullback) return false;
      if (filterMode === 'institutional' && !(it.inTopTurnover && it.isInstitutionalTicket)) return false;
      if (filterMode === 'clean_up' && !(it.directionGroup === 'up' && !it.isBlockWarning)) return false;
      if (lens === 'fund_flow' && it.fundScore === null) return false;
      if (q && !it.inTopTurnover && !it.symbol.includes(q) && !it.name.toUpperCase().includes(q)) {
        // Keep top turnover + search matches crisp even when filtering
        return filterMode === 'all' ? it.symbol.includes(q) || it.name.toUpperCase().includes(q) : true;
      }
      return true;
    });
  }, [items, filterMode, lens, searchText]);

  const axisConfig = useMemo(() => {
    if (lens === 'direction_turnover') {
      const chgs = filteredItems.map((it) => Math.abs(it.changePct));
      const maxAbs = Math.min(25, Math.max(8, ...(chgs.length ? chgs : [8])));
      const xBound = Math.ceil(maxAbs / 2) * 2;
      const turns = filteredItems.map((it) => Math.max(0.01, it.turnoverCr));
      const minLog = Math.min(...turns.map((t) => Math.log10(t)), -1);
      const maxLog = Math.max(...turns.map((t) => Math.log10(t)), 1.5);
      const cutLog = cutoff > 0 ? Math.log10(Math.max(0.01, cutoff / 1e7)) : 0;

      return {
        xLabel: 'Period Price Change (%)',
        yLabel: 'Log Turnover (Rs Crore)',
        xMin: -xBound,
        xMax: xBound,
        yMin: minLog - 0.15,
        yMax: maxLog + 0.18,
        xThresh: 0,
        yThresh: cutLog,
        qTopRight: 'MOMENTUM & ACCUMULATION',
        qTopLeft: 'HEAVY DISTRIBUTION',
        qBotRight: 'QUIET UPWARD DRIFT',
        qBotLeft: 'LOW-TURNOVER DRIFT',
        xTicks: [-xBound, -xBound / 2, 0, xBound / 2, xBound],
        formatX: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
        isLogY: true,
        getX: (it: DirectionEnrichedRow) => Math.max(-xBound, Math.min(xBound, it.changePct)),
        getY: (it: DirectionEnrichedRow) => Math.log10(Math.max(0.01, it.turnoverCr)),
      };
    }

    if (lens === 'conviction_return') {
      const chgs = filteredItems.map((it) => Math.abs(it.changePct));
      const xBound = Math.ceil(Math.min(25, Math.max(8, ...(chgs.length ? chgs : [8]))) / 2) * 2;
      return {
        xLabel: 'Period Price Change (%)',
        yLabel: 'Tape Conviction (Close Pos + VWAP Control + Win%)',
        xMin: -xBound,
        xMax: xBound,
        yMin: 0,
        yMax: 100,
        xThresh: 0,
        yThresh: 55,
        qTopRight: 'HIGH-CONVICTION LEADERS',
        qTopLeft: 'SILENT ABSORPTION (BUYING DIPS)',
        qBotRight: 'HOLLOW RALLY / WEAK CLOSE',
        qBotLeft: 'CAPITULATION / FADE',
        xTicks: [-xBound, -xBound / 2, 0, xBound / 2, xBound],
        formatX: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
        isLogY: false,
        getX: (it: DirectionEnrichedRow) => Math.max(-xBound, Math.min(xBound, it.changePct)),
        getY: (it: DirectionEnrichedRow) => it.convictionScore,
      };
    }

    // fund_flow
    return {
      xLabel: 'Fundamental Composite Score (0–100)',
      yLabel: 'Signed Directional Flow (-Pressure / +Momentum)',
      xMin: 15,
      xMax: 95,
      yMin: -100,
      yMax: 100,
      xThresh: 55,
      yThresh: 0,
      qTopRight: 'QUALITY BREAKOUTS (FUND + FLOW)',
      qTopLeft: 'SPECULATIVE / MOMENTUM SURGE',
      qBotRight: 'QUALITY PULLBACK (BARGAIN WATCH)',
      qBotLeft: 'WEAK DISTRIBUTION',
      xTicks: [20, 40, 55, 75, 90],
      formatX: (v: number) => `${v.toFixed(0)}`,
      isLogY: false,
      getX: (it: DirectionEnrichedRow) => Math.max(16, Math.min(94, it.fundScore ?? 50)),
      getY: (it: DirectionEnrichedRow) => Math.max(-98, Math.min(98, it.signedFlowScore)),
    };
  }, [lens, filteredItems, cutoff]);

  const toX = (val: number) =>
    PAD.l + ((val - axisConfig.xMin) / (axisConfig.xMax - axisConfig.xMin || 1)) * innerW;
  const toY = (val: number) =>
    PAD.t + innerH - ((val - axisConfig.yMin) / (axisConfig.yMax - axisConfig.yMin || 1)) * innerH;

  const plotted = useMemo(() => {
    const list = filteredItems.map((it) => {
      const xv = axisConfig.getX(it);
      const yv = axisConfig.getY(it);
      const x = toX(xv);
      const y = toY(yv);
      const r = it.inTopTurnover
        ? Math.max(5.5, Math.min(13.5, 5 + (it.momentumScore / 100) * 7.5))
        : 3.1;
      const color = getPointColor(it);
      return { stock: it, x, y, r, color };
    });
    // Draw lower-priority base points first, top/highlighted on top
    return list.sort((a, b) => Number(a.stock.inTopTurnover) - Number(b.stock.inTopTurnover));
  }, [filteredItems, axisConfig, innerW, innerH]);

  const searchUpper = searchText.trim().toUpperCase();
  const matchedSymbols = useMemo(() => {
    if (!searchUpper) return [] as DirectionEnrichedRow[];
    return items
      .filter(
        (it) =>
          it.symbol.includes(searchUpper) ||
          it.name.toUpperCase().includes(searchUpper)
      )
      .slice(0, 6);
  }, [items, searchUpper]);

  const activeSymbol =
    hoveredSymbol ||
    lockedSymbol ||
    (searchUpper && matchedSymbols[0]?.symbol) ||
    items.find((it) => it.isDualConfluence)?.symbol ||
    items.find((it) => it.directionGroup === 'up')?.symbol ||
    items[0]?.symbol ||
    null;

  const activeItem = useMemo(
    () => items.find((it) => it.symbol === activeSymbol) ?? null,
    [items, activeSymbol]
  );

  const labels = useMemo(() => {
    if (labelMode === 'focus') {
      return plotted
        .filter(
          (p) =>
            p.stock.symbol === activeSymbol ||
            (searchUpper.length > 0 && p.stock.symbol.includes(searchUpper))
        )
        .map((p) => ({
          symbol: p.stock.symbol,
          lx: p.x,
          ly: p.y - p.r - 6,
          anchor: 'middle' as const,
          px: p.x,
          py: p.y,
          r: p.r,
          color: p.color,
        }));
    }

    const candidates = plotted
      .filter(
        (p) =>
          p.stock.inTopTurnover ||
          p.stock.symbol === activeSymbol ||
          (searchUpper.length > 0 && p.stock.symbol.includes(searchUpper))
      )
      .map((p) => ({
        symbol: p.stock.symbol,
        x: p.x,
        y: p.y,
        r: p.r,
        color: p.color,
        priority:
          (p.stock.isDualConfluence ? 40 : 0) +
          (p.stock.isQualityPullback ? 25 : 0) +
          p.stock.momentumScore +
          (p.stock.turnoverCr >= 5 ? 10 : 0),
        forced:
          p.stock.symbol === activeSymbol ||
          (searchUpper.length > 0 && p.stock.symbol.includes(searchUpper)),
      }));

    const maxLabels = labelMode === 'all' ? candidates.length : isExpanded ? 24 : 14;
    return resolveSmartLabels(
      candidates,
      { minX: PAD.l + 4, maxX: W - PAD.r - 4, minY: PAD.t + 12, maxY: H - PAD.b - 6 },
      maxLabels
    );
  }, [plotted, labelMode, activeSymbol, searchUpper, isExpanded, W, H]);

  const counts = useMemo(
    () => ({
      dual: items.filter((i) => i.isDualConfluence).length,
      pullback: items.filter((i) => i.isQualityPullback).length,
      inst: items.filter((i) => i.inTopTurnover && i.isInstitutionalTicket).length,
      cleanUp: items.filter((i) => i.directionGroup === 'up' && !i.isBlockWarning).length,
    }),
    [items]
  );

  const threshX = toX(axisConfig.xThresh);
  const threshY = toY(axisConfig.yThresh);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
      <div
        className={`${
          isExpanded ? 'xl:col-span-12' : 'xl:col-span-8'
        } border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3 flex flex-col justify-between`}
      >
        {/* Top Row: Title + Lens Switch + Expand */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Compass className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {lens === 'direction_turnover'
                ? 'Turnover × Price Direction Matrix'
                : lens === 'conviction_return'
                  ? 'Tape Conviction × Price Return Matrix'
                  : 'Fundamental Quality × Directional Flow Matrix'}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5 text-[11px]">
              {(
                [
                  ['direction_turnover', 'Turn × Dir'],
                  ['conviction_return', 'Conviction × Ret'],
                  ['fund_flow', 'Fund × Flow'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLens(k)}
                  className={`px-2 py-1 rounded transition-colors whitespace-nowrap shrink-0 ${
                    lens === k
                      ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-semibold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {isExpanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
              <span>{isExpanded ? 'Compact' : 'Expand'}</span>
            </button>
          </div>
        </div>

        {/* Second Row: Scrip Locator + Filter Chips + Label Mode */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matchedSymbols[0]) {
                    setLockedSymbol(matchedSymbols[0].symbol);
                  }
                }}
                placeholder="Locate scrip…"
                className="w-36 pl-7 pr-6 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              {searchText && (
                <button
                  type="button"
                  onClick={() => setSearchText('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            {(
              [
                ['all', `All (${items.length})`],
                ['top_pct', `Top ${topPct}%`],
                ['dual_confluence', `Dual Confluence (${counts.dual})`],
                ['quality_pullback', `Quality Pullbacks (${counts.pullback})`],
                ['institutional', `Institutional Ticket (${counts.inst})`],
                ['clean_up', `Clean Up (${counts.cleanUp})`],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilterMode(k)}
                className={`px-2 py-1 rounded border transition-colors whitespace-nowrap shrink-0 ${
                  filterMode === k
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Labels:</span>
            <div className="inline-flex items-center rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5">
              {(['smart', 'focus', 'all'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setLabelMode(m)}
                  className={`px-1.5 py-0.5 rounded capitalize transition-colors ${
                    labelMode === m
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium shadow-sm'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {lockedSymbol && (
              <button
                type="button"
                onClick={() => setLockedSymbol(null)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Unlock {lockedSymbol}</span>
              </button>
            )}
          </div>
        </div>

        {/* SVG Chart */}
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto select-none overflow-visible"
            onMouseMove={(e) => {
              const rect = svgRef.current?.getBoundingClientRect();
              if (!rect || rect.width === 0) return;
              const sx = ((e.clientX - rect.left) / rect.width) * W;
              const sy = ((e.clientY - rect.top) / rect.height) * H;
              if (sx >= PAD.l && sx <= W - PAD.r && sy >= PAD.t && sy <= H - PAD.b) {
                setMousePos({ x: sx, y: sy });
              } else {
                setMousePos(null);
              }
            }}
            onMouseLeave={() => setMousePos(null)}
          >
            {/* Sweet-Spot Top-Right Quadrant Highlight */}
            <rect
              x={Math.max(PAD.l, threshX)}
              y={PAD.t}
              width={Math.max(0, W - PAD.r - Math.max(PAD.l, threshX))}
              height={Math.max(0, Math.min(H - PAD.b, threshY) - PAD.t)}
              fill="#10b981"
              fillOpacity={0.055}
            />
            {/* Bargain / Absorption Zone Highlight when relevant */}
            {lens !== 'direction_turnover' && (
              <rect
                x={lens === 'fund_flow' ? Math.max(PAD.l, threshX) : PAD.l}
                y={lens === 'fund_flow' ? Math.max(PAD.t, threshY) : PAD.t}
                width={
                  lens === 'fund_flow'
                    ? Math.max(0, W - PAD.r - Math.max(PAD.l, threshX))
                    : Math.max(0, Math.max(PAD.l, threshX) - PAD.l)
                }
                height={
                  lens === 'fund_flow'
                    ? Math.max(0, H - PAD.b - Math.max(PAD.t, threshY))
                    : Math.max(0, Math.min(H - PAD.b, threshY) - PAD.t)
                }
                fill="#2563eb"
                fillOpacity={0.045}
              />
            )}

            {/* Vertical Grid & X Ticks */}
            {axisConfig.xTicks.map((tv) => {
              const x = toX(tv);
              return (
                <g key={tv}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PAD.t}
                    y2={H - PAD.b}
                    stroke="currentColor"
                    className="text-slate-100 dark:text-slate-800"
                  />
                  <text
                    x={x}
                    y={H - PAD.b + 14}
                    textAnchor="middle"
                    fontSize={10}
                    className="fill-slate-400 font-mono"
                  >
                    {axisConfig.formatX(tv)}
                  </text>
                </g>
              );
            })}

            {/* Horizontal Grid & Y Ticks */}
            {axisConfig.isLogY
              ? [-1, 0, 1, 2, 3].map((pow) => {
                  if (pow < axisConfig.yMin || pow > axisConfig.yMax) return null;
                  const y = toY(pow);
                  return (
                    <g key={pow}>
                      <line
                        x1={PAD.l}
                        x2={W - PAD.r}
                        y1={y}
                        y2={y}
                        stroke="currentColor"
                        className="text-slate-100 dark:text-slate-800"
                      />
                      <text
                        x={PAD.l - 8}
                        y={y + 3}
                        textAnchor="end"
                        fontSize={10}
                        className="fill-slate-400 font-mono"
                      >
                        {Math.pow(10, pow)} cr
                      </text>
                    </g>
                  );
                })
              : [
                  axisConfig.yMin,
                  (axisConfig.yMin + axisConfig.yThresh) / 2,
                  axisConfig.yThresh,
                  (axisConfig.yThresh + axisConfig.yMax) / 2,
                  axisConfig.yMax,
                ].map((tv, i) => {
                  const y = toY(tv);
                  return (
                    <g key={i}>
                      <line
                        x1={PAD.l}
                        x2={W - PAD.r}
                        y1={y}
                        y2={y}
                        stroke="currentColor"
                        className="text-slate-100 dark:text-slate-800"
                      />
                      <text
                        x={PAD.l - 8}
                        y={y + 3}
                        textAnchor="end"
                        fontSize={10}
                        className="fill-slate-400 font-mono"
                      >
                        {tv.toFixed(0)}
                      </text>
                    </g>
                  );
                })}

            {/* Threshold Crosshairs */}
            <line
              x1={threshX}
              x2={threshX}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="currentColor"
              className="text-slate-300 dark:text-slate-700"
              strokeDasharray="4 4"
            />
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={threshY}
              y2={threshY}
              stroke={lens === 'direction_turnover' ? '#2563eb' : 'currentColor'}
              className={lens === 'direction_turnover' ? undefined : 'text-slate-300 dark:text-slate-700'}
              strokeDasharray="4 4"
              strokeOpacity={lens === 'direction_turnover' ? 0.65 : 1}
            />
            {lens === 'direction_turnover' && cutoff > 0 && (
              <text
                x={W - PAD.r - 4}
                y={threshY - 5}
                textAnchor="end"
                fontSize={10}
                className="fill-blue-600 dark:fill-blue-400 font-mono"
              >
                Top-{topPct}% Cutoff: Rs {formatCrore(cutoff)} cr
              </text>
            )}

            {/* Quadrant Annotations */}
            <text x={PAD.l + 8} y={PAD.t + 14} fontSize={9.5} fontWeight={600} className="fill-red-600/75 dark:fill-red-400/75">
              {axisConfig.qTopLeft}
            </text>
            <text
              x={W - PAD.r - 8}
              y={PAD.t + 14}
              textAnchor="end"
              fontSize={9.5}
              fontWeight={600}
              className="fill-emerald-600/85 dark:fill-emerald-400/85"
            >
              {axisConfig.qTopRight}
            </text>
            <text x={PAD.l + 8} y={H - PAD.b - 8} fontSize={9} fontWeight={600} className="fill-slate-400">
              {axisConfig.qBotLeft}
            </text>
            <text
              x={W - PAD.r - 8}
              y={H - PAD.b - 8}
              textAnchor="end"
              fontSize={9}
              fontWeight={600}
              className={
                lens === 'fund_flow'
                  ? 'fill-blue-600/80 dark:fill-blue-400/80'
                  : 'fill-slate-400'
              }
            >
              {axisConfig.qBotRight}
            </text>

            {/* Interactive Mouse Crosshair */}
            {mousePos && (
              <g className="pointer-events-none">
                <line
                  x1={mousePos.x}
                  x2={mousePos.x}
                  y1={PAD.t}
                  y2={H - PAD.b}
                  stroke="#94a3b8"
                  strokeOpacity={0.35}
                  strokeDasharray="2 2"
                />
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={mousePos.y}
                  y2={mousePos.y}
                  stroke="#94a3b8"
                  strokeOpacity={0.35}
                  strokeDasharray="2 2"
                />
              </g>
            )}

            {/* Bubbles */}
            {plotted.map((p) => {
              const isActive = p.stock.symbol === activeSymbol;
              const isMatch = searchUpper.length > 0 && p.stock.symbol.includes(searchUpper);
              const dim =
                searchUpper.length > 0 && !isMatch && !isActive;

              return (
                <g
                  key={p.stock.symbol}
                  onMouseEnter={() => setHoveredSymbol(p.stock.symbol)}
                  onMouseLeave={() => setHoveredSymbol(null)}
                  onClick={() => {
                    if (lockedSymbol === p.stock.symbol) {
                      onInspectSymbol(p.stock.symbol);
                    } else {
                      setLockedSymbol(p.stock.symbol);
                    }
                  }}
                  className="cursor-pointer"
                >
                  {(isActive || isMatch) && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={p.r + 5}
                      fill="none"
                      stroke={isMatch ? '#f59e0b' : '#2563eb'}
                      strokeWidth={1.6}
                      strokeDasharray="3 2"
                    />
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isActive ? p.r + 1.5 : p.r}
                    fill={p.color}
                    fillOpacity={dim ? 0.16 : p.stock.inTopTurnover ? 0.88 : 0.36}
                    stroke={isActive ? '#0f172a' : p.stock.inTopTurnover ? '#ffffff' : 'none'}
                    strokeWidth={isActive ? 1.8 : 1}
                  />
                </g>
              );
            })}

            {/* Collision-Free Smart Labels with Leader Lines */}
            {labels.map((lb) => {
              const dist = Math.hypot(lb.lx - lb.px, lb.ly - lb.py);
              const isActive = lb.symbol === activeSymbol;
              return (
                <g key={lb.symbol} className="pointer-events-none">
                  {dist > lb.r + 9 && (
                    <line
                      x1={lb.px}
                      y1={lb.py}
                      x2={lb.lx}
                      y2={lb.ly - 3}
                      stroke={lb.color}
                      strokeOpacity={0.5}
                      strokeWidth={0.8}
                    />
                  )}
                  <text
                    x={lb.lx}
                    y={lb.ly}
                    textAnchor={lb.anchor}
                    fontSize={isActive ? 11 : 9.5}
                    fontWeight={isActive ? 700 : 600}
                    className={
                      isActive
                        ? 'fill-blue-700 dark:fill-blue-300'
                        : 'fill-slate-700 dark:fill-slate-200'
                    }
                  >
                    {lb.symbol}
                  </text>
                </g>
              );
            })}

            {/* Axis Titles */}
            <text
              x={PAD.l + innerW / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={11}
              className="fill-slate-500"
            >
              {axisConfig.xLabel}
            </text>
            <text
              x={14}
              y={PAD.t + innerH / 2}
              textAnchor="middle"
              fontSize={10.5}
              transform={`rotate(-90 14 ${PAD.t + innerH / 2})`}
              className="fill-slate-500"
            >
              {axisConfig.yLabel}
            </text>
          </svg>
        </div>

        {/* Clean Unboxed Color Legend */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
              Dual Confluence (Fund + Flow + Setup)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-teal-600 inline-block" />
              High-Turn Buying
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 inline-block" />
              Quality Pullback (Fund ≥58 Dip)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
              Block / Caution
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
              Supply Pressure
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            Click bubble to lock dossier · click again to open chart
          </span>
        </div>
      </div>

      {/* Live 3-Pillar Flow Dossier */}
      <div
        className={`${
          isExpanded ? 'xl:col-span-12' : 'xl:col-span-4'
        } border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-4`}
      >
        {activeItem ? (
          <>
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                      {activeItem.symbol}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{activeItem.sector}</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {activeItem.name}
                  </div>
                  <div className="text-[11px] font-medium mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={
                        activeItem.directionGroup === 'up'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : activeItem.directionGroup === 'down'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-500'
                      }
                    >
                      {activeItem.flowTag}
                    </span>
                    {activeItem.isDualConfluence && (
                      <>
                        <span className="text-slate-300 dark:text-slate-700">/</span>
                        <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                          Dual Confluence
                        </span>
                      </>
                    )}
                    {activeItem.isQualityPullback && (
                      <>
                        <span className="text-slate-300 dark:text-slate-700">/</span>
                        <span className="text-blue-600 dark:text-blue-400 font-semibold">
                          Quality Pullback
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 font-mono tabular-nums">
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {activeItem.endPrice !== null ? `Rs ${formatNum(activeItem.endPrice)}` : '–'}
                  </div>
                  <div
                    className={`text-xs font-semibold ${
                      activeItem.changePct >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {formatPct(activeItem.changePct)}
                  </div>
                </div>
              </div>

              {/* Pillar 1: Liquidity & Tape Conviction */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    Tape &amp; Liquidity Read
                  </span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    Conviction {activeItem.convictionScore.toFixed(0)}/100
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] bg-slate-50 dark:bg-slate-950/70 rounded p-2.5 font-mono tabular-nums">
                  <div>
                    <div className="text-slate-400 font-sans">Turnover</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatCrore(activeItem.turnover, 2)} cr
                    </div>
                    <div className="text-[10px] text-slate-400">{activeItem.cutoffMult.toFixed(1)}× cut</div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-sans">Rs / Trade</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatInt(activeItem.avgTradeSize)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {activeItem.avgTradeSize >= 250_000 ? 'Institutional' : 'Retail mix'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-sans">Close / VWAP</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {activeItem.closePosPct.toFixed(0)}% pos
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {activeItem.vwapPct !== null ? `${formatPct(activeItem.vwapPct)} VWAP` : '–'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Pillar 2: Fundamental Health */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Fundamental Intelligence
                  </span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {activeItem.fundScore !== null ? `${activeItem.fundScore.toFixed(0)}/100` : 'No Qtr Data'}
                  </span>
                </div>
                {activeItem.fundamental?.hasFundamentalData ? (
                  <div className="grid grid-cols-3 gap-2 text-[11px] bg-slate-50 dark:bg-slate-950/70 rounded p-2.5 font-mono tabular-nums">
                    <div>
                      <div className="text-slate-400 font-sans">P/E · ROE</div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {activeItem.fundamental.keyMetrics.pe !== null
                          ? `${activeItem.fundamental.keyMetrics.pe.toFixed(1)}×`
                          : '–'}{' '}
                        ·{' '}
                        {activeItem.fundamental.keyMetrics.roePct !== null
                          ? `${activeItem.fundamental.keyMetrics.roePct.toFixed(1)}%`
                          : '–'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 font-sans">Margin of Safety</div>
                      <div
                        className={`font-semibold ${
                          (activeItem.fundamental.keyMetrics.marginOfSafetyPct ?? 0) > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {activeItem.fundamental.keyMetrics.marginOfSafetyPct !== null
                          ? `${activeItem.fundamental.keyMetrics.marginOfSafetyPct > 0 ? '+' : ''}${activeItem.fundamental.keyMetrics.marginOfSafetyPct.toFixed(0)}%`
                          : '–'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 font-sans">EPS YoY</div>
                      <div
                        className={`font-semibold ${
                          (activeItem.fundamental.keyMetrics.epsYoyPct ?? 0) >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {activeItem.fundamental.keyMetrics.epsYoyPct !== null
                          ? formatPct(activeItem.fundamental.keyMetrics.epsYoyPct)
                          : '–'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 bg-slate-50 dark:bg-slate-950/70 rounded p-2.5">
                    Quarterly report not yet populated for this scrip.
                  </div>
                )}
              </div>

              {/* Pillar 3: Technical / ICT / Wyckoff Setup */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Crosshair className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    Technical / ICT / Wyckoff
                  </span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {activeItem.technical
                      ? `Grade ${activeItem.technical.grade} · ${activeItem.technical.score.toFixed(0)}/100`
                      : 'No Setup'}
                  </span>
                </div>
                {activeItem.technical ? (
                  <div className="text-[11px] bg-slate-50 dark:bg-slate-950/70 rounded p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                        {activeItem.technical.strategy}: {activeItem.technical.setupName}
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                        {activeItem.technical.rrT2.toFixed(1)}R
                      </span>
                    </div>
                    <div className="font-mono tabular-nums text-[10.5px] text-slate-500 dark:text-slate-400">
                      Entry {formatNum(activeItem.technical.entryMid)} · SL{' '}
                      {formatNum(activeItem.technical.stopLoss)} · T2{' '}
                      {formatNum(activeItem.technical.target2)} · {activeItem.technical.htfAlignment}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 bg-slate-50 dark:bg-slate-950/70 rounded p-2.5">
                    No active Grade A–C setup triggered on this end date.
                  </div>
                )}
              </div>
            </div>

            {/* Action Strip */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onInspectSymbol(activeItem.symbol)}
                className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap"
              >
                Open Chart
              </button>
              {onInspectInAnalyzer && (
                <button
                  type="button"
                  onClick={() => onInspectInAnalyzer(activeItem.symbol)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  Auto Analyzer
                </button>
              )}
              {onInspectInQuant && (
                <button
                  type="button"
                  onClick={() => onInspectInQuant(activeItem.symbol)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  Quant Gate
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-400 my-auto text-center py-12">
            Hover or click any bubble on the matrix to inspect its liquidity, fundamental, and ICT technical dossier.
          </div>
        )}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ 2. Flow Battleground & Institutional Footprint Pair
type BattleMetric = 'score' | 'turnover' | 'ticket';

export const FlowBattlegroundCharts: React.FC<{
  items: DirectionEnrichedRow[];
  topPct: number;
  onInspectSymbol: (symbol: string) => void;
}> = ({ items, topPct, onInspectSymbol }) => {
  const [metric, setMetric] = useState<BattleMetric>('score');
  const [hoveredInst, setHoveredInst] = useState<DirectionEnrichedRow | null>(null);

  const buyers = useMemo(() => {
    const ups = items.filter((i) => i.directionGroup === 'up');
    return [...ups]
      .sort((a, b) =>
        metric === 'turnover'
          ? b.turnover - a.turnover
          : metric === 'ticket'
            ? b.avgTradeSize - a.avgTradeSize
            : b.momentumScore - a.momentumScore
      )
      .slice(0, 7);
  }, [items, metric]);

  const sellers = useMemo(() => {
    const downs = items.filter((i) => i.directionGroup === 'down');
    return [...downs]
      .sort((a, b) =>
        metric === 'turnover'
          ? b.turnover - a.turnover
          : metric === 'ticket'
            ? b.avgTradeSize - a.avgTradeSize
            : b.momentumScore - a.momentumScore
      )
      .slice(0, 7);
  }, [items, metric]);

  const maxMetricVal = useMemo(() => {
    const combined = [...buyers, ...sellers];
    if (combined.length === 0) return 100;
    if (metric === 'score') return 100;
    if (metric === 'turnover') return Math.max(...combined.map((c) => c.turnoverCr), 1);
    return Math.max(...combined.map((c) => c.avgTradeSize), 100_000);
  }, [buyers, sellers, metric]);

  // Institutional Footprint Scatter geometry
  const topUniverse = useMemo(
    () => items.filter((i) => i.inTopTurnover && i.avgTradeSize > 0),
    [items]
  );

  const IW = 540;
  const IH = 310;
  const IPAD = { t: 24, r: 22, b: 38, l: 50 };
  const iInnerW = IW - IPAD.l - IPAD.r;
  const iInnerH = IH - IPAD.t - IPAD.b;

  const instLogs = topUniverse.map((it) => Math.log10(Math.max(10_000, it.avgTradeSize)));
  const minLogX = Math.min(...(instLogs.length ? instLogs : [4.3]), 4.2);
  const maxLogX = Math.max(...(instLogs.length ? instLogs : [6.2]), 6.0);
  const threshTicketLog = Math.log10(250_000); // Rs 2.5L/trade

  const mapIX = (ticket: number) => {
    const lv = Math.log10(Math.max(10_000, ticket));
    return IPAD.l + ((lv - minLogX) / (maxLogX - minLogX || 1)) * iInnerW;
  };
  const mapIY = (conv: number) =>
    IPAD.t + iInnerH - (Math.max(0, Math.min(100, conv)) / 100) * iInnerH;

  const instLabels = useMemo(() => {
    return resolveSmartLabels(
      topUniverse.map((it) => ({
        symbol: it.symbol,
        x: mapIX(it.avgTradeSize),
        y: mapIY(it.convictionScore),
        r: 6,
        color: getPointColor(it),
        priority: it.momentumScore + (it.isInstitutionalTicket ? 20 : 0) + (it.isDualConfluence ? 18 : 0),
        forced: hoveredInst?.symbol === it.symbol,
      })),
      { minX: IPAD.l + 4, maxX: IW - IPAD.r - 4, minY: IPAD.t + 10, maxY: IH - IPAD.b - 6 },
      14
    );
  }, [topUniverse, hoveredInst, minLogX, maxLogX]);

  const txLine = mapIX(250_000);
  const tyLine = mapIY(55);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
      {/* Left: Buyers vs Sellers Battleground */}
      <div className="xl:col-span-6 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3 flex flex-col justify-between">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Capital Flow Battleground (Top Buyers vs. Sellers)
            </h3>
          </div>
          <div className="inline-flex items-center rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5 text-[11px]">
            {(
              [
                ['score', 'Momentum'],
                ['turnover', 'Turnover'],
                ['ticket', 'Rs/Trade'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMetric(k)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  metric === k
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-semibold shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs flex-1">
          {/* Buying Leaders */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 pb-1 border-b border-slate-100 dark:border-slate-800">
              <span>Accumulation Leaders</span>
              <span className="font-mono font-normal text-slate-400">
                {metric === 'score' ? 'Score · Chg%' : metric === 'turnover' ? 'Cr · Chg%' : 'Rs/Trd · Chg%'}
              </span>
            </div>
            {buyers.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-6 text-center">No advancers in slice.</div>
            ) : (
              buyers.map((b) => {
                const raw =
                  metric === 'turnover'
                    ? b.turnoverCr
                    : metric === 'ticket'
                      ? b.avgTradeSize
                      : b.momentumScore;
                const w = Math.max(6, Math.min(100, (raw / maxMetricVal) * 100));
                return (
                  <button
                    key={b.symbol}
                    type="button"
                    onClick={() => onInspectSymbol(b.symbol)}
                    className="w-full text-left group space-y-1 py-0.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                          {b.symbol}
                        </span>
                        {b.fundScore !== null && (
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                            F:{b.fundScore.toFixed(0)}
                          </span>
                        )}
                        {b.technical && (
                          <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                            {b.technical.grade}
                          </span>
                        )}
                      </div>
                      <span className="font-mono tabular-nums text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                        {metric === 'turnover'
                          ? `${b.turnoverCr.toFixed(1)}cr`
                          : metric === 'ticket'
                            ? `${Math.round(b.avgTradeSize / 1000)}k`
                            : `${b.momentumScore.toFixed(0)}`}{' '}
                        · {formatPct(b.changePct)}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${
                          b.isDualConfluence ? 'bg-emerald-500' : 'bg-teal-500'
                        }`}
                        style={{ width: `${w}%` }}
                      />
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Distribution Pressure */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-red-700 dark:text-red-400 pb-1 border-b border-slate-100 dark:border-slate-800">
              <span>Distribution &amp; Supply</span>
              <span className="font-mono font-normal text-slate-400">
                {metric === 'score' ? 'Press · Chg%' : metric === 'turnover' ? 'Cr · Chg%' : 'Rs/Trd · Chg%'}
              </span>
            </div>
            {sellers.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-6 text-center">No decliners in slice.</div>
            ) : (
              sellers.map((s) => {
                const raw =
                  metric === 'turnover'
                    ? s.turnoverCr
                    : metric === 'ticket'
                      ? s.avgTradeSize
                      : s.momentumScore;
                const w = Math.max(6, Math.min(100, (raw / maxMetricVal) * 100));
                return (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => onInspectSymbol(s.symbol)}
                    className="w-full text-left group space-y-1 py-0.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                          {s.symbol}
                        </span>
                        {s.isQualityPullback && (
                          <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                            Dip
                          </span>
                        )}
                        {s.fundScore !== null && (
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                            F:{s.fundScore.toFixed(0)}
                          </span>
                        )}
                      </div>
                      <span className="font-mono tabular-nums text-[11px] text-red-600 dark:text-red-400 font-semibold">
                        {metric === 'turnover'
                          ? `${s.turnoverCr.toFixed(1)}cr`
                          : metric === 'ticket'
                            ? `${Math.round(s.avgTradeSize / 1000)}k`
                            : `${s.momentumScore.toFixed(0)}`}{' '}
                        · {formatPct(s.changePct)}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden flex justify-end">
                      <div
                        className={`h-full rounded ${
                          s.isQualityPullback ? 'bg-blue-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${w}%` }}
                      />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
          Emerald bars = Dual Confluence (Fund + Flow + ICT) · Blue bars on supply side = Quality Pullback on strong fundamentals
        </div>
      </div>

      {/* Right: Institutional Footprint Quadrant */}
      <div className="xl:col-span-6 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Institutional Footprint (Ticket Size vs. Tape Conviction)
            </h3>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Top-{topPct}% Universe ({topUniverse.length})
          </span>
        </div>

        <svg viewBox={`0 0 ${IW} ${IH}`} className="w-full h-auto select-none overflow-visible">
          {/* Institutional Accumulation Top-Right Zone */}
          <rect
            x={Math.max(IPAD.l, txLine)}
            y={IPAD.t}
            width={Math.max(0, IW - IPAD.r - Math.max(IPAD.l, txLine))}
            height={Math.max(0, tyLine - IPAD.t)}
            fill="#0d9488"
            fillOpacity={0.07}
          />

          {[25, 55, 75, 100].map((v) => {
            const y = mapIY(v);
            return (
              <g key={v}>
                <line
                  x1={IPAD.l}
                  x2={IW - IPAD.r}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className={v === 55 ? 'text-slate-300 dark:text-slate-700' : 'text-slate-100 dark:text-slate-800'}
                  strokeDasharray={v === 55 ? '4 4' : undefined}
                />
                <text x={IPAD.l - 7} y={y + 3} textAnchor="end" fontSize={9.5} className="fill-slate-400 font-mono">
                  {v}
                </text>
              </g>
            );
          })}

          {[50_000, 100_000, 250_000, 500_000, 1_000_000].map((t) => {
            const lv = Math.log10(t);
            if (lv < minLogX || lv > maxLogX) return null;
            const x = mapIX(t);
            const isThresh = t === 250_000;
            return (
              <g key={t}>
                <line
                  x1={x}
                  x2={x}
                  y1={IPAD.t}
                  y2={IH - IPAD.b}
                  stroke={isThresh ? '#0d9488' : 'currentColor'}
                  className={isThresh ? undefined : 'text-slate-100 dark:text-slate-800'}
                  strokeDasharray={isThresh ? '4 4' : undefined}
                  strokeOpacity={isThresh ? 0.65 : 1}
                />
                <text x={x} y={IH - IPAD.b + 13} textAnchor="middle" fontSize={9.5} className="fill-slate-400 font-mono">
                  {t >= 1_000_000 ? '10L' : `${t / 1000}k`}
                </text>
              </g>
            );
          })}

          <text x={IW - IPAD.r - 6} y={IPAD.t + 12} textAnchor="end" fontSize={9} fontWeight={600} className="fill-teal-600/85 dark:fill-teal-400/85">
            INSTITUTIONAL ACCUMULATION (≥2.5L + HIGH CONV)
          </text>
          <text x={IPAD.l + 6} y={IPAD.t + 12} fontSize={9} fontWeight={600} className="fill-amber-600/80 dark:fill-amber-400/80">
            RETAIL MOMENTUM CHURN
          </text>
          <text x={IW - IPAD.r - 6} y={IH - IPAD.b - 6} textAnchor="end" fontSize={9} fontWeight={600} className="fill-red-600/75 dark:fill-red-400/75">
            BLOCK / INSTITUTIONAL EXIT
          </text>

          {topUniverse.map((it) => {
            const cx = mapIX(it.avgTradeSize);
            const cy = mapIY(it.convictionScore);
            const r = Math.max(4.5, Math.min(10.5, 4 + (it.turnoverCr / Math.max(1, maxMetricVal)) * 4));
            const color = getPointColor(it);
            const active = hoveredInst?.symbol === it.symbol;
            return (
              <circle
                key={it.symbol}
                cx={cx}
                cy={cy}
                r={active ? r + 2 : r}
                fill={color}
                fillOpacity={0.86}
                stroke={active ? '#0f172a' : '#ffffff'}
                strokeWidth={active ? 1.8 : 1}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredInst(it)}
                onMouseLeave={() => setHoveredInst(null)}
                onClick={() => onInspectSymbol(it.symbol)}
              />
            );
          })}

          {instLabels.map((lb) => (
            <g key={lb.symbol} className="pointer-events-none">
              <text
                x={lb.lx}
                y={lb.ly}
                textAnchor={lb.anchor}
                fontSize={9.5}
                fontWeight={600}
                className="fill-slate-700 dark:fill-slate-200"
              >
                {lb.symbol}
              </text>
            </g>
          ))}

          <text x={IPAD.l + iInnerW / 2} y={IH - 6} textAnchor="middle" fontSize={10.5} className="fill-slate-500">
            Avg Ticket Size Rs/Trade (Log Scale)
          </text>
          <text
            x={13}
            y={IPAD.t + iInnerH / 2}
            textAnchor="middle"
            fontSize={10}
            transform={`rotate(-90 13 ${IPAD.t + iInnerH / 2})`}
            className="fill-slate-500"
          >
            Tape Conviction (0–100)
          </text>
        </svg>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          {hoveredInst ? (
            <>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {hoveredInst.symbol} · {hoveredInst.flowTag}
              </span>
              <span>
                Rs {formatInt(hoveredInst.avgTradeSize)}/trade · Conv {hoveredInst.convictionScore.toFixed(0)} · Close {hoveredInst.closePosPct.toFixed(0)}% · {formatPct(hoveredInst.changePct)}
              </span>
            </>
          ) : (
            <span className="font-sans text-slate-400">
              Separates big-ticket institutional accumulation (≥Rs 2.5L/trade closing strong) from small-ticket retail noise.
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ 3. Sector Capital Rotation & Net Flow
interface SectorFlowMetric {
  sector: string;
  count: number;
  upTurnCr: number;
  downTurnCr: number;
  flatTurnCr: number;
  totalTurnCr: number;
  netTurnCr: number;
  upSharePct: number;
  avgChangePct: number;
  avgFundScore: number | null;
  topBuyer: DirectionEnrichedRow | null;
  topSeller: DirectionEnrichedRow | null;
}

export const SectorCapitalFlowChart: React.FC<{
  items: DirectionEnrichedRow[];
  onInspectSymbol: (symbol: string) => void;
}> = ({ items, onInspectSymbol }) => {
  const [sortKey, setSortKey] = useState<'net' | 'total' | 'ret' | 'fund'>('net');

  const sectors = useMemo(() => {
    const map = new Map<string, DirectionEnrichedRow[]>();
    for (const it of items) {
      const sec = it.sector || 'Other';
      const arr = map.get(sec) ?? [];
      arr.push(it);
      map.set(sec, arr);
    }

    const out: SectorFlowMetric[] = [];
    for (const [sector, rows] of map.entries()) {
      let upTurnCr = 0;
      let downTurnCr = 0;
      let flatTurnCr = 0;
      let retSum = 0;
      const fundScores: number[] = [];
      let topBuyer: DirectionEnrichedRow | null = null;
      let topSeller: DirectionEnrichedRow | null = null;

      for (const r of rows) {
        if (r.changePct > 0) {
          upTurnCr += r.turnoverCr;
          if (!topBuyer || r.turnoverCr > topBuyer.turnoverCr) topBuyer = r;
        } else if (r.changePct < 0) {
          downTurnCr += r.turnoverCr;
          if (!topSeller || r.turnoverCr > topSeller.turnoverCr) topSeller = r;
        } else {
          flatTurnCr += r.turnoverCr;
        }
        retSum += r.changePct;
        if (r.fundScore !== null) fundScores.push(r.fundScore);
      }

      const totalTurnCr = upTurnCr + downTurnCr + flatTurnCr;
      if (totalTurnCr <= 0) continue;
      const dirTotal = upTurnCr + downTurnCr;
      out.push({
        sector,
        count: rows.length,
        upTurnCr,
        downTurnCr,
        flatTurnCr,
        totalTurnCr,
        netTurnCr: upTurnCr - downTurnCr,
        upSharePct: dirTotal > 0 ? Math.round((upTurnCr / dirTotal) * 100) : 50,
        avgChangePct: Math.round((retSum / rows.length) * 100) / 100,
        avgFundScore:
          fundScores.length > 0
            ? Math.round((fundScores.reduce((s, v) => s + v, 0) / fundScores.length) * 10) / 10
            : null,
        topBuyer,
        topSeller,
      });
    }

    return out
      .sort((a, b) => {
        if (sortKey === 'total') return b.totalTurnCr - a.totalTurnCr;
        if (sortKey === 'ret') return b.avgChangePct - a.avgChangePct;
        if (sortKey === 'fund') return (b.avgFundScore ?? 0) - (a.avgFundScore ?? 0);
        return b.netTurnCr - a.netTurnCr;
      })
      .slice(0, 12);
  }, [items, sortKey]);

  const maxAbsNet = Math.max(...sectors.map((s) => Math.abs(s.netTurnCr)), 1);

  if (sectors.length === 0) return null;

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Sector Net Capital Flow &amp; Fundamental Quality Map
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Advancing minus declining turnover across the selected period, paired with average sector Fundamental Score
            </p>
          </div>
        </div>

        <div className="inline-flex items-center rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5 text-[11px]">
          {(
            [
              ['net', 'Net Inflow'],
              ['total', 'Total Turn'],
              ['ret', 'Avg Chg%'],
              ['fund', 'Avg Fund'],
            ] as const
          ).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSortKey(k)}
              className={`px-2 py-0.5 rounded transition-colors ${
                sortKey === k
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-semibold shadow-sm'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {sectors.map((sec) => {
          const isPos = sec.netTurnCr >= 0;
          const barW = Math.max(4, (Math.abs(sec.netTurnCr) / maxAbsNet) * 100);
          return (
            <div
              key={sec.sector}
              className="grid grid-cols-1 lg:grid-cols-12 items-center gap-2 text-xs py-1.5 border-b border-slate-100 dark:border-slate-800/70 last:border-b-0"
            >
              <div className="lg:col-span-3 flex items-center justify-between gap-2 min-w-0">
                <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                  {sec.sector}
                </span>
                <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                  {sec.count} stk
                </span>
              </div>

              {/* Center-zero diverging bar */}
              <div className="lg:col-span-4 grid grid-cols-2 items-center gap-1">
                <div className="h-2.5 bg-slate-100 dark:bg-slate-800/80 rounded-l overflow-hidden flex justify-end">
                  {!isPos && (
                    <div className="h-full bg-red-500 rounded-l" style={{ width: `${barW}%` }} />
                  )}
                </div>
                <div className="h-2.5 bg-slate-100 dark:bg-slate-800/80 rounded-r overflow-hidden">
                  {isPos && (
                    <div className="h-full bg-emerald-500 rounded-r" style={{ width: `${barW}%` }} />
                  )}
                </div>
              </div>

              <div className="lg:col-span-3 flex items-center justify-between lg:justify-end gap-3 font-mono tabular-nums text-[11px]">
                <span
                  className={`font-semibold ${
                    isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {isPos ? '+' : ''}
                  {sec.netTurnCr.toFixed(1)} cr
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {sec.upSharePct}% buy
                </span>
                <span
                  className={
                    sec.avgChangePct >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }
                >
                  {formatPct(sec.avgChangePct)}
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  F:{sec.avgFundScore !== null ? sec.avgFundScore.toFixed(0) : '–'}
                </span>
              </div>

              <div className="lg:col-span-2 flex items-center justify-end gap-2 text-[11px] font-mono">
                {sec.topBuyer && (
                  <button
                    type="button"
                    onClick={() => onInspectSymbol(sec.topBuyer!.symbol)}
                    className="text-emerald-700 dark:text-emerald-400 hover:underline font-semibold"
                    title={`Top buyer: Rs ${sec.topBuyer.turnoverCr.toFixed(1)} cr`}
                  >
                    ↑{sec.topBuyer.symbol}
                  </button>
                )}
                {sec.topSeller && (
                  <button
                    type="button"
                    onClick={() => onInspectSymbol(sec.topSeller!.symbol)}
                    className="text-red-600 dark:text-red-400 hover:underline font-semibold"
                    title={`Top seller: Rs ${sec.topSeller.turnoverCr.toFixed(1)} cr`}
                  >
                    ↓{sec.topSeller.symbol}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ 4. Aha! Signals Strip
export const DirectionAhaStrip: React.FC<{
  items: DirectionEnrichedRow[];
  topPct: number;
  onInspectSymbol: (symbol: string) => void;
}> = ({ items, topPct, onInspectSymbol }) => {
  const dualTop = useMemo(
    () =>
      items
        .filter((i) => i.isDualConfluence)
        .sort((a, b) => (b.fundScore ?? 0) + b.momentumScore - ((a.fundScore ?? 0) + a.momentumScore))
        .slice(0, 3),
    [items]
  );

  const pullbackTop = useMemo(
    () =>
      items
        .filter((i) => i.isQualityPullback)
        .sort((a, b) => (b.fundScore ?? 0) - (a.fundScore ?? 0))
        .slice(0, 3),
    [items]
  );

  const instTop = useMemo(
    () =>
      items
        .filter((i) => i.directionGroup === 'up' && i.isInstitutionalTicket)
        .sort((a, b) => b.avgTradeSize - a.avgTradeSize)
        .slice(0, 3),
    [items]
  );

  const hollowTop = useMemo(
    () =>
      items
        .filter((i) => i.isHollowRally)
        .sort((a, b) => b.turnoverCr - a.turnoverCr)
        .slice(0, 3),
    [items]
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
            Dual-Engine Leaders
          </span>
          <span className="font-mono text-[11px] text-slate-400">Fund + Flow + Setup</span>
        </div>
        {dualTop.length > 0 ? (
          <div className="space-y-1 text-xs">
            {dualTop.map((it) => (
              <button
                key={it.symbol}
                type="button"
                onClick={() => onInspectSymbol(it.symbol)}
                className="w-full flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 px-1.5 py-1 rounded transition-colors"
              >
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {it.symbol}
                </span>
                <span className="font-mono tabular-nums text-[11px] text-emerald-600 dark:text-emerald-400">
                  F:{it.fundScore?.toFixed(0)} · M:{it.momentumScore.toFixed(0)} · {it.technical?.grade}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">
            No Top-{topPct}% buyers align with both Fund ≥55 and Grade A–C ICT setup in this range.
          </p>
        )}
      </div>

      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-blue-700 dark:text-blue-400">
            Quality Pullback Radar
          </span>
          <span className="font-mono text-[11px] text-slate-400">Strong Fund on Dip</span>
        </div>
        {pullbackTop.length > 0 ? (
          <div className="space-y-1 text-xs">
            {pullbackTop.map((it) => (
              <button
                key={it.symbol}
                type="button"
                onClick={() => onInspectSymbol(it.symbol)}
                className="w-full flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 px-1.5 py-1 rounded transition-colors"
              >
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {it.symbol}
                </span>
                <span className="font-mono tabular-nums text-[11px] text-blue-600 dark:text-blue-400">
                  F:{it.fundScore?.toFixed(0)} · MoS {it.fundamental?.keyMetrics.marginOfSafetyPct?.toFixed(0) ?? '–'}% · {formatPct(it.changePct)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">
            No high-turnover undervalued companies (Fund ≥58) are in pullback mode right now.
          </p>
        )}
      </div>

      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-teal-700 dark:text-teal-400">
            Institutional Size Flow
          </span>
          <span className="font-mono text-[11px] text-slate-400">≥Rs 2.5L / Trade</span>
        </div>
        {instTop.length > 0 ? (
          <div className="space-y-1 text-xs">
            {instTop.map((it) => (
              <button
                key={it.symbol}
                type="button"
                onClick={() => onInspectSymbol(it.symbol)}
                className="w-full flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 px-1.5 py-1 rounded transition-colors"
              >
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {it.symbol}
                </span>
                <span className="font-mono tabular-nums text-[11px] text-teal-600 dark:text-teal-400">
                  Rs {Math.round(it.avgTradeSize / 1000)}k/trd · {it.turnoverCr.toFixed(1)}cr
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">
            Active buying turnover is largely retail-sized (&lt;Rs 2.5L/trade) in this window.
          </p>
        )}
      </div>

      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
            <ShieldAlert className="w-3.5 h-3.5" />
            Hollow / Block Watch
          </span>
          <span className="font-mono text-[11px] text-slate-400">Weak Close / Block</span>
        </div>
        {hollowTop.length > 0 ? (
          <div className="space-y-1 text-xs">
            {hollowTop.map((it) => (
              <button
                key={it.symbol}
                type="button"
                onClick={() => onInspectSymbol(it.symbol)}
                className="w-full flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 px-1.5 py-1 rounded transition-colors"
              >
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {it.symbol}
                </span>
                <span className="font-mono tabular-nums text-[11px] text-amber-600 dark:text-amber-400">
                  {it.isBlockWarning ? 'Block' : `Close ${it.closePosPct.toFixed(0)}%`} · {formatPct(it.changePct)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">
            No block-trade distortions or weak-close hollow rallies detected among Top-{topPct}% gainers.
          </p>
        )}
      </div>
    </div>
  );
};
