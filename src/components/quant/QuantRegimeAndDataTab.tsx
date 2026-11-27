import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { DataTable, type ColumnDef } from '../DataTable';
import { QuantHelpTip } from '../QuantHelpTip';
import type {
  DataQualityIssue,
  DataQualityReport,
  LearningMode,
  MarketRegimeReport,
  QuantStockCandidate,
  SectorRegimeStrength,
} from '../../types/quant';
import { formatCrore, formatNum, formatPct } from '../../utils/format';

interface RegimeTabProps {
  regime: MarketRegimeReport;
  learningMode: LearningMode;
  onOpenGlossaryTerm: (id: string) => void;
}

export const QuantRegimeTab: React.FC<RegimeTabProps> = ({
  regime,
  learningMode,
  onOpenGlossaryTerm,
}) => {
  const regimeTone =
    regime.regime === 'Bullish'
      ? 'text-emerald-600 dark:text-emerald-400'
      : regime.regime === 'Bearish'
        ? 'text-red-600 dark:text-red-400'
        : 'text-amber-600 dark:text-amber-400';

  // Build SVG path for NEPSE proxy + SMA20 + SMA50
  const chartGeom = useMemo(() => {
    const pts = regime.series.slice(-90);
    if (pts.length < 2) return null;
    const allVals: number[] = [];
    for (const p of pts) {
      allVals.push(p.equalWeightedIndex);
      if (p.sma20 !== null) allVals.push(p.sma20);
      if (p.sma50 !== null) allVals.push(p.sma50);
    }
    const minV = Math.min(...allVals) * 0.995;
    const maxV = Math.max(...allVals) * 1.005;
    const span = Math.max(1, maxV - minV);
    const w = 720;
    const h = 210;
    const padX = 12;
    const padY = 14;
    const xAt = (i: number) => padX + (i / (pts.length - 1)) * (w - padX * 2);
    const yAt = (v: number) => padY + (1 - (v - minV) / span) * (h - padY * 2);

    const buildPath = (getter: (p: (typeof pts)[number]) => number | null) => {
      let d = '';
      pts.forEach((p, i) => {
        const val = getter(p);
        if (val === null) return;
        const cmd = d === '' ? 'M' : 'L';
        d += `${cmd}${xAt(i).toFixed(1)},${yAt(val).toFixed(1)} `;
      });
      return d.trim();
    };

    return {
      w,
      h,
      minV,
      maxV,
      firstDate: pts[0].date,
      lastDate: pts[pts.length - 1].date,
      indexPath: buildPath((p) => p.equalWeightedIndex),
      sma20Path: buildPath((p) => p.sma20),
      sma50Path: buildPath((p) => p.sma50),
    };
  }, [regime.series]);

  const allSectors = useMemo(() => {
    const map = new Map<string, SectorRegimeStrength>();
    for (const s of [...regime.topSectors, ...regime.weakSectors]) {
      map.set(s.sector, s);
    }
    return [...map.values()].sort(
      (a, b) => (b.return20dPct ?? -999) - (a.return20dPct ?? -999)
    );
  }, [regime]);

  const sectorColumns: ColumnDef<SectorRegimeStrength>[] = [
    { key: 'sector', label: 'Sector', align: 'left', render: (s) => <span className="font-medium text-slate-900 dark:text-slate-100">{s.sector}</span> },
    { key: 'stockCount', label: 'Stocks', align: 'right', render: (s) => s.stockCount },
    {
      key: 'return20dPct',
      label: '20d Return',
      align: 'right',
      render: (s) => (
        <span className={(s.return20dPct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          {s.return20dPct !== null ? formatPct(s.return20dPct) : 'Unavailable'}
        </span>
      ),
    },
    {
      key: 'return5dPct',
      label: '5d Return',
      align: 'right',
      render: (s) => (
        <span className={(s.return5dPct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          {s.return5dPct !== null ? formatPct(s.return5dPct) : 'Unavailable'}
        </span>
      ),
    },
    {
      key: 'breadthAboveSma20Pct',
      label: '> SMA20',
      align: 'right',
      render: (s) => `${s.breadthAboveSma20Pct.toFixed(1)}%`,
    },
    {
      key: 'relativeStrengthVsMarket',
      label: 'RS vs NEPSE',
      align: 'right',
      render: (s) => (
        <span className={(s.relativeStrengthVsMarket ?? 0) >= 0 ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-slate-500'}>
          {s.relativeStrengthVsMarket !== null ? formatPct(s.relativeStrengthVsMarket) : '–'}
        </span>
      ),
    },
    {
      key: 'turnoverSharePct',
      label: 'Turn Share',
      align: 'right',
      render: (s) => `${s.turnoverSharePct.toFixed(1)}%`,
    },
    {
      key: 'regime',
      label: 'Sector Tone',
      align: 'left',
      render: (s) => (
        <span
          className={`text-xs font-semibold ${
            s.regime === 'Bullish'
              ? 'text-emerald-600 dark:text-emerald-400'
              : s.regime === 'Bearish'
                ? 'text-red-600 dark:text-red-400'
                : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {s.regime}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Regime Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <span>NEPSE Market Environment</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{regime.asOfDate}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <div className={`text-2xl font-bold flex items-center gap-2 ${regimeTone}`}>
                {regime.regime === 'Bullish' ? (
                  <TrendingUp className="w-6 h-6" />
                ) : regime.regime === 'Bearish' ? (
                  <TrendingDown className="w-6 h-6" />
                ) : (
                  <AlertTriangle className="w-6 h-6" />
                )}
                <span>{regime.regime} Regime</span>
              </div>
              <div className="font-mono tabular-nums text-sm font-semibold text-slate-700 dark:text-slate-200">
                Score {regime.regimeScore}/100
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                Recommended Equity Exposure
                <QuantHelpTip
                  termId="maximum-exposure"
                  learningMode={learningMode}
                  customContext={`Current ${regime.regime} conditions suggest deploying ${regime.recommendedExposureMinPct}%–${regime.recommendedExposureMaxPct}% of capital (target ~${regime.recommendedExposureTargetPct}%) and keeping the rest in liquid cash.`}
                  onOpenGlossaryTerm={onOpenGlossaryTerm}
                />
              </span>
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {regime.recommendedExposureMinPct}% – {regime.recommendedExposureMaxPct}% (Target {regime.recommendedExposureTargetPct}%)
              </span>
            </div>
            <div className="h-2.5 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full ${
                  regime.regime === 'Bullish'
                    ? 'bg-emerald-600'
                    : regime.regime === 'Bearish'
                      ? 'bg-red-600'
                      : 'bg-amber-500'
                }`}
                style={{ width: `${regime.recommendedExposureTargetPct}%` }}
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
            <div className="font-semibold text-slate-900 dark:text-slate-100">Classification Drivers</div>
            <ul className="space-y-1">
              {regime.rationale.map((line, i) => (
                <li key={i} className="leading-relaxed">
                  · {line}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* NEPSE Proxy Trend Chart */}
        <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <span>{regime.indexProxyLabel}</span>
                <QuantHelpTip
                  termId="sma"
                  learningMode={learningMode}
                  customContext="Plots the daily NEPSE equal-weighted index proxy alongside its 20-day and 50-day Simple Moving Averages. SMA200 requires 200+ daily sessions."
                  onOpenGlossaryTerm={onOpenGlossaryTerm}
                />
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Current {formatNum(regime.indexCurrent)} · SMA20 {regime.sma20 ? formatNum(regime.sma20) : 'Unavailable'} · SMA50 {regime.sma50 ? formatNum(regime.sma50) : 'Unavailable'} · SMA200{' '}
                {regime.sma200Available && regime.sma200 ? formatNum(regime.sma200) : 'Unavailable (<200 sessions loaded)'}
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="text-slate-800 dark:text-slate-200">— Index Proxy</span>
              <span className="text-blue-600 dark:text-blue-400">— SMA20</span>
              <span className="text-amber-600 dark:text-amber-400">— SMA50</span>
            </div>
          </div>

          {chartGeom ? (
            <div className="w-full overflow-hidden">
              <svg
                viewBox={`0 0 ${chartGeom.w} ${chartGeom.h}`}
                className="w-full h-52 select-none"
                role="img"
                aria-label="NEPSE Market Proxy Index and Moving Averages"
              >
                <line x1="12" y1="20" x2={chartGeom.w - 12} y2="20" stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="3 3" />
                <line x1="12" y1={chartGeom.h / 2} x2={chartGeom.w - 12} y2={chartGeom.h / 2} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="3 3" />
                <line x1="12" y1={chartGeom.h - 20} x2={chartGeom.w - 12} y2={chartGeom.h - 20} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="3 3" />
                {chartGeom.sma50Path && (
                  <path d={chartGeom.sma50Path} fill="none" stroke="#d97706" strokeWidth="1.75" />
                )}
                {chartGeom.sma20Path && (
                  <path d={chartGeom.sma20Path} fill="none" stroke="#2563eb" strokeWidth="1.75" />
                )}
                <path d={chartGeom.indexPath} fill="none" stroke="currentColor" className="text-slate-900 dark:text-slate-100" strokeWidth="2.2" />
              </svg>
              <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-1">
                <span>{chartGeom.firstDate}</span>
                <span>Range: {formatNum(chartGeom.minV, 0)} – {formatNum(chartGeom.maxV, 0)}</span>
                <span>{chartGeom.lastDate}</span>
              </div>
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-xs text-slate-400">
              Need at least 2 trading sessions to plot NEPSE index proxy.
            </div>
          )}
        </div>
      </div>

      {/* Breadth, A/D Ratio, Turnover, Volatility, Drawdown Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
            Breadth &gt; SMA20
            <QuantHelpTip termId="market-breadth" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100">
            {regime.breadthAboveSma20Pct.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            &gt; SMA50: {regime.breadthAboveSma50Pct.toFixed(1)}%
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
            Long-Term MAs
            <QuantHelpTip termId="sma" learningMode={learningMode} customContext="Uses reported 120-day and 180-day moving average fields when 200-day raw CSV history is not yet loaded." onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100">
            {regime.breadthAboveMa120Pct.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            &gt; MA120 · MA180: {regime.breadthAboveMa180Pct.toFixed(1)}%
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
            Advance / Decline
            <QuantHelpTip termId="advance-decline-ratio" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100">
            {regime.adRatio.toFixed(2)}x
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            {regime.advancers}↑ / {regime.decliners}↓ / {regime.unchanged}=
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
            Market Turnover
            <QuantHelpTip termId="turnover" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100">
            {formatCrore(regime.marketTurnover)}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            {regime.turnoverVsAvg20.toFixed(2)}x vs 20d avg
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
            Annualized Vol
            <QuantHelpTip termId="volatility" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <div className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100">
            {regime.volatility20dPct.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            20d index std dev
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5 space-y-1">
          <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
            Index Drawdown
            <QuantHelpTip termId="drawdown" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
          </div>
          <div className="text-lg font-mono font-semibold text-red-600 dark:text-red-400">
            -{regime.currentDrawdownPct.toFixed(2)}%
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Window max -{regime.maxDrawdownWindowPct.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Sector Strength Matrix */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>NEPSE Sector Leadership &amp; Relative Strength</span>
              <QuantHelpTip termId="relative-strength" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Leading sectors attract breadth and institutional turnover; weak lagging sectors require extra selectivity.
            </p>
          </div>
        </div>
        <DataTable
          rows={allSectors}
          columns={sectorColumns}
          rowKey={(r) => r.sector}
          searchKeys={['sector', 'regime']}
          exportFilename={`nepse-sector-regime-${regime.asOfDate}.csv`}
          maxHeightClass="max-h-[340px]"
        />
      </div>
    </div>
  );
};

interface DataQualitySectionProps {
  dataQuality: DataQualityReport;
  excludedStocks: QuantStockCandidate[];
  learningMode: LearningMode;
  onOpenGlossaryTerm: (id: string) => void;
}

export const QuantDataQualitySection: React.FC<DataQualitySectionProps> = ({
  dataQuality,
  excludedStocks,
  learningMode,
  onOpenGlossaryTerm,
}) => {
  const [issueFilter, setIssueFilter] = useState<'all' | DataQualityIssue['category']>('all');

  const filteredIssues = useMemo(() => {
    if (issueFilter === 'all') return dataQuality.flaggedIssues;
    return dataQuality.flaggedIssues.filter((i) => i.category === issueFilter);
  }, [dataQuality.flaggedIssues, issueFilter]);

  const issueCols: ColumnDef<DataQualityIssue>[] = [
    { key: 'symbol', label: 'Symbol', align: 'left', render: (i) => <span className="font-semibold text-slate-900 dark:text-slate-100">{i.symbol}</span> },
    { key: 'date', label: 'Date', align: 'left', render: (i) => <span className="font-mono text-xs">{i.date}</span> },
    {
      key: 'severity',
      label: 'Severity',
      align: 'left',
      render: (i) => (
        <span
          className={`font-semibold text-xs ${
            i.severity === 'error'
              ? 'text-red-600 dark:text-red-400'
              : i.severity === 'warning'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-500'
          }`}
        >
          {i.severity}
        </span>
      ),
    },
    { key: 'category', label: 'Check', align: 'left', render: (i) => <span className="font-mono text-xs">{i.category}</span> },
    { key: 'detail', label: 'Diagnostic Detail', align: 'left', render: (i) => <span className="text-xs text-slate-600 dark:text-slate-300">{i.detail}</span> },
  ];

  const excludedCols: ColumnDef<QuantStockCandidate>[] = [
    { key: 'symbol', label: 'Symbol', align: 'left', render: (c) => <span className="font-semibold text-slate-900 dark:text-slate-100">{c.symbol}</span> },
    { key: 'sector', label: 'Sector', align: 'left', render: (c) => c.sector },
    { key: 'close', label: 'Close', align: 'right', render: (c) => formatNum(c.indicators.close) },
    { key: 'avgTurnover20', label: '20d Avg Turn (Cr)', align: 'right', render: (c) => formatCrore(c.indicators.avgTurnover20) },
    { key: 'stale', label: 'Stale Days', align: 'right', render: (c) => c.dataQuality.staleConsecutiveDays },
    { key: 'reasons', label: 'Exclusion / Penalty Reason', align: 'left', render: (c) => <span className="text-xs text-red-600 dark:text-red-400">{c.dataQuality.reasons.join('; ') || c.classificationReason}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Market Data Validation &amp; Integrity Audit
              </h3>
              <QuantHelpTip
                termId="ohlcv"
                learningMode={learningMode}
                customContext="Every daily CSV record is validated before scoring or backtesting. Unadjusted corporate-action jumps, stale zero-volume runs, duplicates, and broken OHLC bars are flagged without retroactive look-ahead bias."
                onOpenGlossaryTerm={onOpenGlossaryTerm}
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Archive span {dataQuality.dateRange.start} to {dataQuality.dateRange.end} ({dataQuality.totalSessionsInStore} trading sessions) · Audited as of {dataQuality.asOfDate}
            </p>
          </div>
          <div className="text-right font-mono tabular-nums">
            <div className="text-xs text-slate-500 dark:text-slate-400">Quality Integrity Score</div>
            <div className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {dataQuality.overallQualityScore}/100
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs font-mono tabular-nums pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <div className="font-sans text-slate-500 dark:text-slate-400">Valid Symbols</div>
            <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {dataQuality.validSymbolsCount}
            </div>
          </div>
          <div>
            <div className="font-sans text-slate-500 dark:text-slate-400">Warnings</div>
            <div className="text-base font-semibold text-amber-600 dark:text-amber-400 mt-0.5">{dataQuality.warningSymbolsCount}</div>
          </div>
          <div>
            <div className="font-sans text-slate-500 dark:text-slate-400">Excluded</div>
            <div className="text-base font-semibold text-red-600 dark:text-red-400 mt-0.5">{dataQuality.excludedSymbolsCount}</div>
          </div>
          <div>
            <div className="font-sans text-slate-500 dark:text-slate-400">Missing Gaps</div>
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{dataQuality.issueCounts.missingRecords}</div>
          </div>
          <div>
            <div className="font-sans text-slate-500 dark:text-slate-400">Stale Runs</div>
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{dataQuality.issueCounts.stalePrices}</div>
          </div>
          <div>
            <div className="font-sans text-slate-500 dark:text-slate-400">Corp-Action Jumps</div>
            <div className="text-base font-semibold text-amber-600 dark:text-amber-400 mt-0.5">{dataQuality.issueCounts.corporateActionSuspects}</div>
          </div>
          <div>
            <div className="font-sans text-slate-500 dark:text-slate-400">OHLC Anomalies</div>
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-0.5">{dataQuality.issueCounts.anomalousValues}</div>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pt-2 border-t border-slate-100 dark:border-slate-800">
          {dataQuality.auditNote}
        </p>
      </div>

      {/* Flagged Issues Filter */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>Detected Data Anomalies &amp; Corporate-Action Flags ({filteredIssues.length})</span>
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', 'All'],
                ['corporate_action_suspect', 'Corp Actions'],
                ['anomalous_ohlc', 'OHLC Errors'],
                ['stale_price', 'Stale Prices'],
                ['missing_record', 'Missing Sessions'],
                ['duplicate_entry', 'Duplicates'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setIssueFilter(k)}
                className={`px-2.5 py-1 text-xs rounded border whitespace-nowrap shrink-0 ${
                  issueFilter === k
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <DataTable
          rows={filteredIssues}
          columns={issueCols}
          rowKey={(r, i) => `${r.symbol}-${r.date}-${r.category}-${i}`}
          searchKeys={['symbol', 'category', 'detail']}
          exportFilename={`nepse-data-quality-${dataQuality.asOfDate}.csv`}
          maxHeightClass="max-h-[300px]"
        />
      </div>

      {/* Excluded / Illiquid / Invalid Securities */}
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Excluded / Penalized Securities ({excludedStocks.length})
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Blocked from actionable BUY recommendations due to low turnover/volume, insufficient history, stale quotes, or corporate-action anomalies.
          </p>
        </div>
        <DataTable
          rows={excludedStocks}
          columns={excludedCols}
          rowKey={(c) => c.symbol}
          searchKeys={['symbol', 'name', 'sector']}
          exportFilename={`nepse-excluded-stocks-${dataQuality.asOfDate}.csv`}
          maxHeightClass="max-h-[300px]"
        />
      </div>
    </div>
  );
};
