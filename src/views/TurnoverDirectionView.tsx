import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Flame } from 'lucide-react';
import { AlgorithmExplainPanel } from '../components/AlgorithmExplainPanel';
import { createWatchlistColumn, DataTable, type ColumnDef } from '../components/DataTable';
import {
  buildDirectionUniverse,
  DirectionAhaStrip,
  FlowBattlegroundCharts,
  SectorCapitalFlowChart,
  TurnoverDirectionMatrix,
  type DirectionEnrichedRow,
} from '../components/direction/TurnoverDirectionVisuals';
import { PeriodPicker, resolvePeriodRange, type PeriodMode } from '../components/PeriodPicker';
import { ALGORITHM_DOCS } from '../data/algorithmDocs';
import { useWatchlist } from '../hooks/useWatchlist';
import type { AnalyzerScanResponse, AnalyzerScanRow } from '../types/analyzer';
import type { ScreenedCompanyRow, ScreenerOverviewResponse } from '../types/fundamental';
import type { RangeSummaryRow } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface TurnoverDirectionViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
  onInspectInQuant?: (symbol: string) => void;
  onInspectInAnalyzer?: (symbol: string) => void;
}

type TableLens = 'all' | 'dual' | 'inst' | 'clean';

export const TurnoverDirectionView: React.FC<TurnoverDirectionViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
  onInspectInQuant,
  onInspectInAnalyzer,
}) => {
  const [mode, setMode] = useState<PeriodMode>(dates.length >= 5 ? 'last5' : 'last1');
  const [customStart, setCustomStart] = useState(
    dates[Math.max(0, dates.length - 6)] ?? ''
  );
  const [customEnd, setCustomEnd] = useState(dates[dates.length - 1] ?? '');
  const [topPct, setTopPct] = useState(10);
  const [consistent, setConsistent] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [tableLens, setTableLens] = useState<TableLens>('all');
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  const [data, setData] = useState<{
    all: RangeSummaryRow[];
    up: RangeSummaryRow[];
    down: RangeSummaryRow[];
    cutoff: number;
    upTurnover: number;
    downTurnover: number;
  }>({ all: [], up: [], down: [], cutoff: 0, upTurnover: 0, downTurnover: 0 });
  const [fundamentalRows, setFundamentalRows] = useState<ScreenedCompanyRow[]>([]);
  const [analyzerRows, setAnalyzerRows] = useState<AnalyzerScanRow[]>([]);
  const [loading, setLoading] = useState(false);

  const resolved = resolvePeriodRange(dates, mode, customStart, customEnd);
  const algoDoc = useMemo(
    () => ALGORITHM_DOCS.find((d) => d.id === 'turnover_direction'),
    []
  );

  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/turnover-direction?start=${encodeURIComponent(resolved.start)}&end=${encodeURIComponent(
        resolved.end
      )}&topPct=${topPct}&consistent=${consistent}&equityOnly=${equityOnly}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((res) => {
        if (!cancelled) {
          setData({
            all: res.all || [],
            up: res.up || [],
            down: res.down || [],
            cutoff: res.cutoff || 0,
            upTurnover: res.upTurnover || 0,
            downTurnover: res.downTurnover || 0,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ all: [], up: [], down: [], cutoff: 0, upTurnover: 0, downTurnover: 0 });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resolved?.start, resolved?.end, topPct, consistent, equityOnly]);

  // Fetch Fundamental Screener + Technical ICT/SMC/Wyckoff scan for confluence enrichment
  useEffect(() => {
    const asOf = resolved?.end;
    if (!asOf) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/screener/overview?equityOnly=${equityOnly}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(
        `/api/analyzer/scan?asOf=${encodeURIComponent(
          asOf
        )}&tf=1D&minGrade=C&equityOnly=${equityOnly}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([fundData, techData]: [ScreenerOverviewResponse | null, AnalyzerScanResponse | null]) => {
      if (cancelled) return;
      setFundamentalRows(fundData?.rows ?? []);
      setAnalyzerRows(techData?.rows ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [resolved?.end, equityOnly]);

  const enrichedUniverse = useMemo(
    () =>
      buildDirectionUniverse(
        data.all,
        data.up,
        data.down,
        data.cutoff,
        fundamentalRows,
        analyzerRows
      ),
    [data.all, data.up, data.down, data.cutoff, fundamentalRows, analyzerRows]
  );

  const enrichedMap = useMemo(
    () => new Map(enrichedUniverse.map((it) => [it.symbol, it])),
    [enrichedUniverse]
  );

  const filterEnrichedList = (rows: RangeSummaryRow[]) => {
    return rows.filter((r) => {
      const en = enrichedMap.get(r.symbol.toUpperCase());
      if (!en) return tableLens === 'all';
      if (tableLens === 'dual') return en.isDualConfluence || en.isQualityPullback;
      if (tableLens === 'inst') return en.isInstitutionalTicket;
      if (tableLens === 'clean') return !en.isBlockWarning;
      return true;
    });
  };

  const filteredUp = useMemo(() => filterEnrichedList(data.up), [data.up, enrichedMap, tableLens]);
  const filteredDown = useMemo(() => filterEnrichedList(data.down), [data.down, enrichedMap, tableLens]);

  const topLeader = data.up[0] ?? null;
  const topLeaderEnriched: DirectionEnrichedRow | null = topLeader
    ? enrichedMap.get(topLeader.symbol.toUpperCase()) ?? null
    : null;
  const totalFlowTurn = data.upTurnover + data.downTurnover;
  const upSharePct = totalFlowTurn > 0 ? Math.round((data.upTurnover / totalFlowTurn) * 100) : 50;

  const makeCols = (dir: 'up' | 'down'): ColumnDef<RangeSummaryRow>[] => [
    createWatchlistColumn<RangeSummaryRow>({
      getSymbol: (r) => r.symbol,
      hasSymbol,
      toggleSymbol,
    }),
    {
      key: 'symbol',
      label: 'Symbol',
      align: 'left',
      render: (r) => {
        const en = enrichedMap.get(r.symbol.toUpperCase());
        return (
          <div className="flex flex-col">
            <span className="font-semibold text-blue-600 dark:text-blue-400">{r.symbol}</span>
            {en?.sector && (
              <span className="text-[10px] text-slate-400 truncate max-w-[95px]">{en.sector}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'flow_tag',
      label: 'Flow Read',
      align: 'left',
      render: (r) => {
        const tag = r.flow_tag || '–';
        const isWarn = tag.includes('Block');
        return (
          <span
            className={`text-xs font-medium ${
              isWarn
                ? 'text-amber-600 dark:text-amber-400'
                : dir === 'up'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-700 dark:text-red-400'
            }`}
          >
            {tag}
          </span>
        );
      },
    },
    {
      key: 'momentum_score',
      label: 'Score',
      align: 'right',
      render: (r) => {
        const sc = r.momentum_score ?? 0;
        return (
          <div className="inline-flex items-center gap-1.5 justify-end">
            <div className="w-9 h-1.5 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className={`h-full ${dir === 'up' ? 'bg-emerald-600' : 'bg-red-600'}`}
                style={{ width: `${Math.min(100, Math.max(0, sc))}%` }}
              />
            </div>
            <span className="font-semibold">{sc.toFixed(0)}</span>
          </div>
        );
      },
    },
    {
      key: 'fund',
      label: 'Fund / MoS',
      align: 'right',
      sortValue: (r) => enrichedMap.get(r.symbol.toUpperCase())?.fundScore ?? -1,
      csvValue: (r) => enrichedMap.get(r.symbol.toUpperCase())?.fundScore?.toFixed(1) ?? '',
      render: (r) => {
        const en = enrichedMap.get(r.symbol.toUpperCase());
        if (!en || en.fundScore === null) {
          return <span className="text-slate-400">–</span>;
        }
        const mos = en.fundamental?.keyMetrics.marginOfSafetyPct;
        return (
          <div className="font-mono tabular-nums text-right">
            <span
              className={`font-semibold ${
                en.fundScore >= 60
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : en.fundScore >= 45
                    ? 'text-slate-700 dark:text-slate-300'
                    : 'text-red-600 dark:text-red-400'
              }`}
            >
              {en.fundScore.toFixed(0)}
            </span>
            {mos !== null && mos !== undefined && (
              <span className="block text-[10px] text-slate-400">
                {mos > 0 ? '+' : ''}
                {mos.toFixed(0)}% MoS
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'tech',
      label: 'ICT Setup',
      align: 'right',
      sortValue: (r) => enrichedMap.get(r.symbol.toUpperCase())?.techScore ?? -1,
      csvValue: (r) => {
        const t = enrichedMap.get(r.symbol.toUpperCase())?.technical;
        return t ? `${t.grade} (${t.rrT2.toFixed(1)}R)` : '';
      },
      render: (r) => {
        const t = enrichedMap.get(r.symbol.toUpperCase())?.technical;
        if (!t) return <span className="text-slate-400">–</span>;
        return (
          <div className="font-mono tabular-nums text-right">
            <span
              className={`font-semibold ${
                t.grade === 'A'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : t.grade === 'B'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.grade} · {t.rrT2.toFixed(1)}R
            </span>
            <span className="block text-[10px] text-slate-400 truncate max-w-[76px]">
              {t.strategy}
            </span>
          </div>
        );
      },
    },
    {
      key: 'turnover',
      label: 'Turn (cr)',
      align: 'right',
      csvValue: (r) => (r.turnover / 1e7).toFixed(4),
      render: (r) => formatCrore(r.turnover),
    },
    {
      key: 'change_pct',
      label: 'Chg %',
      align: 'right',
      render: (r) => (
        <span
          className={
            dir === 'up'
              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
              : 'text-red-600 dark:text-red-400 font-medium'
          }
        >
          {formatPct(r.change_pct)}
        </span>
      ),
    },
    {
      key: dir === 'up' ? 'up_days' : 'down_days',
      label: dir === 'up' ? 'Up/Days' : 'Dn/Days',
      align: 'right',
      render: (r) => `${dir === 'up' ? r.up_days : r.down_days}/${r.days_traded}`,
    },
    {
      key: 'vwap_pct',
      label: 'vs VWAP',
      align: 'right',
      render: (r) => formatPct(r.vwap_pct),
    },
    {
      key: 'avg_trade_size',
      label: 'Rs/Trade',
      align: 'right',
      render: (r) => formatInt(r.avg_trade_size),
    },
    {
      key: 'end_price',
      label: 'Close',
      align: 'right',
      render: (r) => formatNum(r.end_price),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Turnover × Direction — Momentum, Flow Conviction &amp; Confluence Engine
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Isolates the top {topPct}% most liquid stocks and fuses tape conviction, institutional ticket size, quarterly fundamentals, and ICT/Wyckoff setups
          </p>
        </div>

        {algoDoc && (
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-slate-200 dark:border-slate-800 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <span>{showGuide ? 'Hide step-by-step guide' : 'How momentum is scored'}</span>
            {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {showGuide && algoDoc && <AlgorithmExplainPanel doc={algoDoc} />}

      <PeriodPicker
        dates={dates}
        mode={mode}
        onModeChange={setMode}
        customStart={customStart}
        customEnd={customEnd}
        onCustomChange={(s, e) => {
          setCustomStart(s);
          setCustomEnd(e);
        }}
      />

      {/* Quick Presets + Threshold Controls */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-500 dark:text-slate-400">Presets:</span>
            <button
              type="button"
              onClick={() => {
                setTopPct(10);
                setConsistent(false);
              }}
              className={`px-2.5 py-1 rounded border transition-colors ${
                topPct === 10 && !consistent
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              Momentum Leaders (Top 10%)
            </button>
            <button
              type="button"
              onClick={() => {
                setTopPct(15);
                setConsistent(true);
              }}
              className={`px-2.5 py-1 rounded border transition-colors ${
                topPct === 15 && consistent
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              Steady Accumulation (Top 15% + ≥60% Up)
            </button>
            <button
              type="button"
              onClick={() => {
                setTopPct(25);
                setConsistent(false);
              }}
              className={`px-2.5 py-1 rounded border transition-colors ${
                topPct === 25 && !consistent
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              Early Rotation (Top 25%)
            </button>
          </div>

          {data.cutoff > 0 && (
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Turnover cutoff: Rs {formatCrore(data.cutoff)} cr
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <label htmlFor="td-pct" className="text-slate-600 dark:text-slate-300 font-medium">
              High turnover = top <span className="font-mono font-semibold">{topPct}%</span>
            </label>
            <input
              id="td-pct"
              type="range"
              min={3}
              max={50}
              value={topPct}
              onChange={(e) => setTopPct(Number(e.target.value))}
              className="w-32 accent-blue-600"
            />
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={consistent}
              onChange={(e) => setConsistent(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>Steady trend only (≥ 60% of sessions in that direction)</span>
          </label>
        </div>
      </div>

      {/* Capital Flow & Top Momentum Narrative */}
      {!loading && (data.up.length > 0 || data.down.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-3">
            {topLeader ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <Flame className="w-4 h-4" />
                    <span>#1 Momentum Pick: {topLeader.symbol}</span>
                    {topLeaderEnriched?.fundScore !== null && topLeaderEnriched?.fundScore !== undefined && (
                      <span className="font-mono text-[11px] font-normal text-slate-500 dark:text-slate-400">
                        · Fund {topLeaderEnriched.fundScore.toFixed(0)}/100
                      </span>
                    )}
                    {topLeaderEnriched?.technical && (
                      <span className="font-mono text-[11px] font-normal text-amber-600 dark:text-amber-400">
                        · ICT {topLeaderEnriched.technical.grade} ({topLeaderEnriched.technical.rrT2.toFixed(1)}R)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {onInspectInAnalyzer && (
                      <button
                        type="button"
                        onClick={() => onInspectInAnalyzer(topLeader.symbol)}
                        className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        Analyzer
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onInspectSymbol(topLeader.symbol)}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Inspect chart →
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {topLeader.symbol}
                  </span>{' '}
                  ({topLeader.name}) scored{' '}
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {topLeader.momentum_score?.toFixed(0)}/100
                  </span>{' '}
                  ({topLeader.flow_tag}): gained{' '}
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatPct(topLeader.change_pct)}
                  </span>{' '}
                  on{' '}
                  <span className="font-mono font-semibold">
                    Rs {formatCrore(topLeader.turnover)} cr
                  </span>{' '}
                  across{' '}
                  <span className="font-mono">
                    {topLeader.up_days}/{topLeader.days_traded}
                  </span>{' '}
                  green day(s) ({formatInt(topLeader.trans)} trades, avg Rs{' '}
                  {formatInt(topLeader.avg_trade_size)}/trade).
                  {topLeader.vwap_pct !== null && topLeader.vwap_pct !== undefined && (
                    <>
                      {' '}
                      Closed{' '}
                      <span className="font-mono">{formatPct(topLeader.vwap_pct)}</span> vs intraday VWAP.
                    </>
                  )}
                </p>
              </>
            ) : (
              <div className="text-xs text-slate-500">
                No top-turnover advancers matched the current filter settings.
              </div>
            )}
          </div>

          <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-300">
                Top-{topPct}% Capital Flow Balance
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {upSharePct}% Buying / {100 - upSharePct}% Selling
              </span>
            </div>
            <div className="h-2.5 bg-red-500/80 rounded overflow-hidden flex">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{ width: `${upSharePct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs font-mono tabular-nums pt-0.5">
              <span className="text-emerald-600 dark:text-emerald-400">
                UP: Rs {formatCrore(data.upTurnover, 1)} cr ({data.up.length})
              </span>
              <span className="text-red-600 dark:text-red-400">
                DOWN: Rs {formatCrore(data.downTurnover, 1)} cr ({data.down.length})
              </span>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="h-24 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
          <div className="h-96 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
        </div>
      ) : (
        <>
          {/* 4-Pillar Aha! Intelligence Strip */}
          {enrichedUniverse.length > 0 && (
            <DirectionAhaStrip
              items={enrichedUniverse}
              topPct={topPct}
              onInspectSymbol={onInspectSymbol}
            />
          )}

          {/* Hero Interactive Multi-Lens Matrix + 3-Pillar Dossier */}
          <TurnoverDirectionMatrix
            items={enrichedUniverse}
            cutoff={data.cutoff}
            topPct={topPct}
            onInspectSymbol={onInspectSymbol}
            onInspectInAnalyzer={onInspectInAnalyzer}
            onInspectInQuant={onInspectInQuant}
          />

          {/* Capital Flow Battleground & Institutional Footprint Pair */}
          <FlowBattlegroundCharts
            items={enrichedUniverse}
            topPct={topPct}
            onInspectSymbol={onInspectSymbol}
          />

          {/* Sector Net Flow & Fundamental Quality Map */}
          <SectorCapitalFlowChart
            items={enrichedUniverse}
            onInspectSymbol={onInspectSymbol}
          />

          {/* Table Lens Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-medium mr-1">
                Table Lens:
              </span>
              {(
                [
                  ['all', 'All Top Turnover'],
                  ['dual', 'Dual Confluence / Pullbacks'],
                  ['inst', 'Institutional Ticket (≥2.5L)'],
                  ['clean', 'Clean Flow (No Block)'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTableLens(k)}
                  className={`px-2.5 py-1 rounded border transition-colors ${
                    tableLens === k
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Momentum &amp; Accumulation Leaders ({filteredUp.length})
                </h3>
                <span className="text-[11px] text-slate-400">Sorted by Momentum Score</span>
              </div>
              <DataTable
                rows={filteredUp}
                columns={makeCols('up')}
                rowKey={(r) => r.symbol}
                onRowClick={(r) => onInspectSymbol(r.symbol)}
                searchKeys={['symbol', 'name', 'flow_tag']}
                exportFilename={`nepse-momentum-up-${resolved?.end || 'latest'}.csv`}
                watchlistFilter={{ watchlist, getSymbol: (r) => r.symbol }}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
                  Heavy Distribution &amp; Supply ({filteredDown.length})
                </h3>
                <span className="text-[11px] text-slate-400">Sorted by Pressure Score</span>
              </div>
              <DataTable
                rows={filteredDown}
                columns={makeCols('down')}
                rowKey={(r) => r.symbol}
                onRowClick={(r) => onInspectSymbol(r.symbol)}
                searchKeys={['symbol', 'name', 'flow_tag']}
                exportFilename={`nepse-distribution-down-${resolved?.end || 'latest'}.csv`}
                watchlistFilter={{ watchlist, getSymbol: (r) => r.symbol }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
