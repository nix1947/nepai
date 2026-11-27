import type { QuarterCode, SectorGroup } from '../../src/types/fundamental.ts';
import { getNepseSector, type NepseSector } from '../sectors.ts';

export interface ActiveFiscalQuarterInfo {
  fiscalYear: string;
  quarter: QuarterCode;
  quarterEndApprox: string; // YYYY-MM-DD
  checkStartDate: string; // quarterEnd + delayDays (YYYY-MM-DD)
  isDueNow: boolean;
  daysSinceQuarterEnd: number;
}

/**
 * Normalizes a Nepal fiscal year string like "2083/2084", "2083-84", "2083/84" -> "2083/84".
 */
export function normalizeFiscalYear(raw: string): string {
  const m = raw.match(/(20\d{2})\s*[-/]\s*(?:20)?(\d{2})/);
  if (m) {
    const y1 = Number(m[1]);
    const y2 = Number(m[2]);
    const y2Str = String(y2).padStart(2, '0');
    return `${y1}/${y2Str}`;
  }
  const single = raw.match(/(20\d{2})/);
  if (single) {
    const y1 = Number(single[1]);
    const y2Short = String((y1 + 1) % 100).padStart(2, '0');
    return `${y1}/${y2Short}`;
  }
  return raw.trim();
}

export function extractStartBsYear(fiscalYear: string): number | null {
  const m = fiscalYear.match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
}

export function quarterOrderValue(q: QuarterCode): number {
  switch (q) {
    case 'Q1':
      return 1;
    case 'Q2':
      return 2;
    case 'Q3':
      return 3;
    case 'Q4':
      return 4;
    case 'Annual':
      return 5;
  }
}

export function computePeriodSortKey(fiscalYear: string, quarter: QuarterCode): number {
  const y = extractStartBsYear(fiscalYear) ?? 0;
  return y * 10 + quarterOrderValue(quarter);
}

/**
 * Parses ShareSansar / NEPSE period headers such as:
 * - "1st Quarter 2083/2084"
 * - "2nd Quarter 2082/83"
 * - "Q1 FY 2082/83"
 * - "Annual FY 2081/82"
 * - "FY 2081/82"
 */
export function parseNepalPeriodLabel(label: string): {
  fiscalYear: string;
  quarter: QuarterCode;
  sortKey: number;
  periodLabel: string;
} | null {
  const clean = (label || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;

  const fy = normalizeFiscalYear(clean);
  if (!extractStartBsYear(fy)) return null;

  const lower = clean.toLowerCase();
  let quarter: QuarterCode = 'Annual';
  if (
    lower.includes('1st') ||
    lower.includes('first') ||
    /\bq1\b/.test(lower)
  ) {
    quarter = 'Q1';
  } else if (
    lower.includes('2nd') ||
    lower.includes('second') ||
    /\bq2\b/.test(lower)
  ) {
    quarter = 'Q2';
  } else if (
    lower.includes('3rd') ||
    lower.includes('third') ||
    /\bq3\b/.test(lower)
  ) {
    quarter = 'Q3';
  } else if (
    lower.includes('4th') ||
    lower.includes('fourth') ||
    /\bq4\b/.test(lower)
  ) {
    quarter = 'Q4';
  } else if (lower.includes('annual') || lower.includes('fy')) {
    quarter = 'Annual';
  }

  return {
    fiscalYear: fy,
    quarter,
    sortKey: computePeriodSortKey(fy, quarter),
    periodLabel: `${quarter} FY ${fy}`,
  };
}

/**
 * Approximate Gregorian end date for a Nepal Bikram Sambat fiscal quarter.
 * FY Y/(Y+1) starts ~July 16 of Gregorian year (Y - 57):
 * - Q1 (Ashwin end): Oct 17 of (Y - 57)
 * - Q2 (Poush end): Jan 14 of (Y - 56)
 * - Q3 (Chaitra end): Apr 13 of (Y - 56)
 * - Q4 (Ashad end): Jul 16 of (Y - 56)
 */
export function getApproxQuarterEndGregorian(fiscalYear: string, quarter: QuarterCode): Date {
  const startBs = extractStartBsYear(fiscalYear) ?? 2083;
  const gStart = startBs - 57;
  switch (quarter) {
    case 'Q1':
      return new Date(Date.UTC(gStart, 9, 17)); // Oct 17
    case 'Q2':
      return new Date(Date.UTC(gStart + 1, 0, 14)); // Jan 14
    case 'Q3':
      return new Date(Date.UTC(gStart + 1, 3, 13)); // Apr 13
    case 'Q4':
    case 'Annual':
    default:
      return new Date(Date.UTC(gStart + 1, 6, 16)); // Jul 16
  }
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Determines the most recently completed (or active reporting) Nepal fiscal quarter
 * relative to `now`, and whether `quarterEnd + delayDays` (default 15 days) has passed.
 */
export function getActiveNepalFiscalQuarter(
  now: Date = new Date(),
  delayDays = 15
): ActiveFiscalQuarterInfo {
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const approxStartBs = todayUtc.getUTCFullYear() + 57;

  const candidates: Array<{ fy: string; q: QuarterCode; end: Date }> = [];
  for (let bs = approxStartBs - 2; bs <= approxStartBs + 1; bs++) {
    const fy = `${bs}/${String((bs + 1) % 100).padStart(2, '0')}`;
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as QuarterCode[]) {
      candidates.push({ fy, q, end: getApproxQuarterEndGregorian(fy, q) });
    }
  }

  candidates.sort((a, b) => a.end.getTime() - b.end.getTime());

  // Most recent quarter that has already ended on or before today
  let active = candidates[0];
  for (const c of candidates) {
    if (c.end.getTime() <= todayUtc.getTime()) {
      active = c;
    }
  }

  const checkStart = addDaysUtc(active.end, delayDays);
  const daysSince = Math.floor((todayUtc.getTime() - active.end.getTime()) / 86_400_000);

  return {
    fiscalYear: active.fy,
    quarter: active.q,
    quarterEndApprox: active.end.toISOString().slice(0, 10),
    checkStartDate: checkStart.toISOString().slice(0, 10),
    isDueNow: todayUtc.getTime() >= checkStart.getTime(),
    daysSinceQuarterEnd: daysSince,
  };
}

/**
 * Returns the next upcoming Nepal fiscal quarter whose reporting window (+delayDays)
 * is still ahead of `now`, used for scheduling upcoming GitHub Actions / monitor runs.
 */
export function getUpcomingNepalFiscalQuarter(
  now: Date = new Date(),
  delayDays = 15
): ActiveFiscalQuarterInfo {
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const approxStartBs = todayUtc.getUTCFullYear() + 57;

  const candidates: Array<{ fy: string; q: QuarterCode; end: Date }> = [];
  for (let bs = approxStartBs - 1; bs <= approxStartBs + 2; bs++) {
    const fy = `${bs}/${String((bs + 1) % 100).padStart(2, '0')}`;
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as QuarterCode[]) {
      candidates.push({ fy, q, end: getApproxQuarterEndGregorian(fy, q) });
    }
  }

  candidates.sort((a, b) => a.end.getTime() - b.end.getTime());

  const upcoming =
    candidates.find((c) => c.end.getTime() > todayUtc.getTime()) ??
    candidates[candidates.length - 1];

  const checkStart = addDaysUtc(upcoming.end, delayDays);
  const daysSince = Math.floor((todayUtc.getTime() - upcoming.end.getTime()) / 86_400_000);

  return {
    fiscalYear: upcoming.fy,
    quarter: upcoming.q,
    quarterEndApprox: upcoming.end.toISOString().slice(0, 10),
    checkStartDate: checkStart.toISOString().slice(0, 10),
    isDueNow: todayUtc.getTime() >= checkStart.getTime(),
    daysSinceQuarterEnd: daysSince,
  };
}

