import React, { useState } from 'react';
import { Check, RotateCcw, Sliders } from 'lucide-react';
import {
  DEFAULT_TRADING_SETTINGS,
  LOOKBACK_PRESETS,
  useTradingSettings,
} from '../hooks/useTradingSettings';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, resetSettings } = useTradingSettings();
  const [customDaysInput, setCustomDaysInput] = useState(String(settings.lookbackDays));
  const [savedNotice, setSavedNotice] = useState(false);

  const flashSaved = () => {
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  const applyLookback = (days: number) => {
    const clamped = Math.max(2, Math.min(250, Math.round(days)));
    updateSettings({ lookbackDays: clamped });
    setCustomDaysInput(String(clamped));
    flashSaved();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Trading Metrics &amp; Alert Settings
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure the rolling trading-day window (N) and Visual Alert thresholds applied across
            Stock Explorer, charts, and liquidity comparisons.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              <span>Saved automatically</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              resetSettings();
              setCustomDaysInput(String(DEFAULT_TRADING_SETTINGS.lookbackDays));
              flashSaved();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>
        </div>
      </div>

      {/* Rolling Window N Section */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Rolling Trading Window (N Days)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Used for N-day Average Turnover, N-day Average Volume, SMA(N) overlay, N-day Support &amp;
              Resistance levels, and Visual Alert baselines.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {LOOKBACK_PRESETS.map((preset) => {
              const active = settings.lookbackDays === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyLookback(preset)}
                  className={`px-3.5 py-2 rounded-md border text-xs font-mono font-semibold transition-colors ${
                    active
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                  }`}
                >
                  {preset} Days
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-xs pl-2 border-l border-slate-200 dark:border-slate-800">
            <label htmlFor="custom-n-days" className="text-slate-600 dark:text-slate-300">
              Custom N:
            </label>
            <input
              id="custom-n-days"
              type="number"
              min={2}
              max={250}
              value={customDaysInput}
              onChange={(e) => {
                setCustomDaysInput(e.target.value);
                const parsed = Number(e.target.value);
                if (Number.isFinite(parsed) && parsed >= 2 && parsed <= 250) {
                  updateSettings({ lookbackDays: Math.round(parsed) });
                  flashSaved();
                }
              }}
              className="w-20 px-2.5 py-1.5 font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            <span className="text-slate-400">trading days</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="font-medium text-slate-800 dark:text-slate-200">5 – 10 Days</div>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Short-term swing trading sensitivity for sudden turnover and breakout spikes.
            </p>
          </div>
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="font-medium text-slate-800 dark:text-slate-200">20 Days (Default)</div>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Standard 1-month NEPSE institutional liquidity baseline (approx. 4 trading weeks).
            </p>
          </div>
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="font-medium text-slate-800 dark:text-slate-200">50 – 100 Days</div>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Quarterly / semi-annual trend baselines to filter out short-term noise.
            </p>
          </div>
        </div>
      </section>

      {/* Visual Alert Thresholds Section */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Visual Alert Signal Thresholds
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Customize trigger levels for Bullish, Bearish, and Warning alerts in Stock Explorer.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <label className="space-y-1">
            <span className="block font-medium text-slate-700 dark:text-slate-300">
              Volume Surge Threshold (× {settings.lookbackDays}d Avg)
            </span>
            <input
              type="number"
              min={1.1}
              max={5}
              step={0.1}
              value={settings.volumeSpikeMult}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 1.1) {
                  updateSettings({ volumeSpikeMult: v });
                  flashSaved();
                }
              }}
              className="w-full px-3 py-2 font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-slate-700 dark:text-slate-300">
              Turnover Surge Threshold (× {settings.lookbackDays}d Avg)
            </span>
            <input
              type="number"
              min={1.1}
              max={5}
              step={0.1}
              value={settings.turnoverSpikeMult}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 1.1) {
                  updateSettings({ turnoverSpikeMult: v });
                  flashSaved();
                }
              }}
              className="w-full px-3 py-2 font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-slate-700 dark:text-slate-300">
              Near 52-Week High Band (%)
            </span>
            <input
              type="number"
              min={1}
              max={25}
              step={0.5}
              value={settings.near52Pct}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 1 && v <= 25) {
                  updateSettings({ near52Pct: v });
                  flashSaved();
                }
              }}
              className="w-full px-3 py-2 font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-slate-700 dark:text-slate-300">
              RSI(14) Overbought Warning (≥)
            </span>
            <input
              type="number"
              min={55}
              max={95}
              step={1}
              value={settings.rsiOverbought}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 55 && v <= 95) {
                  updateSettings({ rsiOverbought: v });
                  flashSaved();
                }
              }}
              className="w-full px-3 py-2 font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-slate-700 dark:text-slate-300">
              RSI(14) Oversold Rebound Zone (≤)
            </span>
            <input
              type="number"
              min={5}
              max={45}
              step={1}
              value={settings.rsiOversold}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 5 && v <= 45) {
                  updateSettings({ rsiOversold: v });
                  flashSaved();
                }
              }}
              className="w-full px-3 py-2 font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-slate-700 dark:text-slate-300">
              Big-Ticket / Block Warning Min (NPR)
            </span>
            <input
              type="number"
              min={50_000}
              step={50_000}
              value={settings.blockTicketMinRs}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 50_000) {
                  updateSettings({ blockTicketMinRs: v });
                  flashSaved();
                }
              }}
              className="w-full px-3 py-2 font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </label>
        </div>
      </section>
    </div>
  );
};
