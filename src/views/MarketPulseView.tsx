import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Gauge, Layers } from 'lucide-react';
import { createWatchlistColumn, DataTable, type ColumnDef } from '../components/DataTable';
import { InfoTip } from '../components/InfoTip';
import { LOOKBACK_PRESETS, useTradingSettings } from '../hooks/useTradingSettings';
import { useWatchlist } from '../hooks/useWatchlist';
import type { MarketPulseResponse, MarketPulseRow, SectorPulseMetric } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface MarketPulseViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

type PulseTimeframe = '1d' | 'yesterday' | '2d' | '5d' | 'nd';

type PulseScreen =
  | 'vwap_strength'
  | 'volume_surge'
  | 'block_flow'
  | 'near_52w_high'
  | 'ma120_pullback'
  | 'strong_close'
  | 'circuit_wick';

const PULSE_SCREENS: Array<{ id: PulseScreen; label: string; desc: string }> = [
  {
    id: 'vwap_strength',
    label: 'VWAP Control',
    desc: 'Closed above Volume-Weighted Average Price (VWAP) with positive return — buyers controlled intraday execution into the close.',
  },
  {
    id: 'volume_surge',
    label: 'Turnover & Vol Surge',
    desc: 'Stocks attracting abnormal turnover/volume compared to their N-day rolling average — early footprints of institutional interest.',
  },
  {
    id: 'block_flow',
    label: 'Institutional Ticket',
    desc: 'Ranked by average rupees per trade (min 20 trades) to distinguish high-ticket accumulation from retail churn.',
  },
  {
    id: 'near_52w_high',
    label: '52w High Watch',
    desc: 'Trading within 5% of 52-week highs with active turnover — relative strength leaders near breakout territory.',
  },
  {
    id: 'ma120_pullback',
    label: 'MA120 Uptrend',
    desc: 'Golden trend (MA120 > MA180) with price holding near MA120 support (-1% to +6%) — structural trend pullback zone.',
  },
  {
    id: 'strong_close',
    label: 'High Close Conviction',
    desc: 'Closed in the top 20% of the range (≥80% close strength) with ≥2% range expansion and positive return.',
  },
  {
    id: 'circuit_wick',
    label: 'Circuits & Wicks',
    desc: 'Near ±9% NEPSE circuit limits or heavy upper-wick rejections (closed in bottom 25% of range).',
  },
];

