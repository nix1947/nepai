import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  CompanyKnowledgeBaseEntry,
  CorporateActionRecord,
  CorporateActionType,
  KnowledgeBaseResponse,
  KnowledgeBaseSummary,
  LockInEventRecord,
  RatingOutlook,
  RegulatoryAgency,
  RegulatoryKbCitation,
  RegulatoryKbNotice,
  RegulatoryStanding,
  SectorGroup,
} from '../../src/types/fundamental.ts';
import type { StockResearchResponse } from '../../src/types/market.ts';
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
  NEPSE: [
    'https://www.sharesansar.com/category/latest',
    'https://www.sharesansar.com/announcement',
    'https://www.nepalstock.com/news',
  ],
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
      'Latest SEBON IPO/FPO/Right Share/Debenture pipeline approvals, audited annual report / financial filing rules, regulatory circulars, margin lending or lock-in rules, and corporate governance enforcement notices.',
  },
  NEPSE: {
    label: 'Nepal Stock Exchange (NEPSE)',
    domainHint: 'site:nepalstock.com',
    focus:
      'Latest NEPSE audited Annual Reports, AGM & book closure / dividend announcements, quarterly financial report filings, listing updates, and price-sensitive disclosures.',
  },
  CDSC: {
    label: 'CDS and Clearing Ltd (CDSC)',
    domainHint: 'site:cdsc.com.np',
    focus:
      'Latest CDSC notices on demat share credit, bonus/right share listing, promoter/public share lock-in expiry disclosures, and MeroShare corporate action settlements.',
  },
};

export function getNepalDateStr(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

interface PersistedRegulatoryKb {
  notices: RegulatoryKbNotice[];
  companies: Record<string, CompanyKnowledgeBaseEntry>;
  corporateActions: CorporateActionRecord[];
  lockInEvents: LockInEventRecord[];
  agencyLastFetch: Partial<Record<RegulatoryAgency, string>>;
  lastHarvestAt: string | null;
  lastDailyCrawlDate: string | null;
  dailySearchDates: Record<string, string>;
}

function makeNoticeId(agency: RegulatoryAgency, title: string, url: string | null): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${agency}|${title.toLowerCase().trim()}|${url || ''}`)
    .digest('hex')
    .slice(0, 14);
  return `${agency.toLowerCase()}_${hash}`;
}

function makeCorpActionId(symbol: string, fy: string | null, type: CorporateActionType, dateKey: string | null): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${symbol}|${fy || ''}|${type}|${dateKey || ''}`)
    .digest('hex')
    .slice(0, 12);
  return `ca_${symbol.toLowerCase()}_${hash}`;
}

