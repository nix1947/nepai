import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  CompanyKnowledgeBaseEntry,
  KnowledgeBaseResponse,
  KnowledgeBaseSummary,
  RatingOutlook,
  RegulatoryAgency,
  RegulatoryKbCitation,
  RegulatoryKbNotice,
  RegulatoryStanding,
  SectorGroup,
} from '../../src/types/fundamental.ts';
import type { MarketStore } from '../marketStore.ts';
import { getNepseSector } from '../sectors.ts';
import { FundamentalVault } from './fundamentalVault.ts';
import { classifySectorGroup } from './nepalCalendar.ts';

export const ALL_AGENCIES: RegulatoryAgency[] = [
  'ICRA',
  'CARE',
  'NRB',
  'NIA',
  'SEBON',
  'NEPSE',
  'CDSC',
];

const AGENCY_DIRECT_URLS: Record<RegulatoryAgency, string[]> = {
  ICRA: ['https://www.icranepal.com/recent-rating/', 'https://www.icranepal.com/'],
  CARE: ['https://www.careratingsnepal.com/', 'https://www.careratingsnepal.com/rating-list/'],
  NRB: ['https://www.nrb.org.np/category/notices/', 'https://www.nrb.org.np/category/circulars/'],
  NIA: ['https://nia.gov.np/', 'https://nia.gov.np/category/notice/'],
  SEBON: ['https://www.sebon.gov.np/notices', 'https://www.sebon.gov.np/'],
  NEPSE: ['https://www.nepalstock.com/news', 'https://www.nepalstock.com/'],
  CDSC: ['https://cdsc.com.np/', 'https://cdsc.com.np/notice'],
};

const AGENCY_SEARCH_SPEC: Record<
  RegulatoryAgency,
  { label: string; domainHint: string; focus: string }
> = {
  ICRA: {
    label: 'ICRA Nepal',
    domainHint: 'site:icranepal.com',
    focus:
      'Latest ICRA Nepal issuer ratings, bank/insurance/hydropower/manufacturing credit rating actions, rating grades (e.g. [ICRANP-IR] A-, BBB+), outlooks, upgrades, downgrades, and rationales for NEPSE-listed companies.',
  },
  CARE: {
    label: 'CARE Ratings Nepal',
    domainHint: 'site:careratingsnepal.com',
    focus:
      'Latest CARE Ratings Nepal issuer and bank facility ratings (e.g. CARE-NP A-, BBB+), outlooks, watch statuses, and rating rationales for NEPSE-listed companies.',
  },
  NRB: {
    label: 'Nepal Rastra Bank (NRB)',
    domainHint: 'site:nrb.org.np',
    focus:
      'Latest NRB monthly/quarterly BFI financial stability reports, commercial bank/development bank/microfinance directives, NPL/CAR/CD ratio rules, base rate and dividend cap notices affecting BFIs.',
  },
  NIA: {
    label: 'Nepal Insurance Authority (nia.gov.np)',
    domainHint: 'site:nia.gov.np',
    focus:
      'Latest Nepal Insurance Authority (Beema Pradhikaran / nia.gov.np) life and non-life insurance monthly business reports, solvency ratio circulars, paid-up capital compliance, and claim/premium directives.',
  },
  SEBON: {
    label: 'Securities Board of Nepal (SEBON)',
    domainHint: 'site:sebon.gov.np',
    focus:
      'Latest SEBON IPO/FPO/Right Share/Debenture pipeline approvals, regulatory circulars, margin lending or lock-in rules, and corporate governance/compliance enforcement notices.',
  },
  NEPSE: {
    label: 'Nepal Stock Exchange (NEPSE)',
    domainHint: 'site:nepalstock.com',
    focus:
      'Latest NEPSE corporate disclosures, book closure / dividend announcements, AGM notices, listing updates, and trading suspension or price-sensitive alerts.',
  },
  CDSC: {
    label: 'CDS and Clearing Ltd (CDSC)',
    domainHint: 'site:cdsc.com.np',
    focus:
      'Latest CDSC notices on demat share credit, bonus/right share listing, promoter/public share lock-in expiry disclosures, and MeroShare corporate action settlements.',
  },
};

interface PersistedRegulatoryKb {
  notices: RegulatoryKbNotice[];
  companies: Record<string, CompanyKnowledgeBaseEntry>;
  agencyLastFetch: Partial<Record<RegulatoryAgency, string>>;
  lastHarvestAt: string | null;
}

