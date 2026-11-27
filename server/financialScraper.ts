import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { computePeriodSortKey, parseNepalPeriodLabel } from './fundamental/nepalCalendar.ts';

export interface FinancialTableRow {
  section: string;
  isSectionHeader: boolean;
  particulars: string;
  values: string[];
  numericValues: Array<number | null>;
}

export interface FinancialReportTab {
  key: string;
  title: string;
  headers: string[];
  rows: FinancialTableRow[];
}

export interface CompanyFinancialSnapshot {
  symbol: string;
  companyName: string;
  sector: string;
  companyId: string;
  scrapedAt: string;
  sourceUrl: string;
  periods: string[];
  tabs: FinancialReportTab[];
}

export interface SavedFinancialIndexItem {
  symbol: string;
  companyName: string;
  sector: string;
  scrapedAt: string;
  periods: string[];
  tabTitles: string[];
  jsonFile: string;
  csvFile: string;
}

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function isValidSymbol(symbol: string): boolean {
  return /^[A-Z0-9._-]{1,20}$/.test(symbol);
}

export function ensureFinancialDir(dataDir: string): string {
  const finDir = path.resolve(dataDir, 'financial');
  if (!fs.existsSync(finDir)) {
    fs.mkdirSync(finDir, { recursive: true });
  }
  return finDir;
}

function safeFinancialFilePath(finDir: string, symbol: string, ext: 'json' | 'csv'): string {
  const clean = symbol.trim().toUpperCase();
  if (!isValidSymbol(clean)) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }
  const resolved = path.resolve(finDir, `${clean}.${ext}`);
  if (!resolved.startsWith(finDir + path.sep)) {
    throw new Error('Unsafe file path rejected');
  }
  return resolved;
}

function extractCookies(res: Response): string {
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') {
    const rawCookies = anyHeaders.getSetCookie();
    if (rawCookies.length > 0) {
      return rawCookies.map((c) => c.split(';')[0]).join('; ');
    }
  }
  const single = res.headers.get('set-cookie');
  if (!single) return '';
  return single
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((c) => c.split(';')[0].trim())
    .join('; ');
}

