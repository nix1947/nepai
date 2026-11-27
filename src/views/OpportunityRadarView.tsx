import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Compass,
  Flame,
  GitCompare,
  Layers,
  Plus,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { InfoTip } from '../components/InfoTip';
import { LOOKBACK_PRESETS, useTradingSettings } from '../hooks/useTradingSettings';
import { useWatchlist } from '../hooks/useWatchlist';
import type {
  OpportunityRadarResponse,
  RadarPoint,
  StockComparisonResponse,
  SymbolInfo,
} from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface OpportunityRadarViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
  onInspectInQuant?: (symbol: string) => void;
}

type RadarTab = 'acceleration' | 'accumulation' | 'divergences' | 'breakout' | 'sectors';

const CATEGORY_META: Record<
  RadarPoint['category'],
  { label: string; color: string; badgeCls: string }
> = {
  acceleration: {
    label: 'Turnover Acceleration',
    color: '#10b981',
    badgeCls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
  },
  accumulation: {
    label: 'Stealth Accumulation',
    color: '#2563eb',
    badgeCls: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
  },
  bullish_div: {
    label: 'Silent Absorption',
    color: '#0d9488',
    badgeCls: 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800',
  },
  breakout_watch: {
    label: 'Breakout Watch',
    color: '#d97706',
    badgeCls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
  },
  bearish_div: {
    label: 'Weak-Vol Exhaustion',
    color: '#ef4444',
    badgeCls: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800',
  },
};

const COMPARE_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ec4899'];