export function classifySectorGroup(symbol: string, companyName?: string | null, rawSector?: string | null): {
  sector: NepseSector;
  sectorGroup: SectorGroup;
} {
  const sector = getNepseSector(symbol, companyName || rawSector || '');
  const raw = (rawSector || '').toLowerCase();

  let resolvedSector: NepseSector = sector;
  if (raw.includes('commercial bank')) resolvedSector = 'Commercial Banks';
  else if (raw.includes('development bank')) resolvedSector = 'Development Banks';
  else if (raw.includes('finance')) resolvedSector = 'Finance';
  else if (raw.includes('microfinance') || raw.includes('laghubitta')) resolvedSector = 'Microfinance';
  else if (raw.includes('life insurance')) resolvedSector = 'Life Insurance';
  else if (raw.includes('non-life') || raw.includes('non life') || raw.includes('insurance'))
    resolvedSector = 'Non-Life Insurance';
  else if (raw.includes('hydro')) resolvedSector = 'Hydropower';
  else if (raw.includes('manufacturing')) resolvedSector = 'Manufacturing & Processing';
  else if (raw.includes('hotel')) resolvedSector = 'Hotels & Tourism';
  else if (raw.includes('investment')) resolvedSector = 'Investment';

  let sectorGroup: SectorGroup = 'Other';
  if (
    resolvedSector === 'Commercial Banks' ||
    resolvedSector === 'Development Banks' ||
    resolvedSector === 'Finance'
  ) {
    sectorGroup = 'Banking';
  } else if (resolvedSector === 'Microfinance') {
    sectorGroup = 'Microfinance';
  } else if (
    resolvedSector === 'Life Insurance' ||
    resolvedSector === 'Non-Life Insurance'
  ) {
    sectorGroup = 'Insurance';
  } else if (resolvedSector === 'Hydropower') {
    sectorGroup = 'Hydropower';
  } else if (resolvedSector === 'Manufacturing & Processing') {
    sectorGroup = 'Manufacturing';
  }

  return { sector: resolvedSector, sectorGroup };
}

/**
 * Estimates days since publication/collection for freshness flagging.
 */
export function computeFreshnessDays(
  collectionDateIso: string | null,
  now: Date = new Date()
): number | null {
  if (!collectionDateIso) return null;
  const parsed = new Date(collectionDateIso);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000));
}