function parseNumericCell(raw: string): number | null {
  const s = raw.replace(/,/g, '').replace(/%/g, '').trim();
  if (!s || s === '-' || s === '--' || s === 'N/A') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function csvCell(v: string): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function canonicalPeriodKey(label: string): { key: string; sortKey: number } {
  const parsed = parseNepalPeriodLabel(label);
  if (parsed) {
    return {
      key: `${parsed.fiscalYear}:${parsed.quarter}`,
      sortKey: parsed.sortKey,
    };
  }
  const clean = (label || '').replace(/\s+/g, ' ').trim();
  return {
    key: clean.toLowerCase(),
    sortKey: computePeriodSortKey(clean, 'Annual'),
  };
}

/**
 * Merges a newly scraped ShareSansar quarterly snapshot with an existing saved snapshot
 * without discarding older historical quarters when ShareSansar rotates columns.
 * Newest quarter appears first; matching (fiscalYear, quarter) slots are refreshed with incoming values.
 */
export function mergeFinancialSnapshots(
  existing: CompanyFinancialSnapshot | null,
  incoming: CompanyFinancialSnapshot
): CompanyFinancialSnapshot {
  if (!existing || !Array.isArray(existing.tabs) || existing.tabs.length === 0) {
    const ordered = [...incoming.periods].sort(
      (a, b) => canonicalPeriodKey(b).sortKey - canonicalPeriodKey(a).sortKey
    );
    if (ordered.join('|') === incoming.periods.join('|')) return incoming;
    // Align row values to canonical newest-first period order
    return {
      ...incoming,
      periods: ordered,
      tabs: incoming.tabs.map((t) => {
        const tabPeriods = t.headers.slice(1);
        const idxByKey = new Map<string, number>();
        tabPeriods.forEach((p, idx) => idxByKey.set(canonicalPeriodKey(p).key, idx));
        return {
          ...t,
          headers: [t.headers[0] || 'Particulars', ...ordered],
          rows: t.rows.map((r) => {
            if (r.isSectionHeader) return r;
            const values = ordered.map((p) => {
              const idx = idxByKey.get(canonicalPeriodKey(p).key);
              return idx !== undefined ? (r.values[idx] ?? '') : '';
            });
            return {
              ...r,
              values,
              numericValues: values.map(parseNumericCell),
            };
          }),
        };
      }),
    };
  }

  // 1. Collect all canonical periods from incoming (preferred label) + existing
  const periodMap = new Map<string, { label: string; sortKey: number }>();
  for (const p of existing.periods ?? []) {
    const meta = canonicalPeriodKey(p);
    if (meta.key && !periodMap.has(meta.key)) {
      periodMap.set(meta.key, { label: p, sortKey: meta.sortKey });
    }
  }
  for (const p of incoming.periods ?? []) {
    const meta = canonicalPeriodKey(p);
    if (meta.key) {
      periodMap.set(meta.key, { label: p, sortKey: meta.sortKey });
    }
  }

  const mergedPeriods = Array.from(periodMap.values())
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((p) => p.label);
  const mergedKeys = mergedPeriods.map((p) => canonicalPeriodKey(p).key);

  // 2. Index existing tabs by key/title
  const existingTabByKey = new Map<string, FinancialReportTab>();
  const existingTabByTitle = new Map<string, FinancialReportTab>();
  for (const t of existing.tabs) {
    existingTabByKey.set(t.key.toLowerCase(), t);
    existingTabByTitle.set(t.title.trim().toLowerCase(), t);
  }

  const buildRowPeriodLookup = (tab: FinancialReportTab, fallbackPeriods: string[]) => {
    const tabPeriods = tab.headers.length > 1 ? tab.headers.slice(1) : fallbackPeriods;
    const periodKeys = tabPeriods.map((p) => canonicalPeriodKey(p).key);
    const map = new Map<string, Map<string, string>>();
    for (const r of tab.rows) {
      const rKey = `${r.section.trim().toLowerCase()}|${r.isSectionHeader ? 'H' : 'R'}|${r.particulars
        .trim()
        .toLowerCase()}`;
      const valMap = new Map<string, string>();
      periodKeys.forEach((pk, idx) => {
        const val = r.values[idx];
        if (val !== undefined && val !== '') {
          valMap.set(pk, val);
        }
      });
      map.set(rKey, valMap);
    }
    return map;
  };

  const mergedTabs: FinancialReportTab[] = [];
  const consumedExistingKeys = new Set<string>();

  const mergeTabPair = (
    incTab: FinancialReportTab | null,
    extTab: FinancialReportTab | null
  ): FinancialReportTab => {
    const base = incTab ?? extTab!;
    const incLookup = incTab ? buildRowPeriodLookup(incTab, incoming.periods) : new Map();
    const extLookup = extTab ? buildRowPeriodLookup(extTab, existing.periods) : new Map();

    const seenRowKeys = new Set<string>();
    const orderedTemplateRows: FinancialTableRow[] = [];

    for (const r of incTab?.rows ?? []) {
      const rKey = `${r.section.trim().toLowerCase()}|${r.isSectionHeader ? 'H' : 'R'}|${r.particulars
        .trim()
        .toLowerCase()}`;
      if (!seenRowKeys.has(rKey)) {
        seenRowKeys.add(rKey);
        orderedTemplateRows.push(r);
      }
    }
    for (const r of extTab?.rows ?? []) {
      const rKey = `${r.section.trim().toLowerCase()}|${r.isSectionHeader ? 'H' : 'R'}|${r.particulars
        .trim()
        .toLowerCase()}`;
      if (!seenRowKeys.has(rKey)) {
        seenRowKeys.add(rKey);
        orderedTemplateRows.push(r);
      }
    }

    const mergedRows: FinancialTableRow[] = orderedTemplateRows.map((r) => {
      if (r.isSectionHeader) return r;
      const rKey = `${r.section.trim().toLowerCase()}|R|${r.particulars.trim().toLowerCase()}`;
      const incVals: Map<string, string> | undefined = incLookup.get(rKey);
      const extVals: Map<string, string> | undefined = extLookup.get(rKey);
      const values = mergedKeys.map((pk) => {
        const iv = incVals?.get(pk);
        if (iv !== undefined && iv !== '') return iv;
        const ev = extVals?.get(pk);
        if (ev !== undefined && ev !== '') return ev;
        return '';
      });
      return {
        ...r,
        values,
        numericValues: values.map(parseNumericCell),
      };
    });

    const labelColHeader = base.headers[0] || 'Particulars';
    return {
      key: base.key,
      title: base.title,
      headers: [labelColHeader, ...mergedPeriods],
      rows: mergedRows,
    };
  };

  for (const incTab of incoming.tabs) {
    const extMatch =
      existingTabByKey.get(incTab.key.toLowerCase()) ??
      existingTabByTitle.get(incTab.title.trim().toLowerCase()) ??
      null;
    if (extMatch) {
      consumedExistingKeys.add(extMatch.key.toLowerCase());
    }
    mergedTabs.push(mergeTabPair(incTab, extMatch));
  }

  for (const extTab of existing.tabs) {
    if (!consumedExistingKeys.has(extTab.key.toLowerCase())) {
      mergedTabs.push(mergeTabPair(null, extTab));
    }
  }

  return {
    symbol: incoming.symbol,
    companyName: incoming.companyName || existing.companyName,
    sector: incoming.sector && incoming.sector !== 'Unknown' ? incoming.sector : existing.sector,
    companyId: incoming.companyId || existing.companyId,
    scrapedAt: incoming.scrapedAt,
    sourceUrl: incoming.sourceUrl || existing.sourceUrl,
    periods: mergedPeriods,
    tabs: mergedTabs,
  };
}

export function buildFinancialCsv(snapshot: CompanyFinancialSnapshot): string {
  const periodCols = snapshot.periods.length > 0 ? snapshot.periods : ['Latest Quarter'];
  const header = ['Symbol', 'Tab', 'Section', 'Particulars', ...periodCols];
  const lines = [header.map(csvCell).join(',')];

  for (const tab of snapshot.tabs) {
    for (const row of tab.rows) {
      if (row.isSectionHeader) continue;
      const paddedValues = periodCols.map((_, idx) => row.values[idx] ?? '');
      lines.push(
        [snapshot.symbol, tab.title, row.section, row.particulars, ...paddedValues]
          .map(csvCell)
          .join(',')
      );
    }
  }
  return lines.join('\n') + '\n';
}

export async function scrapeCompanyFinancials(
  dataDir: string,
  rawSymbol: string
): Promise<CompanyFinancialSnapshot> {
  const symbolUpper = rawSymbol.trim().toUpperCase();
  if (!isValidSymbol(symbolUpper)) {
    throw new Error('Invalid ticker symbol');
  }

  const companyUrl = `https://www.sharesansar.com/company/${encodeURIComponent(
    symbolUpper.toLowerCase()
  )}`;
  const res1 = await fetch(companyUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!res1.ok) {
    throw new Error(`Financial portal returned HTTP ${res1.status} for ${symbolUpper}`);
  }

  const cookieHeader = extractCookies(res1);
  const html1 = await res1.text();
  const $1 = cheerio.load(html1);

  const token =
    $1('meta[name="_token"]').attr('content') ||
    $1('meta[name=_token]').attr('content') ||
    $1('input[name="_token"]').val()?.toString() ||
    '';

  const companyId = $1('#companyid').text().trim();
  const pageSymbol = $1('#symbol').text().trim().toUpperCase() || symbolUpper;
  const sector = $1('#sector').text().trim() || 'Unknown';
  const rawTitle = $1('title').text().trim();
  const companyName = rawTitle.split('- ||')[0]?.trim() || pageSymbol;

  if (!token || !companyId) {
    throw new Error(`Quarterly report metadata not available for ${symbolUpper}`);
  }

  const body = new URLSearchParams({
    company: companyId,
    symbol: pageSymbol,
    sector,
  });

  const res2 = await fetch('https://www.sharesansar.com/company-quarterly-report', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'User-Agent': USER_AGENT,
      'X-CSRF-Token': token,
      Cookie: cookieHeader,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: companyUrl,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'text/html, */*; q=0.01',
    },
    body: body.toString(),
  });

  if (!res2.ok) {
    throw new Error(`Quarterly report POST returned HTTP ${res2.status} for ${symbolUpper}`);
  }

  const qtrHtml = await res2.text();
  const $2 = cheerio.load(qtrHtml);

  const tabMap = new Map<string, string>();
  $2('ul.nav-tabs a, .nav-tabs a, a[data-toggle="tab"]').each((_, el) => {
    const href = ($2(el).attr('href') || '').trim();
    const title = $2(el).text().replace(/\s+/g, ' ').trim();
    if (href.startsWith('#') && title) {
      tabMap.set(href.slice(1), title);
    }
  });

  const tabs: FinancialReportTab[] = [];
  const allPeriodsSet = new Set<string>();

  $2('.tab-pane').each((idx, pane) => {
    const paneEl = $2(pane);
    const key = paneEl.attr('id')?.trim() || `tab_${idx}`;
    const title = tabMap.get(key) || key.toUpperCase();
    const table = paneEl.find('table').first();
    if (!table.length) return;

    const headers: string[] = [];
    table
      .find('thead tr')
      .last()
      .find('th, td')
      .each((_, th) => {
        const text = $2(th).text().replace(/\s+/g, ' ').trim();
        if (text) headers.push(text);
      });

    if (headers.length === 0) {
      table
        .find('tr')
        .first()
        .find('th')
        .each((_, th) => {
          const text = $2(th).text().replace(/\s+/g, ' ').trim();
          if (text) headers.push(text);
        });
    }

    for (const p of headers.slice(1)) {
      allPeriodsSet.add(p);
    }

    const rows: FinancialTableRow[] = [];
    let currentSection = 'General';

    table.find('tbody tr').each((_, tr) => {
      const cells = $2(tr)
        .find('td, th')
        .map((__, td) => $2(td).text().replace(/\s+/g, ' ').trim())
        .get();

      if (cells.length === 0) return;
      if (cells.length === 1 || (cells[0] && cells.slice(1).every((c) => !c))) {
        currentSection = cells[0];
        rows.push({
          section: currentSection,
          isSectionHeader: true,
          particulars: cells[0],
          values: [],
          numericValues: [],
        });
        return;
      }

      const particulars = cells[0];
      if (!particulars) return;
      const values = cells.slice(1);
      rows.push({
        section: currentSection,
        isSectionHeader: false,
        particulars,
        values,
        numericValues: values.map(parseNumericCell),
      });
    });

    if (rows.length > 0) {
      tabs.push({ key, title, headers, rows });
    }
  });

  if (tabs.length === 0) {
    throw new Error(`No quarterly financial tables found for ${symbolUpper}`);
  }

  const finDir = ensureFinancialDir(dataDir);
  const existingSnapshot = getSavedFinancials(dataDir, pageSymbol);
  const snapshot = mergeFinancialSnapshots(existingSnapshot, {
    symbol: pageSymbol,
    companyName,
    sector,
    companyId,
    scrapedAt: new Date().toISOString(),
    sourceUrl: companyUrl,
    periods: Array.from(allPeriodsSet),
    tabs,
  });

  const jsonPath = safeFinancialFilePath(finDir, pageSymbol, 'json');
  const csvPath = safeFinancialFilePath(finDir, pageSymbol, 'csv');

  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2), 'utf8');
  fs.writeFileSync(csvPath, buildFinancialCsv(snapshot), 'utf8');

  return snapshot;
}

