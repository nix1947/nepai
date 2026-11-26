import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

interface InfoTipProps {
  title: string;
  body: string;
  example?: string;
  align?: 'left' | 'right';
}

export const InfoTip: React.FC<InfoTipProps> = ({
  title,
  body,
  example,
  align = 'left',
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

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

  return (
    <span ref={rootRef} className="relative inline-flex items-center align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Learn about ${title}`}
        title={title}
        className="p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-full mt-1.5 z-50 w-72 sm:w-80 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-3 text-left text-xs space-y-1.5 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
              {title}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
              aria-label="Close helper"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-normal">{body}</p>
          {example && (
            <div className="pt-1.5 mt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-blue-700 dark:text-blue-300 font-normal leading-relaxed">
              <span className="font-semibold">Example: </span>
              {example}
            </div>
          )}
        </div>
      )}
    </span>
  );
};
