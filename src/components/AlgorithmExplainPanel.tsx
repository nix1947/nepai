import React from 'react';
import type { AlgorithmDoc } from '../data/algorithmDocs';

export const AlgorithmExplainPanel: React.FC<{
  doc: AlgorithmDoc;
  compact?: boolean;
}> = ({ doc, compact = false }) => {
  const biasColor =
    doc.bias === 'Bullish'
      ? 'text-emerald-600 dark:text-emerald-400'
      : doc.bias === 'Bearish'
        ? 'text-red-600 dark:text-red-400'
        : 'text-slate-600 dark:text-slate-300';

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {doc.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span>{doc.category}</span>
            <span aria-hidden="true">·</span>
            <span className={`font-medium ${biasColor}`}>{doc.bias} bias</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Min history: {doc.minHistoryDays} trading days
            </span>
          </div>
        </div>
      </div>

      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{doc.summary}</p>

      {/* Step-by-Step Execution Pipeline */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Step-by-Step Algorithm Execution
        </h4>
        <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-100 dark:divide-slate-800/80">
          {doc.steps.map((s) => (
            <div key={s.step} className="px-4 py-3 flex items-start gap-3.5">
              <span className="font-mono tabular-nums text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0 pt-0.5">
                {s.step}.
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {s.title}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {s.detail}
                </p>
                {s.formula && (
                  <div className="font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1.5 overflow-x-auto">
                    {s.formula}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Thesis &amp; Market Psychology
          </h4>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{doc.thesis}</p>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Detection Rules &amp; Mathematical Conditions
          </h4>
          <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
            {doc.conditions.map((c, idx) => (
              <li key={idx} className="flex items-start gap-2 leading-relaxed">
                <span className="font-mono tabular-nums text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                  {String(idx + 1).padStart(2, '0')}.
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {doc.scoringRubric && doc.scoringRubric.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            100-Point Conviction Score Breakdown
          </h4>
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-2 font-medium text-slate-500 dark:text-slate-400">Factor</th>
                  <th className="px-3 py-2 font-medium text-slate-500 dark:text-slate-400 text-right">
                    Max Pts
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-500 dark:text-slate-400">
                    Evaluation Formula
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {doc.scoringRubric.map((row) => (
                  <tr key={row.factor}>
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {row.factor}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
                      {row.maxPoints}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{row.formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!compact && (
        <>
          <div className="border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50 dark:bg-slate-950 p-4 space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Worked NEPSE Example: {doc.workedExample.title}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {doc.workedExample.scenario}
            </p>
            <ul className="space-y-1 font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-300">
              {doc.workedExample.math.map((line, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 shrink-0">→</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 pt-1 border-t border-slate-200 dark:border-slate-800">
              Result: {doc.workedExample.verdict}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Tunable Parameters
              </h4>
              <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-100 dark:divide-slate-800/80">
                {doc.parameters.map((p) => (
                  <div key={p.name} className="px-3 py-2 text-xs flex items-start justify-between gap-3">
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{p.name}</span>
                      <p className="text-slate-500 dark:text-slate-400 mt-0.5">{p.effect}</p>
                    </div>
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
                      {p.defaultVal}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {doc.signalGlossary && doc.signalGlossary.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Fired Signal &amp; Flow Label Reference
                  </h4>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-100 dark:divide-slate-800/80">
                    {doc.signalGlossary.map((g) => (
                      <div key={g.tag} className="px-3 py-1.5 text-xs flex items-start gap-3">
                        <code className="font-mono text-blue-600 dark:text-blue-400 shrink-0">
                          {g.tag}
                        </code>
                        <span className="text-slate-600 dark:text-slate-300">{g.meaning}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 space-y-1.5">
                  <h4 className="font-semibold text-emerald-700 dark:text-emerald-400">
                    When to Use
                  </h4>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{doc.whenToUse}</p>
                </div>
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 space-y-1.5">
                  <h4 className="font-semibold text-red-700 dark:text-red-400">
                    When to Avoid
                  </h4>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{doc.avoidWhen}</p>
                </div>
              </div>

              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Practical Cautions
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {doc.cautions}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
