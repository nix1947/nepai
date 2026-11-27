import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Compass,
  Crosshair,
  GitCompare,
  Layers,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import type { AnalyzerScanRow } from '../../types/analyzer';
import type { ScreenedCompanyRow } from '../../types/fundamental';
import type {
  CompareStockSummary,
  OpportunityRadarResponse,
  RadarPoint,
  SectorRotationQuadrantNode,
  SmartMoneyRadarRow,
} from '../../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../../utils/format';

export interface RadarEnrichedStock {
  symbol: string;
  name: string;
  sector: string;
  ltp: number | null;
  changePct: number | null;
  turnover: number | null;
  turnoverMult: number | null;
  periodReturnN: number | null;
  upDownVolRatio: number | null;
  vwapPct: number | null;
  radar?: RadarPoint;
  smartMoney?: SmartMoneyRadarRow;
  fundamental?: ScreenedCompanyRow;
  technical?: AnalyzerScanRow;
  fundScore: number | null;
  techScore: number;
  confluenceScore: number;
  isDualConfluence: boolean;
}

const CATEGORY_META: Record<
  RadarPoint['category'],
  { label: string; short: string; color: string }
> = {
  acceleration: {
    label: 'Turnover Acceleration',
    short: 'Turn Accel',
    color: '#10b981',
  },
  accumulation: {
    label: 'Stealth Accumulation',
    short: 'Stealth Accum',
    color: '#2563eb',
  },
  bullish_div: {
    label: 'Silent Absorption',
    short: 'Absorption',
    color: '#0d9488',
  },
  breakout_watch: {
    label: 'Breakout Watch',
    short: 'Breakout',
    color: '#d97706',
  },
  bearish_div: {
    label: 'Weak-Vol Exhaustion',
    short: 'Exhaustion',
    color: '#ef4444',
  },
};

function computeTechConfluenceScore(
  radar?: RadarPoint,
  smartMoney?: SmartMoneyRadarRow,
  technical?: AnalyzerScanRow
): number {
  const parts: Array<{ score: number; weight: number }> = [];
  if (technical) {
    parts.push({ score: technical.score, weight: 0.45 });
  }
  if (smartMoney) {
    parts.push({ score: smartMoney.smartMoneyScore, weight: 0.3 });
  }
  if (radar) {
    const adjusted =
      radar.category === 'bearish_div'
        ? Math.max(15, 55 - radar.radarScore * 0.4)
        : radar.radarScore;
    parts.push({ score: adjusted, weight: 0.25 });
  }
  if (parts.length === 0) return 0;
  const totalW = parts.reduce((s, p) => s + p.weight, 0);
  return Math.round((parts.reduce((s, p) => s + p.score * p.weight, 0) / totalW) * 10) / 10;
}

export function buildEnrichedRadarUniverse(
  radar: OpportunityRadarResponse | null,
  fundamentals: ScreenedCompanyRow[],
  analyzerRows: AnalyzerScanRow[]
): RadarEnrichedStock[] {
  const fundMap = new Map(fundamentals.map((f) => [f.symbol.toUpperCase(), f]));
  const techMap = new Map(analyzerRows.map((a) => [a.symbol.toUpperCase(), a]));
  const radarMap = new Map((radar?.points ?? []).map((p) => [p.symbol.toUpperCase(), p]));
  const smMap = new Map((radar?.smartMoneyLeaders ?? []).map((s) => [s.symbol.toUpperCase(), s]));

  const allSymbols = new Set<string>([
    ...radarMap.keys(),
    ...smMap.keys(),
    ...techMap.keys(),
  ]);

  const out: RadarEnrichedStock[] = [];
  for (const sym of allSymbols) {
    const r = radarMap.get(sym);
    const sm = smMap.get(sym);
    const tech = techMap.get(sym);
    const fund = fundMap.get(sym);

    const name = r?.name || sm?.name || tech?.name || fund?.companyName || sym;
    const sector = r?.sector || sm?.sector || tech?.sector || fund?.sector || 'Other';
    const ltp = r?.ltp ?? sm?.ltp ?? tech?.close ?? fund?.market.ltp ?? null;
    const changePct = r?.changePct ?? sm?.changePct ?? fund?.market.changePct ?? null;
    const turnover = r?.turnover ?? fund?.market.turnover ?? null;
    const turnoverMult = r?.turnoverMult ?? fund?.market.turnoverMultN ?? null;
    const periodReturnN = r?.periodReturnN ?? fund?.market.periodReturnNPct ?? null;
    const upDownVolRatio = r?.upDownVolRatio ?? sm?.upDownVolRatio ?? null;
    const vwapPct = r?.vwapPct ?? sm?.vwapPct ?? null;

    const fundScore = fund && fund.hasFundamentalData ? fund.scores.overallScore : null;
    const techScore = computeTechConfluenceScore(r, sm, tech);
    const confluenceScore =
      fundScore !== null
        ? Math.round((fundScore * 0.5 + techScore * 0.5) * 10) / 10
        : Math.round(techScore * 0.72 * 10) / 10;

    const isDualConfluence =
      fundScore !== null &&
      fundScore >= 55 &&
      techScore >= 55 &&
      r?.category !== 'bearish_div';

    out.push({
      symbol: sym,
      name,
      sector,
      ltp,
      changePct,
      turnover,
      turnoverMult,
      periodReturnN,
      upDownVolRatio,
      vwapPct,
      radar: r,
      smartMoney: sm,
      fundamental: fund,
      technical: tech,
      fundScore,
      techScore,
      confluenceScore,
      isDualConfluence,
    });
  }

  return out.sort((a, b) => b.confluenceScore - a.confluenceScore);
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
    const textW = pt.symbol.length * 6.4 + 6;
    const textH = 12;

    let chosen: LabelPlacement | null = null;
    for (const off of offsets) {
      const dist = pt.r + 7;
      const lx = pt.x + off.dx * dist;
      const ly = pt.y + off.dy * dist;
      const x1 =
        off.anchor === 'middle'
          ? lx - textW / 2
          : off.anchor === 'start'
            ? lx
            : lx - textW;
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

    if (!chosen && pt.forced) {
      const lx = Math.max(bounds.minX + 20, Math.min(bounds.maxX - 20, pt.x));
      const ly = Math.max(bounds.minY + 12, pt.y - pt.r - 8);
      chosen = {
        symbol: pt.symbol,
        lx,
        ly,
        anchor: 'middle',
        px: pt.x,
        py: pt.y,
        r: pt.r,
        color: pt.color,
      };
    }

    if (chosen) results.push(chosen);
  }

  return results;
}

