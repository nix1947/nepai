import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ExternalLink,
  Globe,
  Landmark,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { StockRiskOpportunitiesPanel } from '../components/StockRiskOpportunitiesPanel';
import type {
  AppLanguage,
  MacroResearchResponse,
  ResearchPoint,
  SymbolInfo,
} from '../types/market';
import { biText } from '../utils/i18n';

interface MacroRisksViewProps {
  dates: string[];
  equityOnly: boolean;
  lang: AppLanguage;
  onInspectSymbol: (symbol: string) => void;
}

let clientMacroCache: MacroResearchResponse | null = null;

export const MacroRisksView: React.FC<MacroRisksViewProps> = ({
  dates,
  equityOnly,
  lang,
  onInspectSymbol,
}) => {
  const [macro, setMacro] = useState<MacroResearchResponse | null>(() => clientMacroCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('NABIL');
  const [symbolSearch, setSymbolSearch] = useState('');

  const showEn = lang === 'en' || lang === 'bi';
  const showNe = lang === 'ne' || lang === 'bi';

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

  const renderPoints = (
    items: ResearchPoint[],
    accent: 'emerald' | 'red'
  ) => (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
      {items.map((item, idx) => (
        <li key={idx} className="py-2.5 first:pt-0 last:pb-0 space-y-1 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {showEn ? item.title : item.titleNe}
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
          {lang === 'bi' && item.titleNe && (
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {item.titleNe}
            </div>
          )}
          {showEn && (
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{item.detail}</p>
          )}
          {showNe && item.detailNe && (
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">{item.detailNe}</p>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {biText(
              'Nepal & World Economy — Risks & Opportunities',
              'नेपाल र विश्व अर्थतन्त्र — जोखिम र अवसर',
              lang
            )}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {biText(
              'Live Google Search grounded macro intelligence connecting NRB policy, Nepal liquidity, global rates/oil/India markets, and individual NEPSE stocks',
              'नेपाल राष्ट्र बैंकको नीति, तरलता, विश्व ब्याजदर/इन्धन र नेपाली सेयर बजारबीचको प्रत्यक्ष गुगल सर्च विश्लेषण',
              lang
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadMacro(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>
            {loading
              ? biText('Searching live news…', 'ताजा समाचार खोजिँदैछ…', lang)
              : biText('Refresh Macro Search', 'ताजा आर्थिक खोज', lang)}
          </span>
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
            {/* Section 1: Nepal Economy & NEPSE */}
            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {biText(
                      'Nepal Economy & NEPSE Macro Backdrop',
                      'नेपालको अर्थतन्त्र र नेप्से परिदृश्य',
                      lang
                    )}
                  </h3>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  {new Date(macro.generatedAt).toLocaleString()}
                </span>
              </div>

              <div className="space-y-1.5">
                {showEn && macro.nepalSummaryEn && (
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {macro.nepalSummaryEn}
                  </p>
                )}
                {showNe && macro.nepalSummaryNe && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {macro.nepalSummaryNe}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <TrendingUp className="w-4 h-4" />
                    <span>{biText('Nepal Opportunities', 'नेपालका अवसरहरू', lang)}</span>
                  </div>
                  {renderPoints(macro.nepalOpportunities, 'emerald')}
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400">
                    <ShieldAlert className="w-4 h-4" />
                    <span>{biText('Nepal Risks', 'नेपालका जोखिमहरू', lang)}</span>
                  </div>
                  {renderPoints(macro.nepalRisks, 'red')}
                </div>
              </div>
            </section>

            {/* Section 2: World Economy & Global Spillovers */}
            <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {biText(
                    'World Economy & Global Market Spillovers',
                    'विश्व अर्थतन्त्र र अन्तर्राष्ट्रिय बजार प्रभाव',
                    lang
                  )}
                </h3>
              </div>

              <div className="space-y-1.5">
                {showEn && macro.worldSummaryEn && (
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {macro.worldSummaryEn}
                  </p>
                )}
                {showNe && macro.worldSummaryNe && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {macro.worldSummaryNe}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <TrendingUp className="w-4 h-4" />
                    <span>{biText('Global Tailwinds', 'विश्वव्यापी सकारात्मक संकेत', lang)}</span>
                  </div>
                  {renderPoints(macro.worldOpportunities, 'emerald')}
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400">
                    <ShieldAlert className="w-4 h-4" />
                    <span>{biText('Global Headwinds & Risks', 'विश्वव्यापी जोखिम र दबाब', lang)}</span>
                  </div>
                  {renderPoints(macro.worldRisks, 'red')}
                </div>
              </div>
            </section>

            {/* Section 3: NEPSE Sectors to Watch */}
            {macro.sectorsToWatch.length > 0 && (
              <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {biText('NEPSE Sectors to Watch', 'निगरानी गर्नुपर्ने नेप्से क्षेत्रहरू', lang)}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {macro.sectorsToWatch.map((sec, idx) => (
                    <div
                      key={idx}
                      className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-1.5 text-xs"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {showEn ? sec.sector : sec.sectorNe}
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
                      {lang === 'bi' && sec.sectorNe && (
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {sec.sectorNe}
                        </div>
                      )}
                      {showEn && (
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                          {sec.reason}
                        </p>
                      )}
                      {showNe && sec.reasonNe && (
                        <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                          {sec.reasonNe}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Verified Google Search Sources */}
            {macro.sources.length > 0 && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {biText('Google Search Grounded Sources', 'गुगल सर्च स्रोतहरू', lang)}
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
                      <span className="truncate">{src.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      ) : null}

      {/* Section 4: Company-Specific Risk & Opportunity Lookup */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {biText(
                'Stock-Specific Risk & Opportunity Lookup',
                'कम्पनी अनुसार जोखिम र अवसर खोजी',
                lang
              )}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {biText(
                'Pick any NEPSE security to inspect live company news, macro sensitivity, risks, and catalysts',
                'कुनै पनि नेप्से कम्पनीको ताजा समाचार, जोखिम र अवसर हेर्नुहोस्',
                lang
              )}
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
              <span>{biText('Open Chart', 'चार्ट खोल्नुहोस्', lang)}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <StockRiskOpportunitiesPanel
          symbol={selectedSymbol}
          companyName={symbols.find((s) => s.symbol === selectedSymbol)?.name}
          lang={lang}
          autoLoad={false}
        />
      </div>
    </div>
  );
};
