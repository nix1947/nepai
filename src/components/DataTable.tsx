import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Search, Star } from 'lucide-react';

export interface ColumnDef<T> {
  key: keyof T | string;
  label: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  sortValue?: (row: T) => number | string | null | undefined;
  csvValue?: (row: T) => number | string | null | undefined;
  render: (row: T) => React.ReactNode;
  widthClass?: string;
}

export function createWatchlistColumn<T>(opts: {
  getSymbol: (row: T) => string;
  hasSymbol: (symbol: string) => boolean;
  toggleSymbol: (symbol: string) => void;
}): ColumnDef<T> {
  return {
    key: '_star',
    label: '',
    align: 'left',
    sortable: false,
    widthClass: 'w-8',
    render: (row) => {
      const sym = opts.getSymbol(row);
      const starred = opts.hasSymbol(sym);
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            opts.toggleSymbol(sym);
          }}
          aria-label={starred ? `Remove ${sym} from watchlist` : `Add ${sym} to watchlist`}
          className="p-0.5 text-slate-400 hover:text-amber-500 transition-colors"
        >
          <Star className={`w-3.5 h-3.5 ${starred ? 'fill-amber-500 text-amber-500' : ''}`} />
        </button>
      );
    },
  };
}

interface DataTableProps<T> {
  rows: T[];
  columns: ColumnDef<T>[];
  rowKey: (row: T, index: number) => string;
  selectedKey?: string | null;
  onRowClick?: (row: T) => void;
  searchKeys?: Array<keyof T>;
  searchPlaceholder?: string;
  emptyMessage?: string;
  maxHeightClass?: string;
  exportFilename?: string;
  watchlistFilter?: {
    watchlist: string[];
    getSymbol: (row: T) => string;
  };
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selectedKey,
  onRowClick,
  searchKeys,
  searchPlaceholder = 'Filter symbol or name…',
  emptyMessage = 'No matching records.',
  maxHeightClass = 'max-h-[520px]',
  exportFilename,
  watchlistFilter,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [onlyWatchlist, setOnlyWatchlist] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const watchlistSet = useMemo(
    () => new Set((watchlistFilter?.watchlist || []).map((s) => s.toUpperCase())),
    [watchlistFilter?.watchlist]
  );

  const filtered = useMemo(() => {
    let base = rows;
    if (onlyWatchlist && watchlistFilter) {
      base = base.filter((row) =>
        watchlistSet.has(watchlistFilter.getSymbol(row).toUpperCase())
      );
    }
    const q = query.trim().toLowerCase();
    if (!q || !searchKeys || searchKeys.length === 0) return base;
    return base.filter((row) =>
      searchKeys.some((k) => {
        const val = row[k];
        return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
      })
    );
  }, [rows, query, searchKeys, onlyWatchlist, watchlistFilter, watchlistSet]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => String(c.key) === sortKey);
    if (!col) return filtered;

    return [...filtered].sort((a, b) => {
      const av = col.sortValue
        ? col.sortValue(a)
        : (a as Record<string, unknown>)[sortKey];
      const bv = col.sortValue
        ? col.sortValue(b)
        : (b as Record<string, unknown>)[sortKey];

      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;

      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const sa = String(av);
      const sb = String(bv);
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [filtered, sortKey, sortDir, columns]);

  const toggleSort = (col: ColumnDef<T>) => {
    if (col.sortable === false) return;
    const key = String(col.key);
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(col.align === 'left' ? 'asc' : 'desc');
    }
  };

  const handleExportCsv = () => {
    if (!exportFilename || sorted.length === 0) return;
    const exportCols = columns.filter((c) => c.key !== '_star');
    const header = exportCols.map((c) => escapeCsvCell(c.label)).join(',');
    const body = sorted
      .map((row) =>
        exportCols
          .map((c) => {
            const raw = c.csvValue
              ? c.csvValue(row)
              : c.sortValue
                ? c.sortValue(row)
                : (row as Record<string, unknown>)[String(c.key)];
            return escapeCsvCell(raw);
          })
          .join(',')
      )
      .join('\n');

    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFilename.endsWith('.csv') ? exportFilename : `${exportFilename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const showToolbar =
    (searchKeys && searchKeys.length > 0) || Boolean(exportFilename) || Boolean(watchlistFilter);

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
      {showToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[200px]">
            {searchKeys && searchKeys.length > 0 && (
              <div className="relative flex-1 max-w-xs min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
            )}

            {watchlistFilter && (
              <button
                type="button"
                onClick={() => setOnlyWatchlist((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                  onlyWatchlist
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Star className={`w-3 h-3 ${onlyWatchlist ? 'fill-amber-500 text-amber-500' : ''}`} />
                <span>Watchlist ({watchlistFilter.watchlist.length})</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {sorted.length} {sorted.length === 1 ? 'row' : 'rows'}
            </span>
            {exportFilename && sorted.length > 0 && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <Download className="w-3 h-3" />
                <span>CSV</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`overflow-auto ${maxHeightClass}`}>
        <table className="w-full text-left border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
            <tr>
              {columns.map((col) => {
                const key = String(col.key);
                const isSorted = sortKey === key;
                const alignRight = col.align === 'right';
                return (
                  <th
                    key={key}
                    onClick={() => toggleSort(col)}
                    className={`px-3 py-2.5 font-medium text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap select-none ${
                      alignRight ? 'text-right' : 'text-left'
                    } ${col.sortable !== false ? 'cursor-pointer hover:text-slate-900 dark:hover:text-slate-200' : ''} ${col.widthClass ?? ''}`}
                  >
                    <span className={`inline-flex items-center gap-1 ${alignRight ? 'flex-row-reverse' : ''}`}>
                      <span>{col.label}</span>
                      {isSorted &&
                        (sortDir === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row, idx) => {
                const k = rowKey(row, idx);
                const isSelected = selectedKey !== undefined && selectedKey !== null && selectedKey === k;
                return (
                  <tr
                    key={k}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`transition-colors ${
                      onRowClick ? 'cursor-pointer' : ''
                    } ${
                      isSelected
                        ? 'bg-blue-50/80 dark:bg-blue-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    {columns.map((col) => {
                      const alignRight = col.align === 'right';
                      return (
                        <td
                          key={String(col.key)}
                          className={`px-3 py-2 whitespace-nowrap ${
                            alignRight ? 'text-right font-mono tabular-nums' : 'text-left'
                          }`}
                        >
                          {col.render(row)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