type MatrixMode = 'tape' | 'confluence' | 'value_momentum';

interface ConfluenceOpportunityMatrixProps {
  items: RadarEnrichedStock[];
  radar: OpportunityRadarResponse | null;
  nDays: number;
  selectedDay: string;
  loading: boolean;
  loadingExtra: boolean;
  compareSymbols: string[];
  onToggleCompare: (symbol: string) => void;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer?: (symbol: string) => void;
  onInspectInQuant?: (symbol: string) => void;
}

export const ConfluenceOpportunityMatrix: React.FC<ConfluenceOpportunityMatrixProps> = ({
  items,
  radar,
  nDays,
  selectedDay,
  loading,
  loadingExtra,
  compareSymbols,
  onToggleCompare,
  onInspectSymbol,
  onInspectInAnalyzer,
  onInspectInQuant,
}) => {
  const [mode, setMode] = useState<MatrixMode>('confluence');
  const [searchText, setSearchText] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(null);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | RadarPoint['category']>('all');
  const [dualOnly, setDualOnly] = useState(false);
  const [labelMode, setLabelMode] = useState<'smart' | 'focused' | 'all'>('smart');
  const [isExpanded, setIsExpanded] = useState(false);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const visibleItems = useMemo(() => {
    return items.filter((it) => {
      if (dualOnly && !it.isDualConfluence) return false;
      if (categoryFilter !== 'all' && it.radar?.category !== categoryFilter) return false;

      if (mode === 'tape') return it.radar !== undefined;
      if (mode === 'confluence') return it.fundScore !== null && it.techScore > 0;
      if (mode === 'value_momentum') {
        return (
          it.fundamental?.keyMetrics.marginOfSafetyPct !== null &&
          it.fundamental?.keyMetrics.marginOfSafetyPct !== undefined &&
          it.periodReturnN !== null
        );
      }
      return true;
    });
  }, [items, dualOnly, categoryFilter, mode]);

  const searchMatches = useMemo(() => {
    const q = searchText.trim().toUpperCase();
    if (!q) return [];
    return items
      .filter(
        (it) =>
          it.symbol.toUpperCase().includes(q) || it.name.toUpperCase().includes(q)
      )
      .sort((a, b) => {
        const ae = a.symbol.startsWith(q) ? 0 : 1;
        const be = b.symbol.startsWith(q) ? 0 : 1;
        return ae - be || b.confluenceScore - a.confluenceScore;
      })
      .slice(0, 7);
  }, [items, searchText]);

  const activeSymbol = hoveredSymbol || pinnedSymbol;
  const activeStock = useMemo(
    () => (activeSymbol ? items.find((it) => it.symbol === activeSymbol) ?? null : null),
    [items, activeSymbol]
  );

  // Geometry
  const W = isExpanded ? 940 : 720;
  const H = isExpanded ? 400 : 330;
  const PAD = { t: 24, r: 24, b: 40, l: 56 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const axisConfig = useMemo(() => {
    if (mode === 'tape') {
      const maxTurn = Math.max(
        3.5,
        ...visibleItems.map((it) => Math.min(5.5, it.turnoverMult ?? 1))
      );
      return {
        xLabel: `Turnover vs ${nDays}-Day Average (×)`,
        yLabel: 'Daily Price Change (%)',
        xMin: 0.2,
        xMax: maxTurn,
        yMin: -10,
        yMax: 10,
        xThresh: 1.75,
        yThresh: 0,
        sweetTitle: 'High-Conviction Momentum Zone (≥1.75x Turn & Up)',
        xTicks: [0.5, 1, 1.75, 2.5, 3.5, 4.5].filter((v) => v <= maxTurn),
        yTicks: [-10, -5, 0, 5, 10],
        formatX: (v: number) => `${v.toFixed(v === 1.75 ? 2 : 1)}x`,
        formatY: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
        getX: (it: RadarEnrichedStock) =>
          Math.max(0.2, Math.min(maxTurn, it.turnoverMult ?? 1)),
        getY: (it: RadarEnrichedStock) =>
          Math.max(-10, Math.min(10, it.changePct ?? 0)),
      };
    }

    if (mode === 'confluence') {
      return {
        xLabel: 'Fundamental Overall Score (9-Investor + Valuation, 0–100)',
        yLabel: 'Technical & Smart-Money Confluence (0–100)',
        xMin: 15,
        xMax: 95,
        yMin: 20,
        yMax: 100,
        xThresh: 60,
        yThresh: 60,
        sweetTitle: 'Dual-Engine Sweet Spot (Fund ≥ 60 & Tech ≥ 60)',
        xTicks: [20, 40, 60, 80],
        yTicks: [25, 45, 60, 80, 95],
        formatX: (v: number) => `${v.toFixed(0)}`,
        formatY: (v: number) => `${v.toFixed(0)}`,
        getX: (it: RadarEnrichedStock) =>
          Math.max(15, Math.min(95, it.fundScore ?? 30)),
        getY: (it: RadarEnrichedStock) =>
          Math.max(20, Math.min(100, it.techScore)),
      };
    }

    // value_momentum
    const mosVals = visibleItems.map((it) => it.fundamental?.keyMetrics.marginOfSafetyPct ?? 0);
    const retVals = visibleItems.map((it) => it.periodReturnN ?? 0);
    const xMin = Math.max(-60, Math.min(-25, Math.floor(Math.min(0, ...mosVals) / 10) * 10));
    const xMax = Math.min(85, Math.max(45, Math.ceil(Math.max(30, ...mosVals) / 10) * 10));
    const yMin = Math.max(-25, Math.min(-10, Math.floor(Math.min(0, ...retVals) / 5) * 5));
    const yMax = Math.min(45, Math.max(15, Math.ceil(Math.max(10, ...retVals) / 5) * 5));
    return {
      xLabel: 'Margin of Safety vs Intrinsic Value (%)',
      yLabel: `${nDays}-Day Price Momentum (%)`,
      xMin,
      xMax,
      yMin,
      yMax,
      xThresh: 15,
      yThresh: 0,
      sweetTitle: 'Undervalued + Positive Momentum (MoS ≥ 15% & Up)',
      xTicks: [-40, -20, 0, 15, 30, 50, 70].filter((v) => v >= xMin && v <= xMax),
      yTicks: [-20, -10, 0, 10, 20, 30].filter((v) => v >= yMin && v <= yMax),
      formatX: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
      formatY: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
      getX: (it: RadarEnrichedStock) =>
        Math.max(xMin, Math.min(xMax, it.fundamental?.keyMetrics.marginOfSafetyPct ?? 0)),
      getY: (it: RadarEnrichedStock) =>
        Math.max(yMin, Math.min(yMax, it.periodReturnN ?? 0)),
    };
  }, [mode, visibleItems, nDays]);

  const toX = (val: number) =>
    PAD.l + ((val - axisConfig.xMin) / Math.max(1e-6, axisConfig.xMax - axisConfig.xMin)) * plotW;
  const toY = (val: number) =>
    PAD.t + ((axisConfig.yMax - val) / Math.max(1e-6, axisConfig.yMax - axisConfig.yMin)) * plotH;

  const plotted = useMemo(() => {
    const maxTurn = Math.max(1, ...visibleItems.map((it) => it.turnover ?? 0));
    return visibleItems.map((it) => {
      const xv = axisConfig.getX(it);
      const yv = axisConfig.getY(it);
      const x = toX(xv);
      const y = toY(yv);
      const turnRatio = (it.turnover ?? 0) / maxTurn;
      const r =
        mode === 'confluence'
          ? 5 + Math.sqrt(Math.max(0.04, (it.turnoverMult ?? 1) / 4)) * 7
          : 4.5 + Math.sqrt(turnRatio) * 9.5;
      const color = it.radar
        ? CATEGORY_META[it.radar.category].color
        : it.isDualConfluence
          ? '#10b981'
          : '#6366f1';
      return { stock: it, x, y, r, color };
    });
  }, [visibleItems, axisConfig, mode]);

  const labelPlacements = useMemo(() => {
    if (labelMode === 'focused') {
      return plotted
        .filter(
          (p) =>
            p.stock.symbol === activeSymbol ||
            compareSymbols.includes(p.stock.symbol)
        )
        .map((p) => ({
          symbol: p.stock.symbol,
          lx: p.x,
          ly: p.y - p.r - 5,
          anchor: 'middle' as const,
          px: p.x,
          py: p.y,
          r: p.r,
          color: p.color,
        }));
    }

    const q = searchText.trim().toUpperCase();
    const maxLabels = labelMode === 'all' ? plotted.length : isExpanded ? 26 : 16;
    return resolveSmartLabels(
      plotted.map((p) => ({
        symbol: p.stock.symbol,
        x: p.x,
        y: p.y,
        r: p.r,
        color: p.color,
        priority:
          p.stock.confluenceScore +
          (p.stock.isDualConfluence ? 20 : 0) +
          (p.stock.technical?.grade === 'A' ? 12 : 0),
        forced:
          p.stock.symbol === activeSymbol ||
          compareSymbols.includes(p.stock.symbol) ||
          (q.length > 0 && p.stock.symbol.includes(q)),
      })),
      { minX: PAD.l + 4, maxX: W - PAD.r - 4, minY: PAD.t + 10, maxY: H - PAD.b - 4 },
      maxLabels
    );
  }, [plotted, labelMode, activeSymbol, compareSymbols, searchText, isExpanded, W, H]);

  const dualConfluenceCount = useMemo(
    () => items.filter((it) => it.isDualConfluence).length,
    [items]
  );
  const gradeABTechCount = useMemo(
    () =>
      items.filter(
        (it) =>
          it.technical &&
          (it.technical.grade === 'A' || it.technical.grade === 'B')
      ).length,
    [items]
  );

  const threshX = toX(axisConfig.xThresh);
  const threshY = toY(axisConfig.yThresh);
  const searchUpper = searchText.trim().toUpperCase();

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
      <div
        className={`${
          isExpanded ? 'xl:col-span-12' : 'xl:col-span-8'
        } border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3 flex flex-col justify-between`}
      >
        {/* Top Row: Title + Mode Switch + Expand */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Compass className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {mode === 'confluence'
                ? 'Fundamental × Technical Confluence Matrix'
                : mode === 'value_momentum'
                  ? 'Intrinsic Margin of Safety × Momentum Matrix'
                  : 'Visual Opportunity Quadrant (Turnover Multiple vs Daily Change)'}
            </h3>
            {loadingExtra && (
              <span className="text-[11px] font-mono text-slate-400">Syncing Fund/ICT…</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center p-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px]">
              {[
                { id: 'confluence' as MatrixMode, label: 'Fund × Tech' },
                { id: 'tape' as MatrixMode, label: 'Turn × Price' },
                { id: 'value_momentum' as MatrixMode, label: 'MoS × Return' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`px-2.5 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                    mode === m.id
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              {isExpanded ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Compact</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Expand</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Second Row: Instant Scrip Search + Confluence Filter + Labels + Category Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-slate-100 dark:border-slate-800/80 py-2 text-xs">
          <div className="relative min-w-[190px] flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 140)}
              onChange={(e) => {
                setSearchText(e.target.value);
                setSearchFocused(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchMatches.length > 0) {
                  setPinnedSymbol(searchMatches[0].symbol);
                  setSearchText(searchMatches[0].symbol);
                  setSearchFocused(false);
                } else if (e.key === 'Escape') {
                  setSearchText('');
                  setPinnedSymbol(null);
                }
              }}
              placeholder="Locate scrip (e.g. NABIL, SAHAS)…"
              className="w-full pl-8 pr-7 py-1 text-xs rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
            {(searchText || pinnedSymbol) && (
              <button
                type="button"
                onClick={() => {
                  setSearchText('');
                  setPinnedSymbol(null);
                }}
                aria-label="Clear scrip locator"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {searchFocused && searchMatches.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 shadow-lg divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-auto">
                {searchMatches.map((m) => (
                  <button
                    key={m.symbol}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setPinnedSymbol(m.symbol);
                      setSearchText(m.symbol);
                      setSearchFocused(false);
                    }}
                    className="w-full px-2.5 py-1.5 text-left flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px]"
                  >
                    <div className="min-w-0 truncate">
                      <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {m.symbol}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400 ml-1.5">
                        {m.sector}
                      </span>
                    </div>
                    <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                      F:{m.fundScore !== null ? m.fundScore.toFixed(0) : '–'} · T:{m.techScore.toFixed(0)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => setDualOnly((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border whitespace-nowrap ${
                dualOnly
                  ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Target className="w-3 h-3" />
              <span>Dual Confluence ({dualConfluenceCount})</span>
            </button>

            <select
              value={labelMode}
              onChange={(e) => setLabelMode(e.target.value as 'smart' | 'focused' | 'all')}
              aria-label="Label Density"
              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
            >
              <option value="smart">Labels: Smart</option>
              <option value="focused">Labels: Focus</option>
              <option value="all">Labels: All</option>
            </select>

            {(categoryFilter !== 'all' || dualOnly || pinnedSymbol) && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('all');
                  setDualOnly(false);
                  setPinnedSymbol(null);
                  setSearchText('');
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Clickable Category Filter Legend */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {Object.entries(CATEGORY_META).map(([k, meta]) => {
            const key = k as RadarPoint['category'];
            const active = categoryFilter === key;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCategoryFilter((prev) => (prev === key ? 'all' : key))}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border transition-colors whitespace-nowrap ${
                  active
                    ? 'border-slate-900 dark:border-slate-200 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-xs shrink-0"
                  style={{ backgroundColor: meta.color }}
                />
                <span>{meta.label}</span>
              </button>
            );
          })}
          <span className="text-slate-400 ml-auto font-mono tabular-nums">
            {plotted.length} plotted
          </span>
        </div>

        {/* Plot Canvas */}
        {loading ? (
          <div className="h-[320px] animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
        ) : plotted.length === 0 ? (
          <div className="h-[320px] flex flex-col items-center justify-center gap-2 text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded">
            <span>No stocks matched this matrix filter for {selectedDay}.</span>
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('all');
                setDualOnly(false);
              }}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Reset matrix filters
            </button>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            onMouseMove={(e) => {
              const svg = svgRef.current;
              if (!svg) return;
              const rect = svg.getBoundingClientRect();
              const mx = ((e.clientX - rect.left) / rect.width) * W;
              const my = ((e.clientY - rect.top) / rect.height) * H;
              if (mx >= PAD.l && mx <= W - PAD.r && my >= PAD.t && my <= H - PAD.b) {
                setCrosshair({ x: mx, y: my });
              } else {
                setCrosshair(null);
              }
            }}
            onMouseLeave={() => setCrosshair(null)}
            className="w-full h-auto select-none overflow-visible"
          >
            {/* Sweet Spot Quadrant */}
            {threshX >= PAD.l && threshX <= W - PAD.r && threshY >= PAD.t && threshY <= H - PAD.b && (
              <rect
                x={threshX}
                y={PAD.t}
                width={Math.max(0, W - PAD.r - threshX)}
                height={Math.max(0, threshY - PAD.t)}
                className="fill-emerald-500/8 dark:fill-emerald-400/10"
              />
            )}

            {/* Gridlines */}
            {axisConfig.xTicks.map((t) => (
              <g key={`xt-${t}`}>
                <line
                  x1={toX(t)}
                  y1={PAD.t}
                  x2={toX(t)}
                  y2={H - PAD.b}
                  className="stroke-slate-100 dark:stroke-slate-800/80"
                />
                <text
                  x={toX(t)}
                  y={H - PAD.b + 14}
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  {axisConfig.formatX(t)}
                </text>
              </g>
            ))}
            {axisConfig.yTicks.map((t) => (
              <g key={`yt-${t}`}>
                <line
                  x1={PAD.l}
                  y1={toY(t)}
                  x2={W - PAD.r}
                  y2={toY(t)}
                  className="stroke-slate-100 dark:stroke-slate-800/80"
                />
                <text
                  x={PAD.l - 8}
                  y={toY(t) + 3}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  {axisConfig.formatY(t)}
                </text>
              </g>
            ))}

            {/* Threshold Lines */}
            <line
              x1={PAD.l}
              y1={threshY}
              x2={W - PAD.r}
              y2={threshY}
              stroke="#94a3b8"
              strokeDasharray="4 3"
              strokeOpacity={0.55}
            />
            <line
              x1={threshX}
              y1={PAD.t}
              x2={threshX}
              y2={H - PAD.b}
              stroke="#f59e0b"
              strokeDasharray="4 3"
              strokeOpacity={0.65}
            />

            {/* Plot frame */}
            <rect
              x={PAD.l}
              y={PAD.t}
              width={plotW}
              height={plotH}
              fill="none"
              className="stroke-slate-200 dark:stroke-slate-800"
            />

            {/* Sweet-Spot Label */}
            <text
              x={W - PAD.r - 6}
              y={PAD.t + 14}
              textAnchor="end"
              fontSize="10"
              fontWeight="600"
              className="fill-emerald-600 dark:fill-emerald-400"
            >
              {axisConfig.sweetTitle}
            </text>

            {/* Crosshair */}
            {crosshair && (
              <g pointerEvents="none">
                <line
                  x1={crosshair.x}
                  y1={PAD.t}
                  x2={crosshair.x}
                  y2={H - PAD.b}
                  className="stroke-slate-400/50"
                  strokeDasharray="2 2"
                />
                <line
                  x1={PAD.l}
                  y1={crosshair.y}
                  x2={W - PAD.r}
                  y2={crosshair.y}
                  className="stroke-slate-400/50"
                  strokeDasharray="2 2"
                />
              </g>
            )}

            {/* Axes Titles */}
            <text
              x={PAD.l + plotW / 2}
              y={H - 6}
              textAnchor="middle"
              fontSize="11"
              className="fill-slate-500 dark:fill-slate-400"
            >
              {axisConfig.xLabel}
            </text>
            <text
              x={14}
              y={PAD.t + plotH / 2}
              textAnchor="middle"
              fontSize="11"
              className="fill-slate-500 dark:fill-slate-400"
              transform={`rotate(-90 14 ${PAD.t + plotH / 2})`}
            >
              {axisConfig.yLabel}
            </text>

            {/* Bubbles */}
            {plotted.map(({ stock, x, y, r, color }) => {
              const isSelected = activeSymbol === stock.symbol;
              const isMatch =
                searchUpper.length > 0 && stock.symbol.toUpperCase().includes(searchUpper);
              const dimmed =
                (searchUpper.length > 0 && !isMatch && !isSelected) ||
                (pinnedSymbol !== null && pinnedSymbol !== stock.symbol && hoveredSymbol === null);
              return (
                <g
                  key={stock.symbol}
                  onMouseEnter={() => setHoveredSymbol(stock.symbol)}
                  onMouseLeave={() => setHoveredSymbol(null)}
                  onClick={() =>
                    setPinnedSymbol((prev) =>
                      prev === stock.symbol ? null : stock.symbol
                    )
                  }
                  className="cursor-pointer"
                >
                  {(isSelected || isMatch) && (
                    <circle
                      cx={x}
                      cy={y}
                      r={r + 5}
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth={1.8}
                      strokeDasharray="3 2"
                    />
                  )}
                  {stock.isDualConfluence && !dimmed && (
                    <circle
                      cx={x}
                      cy={y}
                      r={r + 2}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={1.2}
                      strokeOpacity={0.7}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={isSelected ? r + 2 : r}
                    fill={color}
                    fillOpacity={dimmed ? 0.2 : isSelected ? 0.96 : 0.78}
                    stroke={isSelected ? '#0f172a' : '#ffffff'}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                </g>
              );
            })}

            {/* Collision-free Smart Labels + Leader Lines */}
            {labelPlacements.map((lb) => {
              const dist = Math.hypot(lb.lx - lb.px, lb.ly - lb.py);
              const isSelected = activeSymbol === lb.symbol;
              return (
                <g key={`lbl-${lb.symbol}`} pointerEvents="none">
                  {dist > lb.r + 9 && (
                    <line
                      x1={lb.px}
                      y1={lb.py}
                      x2={lb.lx}
                      y2={lb.ly - 3}
                      className="stroke-slate-400/70 dark:stroke-slate-500/70"
                      strokeWidth={0.85}
                    />
                  )}
                  <text
                    x={lb.lx}
                    y={lb.ly}
                    textAnchor={lb.anchor}
                    fontSize={isSelected ? '10.5' : '9.5'}
                    fontWeight={isSelected ? '700' : '600'}
                    className={`font-mono ${
                      isSelected
                        ? 'fill-amber-600 dark:fill-amber-400'
                        : 'fill-slate-700 dark:fill-slate-200'
                    }`}
                  >
                    {lb.symbol}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Right-hand Live 3-Pillar Dossier */}
      <div
        className={`${
          isExpanded ? 'xl:col-span-12' : 'xl:col-span-4'
        } border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col justify-between space-y-3`}
      >
        {activeStock ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold font-mono text-blue-600 dark:text-blue-400">
                    {activeStock.symbol}
                  </span>
                  {activeStock.isDualConfluence && (
                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Dual Confluence
                    </span>
                  )}
                  {activeStock.radar && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      · {CATEGORY_META[activeStock.radar.category].short}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {activeStock.name} · {activeStock.sector}
                </div>
              </div>
              <div className="text-right font-mono tabular-nums shrink-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Confluence {activeStock.confluenceScore.toFixed(0)}
                </div>
                {pinnedSymbol === activeStock.symbol && (
                  <button
                    type="button"
                    onClick={() => setPinnedSymbol(null)}
                    className="text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-sans"
                  >
                    Unpin
                  </button>
                )}
              </div>
            </div>

            {activeStock.radar?.headline && (
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-950 p-2.5 rounded border border-slate-100 dark:border-slate-800">
                {activeStock.radar.headline}
              </p>
            )}

            {/* 3-Pillar Grid: Tape / Fundamental / Technical */}
            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  <span>Tape &amp; Smart Money</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    LTP {formatNum(activeStock.ltp)} ({formatPct(activeStock.changePct)})
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-300">
                  <span>
                    Turn:{' '}
                    <strong className="text-amber-600 dark:text-amber-400">
                      {activeStock.turnoverMult !== null
                        ? `${activeStock.turnoverMult.toFixed(2)}x`
                        : '–'}
                    </strong>
                  </span>
                  <span>
                    Up/Dn:{' '}
                    {activeStock.upDownVolRatio !== null
                      ? `${activeStock.upDownVolRatio.toFixed(2)}x`
                      : '–'}
                  </span>
                  <span>
                    SM:{' '}
                    {activeStock.smartMoney
                      ? `${activeStock.smartMoney.smartMoneyScore.toFixed(0)}/100`
                      : '–'}
                  </span>
                  {activeStock.smartMoney?.pocketPivot && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      Pocket Pivot
                    </span>
                  )}
                </div>
              </div>

              <div className="p-2.5 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  <span>Fundamental Intelligence</span>
                  <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                    {activeStock.fundScore !== null
                      ? `${activeStock.fundScore.toFixed(0)}/100 · ${activeStock.fundamental?.recommendation.verdict ?? ''}`
                      : 'Pending Statement'}
                  </span>
                </div>
                {activeStock.fundamental && activeStock.fundamental.hasFundamentalData ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-300">
                    <span>
                      P/E:{' '}
                      {activeStock.fundamental.keyMetrics.pe !== null
                        ? `${activeStock.fundamental.keyMetrics.pe.toFixed(1)}x`
                        : '–'}
                    </span>
                    <span>
                      MoS:{' '}
                      <strong
                        className={
                          (activeStock.fundamental.keyMetrics.marginOfSafetyPct ?? 0) >= 15
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }
                      >
                        {formatPct(activeStock.fundamental.keyMetrics.marginOfSafetyPct)}
                      </strong>
                    </span>
                    <span>
                      ROE:{' '}
                      {activeStock.fundamental.keyMetrics.roePct !== null
                        ? `${activeStock.fundamental.keyMetrics.roePct.toFixed(1)}%`
                        : '–'}
                    </span>
                    <span>
                      Pass: {activeStock.fundamental.passedInvestorCount}/9
                    </span>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    No quarterly filing parsed yet for this scrip.
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  <span>Technical / ICT / Wyckoff</span>
                  <span className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                    {activeStock.technical
                      ? `Grade ${activeStock.technical.grade} (${activeStock.technical.score.toFixed(0)})`
                      : `Tech ${activeStock.techScore.toFixed(0)}/100`}
                  </span>
                </div>
                {activeStock.technical ? (
                  <div className="space-y-1 text-[11px]">
                    <div className="text-slate-800 dark:text-slate-200 font-medium truncate">
                      {activeStock.technical.strategy}: {activeStock.technical.setupName}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      <span>Entry {formatNum(activeStock.technical.entryMid)}</span>
                      <span>SL {formatNum(activeStock.technical.stopLoss)}</span>
                      <span>T2 {formatNum(activeStock.technical.target2)}</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        1:{activeStock.technical.rrT2.toFixed(1)}R
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    No active Grade A/B/C ICT or Wyckoff long trigger on {selectedDay}.
                  </div>
                )}
              </div>
            </div>

            {/* Working Action Bar */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => onInspectSymbol(activeStock.symbol)}
                className="px-2.5 py-1.5 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
              >
                Open Chart
              </button>
              {onInspectInAnalyzer && (
                <button
                  type="button"
                  onClick={() => onInspectInAnalyzer(activeStock.symbol)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Crosshair className="w-3 h-3" />
                  <span>Auto Analyzer</span>
                </button>
              )}
              {onInspectInQuant && (
                <button
                  type="button"
                  onClick={() => onInspectInQuant(activeStock.symbol)}
                  className="px-2.5 py-1.5 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  Quant Gate
                </button>
              )}
              <button
                type="button"
                onClick={() => onToggleCompare(activeStock.symbol)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded border whitespace-nowrap ${
                  compareSymbols.includes(activeStock.symbol)
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <GitCompare className="w-3 h-3" />
                <span>{compareSymbols.includes(activeStock.symbol) ? 'Comparing' : '+ Compare'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-xs text-slate-500 dark:text-slate-400">
            <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
              Fundamental × Technical Signal Summary ({selectedDay})
            </div>
            <p className="leading-relaxed">
              Hover or click any bubble—or search a scrip above—to inspect its 3-pillar dossier combining tape acceleration, fundamentals, and ICT/SMC/Wyckoff setup levels.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1 font-mono tabular-nums">
              <div className="p-2.5 rounded bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
                <div className="text-[10px] font-sans text-emerald-700 dark:text-emerald-300">
                  Dual Confluence
                </div>
                <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                  {dualConfluenceCount}
                </div>
              </div>
              <div className="p-2.5 rounded bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
                <div className="text-[10px] font-sans text-blue-700 dark:text-blue-300">
                  ICT/SMC Setups
                </div>
                <div className="text-lg font-bold text-blue-700 dark:text-blue-300">
                  {gradeABTechCount}
                </div>
              </div>
              <div className="p-2.5 rounded bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900">
                <div className="text-[10px] font-sans text-teal-700 dark:text-teal-300">
                  Turnover Alerts
                </div>
                <div className="text-lg font-bold text-teal-700 dark:text-teal-300">
                  {radar?.accelerationAlerts.length ?? 0}
                </div>
              </div>
              <div className="p-2.5 rounded bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                <div className="text-[10px] font-sans text-amber-700 dark:text-amber-300">
                  Stealth + Watch
                </div>
                <div className="text-lg font-bold text-amber-700 dark:text-amber-300">
                  {(radar?.stealthAccumulation.length ?? 0) +
                    (radar?.breakoutWatchlist.length ?? 0)}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-2">
          Green outer ring = Dual-Confluence (Fund ≥ 55 &amp; Tech ≥ 55) · Click bubble to pin
        </div>
      </div>
    </div>
  );
};

type LeaderboardLens = 'balanced' | 'fund_led' | 'tech_led' | 'value_breakout';

interface ConfluenceLeaderboardChartProps {
  items: RadarEnrichedStock[];
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer?: (symbol: string) => void;
}

export const ConfluenceLeaderboardChart: React.FC<ConfluenceLeaderboardChartProps> = ({
  items,
  onInspectSymbol,
  onInspectInAnalyzer,
}) => {
  const [lens, setLens] = useState<LeaderboardLens>('balanced');

  const ranked = useMemo(() => {
    const scored = items
      .filter((it) => it.fundScore !== null && it.techScore > 0)
      .map((it) => {
        const f = it.fundScore ?? 0;
        const t = it.techScore;
        const mos = it.fundamental?.keyMetrics.marginOfSafetyPct ?? 0;
        const turnBonus = Math.min(15, ((it.turnoverMult ?? 1) - 1) * 10);
        let rankScore = f * 0.5 + t * 0.5;
        if (lens === 'fund_led') rankScore = f * 0.7 + t * 0.3;
        else if (lens === 'tech_led') rankScore = f * 0.3 + t * 0.7;
        else if (lens === 'value_breakout') {
          rankScore = f * 0.35 + t * 0.4 + Math.max(0, Math.min(25, mos)) + turnBonus * 0.5;
        }
        return { item: it, rankScore };
      })
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, 10);
    return scored;
  }, [items, lens]);

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Top Fundamental × Technical Confluence Leaders
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Paired 0–100 Fundamental Score vs Technical/ICT &amp; Smart-Money Confluence bars
            </p>
          </div>
        </div>

        <div className="inline-flex items-center p-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px]">
          {[
            { id: 'balanced' as LeaderboardLens, label: '50/50 Blend' },
            { id: 'fund_led' as LeaderboardLens, label: 'Fund-Led' },
            { id: 'tech_led' as LeaderboardLens, label: 'Tech-Led' },
            { id: 'value_breakout' as LeaderboardLens, label: 'Value + Turn' },
          ].map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLens(l.id)}
              className={`px-2 py-1 rounded font-medium whitespace-nowrap ${
                lens === l.id
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs text-slate-400">
          No dual Fundamental + Technical candidates found on this session.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1">
            <span>TICKER · SETUP / VERDICT</span>
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-xs bg-emerald-500 inline-block" /> Fund
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-xs bg-blue-600 inline-block" /> Tech
              </span>
              <span>MoS / R:R</span>
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {ranked.map(({ item }) => {
              const f = Math.max(0, Math.min(100, item.fundScore ?? 0));
              const t = Math.max(0, Math.min(100, item.techScore));
              const mos = item.fundamental?.keyMetrics.marginOfSafetyPct;
              const rr = item.technical?.rrT2;
              return (
                <div
                  key={item.symbol}
                  className="py-1.5 px-1 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded transition-colors text-xs"
                >
                  <div className="min-w-[130px] max-w-[165px]">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onInspectSymbol(item.symbol)}
                        className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {item.symbol}
                      </button>
                      {item.technical && (
                        <span className="font-mono text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                          {item.technical.grade}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {item.technical
                        ? item.technical.setupName
                        : item.fundamental?.recommendation.verdict ?? item.sector}
                    </div>
                  </div>

                  {/* Paired Progress Bars */}
                  <div className="flex-1 space-y-1 min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 dark:bg-emerald-400 rounded"
                          style={{ width: `${f}%` }}
                        />
                      </div>
                      <span className="w-7 text-right font-mono text-[10px] tabular-nums text-emerald-700 dark:text-emerald-300">
                        {f.toFixed(0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-blue-600 dark:bg-blue-400 rounded"
                          style={{ width: `${t}%` }}
                        />
                      </div>
                      <span className="w-7 text-right font-mono text-[10px] tabular-nums text-blue-700 dark:text-blue-300">
                        {t.toFixed(0)}
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono tabular-nums shrink-0 min-w-[78px]">
                    <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                      {mos !== null && mos !== undefined ? `MoS ${formatPct(mos)}` : 'MoS –'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {rr ? `1:${rr.toFixed(1)}R` : item.turnoverMult ? `${item.turnoverMult.toFixed(1)}x T` : '–'}
                    </div>
                  </div>

                  {onInspectInAnalyzer && (
                    <button
                      type="button"
                      onClick={() => onInspectInAnalyzer(item.symbol)}
                      title={`Analyze ${item.symbol} setups`}
                      className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 shrink-0"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

interface SectorFundTechChartProps {
  sectorMatrix: SectorRotationQuadrantNode[];
  fundamentals: ScreenedCompanyRow[];
  onInspectSymbol: (symbol: string) => void;
}

export const SectorFundTechChart: React.FC<SectorFundTechChartProps> = ({
  sectorMatrix,
  fundamentals,
  onInspectSymbol,
}) => {
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);

  const sectorNodes = useMemo(() => {
    const bySector = new Map<string, ScreenedCompanyRow[]>();
    for (const row of fundamentals) {
      if (!row.hasFundamentalData) continue;
      const list = bySector.get(row.sector) ?? [];
      list.push(row);
      bySector.set(row.sector, list);
    }

    return sectorMatrix
      .map((sec) => {
        const list = bySector.get(sec.sector) ?? [];
        const avgFund =
          list.length > 0
            ? list.reduce((s, r) => s + r.scores.overallScore, 0) / list.length
            : 45;
        const avgRoeList = list
          .map((r) => r.keyMetrics.roePct)
          .filter((v): v is number => v !== null);
        const avgRoe =
          avgRoeList.length > 0
            ? avgRoeList.reduce((s, v) => s + v, 0) / avgRoeList.length
            : null;
        const bestFund = [...list].sort(
          (a, b) => b.scores.overallScore - a.scores.overallScore
        )[0];

        return {
          ...sec,
          avgFundScore: Math.round(avgFund * 10) / 10,
          avgRoe: avgRoe !== null ? Math.round(avgRoe * 10) / 10 : null,
          evaluatedCount: list.length,
          bestFundSymbol: bestFund?.symbol ?? sec.leaderSymbol,
          bestFundScore: bestFund?.scores.overallScore ?? null,
        };
      })
      .filter((s) => s.stockCount > 0);
  }, [sectorMatrix, fundamentals]);

  const W = 540;
  const H = 290;
  const PAD = { t: 22, r: 22, b: 36, l: 48 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const xs = sectorNodes.map((n) => n.avgFundScore);
  const ys = sectorNodes.map((n) => n.rsRatio);
  const xMin = Math.max(20, Math.min(35, Math.floor((Math.min(40, ...xs) - 5) / 5) * 5));
  const xMax = Math.min(85, Math.max(65, Math.ceil((Math.max(60, ...xs) + 5) / 5) * 5));
  const maxDevY = Math.max(6, ...ys.map((v) => Math.abs(v - 100))) * 1.15;
  const yMin = 100 - maxDevY;
  const yMax = 100 + maxDevY;

  const toX = (v: number) => PAD.l + ((v - xMin) / Math.max(1, xMax - xMin)) * plotW;
  const toY = (v: number) => PAD.t + ((yMax - v) / Math.max(1, yMax - yMin)) * plotH;

  const qColor = (q: SectorRotationQuadrantNode['quadrant']) =>
    q === 'Leading'
      ? '#10b981'
      : q === 'Improving'
        ? '#2563eb'
        : q === 'Weakening'
          ? '#d97706'
          : '#ef4444';

  const activeSec =
    sectorNodes.find((s) => s.sector === hoveredSector) ?? sectorNodes[0] ?? null;

  const labels = useMemo(
    () =>
      resolveSmartLabels(
        sectorNodes.map((n) => ({
          symbol: n.sector
            .replace('Development Banks', 'DevBank')
            .replace('Commercial Banks', 'Banks')
            .replace('Hydro Power', 'Hydro')
            .replace('Hydropower', 'Hydro')
            .replace('Microfinance', 'Microfin')
            .replace('Non-Life Insurance', 'Non-Life')
            .replace('Life Insurance', 'Life Ins')
            .replace('Manufacturing & Processing', 'Mfg'),
          x: toX(n.avgFundScore),
          y: toY(n.rsRatio),
          r: 5 + Math.sqrt(Math.max(1, n.turnoverSharePct)) * 1.35,
          priority: n.turnoverSharePct + n.avgFundScore * 0.2,
          color: qColor(n.quadrant),
          forced: hoveredSector === n.sector,
        })),
        { minX: PAD.l + 4, maxX: W - PAD.r - 4, minY: PAD.t + 10, maxY: H - PAD.b - 4 },
        sectorNodes.length
      ),
    [sectorNodes, hoveredSector]
  );

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Sector Fundamental Value × Technical Rotation Map
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Avg Fundamental Score (X) vs Technical RS-Ratio vs NEPSE (Y) · Size = Turnover Share %
            </p>
          </div>
        </div>
      </div>

      {sectorNodes.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs text-slate-400">
          Sector rotation data unavailable.
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none overflow-visible">
            <rect
              x={toX(50)}
              y={PAD.t}
              width={Math.max(0, W - PAD.r - toX(50))}
              height={Math.max(0, toY(100) - PAD.t)}
              className="fill-emerald-500/8 dark:fill-emerald-400/10"
            />
            <line
              x1={PAD.l}
              y1={toY(100)}
              x2={W - PAD.r}
              y2={toY(100)}
              stroke="#94a3b8"
              strokeDasharray="3 3"
              strokeOpacity={0.6}
            />
            <line
              x1={toX(50)}
              y1={PAD.t}
              x2={toX(50)}
              y2={H - PAD.b}
              stroke="#94a3b8"
              strokeDasharray="3 3"
              strokeOpacity={0.6}
            />
            <rect
              x={PAD.l}
              y={PAD.t}
              width={plotW}
              height={plotH}
              fill="none"
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <text
              x={W - PAD.r - 6}
              y={PAD.t + 13}
              textAnchor="end"
              fontSize="9.5"
              fontWeight="600"
              className="fill-emerald-600 dark:fill-emerald-400"
            >
              Fund Strong + Technical Leading
            </text>
            <text
              x={PAD.l + plotW / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              className="fill-slate-500 dark:fill-slate-400"
            >
              Avg Sector Fundamental Score (0–100)
            </text>
            <text
              x={14}
              y={PAD.t + plotH / 2}
              textAnchor="middle"
              fontSize="10"
              className="fill-slate-500 dark:fill-slate-400"
              transform={`rotate(-90 14 ${PAD.t + plotH / 2})`}
            >
              RS-Ratio vs NEPSE (100 = Parity)
            </text>

            {[40, 50, 60, 70].map((v) =>
              v >= xMin && v <= xMax ? (
                <text
                  key={v}
                  x={toX(v)}
                  y={H - PAD.b + 13}
                  textAnchor="middle"
                  fontSize="9.5"
                  className="fill-slate-400 font-mono"
                >
                  {v}
                </text>
              ) : null
            )}
            <text
              x={PAD.l - 6}
              y={toY(100) + 3}
              textAnchor="end"
              fontSize="9.5"
              className="fill-slate-400 font-mono"
            >
              100
            </text>

            {sectorNodes.map((n) => {
              const x = toX(n.avgFundScore);
              const y = toY(n.rsRatio);
              const r = 5 + Math.sqrt(Math.max(1, n.turnoverSharePct)) * 1.35;
              const isHov = hoveredSector === n.sector;
              return (
                <circle
                  key={n.sector}
                  cx={x}
                  cy={y}
                  r={isHov ? r + 2 : r}
                  fill={qColor(n.quadrant)}
                  fillOpacity={isHov ? 0.95 : 0.78}
                  stroke={isHov ? '#0f172a' : '#ffffff'}
                  strokeWidth={isHov ? 2 : 1.2}
                  onMouseEnter={() => setHoveredSector(n.sector)}
                  onClick={() => onInspectSymbol(n.bestFundSymbol)}
                  className="cursor-pointer"
                />
              );
            })}

            {labels.map((lb) => (
              <text
                key={`sl-${lb.symbol}`}
                x={lb.lx}
                y={lb.ly}
                textAnchor={lb.anchor}
                fontSize="9.5"
                fontWeight="600"
                pointerEvents="none"
                className="fill-slate-700 dark:fill-slate-200 font-mono"
              >
                {lb.symbol}
              </text>
            ))}
          </svg>

          {activeSec && (
            <div className="px-3 py-2 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="min-w-0">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {activeSec.sector}
                </span>
                <span className="text-slate-500 dark:text-slate-400 ml-2 font-mono tabular-nums">
                  Fund {activeSec.avgFundScore.toFixed(1)} · RS {activeSec.rsRatio.toFixed(1)} · Share{' '}
                  {activeSec.turnoverSharePct.toFixed(1)}%
                  {activeSec.avgRoe !== null ? ` · Avg ROE ${activeSec.avgRoe.toFixed(1)}%` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onInspectSymbol(activeSec.bestFundSymbol)}
                className="font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
              >
                Top Pick: {activeSec.bestFundSymbol}{' '}
                {activeSec.bestFundScore !== null ? `(${activeSec.bestFundScore.toFixed(0)})` : ''} →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

interface ComparisonPillarMatrixProps {
  stocks: CompareStockSummary[];
  enrichedMap: Map<string, RadarEnrichedStock>;
  colors: string[];
  onInspectSymbol: (symbol: string) => void;
}

export const ComparisonPillarMatrix: React.FC<ComparisonPillarMatrixProps> = ({
  stocks,
  enrichedMap,
  colors,
  onInspectSymbol,
}) => {
  if (stocks.length === 0) return null;

  const pillars: Array<{
    key: string;
    label: string;
    extract: (st: CompareStockSummary, enr?: RadarEnrichedStock) => number | null;
  }> = [
    {
      key: 'fundQuality',
      label: 'Fundamental Quality',
      extract: (_st, enr) => enr?.fundamental?.scores.fundamentalQualityScore ?? null,
    },
    {
      key: 'valueScore',
      label: 'Intrinsic Valuation',
      extract: (_st, enr) => enr?.fundamental?.scores.valueScore ?? null,
    },
    {
      key: 'growthScore',
      label: 'Earnings Growth',
      extract: (_st, enr) => enr?.fundamental?.scores.growthScore ?? null,
    },
    {
      key: 'techSetup',
      label: 'Technical / ICT Setup',
      extract: (_st, enr) => enr?.technical?.score ?? enr?.techScore ?? null,
    },
    {
      key: 'smartMoney',
      label: 'Smart Money Flow',
      extract: (st, enr) =>
        enr?.smartMoney?.smartMoneyScore ??
        Math.min(100, Math.round(st.turnoverMultN * 28 + (st.pos52wPct ?? 40) * 0.4)),
    },
  ];

  return (
    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
          <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>5-Pillar Fundamental &amp; Technical Comparison</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
          {stocks.map((st, idx) => (
            <button
              key={st.symbol}
              type="button"
              onClick={() => onInspectSymbol(st.symbol)}
              className="inline-flex items-center gap-1.5 hover:underline"
            >
              <span
                className="w-2.5 h-2.5 rounded-xs"
                style={{ backgroundColor: colors[idx % colors.length] }}
              />
              <span className="font-semibold text-slate-800 dark:text-slate-200">{st.symbol}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {pillars.map((pillar) => (
          <div
            key={pillar.key}
            className="p-2.5 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 space-y-1.5"
          >
            <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              {pillar.label}
            </div>
            <div className="space-y-1.5">
              {stocks.map((st, idx) => {
                const val = pillar.extract(st, enrichedMap.get(st.symbol));
                const pct = val !== null ? Math.max(0, Math.min(100, val)) : 0;
                return (
                  <div key={st.symbol} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                      <span className="text-slate-600 dark:text-slate-400">{st.symbol}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {val !== null ? `${val.toFixed(0)}` : 'N/A'}
                      </span>
                    </div>
                    <div className="h-1.5 rounded bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: colors[idx % colors.length],
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
