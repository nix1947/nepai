import React, { useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { createWatchlistColumn, DataTable, type ColumnDef } from '../DataTable';
import { QuantHelpTip } from '../QuantHelpTip';
import { useWatchlist } from '../../hooks/useWatchlist';
import type {
  LearningMode,
  QuantEngineResponse,
  QuantStockCandidate,
} from '../../types/quant';
import { formatCrore, formatNum, formatPct } from '../../utils/format';

interface QuantWatchlistsAndRsTabProps {
  data: QuantEngineResponse;
  learningMode: LearningMode;
  onOpenGlossaryTerm: (id: string) => void;
  onSelectCandidate: (symbol: string) => void;
  onOpenSizingTab?: (symbol: string) => void;
}

type WatchlistSection =
  | 'top'
  | 'starred'
  | 'breakout'
  | 'vcp'
  | 'pullback'
  | 'rs'
  | 'accumulation'
  | 'distribution';

export const QuantWatchlistsAndRsTab: React.FC<QuantWatchlistsAndRsTabProps> = ({
  data,
  learningMode,
  onOpenGlossaryTerm,
  onSelectCandidate,
  onOpenSizingTab,
}) => {
  const [section, setSection] = useState<WatchlistSection>('top');
  const { watchlist, hasSymbol, toggleSymbol } = useWatchlist();

  const starredCandidates = useMemo(() => {
    if (watchlist.length === 0) return [];
    const set = new Set(watchlist.map((s) => s.toUpperCase()));
    return [...data.candidates, ...data.excludedStocks].filter((c) =>
      set.has(c.symbol.toUpperCase())
    );
  }, [watchlist, data.candidates, data.excludedStocks]);

  const starredHealthSummary = useMemo(() => {
    let buy = 0;
    let wait = 0;
    let holdWatch = 0;
    let riskReject = 0;
    for (const c of starredCandidates) {
      if (c.classification === 'STRONG BUY CANDIDATE' || c.classification === 'BUY CANDIDATE') {
        buy++;
      } else if (c.classification === 'WAIT FOR CONFIRMATION') {
        wait++;
      } else if (c.classification === 'HOLD' || c.classification === 'WATCHLIST') {
        holdWatch++;
      } else {
        riskReject++;
      }
    }
    return { buy, wait, holdWatch, riskReject };
  }, [starredCandidates]);

  const activeRows = useMemo((): QuantStockCandidate[] => {
    switch (section) {
      case 'top':
        return data.topOpportunities;
      case 'starred':
        return starredCandidates;
      case 'breakout':
        return data.breakoutWatchlist;
      case 'vcp':
        return data.vcpWatchlist;
      case 'pullback':
        return data.pullbackWatchlist;
      case 'rs':
        return data.relativeStrengthLeaders;
      case 'accumulation':
        return data.accumulationLeaders;
      case 'distribution':
        return data.distributionWarnings;
    }
  }, [section, data, starredCandidates]);

  const sectionMeta: Record<
    WatchlistSection,
    { label: string; helpTerm: string; description: string }
  > = {
    top: {
      label: `Top Statistical (${data.topOpportunities.length})`,
      helpTerm: 'expectancy',
      description:
        'Highest-ranked BUY CANDIDATE and WAIT FOR CONFIRMATION setups filtered by statistical expectancy, liquidity, and regime.',
    },
    starred: {
      label: `My Starred Audit (${starredCandidates.length})`,
      helpTerm: 'position-sizing',
      description:
        'Cross-checks every NEPSE ticker you starred across the workbench against live Quant Decision Gates, expectancy, and risk flags.',
    },
    breakout: {
      label: `Breakout Watchlist (${data.breakoutWatchlist.length})`,
      helpTerm: 'breakout',
      description:
        'Stocks breaking above 20-day resistance or forming right below the pivot ceiling on rising relative volume.',
    },
    vcp: {
      label: `VCP Watchlist (${data.vcpWatchlist.length})`,
      helpTerm: 'vcp',
      description:
        'Volatility Contraction Pattern bases tightening range with shrinking dry-up volume above constructive trend averages.',
    },
    pullback: {
      label: `Trend Pullbacks (${data.pullbackWatchlist.length})`,
      helpTerm: 'pullback',
      description:
        'Uptrending stocks pulling back gently toward rising SMA20/SMA50 support with reduced selling pressure.',
    },
    rs: {
      label: `RS Leaders (${data.relativeStrengthLeaders.length})`,
      helpTerm: 'relative-strength',
      description:
        'Top Relative Strength leaders outperforming the broader NEPSE proxy across 20-day returns.',
    },
    accumulation: {
      label: `Accumulation (${data.accumulationLeaders.length})`,
      helpTerm: 'accumulation',
      description:
        'Quiet institutional/steady buying where Up-Day Volume exceeds Down-Day Volume (ratio >= 1.35x).',
    },
    distribution: {
      label: `Distribution Warnings (${data.distributionWarnings.length})`,
      helpTerm: 'distribution',
      description:
        'Caution list where Down-Day Volume dominates Up-Day Volume (ratio <= 0.78x) — avoid chasing or tighten risk.',
    },
  };

  const columns: ColumnDef<QuantStockCandidate>[] = useMemo(
    () => [
      createWatchlistColumn<QuantStockCandidate>({
        getSymbol: (c) => c.symbol,
        hasSymbol,
        toggleSymbol,
      }),
      {
        key: 'symbol',
        label: 'Symbol',
        align: 'left',
        render: (c) => (
          <div>
            <span className="font-semibold text-blue-600 dark:text-blue-400">{c.symbol}</span>
            <span className="block text-[10px] text-slate-400">{c.sector}</span>
          </div>
        ),
      },
      {
        key: 'classification',
        label: 'Decision Gate',
        align: 'left',
        render: (c) => (
          <span
            className={`text-xs font-semibold whitespace-nowrap ${
              c.classification.includes('BUY')
                ? 'text-emerald-600 dark:text-emerald-400'
                : c.classification === 'WAIT FOR CONFIRMATION'
                  ? 'text-amber-600 dark:text-amber-400'
                  : c.classification === 'SELL' || c.classification === 'REJECT'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            {c.classification}
          </span>
        ),
      },
      {
        key: 'technicalScore',
        label: 'Tech Score',
        align: 'right',
        render: (c) => <span className="font-mono font-semibold">{c.technicalScore.toFixed(1)}</span>,
      },
      {
        key: 'setupStatus',
        label: 'Setup / Status',
        align: 'left',
        sortValue: (c) => `${c.setupType}-${c.entryPlan.setupStatus}`,
        render: (c) => (
          <span className="text-xs font-mono">
            {c.setupType === 'None' ? '–' : `${c.setupType} (${c.entryPlan.setupStatus})`}
          </span>
        ),
      },
      {
        key: 'close',
        label: 'Close',
        align: 'right',
        sortValue: (c) => c.indicators.close,
        render: (c) => formatNum(c.indicators.close),
      },
      {
        key: 'rsPercentile',
        label: 'RS %ile',
        align: 'right',
        sortValue: (c) => c.indicators.rsPercentile,
        render: (c) => `${c.indicators.rsPercentile.toFixed(0)}`,
      },
      {
        key: 'rsExcess',
        label: '20d vs NEPSE',
        align: 'right',
        sortValue: (c) => c.indicators.rsVsNepse20dPct ?? -999,
        render: (c) =>
          c.indicators.rsVsNepse20dPct !== null ? (
            <span className={c.indicators.rsVsNepse20dPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {formatPct(c.indicators.rsVsNepse20dPct)}
            </span>
          ) : (
            '–'
          ),
      },
      {
        key: 'rvol',
        label: 'RVOL',
        align: 'right',
        sortValue: (c) => c.indicators.relativeVolume,
        render: (c) => `${c.indicators.relativeVolume.toFixed(2)}x`,
      },
      {
        key: 'upDn',
        label: 'Up/Dn Vol',
        align: 'right',
        sortValue: (c) => c.indicators.upDownVolRatio20,
        render: (c) => `${c.indicators.upDownVolRatio20.toFixed(2)}x`,
      },
      {
        key: 'vcp',
        label: 'VCP Dry-Up',
        align: 'right',
        sortValue: (c) => c.indicators.vcpDryUpRatio ?? 99,
        render: (c) =>
          c.indicators.vcpDetected
            ? `${c.indicators.vcpContractions}x (${c.indicators.vcpDryUpRatio ?? '–'}x)`
            : '–',
      },
      {
        key: 'turn',
        label: '20d Turn (Cr)',
        align: 'right',
        sortValue: (c) => c.indicators.avgTurnover20,
        render: (c) => formatCrore(c.indicators.avgTurnover20),
      },
      ...(onOpenSizingTab
        ? [
            {
              key: '_plan',
              label: 'Plan',
              align: 'right' as const,
              sortable: false,
              render: (c: QuantStockCandidate) =>
                c.positionSizing ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSizingTab(c.symbol);
                    }}
                    className="text-[11px] font-sans font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Size →
                  </button>
                ) : (
                  <span className="text-slate-400">–</span>
                ),
            },
          ]
        : []),
    ],
    [hasSymbol, toggleSymbol, onOpenSizingTab]
  );

  const meta = sectionMeta[section];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(sectionMeta) as WatchlistSection[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              section === key
                ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {key === 'starred' && <Star className="w-3 h-3 fill-amber-500 text-amber-500" />}
            <span>{sectionMeta[key].label}</span>
          </button>
        ))}
      </div>

      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <span>{meta.description}</span>
          <QuantHelpTip
            termId={meta.helpTerm}
            learningMode={learningMode}
            onOpenGlossaryTerm={onOpenGlossaryTerm}
          />
        </div>
        <span className="text-[11px] text-slate-400">
          Click any row to inspect full 5-question thesis &amp; chart
        </span>
      </div>

      {section === 'starred' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3">
            <div className="font-sans text-[11px] text-slate-500">Actionable BUY</div>
            <div className="mt-0.5 text-base font-semibold text-emerald-600 dark:text-emerald-400">
              {starredHealthSummary.buy}
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3">
            <div className="font-sans text-[11px] text-slate-500">Wait Confirmation</div>
            <div className="mt-0.5 text-base font-semibold text-amber-600 dark:text-amber-400">
              {starredHealthSummary.wait}
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3">
            <div className="font-sans text-[11px] text-slate-500">Hold / Watchlist</div>
            <div className="mt-0.5 text-base font-semibold text-blue-600 dark:text-blue-400">
              {starredHealthSummary.holdWatch}
            </div>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3">
            <div className="font-sans text-[11px] text-slate-500">Reduce / Sell / Reject</div>
            <div className="mt-0.5 text-base font-semibold text-red-600 dark:text-red-400">
              {starredHealthSummary.riskReject}
            </div>
          </div>
        </div>
      )}

      <DataTable
        rows={activeRows}
        columns={columns}
        rowKey={(c) => c.symbol}
        onRowClick={(c) => onSelectCandidate(c.symbol)}
        searchKeys={['symbol', 'name', 'sector', 'classification', 'setupType']}
        emptyMessage={
          section === 'starred'
            ? 'No starred NEPSE tickers yet. Click the ★ icon in any table or Stock Explorer to audit them here.'
            : 'No matching records.'
        }
        exportFilename={`nepse-${section}-${data.asOfDate}.csv`}
        maxHeightClass="max-h-[460px]"
      />
    </div>
  );
};
