import { GoogleGenAI } from '@google/genai';
import type {
  MacroResearchResponse,
  ResearchPoint,
  ResearchSource,
  StockResearchResponse,
} from '../src/types/market.ts';
import type { MarketStore } from './marketStore.ts';

const MODEL = 'gemini-4-hydrogen';
const CACHE_TTL_MS = 20 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const macroCache = new Map<string, CacheEntry<MacroResearchResponse>>();
const stockCache = new Map<string, CacheEntry<StockResearchResponse>>();

function getAiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add it in Settings > Secrets to run live Google Search grounding.'
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

function formatGeminiError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('"code":429')) {
    return new Error(
      'Gemini Search Grounding quota exceeded (429). Check your API plan/rate limit or select a billing-enabled key in Settings > Secrets, then retry.'
    );
  }
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('"code":403')) {
    return new Error(
      'Gemini API authentication failed. Verify your GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  return new Error(raw.length > 260 ? `${raw.slice(0, 260)}…` : raw);
}

async function callSearchGroundedModel(prompt: string) {
  const ai = getAiClient();
  try {
    return await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
  } catch (err) {
    throw formatGeminiError(err);
  }
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
    out.push({
      uri,
      title: (ch?.web?.title || uri).trim(),
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
        titleNe: String(o.titleNe || o.title || '').trim(),
        detail: String(o.detail || '').trim(),
        detailNe: String(o.detailNe || o.detail || '').trim(),
        impact,
      };
    })
    .filter((p) => p.title && p.detail);
}

export async function generateMacroResearch(
  store: MarketStore,
  forceRefresh = false
): Promise<MacroResearchResponse> {
  const dates = store.getDates();
  const latestDate = dates[dates.length - 1] || 'latest';
  const cacheKey = `macro:${latestDate}`;

  if (!forceRefresh) {
    const hit = macroCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return { ...hit.data, cached: true };
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

  const prompt = `You are a senior NEPSE (Nepal Stock Exchange) and global macro strategist.
Use Google Search right now to find the latest up-to-date news and indicators for BOTH:
1) Nepal Economy & NEPSE stock market (Nepal Rastra Bank NRB monetary policy / interest rates / CD ratio / banking liquidity, remittance inflows, government budget/capital expenditure, inflation, hydropower/insurance/banking regulatory developments).
2) World Economy & Global Markets (US Federal Reserve rate outlook, global oil & gold prices, USD strength, Indian economy/RBI/Nifty trends, geopolitical/trade risks affecting Nepal's imports, remittances, and risk appetite).

Local market context:
${marketContext}

Return ONLY valid JSON (no markdown outside the JSON object) matching this exact structure, with natural accurate English AND Devanagari Nepali translations:
{
  "nepalSummaryEn": "2-3 sentence executive summary of current Nepal economy & NEPSE macro environment.",
  "nepalSummaryNe": "नेपालको अर्थतन्त्र र नेप्से बजारको हालको अवस्थाको २–३ वाक्यमा सारांश।",
  "worldSummaryEn": "2-3 sentence executive summary of global macro conditions and spillover impact on Nepal.",
  "worldSummaryNe": "विश्व अर्थतन्त्र र त्यसले नेपालको बजारमा पार्ने प्रभावको २–३ वाक्यमा सारांश।",
  "nepalOpportunities": [
    { "title": "...", "titleNe": "...", "detail": "...", "detailNe": "...", "impact": "High" }
  ],
  "nepalRisks": [
    { "title": "...", "titleNe": "...", "detail": "...", "detailNe": "...", "impact": "High" }
  ],
  "worldOpportunities": [
    { "title": "...", "titleNe": "...", "detail": "...", "detailNe": "...", "impact": "Medium" }
  ],
  "worldRisks": [
    { "title": "...", "titleNe": "...", "detail": "...", "detailNe": "...", "impact": "High" }
  ],
  "sectorsToWatch": [
    { "sector": "Commercial Banks / Hydropower / etc.", "sectorNe": "...", "stance": "Positive", "reason": "...", "reasonNe": "..." }
  ]
}
Provide 3–4 concrete items in each opportunities/risks array and 3–4 NEPSE sectors in sectorsToWatch.`;

  const response = await callSearchGroundedModel(prompt);

  const text = (response.text || '').trim();
  const sources = extractSources(response);
  const parsed = extractJsonObject(text);

  const result: MacroResearchResponse = parsed
    ? {
        generatedAt: new Date().toISOString(),
        model: MODEL,
        cached: false,
        nepalSummaryEn: String(parsed.nepalSummaryEn || '').trim(),
        nepalSummaryNe: String(parsed.nepalSummaryNe || '').trim(),
        worldSummaryEn: String(parsed.worldSummaryEn || '').trim(),
        worldSummaryNe: String(parsed.worldSummaryNe || '').trim(),
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
                sectorNe: String(o.sectorNe || o.sector || '').trim(),
                stance,
                reason: String(o.reason || '').trim(),
                reasonNe: String(o.reasonNe || o.reason || '').trim(),
              };
            })
          : [],
        sources,
      }
    : {
        generatedAt: new Date().toISOString(),
        model: MODEL,
        cached: false,
        nepalSummaryEn: text,
        nepalSummaryNe: '',
        worldSummaryEn: '',
        worldSummaryNe: '',
        nepalOpportunities: [],
        nepalRisks: [],
        worldOpportunities: [],
        worldRisks: [],
        sectorsToWatch: [],
        sources,
        rawFallback: text,
      };

  macroCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: result });
  return result;
}

