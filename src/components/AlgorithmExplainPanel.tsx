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
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{doc.name}</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            <span>{doc.category}</span>
            <span aria-hidden="true">·</span>
            <span className={`font-medium ${biasColor}`}>{doc.bias} bias</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">Min history: {doc.minHistoryDays} trading days</span>
          </div>
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
                <span className="font-mono text-xs text-blue-600 dark:text-blue-400 mt-0.5">
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

          <div className="space-y-3">
            {doc.signalGlossary && doc.signalGlossary.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Fired Signal Tag Reference
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

            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                Practical Cautions &amp; Edge Cases
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {doc.cautions}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
