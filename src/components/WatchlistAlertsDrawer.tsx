import React, { useMemo, useState } from 'react';
import {
  Bell,
  CandlestickChart,
  GitCompare,
  Plus,
  Scale,
  Sliders,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useCompareList, useWatchlist } from '../hooks/useWatchlist';
import type { MasterScreenerRow } from '../types/fundamental';
import { evaluateWatchlistAlerts } from '../utils/plainEnglish';

interface WatchlistAlertsDrawerProps {
  open: boolean;
  onClose: () => void;
  rows: MasterScreenerRow[];
  onOpenValuation: (symbol: string) => void;
  onInspectSymbol: (symbol: string) => void;
  onOpenCompareDrawer: () => void;
}

export const WatchlistAlertsDrawer: React.FC<WatchlistAlertsDrawerProps> = ({
  open,
  onClose,
  rows,
  onOpenValuation,
  onInspectSymbol,
  onOpenCompareDrawer,
}) => {
  const { watchlist, addSymbol, toggleSymbol, alertRules, setAlertRule } = useWatchlist();
  const { compareSymbols, hasCompare, toggleCompare } = useCompareList();
  const [filterMode, setFilterMode] = useState<'all' | 'alerts'>('all');
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<string>('');

  const rowMap = useMemo(() => {
    const m = new Map<string, MasterScreenerRow>();
    for (const r of rows) m.set(r.symbol, r);
    return m;
  }, [rows]);

  const enriched = useMemo(() => {
    return watchlist.map((sym) => {
      const row = rowMap.get(sym);
      const rule = alertRules[sym];
      const alerts = evaluateWatchlistAlerts(row, rule);
      return { symbol: sym, row, rule, alerts };
    });
  }, [watchlist, rowMap, alertRules]);

  const totalAlerts = useMemo(
    () => enriched.reduce((sum, item) => sum + item.alerts.length, 0),
    [enriched]
  );

  const visibleItems = useMemo(() => {
    if (filterMode === 'alerts') return enriched.filter((e) => e.alerts.length > 0);
    return enriched;
  }, [enriched, filterMode]);

  const starterSuggestions = useMemo(() => {
    return rows
      .filter((r) => !watchlist.includes(r.symbol) && r.hasFundamentalData)
      .slice(0, 4);
  }, [rows, watchlist]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/50 transition-opacity" onClick={onClose} />
      <aside className="relative z-10 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-500" />
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                Watchlist &amp; Smart Alerts
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {watchlist.length} starred · {totalAlerts} active signal{totalAlerts === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close watchlist drawer"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap ${
                  filterMode === 'all'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                All ({watchlist.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('alerts')}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap ${
                  filterMode === 'alerts'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Triggered Alerts ({enriched.filter((e) => e.alerts.length > 0).length})
              </button>
            </div>

            {compareSymbols.length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenCompareDrawer();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>Compare ({compareSymbols.length})</span>
              </button>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!quickAdd.trim()) return;
              addSymbol(quickAdd);
              setQuickAdd('');
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={quickAdd}
              onChange={(e) => setQuickAdd(e.target.value.toUpperCase())}
              placeholder="Add ticker (e.g. NABIL, SAHAS)…"
              list="watchlist-ticker-suggestions"
              className="flex-1 px-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            />
            <datalist id="watchlist-ticker-suggestions">
              {rows.slice(0, 120).map((r) => (
                <option key={r.symbol} value={r.symbol}>
                  {r.companyName}
                </option>
              ))}
            </datalist>
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {visibleItems.length === 0 ? (
            <div className="p-6 space-y-4 text-xs">
              <div className="text-center space-y-1">
                <Star className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto" />
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  {filterMode === 'alerts'
                    ? 'No triggered watchlist alerts right now'
                    : 'Your Watchlist is empty'}
                </div>
                <p className="text-slate-500 dark:text-slate-400">
                  Star stocks anywhere in the app to track Buy Zone hits, 20D volume breakouts, CDSC lock-in risks, and custom target prices.
                </p>
              </div>

              {starterSuggestions.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="font-semibold text-slate-700 dark:text-slate-300">
                    Top Confluence Starter Picks
                  </div>
                  <div className="space-y-1.5">
                    {starterSuggestions.map((s) => (
                      <div
                        key={s.symbol}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60"
                      >
                        <div className="min-w-0">
                          <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                            {s.symbol}{' '}
                            <span className="font-sans font-normal text-slate-500">
                              · Master {s.masterScore.toFixed(0)}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">{s.companyName}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => addSymbol(s.symbol)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                        >
                          <Star className="w-3 h-3 text-amber-500" />
                          <span>Track</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            visibleItems.map(({ symbol, row, rule, alerts }) => {
              const isEditing = editingSymbol === symbol;
              const inCompare = hasCompare(symbol);
              return (
                <div key={symbol} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                          {symbol}
                        </span>
                        {row?.ltp !== null && row?.ltp !== undefined && (
                          <span className="font-mono text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                            Rs {row.ltp.toFixed(0)}
                          </span>
                        )}
                        {row?.changePct !== null && row?.changePct !== undefined && (
                          <span
                            className={`font-mono text-[11px] tabular-nums ${
                              row.changePct >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {row.changePct >= 0 ? '+' : ''}
                            {row.changePct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {row ? `${row.companyName} · ${row.sector}` : 'Awaiting market snapshot'}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleCompare(symbol)}
                        title={inCompare ? 'Remove from Compare' : 'Add to Compare'}
                        className={`p-1.5 rounded border text-xs ${
                          inCompare
                            ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                            : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <GitCompare className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSymbol(isEditing ? null : symbol)}
                        title="Configure price alerts"
                        className={`p-1.5 rounded border text-xs ${
                          isEditing
                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        <Sliders className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSymbol(symbol)}
                        title="Remove from watchlist"
                        className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {row && (
                    <div className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-2.5 gap-y-0.5">
                      <span>Health {row.valuation.valuationHealthScore?.toFixed(0) ?? '—'}</span>
                      <span>
                        MoS{' '}
                        {row.valuation.marginOfSafetyPct !== null
                          ? `${row.valuation.marginOfSafetyPct >= 0 ? '+' : ''}${row.valuation.marginOfSafetyPct.toFixed(0)}%`
                          : '—'}
                      </span>
                      <span>{row.technical.trendState}</span>
                      <span>10x {row.tenX.tenXScore.toFixed(0)}</span>
                    </div>
                  )}

                  {alerts.length > 0 && (
                    <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] font-medium">
                      {alerts.map((a) => (
                        <span
                          key={a.label}
                          className={
                            a.severity === 'risk'
                              ? 'text-red-600 dark:text-red-400'
                              : a.severity === 'caution'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                          }
                        >
                          • {a.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {isEditing && (
                    <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-0.5">
                            Alert if LTP ≤ (Rs)
                          </label>
                          <input
                            type="number"
                            value={rule?.targetBuyPrice ?? ''}
                            onChange={(e) =>
                              setAlertRule(symbol, {
                                targetBuyPrice: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                            placeholder={
                              row?.valuation.buyZonePrice
                                ? row.valuation.buyZonePrice.toFixed(0)
                                : 'Buy target'
                            }
                            className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-0.5">
                            Alert if LTP ≥ (Rs)
                          </label>
                          <input
                            type="number"
                            value={rule?.targetSellPrice ?? ''}
                            onChange={(e) =>
                              setAlertRule(symbol, {
                                targetSellPrice: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                            placeholder={
                              row?.valuation.compositeFairValue
                                ? row.valuation.compositeFairValue.toFixed(0)
                                : 'Sell target'
                            }
                            className="w-full px-2 py-1 text-xs font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                        <label className="inline-flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rule?.alertOnBuyZone ?? true}
                            onChange={(e) =>
                              setAlertRule(symbol, { alertOnBuyZone: e.target.checked })
                            }
                            className="rounded border-slate-300 text-blue-600"
                          />
                          <span>Buy Zone alerts</span>
                        </label>
                        <label className="inline-flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rule?.alertOnBreakout ?? true}
                            onChange={(e) =>
                              setAlertRule(symbol, { alertOnBreakout: e.target.checked })
                            }
                            className="rounded border-slate-300 text-blue-600"
                          />
                          <span>20D Breakout alerts</span>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenValuation(symbol);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                    >
                      <Scale className="w-3 h-3" />
                      <span>Valuation</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onInspectSymbol(symbol);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <CandlestickChart className="w-3 h-3" />
                      <span>Chart</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
};