export async function generateStockResearch(
  store: MarketStore,
  symbolInput: string,
  forceRefresh = false
): Promise<StockResearchResponse> {
  const symbol = symbolInput.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9._-]{1,20}$/.test(symbol)) {
    throw new Error('Invalid stock symbol');
  }

  const history = store.getSymbolHistory(symbol);
  const last = history[history.length - 1];
  const companyName = last?.name || symbol;
  const cacheKey = `stock:${symbol}:${last?.date || 'latest'}`;

  if (!forceRefresh) {
    const hit = stockCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return { ...hit.data, cached: true };
    }
  }

  const priceContext = last
    ? `Latest ShareSansar data (${last.date}) for ${symbol} (${companyName}): Close Rs ${last.close}, Daily Change ${last.diff_pct ?? 0}%, Turnover Rs ${(last.turnover / 1e7).toFixed(2)} crore across ${last.trans} trades, VWAP Rs ${last.vwap ?? 'N/A'}, MA120 Rs ${last.d120 ?? 'N/A'}, 52w High Rs ${last.w52_high ?? 'N/A'}, 52w Low Rs ${last.w52_low ?? 'N/A'}.`
    : `NEPSE listed security: ${symbol}.`;

  const prompt = `You are a NEPSE equity research analyst. Use Google Search right now to research "${symbol}" (${companyName}) on Nepal Stock Exchange (NEPSE), its latest quarterly financial reports, dividends/bonus/right shares, AGM updates, sector drivers, Nepal macro sensitivity (NRB rates, liquidity, PPA/tariffs/regulation), and global economic spillover risks or tailwinds.

Market snapshot:
${priceContext}

Return ONLY valid JSON (no prose outside the JSON object) matching this exact structure, with accurate English AND natural Devanagari Nepali translations:
{
  "summaryEn": "2-3 sentence thesis covering the company's current business position, latest price/liquidity action, and outlook.",
  "summaryNe": "कम्पनीको वर्तमान अवस्था, हालैको मूल्य/कारोबार र दृष्टिकोणबारे २–३ वाक्यमा नेपाली सारांश।",
  "stance": "Bullish" | "Neutral" | "Cautious",
  "opportunities": [
    { "title": "...", "titleNe": "...", "detail": "...", "detailNe": "...", "impact": "High" }
  ],
  "risks": [
    { "title": "...", "titleNe": "...", "detail": "...", "detailNe": "...", "impact": "High" }
  ],
  "macroLinkageEn": "2 sentences explaining how Nepal economy (NRB rates/liquidity/policy) and global economy (oil, USD, rates, commodity/remittance trends) specifically impact this stock.",
  "macroLinkageNe": "नेपाल र विश्व अर्थतन्त्रका सूचकहरूले यो स्टकलाई कसरी असर गर्छन् भन्ने २ वाक्यमा व्याख्या।",
  "catalysts": [
    { "headline": "...", "headlineNe": "...", "timeframe": "Near-term / Q2 / AGM" }
  ]
}
Provide 3–4 items in opportunities, 3–4 items in risks, and 2–3 recent or upcoming catalysts.`;

  const response = await callSearchGroundedModel(prompt);

  const text = (response.text || '').trim();
  const sources = extractSources(response);
  const parsed = extractJsonObject(text);

  const rawStance = String(parsed?.stance || 'Neutral');
  const stance: 'Bullish' | 'Neutral' | 'Cautious' =
    rawStance === 'Bullish' || rawStance === 'Cautious' ? rawStance : 'Neutral';

  const result: StockResearchResponse = parsed
    ? {
        symbol,
        companyName,
        generatedAt: new Date().toISOString(),
        model: MODEL,
        cached: false,
        summaryEn: String(parsed.summaryEn || '').trim(),
        summaryNe: String(parsed.summaryNe || '').trim(),
        stance,
        opportunities: normalizePoints(parsed.opportunities),
        risks: normalizePoints(parsed.risks),
        macroLinkageEn: String(parsed.macroLinkageEn || '').trim(),
        macroLinkageNe: String(parsed.macroLinkageNe || '').trim(),
        catalysts: Array.isArray(parsed.catalysts)
          ? parsed.catalysts.map((c) => {
              const o = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
              return {
                headline: String(o.headline || '').trim(),
                headlineNe: String(o.headlineNe || o.headline || '').trim(),
                timeframe: String(o.timeframe || 'Upcoming').trim(),
              };
            })
          : [],
        sources,
      }
    : {
        symbol,
        companyName,
        generatedAt: new Date().toISOString(),
        model: MODEL,
        cached: false,
        summaryEn: text,
        summaryNe: '',
        stance: 'Neutral',
        opportunities: [],
        risks: [],
        macroLinkageEn: '',
        macroLinkageNe: '',
        catalysts: [],
        sources,
        rawFallback: text,
      };

  stockCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: result });
  return result;
}
