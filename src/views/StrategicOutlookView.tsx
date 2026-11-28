import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CandlestickChart,
  Download,
  FileSpreadsheet,
  FileText,
  Grid,
  Layers,
  Minus,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Target,
} from 'lucide-react';
import {
  FundamentalMenuBar,
  type FundamentalMenuId,
} from '../components/FundamentalMenuBar';
import type {
  AnnualReportPillarStatus,
  OutperformanceStatus,
  StrategicOutlookCompanyRow,
  StrategicOutlookHeatmapResponse,
  StrategicOutlookQuadrant,
} from '../types/fundamental';
import { triggerPngDownload } from '../utils/chartExport';

interface StrategicOutlookViewProps {
  equityOnly: boolean;
  initialSymbol?: string | null;
  onSymbolChange?: (symbol: string) => void;
  onOpenAnnualReports?: (symbol: string) => void;
  onOpenValuation?: (symbol: string) => void;
  onInspectSymbol?: (symbol: string) => void;
  onInspectInScreener?: (symbol: string) => void;
  onSelectFundamentalMenu?: (target: FundamentalMenuId, symbol?: string | null) => void;
}

type HeatmapDisplayMode = 'quadrant' | 'sector' | 'matrix';
type SortKey = 'outperformance' | 'management' | 'growth' | 'composite';

const QUADRANTS: Array<{
  id: StrategicOutlookQuadrant;
  title: string;
  criteria: string;
  description: string;
}> = [
  {
    id: 'Compounders',
    title: 'Compounders',
    criteria: 'Mgmt ≥ 56 · Growth ≥ 56',
    description: 'High governance discipline paired with strong earnings expansion.',
  },
  {
    id: 'Scaling & Turnaround',
    title: 'Scaling & Turnaround',
    criteria: 'Mgmt < 56 · Growth ≥ 56',
    description: 'Accelerating top/bottom-line momentum while balance-sheet efficiency matures.',
  },
  {
    id: 'Resilient Stewards',
    title: 'Resilient Stewards',
    criteria: 'Mgmt ≥ 56 · Growth < 56',
    description: 'Strong capital retention & governance with moderate near-term expansion.',
  },
  {
    id: 'Restructuring Watch',
    title: 'Restructuring Watch',
    criteria: 'Mgmt < 56 · Growth < 56',
    description: 'Sub-hurdle capital efficiency and softer earnings trajectory.',
  },
];

function tileColors(score: number, status: OutperformanceStatus, selected: boolean): string {
  const ring = selected ? 'ring-2 ring-blue-600 dark:ring-blue-400' : '';
  if (status === 'Outperforming') {
    if (score >= 30) {
      return `bg-emerald-600/20 dark:bg-emerald-500/25 border-emerald-500/60 dark:border-emerald-500/50 text-slate-900 dark:text-slate-100 ${ring}`;
    }
    return `bg-emerald-500/12 dark:bg-emerald-500/15 border-emerald-400/50 dark:border-emerald-700/60 text-slate-900 dark:text-slate-100 ${ring}`;
  }
  if (status === 'Lagging') {
    if (score <= -30) {
      return `bg-red-600/20 dark:bg-red-500/25 border-red-500/60 dark:border-red-500/50 text-slate-900 dark:text-slate-100 ${ring}`;
    }
    return `bg-red-500/10 dark:bg-red-500/15 border-red-400/50 dark:border-red-800/60 text-slate-900 dark:text-slate-100 ${ring}`;
  }
  return `bg-slate-100 dark:bg-slate-800/70 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 ${ring}`;
}

function statusTextTone(status: OutperformanceStatus): string {
  if (status === 'Outperforming') return 'text-emerald-700 dark:text-emerald-300';
  if (status === 'Lagging') return 'text-red-600 dark:text-red-400';
  return 'text-slate-600 dark:text-slate-300';
}

function pillarTextTone(status: AnnualReportPillarStatus): string {
  switch (status) {
    case 'Strong':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'Solid':
      return 'text-blue-700 dark:text-blue-300';
    case 'Watch':
      return 'text-amber-700 dark:text-amber-300';
    case 'Fragile':
      return 'text-red-600 dark:text-red-400';
  }
}

function dotFillColor(status: OutperformanceStatus, score: number): string {
  if (status === 'Outperforming') return score >= 25 ? '#15803d' : '#16a34a';
  if (status === 'Lagging') return score <= -25 ? '#b91c1c' : '#dc2626';
  return '#64748b';
}

