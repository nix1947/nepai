import fs from 'fs';
import path from 'path';
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import type {
  CohortAuditResponse,
  DataFreshnessStatus,
  FixedIncomeBenchmarks,
  MacroIndicators,
  MacroResearchResponse,
  OpportunityCostAssessment,
  RegulatoryUpdate,
  ResearchPoint,
  ResearchSource,
  ScoreFactorItem,
  StockAssessment9Part,
  StockFinancialMetrics,
  StockPeriodComparisons,
  StockRecommendation,
  StockResearchResponse,
} from '../src/types/market.ts';
import type { MarketStore } from './marketStore.ts';
import {
  loadMacroSnapshot,
  saveFundamentalAudit,
  saveMacroSnapshot,
} from './riskEngine.ts';
import { getNepalDateStr } from './fundamental/regulatoryKnowledgeBase.ts';
import { getNepseSector } from './sectors.ts';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes fresh TTL for macro updates
const SEARCH_COOLDOWN_MS = 3 * 60 * 1000; // 3 minute cooldown if Search Grounding hits 429
const DISK_CACHE_PATH = path.resolve(process.cwd(), 'data', '.research-cache.json');

interface CacheEntry<T> {
  expiresAt: number;
  savedAt: string;
  searchedDate?: string;
  data: T;
}

const macroCache = new Map<string, CacheEntry<MacroResearchResponse>>();
const stockCache = new Map<string, CacheEntry<StockResearchResponse>>();
let diskLoaded = false;
let searchQuotaCooldownUntil = 0;

function loadDiskCache(): void {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    if (!fs.existsSync(DISK_CACHE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(DISK_CACHE_PATH, 'utf8')) as {
      macro?: Record<string, CacheEntry<MacroResearchResponse>>;
      stock?: Record<string, CacheEntry<StockResearchResponse>>;
    };
    for (const [k, v] of Object.entries(raw.macro || {})) {
      if (v && v.data) macroCache.set(k, v);
    }
    for (const [k, v] of Object.entries(raw.stock || {})) {
      if (v && v.data) stockCache.set(k, v);
    }
  } catch {
    // ignore corrupt cache file
  }
}

function saveDiskCache(): void {
  try {
    const dir = path.dirname(DISK_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const macroObj: Record<string, CacheEntry<MacroResearchResponse>> = {};
    for (const [k, v] of macroCache.entries()) {
      macroObj[k] = v;
    }
    const stockObj: Record<string, CacheEntry<StockResearchResponse>> = {};
    for (const [k, v] of stockCache.entries()) {
      stockObj[k] = v;
    }
    fs.writeFileSync(
      DISK_CACHE_PATH,
      JSON.stringify({ macro: macroObj, stock: stockObj }, null, 2),
      'utf8'
    );
  } catch {
    // ignore cache write issues
  }
}

function findStaleCachedMacro(): CacheEntry<MacroResearchResponse> | null {
  let latest: CacheEntry<MacroResearchResponse> | null = null;
  for (const entry of macroCache.values()) {
    if (!latest || (entry.savedAt || '') > (latest.savedAt || '')) {
      latest = entry;
    }
  }
  return latest;
}

function findStaleCachedStock(symbol: string): CacheEntry<StockResearchResponse> | null {
  let latest: CacheEntry<StockResearchResponse> | null = null;
  const prefix = `stock:${symbol.toUpperCase()}:`;
  for (const [k, entry] of stockCache.entries()) {
    if (k.startsWith(prefix)) {
      if (!latest || (entry.savedAt || '') > (latest.savedAt || '')) {
        latest = entry;
      }
    }
  }
  return latest;
}

function findTodayCachedStock(
  symbol: string,
  todayNpt: string
): CacheEntry<StockResearchResponse> | null {
  let match: CacheEntry<StockResearchResponse> | null = null;
  const prefix = `stock:${symbol.toUpperCase()}:`;
  for (const [k, entry] of stockCache.entries()) {
    if (!k.startsWith(prefix) || !entry?.data) continue;
    const entryDate =
      entry.searchedDate ||
      (entry.savedAt ? getNepalDateStr(new Date(entry.savedAt)) : null);
    if (entryDate === todayNpt) {
      if (!match || (entry.savedAt || '') > (match.savedAt || '')) {
        match = entry;
      }
    }
  }
  return match;
}

function getAiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add it in Settings > Secrets to run live AI research.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isQuotaError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw.includes('RESOURCE_EXHAUSTED') ||
    raw.includes('"code":429') ||
    raw.includes('429')
  );
}

function isTransientError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    isQuotaError(err) ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('503') ||
    raw.includes('DEADLINE_EXCEEDED') ||
    raw.includes('504')
  );
}

function formatGeminiError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (isQuotaError(err)) {
    return new Error(
      'Gemini API quota exceeded (429). Select a billing-enabled key in Settings > Secrets or retry after cooldown.'
    );
  }
  if (
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('"code":403')
  ) {
    return new Error(
      'Gemini API authentication failed. Verify your GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  return new Error(raw.length > 260 ? `${raw.slice(0, 260)}…` : raw);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelayMs = 600
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || i === retries) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 250);
      await sleep(baseDelayMs * Math.pow(2, i) + jitter);
    }
  }
  throw lastErr;
}

