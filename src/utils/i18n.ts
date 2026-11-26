import type { AppLanguage } from '../types/market';

export function biText(en: string, ne: string, lang: AppLanguage): string {
  if (lang === 'en') return en;
  if (lang === 'ne') return ne;
  return `${en} · ${ne}`;
}

export const NAV_LABELS: Record<
  'overview' | 'pulse' | 'turnover' | 'direction' | 'scanners' | 'explorer' | 'macro' | 'algorithms' | 'scheduler',
  { en: string; ne: string }
> = {
  overview: { en: 'Overview', ne: 'बजार सारांश' },
  pulse: { en: 'Market Pulse', ne: 'बजार पल्स' },
  turnover: { en: 'Top Turnover', ne: 'शीर्ष कारोबार' },
  direction: { en: 'Turnover × Direction', ne: 'कारोबार × दिशा' },
  scanners: { en: 'Scanners', ne: 'प्राविधिक स्क्यानर' },
  explorer: { en: 'Stock Explorer', ne: 'स्टक विश्लेषण' },
  macro: { en: 'Macro & Risks', ne: 'अर्थतन्त्र र जोखिम' },
  algorithms: { en: 'Algorithms', ne: 'एल्गोरिदम गाइड' },
  scheduler: { en: 'Scheduler & Data', ne: 'तालिका र डाटा' },
};
