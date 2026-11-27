import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import cron, { type ScheduledTask } from 'node-cron';
import fs from 'fs';
import path from 'path';
import type {
  FundamentalMonitorResponse,
  MonitorBatchStatus,
  MonitorCollectionLog,
  MonitorConfig,
  MonitorSymbolEntry,
  QuarterCode,
  ReportMonitorStatus,
  ValidationStatus,
} from '../../src/types/fundamental.ts';
import { isValidSymbol, scrapeCompanyFinancials } from '../financialScraper.ts';
import type { MarketStore } from '../marketStore.ts';
import {
  FundamentalVault,
  normalizeShareSansarSnapshot,
  runAccountingValidation,
} from './fundamentalVault.ts';
import {
  classifySectorGroup,
  getActiveNepalFiscalQuarter,
  getUpcomingNepalFiscalQuarter,
} from './nepalCalendar.ts';

const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  enabled: true,
  cronTime: '16:15',
  timezone: 'Asia/Kathmandu',
  delayDaysAfterQuarterEnd: 15,
  maxRetries: 3,
  retryDelayMinutes: 30,
  crossValidateWithSearch: true,
};

interface PersistedMonitorState {
  config: MonitorConfig;
  entries: Record<string, MonitorSymbolEntry>;
  logs: MonitorCollectionLog[];
}

interface SearchCrossCheckResult {
  publicationDate: string | null;
  verifiedAgainstOfficial: boolean;
  reportedPeriodMatched: boolean | null;
  officialEpsNote: string | null;
  officialNetProfitNote: string | null;
  operatingCashFlowNpr: number | null;
  discrepancyNote: string | null;
  sources: Array<{ title: string; uri: string; category: string }>;
}

function isValidTz(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function extractGroundingSources(
  response: GenerateContentResponse
): Array<{ title: string; uri: string; category: string }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; uri: string; category: string }> = [];
  const candidate = response.candidates?.[0];
  const meta = candidate?.groundingMetadata;
  for (const chunk of meta?.groundingChunks || []) {
    const uri = chunk?.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    const title = chunk.web?.title || uri;
    const lower = uri.toLowerCase();
    const category =
      lower.includes('nepalstock') || lower.includes('sebon') || lower.includes('nrb')
        ? 'Official Disclosure'
        : lower.includes('sharesansar') || lower.includes('merolagani') || lower.includes('nepalipaisa')
          ? 'NEPSE Portal'
          : 'Financial Media';
    out.push({ title, uri, category });
  }
  return out;
}