function makeLockInId(symbol: string, unlockDate: string, category: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${symbol}|${unlockDate}|${category}`)
    .digest('hex')
    .slice(0, 12);
  return `li_${symbol.toLowerCase()}_${hash}`;
}

function csvEscape(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function normalizeIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const iso = s.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    if (d.getUTCFullYear() >= 2015 && d.getUTCFullYear() <= 2040) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function parsePctNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1000) {
    return Math.round(raw * 100) / 100;
  }
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[,%\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) / 100 : null;
}

function computeDaysBetweenDates(dateIso: string, refDate: Date = new Date()): number | null {
  const targetMs = Date.parse(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(targetMs)) return null;
  const refStr = getNepalDateStr(refDate);
  const refMs = Date.parse(`${refStr}T00:00:00Z`);
  return Math.round((targetMs - refMs) / 86_400_000);
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
  public readonly corporateCsvPath: string;
  private dataDir: string;
  private state: PersistedRegulatoryKb = {
    notices: [],
    companies: {},
    corporateActions: [],
    lockInEvents: [],
    agencyLastFetch: {},
    lastHarvestAt: null,
    lastDailyCrawlDate: null,
    dailySearchDates: {},
  };
  private loaded = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    const vaultDir = path.join(dataDir, 'financial', 'vault');
    if (!fs.existsSync(vaultDir)) {
      fs.mkdirSync(vaultDir, { recursive: true });
    }
    this.kbPath = path.join(vaultDir, 'regulatory-kb.json');
    this.corporateCsvPath = path.join(vaultDir, 'corporate-actions-kb.csv');
  }

  public isGeminiConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
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
          corporateActions: Array.isArray(parsed.corporateActions) ? parsed.corporateActions : [],
          lockInEvents: Array.isArray(parsed.lockInEvents) ? parsed.lockInEvents : [],
          agencyLastFetch:
            parsed.agencyLastFetch && typeof parsed.agencyLastFetch === 'object'
              ? parsed.agencyLastFetch
              : {},
          lastHarvestAt: typeof parsed.lastHarvestAt === 'string' ? parsed.lastHarvestAt : null,
          lastDailyCrawlDate:
            typeof parsed.lastDailyCrawlDate === 'string' ? parsed.lastDailyCrawlDate : null,
          dailySearchDates:
            parsed.dailySearchDates && typeof parsed.dailySearchDates === 'object'
              ? parsed.dailySearchDates
              : {},
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

  private writeCorporateActionsCsv(): void {
    try {
      const headers = [
        'record_type',
        'symbol',
        'company_name',
        'fiscal_year',
        'action_type',
        'bonus_pct',
        'cash_pct',
        'right_ratio_pct',
        'book_closure_or_unlock_date',
        'ex_date',
        'agm_date',
        'status',
        'locked_shares',
        'pct_of_total_shares',
        'shareholder_category',
        'method',
        'source_label',
        'headline',
      ];
      const lines = [headers.join(',')];
      for (const ca of this.state.corporateActions) {
        lines.push(
          [
            'CORPORATE_ACTION',
            ca.symbol,
            ca.companyName,
            ca.fiscalYear ?? '',
            ca.actionType,
            ca.bonusPct ?? '',
            ca.cashPct ?? '',
            ca.rightRatioPct ?? '',
            ca.bookClosureDate ?? '',
            ca.exDate ?? '',
            ca.agmDate ?? '',
            ca.status,
            '',
            '',
            '',
            ca.method,
            ca.sourceLabel,
            ca.headline,
          ]
            .map(csvEscape)
            .join(',')
        );
      }
      for (const li of this.state.lockInEvents) {
        lines.push(
          [
            'LOCK_IN_EXPIRY',
            li.symbol,
            li.companyName,
            '',
            'Lock-In',
            '',
            '',
            '',
            li.unlockDate,
            '',
            '',
            '',
            li.lockedShares ?? '',
            li.pctOfTotalShares ?? '',
            li.shareholderCategory,
            li.method,
            li.sourceLabel,
            li.headline,
          ]
            .map(csvEscape)
            .join(',')
        );
      }
      fs.writeFileSync(this.corporateCsvPath, `${lines.join('\n')}\n`, 'utf8');
    } catch {
      // ignore disk write issues
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.kbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.kbPath, JSON.stringify(this.state, null, 2), 'utf8');
      this.writeCorporateActionsCsv();
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

  public upsertCorporateAction(action: CorporateActionRecord): void {
    this.initIfNeeded();
    const sym = action.symbol.trim().toUpperCase();
    const clean: CorporateActionRecord = { ...action, symbol: sym };
    const idx = this.state.corporateActions.findIndex((c) => c.id === clean.id);
    if (idx >= 0) {
      const prev = this.state.corporateActions[idx];
      this.state.corporateActions[idx] = {
        ...prev,
        ...clean,
        bonusPct: clean.bonusPct ?? prev.bonusPct,
        cashPct: clean.cashPct ?? prev.cashPct,
        rightRatioPct: clean.rightRatioPct ?? prev.rightRatioPct,
        bookClosureDate: clean.bookClosureDate ?? prev.bookClosureDate,
        exDate: clean.exDate ?? prev.exDate,
        agmDate: clean.agmDate ?? prev.agmDate,
        sourceUrl: clean.sourceUrl ?? prev.sourceUrl,
      };
    } else {
      this.state.corporateActions.unshift(clean);
    }
    if (this.state.corporateActions.length > 500) {
      this.state.corporateActions = this.state.corporateActions.slice(0, 500);
    }
  }

  public upsertLockInEvent(event: LockInEventRecord): void {
    this.initIfNeeded();
    const sym = event.symbol.trim().toUpperCase();
    const clean: LockInEventRecord = { ...event, symbol: sym };
    const idx = this.state.lockInEvents.findIndex((e) => e.id === clean.id);
    if (idx >= 0) {
      const prev = this.state.lockInEvents[idx];
      this.state.lockInEvents[idx] = {
        ...prev,
        ...clean,
        lockedShares: clean.lockedShares ?? prev.lockedShares,
        pctOfTotalShares: clean.pctOfTotalShares ?? prev.pctOfTotalShares,
        sourceUrl: clean.sourceUrl ?? prev.sourceUrl,
      };
    } else {
      this.state.lockInEvents.unshift(clean);
    }
    if (this.state.lockInEvents.length > 300) {
      this.state.lockInEvents = this.state.lockInEvents.slice(0, 300);
    }
  }

  public getCorporateActions(symbol?: string): CorporateActionRecord[] {
    this.initIfNeeded();
    const sym = symbol?.trim().toUpperCase();
    const list = sym
      ? this.state.corporateActions.filter((c) => c.symbol === sym)
      : [...this.state.corporateActions];
    return list.sort((a, b) => {
      const da = a.bookClosureDate || a.exDate || a.agmDate || a.retrievedAt.slice(0, 10);
      const db = b.bookClosureDate || b.exDate || b.agmDate || b.retrievedAt.slice(0, 10);
      return db.localeCompare(da);
    });
  }

  public getLockInEvents(symbol?: string, refDate: Date = new Date()): LockInEventRecord[] {
    this.initIfNeeded();
    const sym = symbol?.trim().toUpperCase();
    const list = sym
      ? this.state.lockInEvents.filter((e) => e.symbol === sym)
      : [...this.state.lockInEvents];
    return list
      .map((ev) => {
        const days = computeDaysBetweenDates(ev.unlockDate, refDate);
        let overhangTier: LockInEventRecord['overhangTier'] = 'Upcoming';
        if (days !== null) {
          if (days < 0) overhangTier = 'Unlocked';
          else if (days <= 30) overhangTier = 'Critical (<30d)';
          else if (days <= 90) overhangTier = 'Near-Term (<90d)';
          else overhangTier = 'Upcoming';
        }
        return {
          ...ev,
          daysRemaining: days ?? undefined,
          overhangTier,
        };
      })
      .sort((a, b) => {
        const da = a.daysRemaining ?? 99999;
        const db = b.daysRemaining ?? 99999;
        // Show upcoming closest events first, then recently unlocked
        const aFuture = da >= -14 ? 0 : 1;
        const bFuture = db >= -14 ? 0 : 1;
        if (aFuture !== bFuture) return aFuture - bFuture;
        return aFuture === 0 ? da - db : db - da;
      });
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
    const today = getNepalDateStr();
    const upcomingBookClosuresCount = this.state.corporateActions.filter(
      (c) => c.bookClosureDate && c.bookClosureDate >= today
    ).length;
    const upcomingLockInsCount = this.state.lockInEvents.filter(
      (l) => l.unlockDate >= today
    ).length;

    return {
      totalCompaniesIndexed: Object.keys(this.state.companies).length,
      totalNotices: this.state.notices.length,
      byAgency,
      lastHarvestAt: this.state.lastHarvestAt,
      agencyLastFetch: { ...this.state.agencyLastFetch },
      totalCorporateActions: this.state.corporateActions.length,
      totalLockInEvents: this.state.lockInEvents.length,
      upcomingBookClosuresCount,
      upcomingLockInsCount,
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
    let corporateActions = this.getCorporateActions(params?.symbol);
    let lockInEvents = this.getLockInEvents(params?.symbol);

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
      corporateActions = corporateActions.filter(
        (c) =>
          c.symbol.toLowerCase().includes(q) ||
          c.companyName.toLowerCase().includes(q) ||
          c.headline.toLowerCase().includes(q)
      );
      lockInEvents = lockInEvents.filter(
        (l) =>
          l.symbol.toLowerCase().includes(q) ||
          l.companyName.toLowerCase().includes(q) ||
          l.headline.toLowerCase().includes(q)
      );
    }

    companies.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { summary, notices, companies, corporateActions, lockInEvents };
  }

  public getLastDailyCrawlDate(): string | null {
    this.initIfNeeded();
    return this.state.lastDailyCrawlDate ?? null;
  }

  public setLastDailyCrawlDate(dateStr: string): void {
    this.initIfNeeded();
    this.state.lastDailyCrawlDate = dateStr;
    this.save();
  }

  public hasDailySearchForDate(symbol: string, dateStr: string = getNepalDateStr()): boolean {
    this.initIfNeeded();
    const sym = symbol.trim().toUpperCase();
    return this.state.dailySearchDates[sym] === dateStr;
  }

  public getDailySearchCountForDate(dateStr: string = getNepalDateStr()): number {
    this.initIfNeeded();
    let count = 0;
    for (const d of Object.values(this.state.dailySearchDates)) {
      if (d === dateStr) count++;
    }
    return count;
  }

  public markDailySymbolSearched(symbol: string, dateStr: string = getNepalDateStr()): void {
    this.initIfNeeded();
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    this.state.dailySearchDates[sym] = dateStr;
    // Prune stale dates older than 30 days so state remains compact
    const cutoffMs = Date.now() - 30 * 86400 * 1000;
    const cutoffStr = getNepalDateStr(new Date(cutoffMs));
    for (const [k, v] of Object.entries(this.state.dailySearchDates)) {
      if (typeof v !== 'string' || v < cutoffStr) {
        delete this.state.dailySearchDates[k];
      }
    }
    this.save();
  }

  public ensureCompanySearchEntry(
    symbol: string,
    store: MarketStore,
    vault: FundamentalVault,
    dateStr: string = getNepalDateStr()
  ): CompanyKnowledgeBaseEntry {
    this.initIfNeeded();
    const sym = symbol.trim().toUpperCase();
    const existing = this.state.companies[sym];
    const nowIso = new Date().toISOString();

    const dates = store.getDates();
    const latest = dates[dates.length - 1];
    const priceRow = latest ? store.getDayPrices(latest, false).find((r) => r.symbol === sym) : null;
    const ledger = vault.getCompanyLedger(sym);
    const companyName = priceRow?.name || ledger?.companyName || existing?.companyName || sym;
    const sector = ledger?.sector || existing?.sector || getNepseSector(sym, companyName);
    const { sectorGroup } = classifySectorGroup(sector, companyName);

    const matchingNotices = this.state.notices.filter(
      (n) =>
        n.symbols.includes(sym) ||
        n.title.toUpperCase().includes(sym) ||
        n.summary.toUpperCase().includes(sym)
    );

    const noticeCitations: RegulatoryKbCitation[] = matchingNotices
      .filter((n) => Boolean(n.url))
      .slice(0, 4)
      .map((n) => ({
        title: n.title,
        uri: n.url!,
        agency: n.agency,
      }));

    const existingCitations = existing?.citations || [];
    const seenUris = new Set(existingCitations.map((c) => c.uri));
    const mergedCitations = [...existingCitations];
    for (const c of noticeCitations) {
      if (!seenUris.has(c.uri)) {
        seenUris.add(c.uri);
        mergedCitations.push(c);
      }
    }

    const latestStmt = ledger?.records?.[0];
    const epsVal = latestStmt?.metrics?.eps?.value;
    const roeVal = latestStmt?.metrics?.roePct?.value;
    const extraDisclosures = latestStmt
      ? `${latestStmt.fiscalYear} ${latestStmt.quarter}${
          epsVal !== null && epsVal !== undefined ? ` · EPS Rs ${epsVal}` : ''
        }${roeVal !== null && roeVal !== undefined ? ` · ROE ${roeVal}%` : ''}`
      : null;

    const entry: CompanyKnowledgeBaseEntry = existing
      ? {
          ...existing,
          companyName,
          sector,
          sectorGroup,
          updatedAt: nowIso,
          nepseDisclosures: existing.nepseDisclosures || extraDisclosures,
          citations: mergedCitations.slice(0, 6),
        }
      : {
          symbol: sym,
          companyName,
          sector,
          sectorGroup,
          updatedAt: nowIso,
          dataStatus: 'Cached',
          creditRating: {
            agency: null,
            ratingGrade: null,
            outlook: 'Not Rated',
            ratingAction: null,
            rationale: null,
            lastRatedDate: null,
          },
          regulatoryStanding: 'Unknown',
          nrbAssessment: null,
          niaAssessment: null,
          sebonStatus: null,
          nepseDisclosures: extraDisclosures,
          cdscStatus: null,
          lockInOverhangFlag: false,
          tailwinds: [],
          riskFlags: [],
          citations: mergedCitations.slice(0, 6),
        };

    this.state.companies[sym] = entry;
    this.state.dailySearchDates[sym] = dateStr;
    this.save();
    return entry;
  }

  public recordStockSearchToKb(params: {
    store: MarketStore;
    vault: FundamentalVault;
    research: StockResearchResponse;
    dateStr?: string;
  }): CompanyKnowledgeBaseEntry {
    this.initIfNeeded();
    const dateStr = params.dateStr || getNepalDateStr();
    const { research, store, vault } = params;
    const base = this.ensureCompanySearchEntry(research.symbol, store, vault, dateStr);
    const sym = base.symbol;
    const nowIso = new Date().toISOString();

    const tailwindAdditions: string[] = [];
    for (const opp of research.opportunities || []) {
      if (opp.title?.trim()) tailwindAdditions.push(opp.title.trim());
    }
    const riskAdditions: string[] = [
      ...(research.fundamentalRedFlags || []),
      ...(research.governanceRegulatoryFlags || []),
    ]
      .map((s) => s.trim())
      .filter(Boolean);

    const newCitations: RegulatoryKbCitation[] = [];
    for (const src of research.sources || []) {
      const uri = safeHttpUrl(src.uri);
      if (!uri) continue;
      const lower = `${uri} ${src.title || ''}`.toLowerCase();
      const agency: RegulatoryAgency = lower.includes('icranepal')
        ? 'ICRA'
        : lower.includes('careratingsnepal')
          ? 'CARE'
          : lower.includes('nrb.org')
            ? 'NRB'
            : lower.includes('nia.gov') || lower.includes('beema')
              ? 'NIA'
              : lower.includes('sebon')
                ? 'SEBON'
                : lower.includes('cdsc')
                  ? 'CDSC'
                  : 'NEPSE';
      newCitations.push({ title: String(src.title || uri), uri, agency });
    }

    const seenUris = new Set(base.citations.map((c) => c.uri));
    const mergedCitations = [...base.citations];
    for (const c of newCitations) {
      if (!seenUris.has(c.uri)) {
        seenUris.add(c.uri);
        mergedCitations.unshift(c);
      }
    }

    const mergedTailwinds = Array.from(
      new Set([...tailwindAdditions, ...base.tailwinds])
    ).slice(0, 8);
    const mergedRisks = Array.from(
      new Set([...riskAdditions, ...base.riskFlags])
    ).slice(0, 8);

    const hasAlerts =
      (research.fundamentalRedFlags || []).length > 0 ||
      (research.governanceRegulatoryFlags || []).length > 0;
    const standing: RegulatoryStanding =
      base.regulatoryStanding === 'Alert' || hasAlerts
        ? hasAlerts
          ? 'Watch'
          : base.regulatoryStanding
        : research.recommendation === 'BUY'
          ? 'Positive'
          : base.regulatoryStanding === 'Unknown'
            ? 'Clean'
            : base.regulatoryStanding;

    const lockInTriggered =
      base.lockInOverhangFlag ||
      riskAdditions.some((r) => /lock[-\s]?in|promoter\s+unlock/i.test(r));

    const searchDisclosure =
      research.reportingPeriod && research.reportingPeriod !== 'Unavailable'
        ? `${research.reportingPeriod} (${research.recommendation}): ${research.summary}`.slice(0, 340)
        : research.summary
          ? `${research.recommendation}: ${research.summary}`.slice(0, 340)
          : base.nepseDisclosures;

    const updated: CompanyKnowledgeBaseEntry = {
      ...base,
      updatedAt: nowIso,
      dataStatus: research.searchGrounded ? 'Live' : base.dataStatus,
      regulatoryStanding: standing,
      nepseDisclosures: searchDisclosure || base.nepseDisclosures,
      lockInOverhangFlag: lockInTriggered,
      tailwinds: mergedTailwinds,
      riskFlags: mergedRisks,
      citations: mergedCitations.slice(0, 8),
    };

    this.state.companies[sym] = updated;
    this.state.dailySearchDates[sym] = dateStr;
    this.state.lastHarvestAt = nowIso;

    if (research.summary?.trim()) {
      const topSource = mergedCitations[0];
      this.upsertNotice({
        id: makeNoticeId('NEPSE', `${sym} ${dateStr} Stock Search`, topSource?.uri || null),
        agency: topSource?.agency || 'NEPSE',
        title: `${sym} (${updated.companyName}) Research Update · ${research.recommendation}`,
        publishedDate: dateStr,
        summary: research.summary.trim().slice(0, 320),
        url: topSource?.uri || null,
        symbols: [sym],
        sectorGroups: [updated.sectorGroup],
        impact:
          research.recommendation === 'BUY'
            ? 'Positive'
            : research.recommendation === 'AVOID'
              ? 'Negative'
              : 'Neutral',
        ratingGrade: updated.creditRating.ratingGrade,
        ratingOutlook: updated.creditRating.outlook,
        retrievedAt: nowIso,
        method: research.searchGrounded ? 'Search Grounded' : 'Cached Macro',
      });
    }

    this.save();
    return updated;
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
        $('nav, header, footer, script, style, noscript').remove();
        const candidates: Array<{ title: string; href: string | null; date: string }> = [];

        $('main a, article a, .news a, .post a, table a, h2 a, h3 a, a').each((_i, el) => {
          const text = $(el).text().replace(/\s+/g, ' ').trim();
          const hrefRaw = ($(el).attr('href') || '').trim();
          if (text.length < 18 || text.length > 220) return;
          if (
            !hrefRaw ||
            hrefRaw.startsWith('#') ||
            hrefRaw.startsWith('javascript:') ||
            hrefRaw.startsWith('mailto:') ||
            hrefRaw.startsWith('tel:')
          ) {
            return;
          }
          const lower = text.toLowerCase();
          if (
            lower.includes('skip to') ||
            lower.includes('read more') ||
            lower === 'home' ||
            lower.includes('contact us') ||
            lower.includes('privacy policy') ||
            lower.includes('about us') ||
            lower.includes('login') ||
            lower.includes('sitemap')
          ) {
            return;
          }
          let resolved: string | null = null;
          try {
            resolved = safeHttpUrl(new URL(hrefRaw, targetUrl).toString());
          } catch {
            resolved = null;
          }
          const parentText = $(el).parent().text().replace(/\s+/g, ' ').trim();
          const dateMatch = parentText.match(
            /\b(20\d{2}[-/]\d{2}[-/]\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/i
          );
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

        const picked = Array.from(unique.values()).slice(0, 15);
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
          'GEMINI_API_KEY is not configured; live search-grounded regulatory harvesting was skipped (only direct agency portal fetches ran).',
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
      let response: GenerateContentResponse;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: { tools: [{ googleSearch: {} }] },
        });
      } catch (innerErr) {
        const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('NOT_FOUND')) {
          response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] },
          });
        } else {
          throw innerErr;
        }
      }

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

  private syncNoticeToCompanies(
    notice: RegulatoryKbNotice,
    universe: Array<{ symbol: string; name: string; keywords: string[]; sectorGroup: SectorGroup }>
  ): number {
    let companiesUpdated = 0;
    const nowIso = notice.retrievedAt || new Date().toISOString();
    for (const sym of notice.symbols) {
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

      if ((notice.agency === 'ICRA' || notice.agency === 'CARE') && notice.ratingGrade) {
        existing.creditRating = {
          agency: notice.agency,
          ratingGrade: notice.ratingGrade,
          outlook: notice.ratingOutlook,
          ratingAction: existing.creditRating.ratingAction || 'Observed in Portal',
          rationale: notice.summary,
          lastRatedDate: notice.publishedDate,
        };
      }
      if (notice.agency === 'NRB' && !existing.nrbAssessment) existing.nrbAssessment = notice.summary;
      if (notice.agency === 'NIA' && !existing.niaAssessment) existing.niaAssessment = notice.summary;
      if (notice.agency === 'SEBON' && !existing.sebonStatus) existing.sebonStatus = notice.summary;
      if (notice.agency === 'NEPSE' && !existing.nepseDisclosures) {
        existing.nepseDisclosures = notice.summary;
      }
      if (notice.agency === 'CDSC') {
        if (!existing.cdscStatus) existing.cdscStatus = notice.summary;
        if (/lock[-\s]?in|unlock/i.test(`${notice.title} ${notice.summary}`)) {
          existing.lockInOverhangFlag = true;
        }
      }

      if (notice.impact === 'Positive' && !existing.tailwinds.includes(notice.title)) {
        existing.tailwinds.push(notice.title);
      }
      if (notice.impact === 'Negative' && !existing.riskFlags.includes(notice.title)) {
        existing.riskFlags.push(notice.title);
        existing.regulatoryStanding = 'Alert';
      }
      if (notice.url && !existing.citations.some((c) => c.uri === notice.url)) {
        existing.citations.push({ title: notice.title, uri: notice.url, agency: notice.agency });
      }
      existing.updatedAt = nowIso;
      existing.dataStatus = 'Live';
      this.state.companies[sym] = existing;
      companiesUpdated++;
    }
    return companiesUpdated;
  }

  public recordAnnualReportIngestion(params: {
    symbol: string;
    companyName: string;
    sector: string;
    sectorGroup: SectorGroup;
    fiscalYear: string;
    sourceLabel: string;
    sourceUrl: string | null;
    summary: string;
    tailwinds?: string[];
    riskFlags?: string[];
    dividends?: string[];
  }): CompanyKnowledgeBaseEntry {
    this.initIfNeeded();
    const sym = params.symbol.trim().toUpperCase();
    const nowIso = new Date().toISOString();
    const existing = this.state.companies[sym] || {
      symbol: sym,
      companyName: params.companyName,
      sector: params.sector,
      sectorGroup: params.sectorGroup,
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

    const disclosureLine = `FY ${params.fiscalYear} Annual Report (${params.sourceLabel}): ${params.summary}`;
    existing.nepseDisclosures = disclosureLine;
    for (const t of params.tailwinds || []) {
      const clean = t.trim();
      if (clean && !existing.tailwinds.includes(clean)) {
        existing.tailwinds.unshift(clean);
      }
    }
    for (const d of params.dividends || []) {
      const clean = `FY ${params.fiscalYear} Dividend/Bonus: ${d.trim()}`;
      if (d.trim() && !existing.tailwinds.includes(clean)) {
        existing.tailwinds.unshift(clean);
      }
    }
    for (const r of params.riskFlags || []) {
      const clean = r.trim();
      if (clean && !existing.riskFlags.includes(clean)) {
        existing.riskFlags.unshift(clean);
      }
    }
    existing.tailwinds = existing.tailwinds.slice(0, 8);
    existing.riskFlags = existing.riskFlags.slice(0, 8);

    const safeUrl = safeHttpUrl(params.sourceUrl);
    if (safeUrl && !existing.citations.some((c) => c.uri === safeUrl)) {
      existing.citations.unshift({
        title: `${sym} FY ${params.fiscalYear} Annual Report (${params.sourceLabel})`,
        uri: safeUrl,
        agency: 'NEPSE',
      });
    }
    existing.updatedAt = nowIso;
    existing.dataStatus = 'Live';
    if (existing.regulatoryStanding === 'Unknown') {
      existing.regulatoryStanding = 'Clean';
    }
    this.state.companies[sym] = existing;

    this.upsertNotice({
      id: makeNoticeId('NEPSE', `${sym} FY ${params.fiscalYear} Annual Report`, safeUrl),
      agency: 'NEPSE',
      title: `${sym} FY ${params.fiscalYear} Annual Report Ingested (${params.sourceLabel})`,
      publishedDate: nowIso.slice(0, 10),
      summary: params.summary,
      url: safeUrl,
      symbols: [sym],
      sectorGroups: [params.sectorGroup],
      impact: 'Positive',
      ratingGrade: existing.creditRating.ratingGrade,
      ratingOutlook: existing.creditRating.outlook,
      retrievedAt: nowIso,
      method: safeUrl ? 'Direct Scrape' : 'Cached Macro',
    });

    this.state.lastHarvestAt = nowIso;
    this.save();
    return existing;
  }

  private async fetchShareSansarCorporatePortals(
    universe: Array<{ symbol: string; name: string; keywords: string[]; sectorGroup: SectorGroup }>
  ): Promise<{ corporateActions: CorporateActionRecord[]; lockInEvents: LockInEventRecord[]; errors: string[] }> {
    const portals: Array<{ url: string; kind: 'dividend' | 'agm' | 'right' | 'news' }> = [
      { url: 'https://www.sharesansar.com/proposed-dividend', kind: 'dividend' },
      { url: 'https://www.sharesansar.com/agm-list', kind: 'agm' },
      { url: 'https://www.sharesansar.com/right-share', kind: 'right' },
      { url: 'https://www.sharesansar.com/announcement', kind: 'news' },
    ];
    const corporateActions: CorporateActionRecord[] = [];
    const lockInEvents: LockInEventRecord[] = [];
    const errors: string[] = [];
    const nowIso = new Date().toISOString();
    const todayIso = getNepalDateStr();

    for (const portal of portals) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8500);
      try {
        const res = await fetch(portal.url, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        if (!res.ok) {
          errors.push(`Corporate portal (${portal.kind}): HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        const $ = cheerio.load(html);

        if (portal.kind === 'dividend' || portal.kind === 'agm' || portal.kind === 'right') {
          const headers: string[] = [];
          $('table thead tr th').each((_i, th) => {
            headers.push($(th).text().replace(/\s+/g, ' ').trim().toLowerCase());
          });

          $('table tbody tr')
            .slice(0, 60)
            .each((_idx, tr) => {
              const cells: string[] = [];
              $(tr)
                .find('td')
                .each((_ci, td) => {
                  cells.push($(td).text().replace(/\s+/g, ' ').trim());
                });
              if (cells.length < 3) return;
              const rowText = cells.join(' · ');
              const matchedSyms = this.matchSymbolsInText(rowText, universe);
              const sym = matchedSyms[0] || cells.find((c) => /^[A-Z0-9]{2,10}$/.test(c.trim()));
              if (!sym) return;
              const uMatch = universe.find((u) => u.symbol === sym.toUpperCase());
              const companyName = uMatch?.name || sym.toUpperCase();

              const colIdx = (pred: (h: string) => boolean): number => headers.findIndex(pred);
              const fyCell =
                colIdx((h) => h.includes('fiscal') || h === 'fy') >= 0
                  ? cells[colIdx((h) => h.includes('fiscal') || h === 'fy')]
                  : null;
              const fyMatch = (fyCell || rowText).match(/\b(20\d{2}\/\d{2,4})\b/);
              const fiscalYear = fyMatch ? fyMatch[1] : null;

              let bonusPct: number | null = null;
              let cashPct: number | null = null;
              let rightRatioPct: number | null = null;
              let bookClosureDate: string | null = null;
              let agmDate: string | null = null;

              const bonusIdx = colIdx((h) => h.includes('bonus'));
              if (bonusIdx >= 0) bonusPct = parsePctNumber(cells[bonusIdx]);
              const cashIdx = colIdx((h) => h.includes('cash'));
              if (cashIdx >= 0) cashPct = parsePctNumber(cells[cashIdx]);
              const ratioIdx = colIdx((h) => h.includes('ratio') || h.includes('right') || h.includes('%'));
              if (portal.kind === 'right' && ratioIdx >= 0) {
                const rawR = cells[ratioIdx];
                const colon = rawR.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
                if (colon && Number(colon[1]) > 0) {
                  rightRatioPct = Math.round((Number(colon[2]) / Number(colon[1])) * 10000) / 100;
                } else {
                  rightRatioPct = parsePctNumber(rawR);
                }
              }

              const bookIdx = colIdx((h) => h.includes('book') || h.includes('close'));
              if (bookIdx >= 0) bookClosureDate = normalizeIsoDate(cells[bookIdx]);
              const agmIdx = colIdx((h) => h.includes('agm'));
              if (agmIdx >= 0) agmDate = normalizeIsoDate(cells[agmIdx]);

              const actionType: CorporateActionType =
                portal.kind === 'right'
                  ? 'Right Share'
                  : portal.kind === 'agm'
                    ? 'AGM'
                    : 'Dividend';
              const status: CorporateActionRecord['status'] =
                bookClosureDate && bookClosureDate < todayIso
                  ? 'Book Closed'
                  : agmDate && agmDate < todayIso
                    ? 'Completed'
                    : 'Proposed';

              const headlineParts = [
                fiscalYear ? `FY ${fiscalYear}` : null,
                bonusPct !== null && bonusPct > 0 ? `${bonusPct}% Bonus` : null,
                cashPct !== null && cashPct > 0 ? `${cashPct}% Cash` : null,
                rightRatioPct !== null && rightRatioPct > 0 ? `${rightRatioPct}% Right Share` : null,
                bookClosureDate ? `Book Close ${bookClosureDate}` : null,
                agmDate ? `AGM ${agmDate}` : null,
              ].filter(Boolean);

              if (headlineParts.length === 0) return;

              corporateActions.push({
                id: makeCorpActionId(sym.toUpperCase(), fiscalYear, actionType, bookClosureDate || agmDate),
                symbol: sym.toUpperCase(),
                companyName,
                fiscalYear,
                actionType,
                bonusPct,
                cashPct,
                rightRatioPct,
                bookClosureDate,
                exDate: bookClosureDate,
                agmDate,
                status,
                headline: headlineParts.join(' · '),
                sourceLabel: 'NEPSE Corporate Portal',
                sourceUrl: safeHttpUrl(portal.url),
                retrievedAt: nowIso,
                method: 'Portal Feed',
              });
            });
        } else {
          // Scan announcements for lock-in expiry disclosures & dividend declarations
          $('main a, article a, .news a, .post a, h3 a, a')
            .slice(0, 120)
            .each((_idx, el) => {
              const title = $(el).text().replace(/\s+/g, ' ').trim();
              if (title.length < 20 || title.length > 240) return;
              if (!/lock[-\s]?in|unlock|dividend|bonus|right\s*share|book\s*clos/i.test(title)) return;
              const matched = this.matchSymbolsInText(title, universe);
              if (matched.length === 0) return;
              const sym = matched[0];
              const uMatch = universe.find((u) => u.symbol === sym);
              const dateIso = normalizeIsoDate(title);

              let href: string | null = null;
              try {
                href = safeHttpUrl(new URL($(el).attr('href') || '', portal.url).toString());
              } catch {
                href = safeHttpUrl(portal.url);
              }

              if (/lock[-\s]?in|unlock/i.test(title) && dateIso) {
                const cat: LockInEventRecord['shareholderCategory'] = /promoter/i.test(title)
                  ? 'Promoter'
                  : /local|affected/i.test(title)
                    ? 'Local Affected'
                    : /employee/i.test(title)
                      ? 'Employee'
                      : 'Mixed';
                lockInEvents.push({
                  id: makeLockInId(sym, dateIso, cat),
                  symbol: sym,
                  companyName: uMatch?.name || sym,
                  shareholderCategory: cat,
                  unlockDate: dateIso,
                  lockedShares: null,
                  pctOfTotalShares: null,
                  headline: title,
                  sourceLabel: 'NEPSE Corporate Portal',
                  sourceUrl: href,
                  retrievedAt: nowIso,
                  method: 'Portal Feed',
                });
              }
            });
        }
      } catch (err) {
        errors.push(`Corporate portal (${portal.kind}): ${err instanceof Error ? err.message : 'fetch failed'}`);
      } finally {
        clearTimeout(timer);
      }
    }

    return { corporateActions, lockInEvents, errors };
  }

  public async distillCorporateActionsAndLockInsWithSearch(
    store: MarketStore,
    targetSymbols?: string[]
  ): Promise<{
    corporateActionsAdded: number;
    lockInEventsAdded: number;
    warning: string | null;
  }> {
    this.initIfNeeded();
    const ai = getAiClient();
    if (!ai) {
      return {
        corporateActionsAdded: 0,
        lockInEventsAdded: 0,
        warning: 'GEMINI_API_KEY not set — skipped Google Search corporate action & lock-in distillation.',
      };
    }

    const universe = this.buildUniverseLookup(store);
    const focusNote =
      targetSymbols && targetSymbols.length > 0
        ? `Focus especially on symbols: ${targetSymbols.slice(0, 12).join(', ')}.`
        : 'Prioritize active NEPSE commercial banks, development banks, hydropower, microfinance, insurance, and manufacturing blue-chips.';

    const prompt = `You are a Nepal Stock Exchange (NEPSE) corporate actions & share supply analyst.
Use Google Search (checking sharesansar.com, nepalstock.com, cdsc.com.np, and sebon.gov.np) to find and DISTILL the most up-to-date VERIFIED:
1) Proposed or approved Bonus Share %, Cash Dividend %, Right Share ratios, Book Closure dates, and AGM dates for NEPSE-listed stocks.
2) Upcoming or recent Promoter / Local-Affected / Employee share lock-in period expiry events (unlock dates and locked share counts).

${focusNote}

STRICT ANTI-FABRICATION RULE:
- Report ONLY real verified corporate actions and lock-in expiry disclosures confirmed in search results.
- Never guess dates, percentages, or share counts. Use null when unknown.

Return ONLY valid JSON:
{
  "corporateActions": [
    {
      "symbol": "TICKER",
      "fiscalYear": "2082/83 or null",
      "actionType": "Dividend" | "Right Share" | "AGM" | "Book Closure",
      "bonusPct": 10.5,
      "cashPct": 5.26,
      "rightRatioPct": null,
      "bookClosureDate": "YYYY-MM-DD or null",
      "agmDate": "YYYY-MM-DD or null",
      "status": "Proposed" | "Approved" | "Book Closed" | "Completed",
      "headline": "Concise 1-line summary",
      "url": "https://... or null"
    }
  ],
  "lockInEvents": [
    {
      "symbol": "TICKER",
      "shareholderCategory": "Promoter" | "Local Affected" | "Employee" | "Foreign" | "Mixed",
      "unlockDate": "YYYY-MM-DD",
      "lockedShares": 1250000,
      "pctOfTotalShares": 12.5,
      "headline": "Concise 1-line summary of shares unlocking",
      "url": "https://... or null"
    }
  ]
}`;

    try {
      let response: GenerateContentResponse;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: { tools: [{ googleSearch: {} }] },
        });
      } catch (innerErr) {
        const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('NOT_FOUND')) {
          response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] },
          });
        } else {
          throw innerErr;
        }
      }

      const parsed = parseJsonObjectSafe(response.text || '');
      const citations = extractGroundingCitations(response, 'NEPSE');
      const nowIso = new Date().toISOString();
      const todayIso = getNepalDateStr();

      let corporateActionsAdded = 0;
      let lockInEventsAdded = 0;

      const rawCas = Array.isArray(parsed?.corporateActions) ? parsed.corporateActions : [];
      for (const item of rawCas) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const sym = String(o.symbol || '').trim().toUpperCase();
        if (!sym || !/^[A-Z0-9._-]{2,16}$/.test(sym)) continue;
        const uMatch = universe.find((u) => u.symbol === sym);
        const fy = strOrNull(o.fiscalYear);
        const typeRaw = String(o.actionType || 'Dividend');
        const actionType: CorporateActionType =
          typeRaw === 'Right Share' || typeRaw === 'AGM' || typeRaw === 'Book Closure' || typeRaw === 'Other'
            ? typeRaw
            : 'Dividend';
        const bonusPct = parsePctNumber(o.bonusPct);
        const cashPct = parsePctNumber(o.cashPct);
        const rightRatioPct = parsePctNumber(o.rightRatioPct);
        const bookClosureDate = normalizeIsoDate(o.bookClosureDate);
        const agmDate = normalizeIsoDate(o.agmDate);
        const headline =
          strOrNull(o.headline) ||
          [
            fy ? `FY ${fy}` : null,
            bonusPct ? `${bonusPct}% Bonus` : null,
            cashPct ? `${cashPct}% Cash` : null,
            rightRatioPct ? `${rightRatioPct}% Right` : null,
            bookClosureDate ? `Book Close ${bookClosureDate}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
        if (!headline) continue;

        const statusRaw = String(o.status || 'Proposed');
        const status: CorporateActionRecord['status'] =
          statusRaw === 'Approved' || statusRaw === 'Book Closed' || statusRaw === 'Completed'
            ? statusRaw
            : bookClosureDate && bookClosureDate < todayIso
              ? 'Book Closed'
              : 'Proposed';
        const url = safeHttpUrl(o.url) || citations[0]?.uri || null;

        this.upsertCorporateAction({
          id: makeCorpActionId(sym, fy, actionType, bookClosureDate || agmDate || headline.slice(0, 24)),
          symbol: sym,
          companyName: uMatch?.name || sym,
          fiscalYear: fy,
          actionType,
          bonusPct,
          cashPct,
          rightRatioPct,
          bookClosureDate,
          exDate: bookClosureDate,
          agmDate,
          status,
          headline,
          sourceLabel: 'Google Search Distilled',
          sourceUrl: url,
          retrievedAt: nowIso,
          method: 'Search Grounded',
        });
        corporateActionsAdded++;
      }

      const rawLocks = Array.isArray(parsed?.lockInEvents) ? parsed.lockInEvents : [];
      for (const item of rawLocks) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const sym = String(o.symbol || '').trim().toUpperCase();
        const unlockDate = normalizeIsoDate(o.unlockDate);
        if (!sym || !/^[A-Z0-9._-]{2,16}$/.test(sym) || !unlockDate) continue;
        const uMatch = universe.find((u) => u.symbol === sym);
        const catRaw = String(o.shareholderCategory || 'Promoter');
        const shareholderCategory: LockInEventRecord['shareholderCategory'] =
          catRaw === 'Local Affected' || catRaw === 'Employee' || catRaw === 'Foreign' || catRaw === 'Mixed'
            ? catRaw
            : 'Promoter';
        const lockedShares =
          typeof o.lockedShares === 'number' && Number.isFinite(o.lockedShares) && o.lockedShares > 0
            ? Math.round(o.lockedShares)
            : null;
        const pctOfTotalShares = parsePctNumber(o.pctOfTotalShares);
        const headline =
          strOrNull(o.headline) ||
          `${shareholderCategory} share lock-in expires on ${unlockDate}`;
        const url = safeHttpUrl(o.url) || citations[0]?.uri || null;

        this.upsertLockInEvent({
          id: makeLockInId(sym, unlockDate, shareholderCategory),
          symbol: sym,
          companyName: uMatch?.name || sym,
          shareholderCategory,
          unlockDate,
          lockedShares,
          pctOfTotalShares,
          headline,
          sourceLabel: 'Google Search Distilled',
          sourceUrl: url,
          retrievedAt: nowIso,
          method: 'Search Grounded',
        });
        lockInEventsAdded++;

        const days = computeDaysBetweenDates(unlockDate);
        if (days !== null && days >= -7 && days <= 120) {
          const comp = this.state.companies[sym];
          if (comp) {
            comp.lockInOverhangFlag = true;
            if (!comp.riskFlags.some((r) => r.includes(unlockDate))) {
              comp.riskFlags.unshift(`${shareholderCategory} lock-in expiry on ${unlockDate}: ${headline}`);
            }
            comp.cdscStatus = comp.cdscStatus || headline;
            comp.updatedAt = nowIso;
          }
        }
      }

      if (corporateActionsAdded > 0 || lockInEventsAdded > 0) {
        this.state.lastHarvestAt = nowIso;
        this.save();
      }

      return { corporateActionsAdded, lockInEventsAdded, warning: null };
    } catch (err) {
      return {
        corporateActionsAdded: 0,
        lockInEventsAdded: 0,
        warning: `Google Search corporate action distillation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  public async harvestAgencies(
    agenciesInput: RegulatoryAgency[],
    store: MarketStore
  ): Promise<{
    addedNotices: number;
    companiesUpdated: number;
    corporateActionsAdded: number;
    lockInEventsAdded: number;
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
    let directCompaniesUpdated = 0;
    let corporateActionsAdded = 0;
    let lockInEventsAdded = 0;

    // Run direct portal fetchers + corporate portal structured feeds in parallel
    const [scrapeRuns, corpPortalRes] = await Promise.all([
      Promise.all(
        agencies.map(async (agency) => ({
          agency,
          res: await this.directScrapeAgency(agency, universe),
        }))
      ),
      this.fetchShareSansarCorporatePortals(universe),
    ]);

    const nowIso = new Date().toISOString();
    for (const { agency, res } of scrapeRuns) {
      directResults[agency] = res.notices.length;
      for (const n of res.notices) {
        this.upsertNotice(n);
        directCompaniesUpdated += this.syncNoticeToCompanies(n, universe);
        addedNotices++;
      }
      if (res.notices.length > 0) {
        this.state.agencyLastFetch[agency] = nowIso;
      }
      if (res.notices.length === 0 && res.errors.length > 0) {
        warnings.push(`${agency} direct portal unreachable (${res.errors[0]})`);
      }
    }

    for (const ca of corpPortalRes.corporateActions) {
      this.upsertCorporateAction(ca);
      corporateActionsAdded++;
    }
    for (const li of corpPortalRes.lockInEvents) {
      this.upsertLockInEvent(li);
      lockInEventsAdded++;
    }
    if (corpPortalRes.errors.length > 0 && corporateActionsAdded === 0) {
      warnings.push(corpPortalRes.errors[0]);
    }

    // Supplement with Gemini Search Grounding targeting official agency domains & corporate actions
    const [grounded, distilledCorp] = await Promise.all([
      this.searchGroundedAgencyHarvest(agencies, universe),
      this.distillCorporateActionsAndLockInsWithSearch(store),
    ]);
    let groundedCompaniesUpdated = 0;
    for (const n of grounded.notices) {
      this.upsertNotice(n);
      groundedCompaniesUpdated += this.syncNoticeToCompanies(n, universe);
      addedNotices++;
      this.state.agencyLastFetch[n.agency] = nowIso;
    }
    corporateActionsAdded += distilledCorp.corporateActionsAdded;
    lockInEventsAdded += distilledCorp.lockInEventsAdded;
    if (grounded.warning) {
      warnings.push(grounded.warning);
    }
    if (distilledCorp.warning && !warnings.includes(distilledCorp.warning)) {
      warnings.push(distilledCorp.warning);
    }

    this.state.lastHarvestAt = nowIso;
    this.save();

    return {
      addedNotices,
      companiesUpdated: Math.max(
        directCompaniesUpdated + groundedCompaniesUpdated,
        grounded.companiesUpdated
      ),
      corporateActionsAdded,
      lockInEventsAdded,
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

    let response: GenerateContentResponse;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] },
      });
    } catch (innerErr) {
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('NOT_FOUND')) {
        response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: { tools: [{ googleSearch: {} }] },
        });
      } else {
        throw innerErr;
      }
    }

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
