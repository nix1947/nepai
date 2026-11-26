import React from 'react';

export type PeriodMode =
  | 'last1'
  | 'yesterday'
  | 'last2'
  | 'last3'
  | 'last4'
  | 'last5'
  | 'last10'
  | 'custom'
  | 'weekly';

interface PeriodPickerProps {
  dates: string[];
  mode: PeriodMode;
  onModeChange: (m: PeriodMode) => void;
  customStart: string;
  customEnd: string;
  onCustomChange: (start: string, end: string) => void;
  allowWeekly?: boolean;
  includeShortWindows?: boolean;
}

export function resolvePeriodRange(
  dates: string[],
  mode: PeriodMode,
  customStart: string,
  customEnd: string
): { start: string; end: string } | null {
  if (dates.length === 0) return null;
  if (mode === 'yesterday') {
    const idx = Math.max(0, dates.length - 2);
    return { start: dates[idx], end: dates[idx] };
  }
  const fixedMap: Record<string, number> = {
    last1: 1,
    last2: 2,
    last3: 3,
    last4: 4,
    last5: 5,
    last10: 10,
  };
  if (mode in fixedMap) {
    const k = Math.min(fixedMap[mode], dates.length);
    return { start: dates[dates.length - k], end: dates[dates.length - 1] };
  }
  if (!customStart || !customEnd || customStart > customEnd) return null;
  return { start: customStart, end: customEnd };
}

export const PeriodPicker: React.FC<PeriodPickerProps> = ({
  dates,
  mode,
  onModeChange,
  customStart,
  customEnd,
  onCustomChange,
  allowWeekly = false,
  includeShortWindows = false,
}) => {
  const options: Array<{ id: PeriodMode; label: string }> = includeShortWindows
    ? [
        { id: 'last1', label: 'Last Day' },
        { id: 'yesterday', label: 'Yesterday' },
        { id: 'last2', label: 'Last 2 Days' },
        { id: 'last3', label: 'Last 3 Days' },
        { id: 'last4', label: 'Last 4 Days' },
        { id: 'last5', label: 'Last 5 Days' },
        { id: 'custom', label: 'Custom Range' },
      ]
    : [
        { id: 'last1', label: 'Last day' },
        { id: 'last2', label: 'Last 2 days' },
        { id: 'last5', label: 'Last 5 days' },
        { id: 'last10', label: 'Last 10 days' },
        { id: 'custom', label: 'Custom range' },
      ];
  if (allowWeekly) {
    options.push({ id: 'weekly', label: 'Weekly' });
  }

  const resolved = resolvePeriodRange(dates, mode, customStart, customEnd);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onModeChange(opt.id)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === opt.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {mode === 'custom' || mode === 'weekly' ? (
        <div className="flex items-center gap-2 text-xs">
          <input
            type="date"
            value={customStart}
            min={dates[0]}
            max={dates[dates.length - 1]}
            onChange={(e) => onCustomChange(e.target.value, customEnd)}
            className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 font-mono text-slate-800 dark:text-slate-200"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={customEnd}
            min={dates[0]}
            max={dates[dates.length - 1]}
            onChange={(e) => onCustomChange(customStart, e.target.value)}
            className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 font-mono text-slate-800 dark:text-slate-200"
          />
        </div>
      ) : (
        resolved && (
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {resolved.start === resolved.end
              ? resolved.end
              : `${resolved.start} → ${resolved.end}`}
          </span>
        )
      )}
    </div>
  );
};