function fmtNum(v: number | null | undefined, digits = 1, suffix = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}${suffix}`;
}

export const StrategicOutlookView: React.FC<StrategicOutlookViewProps> = ({
  equityOnly,
  initialSymbol,
  onSymbolChange,
  onOpenAnnualReports,
  onOpenValuation,
  onInspectSymbol,
  onInspectInScreener,
  onSelectFundamentalMenu,
}) => {
  const [data, setData] = useState<StrategicOutlookHeatmapResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [displayMode, setDisplayMode] = useState<HeatmapDisplayMode>('quadrant');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [quadrantFilter, setQuadrantFilter] = useState<StrategicOutlookQuadrant | 'All'>('All');
  const [outperfFilter, setOutperfFilter] = useState<OutperformanceStatus | 'All'>('All');
  const [multiFyOnly, setMultiFyOnly] = useState<boolean>(false);
  const [aiDistilledOnly, setAiDistilledOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<SortKey>('outperformance');

  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol || '');
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [distillingSymbol, setDistillingSymbol] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadHeatmap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/annual-reports/strategic-outlook?equityOnly=${equityOnly}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load Strategic Outlook Heat Map (HTTP ${res.status})`);
      }
      const payload = (await res.json()) as StrategicOutlookHeatmapResponse;
      setData(payload);
      setSelectedSymbol((prev) => {
        if (initialSymbol && payload.rows.some((r) => r.symbol === initialSymbol.toUpperCase())) {
          return initialSymbol.toUpperCase();
        }
        if (prev && payload.rows.some((r) => r.symbol === prev)) return prev;
        return payload.rows[0]?.symbol || '';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Strategic Outlook Heat Map');
    } finally {
      setLoading(false);
    }
  }, [equityOnly, initialSymbol]);

  useEffect(() => {
    void loadHeatmap();
  }, [loadHeatmap]);

  useEffect(() => {
    if (initialSymbol && data?.rows.some((r) => r.symbol === initialSymbol.toUpperCase())) {
      setSelectedSymbol(initialSymbol.toUpperCase());
    }
  }, [initialSymbol, data]);

  const handleSelectRow = (sym: string) => {
    setSelectedSymbol(sym);
    onSymbolChange?.(sym);
  };

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();
    const list = data.rows.filter((r) => {
      if (q && !r.symbol.toLowerCase().includes(q) && !r.companyName.toLowerCase().includes(q)) {
        return false;
      }
      if (sectorFilter !== 'All' && r.sector !== sectorFilter) return false;
      if (quadrantFilter !== 'All' && r.quadrant !== quadrantFilter) return false;
      if (outperfFilter !== 'All' && r.outperformanceStatus !== outperfFilter) return false;
      if (multiFyOnly && r.baselineMode !== 'self-multi-fy') return false;
      if (aiDistilledOnly && !r.hasAiDistillation) return false;
      return true;
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortBy === 'management') {
        return b.managementQualityScore - a.managementQualityScore || b.growthPotentialScore - a.growthPotentialScore;
      }
      if (sortBy === 'growth') {
        return b.growthPotentialScore - a.growthPotentialScore || b.managementQualityScore - a.managementQualityScore;
      }
      if (sortBy === 'composite') {
        return b.strategicCompositeScore - a.strategicCompositeScore || b.outperformanceScore - a.outperformanceScore;
      }
      return b.outperformanceScore - a.outperformanceScore || b.strategicCompositeScore - a.strategicCompositeScore;
    });
    return sorted;
  }, [data, searchQuery, sectorFilter, quadrantFilter, outperfFilter, multiFyOnly, aiDistilledOnly, sortBy]);

  const activeCompany = useMemo(() => {
    if (!data) return null;
    return (
      filteredRows.find((r) => r.symbol === selectedSymbol) ??
      data.rows.find((r) => r.symbol === selectedSymbol) ??
      filteredRows[0] ??
      data.rows[0] ??
      null
    );
  }, [data, filteredRows, selectedSymbol]);

  const hoveredCompany = useMemo(() => {
    if (!hoveredSymbol || !data) return null;
    return filteredRows.find((r) => r.symbol === hoveredSymbol) ?? null;
  }, [hoveredSymbol, filteredRows, data]);

  const groupedByQuadrant = useMemo(() => {
    const map: Record<StrategicOutlookQuadrant, StrategicOutlookCompanyRow[]> = {
      Compounders: [],
      'Scaling & Turnaround': [],
      'Resilient Stewards': [],
      'Restructuring Watch': [],
    };
    for (const r of filteredRows) {
      map[r.quadrant].push(r);
    }
    return map;
  }, [filteredRows]);

  const groupedBySector = useMemo(() => {
    const map = new Map<string, StrategicOutlookCompanyRow[]>();
    for (const r of filteredRows) {
      const arr = map.get(r.sector) ?? [];
      arr.push(r);
      map.set(r.sector, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filteredRows]);

  const summaryStats = useMemo(() => {
    const total = filteredRows.length;
    const outperforming = filteredRows.filter((r) => r.outperformanceStatus === 'Outperforming');
    const compounders = filteredRows.filter((r) => r.quadrant === 'Compounders');
    const scaling = filteredRows.filter((r) => r.quadrant === 'Scaling & Turnaround');
    const multiFy = filteredRows.filter((r) => r.baselineMode === 'self-multi-fy').length;
    const avgOutperf =
      outperforming.length > 0
        ? outperforming.reduce((a, r) => a + r.outperformanceScore, 0) / outperforming.length
        : 0;
    return {
      total,
      outperformingCount: outperforming.length,
      outperformingPct: total > 0 ? Math.round((outperforming.length / total) * 100) : 0,
      avgOutperf,
      compoundersCount: compounders.length,
      scalingCount: scaling.length,
      multiFy,
    };
  }, [filteredRows]);

  const handleDistillSelected = async (sym: string) => {
    setDistillingSymbol(sym);
    setActionMsg(null);
    try {
      const res = await fetch('/api/annual-reports/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, force: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Failed to distill ${sym}`);
      }
      setActionMsg(`Annual report insights distilled for ${sym} (FY ${body.fiscalYear}).`);
      await loadHeatmap();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : `Unable to distill ${sym}`);
    } finally {
      setDistillingSymbol(null);
    }
  };

  const handleExportCsv = () => {
    if (filteredRows.length === 0) return;
    const headers = [
      'Symbol',
      'Company',
      'Sector',
      'Quadrant',
      'ManagementQualityScore',
      'GrowthPotentialScore',
      'StrategicCompositeScore',
      'OutperformanceStatus',
      'OutperformanceScore',
      'PrimaryDelta',
      'BaselineMode',
      'LatestFY',
      'ROE_Pct',
      'Historical_ROE_Pct',
      'NetMargin_Pct',
      'EPS',
      'RegulatoryStanding',
    ];
    const escape = (v: string | number | null) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.join(','),
      ...filteredRows.map((r) =>
        [
          r.symbol,
          r.companyName,
          r.sector,
          r.quadrant,
          r.managementQualityScore,
          r.growthPotentialScore,
          r.strategicCompositeScore,
          r.outperformanceStatus,
          r.outperformanceScore,
          r.primaryDeltaLabel,
          r.baselineLabel,
          r.latestFy,
          r.roePct ?? '',
          r.histRoePct ?? '',
          r.netMarginPct ?? '',
          r.eps ?? '',
          r.regulatoryStanding,
        ]
          .map(escape)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nepse-strategic-outlook-heatmap-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPng = () => {
    if (!data || filteredRows.length === 0) return;
    const isDark = document.documentElement.classList.contains('dark');
    const width = 1280;
    const height = 760;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bg = isDark ? '#0b1220' : '#ffffff';
    const panelBg = isDark ? '#0f172a' : '#f8fafc';
    const border = isDark ? '#1e293b' : '#cbd5e1';
    const textMain = isDark ? '#f1f5f9' : '#0f172a';
    const textMuted = isDark ? '#94a3b8' : '#475569';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = panelBg;
    ctx.fillRect(0, 0, width, 68);
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(0, 68);
    ctx.lineTo(width, 68);
    ctx.stroke();

    ctx.fillStyle = textMain;
    ctx.font = '700 20px sans-serif';
    ctx.fillText('NEPSE Strategic Outlook Heat Map', 28, 30);
    ctx.fillStyle = textMuted;
    ctx.font = '500 12px monospace';
    ctx.fillText(
      `Showing ${filteredRows.length} companies · ${summaryStats.outperformingCount} Outperforming Historical Averages · Sector: ${sectorFilter} · ${new Date().toISOString().slice(0, 10)}`,
      28,
      52
    );

    const plotX = 80;
    const plotY = 104;
    const plotW = 740;
    const plotH = 590;

    ctx.fillStyle = panelBg;
    ctx.fillRect(plotX, plotY, plotW, plotH);
    ctx.strokeStyle = border;
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // Quadrant crosshairs
    const cutX = plotX + (data.managementThreshold / 100) * plotW;
    const cutY = plotY + (1 - data.growthThreshold / 100) * plotH;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = isDark ? '#334155' : '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(cutX, plotY);
    ctx.lineTo(cutX, plotY + plotH);
    ctx.moveTo(plotX, cutY);
    ctx.lineTo(plotX + plotW, cutY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = '#16a34a';
    ctx.fillText('COMPOUNDERS', plotX + plotW - 120, plotY + 24);
    ctx.fillStyle = '#2563eb';
    ctx.fillText('SCALING / TURNAROUND', plotX + 16, plotY + 24);
    ctx.fillStyle = '#d97706';
    ctx.fillText('RESILIENT STEWARDS', plotX + plotW - 150, plotY + plotH - 14);
    ctx.fillStyle = '#dc2626';
    ctx.fillText('RESTRUCTURING WATCH', plotX + 16, plotY + plotH - 14);

    // Axis titles
    ctx.fillStyle = textMuted;
    ctx.font = '600 12px monospace';
    ctx.fillText('Management Quality Score (0 – 100) →', plotX + plotW / 2 - 125, plotY + plotH + 30);
    ctx.save();
    ctx.translate(32, plotY + plotH / 2 + 85);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Growth Potential Score (0 – 100) →', 0, 0);
    ctx.restore();

    for (const r of filteredRows) {
      const cx = plotX + (r.managementQualityScore / 100) * plotW;
      const cy = plotY + (1 - r.growthPotentialScore / 100) * plotH;
      ctx.beginPath();
      ctx.arc(cx, cy, r.baselineMode === 'self-multi-fy' ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = dotFillColor(r.outperformanceStatus, r.outperformanceScore);
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Label top 12 outperformers cleanly
    ctx.font = '700 10px monospace';
    ctx.fillStyle = textMain;
    for (const r of filteredRows.slice(0, 12)) {
      const cx = plotX + (r.managementQualityScore / 100) * plotW;
      const cy = plotY + (1 - r.growthPotentialScore / 100) * plotH;
      ctx.fillText(r.symbol, cx + 7, cy + 3);
    }

    // Right leaderboard column
    const sideX = 850;
    ctx.fillStyle = textMain;
    ctx.font = '700 14px sans-serif';
    ctx.fillText('Top Historical Outperformers', sideX, 118);
    ctx.font = '500 11px monospace';
    filteredRows.slice(0, 18).forEach((r, idx) => {
      const y = 148 + idx * 30;
      ctx.fillStyle = textMain;
      ctx.fillText(r.symbol.padEnd(8, ' '), sideX, y);
      ctx.fillStyle = textMuted;
      ctx.fillText(
        `M:${Math.round(r.managementQualityScore)} G:${Math.round(r.growthPotentialScore)}`,
        sideX + 76,
        y
      );
      ctx.fillStyle = dotFillColor(r.outperformanceStatus, r.outperformanceScore);
      ctx.fillText(r.primaryDeltaLabel, sideX + 185, y);
    });

    triggerPngDownload(
      canvas.toDataURL('image/png'),
      `nepse-strategic-outlook-${new Date().toISOString().slice(0, 10)}.png`
    );
  };

  return (
    <div className="space-y-6">
      {onSelectFundamentalMenu && (
        <FundamentalMenuBar
          active="strategic-outlook"
          activeSymbol={activeCompany?.symbol || null}
          onSelect={onSelectFundamentalMenu}
        />
      )}

      {/* Header */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Strategic Outlook Heat Map
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
            Categorizes NEPSE companies by Management Quality and Growth Potential extracted from annual reports, highlighting which businesses are outperforming their historical averages.
          </p>
          {data?.fiscalContext && (
            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              FY {data.fiscalContext.currentFy} · Closed FY {data.fiscalContext.latestCompletedFy} ·{' '}
              {data.totalCompanies} Companies · {data.multiFyCompanies} Multi-FY Self Histories ·{' '}
              {data.aiDistilledCompanies} AI Distilled
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportPng}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export PNG</span>
          </button>
          <button
            type="button"
            onClick={() => void loadHeatmap()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </section>

      {error && (
        <div className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-lg p-4 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadHeatmap()}
            className="px-3 py-1.5 rounded bg-red-600 text-white font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {actionMsg && (
        <div className="border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 rounded-lg px-4 py-2.5 text-xs text-blue-800 dark:text-blue-200 flex items-center justify-between gap-3">
          <span>{actionMsg}</span>
          <button
            type="button"
            onClick={() => setActionMsg(null)}
            className="text-blue-600 dark:text-blue-300 hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4-column Summary KPI strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Outperforming History</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
            {loading ? '—' : `${summaryStats.outperformingCount}`}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1.5">
              ({summaryStats.outperformingPct}%)
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            Avg spread +{summaryStats.avgOutperf.toFixed(1)} idx vs baseline
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Compounders</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {loading ? '—' : summaryStats.compoundersCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            High Management Quality · High Growth
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Scaling &amp; Turnaround</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-300">
            {loading ? '—' : summaryStats.scalingCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            High Growth · Developing Management
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Multi-FY Self Baseline</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {loading ? '—' : summaryStats.multiFy}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1.5">
              / {summaryStats.total}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Remainder compared vs sector averages
          </div>
        </div>
      </section>

      {/* Filters & Visualization Mode Bar */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Visualization Mode Switcher */}
          <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => setDisplayMode('quadrant')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                displayMode === 'quadrant'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>Quadrant Heat Map</span>
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('sector')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                displayMode === 'sector'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Sector Heat Map</span>
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('matrix')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                displayMode === 'matrix'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              <span>2×2 Strategic Matrix</span>
            </button>
          </div>

          {/* Search, Sector & Sort Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search symbol or company…"
                className="pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 w-48 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              aria-label="Filter by sector"
              className="px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="All">All Sectors ({data?.sectors.length ?? 0})</option>
              {(data?.sectors ?? []).map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              aria-label="Sort tiles"
              className="px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            >
              <option value="outperformance">Sort: Outperforming History</option>
              <option value="management">Sort: Management Quality</option>
              <option value="growth">Sort: Growth Potential</option>
              <option value="composite">Sort: Combined Strategic Score</option>
            </select>
          </div>
        </div>

        {/* Secondary Filter Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['All', 'Compounders', 'Scaling & Turnaround', 'Resilient Stewards', 'Restructuring Watch'] as const).map(
              (qId) => (
                <button
                  key={qId}
                  type="button"
                  onClick={() => setQuadrantFilter(qId)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    quadrantFilter === qId
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-medium'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {qId === 'All' ? 'All Quadrants' : qId}
                </button>
              )
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="inline-flex items-center gap-1 p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              {(['All', 'Outperforming', 'In-Line', 'Lagging'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setOutperfFilter(st)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    outperfFilter === st
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={multiFyOnly}
                onChange={(e) => setMultiFyOnly(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>Self Multi-FY Only</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={aiDistilledOnly}
                onChange={(e) => setAiDistilledOnly(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <span>AI Distilled Only</span>
            </label>
          </div>
        </div>
      </section>

      {/* Main Content Split: Heat Map Canvas + Selected Company Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 space-y-6">
          {loading ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-6 space-y-4">
              <div className="h-6 w-64 animate-pulse bg-slate-200 dark:bg-slate-800 rounded" />
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i} className="h-20 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-md" />
                ))}
              </div>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-8 text-center space-y-3">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                No companies match the active Strategic Outlook filters
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Reset filters or switch baseline mode to view all {data?.totalCompanies ?? 0} indexed companies.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSectorFilter('All');
                  setQuadrantFilter('All');
                  setOutperfFilter('All');
                  setMultiFyOnly(false);
                  setAiDistilledOnly(false);
                }}
                className="px-4 py-2 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
              {/* Color Legend */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800 text-xs">
                <div className="font-medium text-slate-800 dark:text-slate-200">
                  {displayMode === 'quadrant'
                    ? 'Strategic Quadrants (Management Quality × Growth Potential)'
                    : displayMode === 'sector'
                      ? 'Sector Heat Map (Grouped by Industry)'
                      : '2×2 Strategic Matrix (Management Quality X vs Growth Potential Y)'}
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 ml-2 tabular-nums">
                    {filteredRows.length} shown
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-emerald-600/30 border border-emerald-500/70 inline-block" />
                    <span>Outperforming Hist. Avg</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-slate-200 dark:bg-slate-700 border border-slate-400 dark:border-slate-600 inline-block" />
                    <span>In-Line (-6 to +6)</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-red-600/30 border border-red-500/70 inline-block" />
                    <span>Lagging Hist. Avg</span>
                  </span>
                </div>
              </div>

              {displayMode === 'quadrant' && (
                <div className="space-y-6">
                  {QUADRANTS.map((q) => {
                    const list = groupedByQuadrant[q.id];
                    if (quadrantFilter !== 'All' && quadrantFilter !== q.id) return null;
                    if (list.length === 0) return null;
                    return (
                      <div key={q.id} className="space-y-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {q.title}
                              <span className="ml-2 font-mono text-xs font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                                ({list.length})
                              </span>
                            </h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {q.criteria} · {q.description}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                          {list.map((r) => {
                            const isSelected = activeCompany?.symbol === r.symbol;
                            return (
                              <button
                                key={r.symbol}
                                type="button"
                                onClick={() => handleSelectRow(r.symbol)}
                                className={`text-left p-2.5 rounded-md border transition-colors cursor-pointer ${tileColors(
                                  r.outperformanceScore,
                                  r.outperformanceStatus,
                                  isSelected
                                )}`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-mono font-bold text-xs truncate">
                                    {r.symbol}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                                    {r.baselineMode === 'self-multi-fy' ? `${r.totalFyCount}FY` : 'Sec'}
                                  </span>
                                </div>
                                <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200">
                                  M {Math.round(r.managementQualityScore)} · G {Math.round(r.growthPotentialScore)}
                                </div>
                                <div
                                  className={`mt-1 font-mono text-[11px] font-semibold tabular-nums truncate ${statusTextTone(
                                    r.outperformanceStatus
                                  )}`}
                                >
                                  {r.primaryDeltaLabel}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {displayMode === 'sector' && (
                <div className="space-y-6">
                  {groupedBySector.map(([sectorName, list]) => {
                    const outCount = list.filter((x) => x.outperformanceStatus === 'Outperforming').length;
                    return (
                      <div key={sectorName} className="space-y-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {sectorName}
                            <span className="ml-2 font-mono text-xs font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                              {list.length} firms · {outCount} outperforming
                            </span>
                          </h3>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                          {list.map((r) => {
                            const isSelected = activeCompany?.symbol === r.symbol;
                            return (
                              <button
                                key={r.symbol}
                                type="button"
                                onClick={() => handleSelectRow(r.symbol)}
                                className={`text-left p-2.5 rounded-md border transition-colors cursor-pointer ${tileColors(
                                  r.outperformanceScore,
                                  r.outperformanceStatus,
                                  isSelected
                                )}`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-mono font-bold text-xs truncate">
                                    {r.symbol}
                                  </span>
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                    {r.quadrant.split(' ')[0]}
                                  </span>
                                </div>
                                <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200">
                                  M {Math.round(r.managementQualityScore)} · G {Math.round(r.growthPotentialScore)}
                                </div>
                                <div
                                  className={`mt-1 font-mono text-[11px] font-semibold tabular-nums truncate ${statusTextTone(
                                    r.outperformanceStatus
                                  )}`}
                                >
                                  {r.primaryDeltaLabel}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {displayMode === 'matrix' && data && (
                <div className="space-y-3">
                  <div className="relative w-full overflow-x-auto">
                    <svg
                      viewBox="0 0 760 480"
                      className="w-full h-auto min-w-[540px] border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/70 dark:bg-slate-950/70"
                      role="img"
                      aria-label="Management Quality vs Growth Potential 2x2 Strategic Matrix"
                    >
                      {/* Plot area: x=65..725 (w=660), y=32..422 (h=390) */}
                      {/* Subtle Quadrant Backgrounds */}
                      <rect
                        x={65 + (data.managementThreshold / 100) * 660}
                        y={32}
                        width={660 * (1 - data.managementThreshold / 100)}
                        height={390 * (1 - data.growthThreshold / 100)}
                        fill="#16a34a"
                        fillOpacity={0.05}
                      />
                      <rect
                        x={65}
                        y={32}
                        width={660 * (data.managementThreshold / 100)}
                        height={390 * (1 - data.growthThreshold / 100)}
                        fill="#2563eb"
                        fillOpacity={0.04}
                      />
                      <rect
                        x={65}
                        y={32 + 390 * (1 - data.growthThreshold / 100)}
                        width={660 * (data.managementThreshold / 100)}
                        height={390 * (data.growthThreshold / 100)}
                        fill="#dc2626"
                        fillOpacity={0.04}
                      />

                      {/* Grid lines at 20, 40, 60, 80 */}
                      {[20, 40, 60, 80].map((v) => {
                        const gx = 65 + (v / 100) * 660;
                        const gy = 32 + (1 - v / 100) * 390;
                        return (
                          <g key={v}>
                            <line
                              x1={gx}
                              y1={32}
                              x2={gx}
                              y2={422}
                              stroke="currentColor"
                              className="text-slate-200 dark:text-slate-800"
                              strokeWidth={1}
                            />
                            <line
                              x1={65}
                              y1={gy}
                              x2={725}
                              y2={gy}
                              stroke="currentColor"
                              className="text-slate-200 dark:text-slate-800"
                              strokeWidth={1}
                            />
                            <text
                              x={gx}
                              y={440}
                              textAnchor="middle"
                              className="fill-slate-400 text-[10px] font-mono"
                            >
                              {v}
                            </text>
                            <text
                              x={55}
                              y={gy + 3}
                              textAnchor="end"
                              className="fill-slate-400 text-[10px] font-mono"
                            >
                              {v}
                            </text>
                          </g>
                        );
                      })}

                      {/* Threshold crosshairs */}
                      <line
                        x1={65 + (data.managementThreshold / 100) * 660}
                        y1={32}
                        x2={65 + (data.managementThreshold / 100) * 660}
                        y2={422}
                        stroke="#64748b"
                        strokeDasharray="4 4"
                        strokeWidth={1.25}
                      />
                      <line
                        x1={65}
                        y1={32 + (1 - data.growthThreshold / 100) * 390}
                        x2={725}
                        y2={32 + (1 - data.growthThreshold / 100) * 390}
                        stroke="#64748b"
                        strokeDasharray="4 4"
                        strokeWidth={1.25}
                      />

                      {/* Quadrant labels */}
                      <text x={715} y={50} textAnchor="end" className="fill-emerald-700 dark:fill-emerald-400 text-[11px] font-semibold">
                        Compounders
                      </text>
                      <text x={75} y={50} textAnchor="start" className="fill-blue-700 dark:fill-blue-400 text-[11px] font-semibold">
                        Scaling &amp; Turnaround
                      </text>
                      <text x={715} y={412} textAnchor="end" className="fill-amber-700 dark:fill-amber-400 text-[11px] font-semibold">
                        Resilient Stewards
                      </text>
                      <text x={75} y={412} textAnchor="start" className="fill-red-600 dark:fill-red-400 text-[11px] font-semibold">
                        Restructuring Watch
                      </text>

                      {/* Axes titles */}
                      <text x={395} y={464} textAnchor="middle" className="fill-slate-500 text-[11px] font-medium">
                        Management Quality Score (Annual Reports &amp; Governance, 0–100)
                      </text>
                      <text
                        x={20}
                        y={227}
                        textAnchor="middle"
                        transform="rotate(-90 20 227)"
                        className="fill-slate-500 text-[11px] font-medium"
                      >
                        Growth Potential Score (0–100)
                      </text>

                      {/* Data points */}
                      {filteredRows.map((r) => {
                        const cx = 65 + (r.managementQualityScore / 100) * 660;
                        const cy = 32 + (1 - r.growthPotentialScore / 100) * 390;
                        const isSelected = activeCompany?.symbol === r.symbol;
                        const isHovered = hoveredSymbol === r.symbol;
                        const radius = isSelected ? 7.5 : r.baselineMode === 'self-multi-fy' ? 6 : 4.5;
                        return (
                          <g
                            key={r.symbol}
                            className="cursor-pointer"
                            onMouseEnter={() => setHoveredSymbol(r.symbol)}
                            onMouseLeave={() => setHoveredSymbol(null)}
                            onClick={() => handleSelectRow(r.symbol)}
                          >
                            <circle
                              cx={cx}
                              cy={cy}
                              r={radius}
                              fill={dotFillColor(r.outperformanceStatus, r.outperformanceScore)}
                              fillOpacity={isSelected || isHovered ? 1 : 0.78}
                              stroke={isSelected ? '#2563eb' : r.hasAiDistillation ? '#0f172a' : '#ffffff'}
                              strokeWidth={isSelected ? 2.5 : r.hasAiDistillation ? 1.5 : 1}
                            />
                            {(isSelected || isHovered) && (
                              <text
                                x={cx + 9}
                                y={cy + 3}
                                className="fill-slate-900 dark:fill-slate-100 text-[11px] font-mono font-bold pointer-events-none"
                              >
                                {r.symbol}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Interactive Hover / Focus Readout Strip */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md px-3.5 py-2 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-2 text-xs">
                    {hoveredCompany || activeCompany ? (
                      (() => {
                        const target = hoveredCompany ?? activeCompany!;
                        return (
                          <>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                {target.symbol}
                              </span>
                              <span className="text-slate-600 dark:text-slate-300">
                                {target.companyName}
                              </span>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                              <span className="text-slate-500 dark:text-slate-400">{target.quadrant}</span>
                            </div>
                            <div className="font-mono text-[11px] tabular-nums flex flex-wrap items-center gap-3">
                              <span>Mgmt {target.managementQualityScore.toFixed(0)}</span>
                              <span>Growth {target.growthPotentialScore.toFixed(0)}</span>
                              <span className={`font-semibold ${statusTextTone(target.outperformanceStatus)}`}>
                                {target.outperformanceStatus} ({target.primaryDeltaLabel})
                              </span>
                            </div>
                          </>
                        );
                      })()
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">
                        Hover or click any company marker to inspect its annual report metrics and historical delta.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Sector Historical Outperformance Table */}
          {data && data.sectorBenchmarks.length > 0 && (
            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Sector Management Quality &amp; Outperformance Summary
                </h3>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  Click a sector row to filter
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Sector</th>
                      <th className="py-2 px-2 font-medium text-right">Firms</th>
                      <th className="py-2 px-2 font-medium text-right">Avg Mgmt</th>
                      <th className="py-2 px-2 font-medium text-right">Avg Growth</th>
                      <th className="py-2 px-2 font-medium text-right">Avg ROE</th>
                      <th className="py-2 pl-2 font-medium text-right">Outperforming</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono tabular-nums">
                    {data.sectorBenchmarks.map((sb) => (
                      <tr
                        key={sb.sector}
                        onClick={() =>
                          setSectorFilter((prev) => (prev === sb.sector ? 'All' : sb.sector))
                        }
                        className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                          sectorFilter === sb.sector ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''
                        }`}
                      >
                        <td className="py-2 pr-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                          {sb.sector}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-600 dark:text-slate-300">
                          {sb.count}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-900 dark:text-slate-100">
                          {sb.avgManagementScore.toFixed(1)}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-900 dark:text-slate-100">
                          {sb.avgGrowthScore.toFixed(1)}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-700 dark:text-slate-300">
                          {sb.avgRoePct !== null ? `${sb.avgRoePct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 pl-2 text-right text-emerald-700 dark:text-emerald-300 font-semibold">
                          {sb.outperformingCount} / {sb.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Company Strategic Dossier Inspector */}
        <aside className="xl:col-span-4 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-5 xl:sticky xl:top-20">
          {!activeCompany ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              Select a company tile or marker in the Heat Map to inspect its Annual Report Management Quality, Growth Potential, and Historical Average comparison.
            </div>
          ) : (
            <>
              {/* Inspector Header */}
              <div className="space-y-1.5 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-baseline gap-2">
                      <h3 className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">
                        {activeCompany.symbol}
                      </h3>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                        {activeCompany.ltp !== null ? `Rs ${activeCompany.ltp.toFixed(0)}` : '—'}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {activeCompany.companyName}
                    </p>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold shrink-0 ${statusTextTone(
                      activeCompany.outperformanceStatus
                    )}`}
                  >
                    {activeCompany.outperformanceStatus === 'Outperforming' ? (
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    ) : activeCompany.outperformanceStatus === 'Lagging' ? (
                      <ArrowDownRight className="w-3.5 h-3.5" />
                    ) : (
                      <Minus className="w-3.5 h-3.5" />
                    )}
                    <span>{activeCompany.outperformanceStatus}</span>
                  </span>
                </div>

                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span>{activeCompany.sector}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {activeCompany.quadrant}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>FY {activeCompany.latestFy}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activeCompany.baselineLabel}</span>
                </div>
              </div>

              {/* Dual Score Gauges: Management Quality & Growth Potential */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Management Quality</span>
                    <span className={`font-semibold ${pillarTextTone(activeCompany.managementStatus)}`}>
                      {activeCompany.managementStatus}
                    </span>
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {activeCompany.managementQualityScore.toFixed(0)}
                    <span className="text-xs font-normal text-slate-400"> / 100</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-blue-600 dark:bg-blue-500"
                      style={{ width: `${activeCompany.managementQualityScore}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Growth Potential</span>
                    <span className={`font-semibold ${pillarTextTone(activeCompany.growthStatus)}`}>
                      {activeCompany.growthStatus}
                    </span>
                  </div>
                  <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {activeCompany.growthPotentialScore.toFixed(0)}
                    <span className="text-xs font-normal text-slate-400"> / 100</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 dark:bg-emerald-500"
                      style={{ width: `${activeCompany.growthPotentialScore}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Current vs Historical Averages Comparison Table */}
              <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs">
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                    Current vs Historical Baseline
                  </h4>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    Index {activeCompany.outperformanceScore >= 0 ? '+' : ''}
                    {activeCompany.outperformanceScore.toFixed(1)}
                  </span>
                </div>

                {activeCompany.historicalComparisons.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No comparable historical ratios available yet; pull or ingest prior FY statements.
                  </p>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                        <th className="py-1.5 text-left font-medium">Metric</th>
                        <th className="py-1.5 text-right font-medium">Current</th>
                        <th className="py-1.5 text-right font-medium">Hist. Avg</th>
                        <th className="py-1.5 text-right font-medium">Spread</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                      {activeCompany.historicalComparisons.map((c) => {
                        const unitSuffix = c.unit === '%' ? '%' : '';
                        const prefix = c.unit === 'Rs' || c.unit === 'Cr' ? 'Rs ' : '';
                        const suffix = c.unit === 'Cr' ? ' Cr' : unitSuffix;
                        return (
                          <tr key={c.key}>
                            <td className="py-1.5 font-sans text-slate-700 dark:text-slate-300">
                              {c.label}
                            </td>
                            <td className="py-1.5 text-right text-slate-900 dark:text-slate-100">
                              {c.currentVal !== null ? `${prefix}${fmtNum(c.currentVal, 1)}${suffix}` : '—'}
                            </td>
                            <td className="py-1.5 text-right text-slate-500 dark:text-slate-400">
                              {c.historicalAvgVal !== null
                                ? `${prefix}${fmtNum(c.historicalAvgVal, 1)}${suffix}`
                                : '—'}
                            </td>
                            <td
                              className={`py-1.5 text-right font-semibold ${
                                c.outperforming === true
                                  ? 'text-emerald-700 dark:text-emerald-300'
                                  : c.outperforming === false
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {c.deltaDisplay}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Extracted Management Quality Evidence */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Management Quality Findings
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {activeCompany.managementHeadline}
                </p>
                {activeCompany.managementEvidence.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400 list-disc pl-4">
                    {activeCompany.managementEvidence.slice(0, 3).map((pt, idx) => (
                      <li key={idx}>{pt}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Extracted Growth Potential Evidence */}
              <div className="space-y-1.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Growth Potential &amp; Strategic Direction
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {activeCompany.businessDirectionSummary}
                </p>
                {activeCompany.growthEvidence.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400 list-disc pl-4">
                    {activeCompany.growthEvidence.slice(0, 3).map((pt, idx) => (
                      <li key={idx}>{pt}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Quick Cross-Navigation Actions */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
                {onOpenAnnualReports && (
                  <button
                    type="button"
                    onClick={() => onOpenAnnualReports(activeCompany.symbol)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Open Annual Report</span>
                  </button>
                )}

                {!activeCompany.hasAiDistillation && (
                  <button
                    type="button"
                    onClick={() => void handleDistillSelected(activeCompany.symbol)}
                    disabled={distillingSymbol === activeCompany.symbol}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Sparkles
                      className={`w-3.5 h-3.5 ${
                        distillingSymbol === activeCompany.symbol ? 'animate-spin' : ''
                      }`}
                    />
                    <span>
                      {distillingSymbol === activeCompany.symbol ? 'Distilling…' : 'AI Distill'}
                    </span>
                  </button>
                )}

                {onOpenValuation && (
                  <button
                    type="button"
                    onClick={() => onOpenValuation(activeCompany.symbol)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Scale className="w-3.5 h-3.5" />
                    <span>Valuation</span>
                  </button>
                )}

                {onInspectInScreener && (
                  <button
                    type="button"
                    onClick={() => onInspectInScreener(activeCompany.symbol)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>9-Investor Dossier</span>
                  </button>
                )}

                {onInspectSymbol && (
                  <button
                    type="button"
                    onClick={() => onInspectSymbol(activeCompany.symbol)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <CandlestickChart className="w-3.5 h-3.5" />
                    <span>Chart</span>
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};
