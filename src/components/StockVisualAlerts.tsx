import React, { useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { LOOKBACK_PRESETS, type TradingSettings } from '../hooks/useTradingSettings';
import type { PriceRow } from '../types/market';
import { formatCrore, formatInt, formatNum, formatPct } from '../utils/format';

export type VisualSignalTone = 'bullish' | 'bearish' | 'warning';

export interface VisualAlertItem {
  id: string;
  tone: VisualSignalTone;
  title: string;
  metric: string;
  detail: string;
}

interface StockVisualAlertsProps {
  symbol: string;
  history: PriceRow[];
  settings: TradingSettings;
  onUpdateSettings: (patch: Partial<TradingSettings>) => void;
}

function computeRsi14(rows: PriceRow[]): number | null {
  const period = 14;
  if (rows.length <= period) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = rows[i].close - rows[i - 1].close;
    if (d > 0) avgGain += d;
    else avgLoss += Math.abs(d);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < rows.length; i++) {
    const d = rows[i].close - rows[i - 1].close;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? Math.abs(d) : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export const StockVisualAlerts: React.FC<StockVisualAlertsProps> = ({
  symbol,
  history,
  settings,
  onUpdateSettings,
}) => {
  const [configOpen, setConfigOpen] = useState(false);

  const analysis = useMemo(() => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const n = settings.lookbackDays;
    const priorWindow = history.slice(0, -1).slice(-n);
    const fullWindow = history.slice(-n);

    const avgVolN =
      priorWindow.length > 0
        ? priorWindow.reduce((s, r) => s + r.volume, 0) / priorWindow.length
        : last.volume;
    const avgTurnN =
      priorWindow.length > 0
        ? priorWindow.reduce((s, r) => s + r.turnover, 0) / priorWindow.length
        : last.turnover;
    const smaN =
      fullWindow.length > 0
        ? fullWindow.reduce((s, r) => s + r.close, 0) / fullWindow.length
        : last.close;

    const priorHighN =
      priorWindow.length > 0 ? Math.max(...priorWindow.map((r) => r.high)) : last.high;
    const priorLowN =
      priorWindow.length > 0 ? Math.min(...priorWindow.map((r) => r.low)) : last.low;

    const volRatio = avgVolN > 0 ? last.volume / avgVolN : 1;
    const turnRatio = avgTurnN > 0 ? last.turnover / avgTurnN : 1;
    const rsi14 = computeRsi14(history);
    const closePos =
      last.high > last.low ? ((last.close - last.low) / (last.high - last.low)) * 100 : 50;
    const avgTicket = last.trans > 0 ? last.turnover / last.trans : last.turnover;
    const gap52h =
      last.w52_high && last.w52_high > 0
        ? ((last.w52_high - last.close) / last.w52_high) * 100
        : null;

    const alerts: VisualAlertItem[] = [];

    // 1. Resistance Breakout / Support Breakdown vs N-day prior range
    if (priorWindow.length >= 3 && last.close > priorHighN) {
      alerts.push({
        id: 'breakout-n',
        tone: volRatio >= settings.volumeSpikeMult ? 'bullish' : 'warning',
        title:
          volRatio >= settings.volumeSpikeMult
            ? `${n}-Day Resistance Breakout + Volume Surge`
            : `${n}-Day High Breakout (Moderate Volume)`,
        metric: `Close NPR ${formatNum(last.close)} > ${n}d High ${formatNum(priorHighN)}`,
        detail:
          volRatio >= settings.volumeSpikeMult
            ? `Price cleared ${n}-day resistance on ${volRatio.toFixed(2)}x average volume.`
            : `Price closed above ${n}-day resistance, though volume is only ${volRatio.toFixed(2)}x average (watch for follow-through).`,
      });
    } else if (priorWindow.length >= 3 && last.close < priorLowN) {
      alerts.push({
        id: 'breakdown-n',
        tone: 'bearish',
        title: `${n}-Day Support Breakdown`,
        metric: `Close NPR ${formatNum(last.close)} < ${n}d Low ${formatNum(priorLowN)}`,
        detail: `Closed below the lowest low of the prior ${priorWindow.length} sessions on ${volRatio.toFixed(2)}x volume.`,
      });
    }

    // 2. Volume & Turnover Condition vs N-Day Baseline
    if (volRatio >= settings.volumeSpikeMult || turnRatio >= settings.turnoverSpikeMult) {
      const chg = last.diff_pct ?? 0;
      if (chg >= 0) {
        alerts.push({
          id: 'vol-bull',
          tone: 'bullish',
          title: `Accumulation Volume & Turnover Spike`,
          metric: `Vol ${volRatio.toFixed(2)}x · Turn ${turnRatio.toFixed(2)}x (${n}d avg)`,
          detail: `Today's volume (${formatInt(last.volume)}) and turnover (Rs ${formatCrore(last.turnover)} cr) exceeded the ${n}-day threshold (${settings.volumeSpikeMult}x) on a positive session (${formatPct(chg)}).`,
        });
      } else {
        alerts.push({
          id: 'vol-bear',
          tone: 'bearish',
          title: `High-Volume Selling Pressure`,
          metric: `Vol ${volRatio.toFixed(2)}x · Chg ${formatPct(chg)}`,
          detail: `Heavy participation (${volRatio.toFixed(2)}x ${n}-day avg volume) accompanied a price decline, indicating supply/distribution.`,
        });
      }
    } else if (turnRatio < 0.45 && priorWindow.length >= 5) {
      alerts.push({
        id: 'vol-dry',
        tone: 'warning',
        title: `Thin Liquidity / Turnover Contraction`,
        metric: `Turn ${turnRatio.toFixed(2)}x of ${n}d avg`,
        detail: `Turnover (Rs ${formatCrore(last.turnover)} cr) is less than half its ${n}-day mean (Rs ${formatCrore(avgTurnN)} cr).`,
      });
    }

    // 3. RSI(14) Thresholds
    if (rsi14 !== null) {
      if (rsi14 >= settings.rsiOverbought) {
        alerts.push({
          id: 'rsi-ob',
          tone: 'warning',
          title: `RSI(14) Overbought Caution`,
          metric: `RSI ${rsi14.toFixed(1)} ≥ ${settings.rsiOverbought}`,
          detail: `Momentum is stretched above the configured ${settings.rsiOverbought} threshold; watch for mean-reversion pullbacks.`,
        });
      } else if (rsi14 <= settings.rsiOversold) {
        alerts.push({
          id: 'rsi-os',
          tone: 'bullish',
          title: `RSI(14) Oversold Rebound Zone`,
          metric: `RSI ${rsi14.toFixed(1)} ≤ ${settings.rsiOversold}`,
          detail: `Selling pressure may be exhausted below ${settings.rsiOversold}; monitor VWAP reclaim for reversal confirmation.`,
        });
      }
    }

    // 4. VWAP & Intraday Close Strength
    if (last.vwap && last.vwap > 0) {
      if (last.close > last.vwap && closePos >= 75) {
        alerts.push({
          id: 'vwap-bull',
          tone: 'bullish',
          title: `Strong Buyer Control Above VWAP`,
          metric: `+${(((last.close - last.vwap) / last.vwap) * 100).toFixed(2)}% vs VWAP · ${closePos.toFixed(0)}% Close Str`,
          detail: `Closed in the upper quartile of the intraday range above VWAP (NPR ${formatNum(last.vwap)}).`,
        });
      } else if (last.close < last.vwap && closePos <= 25) {
        alerts.push({
          id: 'vwap-bear',
          tone: 'bearish',
          title: `Weak Close Below Intraday VWAP`,
          metric: `${(((last.close - last.vwap) / last.vwap) * 100).toFixed(2)}% vs VWAP · ${closePos.toFixed(0)}% Close Str`,
          detail: `Sellers controlled the close near session lows below VWAP (NPR ${formatNum(last.vwap)}).`,
        });
      }
    }

    // 5. SMA(N) & Long-Term MA120/180 Trend Structure
    if (last.d120 && last.d180 && last.d120 > 0 && last.d180 > 0) {
      if (last.close > last.d120 && last.d120 > last.d180 && last.close > smaN) {
        alerts.push({
          id: 'ma-bull',
          tone: 'bullish',
          title: `Full Trend Alignment (Price > SMA${n} & MA120 > MA180)`,
          metric: `SMA(${n}) ${formatNum(smaN)} · MA120 ${formatNum(last.d120)}`,
          detail: `Short, medium, and long-term moving averages are stacked in a bullish trend configuration.`,
        });
      } else if (last.close < last.d120 && last.d120 < last.d180 && last.close < smaN) {
        alerts.push({
          id: 'ma-bear',
          tone: 'bearish',
          title: `Downtrend Structure (Below SMA${n}, MA120 & MA180)`,
          metric: `SMA(${n}) ${formatNum(smaN)} · MA120 ${formatNum(last.d120)}`,
          detail: `Price remains below all primary trend averages.`,
        });
      }
    }

    // 6. Near 52-Week High
    if (gap52h !== null && gap52h <= settings.near52Pct) {
      alerts.push({
        id: 'near-52h',
        tone: (last.diff_pct ?? 0) >= 0 ? 'bullish' : 'warning',
        title: `Within ${settings.near52Pct}% of 52-Week High`,
        metric: `${gap52h.toFixed(1)}% below 52w High (${formatNum(last.w52_high)})`,
        detail: `Trading near annual peak resistance with minimal overhead bag-holder supply.`,
      });
    }

    // 7. Low-Trade Block-Cross Warning
    if (last.trans > 0 && last.trans < 25 && avgTicket >= settings.blockTicketMinRs) {
      alerts.push({
        id: 'block-warn',
        tone: 'warning',
        title: `Low-Trade High-Ticket Block Activity`,
        metric: `${formatInt(last.trans)} trades · Rs ${formatInt(avgTicket)}/tx`,
        detail: `Turnover is concentrated in very few transactions; verify whether flow is a pre-arranged cross rather than broad demand.`,
      });
    }

    // 8. History completeness notice
    if (history.length < n) {
      alerts.push({
        id: 'hist-short',
        tone: 'warning',
        title: `Partial ${n}-Day Lookback Sample`,
        metric: `${history.length} / ${n} sessions loaded`,
        detail: `Only ${history.length} sessions exist for ${symbol}; averages use all available sessions.`,
      });
    }

    const bullCount = alerts.filter((a) => a.tone === 'bullish').length;
    const bearCount = alerts.filter((a) => a.tone === 'bearish').length;
    const warnCount = alerts.filter((a) => a.tone === 'warning').length;

    let overall: { tone: VisualSignalTone; label: string } = {
      tone: 'warning',
      label: 'Neutral / Mixed Signals',
    };
    if (bullCount > bearCount && bullCount >= 2) {
      overall = { tone: 'bullish', label: 'Bullish Technical & Volume Bias' };
    } else if (bearCount > bullCount && bearCount >= 2) {
      overall = { tone: 'bearish', label: 'Bearish Technical & Supply Bias' };
    } else if (bullCount > bearCount) {
      overall = { tone: 'bullish', label: 'Moderately Bullish' };
    } else if (bearCount > bullCount) {
      overall = { tone: 'bearish', label: 'Moderately Bearish' };
    }

    return {
      alerts,
      bullCount,
      bearCount,
      warnCount,
      overall,
      volRatio,
      turnRatio,
      avgVolN,
      avgTurnN,
      smaN,
      rsi14,
      n,
    };
  }, [history, settings, symbol]);

  if (!analysis) return null;

  const bannerStyles: Record<VisualSignalTone, string> = {
    bullish:
      'bg-emerald-50/90 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800/80 text-emerald-900 dark:text-emerald-200',
    bearish:
      'bg-red-50/90 dark:bg-red-950/30 border-red-300 dark:border-red-800/80 text-red-900 dark:text-red-200',
    warning:
      'bg-amber-50/90 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800/80 text-amber-900 dark:text-amber-200',
  };

  const cardStyles: Record<VisualSignalTone, string> = {
    bullish:
      'border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/50 dark:bg-emerald-950/20',
    bearish: 'border-red-200 dark:border-red-900/70 bg-red-50/50 dark:bg-red-950/20',
    warning: 'border-amber-200 dark:border-amber-900/70 bg-amber-50/50 dark:bg-amber-950/20',
  };

  const toneBadgeText: Record<VisualSignalTone, { label: string; cls: string }> = {
    bullish: { label: 'BULLISH', cls: 'text-emerald-700 dark:text-emerald-400' },
    bearish: { label: 'BEARISH', cls: 'text-red-700 dark:text-red-400' },
    warning: { label: 'WARNING', cls: 'text-amber-700 dark:text-amber-400' },
  };

  return (
    <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-4">
      {/* Header + Overall Color-Coded Status */}
      <div
        className={`rounded-md border px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${bannerStyles[analysis.overall.tone]}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {analysis.overall.tone === 'bullish' ? (
            <TrendingUp className="w-4 h-4 shrink-0" />
          ) : analysis.overall.tone === 'bearish' ? (
            <ShieldAlert className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold">
              Visual Alert Engine ({symbol} · {analysis.n}-Day Window): {analysis.overall.label}
            </div>
            <div className="text-[11px] opacity-85 font-mono tabular-nums mt-0.5">
              {analysis.bullCount} Bullish · {analysis.bearCount} Bearish · {analysis.warnCount} Warning
              {' | '}Vol {analysis.volRatio.toFixed(2)}x · Turn {analysis.turnRatio.toFixed(2)}x · SMA(
              {analysis.n}) {formatNum(analysis.smaN)}
              {analysis.rsi14 !== null ? ` · RSI ${analysis.rsi14.toFixed(1)}` : ''}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-current/25 bg-white/70 dark:bg-slate-900/70 text-[11px] font-medium hover:bg-white dark:hover:bg-slate-900 transition-colors shrink-0"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>{configOpen ? 'Hide Alert Rules' : 'Configure Alert Rules'}</span>
        </button>
      </div>

      {/* Inline Configurable Thresholds */}
      {configOpen && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50 dark:bg-slate-950 p-3.5 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Visual Alert &amp; Rolling Window Thresholds (Synced with Settings)
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-slate-500 mr-1">Lookback N:</span>
              {LOOKBACK_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onUpdateSettings({ lookbackDays: preset })}
                  className={`px-2 py-0.5 rounded font-mono text-[11px] border transition-colors ${
                    settings.lookbackDays === preset
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {preset}d
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Vol Spike Mult (×)
              </span>
              <input
                type="number"
                min={1.1}
                max={5}
                step={0.1}
                value={settings.volumeSpikeMult}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 1) onUpdateSettings({ volumeSpikeMult: v });
                }}
                className="w-full px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Turnover Spike (×)
              </span>
              <input
                type="number"
                min={1.1}
                max={5}
                step={0.1}
                value={settings.turnoverSpikeMult}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 1) onUpdateSettings({ turnoverSpikeMult: v });
                }}
                className="w-full px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                RSI Overbought (≥)
              </span>
              <input
                type="number"
                min={55}
                max={90}
                step={1}
                value={settings.rsiOverbought}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 55 && v <= 95) onUpdateSettings({ rsiOverbought: v });
                }}
                className="w-full px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                RSI Oversold (≤)
              </span>
              <input
                type="number"
                min={10}
                max={45}
                step={1}
                value={settings.rsiOversold}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 5 && v <= 45) onUpdateSettings({ rsiOversold: v });
                }}
                className="w-full px-2 py-1 font-mono rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              />
            </label>
          </div>
        </div>
      )}

      {/* Color-Coded Alert Cards */}
      {analysis.alerts.length === 0 ? (
        <div className="text-xs text-slate-500 dark:text-slate-400 py-2">
          No extreme bullish, bearish, or warning technical conditions triggered under current thresholds.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {analysis.alerts.map((item) => {
            const badge = toneBadgeText[item.tone];
            return (
              <div
                key={item.id}
                className={`rounded-md border p-3 space-y-1.5 text-xs ${cardStyles[item.tone]}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-mono text-[10px] font-bold tracking-wider ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">
                    {item.metric}
                  </span>
                </div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  {item.detail}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
