import React from 'react';
import {
  Award,
  CalendarClock,
  Database,
  FileText,
  Gem,
  LayoutGrid,
  Scale,
} from 'lucide-react';

export type FundamentalMenuId =
  | 'valuation'
  | 'screener'
  | 'gems'
  | 'monitor'
  | 'annual-reports'
  | 'strategic-outlook'
  | 'financials-vault';

interface FundamentalMenuBarProps {
  active: FundamentalMenuId;
  activeSymbol?: string | null;
  pendingQuarterCount?: number | null;
  onSelect: (target: FundamentalMenuId, symbol?: string | null) => void;
}

export const FundamentalMenuBar: React.FC<FundamentalMenuBarProps> = ({
  active,
  activeSymbol,
  pendingQuarterCount,
  onSelect,
}) => {
  const items: Array<{
    id: FundamentalMenuId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'valuation', label: 'Pricing & Valuation', icon: Scale },
    { id: 'screener', label: '9-Investor Screener', icon: Award },
    { id: 'gems', label: 'Hidden Gems & KB', icon: Gem },
    {
      id: 'monitor',
      label:
        pendingQuarterCount !== undefined && pendingQuarterCount !== null
          ? `Quarterly Monitor (${pendingQuarterCount})`
          : 'Quarterly Monitor',
      icon: CalendarClock,
    },
    { id: 'annual-reports', label: 'Annual Reports', icon: FileText },
    { id: 'strategic-outlook', label: 'Strategic Heat Map', icon: LayoutGrid },
    { id: 'financials-vault', label: 'Quarterly Financials Vault', icon: Database },
  ];

  return (
    <nav
      aria-label="Fundamentals navigation"
      className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
    >
      <div className="flex flex-wrap items-center gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id, activeSymbol)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {activeSymbol && (
        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap shrink-0">
          Active stock <span className="font-semibold text-slate-800 dark:text-slate-200">{activeSymbol}</span>
        </div>
      )}
    </nav>
  );
};