async function callModelWithFallback(prompt: string): Promise<{
  response: GenerateContentResponse;
  model: string;
  searchGrounded: boolean;
  dataStatus: DataFreshnessStatus;
  notice?: string;
}> {
  const ai = getAiClient();
  const now = Date.now();
  const inSearchCooldown = now < searchQuotaCooldownUntil;

  const searchAttempts: Array<{
    model: string;
    useSearch: boolean;
    retries: number;
    notice?: string;
  }> = inSearchCooldown
    ? []
    : [
        { model: PRIMARY_MODEL, useSearch: true, retries: 2 },
        { model: FALLBACK_MODEL, useSearch: true, retries: 1 },
      ];

  const fallbackAttempts: Array<{
    model: string;
    useSearch: boolean;
    retries: number;
    notice: string;
  }> = [
    {
      model: FALLBACK_MODEL,
      useSearch: false,
      retries: 1,
      notice:
        'Google Search Grounding quota was exceeded (429) or in cooldown; non-search model reasoning ran using only loaded NEPSE market records. Unretrieved external financial statements are marked Unavailable.',
    },
    {
      model: PRIMARY_MODEL,
      useSearch: false,
      retries: 1,
      notice:
        'Google Search Grounding quota was exceeded (429) or in cooldown; model reasoning ran using only loaded NEPSE market records. Unretrieved external financial statements are marked Unavailable.',
    },
  ];

  let lastErr: unknown = null;
  for (const attempt of [...searchAttempts, ...fallbackAttempts]) {
    try {
      const response = await retryWithBackoff(
        () =>
          ai.models.generateContent({
            model: attempt.model,
            contents: prompt,
            config: attempt.useSearch ? { tools: [{ googleSearch: {} }] } : undefined,
          }),
        attempt.retries,
        600
      );
      return {
        response,
        model: attempt.model,
        searchGrounded: attempt.useSearch,
        dataStatus: attempt.useSearch ? 'Live' : 'Historical',
        notice: attempt.notice,
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt.useSearch && isQuotaError(err)) {
        searchQuotaCooldownUntil = Date.now() + SEARCH_COOLDOWN_MS;
      }
      console.warn(
        `[researchAi] ${attempt.model} (search=${attempt.useSearch}) failed: ${msg.slice(0, 180)}`
      );
      if (!isTransientError(err)) {
        throw formatGeminiError(err);
      }
    }
  }

  throw formatGeminiError(lastErr);
}

function classifySourceUri(uri: string, title: string): ResearchSource['category'] {
  const u = `${uri} ${title}`.toLowerCase();
  if (u.includes('nepalstock') || u.includes('sebon.gov.np') || u.includes('cdsc')) {
    return 'NEPSE/SEBON';
  }
  if (
    u.includes('nrb.org.np') ||
    u.includes('pdmo.gov.np') ||
    u.includes('mof.gov.np') ||
    u.includes('nia.gov.np') ||
    u.includes('nic.gov.np')
  ) {
    return 'NRB/Gov';
  }
  if (
    u.includes('sharesansar') ||
    u.includes('merolagani') ||
    u.includes('nepsealpha') ||
    u.includes('bizmandu') ||
    u.includes('arthasarokar')
  ) {
    return 'Financial Portal';
  }
  if (u.includes('investor') || u.includes('report') || u.includes('.com.np')) {
    return 'Company/IR';
  }
  return 'Web';
}

function extractSources(response: unknown): ResearchSource[] {
  const resp = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  const chunks = resp?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set<string>();
  const out: ResearchSource[] = [];
  for (const ch of chunks) {
    const uri = ch?.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    const title = (ch?.web?.title || uri).trim();
    out.push({
      uri,
      title,
      category: classifySourceUri(uri, title),
    });
  }
  return out;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return tryParse(candidate.slice(firstBrace, lastBrace + 1));
  }
  return null;
}

function strOrUnavailable(v: unknown, fallback = 'Unavailable'): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length > 0 ? s : fallback;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean);
}

function normalizePoints(raw: unknown): ResearchPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const imp = String(o.impact || 'Medium');
      const impact: 'High' | 'Medium' | 'Low' =
        imp === 'High' || imp === 'Low' ? imp : 'Medium';
      return {
        title: String(o.title || '').trim(),
        detail: String(o.detail || '').trim(),
        impact,
        evidence: o.evidence ? String(o.evidence).trim() : undefined,
      };
    })
    .filter((p) => p.title && p.detail);
}

function normalizeScoreFactors(raw: unknown, defaultType: ScoreFactorItem['sourceType']): ScoreFactorItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const st = String(o.sourceType || defaultType);
      const sourceType: ScoreFactorItem['sourceType'] =
        st === 'Reported' || st === 'Technical' || st === 'Macro' || st === 'Governance'
          ? st
          : defaultType;
      return {
        factor: strOrUnavailable(o.factor, 'Factor'),
        score: Math.max(0, Math.min(100, numOrNull(o.score) ?? 0)),
        maxScore: Math.max(1, Math.min(100, numOrNull(o.maxScore) ?? 25)),
        evidence: strOrUnavailable(o.evidence, 'No reported evidence'),
        sourceType,
      };
    })
    .filter((x) => x.factor !== 'Factor' || x.evidence !== 'No reported evidence');
}

