import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import {
  CONCEPTUAL_DISTINCTIONS,
  GLOSSARY_CATEGORIES,
  QUANT_GLOSSARY,
} from '../data/quantGlossary';
import type { GlossaryCategory, LearningMode } from '../types/quant';

interface QuantGlossaryPanelProps {
  learningMode: LearningMode;
  focusedTermId?: string | null;
  onSelectTerm?: (id: string) => void;
}

export const QuantGlossaryPanel: React.FC<QuantGlossaryPanelProps> = ({
  learningMode,
  focusedTermId,
  onSelectTerm,
}) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | GlossaryCategory>('All');
  const [activeId, setActiveId] = useState<string>(focusedTermId || QUANT_GLOSSARY[0].id);

  useEffect(() => {
    if (focusedTermId) {
      setActiveId(focusedTermId);
      setSelectedCategory('All');
      setQuery('');
    }
  }, [focusedTermId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return QUANT_GLOSSARY.filter((item) => {
      if (selectedCategory !== 'All' && item.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        item.term.toLowerCase().includes(q) ||
        item.fullName.toLowerCase().includes(q) ||
        item.simpleDefinition.toLowerCase().includes(q) ||
        item.nepaliExplanation.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [query, selectedCategory]);

  const activeEntry = useMemo(
    () =>
      filtered.find((e) => e.id === activeId) ??
      QUANT_GLOSSARY.find((e) => e.id === activeId) ??
      filtered[0] ??
      QUANT_GLOSSARY[0],
    [filtered, activeId]
  );

  const selectEntry = (id: string) => {
    setActiveId(id);
    onSelectTerm?.(id);
  };

  return (
    <div className="space-y-8">
      {/* Essential Conceptual Distinctions */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Essential Concept Distinctions for NEPSE Traders
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Key differences that prevent common analytical mistakes when moving from simple charts to statistical decision-making.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {CONCEPTUAL_DISTINCTIONS.map((d) => (
            <div
              key={d.id}
              className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-2.5 text-xs"
            >
              <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-snug">
                {d.title}
              </div>
              <div className="space-y-1.5 text-slate-600 dark:text-slate-300 leading-relaxed">
                <p>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{d.leftLabel}: </span>
                  {d.leftSummary}
                </p>
                <p>
                  <span className="font-semibold text-blue-700 dark:text-blue-400">{d.rightLabel}: </span>
                  {d.rightSummary}
                </p>
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed space-y-1">
                <p>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Rule: </span>
                  {d.practicalTakeaway}
                </p>
                <p className="text-slate-500 dark:text-slate-400">
                  <span className="font-semibold">नेपाली: </span>
                  {d.nepaliNote}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Searchable Glossary & Category Browser */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Financial, Quantitative &amp; Risk Glossary ({QUANT_GLOSSARY.length} Terms)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Showing {learningMode === 'beginner' ? 'Beginner plain-language view (toggle Advanced at top for full mathematical formulations)' : 'Advanced quantitative view with formulas and statistical limitations'}.
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search term, abbreviation, or Nepali..."
              className="w-full pl-8 pr-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>
        </div>

        {/* Category segmented controls */}
        <div className="flex flex-wrap gap-1.5">
          {(['All', ...GLOSSARY_CATEGORIES] as const).map((cat) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Term Index */}
          <div className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No glossary terms match “{query}”. Try clearing the filter.
              </div>
            ) : (
              filtered.map((item) => {
                const isSelected = activeEntry?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectEntry(item.id)}
                    className={`w-full text-left px-3.5 py-2.5 transition-colors ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${
                          isSelected
                            ? 'text-blue-700 dark:text-blue-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {item.term}
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">
                        {item.category}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {item.fullName}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Term Full Lesson Card */}
          {activeEntry && (
            <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
              <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span>{activeEntry.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>{learningMode === 'beginner' ? 'Beginner & Practical Guide' : 'Advanced Quantitative Reference'}</span>
                </div>
                <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">
                  {activeEntry.term} — {activeEntry.fullName}
                </h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 leading-relaxed">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Plain-Language Definition
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{activeEntry.simpleDefinition}</p>
                </div>
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Practical Nepali Explanation (नेपालीमा)
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{activeEntry.nepaliExplanation}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 leading-relaxed pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">Why It Matters</div>
                  <p className="text-slate-600 dark:text-slate-300">{activeEntry.whyItMatters}</p>
                </div>
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">How to Interpret</div>
                  <p className="text-slate-600 dark:text-slate-300">{activeEntry.interpretation}</p>
                </div>
              </div>

              <div className="rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 space-y-1.5">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Hypothetical NEPSE Example
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  {activeEntry.hypotheticalExample}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 leading-relaxed pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="font-semibold text-blue-700 dark:text-blue-400">
                    Impact on Trading Decisions
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{activeEntry.tradingDecisionImpact}</p>
                </div>
                <div className="space-y-1">
                  <div className="font-semibold text-amber-700 dark:text-amber-400">
                    Common Mistakes to Avoid
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{activeEntry.commonMistakes}</p>
                </div>
              </div>

              {/* Calculation / Formula + Limitations (highlighted in Advanced mode, always accessible cleanly below) */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Calculation Method {learningMode === 'advanced' && activeEntry.formula ? '& Mathematical Formula' : ''}
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    {activeEntry.howCalculated}
                  </p>
                  {activeEntry.formula && (
                    <div className="mt-1.5 font-mono text-xs bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded text-slate-900 dark:text-slate-100">
                      {activeEntry.formula}
                    </div>
                  )}
                </div>

                {learningMode === 'advanced' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 leading-relaxed pt-2">
                    <div className="space-y-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Quantitative &amp; Statistical Context
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">{activeEntry.advancedExplanation}</p>
                    </div>
                    <div className="space-y-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Model &amp; Data Limitations
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">{activeEntry.limitations}</p>
                    </div>
                  </div>
                )}

                {learningMode === 'beginner' && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold">Limitation: </span>
                    {activeEntry.limitations}
                  </div>
                )}
              </div>

              {activeEntry.relatedTerms.length > 0 && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Related concepts:</span>
                  {activeEntry.relatedTerms.map((relId) => {
                    const rel = QUANT_GLOSSARY.find((g) => g.id === relId);
                    if (!rel) return null;
                    return (
                      <button
                        key={relId}
                        type="button"
                        onClick={() => selectEntry(relId)}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {rel.term}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
