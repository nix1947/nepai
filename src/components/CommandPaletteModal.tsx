import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Award,
  CandlestickChart,
  Crosshair,
  FileText,
  Scale,
  Search,
  Star,
  X,
} from 'lucide-react';
import { useWatchlist } from '../hooks/useWatchlist';
import type { SymbolInfo } from '../types/market';

export interface PaletteNavTarget {
  id: string;
  label: string;
  group: string;
}

interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  symbols: SymbolInfo[];
  navItems: PaletteNavTarget[];
  onNavigateTab: (tabId: string) => void;
  onOpenValuation: (symbol: string) => void;
  onInspectInScreener: (symbol: string) => void;
  onOpenAnnualReports?: (symbol: string) => void;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer: (symbol: string) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onClose,
  symbols,
  navItems,
  onNavigateTab,
  onOpenValuation,
  onInspectInScreener,
  onOpenAnnualReports,
  onInspectSymbol,
  onInspectInAnalyzer,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { hasSymbol, toggleSymbol } = useWatchlist();

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const symbolMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return symbols.slice(0, 6);
    return symbols
      .filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ae = a.symbol.toLowerCase().startsWith(q) ? 0 : 1;
        const be = b.symbol.toLowerCase().startsWith(q) ? 0 : 1;
        return ae - be || a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 7);
  }, [symbols, query]);

  const screenMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navItems.slice(0, 5);
    return navItems
      .filter(
        (n) => n.label.toLowerCase().includes(q) || n.group.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [navItems, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
      <div className="fixed inset-0 bg-slate-900/55" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (symbolMatches.length > 0 && query.trim().length > 0) {
                  onOpenValuation(symbolMatches[0].symbol);
                  onClose();
                } else if (screenMatches.length > 0) {
                  onNavigateTab(screenMatches[0].id);
                  onClose();
                }
              }
            }}
            placeholder="Jump to any NEPSE ticker (e.g. NABIL, EBL, SAHAS) or screen (e.g. Valuation, 10x, Screener)…"
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close jump palette"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {symbolMatches.length > 0 && (
            <div className="p-3 space-y-1.5">
              <div className="px-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Stocks — Jump directly to any workspace
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {symbolMatches.map((m) => {
                  const starred = hasSymbol(m.symbol);
                  return (
                    <div
                      key={m.symbol}
                      className="px-2 py-2 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-md"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => toggleSymbol(m.symbol)}
                          title="Star ticker"
                          className="p-0.5 text-slate-400 hover:text-amber-500 shrink-0"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              starred ? 'fill-amber-500 text-amber-500' : ''
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onOpenValuation(m.symbol);
                            onClose();
                          }}
                          className="text-left min-w-0 flex items-center gap-2"
                        >
                          <span className="font-mono font-bold text-xs text-blue-600 dark:text-blue-400 shrink-0">
                            {m.symbol}
                          </span>
                          <span className="text-xs text-slate-600 dark:text-slate-300 truncate">
                            {m.name}
                          </span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onOpenValuation(m.symbol);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                        >
                          <Scale className="w-3 h-3" />
                          <span>Valuation</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onInspectInScreener(m.symbol);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 whitespace-nowrap shrink-0"
                        >
                          <Award className="w-3 h-3" />
                          <span>Dossier</span>
                        </button>
                        {onOpenAnnualReports && (
                          <button
                            type="button"
                            onClick={() => {
                              onOpenAnnualReports(m.symbol);
                              onClose();
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 whitespace-nowrap shrink-0"
                          >
                            <FileText className="w-3 h-3" />
                            <span>Annual</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            onInspectSymbol(m.symbol);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          <CandlestickChart className="w-3 h-3" />
                          <span>Chart</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onInspectInAnalyzer(m.symbol);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          <Crosshair className="w-3 h-3" />
                          <span>Analyzer</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {screenMatches.length > 0 && (
            <div className="p-3 space-y-1.5">
              <div className="px-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Workspaces &amp; Views
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {screenMatches.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigateTab(item.id);
                      onClose();
                    }}
                    className="px-3 py-2 rounded-md text-left flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {item.label}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.group}
                      </div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {symbolMatches.length === 0 && screenMatches.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-500">
              No stocks or workspaces match “{query}”.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