export async function generateMacroResearch(
  store: MarketStore,
  forceRefresh = false
): Promise<MacroResearchResponse> {
  loadDiskCache();
  const dates = store.getDates();
  const latestDate = dates[dates.length - 1] || 'latest';
  const cacheKey = `macro:${latestDate}`;

  if (!forceRefresh) {
    const hit = macroCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return { ...hit.data, cached: true, dataStatus: 'Cached' };
    }
  }

  const daily = store.getDailyAggregates();
  const latestAgg = daily[daily.length - 1];
  const top5 =
    latestDate !== 'latest'
      ? store
          .rangeSummary(latestDate, latestDate, true)
          .slice(0, 5)
          .map((r) => `${r.symbol} (${(r.turnover / 1e7).toFixed(1)} cr, ${(r.change_pct ?? 0).toFixed(2)}%)`)
          .join(', ')
      : 'N/A';

  const marketContext = latestAgg
    ? `Latest loaded NEPSE session (${latestAgg.date}): Total Turnover Rs ${(latestAgg.turnover / 1e7).toFixed(2)} crore across ${latestAgg.companies} equities (${latestAgg.advancers} advancers, ${latestAgg.decliners} decliners). Top turnover stocks: ${top5}.`
    : 'No local NEPSE CSV loaded yet.';

  const prompt = `You are a senior NEPSE (Nepal Stock Exchange), fixed-income, and global macro strategist.
Use Google Search to retrieve the LATEST verified data from Nepal Rastra Bank (NRB), Public Debt Management Office (PDMO), SEBON, Nepal Insurance Authority (NIA), NEPSE, Ministry of Finance (MoF), and commercial bank rate publications.

IMPORTANT ANTI-FABRICATION RULE:
- Report ONLY verified rates, dates, and policy directives found in your search.
- If a specific figure (e.g., 28-day T-bill rate or a specific bond yield) cannot be verified, write "Unavailable" — NEVER invent or guess numbers.

Research scope:
1) Nepal Fixed-Income & Interest Rate Benchmarks:
   - Latest Nepal Government Treasury Bill weighted average discount rates (28-day, 91-day, 182-day, 364-day)
   - Latest Government / Development Bond & Citizen Savings Bond yields (PDMO / NRB)
   - Prevailing Commercial Bank & BFI Fixed Deposit (FD) interest rates (individual & institutional average range) and interest rate direction
   - NRB Policy Rate / Bank Rate / SDF / SLF rates
2) Nepal Monetary, Liquidity & Macro Indicators:
   - Banking CD ratio, excess liquidity / interbank rate, CPI inflation, gross FX reserves (months of import cover), private sector credit growth, remittance inflows, government capital expenditure
3) Regulatory Directives & Circulars:
   - Recent policy updates, circulars, and directives from NRB, NIA (Insurance Authority), SEBON, NEPSE, MoF/PDMO affecting listed companies & sectors
4) Global Macro Spillovers:
   - US Fed outlook, RBI/India trends, crude oil & gold, USD/NPR, global risk sentiment impacting Nepal's imports, remittances, and NEPSE risk appetite.

Local market context:
${marketContext}

Return ONLY valid JSON in English (no prose outside the JSON object) matching this exact schema:
{
  "nepalSummary": "2-3 sentence executive summary of Nepal economy, interest rate cycle, and equity vs fixed-income backdrop.",
  "worldSummary": "2-3 sentence executive summary of global macro conditions and spillover impact on Nepal.",
  "fixedIncomeBenchmarks": {
    "tbill28d": "e.g. X.XX% (or Unavailable)",
    "tbill91d": "e.g. X.XX% (or Unavailable)",
    "tbill182d": "e.g. X.XX% (or Unavailable)",
    "tbill364d": "e.g. X.XX% (or Unavailable)",
    "govBondYield": "e.g. X.XX% Development Bond / Citizen Bond (or Unavailable)",
    "devBondYield": "e.g. X.XX% (or Unavailable)",
    "bankFdIndividualRate": "e.g. 5.5% - 6.75% avg (or Unavailable)",
    "bankFdInstitutionalRate": "e.g. 4.0% - 5.5% avg (or Unavailable)",
    "nrbPolicyRate": "e.g. Policy X% / Bank Rate X% (or Unavailable)",
    "rateTrend": "Falling / Easing" | "Stable" | "Rising / Tightening" | "Mixed / Unavailable",
    "asOfDate": "Exact date or month of retrieved NRB/bank rates (or Unavailable)",
    "sourceNote": "Brief note naming NRB/PDMO/bank notices used"
  },
  "macroIndicators": {
    "cdRatio": "e.g. ~79% (or Unavailable)",
    "bankingLiquidity": "brief verified note or Unavailable",
    "cpiInflation": "e.g. X.XX% YoY (or Unavailable)",
    "fxReserves": "e.g. USD XX.X bn / XX months imports (or Unavailable)",
    "creditGrowth": "e.g. X.X% YoY (or Unavailable)",
    "remittanceTrend": "brief verified note or Unavailable",
    "fiscalCapex": "brief verified note or Unavailable"
  },
  "regulatoryUpdates": [
    {
      "authority": "NRB" | "NIA" | "SEBON" | "NEPSE" | "MoF/PDMO" | "Other",
      "date": "YYYY-MM or date",
      "title": "...",
      "summary": "Specific circular/directive impact on listed companies",
      "impact": "Positive" | "Negative" | "Neutral" | "Mixed",
      "impactedSectors": ["Commercial Banks", "Microfinance", "etc."]
    }
  ],
  "nepalOpportunities": [
    { "title": "...", "detail": "...", "impact": "High" | "Medium" | "Low" }
  ],
  "nepalRisks": [
    { "title": "...", "detail": "...", "impact": "High" | "Medium" | "Low" }
  ],
  "worldOpportunities": [
    { "title": "...", "detail": "...", "impact": "High" | "Medium" | "Low" }
  ],
  "worldRisks": [
    { "title": "...", "detail": "...", "impact": "High" | "Medium" | "Low" }
  ],
  "sectorsToWatch": [
    { "sector": "Commercial Banks / Hydropower / etc.", "stance": "Positive" | "Neutral" | "Cautious", "reason": "..." }
  ]
}`;

  try {
    const { response, model, searchGrounded, dataStatus, notice } = await callModelWithFallback(prompt);
    const text = (response.text || '').trim();
    const sources = extractSources(response);
    const parsed = extractJsonObject(text);
    const nowIso = new Date().toISOString();

    const rawFi = parsed?.fixedIncomeBenchmarks as Record<string, unknown> | undefined;
    const rawTrend = String(rawFi?.rateTrend || 'Mixed / Unavailable');
    const rateTrend: FixedIncomeBenchmarks['rateTrend'] =
      rawTrend === 'Falling / Easing' ||
      rawTrend === 'Stable' ||
      rawTrend === 'Rising / Tightening'
        ? rawTrend
        : 'Mixed / Unavailable';

    const fixedIncomeBenchmarks: FixedIncomeBenchmarks | undefined = rawFi
      ? {
          tbill28d: strOrUnavailable(rawFi.tbill28d),
          tbill91d: strOrUnavailable(rawFi.tbill91d),
          tbill182d: strOrUnavailable(rawFi.tbill182d),
          tbill364d: strOrUnavailable(rawFi.tbill364d),
          govBondYield: strOrUnavailable(rawFi.govBondYield),
          devBondYield: strOrUnavailable(rawFi.devBondYield),
          bankFdIndividualRate: strOrUnavailable(rawFi.bankFdIndividualRate),
          bankFdInstitutionalRate: strOrUnavailable(rawFi.bankFdInstitutionalRate),
          nrbPolicyRate: strOrUnavailable(rawFi.nrbPolicyRate),
          rateTrend,
          asOfDate: strOrUnavailable(rawFi.asOfDate),
          sourceNote: strOrUnavailable(rawFi.sourceNote, 'Search grounded macro summary'),
        }
      : undefined;

    const rawInd = parsed?.macroIndicators as Record<string, unknown> | undefined;
    const macroIndicators: MacroIndicators | undefined = rawInd
      ? {
          cdRatio: strOrUnavailable(rawInd.cdRatio),
          bankingLiquidity: strOrUnavailable(rawInd.bankingLiquidity),
          cpiInflation: strOrUnavailable(rawInd.cpiInflation),
          fxReserves: strOrUnavailable(rawInd.fxReserves),
          creditGrowth: strOrUnavailable(rawInd.creditGrowth),
          remittanceTrend: strOrUnavailable(rawInd.remittanceTrend),
          fiscalCapex: strOrUnavailable(rawInd.fiscalCapex),
        }
      : undefined;

    const regulatoryUpdates: RegulatoryUpdate[] = Array.isArray(parsed?.regulatoryUpdates)
      ? parsed.regulatoryUpdates.map((u) => {
          const o = u && typeof u === 'object' ? (u as Record<string, unknown>) : {};
          const auth = String(o.authority || 'Other');
          const authority: RegulatoryUpdate['authority'] =
            auth === 'NRB' ||
            auth === 'NIA' ||
            auth === 'SEBON' ||
            auth === 'NEPSE' ||
            auth === 'MoF/PDMO'
              ? auth
              : 'Other';
          const imp = String(o.impact || 'Neutral');
          const impact: RegulatoryUpdate['impact'] =
            imp === 'Positive' || imp === 'Negative' || imp === 'Mixed' ? imp : 'Neutral';
          return {
            authority,
            date: strOrUnavailable(o.date, 'Recent'),
            title: strOrUnavailable(o.title, 'Regulatory Notice'),
            summary: strOrUnavailable(o.summary, ''),
            impact,
            impactedSectors: stringList(o.impactedSectors),
          };
        })
      : [];

    const result: MacroResearchResponse = parsed
      ? {
          generatedAt: nowIso,
          retrievedAt: nowIso,
          dataStatus: searchGrounded ? 'Live' : dataStatus,
          model,
          cached: false,
          searchGrounded,
          notice,
          nepalSummary: String(parsed.nepalSummary || '').trim(),
          worldSummary: String(parsed.worldSummary || '').trim(),
          fixedIncomeBenchmarks,
          macroIndicators,
          regulatoryUpdates,
          nepalOpportunities: normalizePoints(parsed.nepalOpportunities),
          nepalRisks: normalizePoints(parsed.nepalRisks),
          worldOpportunities: normalizePoints(parsed.worldOpportunities),
          worldRisks: normalizePoints(parsed.worldRisks),
          sectorsToWatch: Array.isArray(parsed.sectorsToWatch)
            ? parsed.sectorsToWatch.map((s) => {
                const o = s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
                const st = String(o.stance || 'Neutral');
                const stance: 'Positive' | 'Neutral' | 'Cautious' =
                  st === 'Positive' || st === 'Cautious' ? st : 'Neutral';
                return {
                  sector: String(o.sector || '').trim(),
                  stance,
                  reason: String(o.reason || '').trim(),
                };
              })
            : [],
          sources,
        }
      : {
          generatedAt: nowIso,
          retrievedAt: nowIso,
          dataStatus: searchGrounded ? 'Live' : dataStatus,
          model,
          cached: false,
          searchGrounded,
          notice,
          nepalSummary: text,
          worldSummary: '',
          nepalOpportunities: [],
          nepalRisks: [],
          worldOpportunities: [],
          worldRisks: [],
          sectorsToWatch: [],
          sources,
          rawFallback: text,
        };

    macroCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      savedAt: nowIso,
      data: result,
    });
    saveDiskCache();
    saveMacroSnapshot(store, result);
    return result;
  } catch (err) {
    // Fallback to previously verified cached macro data if quota exceeded
    const stale = findStaleCachedMacro();
    if (stale && isQuotaError(err)) {
      return {
        ...stale.data,
        cached: true,
        dataStatus: 'Cached',
        notice: `Live Google Search returned HTTP 429 (quota exceeded). Showing previously retrieved macro & fixed-income report from ${new Date(stale.savedAt).toLocaleString()}.`,
      };
    }
    throw err;
  }
}

