import React, { useMemo } from 'react';
import { Check, ShieldCheck, X } from 'lucide-react';
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
          </span>
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