export const OpportunityRadarView: React.FC<OpportunityRadarViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
  onInspectInQuant,
}) => {
  const { settings, updateSettings } = useTradingSettings();
  const nDays = settings.lookbackDays;
  const [selectedDay, setSelectedDay] = useState<string>(dates[dates.length - 1] ?? '');
  const [radar, setRadar] = useState<OpportunityRadarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<RadarTab>('acceleration');
  const [hoveredPoint, setHoveredPoint] = useState<RadarPoint | null>(null);

  // Stock Comparison Engine state
  const [allSymbols, setAllSymbols] = useState<SymbolInfo[]>([]);
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [addSymbolQuery, setAddSymbolQuery] = useState('');
  const [comparison, setComparison] = useState<StockComparisonResponse | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const { hasSymbol, toggleSymbol } = useWatchlist();

  useEffect(() => {
    if (dates.length > 0 && (!selectedDay || !dates.includes(selectedDay))) {
      setSelectedDay(dates[dates.length - 1]);
    }
  }, [dates, selectedDay]);

  useEffect(() => {
    if (!selectedDay) return;
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/opportunity-radar?day=${encodeURIComponent(
        selectedDay
      )}&nDays=${nDays}&equityOnly=${equityOnly}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: OpportunityRadarResponse) => {
        if (cancelled) return;
        setRadar(d);
        setCompareSymbols((prev) => {
          if (prev.length > 0) return prev;
          const seeds = d.points.slice(0, 3).map((p) => p.symbol);
          return seeds.length > 0 ? seeds : ['NABIL', 'NICA'];
        });
      })
      .catch(() => {
        if (!cancelled) setRadar(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, nDays, equityOnly]);

  useEffect(() => {
    const latest = dates[dates.length - 1];
    if (!latest) return;
    fetch(`/api/symbols?day=${encodeURIComponent(latest)}&equityOnly=${equityOnly}`)
      .then((r) => (r.ok ? r.json() : { symbols: [] }))
      .then((d) => setAllSymbols(d.symbols || []))
      .catch(() => null);
  }, [dates, equityOnly]);

  useEffect(() => {
    if (compareSymbols.length === 0) {
      setComparison(null);
      return;
    }
    let cancelled = false;
    setLoadingCompare(true);
    fetch(
      `/api/compare?symbols=${encodeURIComponent(
        compareSymbols.join(',')
      )}&nDays=${nDays}${selectedDay ? `&end=${encodeURIComponent(selectedDay)}` : ''}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setComparison(d);
      })
      .catch(() => {
        if (!cancelled) setComparison(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingCompare(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compareSymbols, nDays, selectedDay]);

  const activeRows = useMemo((): RadarPoint[] => {
    if (!radar) return [];
    switch (activeTab) {
      case 'acceleration':
        return radar.accelerationAlerts;
      case 'accumulation':
        return radar.stealthAccumulation;
      case 'divergences':
        return radar.divergences;
      case 'breakout':
        return radar.breakoutWatchlist;
      default:
        return [];
    }
  }, [radar, activeTab]);

  // SVG Scatter geometry
  const W = 720;
  const H = 310;
  const PAD = { t: 22, r: 24, b: 38, l: 54 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const scatterItems = useMemo(() => {
    const pts = radar?.points ?? [];
    if (pts.length === 0) return [];
    const maxTurnX = Math.max(3.5, ...pts.map((p) => Math.min(5, p.turnoverMult)));
    const maxTurnVal = Math.max(...pts.map((p) => p.turnover), 1);

    return pts.map((p) => {
      const clampedX = Math.max(0.2, Math.min(maxTurnX, p.turnoverMult));
      const clampedY = Math.max(-10, Math.min(10, p.changePct));
      const x = PAD.l + ((clampedX - 0.2) / (maxTurnX - 0.2)) * plotW;
      const y = PAD.t + ((10 - clampedY) / 20) * plotH;
      const r = 4.5 + Math.sqrt(p.turnover / maxTurnVal) * 10;
      return { point: p, x, y, r };
    });
  }, [radar, plotW, plotH]);

  const maxTurnAxis = useMemo(() => {
    const pts = radar?.points ?? [];
    return Math.max(3.5, ...pts.map((p) => Math.min(5, p.turnoverMult)));
  }, [radar]);

  const zeroY = PAD.t + (10 / 20) * plotH;
  const spikeX = PAD.l + ((Math.min(maxTurnAxis, 1.75) - 0.2) / (maxTurnAxis - 0.2)) * plotW;

  // Stock Comparison Multi-line chart geometry
  const CW = 700;
  const CH = 240;
  const CPAD = { t: 18, r: 22, b: 28, l: 48 };
  const compareChart = useMemo(() => {
    if (!comparison || comparison.stocks.length === 0) return null;
    const allPcts = comparison.stocks.flatMap((s) => s.series.map((pt) => pt.indexedPct));
    const minP = Math.min(-2, ...allPcts);
    const maxP = Math.max(2, ...allPcts);
    const span = maxP - minP || 1;
    const innerW = CW - CPAD.l - CPAD.r;
    const innerH = CH - CPAD.t - CPAD.b;
    const dateIdxMap = new Map<string, number>();
    comparison.dates.forEach((d, idx) => dateIdxMap.set(d, idx));
    const denomX = Math.max(1, comparison.dates.length - 1);

    const lines = comparison.stocks.map((st, idx) => {
      const coords = st.series
        .map((pt) => {
          const di = dateIdxMap.get(pt.date);
          if (di === undefined) return null;
          const x = CPAD.l + (di / denomX) * innerW;
          const y = CPAD.t + ((maxP - pt.indexedPct) / span) * innerH;
          return { x, y, pct: pt.indexedPct, date: pt.date };
        })
        .filter((x): x is { x: number; y: number; pct: number; date: string } => x !== null);
      return {
        symbol: st.symbol,
        color: COMPARE_COLORS[idx % COMPARE_COLORS.length],
        path: coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '),
        last: coords[coords.length - 1] ?? null,
      };
    });

    const zeroLineY = CPAD.t + ((maxP - 0) / span) * innerH;
    return { lines, minP, maxP, zeroLineY };
  }, [comparison]);

  const symbolMatches = useMemo(() => {
    const q = addSymbolQuery.trim().toLowerCase();
    if (!q) return [];
    return allSymbols
      .filter(
        (s) =>
          !compareSymbols.includes(s.symbol) &&
          (s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [allSymbols, addSymbolQuery, compareSymbols]);

  const addCompareSymbol = (sym: string) => {
    const clean = sym.trim().toUpperCase();
    if (!clean || compareSymbols.includes(clean) || compareSymbols.length >= 4) return;
    setCompareSymbols((prev) => [...prev, clean]);
    setAddSymbolQuery('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Opportunity Radar &amp; Smart Comparison Engine
            </h2>
            <InfoTip
              title="How the Opportunity Radar Spots Early Moves"
              body={`Scans all active NEPSE equities against their ${nDays}-day rolling baselines to surface turnover acceleration, tight-range stealth accumulation, and volume-price divergences before trends become crowded.`}
              example="A stock with 2.4x its 20-day turnover and only +0.4% price change indicates silent absorption before a potential breakout."
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pre-breakout activity radar, turnover acceleration alerts, divergence detection, sector rotation, and head-to-head stock comparison
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
            {LOOKBACK_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => updateSettings({ lookbackDays: preset })}
                className={`px-2 py-1 rounded font-mono text-[11px] font-medium transition-colors ${
                  nDays === preset
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {preset}d
              </button>
            ))}
          </div>

          <select
            value={selectedDay}
            onChange={(e) => setSelectedDay(e.target.value)}
            aria-label="Radar session date"
            className="px-2.5 py-1.5 font-mono rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          >
            {[...dates].reverse().map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Visual Opportunity Radar Quadrant */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Visual Opportunity Quadrant (Turnover Multiple vs Daily Change)
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              {Object.entries(CATEGORY_META).map(([k, meta]) => (
                <span key={k} className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                  <span>{meta.label}</span>
                </span>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="h-[310px] animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
          ) : scatterItems.length === 0 ? (
            <div className="h-[310px] flex items-center justify-center text-xs text-slate-400">
              No qualifying anomalies detected for {selectedDay}.
            </div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none">
              {/* Quadrant Shading */}
              <rect
                x={spikeX}
                y={PAD.t}
                width={Math.max(0, W - PAD.r - spikeX)}
                height={Math.max(0, zeroY - PAD.t)}
                fill="rgba(16, 185, 129, 0.05)"
              />
              <line x1={PAD.l} y1={zeroY} x2={W - PAD.r} y2={zeroY} stroke="#94a3b8" strokeDasharray="3 3" strokeOpacity={0.5} />
              <line x1={spikeX} y1={PAD.t} x2={spikeX} y2={H - PAD.b} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.6} />

              {/* Quadrant Labels */}
              <text x={W - PAD.r - 6} y={PAD.t + 14} textAnchor="end" fontSize="10" fill="#10b981" fontWeight="600">
                High-Conviction Momentum Zone (≥1.75x Turn &amp; Up)
              </text>
              <text x={W - PAD.r - 6} y={H - PAD.b - 8} textAnchor="end" fontSize="10" fill="#0d9488">
                Silent Absorption / Heavy Churn
              </text>

              {/* Axes Labels */}
              <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">
                Turnover vs {nDays}-Day Average (×)
              </text>
              <text
                x={14}
                y={H / 2}
                textAnchor="middle"
                fontSize="11"
                fill="#64748b"
                transform={`rotate(-90 14 ${H / 2})`}
              >
                Daily Price Change (%)
              </text>

              {/* Y ticks */}
              {[-10, -5, 0, 5, 10].map((v) => {
                const y = PAD.t + ((10 - v) / 20) * plotH;
                return (
                  <text key={v} x={PAD.l - 8} y={y + 3} textAnchor="end" fontSize="10" fill="#94a3b8" className="font-mono">
                    {v > 0 ? `+${v}%` : `${v}%`}
                  </text>
                );
              })}

              {/* X ticks */}
              {[0.5, 1, 1.75, 2.5, 3.5].map((v) => {
                if (v > maxTurnAxis) return null;
                const x = PAD.l + ((v - 0.2) / (maxTurnAxis - 0.2)) * plotW;
                return (
                  <text key={v} x={x} y={H - PAD.b + 14} textAnchor="middle" fontSize="10" fill="#94a3b8" className="font-mono">
                    {v}x
                  </text>
                );
              })}

              {/* Bubbles */}
              {scatterItems.map(({ point, x, y, r }) => {
                const meta = CATEGORY_META[point.category];
                const isHov = hoveredPoint?.symbol === point.symbol;
                return (
                  <g
                    key={point.symbol}
                    onMouseEnter={() => setHoveredPoint(point)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onClick={() => onInspectSymbol(point.symbol)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={x}
                      cy={y}
                      r={isHov ? r + 2.5 : r}
                      fill={meta.color}
                      fillOpacity={isHov ? 0.95 : 0.72}
                      stroke={isHov ? '#0f172a' : '#ffffff'}
                      strokeWidth={isHov ? 2 : 1}
                    />
                    {(r >= 8.5 || isHov) && (
                      <text
                        x={x}
                        y={y - r - 3}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight="600"
                        fill="currentColor"
                        className="text-slate-700 dark:text-slate-200 font-mono"
                      >
                        {point.symbol}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Live Radar Target Readout */}
        <div className="xl:col-span-4 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col justify-between space-y-3">
          {hoveredPoint ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-blue-600 dark:text-blue-400">
                      {hoveredPoint.symbol}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-medium border rounded ${
                        CATEGORY_META[hoveredPoint.category].badgeCls
                      }`}
                    >
                      {CATEGORY_META[hoveredPoint.category].label}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                    {hoveredPoint.name} · {hoveredPoint.sector}
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Score {hoveredPoint.radarScore.toFixed(0)}
                </span>
              </div>

              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-950 p-2.5 rounded border border-slate-100 dark:border-slate-800">
                {hoveredPoint.headline}
              </p>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                <div className="p-2 rounded bg-slate-50 dark:bg-slate-950">
                  <span className="text-[10px] text-slate-400 block font-sans">LTP / Day Chg</span>
                  <span className="font-semibold">
                    {formatNum(hoveredPoint.ltp)} ({formatPct(hoveredPoint.changePct)})
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-50 dark:bg-slate-950">
                  <span className="text-[10px] text-slate-400 block font-sans">Turn vs {nDays}d Avg</span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {hoveredPoint.turnoverMult.toFixed(2)}x ({formatCrore(hoveredPoint.turnover)} cr)
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-50 dark:bg-slate-950">
                  <span className="text-[10px] text-slate-400 block font-sans">Up/Down Vol ({nDays}d)</span>
                  <span className="font-semibold">{hoveredPoint.upDownVolRatio.toFixed(2)}x</span>
                </div>
                <div className="p-2 rounded bg-slate-50 dark:bg-slate-950">
                  <span className="text-[10px] text-slate-400 block font-sans">{nDays}d Return</span>
                  <span className="font-semibold">{formatPct(hoveredPoint.periodReturnN)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-slate-500 dark:text-slate-400">
              <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                Radar Signal Summary ({selectedDay})
              </div>
              <p className="leading-relaxed">
                Hover over any bubble on the Opportunity Quadrant to inspect its turnover acceleration, accumulation ratio, and divergence diagnosis, or click to open its full-screen chart.
              </p>
              {radar && (
                <div className="grid grid-cols-2 gap-2 pt-1 font-mono tabular-nums">
                  <div className="p-2.5 rounded bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
                    <div className="text-[10px] font-sans text-emerald-700 dark:text-emerald-300">
                      Turnover Alerts
                    </div>
                    <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                      {radar.accelerationAlerts.length}
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
                    <div className="text-[10px] font-sans text-blue-700 dark:text-blue-300">
                      Stealth Accum
                    </div>
                    <div className="text-lg font-bold text-blue-700 dark:text-blue-300">
                      {radar.stealthAccumulation.length}
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
                    <div className="text-[10px] font-sans text-rose-700 dark:text-rose-300">
                      Divergences
                    </div>
                    <div className="text-lg font-bold text-rose-700 dark:text-rose-300">
                      {radar.divergences.length}
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                    <div className="text-[10px] font-sans text-amber-700 dark:text-amber-300">
                      Breakout Watch
                    </div>
                    <div className="text-lg font-bold text-amber-700 dark:text-amber-300">
                      {radar.breakoutWatchlist.length}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-2">
            Bubble size = session turnover · Vertical dashed line = 1.75x {nDays}d average
          </div>
        </div>
      </div>

      {/* Intelligent Scanner Tabs */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg text-xs">
            {[
              { id: 'acceleration' as RadarTab, label: 'Turnover Acceleration', icon: Flame, count: radar?.accelerationAlerts.length ?? 0 },
              { id: 'accumulation' as RadarTab, label: 'Stealth Accumulation', icon: Sparkles, count: radar?.stealthAccumulation.length ?? 0 },
              { id: 'divergences' as RadarTab, label: 'Volume-Price Divergence', icon: AlertTriangle, count: radar?.divergences.length ?? 0 },
              { id: 'breakout' as RadarTab, label: 'Breakout Watchlist', icon: Activity, count: radar?.breakoutWatchlist.length ?? 0 },
              { id: 'sectors' as RadarTab, label: 'Sector Rotation', icon: Layers, count: radar?.sectorLeaders.length ?? 0 },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                  <span className="font-mono text-[10px] opacity-75">({tab.count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === 'sectors' ? (
          <div className="space-y-5">
            {radar?.sectorRotationMatrix && radar.sectorRotationMatrix.length > 0 && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                <div className="xl:col-span-7 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/40 dark:bg-slate-950/40 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      Sector Relative Rotation Matrix (RS-Ratio vs RS-Momentum)
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">100 = NEPSE equal-weight baseline</span>
                  </div>
                  {(() => {
                    const nodes = radar.sectorRotationMatrix!;
                    const SW = 620;
                    const SH = 290;
                    const SP = { t: 24, r: 22, b: 34, l: 46 };
                    const xs = nodes.map((n) => n.rsRatio);
                    const ys = nodes.map((n) => n.rsMomentum);
                    const maxDevX = Math.max(8, ...xs.map((v) => Math.abs(v - 100))) * 1.15;
                    const maxDevY = Math.max(6, ...ys.map((v) => Math.abs(v - 100))) * 1.15;
                    const xAt = (v: number) =>
                      SP.l + ((v - (100 - maxDevX)) / (2 * maxDevX)) * (SW - SP.l - SP.r);
                    const yAt = (v: number) =>
                      SP.t + (((100 + maxDevY) - v) / (2 * maxDevY)) * (SH - SP.t - SP.b);
                    const cx = xAt(100);
                    const cy = yAt(100);
                    const qColor = (q: string) =>
                      q === 'Leading'
                        ? '#10b981'
                        : q === 'Improving'
                          ? '#2563eb'
                          : q === 'Weakening'
                            ? '#d97706'
                            : '#ef4444';
                    return (
                      <svg viewBox={`0 0 ${SW} ${SH}`} className="w-full h-auto select-none">
                        <rect x={cx} y={SP.t} width={SW - SP.r - cx} height={cy - SP.t} fill="rgba(16, 185, 129, 0.06)" />
                        <rect x={SP.l} y={SP.t} width={cx - SP.l} height={cy - SP.t} fill="rgba(37, 99, 235, 0.05)" />
                        <rect x={cx} y={cy} width={SW - SP.r - cx} height={SH - SP.b - cy} fill="rgba(217, 119, 6, 0.05)" />
                        <rect x={SP.l} y={cy} width={cx - SP.l} height={SH - SP.b - cy} fill="rgba(239, 68, 68, 0.05)" />
                        <line x1={SP.l} y1={cy} x2={SW - SP.r} y2={cy} stroke="#94a3b8" strokeDasharray="3 3" strokeOpacity={0.7} />
                        <line x1={cx} y1={SP.t} x2={cx} y2={SH - SP.b} stroke="#94a3b8" strokeDasharray="3 3" strokeOpacity={0.7} />
                        <text x={SW - SP.r - 6} y={SP.t + 13} textAnchor="end" fontSize="10" fontWeight="600" fill="#10b981">LEADING</text>
                        <text x={SP.l + 6} y={SP.t + 13} textAnchor="start" fontSize="10" fontWeight="600" fill="#2563eb">IMPROVING</text>
                        <text x={SW - SP.r - 6} y={SH - SP.b - 6} textAnchor="end" fontSize="10" fontWeight="600" fill="#d97706">WEAKENING</text>
                        <text x={SP.l + 6} y={SH - SP.b - 6} textAnchor="start" fontSize="10" fontWeight="600" fill="#ef4444">LAGGING</text>
                        <text x={SW / 2} y={SH - 8} textAnchor="middle" fontSize="10" fill="#64748b">RS-Ratio vs NEPSE ({nDays}d)</text>
                        <text x={14} y={SH / 2} textAnchor="middle" fontSize="10" fill="#64748b" transform={`rotate(-90 14 ${SH / 2})`}>RS-Momentum</text>
                        {nodes.map((n) => {
                          const x = xAt(n.rsRatio);
                          const y = yAt(n.rsMomentum);
                          const r = 4.5 + Math.sqrt(Math.max(1, n.turnoverSharePct)) * 1.4;
                          const shortName = n.sector.replace('Development Banks', 'DevBank').replace('Hydro Power', 'Hydro').replace('Commercial Banks', 'Banks').replace('Microfinance', 'Microfin').replace('Non-Life Insurance', 'Non-Life').replace('Life Insurance', 'Life Ins');
                          return (
                            <g key={n.sector} onClick={() => onInspectSymbol(n.leaderSymbol)} className="cursor-pointer">
                              <circle cx={x} cy={y} r={r} fill={qColor(n.quadrant)} fillOpacity={0.82} stroke="#ffffff" strokeWidth={1.2} />
                              <text x={x} y={y - r - 3} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="currentColor" className="text-slate-700 dark:text-slate-200 font-mono">
                                {shortName}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    );
                  })()}
                </div>

                <div className="xl:col-span-5 space-y-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Quadrant Breakdown &amp; Institutional Ticket Leaders
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden text-xs">
                    {radar.sectorRotationMatrix.slice(0, 8).map((n) => (
                      <div key={n.sector} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {n.sector}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            RS {n.rsRatio.toFixed(1)} · Mom {n.rsMomentum.toFixed(1)} · Avg Ticket Rs {formatInt(n.avgTradeSizeNpr)}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`font-semibold text-[11px] ${
                              n.quadrant === 'Leading'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : n.quadrant === 'Improving'
                                  ? 'text-blue-600 dark:text-blue-400'
                                  : n.quadrant === 'Weakening'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {n.quadrant}
                          </div>
                          <button
                            type="button"
                            onClick={() => onInspectSymbol(n.leaderSymbol)}
                            className="font-mono text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {n.leaderSymbol} ({formatPct(n.leaderChangePct)})
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(radar?.sectorLeaders ?? []).map((sec) => (
                <div
                  key={sec.sector}
                  className="p-3.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{sec.sector}</span>
                    <span
                      className={`font-mono font-semibold ${
                        sec.rotationDeltaPct >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {sec.rotationDeltaPct >= 0 ? '+' : ''}
                      {sec.rotationDeltaPct.toFixed(1)}% share vs {nDays}d
                    </span>
                  </div>
                  <div className="flex justify-between font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Share: {sec.turnoverSharePct.toFixed(1)}% (avg {sec.avgTurnoverShareN.toFixed(1)}%)</span>
                    <span>{sec.turnoverVsAvgN.toFixed(1)}x {nDays}d turn</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/70 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500">
                      Avg Chg: <span className={sec.avgChangePct >= 0 ? 'text-emerald-600' : 'text-red-600'}>{formatPct(sec.avgChangePct)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onInspectSymbol(sec.leaderSymbol)}
                      className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Leader: {sec.leaderSymbol} →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : activeRows.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            No stocks matched this radar alert condition on {selectedDay}.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeRows.map((item) => {
              const meta = CATEGORY_META[item.category];
              const starred = hasSymbol(item.symbol);
              return (
                <div
                  key={`${item.category}-${item.symbol}`}
                  onClick={() => onInspectSymbol(item.symbol)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onInspectSymbol(item.symbol);
                  }}
                  className="p-3.5 rounded-md border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-700 bg-slate-50/40 dark:bg-slate-950/40 cursor-pointer transition-colors space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSymbol(item.symbol);
                          }}
                          className="text-slate-400 hover:text-amber-500"
                          aria-label={`Star ${item.symbol}`}
                        >
                          <Star className={`w-3.5 h-3.5 ${starred ? 'fill-amber-500 text-amber-500' : ''}`} />
                        </button>
                        <span className="font-semibold text-sm text-blue-600 dark:text-blue-400">
                          {item.symbol}
                        </span>
                        <span className={`px-1.5 py-0.5 text-[10px] font-medium border rounded ${meta.badgeCls}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {item.name} · {item.sector}
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        LTP {formatNum(item.ltp)}
                      </div>
                      <div
                        className={`text-[11px] font-semibold ${
                          item.changePct >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {formatPct(item.changePct)}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-snug">{item.headline}</p>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/70 dark:border-slate-800">
                    <span>Turn: {item.turnoverMult.toFixed(1)}x ({formatCrore(item.turnover)} cr)</span>
                    <span>Up/Dn Vol: {item.upDownVolRatio.toFixed(1)}x</span>
                    <span className="text-blue-600 dark:text-blue-400 inline-flex items-center gap-0.5 font-sans">
                      Inspect <ArrowUpRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Smart-Money Accumulation & Pocket Pivot Leaders */}
      {radar?.smartMoneyLeaders && radar.smartMoneyLeaders.length > 0 && (
        <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Smart-Money Accumulation &amp; Pocket Pivot Leaders ({selectedDay})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ranked by institutional Rs/transaction expansion vs {nDays}d baseline, Up/Down volume imbalance, Stage-2 structure, and 10-day Pocket Pivots
              </p>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Top {radar.smartMoneyLeaders.length} accumulation footprints
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 text-left font-medium">Stock · Sector</th>
                  <th className="py-2 px-2 text-right font-medium">LTP · Chg %</th>
                  <th className="py-2 px-2 text-right font-medium">SM Score</th>
                  <th className="py-2 px-2 text-right font-medium">Avg Rs / Tx</th>
                  <th className="py-2 px-2 text-right font-medium">Up/Dn Vol</th>
                  <th className="py-2 px-2 text-center font-medium">Pocket Pivot</th>
                  <th className="py-2 px-2 text-right font-medium">Stage-2</th>
                  <th className="py-2 px-2 text-right font-medium">vs VWAP</th>
                  <th className="py-2 pl-2 text-right font-medium">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                {radar.smartMoneyLeaders.map((sm) => (
                  <tr key={sm.symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 pr-3 font-sans">
                      <button
                        type="button"
                        onClick={() => onInspectSymbol(sm.symbol)}
                        className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {sm.symbol}
                      </button>
                      <span className="block text-[11px] text-slate-400 truncate max-w-[160px]">{sm.sector}</span>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div>{formatNum(sm.ltp)}</div>
                      <div className={`text-[11px] ${sm.changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {formatPct(sm.changePct)}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-900 dark:text-slate-100">
                      {sm.smartMoneyScore.toFixed(0)}/100
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div>Rs {formatInt(sm.avgTradeSizeNpr)}</div>
                      <div className="text-[11px] text-amber-600 dark:text-amber-400">{sm.avgTradeSizeMult.toFixed(2)}x</div>
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {sm.upDownVolRatio.toFixed(2)}x
                    </td>
                    <td className="py-2 px-2 text-center font-sans">
                      {sm.pocketPivot ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Pocket Pivot ✓</span>
                      ) : (
                        <span className="text-slate-400">–</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">{sm.stage2ProxyScore}/6</td>
                    <td className="py-2 px-2 text-right">{sm.vwapPct !== null ? formatPct(sm.vwapPct) : '–'}</td>
                    <td className="py-2 pl-2 text-right font-sans">
                      <div className="inline-flex items-center gap-2">
                        {onInspectInQuant && (
                          <button
                            type="button"
                            onClick={() => onInspectInQuant(sm.symbol)}
                            className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                          >
                            Decision Gate →
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Smart Stock Comparison Engine */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Smart Stock Comparison Engine (Indexed {nDays}-Day Performance)
            </h3>
            <InfoTip
              title="Normalized Relative Performance"
              body={`Rebases each selected stock to 0% at the start of the ${nDays}-day rolling window so you can compare high-priced and low-priced NEPSE stocks on an equal percentage scale.`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {compareSymbols.map((sym, idx) => (
              <span
                key={sym}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-mono font-semibold bg-slate-50 dark:bg-slate-950"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: COMPARE_COLORS[idx % COMPARE_COLORS.length] }}
                />
                <span>{sym}</span>
                <button
                  type="button"
                  onClick={() => setCompareSymbols((prev) => prev.filter((s) => s !== sym))}
                  className="text-slate-400 hover:text-red-500"
                  aria-label={`Remove ${sym}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            {compareSymbols.length < 4 && (
              <div className="relative">
                <div className="flex items-center">
                  <input
                    type="text"
                    value={addSymbolQuery}
                    onChange={(e) => setAddSymbolQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && symbolMatches.length > 0) {
                        addCompareSymbol(symbolMatches[0].symbol);
                      }
                    }}
                    placeholder="+ Compare ticker…"
                    className="w-36 px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
                {symbolMatches.length > 0 && (
                  <div className="absolute right-0 mt-1 w-60 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-30 divide-y divide-slate-100 dark:divide-slate-800">
                    {symbolMatches.map((m) => (
                      <button
                        key={m.symbol}
                        type="button"
                        onClick={() => addCompareSymbol(m.symbol)}
                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          {m.symbol}
                        </span>
                        <span className="text-slate-500 truncate">{m.name}</span>
                        <Plus className="w-3 h-3 text-slate-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {loadingCompare ? (
          <div className="h-56 animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
        ) : compareChart && comparison ? (
          <div className="space-y-4">
            <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full h-auto max-h-[260px]">
              <line
                x1={CPAD.l}
                y1={compareChart.zeroLineY}
                x2={CW - CPAD.r}
                y2={compareChart.zeroLineY}
                stroke="#94a3b8"
                strokeDasharray="3 3"
                strokeOpacity={0.6}
              />
              <text x={CPAD.l - 8} y={CPAD.t + 8} textAnchor="end" fontSize="10" fill="#94a3b8" className="font-mono">
                +{compareChart.maxP.toFixed(1)}%
              </text>
              <text x={CPAD.l - 8} y={compareChart.zeroLineY + 3} textAnchor="end" fontSize="10" fill="#94a3b8" className="font-mono">
                0%
              </text>
              <text x={CPAD.l - 8} y={CH - CPAD.b} textAnchor="end" fontSize="10" fill="#94a3b8" className="font-mono">
                {compareChart.minP.toFixed(1)}%
              </text>

              {compareChart.lines.map((ln) => (
                <g key={ln.symbol}>
                  <polyline
                    fill="none"
                    stroke={ln.color}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={ln.path}
                  />
                  {ln.last && (
                    <g>
                      <circle cx={ln.last.x} cy={ln.last.y} r="3.5" fill={ln.color} />
                      <text
                        x={Math.min(CW - 52, ln.last.x + 6)}
                        y={ln.last.y + 3}
                        fontSize="10"
                        fontWeight="600"
                        fill={ln.color}
                        className="font-mono"
                      >
                        {ln.symbol} ({ln.last.pct >= 0 ? '+' : ''}{ln.last.pct.toFixed(1)}%)
                      </text>
                    </g>
                  )}
                </g>
              ))}
            </svg>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 text-left font-medium">Stock</th>
                    <th className="py-2 px-3 text-right font-medium">LTP</th>
                    <th className="py-2 px-3 text-right font-medium">Day %</th>
                    <th className="py-2 px-3 text-right font-medium">{nDays}d Return</th>
                    <th className="py-2 px-3 text-right font-medium">{nDays}d Avg Turn</th>
                    <th className="py-2 px-3 text-right font-medium">Turn Multiple</th>
                    <th className="py-2 px-3 text-right font-medium">vs VWAP</th>
                    <th className="py-2 px-3 text-right font-medium">vs MA120</th>
                    <th className="py-2 px-3 text-right font-medium">52w Pos</th>
                    <th className="py-2 pl-3 text-right font-medium">Rs / Tx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                  {comparison.stocks.map((st, idx) => (
                    <tr
                      key={st.symbol}
                      onClick={() => onInspectSymbol(st.symbol)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
                    >
                      <td className="py-2 pr-3 font-sans">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: COMPARE_COLORS[idx % COMPARE_COLORS.length] }}
                          />
                          <div>
                            <div className="font-semibold text-blue-600 dark:text-blue-400">{st.symbol}</div>
                            <div className="text-[10px] text-slate-400">{st.sector}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-semibold">{formatNum(st.ltp)}</td>
                      <td
                        className={`py-2 px-3 text-right ${
                          st.dayChangePct >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {formatPct(st.dayChangePct)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-semibold ${
                          (st.returnNPct ?? 0) >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {formatPct(st.returnNPct)}
                      </td>
                      <td className="py-2 px-3 text-right">{formatCrore(st.avgTurnoverN)} cr</td>
                      <td className="py-2 px-3 text-right text-amber-600 dark:text-amber-400 font-semibold">
                        {st.turnoverMultN.toFixed(2)}x
                      </td>
                      <td className="py-2 px-3 text-right">{formatPct(st.vwapPct)}</td>
                      <td className="py-2 px-3 text-right">{formatPct(st.vsD120Pct)}</td>
                      <td className="py-2 px-3 text-right">
                        {st.pos52wPct !== null ? `${st.pos52wPct.toFixed(0)}%` : '–'}
                      </td>
                      <td className="py-2 pl-3 text-right">{formatInt(st.avgTradeSize)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-slate-400">
            Select 2–4 NEPSE tickers above to compare relative returns and liquidity side-by-side.
          </div>
        )}
      </section>
    </div>
  );
};