export const MarketPulseView: React.FC<MarketPulseViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const { settings, updateSettings } = useTradingSettings();
  const nDays = settings.lookbackDays;
  const [selectedDay, setSelectedDay] = useState<string>(dates[dates.length - 1] ?? '');
  const [timeframe, setTimeframe] = useState<PulseTimeframe>('1d');
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [pulse, setPulse] = useState<MarketPulseResponse | null>(null);
  const [screen, setScreen] = useState<PulseScreen>('vwap_strength');
  const [minTurnLakh, setMinTurnLakh] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  useEffect(() => {
    if (dates.length > 0 && (!selectedDay || !dates.includes(selectedDay))) {
      setSelectedDay(dates[dates.length - 1]);
    }
  }, [dates, selectedDay]);

  const resolvedWindow = useMemo(() => {
    if (!selectedDay || dates.length === 0) return null;
    const endIdx = dates.indexOf(selectedDay);
    const idx = endIdx >= 0 ? endIdx : dates.length - 1;
    if (timeframe === 'yesterday') {
      const yIdx = Math.max(0, idx - 1);
      return { start: dates[yIdx], end: dates[yIdx] };
    }
    const len =
      timeframe === '1d' ? 1 : timeframe === '2d' ? 2 : timeframe === '5d' ? 5 : nDays;
    const startIdx = Math.max(0, idx - len + 1);
    return { start: dates[startIdx], end: dates[idx] };
  }, [dates, selectedDay, timeframe, nDays]);

  useEffect(() => {
    if (!resolvedWindow) return;
    let cancelled = false;
    setLoading(true);
    const url = `/api/market-pulse?day=${encodeURIComponent(
      resolvedWindow.end
    )}&start=${encodeURIComponent(resolvedWindow.start)}&end=${encodeURIComponent(
      resolvedWindow.end
    )}&nDays=${nDays}&equityOnly=${equityOnly}`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setPulse(d);
      })
      .catch(() => {
        if (!cancelled) setPulse(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedWindow?.start, resolvedWindow?.end, nDays, equityOnly]);

  const filteredRows = useMemo(() => {
    if (!pulse?.rows) return [];
    const minTurnover = minTurnLakh * 1e5;
    const base = pulse.rows.filter(
      (r) =>
        r.turnover >= minTurnover &&
        (selectedSector === 'ALL' || r.sector === selectedSector)
    );

    switch (screen) {
      case 'vwap_strength':
        return base
          .filter((r) => (r.vwap_pct ?? -99) > 0 && (r.diff_pct ?? 0) > 0)
          .sort((a, b) => b.turnover - a.turnover);
      case 'volume_surge':
        return base
          .filter(
            (r) =>
              r.turnover_vs_avg_n >= settings.turnoverSpikeMult ||
              r.volume_vs_avg_n >= settings.volumeSpikeMult
          )
          .sort((a, b) => b.turnover_vs_avg_n - a.turnover_vs_avg_n);
      case 'block_flow':
        return base
          .filter((r) => r.trans >= 20)
          .sort((a, b) => b.avg_trade_size - a.avg_trade_size);
      case 'near_52w_high':
        return base
          .filter((r) => r.gap_52h_pct !== null && r.gap_52h_pct <= 5.0 && r.gap_52h_pct >= -0.1)
          .sort((a, b) => (a.gap_52h_pct ?? 99) - (b.gap_52h_pct ?? 99));
      case 'ma120_pullback':
        return base
          .filter(
            (r) =>
              r.d120 !== null &&
              r.d180 !== null &&
              r.d120 > r.d180 &&
              r.vs_d120_pct !== null &&
              r.vs_d120_pct >= -1.0 &&
              r.vs_d120_pct <= 6.0
          )
          .sort((a, b) => b.turnover - a.turnover);
      case 'strong_close':
        return base
          .filter(
            (r) =>
              r.close_pos_pct >= 80 &&
              (r.range_pct ?? 0) >= 2.0 &&
              (r.diff_pct ?? 0) > 0
          )
          .sort((a, b) => (b.diff_pct ?? 0) - (a.diff_pct ?? 0));
      case 'circuit_wick':
        return base
          .filter(
            (r) =>
              Math.abs(r.diff_pct ?? 0) >= 9.0 ||
              (r.close_pos_pct <= 25 && (r.range_pct ?? 0) >= 3.0)
          )
          .sort((a, b) => Math.abs(b.diff_pct ?? 0) - Math.abs(a.diff_pct ?? 0));
    }
  }, [
    pulse,
    screen,
    minTurnLakh,
    selectedSector,
    settings.turnoverSpikeMult,
    settings.volumeSpikeMult,
  ]);

  const cols: ColumnDef<MarketPulseRow>[] = useMemo(
    () => [
      createWatchlistColumn<MarketPulseRow>({
        getSymbol: (r) => r.symbol,
        hasSymbol,
        toggleSymbol,
      }),
      {
        key: 'symbol',
        label: 'Symbol',
        align: 'left',
        render: (r) => (
          <div className="leading-tight">
            <span className="font-semibold text-blue-600 dark:text-blue-400">{r.symbol}</span>
            <span className="block text-[10px] text-slate-400">{r.sector}</span>
          </div>
        ),
      },
      {
        key: 'close',
        label: 'LTP / Close',
        align: 'right',
        render: (r) => formatNum(r.ltp || r.close),
      },
      {
        key: 'diff_pct',
        label: 'Chg %',
        align: 'right',
        render: (r) => (
          <span
            className={
              (r.diff_pct ?? 0) >= 0
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-red-600 dark:text-red-400 font-medium'
            }
          >
            {formatPct(r.diff_pct)}
          </span>
        ),
      },
      {
        key: 'turnover_vs_avg_n',
        label: `vs ${nDays}d Turn`,
        align: 'right',
        render: (r) => (
          <span
            className={
              r.turnover_vs_avg_n >= settings.turnoverSpikeMult
                ? 'text-amber-600 dark:text-amber-400 font-semibold'
                : 'text-slate-600 dark:text-slate-300'
            }
          >
            {r.turnover_vs_avg_n.toFixed(2)}x
          </span>
        ),
      },
      {
        key: 'vwap_pct',
        label: 'vs VWAP %',
        align: 'right',
        render: (r) => (
          <span
            className={
              (r.vwap_pct ?? 0) >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }
          >
            {formatPct(r.vwap_pct)}
          </span>
        ),
      },
      {
        key: 'close_pos_pct',
        label: 'Close Strength',
        align: 'right',
        render: (r) => (
          <div className="inline-flex items-center gap-2 justify-end">
            <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className={`h-full ${
                  r.close_pos_pct >= 70
                    ? 'bg-emerald-600'
                    : r.close_pos_pct <= 30
                      ? 'bg-red-600'
                      : 'bg-blue-600'
                }`}
                style={{ width: `${r.close_pos_pct}%` }}
              />
            </div>
            <span className="w-9 text-right">{r.close_pos_pct.toFixed(0)}%</span>
          </div>
        ),
      },
      {
        key: 'avg_trade_size',
        label: 'Rs / Trade',
        align: 'right',
        render: (r) => formatInt(r.avg_trade_size),
      },
      {
        key: 'vs_d120_pct',
        label: 'vs MA120',
        align: 'right',
        render: (r) => formatPct(r.vs_d120_pct),
      },
      {
        key: 'turnover',
        label: 'Turnover (cr)',
        align: 'right',
        csvValue: (r) => (r.turnover / 1e7).toFixed(4),
        render: (r) => formatCrore(r.turnover),
      },
    ],
    [hasSymbol, toggleSymbol, nDays, settings.turnoverSpikeMult]
  );

  const s = pulse?.summary;
  const sectors: SectorPulseMetric[] = pulse?.sectors ?? [];
  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
  const activeScreenDoc = PULSE_SCREENS.find((x) => x.id === screen)!;

  const advPct = s && s.total > 0 ? (s.advancers / s.total) * 100 : 0;
  const decPct = s && s.total > 0 ? (s.decliners / s.total) * 100 : 0;
  const unchPct = Math.max(0, 100 - advPct - decPct);

  const sentimentColor =
    s?.sentimentLabel === 'Risk-On / Bullish'
      ? 'text-emerald-600 dark:text-emerald-400'
      : s?.sentimentLabel === 'Constructive'
        ? 'text-blue-600 dark:text-blue-400'
        : s?.sentimentLabel === 'Neutral / Selective'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400';

  return (
    <div className="space-y-6">
      {/* Header & Interactive Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Market Pulse, Breadth &amp; Sector Momentum
            </h2>
            <InfoTip
              title="Understanding Market Pulse"
              body="Market Pulse combines market breadth (Advancers vs Decliners), sector rotation against N-day baselines, turnover concentration, and VWAP/MA120 participation into a real-time regime view."
              example="If A/D ratio > 1.5, >60% of stocks close above VWAP, and turnover exceeds its 20d average, institutional conviction is broad rather than narrow."
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Breadth, sentiment score, sector capital rotation, participation, and flow screens anchored to N={nDays}d rolling history
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
            {(
              [
                { id: '1d', label: 'Last Day' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: '2d', label: '2D' },
                { id: '5d', label: '5D' },
                { id: 'nd', label: `${nDays}D` },
              ] as Array<{ id: PulseTimeframe; label: string }>
            ).map((tf) => (
              <button
                key={tf.id}
                type="button"
                onClick={() => setTimeframe(tf.id)}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  timeframe === tf.id
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
            {LOOKBACK_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => updateSettings({ lookbackDays: preset })}
                className={`px-2 py-1 rounded font-mono text-[11px] font-medium transition-colors ${
                  nDays === preset
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
                title={`Set N-day rolling baseline to ${preset} trading days`}
              >
                N={preset}
              </button>
            ))}
          </div>

          <select
            id="pulse-day"
            value={selectedDay}
            onChange={(e) => setSelectedDay(e.target.value)}
            aria-label="Anchor trading day"
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

      {/* Sentiment, Breadth, Concentration & Participation Row */}
      {s && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Sentiment Gauge */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                <Gauge className="w-3.5 h-3.5" />
                <span>Composite Sentiment</span>
              </span>
              <InfoTip
                title="Market Sentiment Score (0–100)"
                body="Combines Advance/Decline breadth (40%), stocks closing above VWAP (25%), stocks above MA120 (20%), and market turnover relative to its N-day average (15%)."
                example="Above 66 = Risk-On / Bullish; below 38 = Risk-Off / Cautious."
              />
            </div>
            <div className="flex items-baseline justify-between">
              <span className={`text-2xl font-mono tabular-nums font-bold ${sentimentColor}`}>
                {s.sentimentScore.toFixed(0)}
                <span className="text-xs font-normal text-slate-400">/100</span>
              </span>
              <span className={`text-xs font-semibold ${sentimentColor}`}>{s.sentimentLabel}</span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  s.sentimentScore >= 66
                    ? 'bg-emerald-600'
                    : s.sentimentScore >= 52
                      ? 'bg-blue-600'
                      : s.sentimentScore >= 38
                        ? 'bg-amber-500'
                        : 'bg-red-600'
                }`}
                style={{ width: `${Math.min(100, Math.max(4, s.sentimentScore))}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex justify-between">
              <span>Window: {s.windowDays === 1 ? s.endDate : `${s.startDate} → ${s.endDate}`}</span>
              <span>Turn {s.turnoverVsAvgN.toFixed(2)}x {nDays}d avg</span>
            </div>
          </div>

          {/* Market Breadth */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Market Breadth (A / D)</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                A/D Ratio: {s.adRatio.toFixed(2)}
              </span>
            </div>
            <div className="flex items-baseline justify-between font-mono tabular-nums text-sm font-semibold">
              <span className="text-emerald-600 dark:text-emerald-400">{s.advancers} Adv</span>
              <span className="text-slate-400 text-xs">{s.unchanged} Flat</span>
              <span className="text-red-600 dark:text-red-400">{s.decliners} Dec</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800">
              <div className="bg-emerald-500 h-full" style={{ width: `${advPct}%` }} />
              <div className="bg-slate-300 dark:bg-slate-600 h-full" style={{ width: `${unchPct}%` }} />
              <div className="bg-red-500 h-full" style={{ width: `${decPct}%` }} />
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex justify-between">
              <span>Circuits (±9%): {s.upperCircuitCount}↑ / {s.lowerCircuitCount}↓</span>
              <span>52w H/L: {s.near52HighCount}/{s.near52LowCount}</span>
            </div>
          </div>

          {/* Turnover Concentration */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Turnover &amp; Concentration</span>
              <InfoTip
                title="Turnover Concentration"
                body="Measures whether NEPSE turnover is broad-based or crowded into just the top 5–10 tickers."
                example="Top 10 concentration above 45% signals narrow speculative rotation into a handful of names."
                align="right"
              />
            </div>
            <div className="text-xl font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              Rs {formatCrore(s.totalTurnover, 1)} cr
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono tabular-nums pt-0.5">
              <div className="px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                <span className="text-slate-400 block">Top 5 Share</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {s.top5ConcentrationPct.toFixed(1)}%
                </span>
              </div>
              <div className="px-2 py-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                <span className="text-slate-400 block">Top 10 Share</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {s.top10ConcentrationPct.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Market Participation */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Participation &amp; Ticket Mix</span>
              <span className="font-mono">{s.total} active</span>
            </div>
            <div className="text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              {formatInt(s.totalTrades)} trades · {formatInt(s.totalVolume)} sh
            </div>
            <div className="grid grid-cols-4 gap-1 text-center font-mono text-[10px] pt-1">
              <div className="p-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                <div className="text-slate-400">&lt;50k</div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  {s.ticketDistribution.retailCount}
                </div>
              </div>
              <div className="p-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                <div className="text-slate-400">50-250k</div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  {s.ticketDistribution.midCount}
                </div>
              </div>
              <div className="p-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                <div className="text-slate-400">250k-1M</div>
                <div className="font-semibold text-blue-600 dark:text-blue-400">
                  {s.ticketDistribution.hniCount}
                </div>
              </div>
              <div className="p-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800">
                <div className="text-slate-400">&gt;1M</div>
                <div className="font-semibold text-amber-600 dark:text-amber-400">
                  {s.ticketDistribution.institutionalCount}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Structural Technical Participation Bars */}
      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Above MA120</span>
              <span className="font-mono">{s.aboveMa120}/{s.ma120Eligible}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-mono font-semibold">{pct(s.aboveMa120, s.ma120Eligible)}%</span>
              <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                <div className="h-full bg-blue-600" style={{ width: `${pct(s.aboveMa120, s.ma120Eligible)}%` }} />
              </div>
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Golden Trend (120&gt;180)</span>
              <span className="font-mono">{s.goldenCross}/{s.maEligible}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-mono font-semibold">{pct(s.goldenCross, s.maEligible)}%</span>
              <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                <div className="h-full bg-emerald-600" style={{ width: `${pct(s.goldenCross, s.maEligible)}%` }} />
              </div>
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Closed Above VWAP</span>
              <span className="font-mono">{s.aboveVwap}/{s.vwapEligible}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-mono font-semibold">{pct(s.aboveVwap, s.vwapEligible)}%</span>
              <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                <div className="h-full bg-indigo-600" style={{ width: `${pct(s.aboveVwap, s.vwapEligible)}%` }} />
              </div>
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
            <div className="text-xs text-slate-500 dark:text-slate-400">Median Trade / Range</div>
            <div className="text-lg font-mono font-semibold">Rs {formatInt(s.medianAvgTradeSize)}</div>
            <div className="text-[11px] font-mono text-slate-400">
              Median range: {s.medianRangePct.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {/* Sector-Wise Momentum & Rotation Matrix */}
      {sectors.length > 0 && (
        <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Sector-Wise Momentum &amp; Capital Rotation
              </h3>
              <InfoTip
                title="Sector Rotation & N-Day Share Delta"
                body={`Groups traded equities by NEPSE sector (classified from ticker & company name) and compares current sector share of market turnover against its ${nDays}-day average share.`}
                example="If Hydropower captures 38% of today's turnover vs a 28% 20-day average (+10.0% rotation), fresh money is actively rotating into Hydropower."
              />
            </div>

            {selectedSector !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedSector('ALL')}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear sector filter ({selectedSector})
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {sectors.map((sec) => {
              const isSelected = selectedSector === sec.sector;
              const pos = sec.avgChangePct >= 0;
              const rotPos = sec.rotationDeltaPct >= 0;
              return (
                <div
                  key={sec.sector}
                  onClick={() =>
                    setSelectedSector((cur) => (cur === sec.sector ? 'ALL' : sec.sector))
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedSector((cur) => (cur === sec.sector ? 'ALL' : sec.sector));
                    }
                  }}
                  className={`p-3 rounded-md border text-xs cursor-pointer transition-colors space-y-2 ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-950/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {sec.sector}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {sec.advancers}↑ / {sec.decliners}↓ · {sec.aboveVwapPct.toFixed(0)}% &gt;VWAP
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-0.5 font-mono font-semibold shrink-0 ${
                        pos
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {pos ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {formatPct(sec.avgChangePct)}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      <span>Rs {formatCrore(sec.turnover, 1)} cr ({sec.turnoverSharePct.toFixed(1)}%)</span>
                      <span
                        className={
                          sec.turnoverVsAvgN >= 1.3
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-slate-400'
                        }
                      >
                        {sec.turnoverVsAvgN.toFixed(1)}x {nDays}d
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
                      <div
                        className={`h-full ${pos ? 'bg-emerald-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, Math.max(4, sec.turnoverSharePct * 2))}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono pt-0.5">
                    <span
                      className={
                        rotPos
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }
                    >
                      Rot {rotPos ? '+' : ''}{sec.rotationDeltaPct.toFixed(1)}%
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInspectSymbol(sec.leaderSymbol);
                      }}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Top: {sec.leaderSymbol} ({formatPct(sec.leaderChangePct)})
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Segmented Flow Screen Selector + Dynamic Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            {PULSE_SCREENS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setScreen(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  screen === tab.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              aria-label="Filter by sector"
              className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">All Sectors ({sectors.length})</option>
              {sectors.map((sec) => (
                <option key={sec.sector} value={sec.sector}>
                  {sec.sector} ({sec.stocks})
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <label htmlFor="pulse-minturn" className="font-medium text-slate-600 dark:text-slate-400">
                Min turn (lakh)
              </label>
              <input
                id="pulse-minturn"
                type="number"
                min={0}
                max={5000}
                step={5}
                value={minTurnLakh}
                onChange={(e) => setMinTurnLakh(Math.max(0, Number(e.target.value)))}
                className="w-20 px-2.5 py-1.5 font-mono rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300">{activeScreenDoc.desc}</p>
      </div>

      {loading ? (
        <div className="h-72 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
      ) : (
        <DataTable
          rows={filteredRows}
          columns={cols}
          rowKey={(r) => r.symbol}
          onRowClick={(r) => onInspectSymbol(r.symbol)}
          searchKeys={['symbol', 'name', 'sector']}
          exportFilename={`nepse-pulse-${screen}-${resolvedWindow?.end || 'latest'}.csv`}
          watchlistFilter={{ watchlist, getSymbol: (r) => r.symbol }}
          maxHeightClass="max-h-[480px]"
        />
      )}
    </div>
  );
};
