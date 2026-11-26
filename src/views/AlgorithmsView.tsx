import React, { useMemo, useState } from 'react';
import { AlgorithmExplainPanel } from '../components/AlgorithmExplainPanel';
import { ALGORITHM_DOCS, type AlgorithmDoc } from '../data/algorithmDocs';

type CategoryFilter = 'All' | AlgorithmDoc['category'];

const CATEGORIES: CategoryFilter[] = [
  'All',
  'Breakout',
  'Reversal',
  'Accumulation',
  'Momentum',
  'Turnover Flow',
];

export const AlgorithmsView: React.FC = () => {
  const [category, setCategory] = useState<CategoryFilter>('All');

  const filtered = useMemo(
    () =>
      category === 'All'
        ? ALGORITHM_DOCS
        : ALGORITHM_DOCS.filter((d) => d.category === category),
    [category]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Algorithm Reference &amp; Methodology
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Complete mathematical rules, market thesis, scoring rubrics, and parameter guides for every scanner and turnover model
          </p>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                category === cat
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {filtered.map((doc) => (
          <AlgorithmExplainPanel key={doc.id} doc={doc} />
        ))}
      </div>
    </div>
  );
};
