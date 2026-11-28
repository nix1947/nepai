import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Search,
} from 'lucide-react';
import { InfoTip } from './InfoTip';

export interface FinancialTableRow {
  section: string;
  isSectionHeader: boolean;
  particulars: string;
  values: string[];
  numericValues: Array<number | null>;
}

export interface FinancialReportTab {
  key: string;
  title: string;
  headers: string[];
  rows: FinancialTableRow[];
}

export interface CompanyFinancialSnapshot {
  symbol: string;
  companyName: string;
  sector: string;
  companyId: string;
  scrapedAt: string;
  sourceUrl: string;
  periods: string[];
  tabs: FinancialReportTab[];
}

export interface SavedFinancialIndexItem {
  symbol: string;
  companyName: string;
  sector: string;
  scrapedAt: string;
  periods: string[];
  tabTitles: string[];
  jsonFile: string;
  csvFile: string;
}

interface FinancialsVaultPanelProps {
  availableSymbols: string[];
  selectedSymbolExternal?: string | null;
  onInspectChart?: (symbol: string) => void;
  onSymbolChange?: (symbol: string) => void;
}

export const FinancialsVaultPanel: React.FC<FinancialsVaultPanelProps> = ({
  availableSymbols,
  selectedSymbolExternal,
  onInspectChart,
  onSymbolChange,
}) => {
  const [savedIndex, setSavedIndex] = useState<SavedFinancialIndexItem[]>([]);
  const [symbolInput, setSymbolInput] = useState<string>(selectedSymbolExternal?.toUpperCase() || 'NABIL');
  const [activeSymbol, setActiveSymbol] = useState<string>(selectedSymbolExternal?.toUpperCase() || 'NABIL');
  const [snapshot, setSnapshot] = useState<CompanyFinancialSnapshot | null>(null);
  const [activeTabKey, setActiveTabKey] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [scraping, setScraping] = useState<boolean>(false);
  const [batchScraping, setBatchScraping] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadSavedIndex = useCallback(async () => {
    try {
      const res = await fetch('/api/financials');
      if (!res.ok) return;
      const json = await res.json();
      setSavedIndex(Array.isArray(json.items) ? json.items : []);
    } catch {
      // ignore
    }
  }, []);

  const loadOrScrapeSymbol = useCallback(
    async (sym: string, forceScrape = false) => {
      const clean = sym.trim().toUpperCase();
      if (!clean) return;
      setActiveSymbol(clean);
      setSymbolInput(clean);
      setStatusMsg(null);
      onSymbolChange?.(clean);

      if (!forceScrape) {
        setLoading(true);
        try {
          const res = await fetch(`/api/financials/${encodeURIComponent(clean)}`);
          if (res.ok) {
            const data = (await res.json()) as CompanyFinancialSnapshot;
            setSnapshot(data);
            setActiveTabKey(data.tabs[0]?.key ?? '');
            setLoading(false);
            return;
          }
        } catch {
          // fall through to fetch option
        }
        setLoading(false);
      }

      // Live fetch and save to data/financial/<SYMBOL>.json + .csv
      setScraping(true);
      try {
        const res = await fetch(`/api/financials/${encodeURIComponent(clean)}/scrape`, {
          method: 'POST',
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        const snap = data as CompanyFinancialSnapshot & { skipped?: boolean };
        setSnapshot(snap);
        setActiveTabKey(snap.tabs[0]?.key ?? '');
        setStatusMsg({
          kind: 'ok',
          text: snap.skipped
            ? `${snap.symbol} already has current quarter data — skipped fetching.`
            : `Fetched ${snap.symbol} (${snap.tabs.length} tabs) and saved to data/financial/${snap.symbol}.json & .csv`,
        });
        await loadSavedIndex();
      } catch (err) {
        setStatusMsg({
          kind: 'err',
          text: err instanceof Error ? err.message : `Failed to fetch ${clean}`,
        });
      } finally {
        setScraping(false);
      }
    },
    [loadSavedIndex, onSymbolChange]
  );

  useEffect(() => {
    void loadSavedIndex();
  }, [loadSavedIndex]);

  useEffect(() => {
    if (selectedSymbolExternal) {
      void loadOrScrapeSymbol(selectedSymbolExternal, false);
    }
  }, [selectedSymbolExternal, loadOrScrapeSymbol]);

  useEffect(() => {
    if (selectedSymbolExternal) return;
    // Load initial cached NABIL if present, without forcing scrape on page load
    fetch('/api/financials/NABIL')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CompanyFinancialSnapshot | null) => {
        if (d) {
          setSnapshot(d);
          setActiveTabKey(d.tabs[0]?.key ?? '');
        }
      })
      .catch(() => null);
  }, [selectedSymbolExternal]);

  const handleBatchScrapeTop10 = async () => {
    setBatchScraping(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/financials/scrape-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setSavedIndex(Array.isArray(json.items) ? json.items : []);
      const skippedCount = Array.isArray(json.skipped) ? json.skipped.length : 0;
      setStatusMsg({
        kind: 'ok',
        text: `Saved quarterly statements for ${json.succeeded?.length ?? 0}/${json.total ?? 0} stocks (${skippedCount} skipped as already populated).`,
      });
      if (!snapshot && json.succeeded?.length > 0) {
        await loadOrScrapeSymbol(json.succeeded[0], false);
      }
    } catch (err) {
      setStatusMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Batch fetch failed',
      });
    } finally {
      setBatchScraping(false);
    }
  };

  const activeTab = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.tabs.find((t) => t.key === activeTabKey) ?? snapshot.tabs[0] ?? null;
  }, [snapshot, activeTabKey]);

  const handleDownloadJson = () => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${snapshot.symbol}_quarterly_financials.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Quarterly Financials Vault (<code className="font-mono text-xs">data/financial/</code>)
            </h3>
            <InfoTip
              title="Live Quarterly Fundamentals Fetcher"
              body="Pulls Balance Sheet, Profit & Loss Account, Ratio Analysis, Key Ratios, Key Metrics, and Others from company quarterly reports and saves both JSON and CSV files per symbol inside data/financial/."
            />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
            Saved companies: {savedIndex.length} · Format: JSON + CSV per symbol
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              list="financial-symbol-list"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void loadOrScrapeSymbol(symbolInput, false);
              }}
              placeholder="Symbol (e.g. NABIL)"
              className="w-36 pl-8 pr-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-xs uppercase"
            />
            <datalist id="financial-symbol-list">
              {availableSymbols.slice(0, 250).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <button
            type="button"
            disabled={scraping || loading}
            onClick={() => void loadOrScrapeSymbol(symbolInput, true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scraping ? 'animate-spin' : ''}`} />
            <span>{scraping ? `Fetching ${activeSymbol}…` : 'Fetch Symbol'}</span>
          </button>

          <button
            type="button"
            disabled={batchScraping}
            onClick={handleBatchScrapeTop10}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium disabled:opacity-50 cursor-pointer"
          >
            <FileSpreadsheet className={`w-3.5 h-3.5 ${batchScraping ? 'animate-spin' : ''}`} />
            <span>{batchScraping ? 'Fetching Top 10…' : 'Fetch Top 10 Leaders'}</span>
          </button>
        </div>
      </div>

      {savedIndex.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-500 dark:text-slate-400 mr-1">Saved:</span>
          {savedIndex.map((item) => (
            <button
              key={item.symbol}
              type="button"
              onClick={() => void loadOrScrapeSymbol(item.symbol, false)}
              className={`px-2 py-0.5 rounded border font-mono transition-colors cursor-pointer ${
                snapshot?.symbol === item.symbol
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {item.symbol}
            </button>
          ))}
        </div>
      )}

      {statusMsg && (
        <div
          className={`px-3 py-2 rounded text-xs ${
            statusMsg.kind === 'err'
              ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
              : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {loading ? (
        <div className="h-36 animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
      ) : snapshot ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                {snapshot.symbol}
              </span>
              <span className="text-slate-600 dark:text-slate-300">{snapshot.companyName}</span>
              <span className="text-[11px] font-mono text-slate-500">
                · {snapshot.sector} · Fetched {snapshot.scrapedAt.slice(0, 10)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onInspectChart && (
                <button
                  type="button"
                  onClick={() => onInspectChart(snapshot.symbol)}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
                >
                  Open Chart
                </button>
              )}
              <a
                href={`/api/financials/${encodeURIComponent(snapshot.symbol)}?format=csv`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>CSV</span>
              </a>
              <button
                type="button"
                onClick={handleDownloadJson}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>JSON</span>
              </button>
            </div>
          </div>

          {/* Report Tabs (BALANCE SHEET, PROFIT & LOSS ACCOUNT, RATIO ANALYSIS, KEY RATIOS, OTHERS) */}
          <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
            {snapshot.tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTabKey(tab.key)}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab?.key === tab.key
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.title}
              </button>
            ))}
          </div>

          {activeTab && (
            <div className="overflow-x-auto max-h-80 overflow-y-auto rounded border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-900 text-white">
                  <tr>
                    {activeTab.headers.map((h, i) => (
                      <th
                        key={i}
                        className={`py-2 px-3 font-medium ${i === 0 ? 'text-left' : 'text-right font-mono'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activeTab.rows.map((r, idx) =>
                    r.isSectionHeader ? (
                      <tr key={idx} className="bg-slate-50 dark:bg-slate-800/60">
                        <td
                          colSpan={Math.max(2, activeTab.headers.length)}
                          className="py-1.5 px-3 font-semibold text-slate-800 dark:text-slate-200"
                        >
                          {r.particulars}
                        </td>
                      </tr>
                    ) : (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-1.5 px-3 text-slate-700 dark:text-slate-300">
                          {r.particulars}
                        </td>
                        {r.values.map((val, vi) => (
                          <td
                            key={vi}
                            className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100"
                          >
                            {val || '—'}
                          </td>
                        ))}
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded">
          Enter any NEPSE symbol (e.g. <strong>NABIL</strong>, <strong>NLIC</strong>, <strong>SHIVM</strong>) and click{' '}
          <strong>Fetch Symbol</strong> or click <strong>Fetch Top 10 Leaders</strong> to pull Quarterly Reports into{' '}
          <code className="font-mono">data/financial/</code>.
        </div>
      )}
    </div>
  );
};