function parseJsonObjectSafe(rawText: string): Record<string, unknown> | null {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function crossCheckWithOfficialSearch(params: {
  symbol: string;
  companyName: string;
  fiscalYear: string;
  quarter: string;
  eps: number | null;
  netProfitNpr: number | null;
  nplPct: number | null;
}): Promise<SearchCrossCheckResult | null> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const prompt = `Verify the official published quarterly financial statement for NEPSE-listed company ${params.symbol} (${params.companyName}) for ${params.quarter} FY ${params.fiscalYear}.
Compare against ShareSansar parsed figures:
- EPS: ${params.eps !== null ? `Rs ${params.eps}` : 'Unavailable'}
- Net Profit: ${params.netProfitNpr !== null ? `Rs ${(params.netProfitNpr / 1e7).toFixed(2)} Crore` : 'Unavailable'}
- NPL %: ${params.nplPct !== null ? `${params.nplPct}%` : 'Unavailable'}

Search official NEPSE disclosures, company press releases, SEBON filings, or MeroLagani/ShareSansar financial report publications.
Return ONLY valid JSON:
{
  "publicationDate": "YYYY-MM-DD or null if unavailable",
  "verifiedAgainstOfficial": true or false,
  "reportedPeriodMatched": true or false or null,
  "officialEpsNote": "brief confirmation or reported EPS string or null",
  "officialNetProfitNote": "brief confirmation or reported net profit string or null",
  "operatingCashFlowNpr": number in full NPR (or null if unverified/not disclosed),
  "discrepancyNote": "null if consistent, otherwise clear description of mismatch"
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
      },
    });

    const sources = extractGroundingSources(response);
    const parsed = parseJsonObjectSafe(response.text || '');
    if (!parsed) {
      return {
        publicationDate: null,
        verifiedAgainstOfficial: sources.length > 0,
        reportedPeriodMatched: null,
        officialEpsNote: null,
        officialNetProfitNote: null,
        operatingCashFlowNpr: null,
        discrepancyNote: null,
        sources,
      };
    }

    const rawOcf = parsed.operatingCashFlowNpr;
    const ocfNum =
      typeof rawOcf === 'number' && Number.isFinite(rawOcf) ? rawOcf : null;

    return {
      publicationDate:
        typeof parsed.publicationDate === 'string' && parsed.publicationDate !== 'null'
          ? parsed.publicationDate
          : null,
      verifiedAgainstOfficial: Boolean(parsed.verifiedAgainstOfficial) || sources.length > 0,
      reportedPeriodMatched:
        typeof parsed.reportedPeriodMatched === 'boolean' ? parsed.reportedPeriodMatched : null,
      officialEpsNote:
        typeof parsed.officialEpsNote === 'string' && parsed.officialEpsNote !== 'null'
          ? parsed.officialEpsNote
          : null,
      officialNetProfitNote:
        typeof parsed.officialNetProfitNote === 'string' && parsed.officialNetProfitNote !== 'null'
          ? parsed.officialNetProfitNote
          : null,
      operatingCashFlowNpr: ocfNum,
      discrepancyNote:
        typeof parsed.discrepancyNote === 'string' &&
        parsed.discrepancyNote !== 'null' &&
        parsed.discrepancyNote.trim().length > 0
          ? parsed.discrepancyNote.trim()
          : null,
      sources,
    };
  } catch {
    return null;
  }
}

export class FundamentalMonitorService {
  private readonly store: MarketStore;
  private readonly vault: FundamentalVault;
  private readonly statePath: string;
  private config: MonitorConfig;
  private entries = new Map<string, MonitorSymbolEntry>();
  private logs: MonitorCollectionLog[] = [];
  private task: ScheduledTask | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private batch: MonitorBatchStatus = {
    active: false,
    mode: '',
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentSymbol: null,
    message: 'Idle',
    startedAt: null,
  };

  constructor(
    store: MarketStore,
    vault: FundamentalVault,
    options: { enableCron?: boolean } = {}
  ) {
    this.store = store;
    this.vault = vault;
    this.vault.initIfNeeded();
    this.statePath = path.resolve(this.vault.vaultDir, 'monitor-state.json');
    const loaded = this.loadState();
    this.config = loaded.config;
    for (const [k, v] of Object.entries(loaded.entries)) {
      this.entries.set(k.toUpperCase(), v);
    }
    this.logs = loaded.logs;
    this.syncEntriesFromMarketAndVault();
    if (options.enableCron !== false) {
      this.applyCronSchedule();
    }
  }

  private loadState(): PersistedMonitorState {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Partial<PersistedMonitorState>;
        return {
          config: { ...DEFAULT_MONITOR_CONFIG, ...(raw.config || {}) },
          entries: raw.entries || {},
          logs: Array.isArray(raw.logs) ? raw.logs.slice(0, 120) : [],
        };
      }
    } catch {
      // use defaults
    }
    return {
      config: { ...DEFAULT_MONITOR_CONFIG },
      entries: {},
      logs: [],
    };
  }

  private saveState(): void {
    try {
      const obj: Record<string, MonitorSymbolEntry> = {};
      for (const [k, v] of this.entries.entries()) {
        obj[k] = v;
      }
      const payload: PersistedMonitorState = {
        config: this.config,
        entries: obj,
        logs: this.logs.slice(0, 120),
      };
      fs.writeFileSync(this.statePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // ignore persistence errors
    }
  }

  private appendLog(entry: Omit<MonitorCollectionLog, 'id' | 'timestamp'>): void {
    const item: MonitorCollectionLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.logs.unshift(item);
    this.logs = this.logs.slice(0, 120);
    this.saveState();
  }

  public syncEntriesFromMarketAndVault(equityOnly = true): void {
    const activeQ = getActiveNepalFiscalQuarter(new Date(), this.config.delayDaysAfterQuarterEnd);
    const dates = this.store.getDates();
    const latestDay = dates[dates.length - 1];
    const pulse = latestDay ? this.store.getMarketPulse(latestDay, equityOnly, { nDays: 20 }) : null;
    const pulseMap = new Map((pulse?.rows || []).map((r) => [r.symbol.toUpperCase(), r]));
    const ledgers = this.vault.getAllLedgers();
    const ledgerMap = new Map(ledgers.map((l) => [l.symbol.toUpperCase(), l]));

    const symbols = new Set<string>([
      ...Array.from(pulseMap.keys()),
      ...Array.from(ledgerMap.keys()),
    ]);

    for (const sym of symbols) {
      const pRow = pulseMap.get(sym);
      const ledger = ledgerMap.get(sym);
      const latestRec = ledger?.records?.[0] ?? null;
      const existing = this.entries.get(sym);
      const { sector, sectorGroup } = latestRec
        ? { sector: latestRec.sector, sectorGroup: latestRec.sectorGroup }
        : classifySectorGroup(sym, pRow?.name || ledger?.companyName, ledger?.sector);

      // Determine reporting status relative to active quarter (+15d grace period)
      let status: ReportMonitorStatus = existing?.status ?? 'NotDue';
      if (latestRec) {
        const hasActiveQuarter =
          ledger?.records.some(
            (r) => r.fiscalYear === activeQ.fiscalYear && r.quarter === activeQ.quarter
          ) ?? false;
        if (hasActiveQuarter || !activeQ.isDueNow) {
          status = 'Published';
        } else if (status !== 'Retrying' && status !== 'Failed') {
          status = 'Published'; // Has historical statements; marked Published unless active failure/retry
        }
      } else {
        if (existing?.status === 'Retrying' || existing?.status === 'Failed') {
          status = existing.status;
        } else {
          status = activeQ.isDueNow ? 'Pending' : 'NotDue';
        }
      }

      this.entries.set(sym, {
        symbol: sym,
        companyName: ledger?.companyName || pRow?.name || existing?.companyName || sym,
        sector,
        sectorGroup,
        status,
        latestFiscalYear: latestRec?.fiscalYear ?? existing?.latestFiscalYear ?? null,
        latestQuarter: latestRec?.quarter ?? existing?.latestQuarter ?? null,
        latestPublicationDate: latestRec?.publicationDate ?? existing?.latestPublicationDate ?? null,
        lastAttemptAt: existing?.lastAttemptAt ?? null,
        lastSuccessAt: latestRec?.collectionDate ?? existing?.lastSuccessAt ?? null,
        nextRetryAt: existing?.nextRetryAt ?? null,
        retryCount: existing?.retryCount ?? 0,
        lastError: existing?.lastError ?? null,
        validationStatus: latestRec?.validationStatus ?? existing?.validationStatus ?? 'Incomplete',
        dataQualityFlags: latestRec?.dataQualityFlags ?? existing?.dataQualityFlags ?? ['incomplete'],
      });
    }
    this.saveState();
  }

  public getStatusMap(): Map<string, ReportMonitorStatus> {
    const out = new Map<string, ReportMonitorStatus>();
    for (const [sym, entry] of this.entries.entries()) {
      out.set(sym, entry.status);
    }
    return out;
  }

  public applyCronSchedule(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    if (!this.config.enabled) return;

    const [hhStr, mmStr] = (this.config.cronTime || '16:15').split(':');
    const hh = Math.max(0, Math.min(23, Number(hhStr) || 16));
    const mm = Math.max(0, Math.min(59, Number(mmStr) || 15));
    const expr = `${mm} ${hh} * * *`;
    const tz = isValidTz(this.config.timezone) ? this.config.timezone : 'Asia/Kathmandu';

    this.task = cron.schedule(
      expr,
      () => {
        void this.runScheduledQuarterCheck();
      },
      { timezone: tz }
    );
  }

  public updateConfig(patch: Partial<MonitorConfig>): MonitorConfig {
    const next: MonitorConfig = { ...this.config };
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.cronTime === 'string' && /^\d{2}:\d{2}$/.test(patch.cronTime.trim())) {
      next.cronTime = patch.cronTime.trim();
    }
    if (typeof patch.timezone === 'string' && isValidTz(patch.timezone)) {
      next.timezone = patch.timezone;
    }
    if (
      typeof patch.delayDaysAfterQuarterEnd === 'number' &&
      Number.isFinite(patch.delayDaysAfterQuarterEnd)
    ) {
      next.delayDaysAfterQuarterEnd = Math.max(1, Math.min(45, Math.round(patch.delayDaysAfterQuarterEnd)));
    }
    if (typeof patch.maxRetries === 'number' && Number.isFinite(patch.maxRetries)) {
      next.maxRetries = Math.max(0, Math.min(10, Math.round(patch.maxRetries)));
    }
    if (
      typeof patch.retryDelayMinutes === 'number' &&
      Number.isFinite(patch.retryDelayMinutes)
    ) {
      next.retryDelayMinutes = Math.max(5, Math.min(240, Math.round(patch.retryDelayMinutes)));
    }
    if (typeof patch.crossValidateWithSearch === 'boolean') {
      next.crossValidateWithSearch = patch.crossValidateWithSearch;
    }
    this.config = next;
    this.saveState();
    this.applyCronSchedule();
    return this.config;
  }

  public async runScheduledQuarterCheck(): Promise<void> {
    const activeQ = getActiveNepalFiscalQuarter(new Date(), this.config.delayDaysAfterQuarterEnd);
    if (!activeQ.isDueNow) {
      this.appendLog({
        trigger: 'scheduled',
        symbol: null,
        status: 'skipped',
        message: `${activeQ.quarter} FY ${activeQ.fiscalYear} monitoring begins on ${activeQ.checkStartDate} (Quarter-end + ${this.config.delayDaysAfterQuarterEnd} days).`,
        durationMs: 0,
      });
      return;
    }

    if (this.batch.active) return;
    this.startBatchRefresh('due', false);
  }

  /**
   * Collects financial statements for a single symbol using ShareSansar as primary collector,
   * validates & deduplicates into FundamentalVault, and optionally cross-validates via official search.
   * Skips scraping if primary quarter data already exists unless `options.force` is true.
   */
  public async refreshSymbol(
    rawSymbol: string,
    trigger: MonitorCollectionLog['trigger'] = 'manual-single',
    crossValidateOverride?: boolean,
    options?: { force?: boolean; fiscalYear?: string; quarter?: QuarterCode }
  ): Promise<{
    symbol: string;
    periodsAdded: number;
    skipped?: boolean;
    entry: MonitorSymbolEntry;
    validationStatus: ValidationStatus;
  }> {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!isValidSymbol(symbol)) {
      throw new Error(`Invalid ticker symbol: ${rawSymbol}`);
    }

    const started = Date.now();
    const existing = this.entries.get(symbol);
    const activeQ = getActiveNepalFiscalQuarter(new Date(), this.config.delayDaysAfterQuarterEnd);
    const targetFY = options?.fiscalYear || activeQ.fiscalYear;
    const targetQuarter = options?.quarter || activeQ.quarter;
    const force = Boolean(options?.force);

    if (!force && this.vault.hasQuarterData(symbol, targetFY, targetQuarter)) {
      const ledger = this.vault.getCompanyLedger(symbol);
      const matched =
        ledger?.records.find(
          (r) => r.fiscalYear === targetFY && r.quarter === targetQuarter
        ) ?? ledger?.records?.[0];
      const fallbackClassification = classifySectorGroup(
        symbol,
        matched?.companyName || existing?.companyName,
        matched?.sector || existing?.sector
      );
      const entry: MonitorSymbolEntry = {
        symbol,
        companyName: matched?.companyName || existing?.companyName || symbol,
        sector: matched?.sector || existing?.sector || fallbackClassification.sector,
        sectorGroup:
          matched?.sectorGroup || existing?.sectorGroup || fallbackClassification.sectorGroup,
        status: 'Published',
        latestFiscalYear: matched?.fiscalYear ?? existing?.latestFiscalYear ?? targetFY,
        latestQuarter: matched?.quarter ?? existing?.latestQuarter ?? targetQuarter,
        latestPublicationDate: matched?.publicationDate ?? existing?.latestPublicationDate ?? null,
        lastAttemptAt: existing?.lastAttemptAt ?? null,
        lastSuccessAt: matched?.collectionDate ?? existing?.lastSuccessAt ?? null,
        nextRetryAt: null,
        retryCount: 0,
        lastError: null,
        validationStatus: matched?.validationStatus ?? existing?.validationStatus ?? 'Verified',
        dataQualityFlags: matched?.dataQualityFlags ?? existing?.dataQualityFlags ?? [],
      };
      this.entries.set(symbol, entry);
      this.appendLog({
        trigger,
        symbol,
        status: 'skipped',
        message: `Skipped ${symbol}: ${targetQuarter} FY ${targetFY} data already exists.`,
        durationMs: Date.now() - started,
      });
      return {
        symbol,
        periodsAdded: 0,
        skipped: true,
        entry,
        validationStatus: entry.validationStatus,
      };
    }

    try {
      // 1. Primary extraction from ShareSansar
      const snapshot = await scrapeCompanyFinancials(this.store.dataDir, symbol);
      const parsedRecords = normalizeShareSansarSnapshot(snapshot);
      if (parsedRecords.length === 0) {
        throw new Error(`No parseable fiscal periods found for ${symbol}`);
      }

      const useCrossValidate =
        (crossValidateOverride ?? this.config.crossValidateWithSearch) &&
        Boolean((process.env.GEMINI_API_KEY || '').trim());

      const latestParsed = [...parsedRecords].sort((a, b) => b.sortKey - a.sortKey)[0];
      let extraSources: Array<{ title: string; uri: string; category: string }> = [
        {
          title: `${symbol} Financial Reports`,
          uri: snapshot.sourceUrl,
          category: 'NEPSE Portal',
        },
      ];

      // 2. Optional Secondary Cross-Validation against official company disclosures / NEPSE / SEBON
      if (useCrossValidate && latestParsed) {
        const cross = await crossCheckWithOfficialSearch({
          symbol,
          companyName: snapshot.companyName,
          fiscalYear: latestParsed.fiscalYear,
          quarter: latestParsed.quarter,
          eps: latestParsed.metrics.eps.value,
          netProfitNpr: latestParsed.metrics.netProfit.value,
          nplPct: latestParsed.metrics.nplPct.value,
        });

        if (cross) {
          if (cross.publicationDate) {
            latestParsed.publicationDate = cross.publicationDate;
          }
          if (
            cross.operatingCashFlowNpr !== null &&
            latestParsed.metrics.operatingCashFlow.value === null
          ) {
            latestParsed.metrics.operatingCashFlow = {
              value: cross.operatingCashFlowNpr,
              unit: 'NPR',
              provenance: 'Reported',
              period: latestParsed.periodLabel,
              source: 'Official Search Disclosure',
            };
          }
          if (cross.discrepancyNote) {
            latestParsed.validationStatus = 'Discrepancy';
            latestParsed.validationNotes.push(`Official Cross-Check: ${cross.discrepancyNote}`);
          } else if (cross.verifiedAgainstOfficial) {
            latestParsed.dataSource = 'ShareSansar + Official Search';
            latestParsed.validationStatus = 'CrossChecked';
            if (cross.officialEpsNote) {
              latestParsed.validationNotes.push(`Official EPS Cross-Check: ${cross.officialEpsNote}`);
            }
          }
          if (cross.sources.length > 0) {
            extraSources = [...extraSources, ...cross.sources];
          }
          const recheck = runAccountingValidation(latestParsed);
          latestParsed.validationStatus = recheck.validationStatus;
          latestParsed.validationNotes = Array.from(
            new Set([...latestParsed.validationNotes, ...recheck.notes])
          );
          latestParsed.dataQualityFlags = recheck.flags;
        }
      }

      // 3. Deduplicate & upsert every period into FundamentalVault
      let ledger = this.vault.getCompanyLedger(symbol);
      for (const rec of parsedRecords) {
        ledger = this.vault.upsertStatementRecord(rec, extraSources);
      }

      const newest = ledger?.records?.[0] ?? latestParsed;
      const entry: MonitorSymbolEntry = {
        symbol,
        companyName: newest.companyName,
        sector: newest.sector,
        sectorGroup: newest.sectorGroup,
        status: 'Published',
        latestFiscalYear: newest.fiscalYear,
        latestQuarter: newest.quarter,
        latestPublicationDate: newest.publicationDate,
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        nextRetryAt: null,
        retryCount: 0,
        lastError: null,
        validationStatus: newest.validationStatus,
        dataQualityFlags: newest.dataQualityFlags,
      };
      this.entries.set(symbol, entry);
      this.appendLog({
        trigger,
        symbol,
        status: 'success',
        message: `Collected ${parsedRecords.length} period(s) for ${symbol} (${newest.periodLabel}) via ${newest.dataSource.replace(/ShareSansar/gi, 'Quarterly Filing')}.`,
        durationMs: Date.now() - started,
      });

      return {
        symbol,
        periodsAdded: parsedRecords.length,
        entry,
        validationStatus: newest.validationStatus,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Collection failed';
      const retries = (existing?.retryCount ?? 0) + 1;
      const canRetry = retries <= this.config.maxRetries;
      const nextRetryIso = canRetry
        ? new Date(Date.now() + this.config.retryDelayMinutes * 60_000).toISOString()
        : null;

      const { sector, sectorGroup } = classifySectorGroup(symbol, existing?.companyName);
      const entry: MonitorSymbolEntry = {
        symbol,
        companyName: existing?.companyName || symbol,
        sector: existing?.sector || sector,
        sectorGroup: existing?.sectorGroup || sectorGroup,
        status: canRetry ? 'Retrying' : 'Failed',
        latestFiscalYear: existing?.latestFiscalYear ?? null,
        latestQuarter: existing?.latestQuarter ?? null,
        latestPublicationDate: existing?.latestPublicationDate ?? null,
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: existing?.lastSuccessAt ?? null,
        nextRetryAt: nextRetryIso,
        retryCount: retries,
        lastError: msg,
        validationStatus: existing?.validationStatus ?? 'Incomplete',
        dataQualityFlags: existing?.dataQualityFlags ?? ['incomplete', 'unverified'],
      };
      this.entries.set(symbol, entry);
      this.appendLog({
        trigger,
        symbol,
        status: 'error',
        message: `${symbol} fetch failed (attempt ${retries}): ${msg}`,
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }

  public startBatchRefresh(
    mode: 'pending' | 'top25' | 'top50' | 'all' | 'due',
    force = false,
    customSymbols?: string[]
  ): MonitorBatchStatus {
    if (this.batch.active) {
      return this.batch;
    }

    this.syncEntriesFromMarketAndVault(true);
    const activeQ = getActiveNepalFiscalQuarter(new Date(), this.config.delayDaysAfterQuarterEnd);

    if (mode === 'due' && !activeQ.isDueNow && !force) {
      this.batch = {
        active: false,
        mode,
        total: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        currentSymbol: null,
        message: `${activeQ.quarter} FY ${activeQ.fiscalYear} window starts on ${activeQ.checkStartDate}.`,
        startedAt: new Date().toISOString(),
      };
      return this.batch;
    }

    const dates = this.store.getDates();
    const latestDay = dates[dates.length - 1];
    const topByTurnover = latestDay
      ? this.store
          .getDayPrices(latestDay, true)
          .sort((a, b) => b.turnover - a.turnover)
          .map((r) => r.symbol.toUpperCase())
      : Array.from(this.entries.keys());

    let candidates: string[] = [];
    if (Array.isArray(customSymbols) && customSymbols.length > 0) {
      candidates = Array.from(
        new Set(customSymbols.map((s) => s.trim().toUpperCase()).filter(isValidSymbol))
      );
    } else if (mode === 'top25') {
      candidates = topByTurnover.slice(0, 25);
    } else if (mode === 'top50') {
      candidates = topByTurnover.slice(0, 50);
    } else if (mode === 'all') {
      candidates = topByTurnover;
    } else {
      // 'pending' or 'due'
      candidates = topByTurnover.filter((sym) => {
        if (force) return true;
        const ledger = this.vault.getCompanyLedger(sym);
        const entry = this.entries.get(sym);
        if (!ledger || ledger.records.length === 0) return true;
        if (entry?.status === 'Pending' || entry?.status === 'Retrying') return true;
        if (activeQ.isDueNow) {
          return !this.vault.hasQuarterData(sym, activeQ.fiscalYear, activeQ.quarter);
        }
        return false;
      });
    }

    const targets = force
      ? candidates
      : candidates.filter(
          (sym) => !this.vault.hasQuarterData(sym, activeQ.fiscalYear, activeQ.quarter)
        );
    const skippedExisting = Math.max(0, candidates.length - targets.length);

    if (skippedExisting > 0) {
      this.appendLog({
        trigger: 'manual-batch',
        symbol: null,
        status: 'skipped',
        message: `Skipped ${skippedExisting} company(ies) that already have ${activeQ.quarter} FY ${activeQ.fiscalYear} data.`,
        durationMs: 0,
      });
    }

    this.batch = {
      active: targets.length > 0,
      mode,
      total: targets.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: skippedExisting,
      currentSymbol: targets[0] ?? null,
      message:
        targets.length > 0
          ? `Starting ${mode} quarterly pull (${targets.length} to collect, ${skippedExisting} already populated for ${activeQ.quarter} ${activeQ.fiscalYear})…`
          : `All ${skippedExisting} target companies already have ${activeQ.quarter} FY ${activeQ.fiscalYear} data.`,
      startedAt: new Date().toISOString(),
    };

    if (targets.length > 0) {
      void this.executeBatchWorker(targets, mode, force);
    }
    return this.batch;
  }

  private async executeBatchWorker(
    targets: string[],
    mode: string,
    force = false
  ): Promise<void> {
    if (targets.length === 0) {
      this.batch.active = false;
      this.batch.currentSymbol = null;
      return;
    }

    const retryQueue: string[] = [];

    for (const sym of targets) {
      this.batch.currentSymbol = sym;
      this.batch.message = `Fetching quarterly reports for ${sym} (${this.batch.processed + 1}/${targets.length})…`;
      try {
        // Avoid invoking paid/slow search per company during large batch; keep ShareSansar fast & reliable
        const res = await this.refreshSymbol(
          sym,
          'manual-batch',
          targets.length <= 8 && this.config.crossValidateWithSearch,
          { force }
        );
        if (res.skipped) {
          this.batch.skipped = (this.batch.skipped ?? 0) + 1;
        } else {
          this.batch.succeeded++;
        }
      } catch {
        this.batch.failed++;
        const entry = this.entries.get(sym);
        if (entry && entry.status === 'Retrying') {
          retryQueue.push(sym);
        }
      }
      this.batch.processed++;
      await new Promise((r) => setTimeout(r, 220));
    }

    this.batch.active = false;
    this.batch.currentSymbol = null;
    if (this.batch.succeeded > 0) {
      this.vault.writeConsolidatedQuarterlyCsv();
    }
    this.batch.message = `Completed ${mode}: ${this.batch.succeeded} updated, ${this.batch.skipped ?? 0} skipped (existing), ${this.batch.failed} unavailable/failed.`;

    if (retryQueue.length > 0 && this.config.maxRetries > 0) {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      const delayMs = Math.min(60, Math.max(5, this.config.retryDelayMinutes)) * 60_000;
      this.retryTimer = setTimeout(() => {
        if (!this.batch.active) {
          this.startBatchRefresh('pending', false, retryQueue.slice(0, 20));
        }
      }, delayMs);
    }
  }

  public getStatus(equityOnly = true): FundamentalMonitorResponse {
    this.syncEntriesFromMarketAndVault(equityOnly);
    const activeQuarter = getActiveNepalFiscalQuarter(
      new Date(),
      this.config.delayDaysAfterQuarterEnd
    );
    const upcomingQuarter = getUpcomingNepalFiscalQuarter(
      new Date(),
      this.config.delayDaysAfterQuarterEnd
    );

    const symbols = Array.from(this.entries.values()).sort((a, b) => {
      const order: Record<ReportMonitorStatus, number> = {
        Published: 0,
        Retrying: 1,
        Pending: 2,
        Failed: 3,
        NotDue: 4,
      };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.symbol.localeCompare(b.symbol);
    });

    return {
      config: this.config,
      activeQuarter,
      upcomingQuarter,
      batch: { ...this.batch },
      counts: {
        total: symbols.length,
        published: symbols.filter((s) => s.status === 'Published').length,
        pending: symbols.filter((s) => s.status === 'Pending').length,
        retrying: symbols.filter((s) => s.status === 'Retrying').length,
        failed: symbols.filter((s) => s.status === 'Failed').length,
        notDue: symbols.filter((s) => s.status === 'NotDue').length,
      },
      symbols,
      logs: this.logs.slice(0, 60),
    };
  }
}
