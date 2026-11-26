import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Banknote,
  ExternalLink,
  FileCheck2,
  Globe,
  Landmark,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { StockRiskOpportunitiesPanel } from '../components/StockRiskOpportunitiesPanel';
import type {
  DataFreshnessStatus,
  MacroResearchResponse,
  ResearchPoint,
  SymbolInfo,
} from '../types/market';

interface MacroRisksViewProps {
  dates: string[];
  equityOnly: boolean;
  onInspectSymbol: (symbol: string) => void;
}

let clientMacroCache: MacroResearchResponse | null = null;

function statusClass(status?: DataFreshnessStatus): string {
  if (status === 'Live') {
    return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900';
  }
  if (status === 'Cached') {
    return 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900';
  }
  if (status === 'Historical') {
    return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';
  }
  return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700';
}

export const MacroRisksView: React.FC<MacroRisksViewProps> = ({
  dates,
  equityOnly,
  onInspectSymbol,
}) => {
  const [macro, setMacro] = useState<MacroResearchResponse | null>(() => clientMacroCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('NABIL');
  const [symbolSearch, setSymbolSearch] = useState('');

  const loadMacro = useCallback(async (force = false) => {
    if (!force && clientMacroCache) {
      setMacro(clientMacroCache);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/research/macro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      clientMacroCache = json;
      setMacro(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load macro research');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMacro(false);
  }, [loadMacro]);

  useEffect(() => {
    const latest = dates[dates.length - 1];
    if (!latest) return;
    fetch(`/api/symbols?day=${encodeURIComponent(latest)}&equityOnly=${equityOnly}`)
      .then((r) => r.json())
      .then((d) => {
        const list: SymbolInfo[] = d.symbols || [];
        setSymbols(list);
        if (list.length > 0 && !list.some((s) => s.symbol === selectedSymbol)) {
          setSelectedSymbol(list.find((s) => s.symbol === 'NABIL')?.symbol || list[0].symbol);
        }
      })
      .catch(() => null);
  }, [dates, equityOnly]);

  const filteredSymbols = useMemo(() => {
    const q = symbolSearch.trim().toLowerCase();
    if (!q) return symbols;
    return symbols.filter(
      (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [symbols, symbolSearch]);

  const renderPoints = (items: ResearchPoint[], accent: 'emerald' | 'red') => (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
      {items.map((item, idx) => (
        <li key={idx} className="py-2.5 first:pt-0 last:pb-0 space-y-1 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {item.title}
            </span>
            <span
              className={`font-mono text-[11px] shrink-0 ${
                accent === 'emerald'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {item.impact}
            </span>
          </div>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{item.detail}</p>
        </li>
      ))}
    </ul>
  );

  const fi = macro?.fixedIncomeBenchmarks;
  const ind = macro?.macroIndicators;
  const regs = macro?.regulatoryUpdates || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Nepal Macro, Fixed-Income Benchmarks &amp; Global Backdrop
            </h2>
            {macro?.dataStatus && (
              <span
                className={`px-2 py-0.5 text-[11px] font-medium rounded border ${statusClass(macro.dataStatus)}`}
              >
                {macro.dataStatus}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            NRB Treasury Bills, Government &amp; Development Bond yields, Commercial Bank FD rates,
            NRB/NIA/SEBON regulatory directives, and global macro spillovers
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadMacro(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Searching NRB & macro…' : 'Refresh Macro & Rates'}</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadMacro(true)}
            className="font-medium underline shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {macro?.notice && (
        <div className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200">
          {macro.notice}
        </div>
      )}

      {loading && !macro ? (
        <div className="space-y-4">
          <div className="h-44 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
          <div className="h-44 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
        </div>
      ) : macro ? (
        macro.rawFallback ? (
          <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
              {macro.rawFallback}
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            {/* Fixed-Income Benchmarks (Opportunity Cost Reference) */}
            {fi && (
              <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Nepal Fixed-Income Alternatives &amp; Rate Benchmarks
                    </h3>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-mono">
                    <span className="text-slate-500 dark:text-slate-400">
                      Trend:{' '}
                      <strong className="text-slate-900 dark:text-slate-100">{fi.rateTrend}</strong>
                    </span>
                    <span className="text-slate-400">As of: {fi.asOfDate}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs">
                  {[
                    { label: 'Bank Individual FD', val: fi.bankFdIndividualRate },
                    { label: 'Bank Institutional FD', val: fi.bankFdInstitutionalRate },
                    { label: '28-Day T-Bill', val: fi.tbill28d },
                    { label: '91-Day T-Bill', val: fi.tbill91d },
                    { label: '182-Day T-Bill', val: fi.tbill182d },
                    { label: '364-Day T-Bill', val: fi.tbill364d },
                    { label: 'Gov / Citizen Bond', val: fi.govBondYield },
                    { label: 'NRB Policy Rate', val: fi.nrbPolicyRate },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="border border-slate-200 dark:border-slate-800 rounded-md p-2.5 bg-slate-50/70 dark:bg-slate-950/60"
                    >
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.label}
                      </div>
                      <div
                        className={`mt-0.5 font-mono font-semibold text-xs break-words ${
                          item.val === 'Unavailable'
                            ? 'text-slate-400 italic'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {item.val}
                      </div>
                    </div>
                  ))}
                </div>

                {ind && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 pt-1 text-xs">
                    {[
                      { label: 'CD Ratio', val: ind.cdRatio },
                      { label: 'Banking Liquidity', val: ind.bankingLiquidity },
                      { label: 'CPI Inflation', val: ind.cpiInflation },
                      { label: 'FX Reserves', val: ind.fxReserves },
                      { label: 'Credit Growth', val: ind.creditGrowth },
                      { label: 'Remittance', val: ind.remittanceTrend },
                      { label: 'Fiscal CapEx', val: ind.fiscalCapex },
                    ].map((m) => (
                      <div
                        key={m.label}
                        className="border border-slate-100 dark:border-slate-800/80 rounded p-2"
                      >
                        <div className="text-[10px] uppercase tracking-wide text-slate-400">
                          {m.label}
                        </div>
                        <div className="font-mono text-[11px] font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                          {m.val}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {fi.sourceNote && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{fi.sourceNote}</p>
                )}
              </section>
            )}

            {/* Regulatory Updates */}
            {regs.length > 0 && (
              <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <FileCheck2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    NRB, NIA, SEBON, NEPSE &amp; Government Regulatory Directives
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {regs.map((reg, idx) => (
                    <div
                      key={idx}
                      className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">
                          {reg.authority} · {reg.date}
                        </span>
                        <span
                          className={`font-mono text-[11px] font-semibold ${
                            reg.impact === 'Positive'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : reg.impact === 'Negative'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {reg.impact}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {reg.title}
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                        {reg.summary}
                      </p>
                      {reg.impactedSectors.length > 0 && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Sectors: {reg.impactedSectors.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Nepal Economy &amp; NEPSE Macro Backdrop
                  </h3>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  Retrieved: {new Date(macro.retrievedAt || macro.generatedAt).toLocaleString()}
                </span>
              </div>

              {macro.nepalSummary && (
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {macro.nepalSummary}
                </p>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <TrendingUp className="w-4 h-4" />
                    <span>Nepal Opportunities</span>
                  </div>
                  {renderPoints(macro.nepalOpportunities, 'emerald')}
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Nepal Risks</span>
                  </div>
                  {renderPoints(macro.nepalRisks, 'red')}
                </div>
              </div>
            </section>

            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  World Economy &amp; Global Market Spillovers
                </h3>
              </div>

              {macro.worldSummary && (
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {macro.worldSummary}
                </p>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <TrendingUp className="w-4 h-4" />
                    <span>Global Tailwinds</span>
                  </div>
                  {renderPoints(macro.worldOpportunities, 'emerald')}
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Global Headwinds &amp; Risks</span>
                  </div>
                  {renderPoints(macro.worldRisks, 'red')}
                </div>
              </div>
            </section>

            {macro.sectorsToWatch.length > 0 && (
              <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  NEPSE Sectors to Watch
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {macro.sectorsToWatch.map((sec, idx) => (
                    <div
                      key={idx}
                      className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-1.5 text-xs"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {sec.sector}
                        </span>
                        <span
                          className={`font-mono text-[11px] font-semibold shrink-0 ${
                            sec.stance === 'Positive'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : sec.stance === 'Cautious'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {sec.stance}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                        {sec.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {macro.sources.length > 0 && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Google Search Grounded Sources
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {macro.sources.slice(0, 10).map((src, idx) => (
                    <a
                      key={idx}
                      href={src.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline max-w-xs truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      {src.category && (
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">
                          [{src.category}]
                        </span>
                      )}
                      <span className="truncate">{src.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      ) : null}

      <div className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Stock-Specific Fundamental, Macro &amp; Fixed-Income Opportunity Lookup
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pick any NEPSE security to search quarterly/annual disclosures, benchmark vs FD/Gov
              Bonds, and evaluate 9-part fundamental risks &amp; opportunities
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={symbolSearch}
                onChange={(e) => {
                  const val = e.target.value;
                  setSymbolSearch(val);
                  const q = val.trim().toLowerCase();
                  if (q) {
                    const hit =
                      symbols.find((s) => s.symbol.toLowerCase() === q) ||
                      symbols.find(
                        (s) =>
                          s.symbol.toLowerCase().startsWith(q) ||
                          s.name.toLowerCase().includes(q)
                      );
                    if (hit) setSelectedSymbol(hit.symbol);
                  }
                }}
                placeholder="Find ticker…"
                className="pl-8 pr-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 w-36"
              />
            </div>

            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 max-w-xs"
            >
              {filteredSymbols.length > 0 ? (
                filteredSymbols.map((s) => (
                  <option key={s.symbol} value={s.symbol}>
                    {s.symbol} — {s.name}
                  </option>
                ))
              ) : (
                <option value={selectedSymbol}>{selectedSymbol}</option>
              )}
            </select>

            <button
              type="button"
              onClick={() => onInspectSymbol(selectedSymbol)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              <span>Open Chart</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <StockRiskOpportunitiesPanel
          symbol={selectedSymbol}
          companyName={symbols.find((s) => s.symbol === selectedSymbol)?.name}
          autoLoad={false}
        />
      </div>
    </div>
  );
};
