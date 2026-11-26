import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AlgorithmExplainPanel } from '../components/AlgorithmExplainPanel';
import { CandlestickVolumeChart, type HorizontalLevel } from '../components/Charts';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { SCANNER_DOC_MAP } from '../data/algorithmDocs';
import type { PriceRow, ScannerKind, ScannerResultRow } from '../types/market';
import { formatCrore, formatNum, formatPct } from '../utils/format';

interface ScannersViewProps {
  dates: string[];
  equityOnly: boolean;
}

const SCANNER_OPTIONS: Array<{ id: ScannerKind; label: string }> = [
  { id: 'potential', label: 'Consolidation → Volume Breakout (+ Setups)' },
  { id: 'support', label: 'Support + Volume Breakout' },
  { id: 'selloff', label: 'Heavy Selloff at Resistance' },
  { id: 'highbreak', label: 'High Breakout (N-Day)' },
  { id: 'breakdown', label: 'Support Breakdown (Bearish)' },
  { id: 'accumulation', label: 'Quiet Accumulation' },
  { id: 'near52', label: 'Near 52-Week High' },
  { id: 'rs', label: 'Relative Strength Leaders' },
];

export const ScannersView: React.FC<ScannersViewProps> = ({ dates, equityOnly }) => {
  const [kind, setKind] = useState<ScannerKind>('potential');
  const [asof, setAsof] = useState<string>(dates[dates.length - 1] ?? '');
  const [minLakh, setMinLakh] = useState<number>(10);
  const [showAlgoDocs, setShowAlgoDocs] = useState<boolean>(false);

  // Parameters per scanner
  const [baseMin, setBaseMin] = useState(20);
  const [maxRangePct, setMaxRangePct] = useState(12.0);
  const [volMult, setVolMult] = useState(2.0);
  const [maxAge, setMaxAge] = useState(3);
  const [setupPct, setSetupPct] = useState(3.0);
  const [includeSetups, setIncludeSetups] = useState(true);

  const [streakMinDays, setStreakMinDays] = useState(3);
  const [lookback, setLookback] = useState(20);
  const [streakVolMult, setStreakVolMult] = useState(1.5);
  const [tolPct, setTolPct] = useState(3.0);
  const [minMovePct, setMinMovePct] = useState(2.0);

  const [accDays, setAccDays] = useState(10);
  const [accRangePct, setAccRangePct] = useState(8.0);
  const [accMinUd, setAccMinUd] = useState(1.5);

  const [within52Pct, setWithin52Pct] = useState(3.0);
  const [turnoverBoost, setTurnoverBoost] = useState(1.3);
  const [rsDays, setRsDays] = useState(20);

  const [results, setResults] = useState<ScannerResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [chartHistory, setChartHistory] = useState<PriceRow[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    if (dates.length > 0 && (!asof || !dates.includes(asof))) {
      setAsof(dates[dates.length - 1]);
    }
  }, [dates, asof]);

  // Adjust sensible defaults when switching between support & selloff
  useEffect(() => {
    if (kind === 'support') {
      setStreakMinDays(3);
      setMinMovePct(2.0);
    } else if (kind === 'selloff') {
      setStreakMinDays(1);
      setMinMovePct(3.0);
    }
  }, [kind]);

  const activeParams = useMemo(() => {
    if (kind === 'potential') {
      return {
        base_min: baseMin,
        max_range_pct: maxRangePct,
        vol_mult: volMult,
        max_age: maxAge,
        setup_pct: setupPct,
        include_setups: includeSetups,
      };
    }
    if (kind === 'support' || kind === 'selloff') {
      return {
        min_days: streakMinDays,
        lookback,
        vol_mult: streakVolMult,
        tol_pct: tolPct,
        min_move_pct: minMovePct,
      };
    }
    if (kind === 'highbreak' || kind === 'breakdown') {
      return { lookback, vol_mult: volMult };
    }
    if (kind === 'accumulation') {
      return { days: accDays, max_range_pct: accRangePct, min_ud: accMinUd };
    }
    if (kind === 'near52') {
      return { within_pct: within52Pct, turnover_boost: turnoverBoost };
    }
    return { days: rsDays };
  }, [
    kind,
    baseMin,
    maxRangePct,
    volMult,
    maxAge,
    setupPct,
    includeSetups,
    streakMinDays,
    lookback,
    streakVolMult,
    tolPct,
    minMovePct,
    accDays,
    accRangePct,
    accMinUd,
    within52Pct,
    turnoverBoost,
    rsDays,
  ]);

  useEffect(() => {
    if (!asof) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/scanner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        end: asof,
        minAvgTurnover: minLakh * 1e5,
        equityOnly,
        params: activeParams,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const rows: ScannerResultRow[] = d.rows || [];
        setResults(rows);
        setSelectedSymbol(rows[0]?.symbol ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kind, asof, minLakh, equityOnly, activeParams]);

  useEffect(() => {
    if (!selectedSymbol || !asof) {
      setChartHistory([]);
      return;
    }
    let cancelled = false;
    setChartLoading(true);
    fetch(
      `/api/symbol/${encodeURIComponent(selectedSymbol)}?end=${encodeURIComponent(asof)}&days=120`
    )
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setChartHistory(d.history || []);
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, asof]);

  const pickedRow = useMemo(
    () => results.find((r) => r.symbol === selectedSymbol) ?? results[0] ?? null,
    [results, selectedSymbol]
  );

  const doc = SCANNER_DOC_MAP[kind];

  const columns = useMemo((): ColumnDef<ScannerResultRow>[] => {
    const baseCols: ColumnDef<ScannerResultRow>[] = [
      {
        key: 'symbol',
        label: 'Symbol',
        align: 'left',
        render: (r) => (
          <span className="font-semibold text-blue-600 dark:text-blue-400">{r.symbol}</span>
        ),
      },
      {
        key: 'name',
        label: 'Name',
        align: 'left',
        render: (r) => (
          <span className="text-slate-600 dark:text-slate-300 truncate max-w-[180px] inline-block">
            {r.name || '–'}
          </span>
        ),
      },
    ];

    if (kind === 'potential') {
      return [
        ...baseCols,
        {
          key: 'status',
          label: 'State',
          align: 'left',
          render: (r) => (
            <span
              className={`font-mono text-xs font-semibold ${
                r.status === 'BREAKOUT'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {r.status}
            </span>
          ),
        },
        {
          key: 'score',
          label: 'Score',
          align: 'right',
          render: (r) => (
            <div className="inline-flex items-center gap-2 justify-end">
              <div className="w-14 h-1.5 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-600 dark:bg-blue-500"
                  style={{ width: `${Math.min(100, Math.max(0, r.score))}%` }}
                />
              </div>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {r.score.toFixed(0)}
              </span>
            </div>
          ),
        },
        { key: 'base_days', label: 'Base Days', align: 'right', render: (r) => r.base_days ?? '–' },
        {
          key: 'base_range_pct',
          label: 'Base Rng %',
          align: 'right',
          render: (r) => formatPct(r.base_range_pct, false),
        },
        { key: 'base_high', label: 'Base High', align: 'right', render: (r) => formatNum(r.base_high) },
        { key: 'last_close', label: 'Close', align: 'right', render: (r) => formatNum(r.last_close) },
        {
          key: 'move_pct',
          label: 'vs High %',
          align: 'right',
          render: (r) => (
            <span
              className={
                (r.move_pct ?? 0) >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }
            >
              {formatPct(r.move_pct)}
            </span>
          ),
        },
        { key: 'vol_ratio', label: 'Vol ×', align: 'right', render: (r) => `${formatNum(r.vol_ratio)}x` },
        {
          key: 'signals',
          label: 'Signals',
          align: 'left',
          render: (r) => (
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              {r.signals || '–'}
            </span>
          ),
        },
      ];
    }

    if (kind === 'support' || kind === 'selloff') {
      return [
        ...baseCols,
        { key: 'score', label: 'Score', align: 'right', render: (r) => formatNum(r.score) },
        { key: 'start_date', label: 'Run Start', align: 'left', render: (r) => <span className="font-mono">{r.start_date}</span> },
        { key: 'days', label: 'Days', align: 'right', render: (r) => r.days },
        {
          key: 'level',
          label: kind === 'support' ? 'Support' : 'Resistance',
          align: 'right',
          render: (r) => formatNum(r.level),
        },
        { key: 'last_close', label: 'Close', align: 'right', render: (r) => formatNum(r.last_close) },
        {
          key: 'move_pct',
          label: 'Move %',
          align: 'right',
          render: (r) => (
            <span className={(r.move_pct ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}>
              {formatPct(r.move_pct)}
            </span>
          ),
        },
        { key: 'vol_ratio', label: 'Vol ×', align: 'right', render: (r) => `${formatNum(r.vol_ratio)}x` },
        { key: 'run_turnover', label: 'Run Turn (cr)', align: 'right', render: (r) => formatCrore(r.run_turnover) },
      ];
    }

    if (kind === 'highbreak' || kind === 'breakdown') {
      return [
        ...baseCols,
        { key: 'score', label: 'Score', align: 'right', render: (r) => formatNum(r.score) },
        { key: 'last_close', label: 'Close', align: 'right', render: (r) => formatNum(r.last_close) },
        {
          key: kind === 'highbreak' ? 'prior_high' : 'prior_low',
          label: kind === 'highbreak' ? 'Prior High' : 'Prior Low',
          align: 'right',
          render: (r) => formatNum(kind === 'highbreak' ? r.prior_high : r.prior_low),
        },
        {
          key: 'move_pct',
          label: 'Day Chg %',
          align: 'right',
          render: (r) => (
            <span className={(r.move_pct ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}>
              {formatPct(r.move_pct)}
            </span>
          ),
        },
        { key: 'vol_ratio', label: 'Vol ×', align: 'right', render: (r) => `${formatNum(r.vol_ratio)}x` },
      ];
    }

    if (kind === 'accumulation') {
      return [
        ...baseCols,
        { key: 'score', label: 'Score', align: 'right', render: (r) => formatNum(r.score, 1) },
        { key: 'last_close', label: 'Close', align: 'right', render: (r) => formatNum(r.last_close) },
        { key: 'range_pct', label: 'Range %', align: 'right', render: (r) => formatPct(r.range_pct, false) },
        { key: 'up_down_vol', label: 'Up/Dn Vol', align: 'right', render: (r) => `${formatNum(r.up_down_vol)}x` },
        { key: 'vol_vs_prior', label: 'Vol vs Prior', align: 'right', render: (r) => `${formatNum(r.vol_vs_prior)}x` },
      ];
    }

    if (kind === 'near52') {
      return [
        ...baseCols,
        { key: 'score', label: 'Score', align: 'right', render: (r) => formatNum(r.score) },
        { key: 'last_close', label: 'Close', align: 'right', render: (r) => formatNum(r.last_close) },
        { key: 'w52_high', label: '52w High', align: 'right', render: (r) => formatNum(r.w52_high) },
        { key: 'gap_to_high_pct', label: 'Gap %', align: 'right', render: (r) => formatPct(r.gap_to_high_pct, false) },
        { key: 'turnover_boost', label: 'Turn Boost', align: 'right', render: (r) => `${formatNum(r.turnover_boost)}x` },
      ];
    }

    return [
      ...baseCols,
      {
        key: 'score',
        label: 'Alpha vs Med',
        align: 'right',
        render: (r) => (
          <span className={r.score >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600'}>
            {formatPct(r.score)}
          </span>
        ),
      },
      { key: 'last_close', label: 'Close', align: 'right', render: (r) => formatNum(r.last_close) },
      { key: 'return_pct', label: 'Return %', align: 'right', render: (r) => formatPct(r.return_pct) },
      { key: 'market_median_pct', label: 'Mkt Median %', align: 'right', render: (r) => formatPct(r.market_median_pct) },
    ];
  }, [kind]);

  // Chart overlay derivation
  const chartLevels = useMemo((): HorizontalLevel[] => {
    if (!pickedRow) return [];
    const lv: HorizontalLevel[] = [];
    if (pickedRow.level !== undefined) {
      lv.push({
        label: kind === 'support' ? 'support' : 'resistance',
        value: pickedRow.level,
        color: kind === 'support' ? '#16a34a' : '#dc2626',
      });
    }
    if (pickedRow.prior_high !== undefined) lv.push({ label: 'prior high', value: pickedRow.prior_high });
    if (pickedRow.prior_low !== undefined) lv.push({ label: 'prior low', value: pickedRow.prior_low, color: '#dc2626' });
    if (pickedRow.w52_high !== undefined) lv.push({ label: '52w high', value: pickedRow.w52_high });
    if (pickedRow.base_high !== undefined) lv.push({ label: 'base high', value: pickedRow.base_high });
    return lv;
  }, [pickedRow, kind]);

  const chartZone = useMemo(() => {
    if (kind === 'potential' && pickedRow?.base_low && pickedRow?.base_high) {
      return { low: pickedRow.base_low, high: pickedRow.base_high };
    }
    return null;
  }, [pickedRow, kind]);

  const chartMarker = useMemo(() => {
    if (pickedRow?.breakout_date) return { date: pickedRow.breakout_date, label: 'breakout' };
    if (pickedRow?.start_date) return { date: pickedRow.start_date, label: 'run starts' };
    return null;
  }, [pickedRow]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex-1 min-w-[260px]">
          <label htmlFor="sc-select" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
            Scanner Algorithm
          </label>
          <select
            id="sc-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as ScannerKind)}
            className="w-full max-w-md px-3 py-2 text-sm font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          >
            {SCANNER_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="sc-asof" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Scan as of
            </label>
            <select
              id="sc-asof"
              value={asof}
              onChange={(e) => setAsof(e.target.value)}
              className="px-3 py-2 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            >
              {[...dates].reverse().map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sc-minturn" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Min avg turnover (Rs lakh)
            </label>
            <input
              id="sc-minturn"
              type="number"
              min={0}
              max={10000}
              step={5}
              value={minLakh}
              onChange={(e) => setMinLakh(Math.max(0, Number(e.target.value)))}
              className="w-32 px-3 py-2 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>
      </div>

      {/* Algorithm description summary + expandable methodology drawer */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-600 dark:text-slate-300 max-w-4xl leading-relaxed">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{doc.category}</span>
            <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
            <span
              className={`font-medium ${
                doc.bias === 'Bullish'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : doc.bias === 'Bearish'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {doc.bias}
            </span>
            <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
            <span>{doc.summary}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAlgoDocs((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <span>{showAlgoDocs ? 'Hide algorithm rules' : 'How this algorithm works'}</span>
            {showAlgoDocs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {showAlgoDocs && <AlgorithmExplainPanel doc={doc} />}

      {/* Parameter Sliders */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
        {kind === 'potential' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
              <label className="space-y-1">
                <span className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span>Min base days</span>
                  <span className="font-mono font-semibold">{baseMin}</span>
                </span>
                <input type="range" min={5} max={90} value={baseMin} onChange={(e) => setBaseMin(Number(e.target.value))} className="w-full accent-blue-600" />
              </label>
              <label className="space-y-1">
                <span className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span>Max base range</span>
                  <span className="font-mono font-semibold">{maxRangePct.toFixed(1)}%</span>
                </span>
                <input type="range" min={4} max={30} step={0.5} value={maxRangePct} onChange={(e) => setMaxRangePct(Number(e.target.value))} className="w-full accent-blue-600" />
              </label>
              <label className="space-y-1">
                <span className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span>Breakout vol ×</span>
                  <span className="font-mono font-semibold">{volMult.toFixed(1)}x</span>
                </span>
                <input type="range" min={1} max={5} step={0.1} value={volMult} onChange={(e) => setVolMult(Number(e.target.value))} className="w-full accent-blue-600" />
              </label>
              <label className="space-y-1">
                <span className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span>Max age (days)</span>
                  <span className="font-mono font-semibold">{maxAge}</span>
                </span>
                <input type="range" min={1} max={10} value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} className="w-full accent-blue-600" />
              </label>
              <label className="space-y-1">
                <span className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span>Setup within top</span>
                  <span className="font-mono font-semibold">{setupPct.toFixed(1)}%</span>
                </span>
                <input type="range" min={0.5} max={10} step={0.5} value={setupPct} onChange={(e) => setSetupPct(Number(e.target.value))} className="w-full accent-blue-600" />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSetups}
                onChange={(e) => setIncludeSetups(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Include coiled SETUP stocks (still inside base below ceiling)</span>
            </label>
          </div>
        )}

        {(kind === 'support' || kind === 'selloff') && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Min days in run</span>
                <span className="font-mono font-semibold">{streakMinDays}</span>
              </span>
              <input type="range" min={1} max={10} value={streakMinDays} onChange={(e) => setStreakMinDays(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Lookback days</span>
                <span className="font-mono font-semibold">{lookback}</span>
              </span>
              <input type="range" min={10} max={60} value={lookback} onChange={(e) => setLookback(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Day-1 volume ×</span>
                <span className="font-mono font-semibold">{streakVolMult.toFixed(1)}x</span>
              </span>
              <input type="range" min={1} max={5} step={0.1} value={streakVolMult} onChange={(e) => setStreakVolMult(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>At level within</span>
                <span className="font-mono font-semibold">{tolPct.toFixed(1)}%</span>
              </span>
              <input type="range" min={0.5} max={10} step={0.5} value={tolPct} onChange={(e) => setTolPct(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Min move %</span>
                <span className="font-mono font-semibold">{minMovePct.toFixed(1)}%</span>
              </span>
              <input type="range" min={0.5} max={20} step={0.5} value={minMovePct} onChange={(e) => setMinMovePct(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
          </div>
        )}

        {(kind === 'highbreak' || kind === 'breakdown') && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs max-w-xl">
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Lookback days</span>
                <span className="font-mono font-semibold">{lookback}</span>
              </span>
              <input type="range" min={5} max={60} value={lookback} onChange={(e) => setLookback(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Volume ×</span>
                <span className="font-mono font-semibold">{volMult.toFixed(1)}x</span>
              </span>
              <input type="range" min={1} max={6} step={0.1} value={volMult} onChange={(e) => setVolMult(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
          </div>
        )}

        {kind === 'accumulation' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs max-w-2xl">
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Window days</span>
                <span className="font-mono font-semibold">{accDays}</span>
              </span>
              <input type="range" min={5} max={30} value={accDays} onChange={(e) => setAccDays(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Max range %</span>
                <span className="font-mono font-semibold">{accRangePct.toFixed(1)}%</span>
              </span>
              <input type="range" min={2} max={20} step={0.5} value={accRangePct} onChange={(e) => setAccRangePct(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Up/down vol ≥</span>
                <span className="font-mono font-semibold">{accMinUd.toFixed(1)}x</span>
              </span>
              <input type="range" min={1} max={5} step={0.1} value={accMinUd} onChange={(e) => setAccMinUd(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
          </div>
        )}

        {kind === 'near52' && (
          <div className="grid grid-cols-2 gap-4 text-xs max-w-lg">
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Within % of 52w high</span>
                <span className="font-mono font-semibold">{within52Pct.toFixed(1)}%</span>
              </span>
              <input type="range" min={0.5} max={15} step={0.5} value={within52Pct} onChange={(e) => setWithin52Pct(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
            <label className="space-y-1">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Turnover boost ×</span>
                <span className="font-mono font-semibold">{turnoverBoost.toFixed(1)}x</span>
              </span>
              <input type="range" min={1} max={4} step={0.1} value={turnoverBoost} onChange={(e) => setTurnoverBoost(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
          </div>
        )}

        {kind === 'rs' && (
          <div className="max-w-xs text-xs">
            <label className="space-y-1 block">
              <span className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Comparison window (days)</span>
                <span className="font-mono font-semibold">{rsDays}</span>
              </span>
              <input type="range" min={5} max={120} value={rsDays} onChange={(e) => setRsDays(Number(e.target.value))} className="w-full accent-blue-600" />
            </label>
          </div>
        )}
      </div>

      {/* Results Table */}
      {loading ? (
        <div className="h-56 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : results.length === 0 ? (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          {dates.length < doc.minHistoryDays
            ? `This scanner needs at least ~${doc.minHistoryDays} trading days of history (${dates.length} currently loaded). Backfill dates in Scheduler & Data.`
            : 'No symbols matched these filter settings. Try loosening range or volume thresholds.'}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>
              {kind === 'potential'
                ? `${results.filter((r) => r.status === 'BREAKOUT').length} breakout(s) and ${
                    results.filter((r) => r.status === 'SETUP').length
                  } setup(s) as of ${asof}`
                : `${results.length} match(es) as of ${asof}`}
            </span>
            <span className="text-slate-400">Click any row to inspect its chart below</span>
          </div>

          <DataTable
            rows={results}
            columns={columns}
            rowKey={(r) => r.symbol}
            selectedKey={pickedRow?.symbol ?? null}
            onRowClick={(r) => setSelectedSymbol(r.symbol)}
            searchKeys={['symbol', 'name', 'signals']}
            maxHeightClass="max-h-[380px]"
          />

          {pickedRow && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {pickedRow.symbol}
                  {pickedRow.name ? ` — ${pickedRow.name}` : ''}
                </h3>
                {pickedRow.signals && (
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    Signals: {pickedRow.signals}
                  </span>
                )}
              </div>
              {chartLoading ? (
                <div className="h-[360px] animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
              ) : (
                <CandlestickVolumeChart
                  history={chartHistory}
                  levels={chartLevels}
                  zone={chartZone}
                  marker={chartMarker}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