export function getSavedFinancials(
  dataDir: string,
  symbol: string
): CompanyFinancialSnapshot | null {
  const clean = symbol.trim().toUpperCase();
  if (!isValidSymbol(clean)) return null;
  const finDir = ensureFinancialDir(dataDir);
  const jsonPath = safeFinancialFilePath(finDir, clean, 'json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as CompanyFinancialSnapshot;
  } catch {
    return null;
  }
}

export function getSavedFinancialCsvPath(dataDir: string, symbol: string): string | null {
  const clean = symbol.trim().toUpperCase();
  if (!isValidSymbol(clean)) return null;
  const finDir = ensureFinancialDir(dataDir);
  const csvPath = safeFinancialFilePath(finDir, clean, 'csv');
  return fs.existsSync(csvPath) ? csvPath : null;
}

export function listSavedFinancials(dataDir: string): SavedFinancialIndexItem[] {
  const finDir = ensureFinancialDir(dataDir);
  const files = fs.readdirSync(finDir).filter((f) => f.endsWith('.json')).sort();
  const list: SavedFinancialIndexItem[] = [];

  for (const file of files) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(finDir, file), 'utf8')
      ) as CompanyFinancialSnapshot;
      list.push({
        symbol: parsed.symbol,
        companyName: parsed.companyName,
        sector: parsed.sector,
        scrapedAt: parsed.scrapedAt,
        periods: parsed.periods ?? [],
        tabTitles: (parsed.tabs ?? []).map((t) => t.title),
        jsonFile: `data/financial/${parsed.symbol}.json`,
        csvFile: `data/financial/${parsed.symbol}.csv`,
      });
    } catch {
      // skip corrupt json
    }
  }
  return list;
}

export async function scrapeBatchFinancials(
  dataDir: string,
  symbols: string[]
): Promise<{
  total: number;
  succeeded: string[];
  failed: Array<{ symbol: string; error: string }>;
}> {
  const unique = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter(isValidSymbol))
  ).slice(0, 30);
  const succeeded: string[] = [];
  const failed: Array<{ symbol: string; error: string }> = [];

  for (const sym of unique) {
    try {
      await scrapeCompanyFinancials(dataDir, sym);
      succeeded.push(sym);
    } catch (err) {
      failed.push({
        symbol: sym,
        error: err instanceof Error ? err.message : 'Fetch failed',
      });
    }
    // Polite pacing between ShareSansar requests
    await new Promise((r) => setTimeout(r, 180));
  }

  return { total: unique.length, succeeded, failed };
}
