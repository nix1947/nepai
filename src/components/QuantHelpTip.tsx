import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, HelpCircle, X } from 'lucide-react';
import { GLOSSARY_BY_ID } from '../data/quantGlossary';
import type { LearningMode } from '../types/quant';

interface QuantHelpTipProps {
  termId: string;
  learningMode?: LearningMode;
  customContext?: string;
  align?: 'left' | 'right';
  onOpenGlossaryTerm?: (termId: string) => void;
}

export const QuantHelpTip: React.FC<QuantHelpTipProps> = ({
  termId,
  learningMode = 'beginner',
  customContext,
  align = 'left',
  onOpenGlossaryTerm,
}) => {
  const [open, setOpen] = useState(false);
  const [showAdvancedLocal, setShowAdvancedLocal] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const entry = GLOSSARY_BY_ID[termId];

  useEffect(() => {
    setShowAdvancedLocal(learningMode === 'advanced');
  }, [learningMode]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!entry) return null;

  return (
    <span ref={rootRef} className="relative inline-flex items-center align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Explain ${entry.term}`}
        title={`What is ${entry.term}?`}
        className="p-0.5 rounded text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={entry.fullName}
          className={`fixed sm:absolute inset-x-3 sm:inset-x-auto bottom-3 sm:bottom-auto sm:top-full sm:mt-1.5 z-50 sm:w-96 max-h-[75vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-3.5 text-left text-xs space-y-2.5 ${
            align === 'right' ? 'sm:right-0' : 'sm:left-0'
          }`}
        >
          <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {entry.category}
              </div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-snug">
                {entry.term} — {entry.fullName}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
              aria-label="Close help dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {customContext && (
            <div className="rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 px-2.5 py-2 text-[11px] text-blue-900 dark:text-blue-200 leading-relaxed">
              <span className="font-semibold">In this view: </span>
              {customContext}
            </div>
          )}

          <div className="space-y-1.5 leading-relaxed">
            <p className="text-slate-800 dark:text-slate-200 font-normal">
              <span className="font-semibold text-slate-900 dark:text-slate-100">Plain meaning: </span>
              {entry.simpleDefinition}
            </p>
            <p className="text-slate-600 dark:text-slate-300 font-normal">
              <span className="font-semibold text-slate-800 dark:text-slate-200">नेपाली / Practical: </span>
              {entry.nepaliExplanation}
            </p>
            <p className="text-slate-600 dark:text-slate-300 font-normal">
              <span className="font-semibold text-slate-800 dark:text-slate-200">Why it matters: </span>
              {entry.whyItMatters}
            </p>
          </div>

          <div className="rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
            {entry.hypotheticalExample}
          </div>

          <div className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
            <span className="font-semibold">Watch out: </span>
            {entry.commonMistakes}
          </div>

          {showAdvancedLocal && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-100">How calculated: </span>
                {entry.howCalculated}
              </div>
              {entry.formula && (
                <div className="font-mono text-[11px] bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-900 dark:text-slate-100">
                  {entry.formula}
                </div>
              )}
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-100">Quantitative note: </span>
                {entry.advancedExplanation}
              </div>
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-100">Limitations: </span>
                {entry.limitations}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setShowAdvancedLocal((v) => !v)}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              {showAdvancedLocal ? 'Hide formula & quant detail' : 'Show formula & quant detail'}
            </button>

            {onOpenGlossaryTerm && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenGlossaryTerm(entry.id);
                }}
                className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
              >
                <BookOpen className="w-3 h-3" />
                <span>Full glossary</span>
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  );
};
