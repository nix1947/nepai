import React, { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { FinancialsVaultPanel } from '../components/FinancialsVaultPanel';
import {
  FundamentalMenuBar,
  type FundamentalMenuId,
} from '../components/FundamentalMenuBar';
import type { SymbolInfo } from '../types/market';

interface FinancialsVaultViewProps {
  allSymbols: SymbolInfo[];
  initialSymbol?: string | null;
  onSymbolChange?: (symbol: string) => void;
  onInspectChart: (symbol: string) => void;
  onSelectFundamentalMenu: (target: FundamentalMenuId, symbol?: string | null) => void;
}

export const FinancialsVaultView: React.FC<FinancialsVaultViewProps> = ({
  allSymbols,
  initialSymbol,
  onSymbolChange,
  onInspectChart,
  onSelectFundamentalMenu,
}) => {
  const [fallbackSymbols, setFallbackSymbols] = useState<string[]>([]);
  const [currentSymbol, setCurrentSymbol] = useState<string>(initialSymbol || 'NABIL');

  useEffect(() => {
    if (initialSymbol) {
      setCurrentSymbol(initialSymbol.toUpperCase());
    }
  }, [initialSymbol]);

  useEffect(() => {
    if (allSymbols.length > 0) return;
    fetch('/api/financials')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.items)) {
          setFallbackSymbols(data.items.map((item: { symbol: string }) => item.symbol));
        }
      })
      .catch(() => null);
  }, [allSymbols.length]);

  const availableSymbols =
    allSymbols.length > 0 ? allSymbols.map((s) => s.symbol) : fallbackSymbols;

  const handleSymbolChange = (sym: string) => {
    const clean = sym.toUpperCase();
    setCurrentSymbol(clean);
    onSymbolChange?.(clean);
  };

  return (
    <div className="space-y-4">
      <FundamentalMenuBar
        active="financials-vault"
        activeSymbol={currentSymbol}
        onSelect={onSelectFundamentalMenu}
      />

      <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Quarterly Financials Vault (Balance Sheet, P&amp;L &amp; Ratios)
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Inspect raw stored quarterly Balance Sheet, Profit &amp; Loss, Ratio Analysis, Key Ratios, and Key Metrics per symbol or pull fresh filings into the local vault.
          </p>
        </div>
      </section>

      <FinancialsVaultPanel
        availableSymbols={availableSymbols}
        selectedSymbolExternal={initialSymbol}
        onInspectChart={onInspectChart}
        onSymbolChange={handleSymbolChange}
      />
    </div>
  );
};
