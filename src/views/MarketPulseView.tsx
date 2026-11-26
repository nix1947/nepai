import React, { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { useWatchlist } from '../hooks/useWatchlist';
import type { MarketPulseResponse, MarketPulseRow } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

interface MarketPulseViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

type PulseScreen =
  | 'vwap_strength'
  | 'block_flow'
  | 'near_52w_high'
  | 'ma120_pullback'
  | 'strong_close'
  | 'circuit_wick';

const PULSE_SCREENS: Array<{ id: PulseScreen; label: string; desc: string }> = [
  {
    id: 'vwap_strength',
    label: 'VWAP Control',
    desc: 'Closed above intraday VWAP with positive return and ≥ Rs 25 lakh turnover — buyers absorbed supply into close.',
  },
  {
    id: 'block_flow',
    label: 'Institutional Ticket',
    desc: 'Ranked by average rupees per trade (min 20 transactions) to separate block accumulation from retail churn.',
  },
  {
    id: 'near_52w_high',
    label: '52w High Watch',
    desc: 'Within 5% of 52-week high with active turnover — works immediately on single-session ShareSansar data.',
  },
  {
    id: 'ma120_pullback',
    label: 'MA120 Uptrend',
    desc: 'Golden trend (MA120 > MA180) with price holding 0% to +5% above MA120 — structural trend support zone.',
  },
  {
    id: 'strong_close',
    label: 'High Close Conviction',
    desc: 'Closed in the top 20% of the intraday range (≥ 80% candle strength) with ≥ 2% range expansion and positive close.',
  },
  {
    id: 'circuit_wick',
    label: 'Circuits & Wicks',
    desc: 'Near upper/lower circuit (±9%) or heavy upper-wick fades (closed in bottom 25% of range on strong turnover).',
  },
];

export const MarketPulseView: React.FC<MarketPulseViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const [selectedDay, setSelectedDay] = useState<string>(dates[dates.length - 1] ?? '');
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

  useEffect(() => {
    if (!selectedDay) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/market-pulse?day=${encodeURIComponent(selectedDay)}&equityOnly=${equityOnly}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPulse(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, equityOnly]);

  const filteredRows = useMemo(() => {
    if (!pulse?.rows) return [];
    const minTurnover = minTurnLakh * 1e5;
    const base = pulse.rows.filter((r) => r.turnover >= minTurnover);

    switch (screen) {
      case 'vwap_strength':
        return base
          .filter((r) => (r.vwap_pct ?? -99) > 0 && (r.diff_pct ?? 0) > 0)
          .sort((a, b) => b.turnover - a.turnover);
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
  }, [pulse, screen, minTurnLakh]);

  const cols: ColumnDef<MarketPulseRow>[] = useMemo(
    () => [
      {
        key: '_star',
        label: '',
        align: 'left',
        sortable: false,
        widthClass: 'w-8',
        render: (r) => {
          const starred = hasSymbol(r.symbol);
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleSymbol(r.symbol);
              }}
              aria-label={starred ? `Remove ${r.symbol} from watchlist` : `Add ${r.symbol} to watchlist`}
              className="p-0.5 text-slate-400 hover:text-amber-500 transition-colors"
            >
              <Star className={`w-3.5 h-3.5 ${starred ? 'fill-amber-500 text-amber-500' : ''}`} />
            </button>
          );
        },
      },
      {
        key: 'symbol',
        label: 'Symbol',
        align: 'left',
        render: (r) => (
          <span className="font-semibold text-blue-600 dark:text-blue-400">{r.symbol}</span>
        ),
      },
      {
        key: 'close',
        label: 'Close',
        align: 'right',
        render: (r) => formatNum(r.close),
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
        key: 'gap_52h_pct',
        label: 'Off 52w High',
        align: 'right',
        render: (r) => (r.gap_52h_pct !== null ? `${r.gap_52h_pct.toFixed(1)}%` : '–'),
      },
      {
        key: 'turnover',
        label: 'Turnover (cr)',
        align: 'right',
        csvValue: (r) => (r.turnover / 1e7).toFixed(4),
        render: (r) => formatCrore(r.turnover),
      },
    ],
    [hasSymbol, toggleSymbol]
  );

  const s = pulse?.summary;
  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
  const activeScreenDoc = PULSE_SCREENS.find((x) => x.id === screen)!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Market Pulse &amp; Institutional Flow
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Structural MA120/180 regime, VWAP positioning, ticket size, and 52-week breadth — works on single-session data
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <label htmlFor="pulse-day" className="font-medium text-slate-600 dark:text-slate-400">
              Trading day
            </label>
            <select
              id="pulse-day"
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
              className="px-3 py-1.5 font-mono rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            >
              {[...dates].reverse().map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="pulse-minturn" className="font-medium text-slate-600 dark:text-slate-400">
              Min turnover (lakh)
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

      {/* Structural Breadth Cards */}
      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">Above MA120</div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                {pct(s.aboveMa120, s.ma120Eligible)}%
              </span>
              <span className="text-xs text-slate-400">
                {s.aboveMa120}/{s.ma120Eligible}
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full bg-blue-600"
                style={{ width: `${pct(s.aboveMa120, s.ma120Eligible)}%` }}
              />
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">Golden Trend (120 &gt; 180)</div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                {pct(s.goldenCross, s.maEligible)}%
              </span>
              <span className="text-xs text-slate-400">
                {s.goldenCross}/{s.maEligible}
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-600"
                style={{ width: `${pct(s.goldenCross, s.maEligible)}%` }}
              />
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">Closed Above VWAP</div>
            <div className="flex items-baseline justify-between font-mono tabular-nums">
              <span className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                {pct(s.aboveVwap, s.vwapEligible)}%
              </span>
              <span className="text-xs text-slate-400">
                {s.aboveVwap}/{s.vwapEligible}
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full bg-indigo-600"
                style={{ width: `${pct(s.aboveVwap, s.vwapEligible)}%` }}
              />
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">52w High / Low (≤ 5%)</div>
            <div className="mt-1 flex items-baseline gap-3 font-mono tabular-nums">
              <span className="text-xl font-semibold text-emerald-600 dark:text-emerald-400">
                {s.near52HighCount}
              </span>
              <span className="text-slate-300 dark:text-slate-700">/</span>
              <span className="text-xl font-semibold text-red-600 dark:text-red-400">
                {s.near52LowCount}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              Circuits ±9%: {s.upperCircuitCount} up · {s.lowerCircuitCount} dn
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Median Trade / Range</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              Rs {formatInt(s.medianAvgTradeSize)}
            </div>
            <div className="mt-1 text-[11px] font-mono text-slate-400">
              Median day range: {s.medianRangePct.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {/* Segmented Flow Screen Selector */}
      <div className="space-y-3">
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
          searchKeys={['symbol', 'name']}
          exportFilename={`nepse-pulse-${screen}-${selectedDay || 'latest'}.csv`}
          watchlistFilter={{ watchlist, getSymbol: (r) => r.symbol }}
          maxHeightClass="max-h-[480px]"
        />
      )}
    </div>
  );
};
