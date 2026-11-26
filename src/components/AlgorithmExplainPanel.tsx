import React, { useState } from 'react';
import type { AlgorithmDoc } from '../data/algorithmDocs';
import { ALGORITHM_DOCS_NE } from '../data/algorithmDocsNe';
import type { AppLanguage } from '../types/market';

export const AlgorithmExplainPanel: React.FC<{
  doc: AlgorithmDoc;
  compact?: boolean;
  lang?: AppLanguage;
}> = ({ doc, compact = false, lang: propLang }) => {
  const [localLang, setLocalLang] = useState<AppLanguage>('bi');
  const lang = propLang ?? localLang;
  const ne = ALGORITHM_DOCS_NE[doc.id];

  const showEn = lang === 'en' || lang === 'bi';
  const showNe = (lang === 'ne' || lang === 'bi') && Boolean(ne);

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
            {showEn ? doc.name : ne?.nameNe || doc.name}
          </h3>
          {lang === 'bi' && ne && (
            <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-0.5">
              {ne.nameNe}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span>{showEn ? doc.category : ne?.categoryNe || doc.category}</span>
            <span aria-hidden="true">·</span>
            <span className={`font-medium ${biasColor}`}>
              {showEn ? `${doc.bias} bias` : ne?.biasNe || doc.bias}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {showEn ? `Min history: ${doc.minHistoryDays} trading days` : `न्यूनतम इतिहास: ${doc.minHistoryDays} दिन`}
            </span>
          </div>
        </div>

        {!propLang && (
          <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[11px]">
            {(
              [
                { id: 'bi', label: 'EN + नेपाली' },
                { id: 'en', label: 'English' },
                { id: 'ne', label: 'नेपाली' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setLocalLang(opt.id)}
                className={`px-2 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                  lang === opt.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {showEn && (
          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{doc.summary}</p>
        )}
        {showNe && ne && (
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{ne.summaryNe}</p>
        )}
      </div>

      {/* Step-by-Step Execution Pipeline */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {lang === 'ne'
            ? 'चरणबद्ध एल्गोरिदम प्रक्रिया (Step-by-Step)'
            : lang === 'bi'
              ? 'Step-by-Step Algorithm Execution · चरणबद्ध एल्गोरिदम प्रक्रिया'
              : 'Step-by-Step Algorithm Execution'}
        </h4>
        <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-100 dark:divide-slate-800/80">
          {doc.steps.map((s, idx) => {
            const sNe = ne?.stepsNe[idx];
            return (
              <div key={s.step} className="px-4 py-3 flex items-start gap-3.5">
                <span className="font-mono tabular-nums text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0 pt-0.5">
                  {s.step}.
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  {showEn && (
                    <>
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {s.title}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {s.detail}
                      </p>
                    </>
                  )}
                  {showNe && sNe && (
                    <div className={showEn ? 'pt-1 border-t border-slate-100 dark:border-slate-800/60' : ''}>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {sNe.title}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mt-0.5">
                        {sNe.detail}
                      </p>
                    </div>
                  )}
                  {s.formula && (
                    <div className="font-mono tabular-nums text-[11px] text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1.5 overflow-x-auto">
                      {s.formula}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {lang === 'ne'
              ? 'सिद्धान्त र बजार मनोविज्ञान'
              : lang === 'bi'
                ? 'Thesis & Market Psychology · सिद्धान्त र बजार मनोविज्ञान'
                : 'Thesis & Market Psychology'}
          </h4>
          {showEn && (
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{doc.thesis}</p>
          )}
          {showNe && ne && (
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{ne.thesisNe}</p>
          )}
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            {lang === 'ne'
              ? 'गणितीय नियम र सर्तहरू'
              : lang === 'bi'
                ? 'Detection Rules & Mathematical Conditions · गणितीय नियम'
                : 'Detection Rules & Mathematical Conditions'}
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
            100-Point Conviction Score Breakdown · १००-अंक स्कोर विवरण
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
                Tunable Parameters · मापदण्डहरू
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
                    {lang === 'ne' ? 'कहिले प्रयोग गर्ने' : 'When to Use · कहिले प्रयोग गर्ने'}
                  </h4>
                  {showEn && <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{doc.whenToUse}</p>}
                  {showNe && ne && <p className="text-slate-500 dark:text-slate-400 leading-relaxed">{ne.whenToUseNe}</p>}
                </div>
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 space-y-1.5">
                  <h4 className="font-semibold text-red-700 dark:text-red-400">
                    {lang === 'ne' ? 'कहिले सावधान रहने' : 'When to Avoid · कहिले सावधान रहने'}
                  </h4>
                  {showEn && <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{doc.avoidWhen}</p>}
                  {showNe && ne && <p className="text-slate-500 dark:text-slate-400 leading-relaxed">{ne.avoidWhenNe}</p>}
                </div>
              </div>

              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  {lang === 'ne' ? 'व्यावहारिक सावधानी' : 'Practical Cautions · व्यावहारिक सावधानी'}
                </h4>
                {showEn && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {doc.cautions}
                  </p>
                )}
                {showNe && ne && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {ne.cautionsNe}
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