function makeNoticeId(agency: RegulatoryAgency, title: string, url: string | null): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${agency}|${title.toLowerCase().trim()}|${url || ''}`)
    .digest('hex')
    .slice(0, 14);
  return `${agency.toLowerCase()}_${hash}`;
}

function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function extractRatingFromText(text: string): {
  agency: 'ICRA' | 'CARE' | null;
  grade: string | null;
  outlook: RatingOutlook;
} {
  const icraMatch = text.match(/\[?ICRANP(?:-IR)?\]?\s*(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|C[+-]?|D)\b/i);
  const careMatch = text.match(/CARE-NP\s*(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|C[+-]?|D)\b/i);
  let agency: 'ICRA' | 'CARE' | null = null;
  let grade: string | null = null;
  if (icraMatch) {
    agency = 'ICRA';
    grade = `[ICRANP-IR] ${icraMatch[1].toUpperCase()}`;
  } else if (careMatch) {
    agency = 'CARE';
    grade = `CARE-NP ${careMatch[1].toUpperCase()}`;
  }

  const lower = text.toLowerCase();
  let outlook: RatingOutlook = 'Not Rated';
  if (grade) outlook = 'Stable';
  if (lower.includes('positive outlook') || lower.includes('outlook: positive') || lower.includes('upgraded')) {
    outlook = 'Positive';
  } else if (
    lower.includes('negative outlook') ||
    lower.includes('outlook: negative') ||
    lower.includes('downgraded')
  ) {
    outlook = 'Negative';
  } else if (lower.includes('watch') || lower.includes('under review')) {
    outlook = 'Watch';
  } else if (lower.includes('stable')) {
    outlook = 'Stable';
  }

  return { agency, grade, outlook };
}

function parseJsonObjectSafe(rawText: string): Record<string, unknown> | null {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractGroundingCitations(
  response: GenerateContentResponse,
  defaultAgency: RegulatoryAgency
): RegulatoryKbCitation[] {
  const seen = new Set<string>();
  const out: RegulatoryKbCitation[] = [];
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  for (const ch of chunks) {
    const uri = safeHttpUrl(ch?.web?.uri);
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    const title = (ch?.web?.title || uri).trim();
    const lower = `${uri} ${title}`.toLowerCase();
    let agency: RegulatoryAgency = defaultAgency;
    if (lower.includes('icranepal')) agency = 'ICRA';
    else if (lower.includes('careratingsnepal')) agency = 'CARE';
    else if (lower.includes('nrb.org')) agency = 'NRB';
    else if (lower.includes('nia.gov') || lower.includes('beema')) agency = 'NIA';
    else if (lower.includes('sebon')) agency = 'SEBON';
    else if (lower.includes('nepalstock')) agency = 'NEPSE';
    else if (lower.includes('cdsc')) agency = 'CDSC';
    out.push({ title, uri, agency });
  }
  return out;
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

function normalizeOutlook(raw: unknown, hasGrade: boolean): RatingOutlook {
  const s = String(raw || '').toLowerCase();
  if (s.includes('pos')) return 'Positive';
  if (s.includes('neg')) return 'Negative';
  if (s.includes('watch')) return 'Watch';
  if (s.includes('stab')) return 'Stable';
  return hasGrade ? 'Stable' : 'Not Rated';
}

function normalizeStanding(raw: unknown): RegulatoryStanding {
  const s = String(raw || '').toLowerCase();
  if (s.includes('alert') || s.includes('violation') || s.includes('penalty') || s.includes('suspend')) {
    return 'Alert';
  }
  if (s.includes('watch') || s.includes('caution')) return 'Watch';
  if (s.includes('pos') || s.includes('tailwind') || s.includes('approv')) return 'Positive';
  if (s.includes('clean') || s.includes('complian')) return 'Clean';
  return 'Unknown';
}

function strOrNull(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (
    lower === 'unavailable' ||
    lower === 'null' ||
    lower === 'n/a' ||
    lower === 'none' ||
    lower === 'not available'
  ) {
    return null;
  }
  return s;
}

function strArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x || '').trim())
    .filter((s) => s.length > 0 && s.toLowerCase() !== 'none' && s.toLowerCase() !== 'unavailable');
}

export class RegulatoryKnowledgeBase {
  public readonly kbPath: string;
  private dataDir: string;
  private state: PersistedRegulatoryKb = {
    notices: [],
    companies: {},
    agencyLastFetch: {},
    lastHarvestAt: null,
  };
  private loaded = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    const vaultDir = path.join(dataDir, 'financial', 'vault');
    if (!fs.existsSync(vaultDir)) {
      fs.mkdirSync(vaultDir, { recursive: true });
    }
    this.kbPath = path.join(vaultDir, 'regulatory-kb.json');
  }

  public initIfNeeded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(this.kbPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.kbPath, 'utf8')) as Partial<PersistedRegulatoryKb>;
        this.state = {
          notices: Array.isArray(parsed.notices) ? parsed.notices : [],
          companies: parsed.companies && typeof parsed.companies === 'object' ? parsed.companies : {},
          agencyLastFetch:
            parsed.agencyLastFetch && typeof parsed.agencyLastFetch === 'object'
              ? parsed.agencyLastFetch
              : {},
          lastHarvestAt: typeof parsed.lastHarvestAt === 'string' ? parsed.lastHarvestAt : null,
        };
      }
    } catch {
      // start fresh if corrupt
    }

    // Seed from existing cached macro & fundamental intel caches on disk (real data only)
    if (this.state.notices.length === 0 && Object.keys(this.state.companies).length === 0) {
      this.seedFromExistingCaches();
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.kbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.kbPath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {
      // ignore disk write issues
    }
  }

  private seedFromExistingCaches(): void {
    let changed = false;
    const nowIso = new Date().toISOString();

    // 1. Seed regulatoryUpdates from data/.macro-rates-cache.json
    const macroPath = path.join(this.dataDir, '.macro-rates-cache.json');
    if (fs.existsSync(macroPath)) {
      try {
        const macro = JSON.parse(fs.readFileSync(macroPath, 'utf8')) as {
          generatedAt?: string;
          regulatoryUpdates?: Array<{
            authority?: string;
            date?: string;
            title?: string;
            summary?: string;
            impact?: string;
            impactedSectors?: string[];
          }>;
        };
        for (const u of macro.regulatoryUpdates || []) {
          const authRaw = String(u.authority || '').toUpperCase();
          const agency: RegulatoryAgency =
            authRaw === 'NRB' ||
            authRaw === 'NIA' ||
            authRaw === 'SEBON' ||
            authRaw === 'NEPSE' ||
            authRaw === 'CDSC' ||
            authRaw === 'ICRA' ||
            authRaw === 'CARE'
              ? (authRaw as RegulatoryAgency)
              : 'NRB';
          const title = String(u.title || '').trim();
          const summary = String(u.summary || '').trim();
          if (!title || !summary) continue;
          const sectorGroups: SectorGroup[] = Array.from(
            new Set((u.impactedSectors || []).map((s) => classifySectorGroup(s, '').sectorGroup))
          );
          const impact =
            u.impact === 'Positive' || u.impact === 'Negative' || u.impact === 'Mixed'
              ? u.impact
              : 'Neutral';
          this.upsertNotice({
            id: makeNoticeId(agency, title, null),
            agency,
            title,
            publishedDate: String(u.date || 'Recent'),
            summary,
            url: null,
            symbols: [],
            sectorGroups,
            impact,
            ratingGrade: null,
            ratingOutlook: 'Not Rated',
            retrievedAt: macro.generatedAt || nowIso,
            method: 'Cached Macro',
          });
          changed = true;
        }
      } catch {
        // ignore
      }
    }

    // 2. Seed existing governance/regulatory flags from data/.fundamental-intel.json
    const intelPath = path.join(this.dataDir, '.fundamental-intel.json');
    if (fs.existsSync(intelPath)) {
      try {
        const intel = JSON.parse(fs.readFileSync(intelPath, 'utf8')) as Record<
          string,
          {
            symbol?: string;
            companyName?: string;
            sector?: string;
            generatedAt?: string;
            governanceRegulatoryFlags?: string[];
            fundamentalRedFlags?: string[];
            macroLinkage?: string;
            sources?: Array<{ title?: string; uri?: string; category?: string }>;
          }
        >;
        for (const [sym, item] of Object.entries(intel)) {
          if (!item || !sym) continue;
          const flags = [
            ...(item.governanceRegulatoryFlags || []),
            ...(item.fundamentalRedFlags || []),
          ].filter(Boolean);
          const citations: RegulatoryKbCitation[] = (item.sources || [])
            .map((s) => {
              const uri = safeHttpUrl(s.uri);
              if (!uri) return null;
              const lower = uri.toLowerCase();
              const agency: RegulatoryAgency = lower.includes('nrb')
                ? 'NRB'
                : lower.includes('nia')
                  ? 'NIA'
                  : lower.includes('sebon')
                    ? 'SEBON'
                    : lower.includes('icra')
                      ? 'ICRA'
                      : lower.includes('care')
                        ? 'CARE'
                        : lower.includes('cdsc')
                          ? 'CDSC'
                          : 'NEPSE';
              return { title: String(s.title || uri), uri, agency };
            })
            .filter((c): c is RegulatoryKbCitation => Boolean(c));

          if (flags.length === 0 && citations.length === 0) continue;
          const sector = item.sector || getNepseSector(sym, item.companyName);
          const { sectorGroup } = classifySectorGroup(sector, item.companyName || sym);
          this.state.companies[sym.toUpperCase()] = {
            symbol: sym.toUpperCase(),
            companyName: item.companyName || sym.toUpperCase(),
            sector,
            sectorGroup,
            updatedAt: item.generatedAt || nowIso,
            dataStatus: 'Cached',
            creditRating: {
              agency: null,
              ratingGrade: null,
              outlook: 'Not Rated',
              ratingAction: null,
              rationale: null,
              lastRatedDate: null,
            },
            regulatoryStanding: flags.length > 0 ? 'Watch' : 'Clean',
            nrbAssessment: null,
            niaAssessment: null,
            sebonStatus: null,
            nepseDisclosures: null,
            cdscStatus: null,
            lockInOverhangFlag: false,
            tailwinds: [],
            riskFlags: flags,
            citations,
          };
          changed = true;
        }
      } catch {
        // ignore
      }
    }

    if (changed) {
      this.save();
    }
  }

  private upsertNotice(notice: RegulatoryKbNotice): void {
    const idx = this.state.notices.findIndex((n) => n.id === notice.id);
    if (idx >= 0) {
      const existing = this.state.notices[idx];
      this.state.notices[idx] = {
        ...existing,
        ...notice,
        symbols: Array.from(new Set([...existing.symbols, ...notice.symbols])),
        sectorGroups: Array.from(new Set([...existing.sectorGroups, ...notice.sectorGroups])),
      };
    } else {
      this.state.notices.unshift(notice);
    }
    if (this.state.notices.length > 400) {
      this.state.notices = this.state.notices.slice(0, 400);
    }
  }

  public getCompanyEntry(symbol: string): CompanyKnowledgeBaseEntry | null {
    this.initIfNeeded();
    return this.state.companies[symbol.toUpperCase()] ?? null;
  }

  public getAllCompanyEntries(): Map<string, CompanyKnowledgeBaseEntry> {
    this.initIfNeeded();
    return new Map(Object.entries(this.state.companies));
  }

  public getSummary(): KnowledgeBaseSummary {
    this.initIfNeeded();
    const byAgency: Record<RegulatoryAgency, number> = {
      ICRA: 0,
      CARE: 0,
      NRB: 0,
      NIA: 0,
      SEBON: 0,
      NEPSE: 0,
      CDSC: 0,
    };
    for (const n of this.state.notices) {
      if (byAgency[n.agency] !== undefined) {
        byAgency[n.agency]++;
      }
    }
    return {
      totalCompaniesIndexed: Object.keys(this.state.companies).length,
      totalNotices: this.state.notices.length,
      byAgency,
      lastHarvestAt: this.state.lastHarvestAt,
      agencyLastFetch: { ...this.state.agencyLastFetch },
    };
  }

  public queryKnowledgeBase(params?: {
    agency?: RegulatoryAgency | 'ALL';
    symbol?: string;
    q?: string;
  }): KnowledgeBaseResponse {
    this.initIfNeeded();
    const summary = this.getSummary();
    let notices = [...this.state.notices];
    let companies = Object.values(this.state.companies);

    if (params?.agency && params.agency !== 'ALL') {
      notices = notices.filter((n) => n.agency === params.agency);
    }
    if (params?.symbol) {
      const sym = params.symbol.trim().toUpperCase();
      notices = notices.filter((n) => n.symbols.includes(sym));
      companies = companies.filter((c) => c.symbol === sym);
    }
    if (params?.q) {
      const q = params.q.trim().toLowerCase();
      notices = notices.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.summary.toLowerCase().includes(q) ||
          n.symbols.some((s) => s.toLowerCase().includes(q)) ||
          (n.ratingGrade || '').toLowerCase().includes(q)
      );
      companies = companies.filter(
        (c) =>
          c.symbol.toLowerCase().includes(q) ||
          c.companyName.toLowerCase().includes(q) ||
          (c.creditRating.ratingGrade || '').toLowerCase().includes(q) ||
          (c.nrbAssessment || '').toLowerCase().includes(q) ||
          (c.niaAssessment || '').toLowerCase().includes(q) ||
          (c.sebonStatus || '').toLowerCase().includes(q) ||
          (c.cdscStatus || '').toLowerCase().includes(q)
      );
    }

    companies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { summary, notices, companies };
  }

  private buildUniverseLookup(store: MarketStore): Array<{
    symbol: string;
    name: string;
    keywords: string[];
    sectorGroup: SectorGroup;
  }> {
    const dates = store.getDates();
    const latest = dates[dates.length - 1];
    if (!latest) return [];
    return store.getSymbols(latest, false).map((s) => {
      const cleanName = s.name
        .replace(/\b(Limited|Ltd\.?|Pvt\.?|Nepal|Company|Co\.?|Bank|Hydropower|Development|Microfinance|Laghubitta|Bittiya|Sanstha|Insurance)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const words = cleanName.split(' ').filter((w) => w.length >= 4);
      return {
        symbol: s.symbol.toUpperCase(),
        name: s.name,
        keywords: words.slice(0, 2),
        sectorGroup: classifySectorGroup(getNepseSector(s.symbol, s.name), s.name).sectorGroup,
      };
    });
  }

  private matchSymbolsInText(
    text: string,
    universe: Array<{ symbol: string; name: string; keywords: string[]; sectorGroup: SectorGroup }>
  ): string[] {
    const upper = text.toUpperCase();
    const lower = text.toLowerCase();
    const matched = new Set<string>();
    for (const item of universe) {
      if (new RegExp(`\\b${item.symbol}\\b`).test(upper)) {
        matched.add(item.symbol);
        continue;
      }
      if (item.keywords.length >= 2 && item.keywords.every((kw) => lower.includes(kw))) {
        matched.add(item.symbol);
      }
    }
    return Array.from(matched).slice(0, 6);
  }

  private async directScrapeAgency(
    agency: RegulatoryAgency,
    universe: Array<{ symbol: string; name: string; keywords: string[]; sectorGroup: SectorGroup }>
  ): Promise<{ notices: RegulatoryKbNotice[]; errors: string[] }> {
    const urls = AGENCY_DIRECT_URLS[agency] || [];
    const out: RegulatoryKbNotice[] = [];
    const errors: string[] = [];
    const nowIso = new Date().toISOString();

    for (const targetUrl of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(targetUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        if (!res.ok) {
          errors.push(`${targetUrl}: HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        const $ = cheerio.load(html);
        const candidates: Array<{ title: string; href: string | null; date: string }> = [];

        $('a').each((_i, el) => {
          const text = $(el).text().replace(/\s+/g, ' ').trim();
          const hrefRaw = $(el).attr('href');
          if (text.length < 18 || text.length > 220) return;
          const lower = text.toLowerCase();
          if (
            lower.includes('skip to') ||
            lower.includes('read more') ||
            lower.includes('home') ||
            lower.includes('contact us') ||
            lower.includes('privacy policy')
          ) {
            return;
          }
          let resolved: string | null = null;
          if (hrefRaw) {
            try {
              resolved = safeHttpUrl(new URL(hrefRaw, targetUrl).toString());
            } catch {
              resolved = null;
            }
          }
          const parentText = $(el).parent().text().replace(/\s+/g, ' ').trim();
          const dateMatch = parentText.match(/\b(20\d{2}[-/]\d{2}[-/]\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/i);
          candidates.push({
            title: text,
            href: resolved,
            date: dateMatch ? dateMatch[1] : 'Recent',
          });
        });

        const unique = new Map<string, { title: string; href: string | null; date: string }>();
        for (const c of candidates) {
          const key = c.title.toLowerCase();
          if (!unique.has(key)) unique.set(key, c);
        }

        const picked = Array.from(unique.values()).slice(0, 12);
        for (const item of picked) {
          const syms = this.matchSymbolsInText(item.title, universe);
          const rating = extractRatingFromText(item.title);
          const sectorGroups: SectorGroup[] = Array.from(
            new Set(
              syms
                .map((s) => universe.find((u) => u.symbol === s)?.sectorGroup)
                .filter((g): g is SectorGroup => Boolean(g))
            )
          );
          if (sectorGroups.length === 0) {
            if (agency === 'NRB') sectorGroups.push('Banking', 'Microfinance');
            else if (agency === 'NIA') sectorGroups.push('Insurance');
          }

          const notice: RegulatoryKbNotice = {
            id: makeNoticeId(agency, item.title, item.href),
            agency,
            title: item.title,
            publishedDate: item.date,
            summary: `Direct portal feed from ${AGENCY_SEARCH_SPEC[agency].label}: ${item.title}`,
            url: item.href || targetUrl,
            symbols: syms,
            sectorGroups,
            impact:
              rating.outlook === 'Positive'
                ? 'Positive'
                : rating.outlook === 'Negative'
                  ? 'Negative'
                  : 'Neutral',
            ratingGrade: rating.grade,
            ratingOutlook: rating.outlook,
            retrievedAt: nowIso,
            method: 'Direct Scrape',
          };
          out.push(notice);
        }

        if (out.length > 0) break;
      } catch (err) {
        errors.push(`${targetUrl}: ${err instanceof Error ? err.message : 'fetch failed'}`);
      } finally {
        clearTimeout(timer);
      }
    }

    return { notices: out, errors };
  }

  private async searchGroundedAgencyHarvest(
    agencies: RegulatoryAgency[],
    universe: Array<{ symbol: string; name: string; keywords: string[]; sectorGroup: SectorGroup }>
  ): Promise<{ notices: RegulatoryKbNotice[]; companiesUpdated: number; warning: string | null }> {
    const ai = getAiClient();
    if (!ai) {
      return {
        notices: [],
        companiesUpdated: 0,
        warning:
          'GEMINI_API_KEY is not configured; live search-grounded regulatory harvesting was skipped (only direct agency portal scrapes ran).',
      };
    }

    const agencyInstructions = agencies
      .map((a) => `- ${a} (${AGENCY_SEARCH_SPEC[a].domainHint}): ${AGENCY_SEARCH_SPEC[a].focus}`)
      .join('\n');

    const prompt = `You are a Nepal capital-markets regulatory intelligence researcher.
Use Google Search to retrieve recent, VERIFIED disclosures, ratings, and regulatory circulars from the following Nepali agencies:
${agencyInstructions}

STRICT ANTI-FABRICATION RULE:
- Report ONLY verified circulars, credit ratings, or disclosures found in your search results.
- Never guess or invent rating grades, company names, or dates. If a detail is unverified, omit it or set null.
- Map NEPSE ticker symbols accurately when a listed company is mentioned (e.g., NABIL, GBIME, NLIC, SHIVM, CHCL, SCB, EBL, HBL, CIT, NRIC, etc.).

Return ONLY valid JSON matching this schema:
{
  "notices": [
    {
      "agency": "${agencies[0]}",
      "title": "Exact notice or rating headline",
      "publishedDate": "YYYY-MM-DD or Month YYYY",
      "summary": "2-sentence factual summary of regulatory/rating impact",
      "url": "Direct official URL if found, else null",
      "symbols": ["TICKER"],
      "sectorGroups": ["Banking" | "Microfinance" | "Insurance" | "Hydropower" | "Manufacturing" | "Other"],
      "impact": "Positive" | "Neutral" | "Negative" | "Mixed",
      "ratingGrade": "e.g. [ICRANP-IR] A- or CARE-NP BBB+ (or null)",
      "ratingOutlook": "Positive" | "Stable" | "Negative" | "Watch" | "Not Rated",
      "ratingAction": "e.g. Reaffirmed / Upgraded / Downgraded / Assigned (or null)",
      "cdscLockInFlag": false
    }
  ]
}`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] },
      });

      const parsed = parseJsonObjectSafe(response.text || '');
      const groundingCitations = extractGroundingCitations(response, agencies[0]);
      const nowIso = new Date().toISOString();
      const rawNotices = Array.isArray(parsed?.notices) ? parsed.notices : [];
      const outNotices: RegulatoryKbNotice[] = [];
      let companiesUpdated = 0;

      for (const raw of rawNotices) {
        if (!raw || typeof raw !== 'object') continue;
        const o = raw as Record<string, unknown>;
        const agRaw = String(o.agency || agencies[0]).toUpperCase();
        const agency: RegulatoryAgency = ALL_AGENCIES.includes(agRaw as RegulatoryAgency)
          ? (agRaw as RegulatoryAgency)
          : agencies[0];
        const title = strOrNull(o.title);
        const summary = strOrNull(o.summary);
        if (!title || !summary) continue;

        const fallbackCitation = groundingCitations.find((c) => c.agency === agency) || groundingCitations[0];
        const url = safeHttpUrl(o.url) || fallbackCitation?.uri || null;
        const explicitSyms = strArray(o.symbols).map((s) => s.toUpperCase());
        const textMatched = this.matchSymbolsInText(`${title} ${summary}`, universe);
        const symbols = Array.from(new Set([...explicitSyms, ...textMatched]));

        const sectorGroupsRaw = strArray(o.sectorGroups).filter((g): g is SectorGroup =>
          ['Banking', 'Microfinance', 'Insurance', 'Hydropower', 'Manufacturing', 'Other'].includes(g)
        );

        const extractedRating = extractRatingFromText(`${title} ${summary} ${o.ratingGrade || ''}`);
        const ratingGrade = strOrNull(o.ratingGrade) || extractedRating.grade;
        const ratingOutlook = normalizeOutlook(o.ratingOutlook, Boolean(ratingGrade));
        const impRaw = String(o.impact || 'Neutral');
        const impact: RegulatoryKbNotice['impact'] =
          impRaw === 'Positive' || impRaw === 'Negative' || impRaw === 'Mixed' ? impRaw : 'Neutral';

        const notice: RegulatoryKbNotice = {
          id: makeNoticeId(agency, title, url),
          agency,
          title,
          publishedDate: strOrNull(o.publishedDate) || 'Recent',
          summary,
          url,
          symbols,
          sectorGroups: sectorGroupsRaw,
          impact,
          ratingGrade,
          ratingOutlook,
          retrievedAt: nowIso,
          method: 'Search Grounded',
        };
        outNotices.push(notice);

        // Also update company KB entry if symbol matched
        for (const sym of symbols) {
          const uMatch = universe.find((u) => u.symbol === sym);
          if (!uMatch) continue;
          const existing = this.state.companies[sym] || {
            symbol: sym,
            companyName: uMatch.name,
            sector: getNepseSector(sym, uMatch.name),
            sectorGroup: uMatch.sectorGroup,
            updatedAt: nowIso,
            dataStatus: 'Live' as const,
            creditRating: {
              agency: null,
              ratingGrade: null,
              outlook: 'Not Rated' as RatingOutlook,
              ratingAction: null,
              rationale: null,
              lastRatedDate: null,
            },
            regulatoryStanding: 'Clean' as RegulatoryStanding,
            nrbAssessment: null,
            niaAssessment: null,
            sebonStatus: null,
            nepseDisclosures: null,
            cdscStatus: null,
            lockInOverhangFlag: false,
            tailwinds: [],
            riskFlags: [],
            citations: [],
          };

          if ((agency === 'ICRA' || agency === 'CARE') && ratingGrade) {
            existing.creditRating = {
              agency,
              ratingGrade,
              outlook: ratingOutlook,
              ratingAction: strOrNull(o.ratingAction),
              rationale: summary,
              lastRatedDate: notice.publishedDate,
            };
          }
          if (agency === 'NRB') existing.nrbAssessment = summary;
          if (agency === 'NIA') existing.niaAssessment = summary;
          if (agency === 'SEBON') existing.sebonStatus = summary;
          if (agency === 'NEPSE') existing.nepseDisclosures = summary;
          if (agency === 'CDSC') {
            existing.cdscStatus = summary;
            if (Boolean(o.cdscLockInFlag) || /lock[-\s]?in|supply|unlock/i.test(summary)) {
              existing.lockInOverhangFlag = true;
            }
          }

          if (impact === 'Positive' && !existing.tailwinds.includes(title)) {
            existing.tailwinds.push(title);
          }
          if (impact === 'Negative' && !existing.riskFlags.includes(title)) {
            existing.riskFlags.push(title);
            existing.regulatoryStanding = 'Alert';
          }
          if (url && !existing.citations.some((c) => c.uri === url)) {
            existing.citations.push({ title, uri: url, agency });
          }
          existing.updatedAt = nowIso;
          existing.dataStatus = 'Live';
          this.state.companies[sym] = existing;
          companiesUpdated++;
        }
      }

      return { notices: outNotices, companiesUpdated, warning: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        notices: [],
        companiesUpdated: 0,
        warning: `Live agency search grounding failed: ${msg.slice(0, 220)}`,
      };
    }
  }

  public async harvestAgencies(
    agenciesInput: RegulatoryAgency[],
    store: MarketStore
  ): Promise<{
    addedNotices: number;
    companiesUpdated: number;
    directResults: Record<string, number>;
    warnings: string[];
    summary: KnowledgeBaseSummary;
  }> {
    this.initIfNeeded();
    const agencies = agenciesInput.length > 0 ? agenciesInput : ALL_AGENCIES;
    const universe = this.buildUniverseLookup(store);
    const warnings: string[] = [];
    const directResults: Record<string, number> = {};
    let addedNotices = 0;

    // Run direct portal scrapers in parallel (bounded 8s timeout per URL)
    const scrapeRuns = await Promise.all(
      agencies.map(async (agency) => ({
        agency,
        res: await this.directScrapeAgency(agency, universe),
      }))
    );

    const nowIso = new Date().toISOString();
    for (const { agency, res } of scrapeRuns) {
      directResults[agency] = res.notices.length;
      for (const n of res.notices) {
        this.upsertNotice(n);
        addedNotices++;
      }
      if (res.notices.length > 0) {
        this.state.agencyLastFetch[agency] = nowIso;
      }
      if (res.notices.length === 0 && res.errors.length > 0) {
        warnings.push(`${agency} direct portal unreachable (${res.errors[0]})`);
      }
    }

    // Supplement with Gemini Search Grounding targeting those official domains
    const grounded = await this.searchGroundedAgencyHarvest(agencies, universe);
    for (const n of grounded.notices) {
      this.upsertNotice(n);
      addedNotices++;
      this.state.agencyLastFetch[n.agency] = nowIso;
    }
    if (grounded.warning) {
      warnings.push(grounded.warning);
    }

    this.state.lastHarvestAt = nowIso;
    this.save();

    return {
      addedNotices,
      companiesUpdated: grounded.companiesUpdated,
      directResults,
      warnings,
      summary: this.getSummary(),
    };
  }

  public async enrichCompanies(
    symbolsInput: string[],
    store: MarketStore,
    vault: FundamentalVault
  ): Promise<{
    updated: CompanyKnowledgeBaseEntry[];
    warnings: string[];
    summary: KnowledgeBaseSummary;
  }> {
    this.initIfNeeded();
    const cleanSymbols = Array.from(
      new Set(symbolsInput.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9._-]{1,20}$/.test(s)))
    ).slice(0, 6);

    if (cleanSymbols.length === 0) {
      throw new Error('Provide at least one valid NEPSE ticker symbol.');
    }

    const ai = getAiClient();
    if (!ai) {
      throw new Error(
        'GEMINI_API_KEY is not configured. Add it in Settings > Secrets to fetch live ICRA/CARE/NRB/NIA/SEBON/NEPSE/CDSC regulatory intelligence.'
      );
    }

    const dates = store.getDates();
    const latest = dates[dates.length - 1];
    const companyList = cleanSymbols.map((sym) => {
      const priceRow = latest ? store.getDayPrices(latest, false).find((r) => r.symbol === sym) : null;
      const ledger = vault.getCompanyLedger(sym);
      const name = priceRow?.name || ledger?.companyName || sym;
      const sector = ledger?.sector || getNepseSector(sym, name);
      const { sectorGroup } = classifySectorGroup(sector, name);
      return { symbol: sym, companyName: name, sector, sectorGroup };
    });

    const prompt = `You are a Nepal regulatory, credit-rating, and capital-markets researcher.
Use Google Search to retrieve VERIFIED regulatory & credit rating intelligence for these NEPSE-listed companies:
${companyList.map((c) => `- ${c.symbol}: ${c.companyName} (Sector: ${c.sector}, Group: ${c.sectorGroup})`).join('\n')}

Check across official Nepali institutions:
1. Rating Agencies: ICRA Nepal (icranepal.com) & CARE Ratings Nepal (careratingsnepal.com) — issuer/instrument rating grade (e.g., [ICRANP-IR] A-, CARE-NP BBB+), outlook, rating action, and rationale.
2. BFIs (if Banking/Microfinance): Nepal Rastra Bank (nrb.org.np) supervisory metrics (CAR, NPL, CD ratio, directives/dividend compliance).
3. Insurance (if Insurance): Nepal Insurance Authority (nia.gov.np) solvency ratio, premium growth, capital compliance.
4. All Sectors (Prioritize Audited Annual Reports ~70% over Interim Quarterly notes): SEBON (sebon.gov.np) approvals/pipeline/enforcement, NEPSE (nepalstock.com) audited Annual Report / AGM dividend approvals & disclosures, CDSC (cdsc.com.np) demat & promoter lock-in expiry status (flag true ONLY if an upcoming promoter lock-in expiry supply overhang is verified).

STRICT ANTI-FABRICATION RULE:
- Report ONLY facts found via search. If no rating or agency report is found for a company, set those fields to null / "Not Rated" — NEVER fabricate ratings or numbers.

Return ONLY valid JSON:
{
  "companies": [
    {
      "symbol": "TICKER",
      "ratingAgency": "ICRA" | "CARE" | null,
      "ratingGrade": "e.g. [ICRANP-IR] A- or CARE-NP BBB+ or null",
      "ratingOutlook": "Positive" | "Stable" | "Negative" | "Watch" | "Not Rated",
      "ratingAction": "Reaffirmed / Upgraded / Downgraded / Assigned or null",
      "ratingRationale": "1-2 sentence verified rationale or null",
      "lastRatedDate": "Month YYYY or YYYY-MM-DD or null",
      "regulatoryStanding": "Clean" | "Positive" | "Watch" | "Alert" | "Unknown",
      "nrbAssessment": "Verified NRB / BFI note or null",
      "niaAssessment": "Verified NIA / nia.gov.np note or null",
      "sebonStatus": "Verified SEBON pipeline/compliance note or null",
      "nepseDisclosures": "Verified NEPSE dividend/AGM/notice note or null",
      "cdscStatus": "Verified CDSC demat/lock-in note or null",
      "lockInOverhangFlag": false,
      "tailwinds": ["Verified fundamental/regulatory tailwind"],
      "riskFlags": ["Verified regulatory/rating/lock-in risk flag"]
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });

    const parsed = parseJsonObjectSafe(response.text || '');
    const allCitations = extractGroundingCitations(response, 'NEPSE');
    const nowIso = new Date().toISOString();
    const rawItems = Array.isArray(parsed?.companies) ? parsed.companies : [];
    const updated: CompanyKnowledgeBaseEntry[] = [];
    const warnings: string[] = [];

    if (rawItems.length === 0) {
      warnings.push('Model response could not be parsed into structured company KB entries.');
    }

    for (const meta of companyList) {
      const found = rawItems.find(
        (x) =>
          x &&
          typeof x === 'object' &&
          String((x as Record<string, unknown>).symbol || '').trim().toUpperCase() === meta.symbol
      ) as Record<string, unknown> | undefined;

      if (!found) continue;

      const grade = strOrNull(found.ratingGrade);
      const rawAgency = String(found.ratingAgency || '').toUpperCase();
      const ratingAgency: 'ICRA' | 'CARE' | null =
        rawAgency === 'ICRA' || rawAgency === 'CARE'
          ? rawAgency
          : grade?.toUpperCase().includes('ICRA')
            ? 'ICRA'
            : grade?.toUpperCase().includes('CARE')
              ? 'CARE'
              : null;

      const symCitations = allCitations.filter((c) => {
        const lower = `${c.title} ${c.uri}`.toLowerCase();
        return (
          lower.includes(meta.symbol.toLowerCase()) ||
          meta.companyName
            .toLowerCase()
            .split(' ')
            .filter((w) => w.length > 4)
            .slice(0, 2)
            .some((w) => lower.includes(w))
        );
      });

      const entry: CompanyKnowledgeBaseEntry = {
        symbol: meta.symbol,
        companyName: meta.companyName,
        sector: meta.sector,
        sectorGroup: meta.sectorGroup,
        updatedAt: nowIso,
        dataStatus: 'Live',
        creditRating: {
          agency: ratingAgency,
          ratingGrade: grade,
          outlook: normalizeOutlook(found.ratingOutlook, Boolean(grade)),
          ratingAction: strOrNull(found.ratingAction),
          rationale: strOrNull(found.ratingRationale),
          lastRatedDate: strOrNull(found.lastRatedDate),
        },
        regulatoryStanding: normalizeStanding(found.regulatoryStanding),
        nrbAssessment: strOrNull(found.nrbAssessment),
        niaAssessment: strOrNull(found.niaAssessment),
        sebonStatus: strOrNull(found.sebonStatus),
        nepseDisclosures: strOrNull(found.nepseDisclosures),
        cdscStatus: strOrNull(found.cdscStatus),
        lockInOverhangFlag: Boolean(found.lockInOverhangFlag),
        tailwinds: strArray(found.tailwinds),
        riskFlags: strArray(found.riskFlags),
        citations: symCitations.length > 0 ? symCitations : allCitations.slice(0, 4),
      };

      this.state.companies[meta.symbol] = entry;
      updated.push(entry);

      if (grade && ratingAgency) {
        this.upsertNotice({
          id: makeNoticeId(ratingAgency, `${meta.symbol} ${grade}`, symCitations[0]?.uri || null),
          agency: ratingAgency,
          title: `${meta.symbol} (${meta.companyName}): ${grade} (${entry.creditRating.outlook})`,
          publishedDate: entry.creditRating.lastRatedDate || 'Recent',
          summary:
            entry.creditRating.rationale ||
            `${ratingAgency} rating ${grade} with ${entry.creditRating.outlook} outlook.`,
          url: symCitations[0]?.uri || null,
          symbols: [meta.symbol],
          sectorGroups: [meta.sectorGroup],
          impact:
            entry.creditRating.outlook === 'Positive'
              ? 'Positive'
              : entry.creditRating.outlook === 'Negative'
                ? 'Negative'
                : 'Neutral',
          ratingGrade: grade,
          ratingOutlook: entry.creditRating.outlook,
          retrievedAt: nowIso,
          method: 'Search Grounded',
        });
      }
    }

    this.state.lastHarvestAt = nowIso;
    this.save();

    return {
      updated,
      warnings,
      summary: this.getSummary(),
    };
  }
}
