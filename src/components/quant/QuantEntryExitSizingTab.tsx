import React, { useMemo, useState } from 'react';
import { Check, Layers, ShieldCheck, X } from 'lucide-react';
import { NepseTradePlanner } from '../NepseTradePlanner';
import { QuantHelpTip } from '../QuantHelpTip';
import type {
  LearningMode,
  QuantEngineResponse,
  QuantStockCandidate,
} from '../../types/quant';
import { formatNum } from '../../utils/format';

interface QuantEntryExitSizingTabProps {
  data: QuantEngineResponse;
  selectedSymbol: string | null;
  onSelectSymbol: (sym: string) => void;
  learningMode: LearningMode;
  onOpenGlossaryTerm: (id: string) => void;
  onAddPaperTrade: (c: QuantStockCandidate) => void;
}

export const QuantEntryExitSizingTab: React.FC<QuantEntryExitSizingTabProps> = ({
  data,
  selectedSymbol,
  onSelectSymbol,
  learningMode,
  onOpenGlossaryTerm,
  onAddPaperTrade,
}) => {
  const [sizingMode, setSizingMode] = useState<'single' | 'pyramid'>('pyramid');
  const allValid = data.candidates;
  const candidate = useMemo(
    () =>
      allValid.find((c) => c.symbol === selectedSymbol) ??
      data.topOpportunities[0] ??
      allValid[0] ??
      null,
    [allValid, data.topOpportunities, selectedSymbol]
  );

  if (!candidate) {
    return (
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
        No valid candidates available for Entry &amp; Sizing analysis under current filters.
      </div>
    );
  }

  const sizing = candidate.positionSizing;
  const exitPlan = candidate.exitPlan;
  const pyramid = candidate.pyramidPlan;

  return (
    <div className="space-y-6">
      {/* Stock Selector Bar */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="quant-sizing-sym" className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Select Stock Plan:
          </label>
          <select
            id="quant-sizing-sym"
            value={candidate.symbol}
            onChange={(e) => onSelectSymbol(e.target.value)}
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          >
            {allValid.map((c) => (
              <option key={c.symbol} value={c.symbol}>
                {c.symbol} ({c.classification} · Score {c.technicalScore.toFixed(0)})
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {candidate.sector} · Close NPR {formatNum(candidate.indicators.close)}
            {candidate.horizonTag ? ` · ${candidate.horizonTag}` : ''}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setSizingMode('pyramid')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                sizingMode === 'pyramid'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              3-Tranche Pyramid Plan
            </button>
            <button
              type="button"
              onClick={() => setSizingMode('single')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                sizingMode === 'single'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Standard Single Entry
            </button>
          </div>

          {exitPlan && sizing && (
            <button
              type="button"
              onClick={() => onAddPaperTrade(candidate)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              + Add Plan to Paper Journal
            </button>
          )}
        </div>
      </div>

      {/* Entry Timing & Exit Policy Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>Entry Timing Rules ({candidate.entryPlan.setupType})</span>
              <QuantHelpTip termId="entry-zone" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
            </h3>
            <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
              {candidate.entryPlan.setupStatus}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
            <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded">
              <div className="font-sans text-[11px] text-slate-500">Entry Zone</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {candidate.entryPlan.entryZoneLow && candidate.entryPlan.entryZoneHigh
                  ? `${formatNum(candidate.entryPlan.entryZoneLow)}–${formatNum(candidate.entryPlan.entryZoneHigh)}`
                  : '–'}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded">
              <div className="font-sans text-[11px] text-slate-500">Trigger Pivot</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {candidate.entryPlan.triggerPrice ? formatNum(candidate.entryPlan.triggerPrice) : '–'}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded">
              <div className="font-sans text-[11px] text-slate-500 flex items-center gap-1">
                Invalidation
                <QuantHelpTip termId="invalidation-level" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
              </div>
              <div className="font-semibold text-red-600 dark:text-red-400 mt-0.5">
                {candidate.entryPlan.invalidationLevel ? formatNum(candidate.entryPlan.invalidationLevel) : '–'}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="font-semibold text-slate-800 dark:text-slate-200">Confirmation Checklist</div>
            {candidate.entryPlan.confirmationConditions.length === 0 ? (
              <p className="text-slate-500">No active Breakout, VCP, or Pullback checklist matched on {data.asOfDate}.</p>
            ) : (
              <ul className="space-y-1">
                {candidate.entryPlan.confirmationConditions.map((c, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    {c.passed ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <span>
                      <strong className="text-slate-800 dark:text-slate-200">{c.label}:</strong>{' '}
                      <span className="text-slate-600 dark:text-slate-300">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {candidate.entryPlan.supportingReasons.length > 0 && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
              <div className="font-semibold text-emerald-700 dark:text-emerald-400">Supporting Reasons</div>
              {candidate.entryPlan.supportingReasons.map((r, i) => (
                <div key={i} className="text-slate-600 dark:text-slate-300">· {r}</div>
              ))}
            </div>
          )}

          {candidate.entryPlan.rejectionReasons.length > 0 && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
              <div className="font-semibold text-amber-700 dark:text-amber-400">Rejection / Wait Reasons</div>
              {candidate.entryPlan.rejectionReasons.map((r, i) => (
                <div key={i} className="text-slate-600 dark:text-slate-300">· {r}</div>
              ))}
            </div>
          )}
        </div>

        {/* Exit Management & Engine Sizing Card */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <span>Risk-Adjusted Sizing &amp; Exit Conditions</span>
              <QuantHelpTip termId="position-sizing" learningMode={learningMode} onOpenGlossaryTerm={onOpenGlossaryTerm} />
            </h3>
            {sizing && (
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                Net R:R T1 1:{sizing.netRiskRewardT1} · T2 1:{sizing.netRiskRewardT2}
              </span>
            )}
          </div>

          {sizing && exitPlan && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded">
                  <div className="font-sans text-[11px] text-slate-500">Risk Capital</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    NPR {sizing.riskCapitalNpr.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded">
                  <div className="font-sans text-[11px] text-slate-500">Position Size</div>
                  <div className="font-semibold text-blue-600 dark:text-blue-400">
                    {sizing.finalQuantity.toLocaleString('en-US')} sh
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded">
                  <div className="font-sans text-[11px] text-slate-500">Total Cash Req</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    NPR {Math.round(sizing.totalCashRequiredNpr).toLocaleString('en-US')}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded">
                  <div className="font-sans text-[11px] text-slate-500">Max Net Loss</div>
                  <div className="font-semibold text-red-600 dark:text-red-400">
                    -NPR {Math.round(sizing.maxAcceptableLossNetNpr).toLocaleString('en-US')}
                  </div>
                </div>
              </div>

              {sizing.cappingReason && (
                <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded px-3 py-2">
                  Constraint applied: {sizing.cappingReason}
                </div>
              )}

              <div className="space-y-1.5 text-slate-600 dark:text-slate-300 leading-relaxed">
                <div>
                  <strong className="text-slate-900 dark:text-slate-100">Initial Stop-Loss:</strong> NPR {formatNum(exitPlan.initialStopLoss)} (-{exitPlan.stopDistancePct}%)
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-slate-100">Partial Profit Rule:</strong> {exitPlan.partialProfitRule}
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-slate-100">Target 2:</strong> NPR {formatNum(exitPlan.target2)}
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-slate-100">Trailing Stop:</strong> {exitPlan.trailingStopRule}
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-slate-100">MA Breakdown Exit:</strong> {exitPlan.maBreakdownRule}
                </div>
                <div>
                  <strong className="text-slate-900 dark:text-slate-100">Regime Alert:</strong> {exitPlan.regimeAlertRule}
                </div>
                <div className="pt-1 flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{exitPlan.neverWidenStopPolicy}</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 pt-1">
                  {sizing.priceLimitNotice} · Liquidity exit footprint: {sizing.liquidityDaysToExit} day(s) of 20d avg volume.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pyramiding & Winner-Trailing Engine */}
      {sizingMode === 'pyramid' && pyramid && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Pyramiding &amp; Winner-Trailing Plan ({candidate.symbol})</span>
              </h3>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                Scale into strength only after initial trade proves positive (+1.0R and +1.5R), locking pilot breakeven before adding tranche 2.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums text-right">
              <div>
                <div className="font-sans text-[10px] text-slate-500">Blended Entry</div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  NPR {formatNum(pyramid.blendedEntryPrice)}
                </div>
              </div>
              <div>
                <div className="font-sans text-[10px] text-slate-500">Total Shares</div>
                <div className="font-semibold text-blue-600 dark:text-blue-400">
                  {pyramid.totalShares.toLocaleString('en-US')} sh
                </div>
              </div>
              <div>
                <div className="font-sans text-[10px] text-slate-500">Pilot Max Risk</div>
                <div className="font-semibold text-red-600 dark:text-red-400">
                  -NPR {Math.round(pyramid.initialMaxRiskNpr).toLocaleString('en-US')}
                </div>
              </div>
              <div>
                <div className="font-sans text-[10px] text-slate-500">Breakeven Lock</div>
                <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                  NPR {formatNum(pyramid.breakevenLockPrice)}
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 text-left font-medium">Tranche</th>
                  <th className="py-2 px-3 text-right font-medium">Weight</th>
                  <th className="py-2 px-3 text-right font-medium">Shares</th>
                  <th className="py-2 px-3 text-right font-medium">Trigger Price</th>
                  <th className="py-2 px-3 text-right font-medium">Stop After Fill</th>
                  <th className="py-2 px-3 text-right font-medium">Cash Req</th>
                  <th className="py-2 pl-3 text-left font-medium">Execution Rule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pyramid.tranches.map((t) => (
                  <tr key={t.tranche}>
                    <td className="py-2.5 pr-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      #{t.tranche} · {t.label}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{t.sharePct}%</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                      {t.shares.toLocaleString('en-US')}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      NPR {formatNum(t.triggerPrice)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      NPR {formatNum(t.stopAfterFill)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      NPR {Math.round(t.cashRequiredNpr).toLocaleString('en-US')}
                    </td>
                    <td className="py-2.5 pl-3 text-slate-600 dark:text-slate-300">{t.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300">
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Swing Winner-Trailing Protocol (5–30d)
              </div>
              <p className="mt-1 leading-relaxed">{pyramid.swingTrailRule}</p>
            </div>
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Positional Stage-2 Trailing Protocol (2–6m)
              </div>
              <p className="mt-1 leading-relaxed">{pyramid.positionalTrailRule}</p>
            </div>
          </div>
        </div>
      )}

      {/* Existing NEPSE Fee-Exact Interactive Trade Planner Reused */}
      <NepseTradePlanner
        symbol={candidate.symbol}
        lastClose={candidate.indicators.close}
        suggestedStop={exitPlan?.initialStopLoss ?? null}
        suggestedTarget={exitPlan?.target2 ?? null}
      />
    </div>
  );
};
