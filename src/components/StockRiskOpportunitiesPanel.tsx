import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Globe, RefreshCw, ShieldAlert, TrendingUp } from 'lucide-react';
import type { StockResearchResponse } from '../types/market';

interface StockRiskOpportunitiesPanelProps {
  symbol: string;
  companyName?: string;
  autoLoad?: boolean;
}

const clientStockCache = new Map<string, StockResearchResponse>();

export const StockRiskOpportunitiesPanel: React.FC<StockRiskOpportunitiesPanelProps> = ({
  symbol,
  companyName,
  autoLoad = true,
}) => {
  const [data, setData] = useState<StockResearchResponse | null>(
    () => (symbol ? clientStockCache.get(symbol) ?? null : null)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResearch = useCallback(
    async (force = false) => {
      if (!symbol) return;
      if (!force && clientStockCache.has(symbol)) {
        setData(clientStockCache.get(symbol)!);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/research/stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, force }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `Request failed (${res.status})`);
        }
        clientStockCache.set(symbol, json);
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load live Google Search research');
      } finally {
        setLoading(false);
      }
    },
    [symbol]
  );

  useEffect(() => {
    if (!symbol) return;
    const cached = clientStockCache.get(symbol);
    if (cached) {
      setData(cached);
      setError(null);
      return;
    }
    setData(null);
    if (!autoLoad) return;
    const timer = setTimeout(() => {
      void fetchResearch(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [symbol, autoLoad, fetchResearch]);

  if (!symbol) return null;

  const stanceColor =
    data?.stance === 'Bullish'
      ? 'text-emerald-600 dark:text-emerald-400'
      : data?.stance === 'Cautious'
        ? 'text-red-600 dark:text-red-400'
        : 'text-amber-600 dark:text-amber-400';

  return (
    <section className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {symbol} Live Risks &amp; Opportunities (Google Search Grounded)
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {companyName || data?.companyName || symbol}
            {data && (
              <>
                {' · '}
                <span className={`font-semibold ${stanceColor}`}>{data.stance} outlook</span>
                {' · '}
                <span className="font-mono tabular-nums">
                  {new Date(data.generatedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchResearch(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Searching web…' : 'Refresh Live Search'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void fetchResearch(true)}
            className="underline font-medium shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-3">
          <div className="h-14 animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-36 animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
            <div className="h-36 animate-pulse bg-slate-100 dark:bg-slate-800 rounded" />
          </div>
        </div>
      ) : !data && !error ? (
        <div className="text-xs text-slate-500 py-4 flex items-center justify-between">
          <span>
            Run live Google Search research for {symbol} earnings, dividends, sector risks, and
            opportunities.
          </span>
          <button
            type="button"
            onClick={() => void fetchResearch(false)}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700"
          >
            Analyze {symbol}
          </button>
        </div>
      ) : data ? (
        <div className="space-y-5">
          {data.rawFallback ? (
            <div className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
              {data.rawFallback}
            </div>
          ) : (
            <>
              {data.summary && (
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {data.summary}
                </p>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <TrendingUp className="w-4 h-4" />
                    <span>Opportunities &amp; Tailwinds</span>
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.opportunities.map((item, idx) => (
                      <li key={idx} className="py-2.5 first:pt-0 last:pb-0 space-y-1 text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {item.title}
                          </span>
                          <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
                            {item.impact}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                          {item.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Key Risks &amp; Headwinds</span>
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.risks.map((item, idx) => (
                      <li key={idx} className="py-2.5 first:pt-0 last:pb-0 space-y-1 text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {item.title}
                          </span>
                          <span className="font-mono text-[11px] text-red-600 dark:text-red-400 shrink-0">
                            {item.impact}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                          {item.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
                {data.macroLinkage && (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-1.5 bg-slate-50 dark:bg-slate-950">
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200">
                      Nepal &amp; World Economy Sensitivity
                    </h4>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                      {data.macroLinkage}
                    </p>
                  </div>
                )}

                {data.catalysts.length > 0 && (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2">
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200">
                      Recent News &amp; Upcoming Catalysts
                    </h4>
                    <ul className="space-y-1.5">
                      {data.catalysts.map((c, idx) => (
                        <li key={idx} className="flex items-start justify-between gap-3">
                          <span className="text-slate-700 dark:text-slate-200">{c.headline}</span>
                          <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400 shrink-0">
                            {c.timeframe}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}

          {data.sources.length > 0 && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Google Search Grounded Sources
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {data.sources.slice(0, 8).map((src, i) => (
                  <a
                    key={i}
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
      ) : null}
    </section>
  );
};
