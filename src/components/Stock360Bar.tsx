import React from 'react';
import {
  Award,
  CandlestickChart,
  Crosshair,
  FileText,
  GitCompare,
  Scale,
  Star,
} from 'lucide-react';
import { useCompareList, useWatchlist } from '../hooks/useWatchlist';
import type { MasterScreenerRow } from '../types/fundamental';
import { buildPlainEnglishVerdict } from '../utils/plainEnglish';

export type Stock360Tab = 'valuation' | 'screener' | 'annual-reports' | 'explorer' | 'analyzer';

interface Stock360BarProps {
  symbol: string;
  activeView: Stock360Tab;
  row?: MasterScreenerRow;
  onSwitchView: (view: Stock360Tab, symbol: string) => void;
  onOpenCompareDrawer: () => void;
}

const TONE_TEXT: Record<'emerald' | 'blue' | 'amber' | 'red', string> = {
  emerald: 'text-emerald-700 dark:text-emerald-300',
  blue: 'text-blue-700 dark:text-blue-300',
  amber: 'text-amber-700 dark:text-amber-300',
  red: 'text-red-700 dark:text-red-300',
};

export const Stock360Bar: React.FC<Stock360BarProps> = ({
  symbol,
  activeView,
  row,
  onSwitchView,
  onOpenCompareDrawer,
}) => {
  const { hasSymbol, toggleSymbol } = useWatchlist();
  const { compareSymbols, hasCompare, toggleCompare } = useCompareList();

  const starred = hasSymbol(symbol);
  const compared = hasCompare(symbol);
  const verdict = row ? buildPlainEnglishVerdict(row) : null;

  const views: Array<{
    id: Stock360Tab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'valuation', label: 'Pricing & Valuation', icon: Scale },
    { id: 'screener', label: '9-Investor Dossier', icon: Award },
    { id: 'annual-reports', label: 'Annual Reports', icon: FileText },
    { id: 'explorer', label: 'Technical Chart', icon: CandlestickChart },
    { id: 'analyzer', label: 'ICT/SMC Analyzer', icon: Crosshair },
  ];

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
            {symbol}
          </span>
          {row && (
            <>
              <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                {row.companyName}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {row.ltp !== null ? `Rs ${row.ltp.toFixed(0)}` : '—'}
              </span>
              {row.changePct !== null && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    row.changePct > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : row.changePct < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-400'
                  }`}
                >
                  {row.changePct >= 0 ? '+' : ''}
                  {row.changePct.toFixed(1)}%
                </span>
              )}
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{row.sector}</span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex flex-wrap items-center gap-1 p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            {views.map((v) => {
              const Icon = v.icon;
              const isActive = activeView === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSwitchView(v.id, symbol)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{v.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => toggleSymbol(symbol)}
            title={starred ? 'Remove from Watchlist' : 'Add to Watchlist'}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              starred
                ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${starred ? 'fill-amber-500 text-amber-500' : ''}`} />
            <span>{starred ? 'Watchlisted' : 'Watchlist'}</span>
          </button>

          <button
            type="button"
            onClick={() => toggleCompare(symbol)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              compared
                ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>{compared ? 'In Compare' : '+ Compare'}</span>
          </button>

          {compareSymbols.length >= 2 && (
            <button
              type="button"
              onClick={onOpenCompareDrawer}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 whitespace-nowrap shrink-0"
            >
              Compare ({compareSymbols.length})
            </button>
          )}
        </div>
      </div>

      {verdict && row && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className={`font-semibold shrink-0 ${TONE_TEXT[verdict.tone]}`}>
              {verdict.actionCue}:
            </span>
            <span className="text-slate-700 dark:text-slate-300">{verdict.summary}</span>
          </div>
          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
            Master {row.masterScore.toFixed(0)} · Health{' '}
            {row.valuation.valuationHealthScore?.toFixed(0) ?? '—'} · MoS{' '}
            {row.valuation.marginOfSafetyPct !== null
              ? `${row.valuation.marginOfSafetyPct >= 0 ? '+' : ''}${row.valuation.marginOfSafetyPct.toFixed(1)}%`
              : '—'}{' '}
            · 10x {row.tenX.tenXScore.toFixed(0)}
          </div>
        </div>
      )}
    </div>
  );
};
