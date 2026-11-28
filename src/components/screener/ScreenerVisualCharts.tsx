import React, { useMemo, useRef, useState } from 'react';
import {
  Crosshair,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  Target,
  X,
} from 'lucide-react';
import type {
  Q4ThreeYearBenchmark,
  QuarterlyStatementRecord,
  ScreenedCompanyRow,
} from '../../types/fundamental';

interface ScatterChartProps {
  rows: ScreenedCompanyRow[];
  onSelectSymbol: (symbol: string) => void;
  compareSymbols?: string[];
  onToggleCompare?: (symbol: string) => void;
  onOpenSimulator?: (symbol: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

type AxisMetricKey =
  | 'quality'
  | 'valuation'
  | 'overall'
  | 'growth'
  | 'risk'
  | 'roe'
  | 'pe'
  | 'pb'
  | 'peg'
  | 'mos'
  | 'eps'
  | 'epsQoq'
  | 'epsYoy'
  | 'operatingProfitYoy'
  | 'operatingMargin'
  | 'opProfitVsQ4Avg'
  | 'epsVsQ4Avg';

type BubbleSizeKey = 'consensus' | 'turnover' | 'uniform';
type LabelMode = 'smart' | 'focused' | 'all';

interface AxisMetricDef {
  key: AxisMetricKey;
  label: string;
  shortLabel: string;
  unit: string;
  digits: number;
  goodDirection: 'high' | 'low';
  sweetThreshold: number;
  fixedDomain?: [number, number];
  extract: (r: ScreenedCompanyRow) => number | null;
}

const AXIS_METRICS: Record<AxisMetricKey, AxisMetricDef> = {
  quality: {
    key: 'quality',
    label: 'Fundamental Quality Score (0–100)',
    shortLabel: 'Quality',
    unit: '',
    digits: 0,
    goodDirection: 'high',
    sweetThreshold: 60,
    fixedDomain: [0, 100],
    extract: (r) => r.scores.fundamentalQualityScore,
  },
  valuation: {
    key: 'valuation',
    label: 'Valuation Score (0–100)',
    shortLabel: 'Valuation',
    unit: '',
    digits: 0,
    goodDirection: 'high',
    sweetThreshold: 60,
    fixedDomain: [0, 100],
    extract: (r) => r.scores.valuationAttractivenessScore,
  },
  overall: {
    key: 'overall',
    label: 'Overall Composite Score (0–100)',
    shortLabel: 'Overall',
    unit: '',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 60,
    fixedDomain: [0, 100],
    extract: (r) => r.scores.overallScore,
  },
  growth: {
    key: 'growth',
    label: 'Growth Score (0–100)',
    shortLabel: 'Growth',
    unit: '',
    digits: 0,
    goodDirection: 'high',
    sweetThreshold: 55,
    fixedDomain: [0, 100],
    extract: (r) => r.scores.growthScore,
  },
  risk: {
    key: 'risk',
    label: 'Risk Control Score (0–100)',
    shortLabel: 'Risk',
    unit: '',
    digits: 0,
    goodDirection: 'high',
    sweetThreshold: 60,
    fixedDomain: [0, 100],
    extract: (r) => r.scores.riskManagementScore,
  },
  roe: {
    key: 'roe',
    label: 'Return on Equity (ROE %)',
    shortLabel: 'ROE %',
    unit: '%',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 14,
    extract: (r) => r.keyMetrics.roePct,
  },
  pe: {
    key: 'pe',
    label: 'P/E Ratio (x)',
    shortLabel: 'P/E',
    unit: 'x',
    digits: 1,
    goodDirection: 'low',
    sweetThreshold: 20,
    extract: (r) =>
      r.keyMetrics.pe !== null && r.keyMetrics.pe > 0 ? r.keyMetrics.pe : null,
  },
  pb: {
    key: 'pb',
    label: 'P/B Ratio (x)',
    shortLabel: 'P/B',
    unit: 'x',
    digits: 2,
    goodDirection: 'low',
    sweetThreshold: 2.2,
    extract: (r) =>
      r.keyMetrics.pb !== null && r.keyMetrics.pb > 0 ? r.keyMetrics.pb : null,
  },
  peg: {
    key: 'peg',
    label: 'PEG Ratio (x)',
    shortLabel: 'PEG',
    unit: 'x',
    digits: 2,
    goodDirection: 'low',
    sweetThreshold: 1.2,
    extract: (r) =>
      r.keyMetrics.peg !== null && r.keyMetrics.peg > 0 ? r.keyMetrics.peg : null,
  },
  mos: {
    key: 'mos',
    label: 'Margin of Safety (%)',
    shortLabel: 'MoS %',
    unit: '%',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 15,
    extract: (r) => r.keyMetrics.marginOfSafetyPct,
  },
  eps: {
    key: 'eps',
    label: 'Earnings Per Share (NPR)',
    shortLabel: 'EPS',
    unit: '',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 20,
    extract: (r) => r.keyMetrics.eps,
  },
  epsQoq: {
    key: 'epsQoq',
    label: 'EPS QoQ Growth (%)',
    shortLabel: 'EPS QoQ %',
    unit: '%',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 5,
    extract: (r) => r.keyMetrics.epsQoqPct,
  },
  epsYoy: {
    key: 'epsYoy',
    label: 'EPS YoY Growth (%)',
    shortLabel: 'EPS YoY %',
    unit: '%',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 10,
    extract: (r) => r.keyMetrics.epsYoyPct,
  },
  operatingProfitYoy: {
    key: 'operatingProfitYoy',
    label: 'Operating Profit YoY Growth (%)',
    shortLabel: 'Op. Profit YoY %',
    unit: '%',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 10,
    extract: (r) => r.keyMetrics.operatingProfitYoyPct,
  },
  operatingMargin: {
    key: 'operatingMargin',
    label: 'Operating Margin (%)',
    shortLabel: 'Op. Margin %',
    unit: '%',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 15,
    extract: (r) => r.keyMetrics.operatingMarginPct,
  },
  opProfitVsQ4Avg: {
    key: 'opProfitVsQ4Avg',
    label: 'Op. Profit vs 3-Year 4Q Avg (%)',
    shortLabel: 'Op. vs 3Y 4Q Avg %',
    unit: '%',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 0,
    extract: (r) => r.keyMetrics.operatingProfitVsQ4Avg3yPct,
  },
  epsVsQ4Avg: {
    key: 'epsVsQ4Avg',
    label: 'EPS vs 3-Year 4Q Avg (%)',
    shortLabel: 'EPS vs 3Y 4Q Avg %',
    unit: '%',
    digits: 1,
    goodDirection: 'high',
    sweetThreshold: 0,
    extract: (r) => r.keyMetrics.epsVsQ4Avg3yPct,
  },
};

const AXIS_PRESETS: Array<{
  id: string;
  label: string;
  x: AxisMetricKey;
  y: AxisMetricKey;
}> = [
  { id: 'q_v', label: 'Quality vs Value', x: 'quality', y: 'valuation' },
  { id: 'roe_pe', label: 'ROE % vs P/E', x: 'roe', y: 'pe' },
  { id: 'g_mos', label: 'Growth vs MoS %', x: 'growth', y: 'mos' },
  { id: 'op_mos', label: 'Op. Profit YoY vs MoS', x: 'operatingProfitYoy', y: 'mos' },
  { id: 'q4_mos', label: 'vs 3Y 4Q Avg vs MoS', x: 'opProfitVsQ4Avg', y: 'mos' },
  { id: 'roe_pb', label: 'ROE % vs P/B', x: 'roe', y: 'pb' },
];

interface PlottedPoint {
  row: ScreenedCompanyRow;
  xVal: number;
  yVal: number;
  cx: number;
  cy: number;
  r: number;
  inSweetSpot: boolean;
}

interface PlacedLabel {
  symbol: string;
  cx: number;
  cy: number;
  r: number;
  lx: number;
  ly: number;
  textAnchor: 'start' | 'middle' | 'end';
  needsLeader: boolean;
  isFocus: boolean;
}

interface ZoomBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function computeNiceDomain(
  vals: number[],
  fixed?: [number, number]
): [number, number] {
  if (fixed) return fixed;
  if (vals.length === 0) return [0, 100];
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    const pad = Math.max(2, Math.abs(min) * 0.2);
    return [min - pad, max + pad];
  }
  const span = max - min;
  min = min - span * 0.08;
  max = max + span * 0.08;
  return [min, max];
}

function buildTicks(min: number, max: number, count = 5): number[] {
  const ticks: number[] = [];
  if (max <= min) return [min];
  for (let i = 1; i < count; i++) {
    ticks.push(min + ((max - min) * i) / count);
  }
  return ticks;
}

function fmtMetricVal(def: AxisMetricDef, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(def.digits)}${def.unit}`;
}

function resolveSmartLabels(
  points: PlottedPoint[],
  opts: {
    labelMode: LabelMode;
    focusSymbols: Set<string>;
    maxLabels: number;
    plotL: number;
    plotR: number;
    plotT: number;
    plotB: number;
  }
): PlacedLabel[] {
  const { labelMode, focusSymbols, maxLabels, plotL, plotR, plotT, plotB } = opts;

  const prioritized = [...points].sort((a, b) => {
    const af = focusSymbols.has(a.row.symbol) ? 1 : 0;
    const bf = focusSymbols.has(b.row.symbol) ? 1 : 0;
    if (af !== bf) return bf - af;
    if (a.inSweetSpot !== b.inSweetSpot) return a.inSweetSpot ? -1 : 1;
    if (b.row.passedInvestorCount !== a.row.passedInvestorCount) {
      return b.row.passedInvestorCount - a.row.passedInvestorCount;
    }
    return b.row.scores.overallScore - a.row.scores.overallScore;
  });

  const candidates =
    labelMode === 'focused'
      ? prioritized.filter((p) => focusSymbols.has(p.row.symbol))
      : labelMode === 'all'
        ? prioritized
        : prioritized.slice(0, maxLabels);

  const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const placed: PlacedLabel[] = [];

  const overlapsAny = (box: { x1: number; y1: number; x2: number; y2: number }): boolean => {
    for (const b of placedBoxes) {
      if (box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1) {
        return true;
      }
    }
    return false;
  };

  for (const p of candidates) {
    const isFocus = focusSymbols.has(p.row.symbol);
    const labelW = p.row.symbol.length * 6.2 + 8;
    const labelH = 12;

    const offsets: Array<{
      dx: number;
      dy: number;
      anchor: 'start' | 'middle' | 'end';
      distTier: number;
    }> = [
      { dx: 0, dy: -(p.r + 5), anchor: 'middle', distTier: 0 },
      { dx: p.r + 6, dy: 3, anchor: 'start', distTier: 0 },
      { dx: -(p.r + 6), dy: 3, anchor: 'end', distTier: 0 },
      { dx: 0, dy: p.r + 12, anchor: 'middle', distTier: 0 },
      { dx: p.r + 12, dy: -(p.r + 10), anchor: 'start', distTier: 1 },
      { dx: -(p.r + 12), dy: -(p.r + 10), anchor: 'end', distTier: 1 },
      { dx: p.r + 14, dy: p.r + 14, anchor: 'start', distTier: 1 },
      { dx: -(p.r + 14), dy: p.r + 14, anchor: 'end', distTier: 1 },
      { dx: 0, dy: -(p.r + 22), anchor: 'middle', distTier: 2 },
      { dx: 0, dy: p.r + 26, anchor: 'middle', distTier: 2 },
      { dx: p.r + 24, dy: -2, anchor: 'start', distTier: 2 },
      { dx: -(p.r + 24), dy: -2, anchor: 'end', distTier: 2 },
    ];

    let chosen: PlacedLabel | null = null;
    for (const off of offsets) {
      const lx = p.cx + off.dx;
      const ly = p.cy + off.dy;
      const x1 =
        off.anchor === 'middle'
          ? lx - labelW / 2
          : off.anchor === 'start'
            ? lx
            : lx - labelW;
      const x2 = x1 + labelW;
      const y1 = ly - labelH + 2;
      const y2 = ly + 2;

      if (x1 < plotL + 2 || x2 > plotR - 2 || y1 < plotT + 2 || y2 > plotB - 2) {
        continue;
      }

      if (!overlapsAny({ x1: x1 - 2, y1: y1 - 1, x2: x2 + 2, y2: y2 + 1 })) {
        placedBoxes.push({ x1, y1, x2, y2 });
        chosen = {
          symbol: p.row.symbol,
          cx: p.cx,
          cy: p.cy,
          r: p.r,
          lx,
          ly,
          textAnchor: off.anchor,
          needsLeader: off.distTier > 0,
          isFocus,
        };
        break;
      }
    }

    // Focus symbols always render even in extreme density
    if (!chosen && isFocus) {
      const lx = Math.min(plotR - labelW / 2 - 4, Math.max(plotL + labelW / 2 + 4, p.cx));
      const ly = Math.max(plotT + 14, p.cy - p.r - 6);
      chosen = {
        symbol: p.row.symbol,
        cx: p.cx,
        cy: p.cy,
        r: p.r,
        lx,
        ly,
        textAnchor: 'middle',
        needsLeader: false,
        isFocus: true,
      };
    }

    if (chosen) placed.push(chosen);
  }

  return placed;
}

export const QualityValuationScatterChart: React.FC<ScatterChartProps> = ({
  rows,
  onSelectSymbol,
  compareSymbols = [],
  onToggleCompare,
  onOpenSimulator,
  isExpanded = false,
  onToggleExpand,
}) => {
  const [xMetricKey, setXMetricKey] = useState<AxisMetricKey>('quality');
  const [yMetricKey, setYMetricKey] = useState<AxisMetricKey>('valuation');
  const [sizeMetric, setSizeMetric] = useState<BubbleSizeKey>('consensus');
  const [labelMode, setLabelMode] = useState<LabelMode>('smart');
  const [searchText, setSearchText] = useState<string>('');
  const [searchFocused, setSearchFocused] = useState<boolean>(false);
  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(null);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [zoomBounds, setZoomBounds] = useState<ZoomBounds | null>(null);
  const [sweetSpotOnly, setSweetSpotOnly] = useState<boolean>(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [crosshair, setCrosshair] = useState<{ svgX: number; svgY: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  const xDef = AXIS_METRICS[xMetricKey];
  const yDef = AXIS_METRICS[yMetricKey];

  const evaluatedAll = useMemo(
    () => rows.filter((r) => r.hasFundamentalData),
    [rows]
  );

  // Instant search matches across all evaluated companies
  const searchMatches = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return [];
    return evaluatedAll
      .filter(
        (r) =>
          r.symbol.toLowerCase().includes(q) ||
          r.companyName.toLowerCase().includes(q) ||
          r.sector.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [evaluatedAll, searchText]);

  const validRows = useMemo(() => {
    return evaluatedAll.filter(
      (r) => xDef.extract(r) !== null && yDef.extract(r) !== null
    );
  }, [evaluatedAll, xDef, yDef]);

  const baseBounds = useMemo<ZoomBounds>(() => {
    const xs = validRows.map((r) => xDef.extract(r)!);
    const ys = validRows.map((r) => yDef.extract(r)!);
    const [xMin, xMax] = computeNiceDomain(xs, xDef.fixedDomain);
    const [yMin, yMax] = computeNiceDomain(ys, yDef.fixedDomain);
    return { xMin, xMax, yMin, yMax };
  }, [validRows, xDef, yDef]);

  const activeBounds = zoomBounds ?? baseBounds;

  const width = isExpanded ? 740 : 560;
  const height = isExpanded ? 360 : 285;
  const padL = 48;
  const padR = 20;
  const padT = 18;
  const padB = 36;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const toX = (val: number) => {
    const span = Math.max(1e-6, activeBounds.xMax - activeBounds.xMin);
    return padL + ((val - activeBounds.xMin) / span) * plotW;
  };
  const toY = (val: number) => {
    const span = Math.max(1e-6, activeBounds.yMax - activeBounds.yMin);
    return padT + (1 - (val - activeBounds.yMin) / span) * plotH;
  };
  const fromX = (svgX: number) => {
    const span = Math.max(1e-6, activeBounds.xMax - activeBounds.xMin);
    return activeBounds.xMin + ((svgX - padL) / plotW) * span;
  };
  const fromY = (svgY: number) => {
    const span = Math.max(1e-6, activeBounds.yMax - activeBounds.yMin);
    return activeBounds.yMin + (1 - (svgY - padT) / plotH) * span;
  };

  const maxTurnover = useMemo(() => {
    const vals = validRows.map((r) => r.market.turnover ?? 0);
    return Math.max(1, ...vals);
  }, [validRows]);

  const plottedPoints = useMemo<PlottedPoint[]>(() => {
    const pts: PlottedPoint[] = [];
    for (const row of validRows) {
      const xv = xDef.extract(row);
      const yv = yDef.extract(row);
      if (xv === null || yv === null) continue;

      const inSweetX =
        xDef.goodDirection === 'high'
          ? xv >= xDef.sweetThreshold
          : xv <= xDef.sweetThreshold;
      const inSweetY =
        yDef.goodDirection === 'high'
          ? yv >= yDef.sweetThreshold
          : yv <= yDef.sweetThreshold;
      const inSweetSpot = inSweetX && inSweetY;
      if (sweetSpotOnly && !inSweetSpot) continue;

      if (
        xv < activeBounds.xMin - 1e-6 ||
        xv > activeBounds.xMax + 1e-6 ||
        yv < activeBounds.yMin - 1e-6 ||
        yv > activeBounds.yMax + 1e-6
      ) {
        continue;
      }

      let r = 5;
      if (sizeMetric === 'consensus') {
        r = 4 + Math.min(4.5, row.passedInvestorCount * 0.55);
      } else if (sizeMetric === 'turnover') {
        const ratio = Math.sqrt(Math.max(0, row.market.turnover ?? 0) / maxTurnover);
        r = 4 + ratio * 6;
      }

      pts.push({
        row,
        xVal: xv,
        yVal: yv,
        cx: toX(xv),
        cy: toY(yv),
        r,
        inSweetSpot,
      });
    }
    return pts;
  }, [validRows, xDef, yDef, sweetSpotOnly, activeBounds, sizeMetric, maxTurnover, plotW, plotH]);

  const focusSymbols = useMemo(() => {
    const s = new Set<string>();
    if (pinnedSymbol) s.add(pinnedSymbol);
    if (hoveredSymbol) s.add(hoveredSymbol);
    for (const m of searchMatches) s.add(m.symbol);
    return s;
  }, [pinnedSymbol, hoveredSymbol, searchMatches]);

  const placedLabels = useMemo(
    () =>
      resolveSmartLabels(plottedPoints, {
        labelMode,
        focusSymbols,
        maxLabels: isExpanded ? 28 : 16,
        plotL: padL,
        plotR: padL + plotW,
        plotT: padT,
        plotB: padT + plotH,
      }),
    [plottedPoints, labelMode, focusSymbols, isExpanded, plotW, plotH]
  );

  const labelBySymbol = useMemo(() => {
    const map = new Map<string, PlacedLabel>();
    for (const l of placedLabels) map.set(l.symbol, l);
    return map;
  }, [placedLabels]);

  const activeInspectedRow = useMemo(() => {
    const targetSym = hoveredSymbol || pinnedSymbol;
    if (!targetSym) return null;
    return evaluatedAll.find((r) => r.symbol === targetSym) ?? null;
  }, [evaluatedAll, hoveredSymbol, pinnedSymbol]);

  const activePresetId = useMemo(() => {
    return (
      AXIS_PRESETS.find((p) => p.x === xMetricKey && p.y === yMetricKey)?.id ??
      'custom'
    );
  }, [xMetricKey, yMetricKey]);

  const locateSymbol = (sym: string) => {
    const target = evaluatedAll.find((r) => r.symbol === sym);
    if (!target) return;
    setPinnedSymbol(sym);
    setSearchText(sym);
    setSearchFocused(false);
    setSweetSpotOnly(false);

    const xv = xDef.extract(target);
    const yv = yDef.extract(target);
    if (
      zoomBounds &&
      (xv === null ||
        yv === null ||
        xv < zoomBounds.xMin ||
        xv > zoomBounds.xMax ||
        yv < zoomBounds.yMin ||
        yv > zoomBounds.yMax)
    ) {
      setZoomBounds(null);
    }
  };

  const applyPreset = (preset: (typeof AXIS_PRESETS)[number]) => {
    setXMetricKey(preset.x);
    setYMetricKey(preset.y);
    setZoomBounds(null);
  };

  const zoomToSweetSpot = () => {
    const xLow =
      xDef.goodDirection === 'high'
        ? Math.max(baseBounds.xMin, xDef.sweetThreshold * 0.92)
        : baseBounds.xMin;
    const xHigh =
      xDef.goodDirection === 'high'
        ? baseBounds.xMax
        : Math.min(baseBounds.xMax, xDef.sweetThreshold * 1.15);
    const yLow =
      yDef.goodDirection === 'high'
        ? Math.max(baseBounds.yMin, yDef.sweetThreshold * 0.92)
        : baseBounds.yMin;
    const yHigh =
      yDef.goodDirection === 'high'
        ? baseBounds.yMax
        : Math.min(baseBounds.yMax, yDef.sweetThreshold * 1.15);

    if (xHigh > xLow && yHigh > yLow) {
      setZoomBounds({ xMin: xLow, xMax: xHigh, yMin: yLow, yMax: yHigh });
    }
  };

  const getSvgCoords = (e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    return { x, y };
  };

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getSvgCoords(e);
    if (!pt) return;
    if (pt.x >= padL && pt.x <= padL + plotW && pt.y >= padT && pt.y <= padT + plotH) {
      setDragStart(pt);
      setDragCurrent(pt);
    }
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getSvgCoords(e);
    if (!pt) return;
    if (pt.x >= padL && pt.x <= padL + plotW && pt.y >= padT && pt.y <= padT + plotH) {
      setCrosshair({ svgX: pt.x, svgY: pt.y });
      if (dragStart) setDragCurrent(pt);
    } else {
      setCrosshair(null);
    }
  };

  const handleSvgMouseUp = () => {
    if (dragStart && dragCurrent) {
      const dx = Math.abs(dragCurrent.x - dragStart.x);
      const dy = Math.abs(dragCurrent.y - dragStart.y);
      if (dx >= 16 && dy >= 16) {
        const x1 = fromX(Math.min(dragStart.x, dragCurrent.x));
        const x2 = fromX(Math.max(dragStart.x, dragCurrent.x));
        const y1 = fromY(Math.max(dragStart.y, dragCurrent.y));
        const y2 = fromY(Math.min(dragStart.y, dragCurrent.y));
        if (x2 > x1 && y2 > y1) {
          setZoomBounds({ xMin: x1, xMax: x2, yMin: y1, yMax: y2 });
        }
      }
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  if (evaluatedAll.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900">
        Collect company financial reports to visualize the Fundamental Quality vs Valuation matrix.
      </div>
    );
  }

  // Compute clamped Sweet-Spot zone rectangle inside activeBounds
  const sweetX1 = Math.max(
    padL,
    Math.min(
      padL + plotW,
      toX(xDef.goodDirection === 'high' ? xDef.sweetThreshold : activeBounds.xMin)
    )
  );
  const sweetX2 = Math.max(
    padL,
    Math.min(
      padL + plotW,
      toX(xDef.goodDirection === 'high' ? activeBounds.xMax : xDef.sweetThreshold)
    )
  );
  const sweetY1 = Math.max(
    padT,
    Math.min(
      padT + plotH,
      toY(yDef.goodDirection === 'high' ? activeBounds.yMax : yDef.sweetThreshold)
    )
  );
  const sweetY2 = Math.max(
    padT,
    Math.min(
      padT + plotH,
      toY(yDef.goodDirection === 'high' ? yDef.sweetThreshold : activeBounds.yMin)
    )
  );
  const hasSweetBox = sweetX2 > sweetX1 && sweetY2 > sweetY1;

  const xTicks = buildTicks(activeBounds.xMin, activeBounds.xMax, 5);
  const yTicks = buildTicks(activeBounds.yMin, activeBounds.yMax, 5);

  const threshX = toX(xDef.sweetThreshold);
  const threshY = toY(yDef.sweetThreshold);
  const showThreshX = threshX > padL && threshX < padL + plotW;
  const showThreshY = threshY > padT && threshY < padT + plotH;

  const hasSearchFilter = searchText.trim().length > 0;
  const focusedPoint = pinnedSymbol
    ? plottedPoints.find((p) => p.row.symbol === pinnedSymbol) ?? null
    : null;

  return (
    <div
      className={`border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col gap-3 ${
        isExpanded ? 'lg:col-span-2' : ''
      }`}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {xDef.shortLabel} vs. {yDef.shortLabel} Interactive Matrix
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {plottedPoints.length} plotted · Sweet spot: {xDef.shortLabel}{' '}
            {xDef.goodDirection === 'high' ? '≥' : '≤'}{' '}
            {xDef.sweetThreshold}
            {xDef.unit} &amp; {yDef.shortLabel}{' '}
            {yDef.goodDirection === 'high' ? '≥' : '≤'}{' '}
            {yDef.sweetThreshold}
            {yDef.unit} · Drag on chart to zoom box
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {zoomBounds && (
            <button
              type="button"
              onClick={() => setZoomBounds(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Zoom</span>
            </button>
          )}
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              {isExpanded ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Compact View</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Expand Full Width</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Interactive Toolbar: Instant Scrip Search + Axis Presets + Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-t border-b border-slate-100 dark:border-slate-800/80 py-2.5">
        {/* Instant Scrip Locator */}
        <div className="relative min-w-[205px] flex-1 max-w-xs">
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
                locateSymbol(searchMatches[0].symbol);
              } else if (e.key === 'Escape') {
                setSearchText('');
                setPinnedSymbol(null);
              }
            }}
            placeholder="Locate scrip (e.g. NABIL, GBIME)…"
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
                    locateSymbol(m.symbol);
                  }}
                  className="w-full px-2.5 py-1.5 text-left flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-[11px]"
                >
                  <div className="min-w-0">
                    <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {m.symbol}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 ml-1.5 truncate">
                      {m.sector}
                    </span>
                  </div>
                  <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                    {fmtMetricVal(xDef, xDef.extract(m))} · {fmtMetricVal(yDef, yDef.extract(m))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Axis Presets */}
        <div className="flex flex-wrap items-center gap-1">
          {AXIS_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                activePresetId === preset.id
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Custom X / Y / Size / Label / Sweet Spot controls */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <select
            value={xMetricKey}
            onChange={(e) => {
              setXMetricKey(e.target.value as AxisMetricKey);
              setZoomBounds(null);
            }}
            aria-label="X Axis Metric"
            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
          >
            {Object.values(AXIS_METRICS).map((m) => (
              <option key={m.key} value={m.key}>
                X: {m.shortLabel}
              </option>
            ))}
          </select>

          <select
            value={yMetricKey}
            onChange={(e) => {
              setYMetricKey(e.target.value as AxisMetricKey);
              setZoomBounds(null);
            }}
            aria-label="Y Axis Metric"
            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
          >
            {Object.values(AXIS_METRICS).map((m) => (
              <option key={m.key} value={m.key}>
                Y: {m.shortLabel}
              </option>
            ))}
          </select>

          <select
            value={sizeMetric}
            onChange={(e) => setSizeMetric(e.target.value as BubbleSizeKey)}
            aria-label="Bubble Size Encoding"
            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
          >
            <option value="consensus">Size: Consensus</option>
            <option value="turnover">Size: Turnover</option>
            <option value="uniform">Size: Uniform</option>
          </select>

          <select
            value={labelMode}
            onChange={(e) => setLabelMode(e.target.value as LabelMode)}
            aria-label="Label Display Mode"
            className="px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
          >
            <option value="smart">Labels: Smart</option>
            <option value="focused">Labels: Focus</option>
            <option value="all">Labels: All</option>
          </select>

          <button
            type="button"
            onClick={zoomToSweetSpot}
            title="Zoom directly to Sweet-Spot quadrant"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 whitespace-nowrap"
          >
            <Target className="w-3 h-3" />
            <span>Zoom Sweet Spot</span>
          </button>

          <button
            type="button"
            onClick={() => setSweetSpotOnly((v) => !v)}
            className={`px-2 py-1 rounded border whitespace-nowrap ${
              sweetSpotOnly
                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Sweet Spot Only
          </button>
        </div>
      </div>

      {/* Main Plot + Optional Full-Width Index Rail */}
      <div
        className={`grid grid-cols-1 gap-4 ${
          isExpanded ? 'lg:grid-cols-12' : ''
        }`}
      >
        <div className={isExpanded ? 'lg:col-span-9' : ''}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={() => {
              setCrosshair(null);
              setDragStart(null);
              setDragCurrent(null);
            }}
            className="w-full h-auto overflow-visible select-none cursor-crosshair"
          >
            {/* Sweet-Spot Quadrant Shading */}
            {hasSweetBox && (
              <rect
                x={sweetX1}
                y={sweetY1}
                width={sweetX2 - sweetX1}
                height={sweetY2 - sweetY1}
                className="fill-emerald-500/8 dark:fill-emerald-400/10"
              />
            )}

            {/* Threshold Lines */}
            {showThreshX && (
              <line
                x1={threshX}
                y1={padT}
                x2={threshX}
                y2={padT + plotH}
                className="stroke-slate-300 dark:stroke-slate-700"
                strokeDasharray="4 3"
              />
            )}
            {showThreshY && (
              <line
                x1={padL}
                y1={threshY}
                x2={padL + plotW}
                y2={threshY}
                className="stroke-slate-300 dark:stroke-slate-700"
                strokeDasharray="4 3"
              />
            )}

            {/* Grid Lines & Ticks */}
            {xTicks.map((tick, idx) => (
              <g key={`xt-${idx}`}>
                <line
                  x1={toX(tick)}
                  y1={padT}
                  x2={toX(tick)}
                  y2={padT + plotH}
                  className="stroke-slate-100 dark:stroke-slate-800/80"
                />
                <text
                  x={toX(tick)}
                  y={padT + plotH + 14}
                  textAnchor="middle"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  {tick.toFixed(xDef.digits)}
                  {xDef.unit}
                </text>
              </g>
            ))}
            {yTicks.map((tick, idx) => (
              <g key={`yt-${idx}`}>
                <line
                  x1={padL}
                  y1={toY(tick)}
                  x2={padL + plotW}
                  y2={toY(tick)}
                  className="stroke-slate-100 dark:stroke-slate-800/80"
                />
                <text
                  x={padL - 6}
                  y={toY(tick) + 3}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  {tick.toFixed(yDef.digits)}
                  {yDef.unit}
                </text>
              </g>
            ))}

            {/* Axes frame */}
            <rect
              x={padL}
              y={padT}
              width={plotW}
              height={plotH}
              fill="none"
              className="stroke-slate-200 dark:stroke-slate-800"
            />

            {hasSweetBox && sweetX2 - sweetX1 > 70 && sweetY2 - sweetY1 > 24 && (
              <text
                x={sweetX1 + (sweetX2 - sweetX1) / 2}
                y={sweetY1 + 14}
                textAnchor="middle"
                className="fill-emerald-600 dark:fill-emerald-400 text-[10px] font-medium"
              >
                Sweet Spot Zone
              </text>
            )}

            {/* Axis Titles */}
            <text
              x={padL + plotW / 2}
              y={height - 4}
              textAnchor="middle"
              className="fill-slate-500 dark:fill-slate-400 text-[10px]"
            >
              {xDef.label}
            </text>
            <text
              x={12}
              y={padT + plotH / 2}
              textAnchor="middle"
              transform={`rotate(-90 12 ${padT + plotH / 2})`}
              className="fill-slate-500 dark:fill-slate-400 text-[10px]"
            >
              {yDef.label}
            </text>

            {/* Crosshair Guides */}
            {crosshair && !dragStart && (
              <g className="pointer-events-none">
                <line
                  x1={crosshair.svgX}
                  y1={padT}
                  x2={crosshair.svgX}
                  y2={padT + plotH}
                  className="stroke-slate-400/50 dark:stroke-slate-500/50"
                  strokeDasharray="2 2"
                />
                <line
                  x1={padL}
                  y1={crosshair.svgY}
                  x2={padL + plotW}
                  y2={crosshair.svgY}
                  className="stroke-slate-400/50 dark:stroke-slate-500/50"
                  strokeDasharray="2 2"
                />
                <text
                  x={crosshair.svgX}
                  y={padT - 4}
                  textAnchor="middle"
                  className="fill-blue-600 dark:fill-blue-400 text-[9.5px] font-mono font-semibold"
                >
                  {fromX(crosshair.svgX).toFixed(xDef.digits)}
                  {xDef.unit}
                </text>
                <text
                  x={padL + plotW - 4}
                  y={crosshair.svgY - 4}
                  textAnchor="end"
                  className="fill-blue-600 dark:fill-blue-400 text-[9.5px] font-mono font-semibold"
                >
                  {fromY(crosshair.svgY).toFixed(yDef.digits)}
                  {yDef.unit}
                </text>
              </g>
            )}

            {/* Target Reticle for Searched / Pinned Scrip */}
            {focusedPoint && (
              <g className="pointer-events-none">
                <line
                  x1={focusedPoint.cx}
                  y1={padT}
                  x2={focusedPoint.cx}
                  y2={padT + plotH}
                  className="stroke-amber-500/55"
                  strokeDasharray="3 3"
                />
                <line
                  x1={padL}
                  y1={focusedPoint.cy}
                  x2={padL + plotW}
                  y2={focusedPoint.cy}
                  className="stroke-amber-500/55"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={focusedPoint.cx}
                  cy={focusedPoint.cy}
                  r={focusedPoint.r + 5}
                  fill="none"
                  className="stroke-amber-500"
                  strokeWidth={1.6}
                />
              </g>
            )}

            {/* Leader Lines */}
            {placedLabels
              .filter((l) => l.needsLeader)
              .map((l) => (
                <line
                  key={`ldr-${l.symbol}`}
                  x1={l.cx}
                  y1={l.cy}
                  x2={l.lx}
                  y2={l.ly - 3}
                  className={
                    l.isFocus
                      ? 'stroke-amber-500'
                      : 'stroke-slate-300 dark:stroke-slate-700'
                  }
                  strokeWidth={1}
                />
              ))}

            {/* Scatter Points */}
            {plottedPoints.map((p) => {
              const isPinned = pinnedSymbol === p.row.symbol;
              const isHovered = hoveredSymbol === p.row.symbol;
              const isMatched =
                hasSearchFilter &&
                searchMatches.some((m) => m.symbol === p.row.symbol);
              const dimmed =
                (hasSearchFilter && !isMatched && !isPinned) ||
                (pinnedSymbol !== null &&
                  !isPinned &&
                  !isHovered &&
                  !isMatched);

              const fillCls =
                isPinned || isMatched
                  ? 'fill-amber-500 dark:fill-amber-400 stroke-white dark:stroke-slate-900'
                  : p.inSweetSpot || p.row.passedInvestorCount >= 4
                    ? 'fill-emerald-600 dark:fill-emerald-400 stroke-white dark:stroke-slate-900'
                    : p.row.passedInvestorCount >= 2
                      ? 'fill-blue-600 dark:fill-blue-400 stroke-white dark:stroke-slate-900'
                      : 'fill-slate-400 dark:fill-slate-500 stroke-white dark:stroke-slate-900';

              const lbl = labelBySymbol.get(p.row.symbol);

              return (
                <g
                  key={p.row.symbol}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPinnedSymbol((cur) =>
                      cur === p.row.symbol ? null : p.row.symbol
                    );
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onSelectSymbol(p.row.symbol);
                  }}
                  onMouseEnter={() => setHoveredSymbol(p.row.symbol)}
                  onMouseLeave={() => setHoveredSymbol(null)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={p.cx}
                    cy={p.cy}
                    r={isPinned || isHovered ? p.r + 1.5 : p.r}
                    className={fillCls}
                    strokeWidth={1.5}
                    fillOpacity={dimmed ? 0.25 : 0.88}
                  />
                  {lbl && (
                    <text
                      x={lbl.lx}
                      y={lbl.ly}
                      textAnchor={lbl.textAnchor}
                      className={`text-[9.5px] font-mono ${
                        isPinned || isHovered || isMatched
                          ? 'fill-slate-950 dark:fill-white font-bold'
                          : dimmed
                            ? 'fill-slate-400/50 dark:fill-slate-600/50'
                            : 'fill-slate-700 dark:fill-slate-300 font-semibold'
                      }`}
                    >
                      {lbl.symbol}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Drag-Zoom Selection Box */}
            {dragStart && dragCurrent && (
              <rect
                x={Math.min(dragStart.x, dragCurrent.x)}
                y={Math.min(dragStart.y, dragCurrent.y)}
                width={Math.abs(dragCurrent.x - dragStart.x)}
                height={Math.abs(dragCurrent.y - dragStart.y)}
                className="fill-blue-500/15 stroke-blue-600 dark:stroke-blue-400 pointer-events-none"
                strokeDasharray="3 2"
                strokeWidth={1}
              />
            )}
          </svg>
        </div>

        {/* Synchronized Scrip Directory Rail in Expanded View */}
        {isExpanded && (
          <div className="lg:col-span-3 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden flex flex-col max-h-[360px]">
            <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span>Plotted Scrips ({plottedPoints.length})</span>
              <span className="font-mono text-slate-400">
                {xDef.shortLabel} · {yDef.shortLabel}
              </span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 overflow-y-auto flex-1">
              {[...plottedPoints]
                .sort((a, b) => b.row.scores.overallScore - a.row.scores.overallScore)
                .map((pt) => {
                  const active = pinnedSymbol === pt.row.symbol;
                  return (
                    <button
                      key={pt.row.symbol}
                      type="button"
                      onMouseEnter={() => setHoveredSymbol(pt.row.symbol)}
                      onMouseLeave={() => setHoveredSymbol(null)}
                      onClick={() => locateSymbol(pt.row.symbol)}
                      className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-[11px] transition-colors ${
                        active
                          ? 'bg-blue-50 dark:bg-blue-950/40'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                          {pt.row.symbol}
                        </span>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {pt.row.sector}
                        </span>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className="text-slate-800 dark:text-slate-200">
                          {fmtMetricVal(xDef, pt.xVal)} · {fmtMetricVal(yDef, pt.yVal)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Score {pt.row.scores.overallScore.toFixed(0)} · {pt.row.passedInvestorCount}/9
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Live Pinned / Hovered Scrip Inspector Strip */}
      <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        {activeInspectedRow ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <Crosshair className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                  {activeInspectedRow.symbol}
                </span>
                <span className="text-slate-600 dark:text-slate-300 truncate max-w-[180px]">
                  {activeInspectedRow.companyName}
                </span>
              </div>
              <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                {xDef.shortLabel}: {fmtMetricVal(xDef, xDef.extract(activeInspectedRow))} ·{' '}
                {yDef.shortLabel}: {fmtMetricVal(yDef, yDef.extract(activeInspectedRow))} ·{' '}
                LTP {activeInspectedRow.market.ltp?.toFixed(0) ?? '—'} ·{' '}
                MoS{' '}
                {activeInspectedRow.keyMetrics.marginOfSafetyPct !== null
                  ? `${activeInspectedRow.keyMetrics.marginOfSafetyPct >= 0 ? '+' : ''}${activeInspectedRow.keyMetrics.marginOfSafetyPct.toFixed(1)}%`
                  : '—'}{' '}
                · {activeInspectedRow.passedInvestorCount}/9 investors ({activeInspectedRow.recommendation.verdict})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onSelectSymbol(activeInspectedRow.symbol)}
                className="px-2.5 py-1 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
              >
                Open Dossier
              </button>
              {onToggleCompare && (
                <button
                  type="button"
                  onClick={() => onToggleCompare(activeInspectedRow.symbol)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded border whitespace-nowrap ${
                    compareSymbols.includes(activeInspectedRow.symbol)
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {compareSymbols.includes(activeInspectedRow.symbol) ? 'Comparing' : '+ Compare'}
                </button>
              )}
              {onOpenSimulator && activeInspectedRow.market.ltp !== null && (
                <button
                  type="button"
                  onClick={() => onOpenSimulator(activeInspectedRow.symbol)}
                  className="px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  Simulate
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 w-full text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              Click any dot or search above to pin a scrip · Double-click dot to open its full 9-investor dossier
            </span>
            <span className="font-mono">
              Emerald: Sweet Spot / ≥4 Inv · Blue: 2–3 Inv · Amber: Pinned/Searched
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const TopStocksCompositeBarsChart: React.FC<ScatterChartProps> = ({
  rows,
  onSelectSymbol,
}) => {
  const top = useMemo(
    () => rows.filter((r) => r.hasFundamentalData).slice(0, 8),
    [rows]
  );

  if (top.length === 0) {
    return null;
  }

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Top Evaluated Companies — Multi-Dimension Comparison
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Quality · Valuation · Growth · Risk Control (click symbol to inspect)
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-blue-600 inline-block" /> Quality
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-emerald-600 inline-block" /> Value
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-amber-500 inline-block" /> Growth
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-slate-500 inline-block" /> Risk
          </span>
        </div>
      </div>

      <div className="space-y-2.5">
        {top.map((r) => (
          <button
            key={r.symbol}
            type="button"
            onClick={() => onSelectSymbol(r.symbol)}
            className="w-full text-left group hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded px-1.5 py-1 transition-colors"
          >
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono font-semibold text-blue-600 dark:text-blue-400 group-hover:underline">
                  {r.symbol}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {r.sector} · {r.passedInvestorCount}/9 investors
                </span>
              </div>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {r.scores.overallScore.toFixed(1)}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-blue-600 dark:bg-blue-500"
                  style={{ width: `${Math.min(100, r.scores.fundamentalQualityScore)}%` }}
                />
              </div>
              <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-600 dark:bg-emerald-500"
                  style={{ width: `${Math.min(100, r.scores.valuationAttractivenessScore)}%` }}
                />
              </div>
              <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-amber-500 dark:bg-amber-400"
                  style={{ width: `${Math.min(100, r.scores.growthScore)}%` }}
                />
              </div>
              <div className="h-1.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-slate-500 dark:bg-slate-400"
                  style={{ width: `${Math.min(100, r.scores.riskManagementScore)}%` }}
                />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

interface HistoryChartProps {
  statements: QuarterlyStatementRecord[];
  q4Benchmark?: Q4ThreeYearBenchmark | null;
}

export const CompanyHistoricalTrendChart: React.FC<HistoryChartProps> = ({
  statements,
  q4Benchmark,
}) => {
  const [metricKey, setMetricKey] = useState<
    'eps' | 'operatingProfit' | 'netProfit' | 'roe' | 'bvps'
  >('eps');

  const chronological = useMemo(
    () => [...statements].sort((a, b) => a.sortKey - b.sortKey),
    [statements]
  );

  const points = useMemo(() => {
    return chronological.map((st) => {
      let val: number | null = null;
      if (metricKey === 'eps') val = st.metrics.eps.value;
      else if (metricKey === 'operatingProfit')
        val =
          st.metrics.operatingProfit.value !== null
            ? Number((st.metrics.operatingProfit.value / 1e7).toFixed(2))
            : null;
      else if (metricKey === 'netProfit')
        val =
          st.metrics.netProfit.value !== null
            ? Number((st.metrics.netProfit.value / 1e7).toFixed(2))
            : null;
      else if (metricKey === 'roe') val = st.metrics.roePct.value;
      else if (metricKey === 'bvps') val = st.metrics.bvps.value;

      return {
        label: `${st.quarter} ${st.fiscalYear}`,
        val,
      };
    });
  }, [chronological, metricKey]);

  const baselineInfo = useMemo(() => {
    if (!q4Benchmark || q4Benchmark.yearsCount === 0) return null;
    let avgVal: number | null = null;
    let vsAvgLabel: string | null = null;
    let currentAnnualized: number | null = null;
    let unitSuffix = '';

    if (metricKey === 'eps') {
      avgVal = q4Benchmark.avgEps;
      currentAnnualized = q4Benchmark.currentAnnualizedEps;
      if (q4Benchmark.epsVsAvgPct !== null) {
        vsAvgLabel = `${q4Benchmark.epsVsAvgPct >= 0 ? '+' : ''}${q4Benchmark.epsVsAvgPct.toFixed(1)}%`;
      }
    } else if (metricKey === 'operatingProfit') {
      avgVal = q4Benchmark.avgOperatingProfitCr;
      currentAnnualized = q4Benchmark.currentAnnualizedOperatingProfitCr;
      unitSuffix = ' Cr';
      if (q4Benchmark.operatingProfitVsAvgPct !== null) {
        vsAvgLabel = `${q4Benchmark.operatingProfitVsAvgPct >= 0 ? '+' : ''}${q4Benchmark.operatingProfitVsAvgPct.toFixed(1)}%`;
      }
    } else if (metricKey === 'netProfit') {
      avgVal = q4Benchmark.avgNetProfitCr;
      currentAnnualized = q4Benchmark.currentAnnualizedNetProfitCr;
      unitSuffix = ' Cr';
      if (q4Benchmark.netProfitVsAvgPct !== null) {
        vsAvgLabel = `${q4Benchmark.netProfitVsAvgPct >= 0 ? '+' : ''}${q4Benchmark.netProfitVsAvgPct.toFixed(1)}%`;
      }
    } else if (metricKey === 'roe') {
      avgVal = q4Benchmark.avgRoePct;
      currentAnnualized = q4Benchmark.currentRoePct;
      unitSuffix = '%';
      if (q4Benchmark.roeVsAvgDeltaPp !== null) {
        vsAvgLabel = `${q4Benchmark.roeVsAvgDeltaPp >= 0 ? '+' : ''}${q4Benchmark.roeVsAvgDeltaPp.toFixed(2)} pp`;
      }
    } else if (metricKey === 'bvps') {
      avgVal = q4Benchmark.avgBvps;
      currentAnnualized = q4Benchmark.currentBvps;
      if (q4Benchmark.bvpsVsAvgPct !== null) {
        vsAvgLabel = `${q4Benchmark.bvpsVsAvgPct >= 0 ? '+' : ''}${q4Benchmark.bvpsVsAvgPct.toFixed(1)}%`;
      }
    }

    if (avgVal === null || !Number.isFinite(avgVal)) return null;
    return {
      avgVal,
      currentAnnualized,
      vsAvgLabel,
      unitSuffix,
      basisLabel: q4Benchmark.basisLabel,
      yearsCount: q4Benchmark.yearsCount,
    };
  }, [q4Benchmark, metricKey]);

  const validVals = points.map((p) => p.val).filter((v): v is number => v !== null);
  const scaleVals =
    baselineInfo !== null ? [...validVals, baselineInfo.avgVal] : validVals;
  const maxVal = scaleVals.length > 0 ? Math.max(...scaleVals, 1) : 10;
  const minVal = scaleVals.length > 0 ? Math.min(0, ...scaleVals) : 0;
  const span = Math.max(1, maxVal - minVal);

  const avgRefBottomPct =
    baselineInfo !== null
      ? Math.max(4, Math.min(96, ((baselineInfo.avgVal - minVal) / span) * 100))
      : null;

  const unitLabel =
    metricKey === 'eps'
      ? 'EPS (NPR)'
      : metricKey === 'operatingProfit'
        ? 'Operating Profit (Rs Crore)'
        : metricKey === 'netProfit'
          ? 'Net Profit (Rs Crore)'
          : metricKey === 'roe'
            ? 'ROE (%)'
            : 'BVPS (NPR)';

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Historical Trajectory · {unitLabel}
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {chronological.length} archived fiscal period(s) in vault
            {baselineInfo && (
              <>
                {' · '}
                <span className="font-mono text-amber-700 dark:text-amber-300">
                  3Y 4Q Avg: {baselineInfo.avgVal.toFixed(1)}
                  {baselineInfo.unitSuffix}
                </span>
                {baselineInfo.vsAvgLabel && (
                  <>
                    {' '}
                    (Now vs Avg:{' '}
                    <span
                      className={`font-mono font-semibold ${
                        baselineInfo.vsAvgLabel.startsWith('+')
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {baselineInfo.vsAvgLabel}
                    </span>
                    )
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-0.5 text-[11px]">
          {(
            [
              { id: 'eps', label: 'EPS' },
              { id: 'operatingProfit', label: 'Op. Profit' },
              { id: 'netProfit', label: 'Net Profit' },
              { id: 'roe', label: 'ROE %' },
              { id: 'bvps', label: 'BVPS' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMetricKey(tab.id)}
              className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                metricKey === tab.id
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {validVals.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
          Selected metric not reported across stored periods.
        </div>
      ) : (
        <div className="relative border-t border-slate-100 dark:border-slate-800/80 pt-4 pb-1 px-2 overflow-x-auto">
          <div className="relative flex items-end gap-3 h-40 min-w-full">
            {/* Horizontal 3-Year 4Q Average Reference Line across the bar plot */}
            {baselineInfo && avgRefBottomPct !== null && (
              <div
                className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-dashed border-amber-500/85 dark:border-amber-400/85"
                style={{ bottom: `calc(22px + ${(avgRefBottomPct * 0.72).toFixed(1)}%)` }}
              >
                <span className="absolute right-0 -top-4 px-1.5 py-0.2 rounded bg-amber-50/95 dark:bg-amber-950/90 text-[10px] font-mono font-semibold text-amber-800 dark:text-amber-300 tabular-nums">
                  3-Year 4Q Avg: {baselineInfo.avgVal.toFixed(1)}
                  {baselineInfo.unitSuffix}
                </span>
              </div>
            )}

            {points.map((pt) => {
              const pctHeight =
                pt.val !== null ? Math.max(8, Math.round(((pt.val - minVal) / span) * 100)) : 4;
              const beatsAvg =
                baselineInfo !== null && pt.val !== null && pt.val >= baselineInfo.avgVal;
              return (
                <div
                  key={pt.label}
                  className="flex-1 min-w-[68px] flex flex-col items-center justify-end h-full gap-1.5"
                >
                  <span className="text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {pt.val !== null ? pt.val.toFixed(1) : 'N/A'}
                  </span>
                  <div className="w-full max-w-[44px] flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t transition-all ${
                        pt.val === null
                          ? 'bg-slate-200 dark:bg-slate-800'
                          : pt.val < 0
                            ? 'bg-red-500 dark:bg-red-400'
                            : beatsAvg
                              ? 'bg-emerald-600 dark:bg-emerald-500'
                              : 'bg-blue-600 dark:bg-blue-500'
                      }`}
                      style={{ height: `${pctHeight}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {pt.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