export async function generateStockResearch(
  store: MarketStore,
  symbolInput: string,
  forceRefresh = false,
  nDays = 20
): Promise<StockResearchResponse> {
  loadDiskCache();
  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9._-]{1,20}$/.test(symbol)) {
    throw new Error('Invalid stock symbol');
  }

  const history = store.getSymbolHistory(symbol);
  const last = history[history.length - 1];
  const companyName = last?.name || symbol;
  const sector = getNepseSector(symbol, companyName);
  const cacheKey = `stock:${symbol}:${last?.date || 'latest'}`;
  const todayNpt = getNepalDateStr();

  if (!forceRefresh) {
    const todayHit = findTodayCachedStock(symbol, todayNpt);
    if (todayHit) {
      return {
        ...todayHit.data,
        cached: true,
        skippedToday: true,
        searchedDate: todayNpt,
        dataStatus: 'Cached',
        notice: `Already searched today (${todayNpt} NPT) — skipped repeat crawl and serving today's cached report.`,
      };
    }
  }

  // Pull cached macro/fixed-income backdrop (do not fail if macro unavailable)
  let macro = loadMacroSnapshot(store) || findStaleCachedMacro()?.data || null;
  if (!macro && Date.now() >= searchQuotaCooldownUntil) {
    try {
      macro = await generateMacroResearch(store, false);
    } catch {
      macro = null;
    }
  }

  const cleanN = Math.max(5, Math.min(250, Math.round(nDays)));
  const sliceN = history.slice(-cleanN);
  const avgTurnN =
    sliceN.length > 0 ? sliceN.reduce((s, r) => s + r.turnover, 0) / sliceN.length : 0;
  const avgVolN =
    sliceN.length > 0 ? sliceN.reduce((s, r) => s + r.volume, 0) / sliceN.length : 0;
  const firstBase = sliceN[0] ? (sliceN[0].prev_close > 0 ? sliceN[0].prev_close : sliceN[0].close) : 0;
  const returnN =
    last && firstBase > 0 ? (((last.close - firstBase) / firstBase) * 100).toFixed(2) : 'N/A';

  const priceContext = last
    ? `NEPSE EOD Snapshot (${last.date}) for ${symbol} (${companyName}, Sector: ${sector}):
- LTP / Close: Rs ${last.ltp || last.close} (Day Chg: ${last.diff_pct ?? 0}%, ${cleanN}-day return: ${returnN}%)
- Turnover: Rs ${(last.turnover / 1e7).toFixed(2)} crore (${avgTurnN > 0 ? (last.turnover / avgTurnN).toFixed(2) : 'N/A'}x ${cleanN}d avg) across ${last.trans} trades
- Volume: ${last.volume.toLocaleString()} shares (${avgVolN > 0 ? (last.volume / avgVolN).toFixed(2) : 'N/A'}x ${cleanN}d avg)
- Technicals: VWAP Rs ${last.vwap ?? 'N/A'} (${last.vwap_pct ?? 'N/A'}%), MA120 Rs ${last.d120 ?? 'N/A'}, MA180 Rs ${last.d180 ?? 'N/A'}, 52W High Rs ${last.w52_high ?? 'N/A'}, 52W Low Rs ${last.w52_low ?? 'N/A'}.`
    : `NEPSE listed security: ${symbol} (${sector}). No local NEPSE EOD rows loaded for this symbol.`;

  const fi = macro?.fixedIncomeBenchmarks;
  const macroBenchmarkContext = fi
    ? `Latest Retrieved Nepal Fixed-Income & Macro Benchmarks (${fi.asOfDate}, status: ${macro?.dataStatus}):
- Commercial Bank Individual FD Rate: ${fi.bankFdIndividualRate} | Institutional FD: ${fi.bankFdInstitutionalRate}
- Treasury Bills: 91d ${fi.tbill91d}, 182d ${fi.tbill182d}, 364d ${fi.tbill364d}
- Government / Development Bond Yield: ${fi.govBondYield} (Dev Bond: ${fi.devBondYield})
- NRB Policy Rate: ${fi.nrbPolicyRate} | Rate Trend: ${fi.rateTrend}
- Macro Context: ${macro?.nepalSummary || ''}`
    : 'Nepal Fixed-Income Benchmarks not yet retrieved; if Google Search finds current Nepal Bank FD, T-Bill, and Government Bond yields, use them for opportunity-cost comparison; otherwise state "Unavailable".';

  const prompt = `You are an institutional NEPSE equity research analyst. Perform a deep, research-driven fundamental, macro, and risk-adjusted opportunity-cost analysis for "${symbol}" (${companyName}, Sector: ${sector}) on the Nepal Stock Exchange (NEPSE).

Use Google Search to retrieve:
1. The LATEST available quarterly report (Q1/Q2/Q3/Q4 unaudited financial disclosure) and latest audited annual report / AGM disclosure. Prioritize official company websites/IR pages, NEPSE, SEBON, and official financial disclosures.
2. Exact reporting period (e.g., "Q1 FY 2082/83" or "FY 2081/82"), publication date, and source context.
3. Extracted verified financial metrics: Revenue/Interest Income, Net Profit, EPS (annualized if quarterly—clearly labeled), Net Worth per Share, P/E, P/B, ROE, ROA, Reserves, Retained Earnings, Total Assets, Total Liabilities, Deposits, Loans, NPL %, Capital Adequacy (CAR), Liquidity/CCD, Operating Cash Flow, Dividend History, and sector-specific KPIs (e.g., Hydro MW / PPA / Cost per MW; Insurance solvency / net premium / claim ratio; Manufacturing capacity utilization).
4. Quarter-over-Quarter (QoQ), Year-over-Year corresponding quarter (YoY), and Annual performance comparisons, noting ANY inconsistencies between quarterly and annual figures.
5. Current NRB/NIA/SEBON regulatory exposure, governance issues, audit qualifications, and opportunity-cost comparison against Nepal Bank FD, T-Bills, and Gov Bond yields.
6. Separate CORE OPERATING PROFIT growth from NON-OPERATING / ONE-OFF GAINS: check whether profit or EPS growth reflects sustainable Operating Profit or one-time gains from selling investments, property/fixed-asset disposals, fair-value revaluations, or provision write-backs. Whenever bottom-line Net Profit outpaces core Operating Profit or relies on non-operating income, explicitly add a caution in "fundamentalRedFlags" and anchor your growth assessment on Operating Profit.

STRICT ANTI-FABRICATION RULES:
- NEVER invent, estimate, or fill in missing financial figures. If a metric or report cannot be verified in search results, output "Unavailable" and list the gap in "limitations".
- Clearly separate VERIFIED REPORTED FACTS from AI-GENERATED INTERPRETATIONS in "periodComparisons.factsVsInterpretation".
- Do NOT confuse a short-term technical price dip with fundamental weakness.

${priceContext}

${macroBenchmarkContext}

Return ONLY valid JSON in English (no prose outside the JSON object) matching this exact schema:
{
  "reportingPeriod": "Exact quarter/FY retrieved e.g. Q1 FY 2082/83 (or Unavailable)",
  "publicationDate": "Exact disclosure/publication date (or Unavailable)",
  "reportType": "Quarterly" | "Annual" | "Mixed" | "Unavailable",
  "limitations": ["List any missing reports, unavailable KPIs, or unverified fields"],
  "recommendation": "BUY" | "HOLD" | "WATCHLIST" | "AVOID",
  "stance": "Bullish" | "Neutral" | "Cautious",
  "riskScore": 0-100,
  "opportunityScore": 0-100,
  "summary": "3-sentence executive thesis integrating financial health, technical position, and FD/Bond opportunity cost.",
  "fundamentalRedFlags": ["Only verified financial/regulatory/audit red flags (empty array if none verified)"],
  "governanceRegulatoryFlags": ["Verified governance, SEBON/NRB/NIA compliance, or audit qualification issues (empty if none)"],
  "riskBreakdown": [
    { "factor": "Earnings & Margin Quality", "score": 0, "maxScore": 25, "evidence": "Reported citation or Unavailable", "sourceType": "Reported" },
    { "factor": "Balance Sheet, Debt / NPL & Cash Flow", "score": 0, "maxScore": 25, "evidence": "...", "sourceType": "Reported" },
    { "factor": "Valuation & Fixed-Income Opportunity Cost", "score": 0, "maxScore": 25, "evidence": "...", "sourceType": "Macro" },
    { "factor": "Governance, Regulation & Technical Risk", "score": 0, "maxScore": 25, "evidence": "...", "sourceType": "Governance" }
  ],
  "opportunityBreakdown": [
    { "factor": "Core Earnings Growth & ROE Trajectory", "score": 0, "maxScore": 30, "evidence": "...", "sourceType": "Reported" },
    { "factor": "Valuation Margin of Safety & Dividend Yield", "score": 0, "maxScore": 25, "evidence": "...", "sourceType": "Reported" },
    { "factor": "Sector Catalysts & Capacity Expansion", "score": 0, "maxScore": 25, "evidence": "...", "sourceType": "Reported" },
    { "factor": "Macro Rate Tailwind & Technical Confirmation", "score": 0, "maxScore": 20, "evidence": "...", "sourceType": "Technical" }
  ],
  "financialMetrics": {
    "reportingPeriod": "...",
    "publicationDate": "...",
    "reportType": "Quarterly" | "Annual" | "Mixed" | "Unavailable",
    "revenue": "Verified figure + period or Unavailable",
    "netProfit": "Verified figure + period or Unavailable",
    "eps": "Verified EPS or Unavailable",
    "netWorthPerShare": "Verified book value or Unavailable",
    "pe": "Verified P/E or Unavailable",
    "pb": "Verified P/B or Unavailable",
    "roe": "Verified ROE % or Unavailable",
    "roa": "Verified ROA % or Unavailable",
    "reserves": "Verified reserves or Unavailable",
    "retainedEarnings": "Verified retained earnings or Unavailable",
    "totalAssets": "Verified total assets or Unavailable",
    "totalLiabilities": "Verified total liabilities or Unavailable",
    "deposits": "Verified deposits (for BFIs) or N/A / Unavailable",
    "loans": "Verified loans (for BFIs) or N/A / Unavailable",
    "npl": "Verified NPL % (for BFIs) or N/A / Unavailable",
    "car": "Verified Capital Adequacy % or N/A / Unavailable",
    "liquidityRatio": "Verified CCD/liquidity ratio or Unavailable",
    "cashFlow": "Verified Operating Cash Flow or Unavailable",
    "dividendHistory": "Last 2-3 FY bonus/cash dividend history or Unavailable",
    "sectorSpecific": [
      { "label": "Sector KPI name", "value": "Verified value or Unavailable" }
    ]
  },
  "periodComparisons": {
    "qoq": "Latest quarter vs immediately prior quarter comparison citing verified periods/numbers or Unavailable",
    "yoy": "Latest quarter vs corresponding quarter last FY comparison citing verified periods/numbers or Unavailable",
    "annual": "Latest full annual report comparison vs prior FY or Unavailable",
    "inconsistencies": "Any discrepancy between unaudited quarterly reports and audited annual report (or 'None identified in verified disclosures')",
    "factsVsInterpretation": {
      "facts": ["Strictly reported factual bullet with exact reporting period"],
      "interpretations": ["Analytical interpretation or forward assumption clearly separated from reported facts"]
    }
  },
  "assessment9Part": {
    "businessHealth": "(1) Business model, balance sheet quality, and financial health summary",
    "fundamentalStrengths": ["(2) Verified fundamental strengths"],
    "majorRisksRedFlags": ["(3) Major risks and warning signs"],
    "growthOpportunities": ["(4) Growth opportunities and expansion/earnings catalysts"],
    "financialTrendAnalysis": "(5) Multi-period trend synthesis across QoQ, YoY, and Annual",
    "valuationAssessment": "(6) Valuation P/E, P/B, ROE vs sector peers and historical multiples",
    "scenarios": {
      "bull": "(7a) Bull case drivers & upside triggers",
      "base": "(7b) Base case realistic trajectory",
      "bear": "(7c) Bear case downside risks & capital loss drivers"
    },
    "nextQuarterWatchlist": ["(8) Specific financial metrics/thresholds to monitor next quarter"],
    "overallOutlook": "(9) Final investment verdict explaining WHY it is an opportunity or risk and WHAT developments would change the decision"
  },
  "opportunityCost": {
    "benchmarkFdRateText": "Current Bank FD rate used for comparison (or Unavailable)",
    "benchmarkTBillText": "Current T-Bill rate used (or Unavailable)",
    "benchmarkBondYieldText": "Current Gov Bond yield used (or Unavailable)",
    "benchmarkFdPct": 6.5,
    "stockEarningsYieldPct": null,
    "expectedReturnThesis": "Compare expected equity dividend/earnings growth return vs risk-free/FD alternative",
    "beatsFixedIncome": true,
    "verdict": "Clear opportunity-cost judgment: does equity risk compensate adequately vs Nepal FD and Government Bonds?"
  },
  "opportunities": [
    { "title": "...", "detail": "...", "impact": "High" | "Medium" | "Low", "evidence": "Reporting period / source note" }
  ],
  "risks": [
    { "title": "...", "detail": "...", "impact": "High" | "Medium" | "Low", "evidence": "Reporting period / source note" }
  ],
  "macroLinkage": "Specific sensitivity to NRB policy/interest rates, Nepal liquidity, regulatory directives, and global macro factors.",
  "catalysts": [
    { "headline": "...", "timeframe": "Near-term / Next Quarter / AGM" }
  ]
}`;

  try {
    const { response, model, searchGrounded, dataStatus, notice } = await callModelWithFallback(prompt);
    const text = (response.text || '').trim();
    const sources = extractSources(response);
    const parsed = extractJsonObject(text);
    const nowIso = new Date().toISOString();

    if (!parsed) {
      const fallback: StockResearchResponse = {
        symbol,
        companyName,
        sector,
        generatedAt: nowIso,
        retrievedAt: nowIso,
        dataStatus: searchGrounded ? 'Live' : dataStatus,
        model,
        cached: false,
        searchGrounded,
        notice,
        reportingPeriod: 'Unavailable',
        publicationDate: 'Unavailable',
        reportType: 'Unavailable',
        limitations: ['Model returned unstructured output; structured financial indicators could not be parsed.'],
        recommendation: 'WATCHLIST',
        riskScore: 50,
        opportunityScore: 50,
        riskBreakdown: [],
        opportunityBreakdown: [],
        fundamentalRedFlags: [],
        governanceRegulatoryFlags: [],
        summary: text,
        stance: 'Neutral',
        opportunities: [],
        risks: [],
        macroLinkage: '',
        catalysts: [],
        sources,
        rawFallback: text,
      };
      stockCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, savedAt: nowIso, data: fallback });
      saveDiskCache();
      return fallback;
    }

    const rawStance = String(parsed.stance || 'Neutral');
    const stance: 'Bullish' | 'Neutral' | 'Cautious' =
      rawStance === 'Bullish' || rawStance === 'Cautious' ? rawStance : 'Neutral';

    const rawRec = String(parsed.recommendation || 'WATCHLIST').toUpperCase();
    const recommendation: StockRecommendation =
      rawRec === 'BUY' || rawRec === 'HOLD' || rawRec === 'AVOID' ? rawRec : 'WATCHLIST';

    const rawFm = (parsed.financialMetrics || {}) as Record<string, unknown>;
    const rawReportType = String(parsed.reportType || rawFm.reportType || 'Unavailable');
    const reportType: StockResearchResponse['reportType'] =
      rawReportType === 'Quarterly' || rawReportType === 'Annual' || rawReportType === 'Mixed'
        ? rawReportType
        : 'Unavailable';

    const reportingPeriod = strOrUnavailable(parsed.reportingPeriod ?? rawFm.reportingPeriod);
    const publicationDate = strOrUnavailable(parsed.publicationDate ?? rawFm.publicationDate);

    const financialMetrics: StockFinancialMetrics = {
      reportingPeriod,
      publicationDate,
      reportType,
      revenue: strOrUnavailable(rawFm.revenue),
      netProfit: strOrUnavailable(rawFm.netProfit),
      eps: strOrUnavailable(rawFm.eps),
      netWorthPerShare: strOrUnavailable(rawFm.netWorthPerShare),
      pe: strOrUnavailable(rawFm.pe),
      pb: strOrUnavailable(rawFm.pb),
      roe: strOrUnavailable(rawFm.roe),
      roa: strOrUnavailable(rawFm.roa),
      reserves: strOrUnavailable(rawFm.reserves),
      retainedEarnings: strOrUnavailable(rawFm.retainedEarnings),
      totalAssets: strOrUnavailable(rawFm.totalAssets),
      totalLiabilities: strOrUnavailable(rawFm.totalLiabilities),
      deposits: strOrUnavailable(rawFm.deposits),
      loans: strOrUnavailable(rawFm.loans),
      npl: strOrUnavailable(rawFm.npl),
      car: strOrUnavailable(rawFm.car),
      liquidityRatio: strOrUnavailable(rawFm.liquidityRatio),
      cashFlow: strOrUnavailable(rawFm.cashFlow),
      dividendHistory: strOrUnavailable(rawFm.dividendHistory),
      sectorSpecific: Array.isArray(rawFm.sectorSpecific)
        ? rawFm.sectorSpecific.map((s) => {
            const o = s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
            return {
              label: strOrUnavailable(o.label, 'Metric'),
              value: strOrUnavailable(o.value),
            };
          })
        : [],
    };

    const rawPc = (parsed.periodComparisons || {}) as Record<string, unknown>;
    const rawFvi = (rawPc.factsVsInterpretation || {}) as Record<string, unknown>;
    const periodComparisons: StockPeriodComparisons = {
      qoq: strOrUnavailable(rawPc.qoq),
      yoy: strOrUnavailable(rawPc.yoy),
      annual: strOrUnavailable(rawPc.annual),
      inconsistencies: strOrUnavailable(rawPc.inconsistencies, 'None identified in retrieved disclosures.'),
      factsVsInterpretation: {
        facts: stringList(rawFvi.facts),
        interpretations: stringList(rawFvi.interpretations),
      },
    };

    const raw9 = (parsed.assessment9Part || {}) as Record<string, unknown>;
    const rawScen = (raw9.scenarios || {}) as Record<string, unknown>;
    const assessment9Part: StockAssessment9Part = {
      businessHealth: strOrUnavailable(raw9.businessHealth, String(parsed.summary || '')),
      fundamentalStrengths: stringList(raw9.fundamentalStrengths),
      majorRisksRedFlags: stringList(raw9.majorRisksRedFlags),
      growthOpportunities: stringList(raw9.growthOpportunities),
      financialTrendAnalysis: strOrUnavailable(raw9.financialTrendAnalysis),
      valuationAssessment: strOrUnavailable(raw9.valuationAssessment),
      scenarios: {
        bull: strOrUnavailable(rawScen.bull),
        base: strOrUnavailable(rawScen.base),
        bear: strOrUnavailable(rawScen.bear),
      },
      nextQuarterWatchlist: stringList(raw9.nextQuarterWatchlist),
      overallOutlook: strOrUnavailable(raw9.overallOutlook, String(parsed.summary || '')),
    };

    const rawOc = (parsed.opportunityCost || {}) as Record<string, unknown>;
    const opportunityCost: OpportunityCostAssessment = {
      benchmarkFdRateText: strOrUnavailable(
        rawOc.benchmarkFdRateText,
        fi?.bankFdIndividualRate || 'Unavailable'
      ),
      benchmarkTBillText: strOrUnavailable(
        rawOc.benchmarkTBillText,
        fi?.tbill91d || 'Unavailable'
      ),
      benchmarkBondYieldText: strOrUnavailable(
        rawOc.benchmarkBondYieldText,
        fi?.govBondYield || 'Unavailable'
      ),
      benchmarkFdPct: numOrNull(rawOc.benchmarkFdPct),
      stockEarningsYieldPct: numOrNull(rawOc.stockEarningsYieldPct),
      expectedReturnThesis: strOrUnavailable(rawOc.expectedReturnThesis),
      beatsFixedIncome:
        typeof rawOc.beatsFixedIncome === 'boolean' ? rawOc.beatsFixedIncome : null,
      verdict: strOrUnavailable(rawOc.verdict),
    };

    const limitations = stringList(parsed.limitations);
    if (!searchGrounded) {
      limitations.unshift(
        'Live Google Search Grounding was unavailable (429/cooldown); recent external quarterly/annual PDFs could not be fetched live.'
      );
    }

    const result: StockResearchResponse = {
      symbol,
      companyName,
      sector,
      generatedAt: nowIso,
      retrievedAt: nowIso,
      dataStatus: searchGrounded ? 'Live' : dataStatus,
      model,
      cached: false,
      skippedToday: false,
      searchedDate: todayNpt,
      searchGrounded,
      notice,
      reportingPeriod,
      publicationDate,
      reportType,
      limitations,
      recommendation,
      riskScore: Math.round(Math.max(0, Math.min(100, numOrNull(parsed.riskScore) ?? 50))),
      opportunityScore: Math.round(Math.max(0, Math.min(100, numOrNull(parsed.opportunityScore) ?? 50))),
      riskBreakdown: normalizeScoreFactors(parsed.riskBreakdown, 'Reported'),
      opportunityBreakdown: normalizeScoreFactors(parsed.opportunityBreakdown, 'Reported'),
      fundamentalRedFlags: stringList(parsed.fundamentalRedFlags),
      governanceRegulatoryFlags: stringList(parsed.governanceRegulatoryFlags),
      financialMetrics,
      periodComparisons,
      assessment9Part,
      opportunityCost,
      summary: String(parsed.summary || '').trim(),
      stance,
      opportunities: normalizePoints(parsed.opportunities),
      risks: normalizePoints(parsed.risks),
      macroLinkage: String(parsed.macroLinkage || '').trim(),
      catalysts: Array.isArray(parsed.catalysts)
        ? parsed.catalysts.map((c) => {
            const o = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
            return {
              headline: String(o.headline || '').trim(),
              timeframe: String(o.timeframe || 'Upcoming').trim(),
            };
          })
        : [],
      sources,
    };

    stockCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      savedAt: nowIso,
      searchedDate: todayNpt,
      data: result,
    });
    saveDiskCache();
    saveFundamentalAudit(store, result);
    return result;
  } catch (err) {
    const stale = findStaleCachedStock(symbol);
    if (stale && isQuotaError(err)) {
      const cachedFallback: StockResearchResponse = {
        ...stale.data,
        cached: true,
        dataStatus: 'Cached',
        notice: `Live Google Search returned HTTP 429 (quota exceeded). Serving previously verified cached report from ${new Date(stale.savedAt).toLocaleString()}.`,
      };
      saveFundamentalAudit(store, cachedFallback);
      return cachedFallback;
    }
    throw err;
  }
}

export async function auditCohortStocks(
  store: MarketStore,
  symbols: string[],
  nDays = 20
): Promise<CohortAuditResponse> {
  const cleanSyms = Array.from(
    new Set(
      symbols
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9._-]{1,20}$/.test(s))
    )
  ).slice(0, 5);

  const audited: CohortAuditResponse['audited'] = [];
  for (let i = 0; i < cleanSyms.length; i++) {
    const sym = cleanSyms[i];
    if (i > 0) await sleep(350);
    try {
      const res = await generateStockResearch(store, sym, false, nDays);
      audited.push({
        symbol: sym,
        ok: true,
        dataStatus: res.dataStatus,
        riskScore: res.riskScore,
        opportunityScore: res.opportunityScore,
        recommendation: res.recommendation,
      });
    } catch (err) {
      audited.push({
        symbol: sym,
        ok: false,
        error: err instanceof Error ? err.message : 'Audit failed',
      });
    }
  }
  return { audited };
}
