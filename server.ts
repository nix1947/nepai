import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dispatchGitHubWorkflow, getGitHubAccount, pushProjectToGitHub } from './server/githubSync.ts';
import { isValidDateStr, MarketStore } from './server/marketStore.ts';
import {
  auditCohortStocks,
  generateMacroResearch,
  generateStockResearch,
} from './server/researchAi.ts';
import {
  getCompositeDoNotBuyStocks,
  getFundamentallyRiskyStocks,
  getMarketOpportunityVsRisk,
  computeTechnicalRiskRows,
  loadMacroSnapshot,
} from './server/riskEngine.ts';
import {
  getHighConvictionFeed,
  invalidateQuantFeedCache,
  runQuantAnalysis,
  runQuantBacktest,
} from './server/quantEngine.ts';
import { analyzeSymbolFromStore, scanAnalyzerMarket } from './server/analyzer/index.ts';
import { runAnalyzerBacktest } from './server/analyzer/backtest.ts';
import {
  getSavedFinancialCsvPath,
  getSavedFinancials,
  isValidSymbol,
  listSavedFinancials,
  scrapeBatchFinancials,
  scrapeCompanyFinancials,
} from './server/financialScraper.ts';
import { DailyScheduler, type DailyKbRunResult } from './server/scheduler.ts';
import {
  buildSpreadsheetExport,
  FundamentalVault,
  normalizeShareSansarSnapshot,
} from './server/fundamental/fundamentalVault.ts';
import {
  buildCompanyValuationDossier,
  getValuationUniverseSummary,
  runAnnualReportDeepDive,
} from './server/fundamental/annualValuationEngine.ts';
import {
  buildAnnualReportIntelligence,
  distillAnnualReportWithAi,
  getAnnualReportUniverse,
  ingestAndDistillAnnualReport,
} from './server/fundamental/annualReportIntelEngine.ts';
import { FundamentalMonitorService } from './server/fundamental/fundamentalCollector.ts';
import { evaluateHiddenGems } from './server/fundamental/hiddenGemsEngine.ts';
import { evaluateScreenerUniverse } from './server/fundamental/investorScoringEngine.ts';
import { computeMasterScreener } from './server/fundamental/masterScreenerEngine.ts';
import { getActiveNepalFiscalQuarter } from './server/fundamental/nepalCalendar.ts';
import {
  ALL_AGENCIES,
  getNepalDateStr,
  RegulatoryKnowledgeBase,
} from './server/fundamental/regulatoryKnowledgeBase.ts';
import { buildStrategicOutlookHeatmap } from './server/fundamental/strategicOutlookEngine.ts';
import type {
  ConsensusTag,
  HiddenGemArchetype,
  QuarterCode,
  RankingCategory,
  RegulatoryAgency,
  ScreenedCompanyRow,
} from './src/types/fundamental.ts';
import type { ScannerKind } from './src/types/market.ts';
import type { QuantEngineConfig } from './src/types/quant.ts';
import type {
  AnalyzerConfig,
  AnalyzerStrategyFilter,
  AnalyzerTimeframe,
} from './src/types/analyzer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.NEPSE_DATA
  ? path.resolve(process.env.NEPSE_DATA)
  : path.resolve(__dirname, 'data');

const VALID_ANALYZER_TF = new Set<AnalyzerTimeframe>(['1D', '1W', '1M']);
const VALID_ANALYZER_STRATEGIES = new Set<AnalyzerStrategyFilter>([
  'All',
  'ICT',
  'SMC',
  'Price Action',
  'Wyckoff',
]);

function parseAnalyzerConfigQuery(q: express.Request['query']): Partial<AnalyzerConfig> {
  const out: Partial<AnalyzerConfig> = {};
  const num = (key: string) => {
    const raw = q[key];
    if (typeof raw !== 'string' || !raw.trim()) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const sl = num('swingLeft');
  const sr = num('swingRight');
  const fvg = num('fvgMinAtr');
  const disp = num('displacementBodyAtr');
  const eq = num('eqTolerancePct');
  const minRr = num('minRR');
  const sb = num('stopAtrBuffer');
  if (sl !== undefined) out.swingLeft = sl;
  if (sr !== undefined) out.swingRight = sr;
  if (fvg !== undefined) out.fvgMinAtr = fvg;
  if (disp !== undefined) out.displacementBodyAtr = disp;
  if (eq !== undefined) out.eqTolerancePct = eq;
  if (minRr !== undefined) out.minRR = minRr;
  if (sb !== undefined) out.stopAtrBuffer = sb;
  return out;
}

const VALID_SCANNERS = new Set<ScannerKind>([
  'potential',
  'support',
  'selloff',
  'highbreak',
  'breakdown',
  'accumulation',
  'near52',
  'rs',
]);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '25mb' }));

  const store = new MarketStore(DATA_DIR);
  const scheduler = new DailyScheduler(store);
  const fundamentalVault = new FundamentalVault(DATA_DIR);
  const fundamentalMonitor = new FundamentalMonitorService(store, fundamentalVault);
  const regulatoryKb = new RegulatoryKnowledgeBase(DATA_DIR);

  async function runDailyKbPipeline(opts: {
    agencies?: RegulatoryAgency[];
    enrichLimit?: number;
    annualDistillLimit?: number;
    includeQuarterly?: boolean;
    equityOnly?: boolean;
    symbols?: string[];
    force?: boolean;
    trigger: 'scheduled' | 'manual';
  }): Promise<DailyKbRunResult & {
    geminiConfigured: boolean;
    agencies: RegulatoryAgency[];
    directResults: Record<string, number>;
    summary: ReturnType<RegulatoryKnowledgeBase['getSummary']>;
    githubPushed?: boolean;
    githubPushMessage?: string;
  }> {
    const todayNpt = getNepalDateStr();
    const agencies =
      opts.agencies && opts.agencies.length > 0 ? opts.agencies : ALL_AGENCIES;
    const enrichLimit = opts.enrichLimit ?? 6;
    const annualDistillLimit = opts.annualDistillLimit ?? 2;
    const includeQuarterly = opts.includeQuarterly !== false;
    const equityOnly = opts.equityOnly !== false;
    const explicitSymbols = opts.symbols ?? [];
    const force = Boolean(opts.force);
    const geminiConfigured = regulatoryKb.isGeminiConfigured();

    if (!force && regulatoryKb.getLastDailyCrawlDate() === todayNpt) {
      return {
        skipped: true,
        date: todayNpt,
        geminiConfigured,
        agencies,
        addedNotices: 0,
        companiesUpdated: 0,
        enrichedSymbols: [],
        annualDistilledSymbols: [],
        quarterlyRefreshed: [],
        directResults: {},
        warnings: [
          `Knowledge Base already crawled today (${todayNpt} NPT) — skipped duplicate daily crawl.`,
        ],
        summary: regulatoryKb.getSummary(),
      };
    }

    // 1. Direct agency portal fetch + Gemini Search Grounding across NRB, NIA, SEBON, CDSC, ICRA, CARE, NEPSE
    const harvest = await regulatoryKb.harvestAgencies(agencies, store);
    const warnings = [...harvest.warnings];

    // 2. Optionally check/pull due missing quarterly reports (up to 4 leaders)
    const quarterlyRefreshed: string[] = [];
    if (includeQuarterly) {
      const activeQ = getActiveNepalFiscalQuarter(new Date(), 15);
      if (activeQ.isDueNow) {
        const dates = store.getDates();
        const latest = dates[dates.length - 1];
        const ranked = latest
          ? store
              .getDayPrices(latest, equityOnly)
              .sort((a, b) => b.turnover - a.turnover)
              .map((r) => r.symbol.toUpperCase())
          : fundamentalVault.getAllLedgers().map((l) => l.symbol);
        const missingQ = ranked
          .filter((sym) => !fundamentalVault.hasQuarterData(sym, activeQ.fiscalYear, activeQ.quarter))
          .slice(0, 4);
        for (const sym of missingQ) {
          try {
            const qRes = await fundamentalMonitor.refreshSymbol(sym, 'manual-batch', false, {
              force: false,
              fiscalYear: activeQ.fiscalYear,
              quarter: activeQ.quarter,
            });
            if (!qRes.skipped && qRes.periodsAdded > 0) {
              quarterlyRefreshed.push(sym);
            }
          } catch (qErr) {
            warnings.push(
              `Quarterly refresh skipped for ${sym}: ${qErr instanceof Error ? qErr.message : 'failed'}`
            );
          }
        }
        if (quarterlyRefreshed.length > 0) {
          fundamentalVault.writeConsolidatedQuarterlyCsv();
        }
      }
    }

    // 3. Gemini Search Grounded Company KB Enrichment & Annual Report Distillation
    const enrichedSymbols: string[] = [];
    const annualDistilledSymbols: string[] = [];

    if (geminiConfigured && (enrichLimit > 0 || annualDistillLimit > 0)) {
      const gemsResp = evaluateHiddenGems(store, fundamentalVault, regulatoryKb, {
        equityOnly,
        benchmarkFdRatePct: parseBenchmarkFdRate(),
        monitorStatusMap: fundamentalMonitor.getStatusMap(),
      });
      const rankedPool =
        explicitSymbols.length > 0
          ? explicitSymbols
          : [
              ...gemsResp.gems.filter((g) => !g.kbEntry).map((g) => g.symbol),
              ...gemsResp.gems.map((g) => g.symbol),
            ];
      const uniquePool = Array.from(new Set(rankedPool));

      if (enrichLimit > 0 && uniquePool.length > 0) {
        const toEnrich = uniquePool.slice(0, Math.min(6, enrichLimit));
        try {
          const enrichOut = await regulatoryKb.enrichCompanies(toEnrich, store, fundamentalVault);
          for (const entry of enrichOut.updated) {
            enrichedSymbols.push(entry.symbol);
            regulatoryKb.markDailySymbolSearched(entry.symbol, todayNpt);
          }
          warnings.push(...enrichOut.warnings);
        } catch (enrichErr) {
          warnings.push(
            `Company KB enrichment skipped: ${enrichErr instanceof Error ? enrichErr.message : 'failed'}`
          );
        }
      }

      if (annualDistillLimit > 0) {
        const annualUniverse = getAnnualReportUniverse(store, fundamentalVault, regulatoryKb, {
          equityOnly,
        });
        const annualPool =
          explicitSymbols.length > 0
            ? explicitSymbols
            : [
                ...annualUniverse.candidates
                  .filter((c) => c.aiDistilledFyCount === 0)
                  .map((c) => c.symbol),
                ...annualUniverse.candidates.map((c) => c.symbol),
              ];
        for (const sym of Array.from(new Set(annualPool)).slice(0, annualDistillLimit)) {
          try {
            const distilled = await distillAnnualReportWithAi(
              store,
              fundamentalVault,
              regulatoryKb,
              sym,
              undefined,
              false
            );
            if (!distilled.cached) annualDistilledSymbols.push(sym);
          } catch (distErr) {
            warnings.push(
              `Annual distillation skipped for ${sym}: ${distErr instanceof Error ? distErr.message : 'failed'}`
            );
          }
        }
      }
    }

    regulatoryKb.setLastDailyCrawlDate(todayNpt);
    scheduler.markKbCrawledOnDate(todayNpt);

    let githubPushed = false;
    let githubPushMessage: string | undefined;
    if (opts.trigger === 'manual') {
      const pushRes = await scheduler.triggerAutoGitHubPush(
        'kb',
        `chore(kb): crawl regulatory, annual & quarterly knowledge base (${todayNpt})`
      );
      githubPushed = pushRes.committed;
      githubPushMessage = pushRes.message;
    }

    return {
      skipped: false,
      date: todayNpt,
      geminiConfigured,
      agencies,
      addedNotices: harvest.addedNotices,
      companiesUpdated: harvest.companiesUpdated + enrichedSymbols.length,
      enrichedSymbols,
      annualDistilledSymbols,
      quarterlyRefreshed,
      directResults: harvest.directResults,
      warnings: Array.from(new Set(warnings)),
      summary: regulatoryKb.getSummary(),
      githubPushed,
      githubPushMessage,
    };
  }

  scheduler.setDailyKbHandler(async ({ force, trigger }) =>
    runDailyKbPipeline({
      agencies: ALL_AGENCIES,
      enrichLimit: 6,
      annualDistillLimit: 2,
      includeQuarterly: true,
      equityOnly: true,
      force,
      trigger,
    })
  );
  scheduler.setTodaySearchedCounter(() => regulatoryKb.getDailySearchCountForDate());
  fundamentalMonitor.setOnDataUpdated(async (msg) => {
    await scheduler.triggerAutoGitHubPush('kb', `chore(financials): ${msg}`);
  });

  function parseBenchmarkFdRate(): number {
    const macro = loadMacroSnapshot(store);
    const raw = macro?.fixedIncomeBenchmarks?.bankFdIndividualRate || '';
    const m = raw.match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 1 && n < 20) return n;
    }
    return 6.5;
  }

  // ---------------------------------------------------------------- Market Data Routes
  app.get('/api/meta', (_req, res) => {
    const dates = store.getDates();
    const daily = store.getDailyAggregates();
    res.json({
      dates,
      daily,
      totalDays: dates.length,
    });
  });

  app.get('/api/day/:date', (req, res) => {
    const { date } = req.params;
    if (!isValidDateStr(date)) {
      res.status(400).json({ error: 'Invalid date format (expected YYYY-MM-DD)' });
      return;
    }
    const equityOnly = req.query.equityOnly === 'true';
    const rows = store.getDayPrices(date, equityOnly);
    res.json({ date, rows });
  });

  app.get('/api/market-pulse', (req, res) => {
    const dates = store.getDates();
    const day =
      typeof req.query.day === 'string' && isValidDateStr(req.query.day)
        ? req.query.day
        : dates[dates.length - 1];
    if (!day) {
      res.status(404).json({ error: 'No trading day loaded' });
      return;
    }
    const start =
      typeof req.query.start === 'string' && isValidDateStr(req.query.start)
        ? req.query.start
        : undefined;
    const end =
      typeof req.query.end === 'string' && isValidDateStr(req.query.end)
        ? req.query.end
        : undefined;
    const nDays = req.query.nDays ? Math.max(2, Math.min(250, Number(req.query.nDays))) : 20;
    const equityOnly = req.query.equityOnly !== 'false';
    res.json(store.getMarketPulse(day, equityOnly, { start, end, nDays }));
  });

  app.get('/api/homepage-pulse', (req, res) => {
    const dates = store.getDates();
    const day =
      typeof req.query.day === 'string' && isValidDateStr(req.query.day)
        ? req.query.day
        : dates[dates.length - 1];
    if (!day) {
      res.status(404).json({ error: 'No trading day loaded' });
      return;
    }
    const nDays = req.query.nDays ? Math.max(5, Math.min(250, Number(req.query.nDays))) : 20;
    const equityOnly = req.query.equityOnly !== 'false';
    const payload = store.getHomepageCommand(day, nDays, equityOnly);
    if (!payload) {
      res.status(404).json({ error: 'No trading data available for homepage command' });
      return;
    }
    res.json(payload);
  });

  app.get('/api/top-turnover-analytics', (req, res) => {
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if (!isValidDateStr(start) || !isValidDateStr(end)) {
      res.status(400).json({ error: 'Invalid start or end date' });
      return;
    }
    const equityOnly = req.query.equityOnly !== 'false';
    const n = req.query.n ? Math.max(1, Math.min(200, Number(req.query.n))) : 20;
    const nDays = req.query.nDays ? Math.max(2, Math.min(250, Number(req.query.nDays))) : 20;
    res.json(store.getTopTurnoverAnalytics(start, end, nDays, n, equityOnly));
  });

  app.get('/api/opportunity-radar', (req, res) => {
    const dates = store.getDates();
    const day =
      typeof req.query.day === 'string' && isValidDateStr(req.query.day)
        ? req.query.day
        : dates[dates.length - 1];
    if (!day) {
      res.status(404).json({ error: 'No trading day loaded' });
      return;
    }
    const nDays = req.query.nDays ? Math.max(5, Math.min(250, Number(req.query.nDays))) : 20;
    const equityOnly = req.query.equityOnly !== 'false';
    res.json(store.getOpportunityRadar(day, nDays, equityOnly));
  });

  app.get('/api/compare', (req, res) => {
    const rawSyms = String(req.query.symbols || '');
    const symbols = rawSyms
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (symbols.length === 0) {
      res.status(400).json({ error: 'Provide comma-separated symbols' });
      return;
    }
    const nDays = req.query.nDays ? Math.max(2, Math.min(250, Number(req.query.nDays))) : 20;
    const end =
      typeof req.query.end === 'string' && isValidDateStr(req.query.end)
        ? req.query.end
        : undefined;
    res.json(store.compareStocks(symbols, nDays, end));
  });

  app.get('/api/symbols', (req, res) => {
    const dates = store.getDates();
    const day = typeof req.query.day === 'string' && isValidDateStr(req.query.day)
      ? req.query.day
      : dates[dates.length - 1];
    if (!day) {
      res.json({ symbols: [] });
      return;
    }
    const equityOnly = req.query.equityOnly === 'true';
    res.json({ symbols: store.getSymbols(day, equityOnly) });
  });

  app.get('/api/symbol/:symbol', (req, res) => {
    const symbol = (req.params.symbol || '').trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9._-]{1,20}$/.test(symbol)) {
      res.status(400).json({ error: 'Invalid symbol' });
      return;
    }
    const end = typeof req.query.end === 'string' && isValidDateStr(req.query.end)
      ? req.query.end
      : undefined;
    const days = req.query.days ? Math.max(1, Math.min(500, Number(req.query.days))) : undefined;
    const history = store.getSymbolHistory(symbol, end, days);
    res.json({ symbol, history });
  });

  app.get('/api/range-summary', (req, res) => {
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if (!isValidDateStr(start) || !isValidDateStr(end)) {
      res.status(400).json({ error: 'Invalid start or end date' });
      return;
    }
    const equityOnly = req.query.equityOnly === 'true';
    const n = req.query.n ? Math.max(1, Math.min(200, Number(req.query.n))) : 50;
    const summary = store.rangeSummary(start, end, equityOnly);
    const marketTotalTurnover = summary.reduce((acc, r) => acc + r.turnover, 0);
    const rows = summary.slice(0, n).map((r) => ({
      ...r,
      market_share_pct:
        marketTotalTurnover > 0 ? Math.round((r.turnover / marketTotalTurnover) * 10000) / 100 : 0,
    }));
    res.json({ rows, total: summary.length, marketTotalTurnover });
  });

  app.get('/api/weekly-turnover', (req, res) => {
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if (!isValidDateStr(start) || !isValidDateStr(end)) {
      res.status(400).json({ error: 'Invalid start or end date' });
      return;
    }
    const equityOnly = req.query.equityOnly === 'true';
    const n = req.query.n ? Math.max(1, Math.min(50, Number(req.query.n))) : 15;
    res.json(store.weeklyTopTurnover(start, end, n, equityOnly));
  });

  app.get('/api/turnover-direction', (req, res) => {
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if (!isValidDateStr(start) || !isValidDateStr(end)) {
      res.status(400).json({ error: 'Invalid start or end date' });
      return;
    }
    const topPct = req.query.topPct ? Math.max(1, Math.min(100, Number(req.query.topPct))) : 10;
    const consistent = req.query.consistent === 'true';
    const equityOnly = req.query.equityOnly !== 'false';
    res.json(store.turnoverDirection(start, end, topPct, consistent, equityOnly));
  });

  app.post('/api/scanner', (req, res) => {
    const { kind, end, minAvgTurnover, equityOnly, params } = req.body ?? {};
    if (!VALID_SCANNERS.has(kind)) {
      res.status(400).json({ error: 'Invalid scanner kind' });
      return;
    }
    const endStr = typeof end === 'string' && isValidDateStr(end) ? end : undefined;
    const minTurn = typeof minAvgTurnover === 'number' && Number.isFinite(minAvgTurnover)
      ? Math.max(0, minAvgTurnover)
      : 1_000_000;
    const eqOnly = equityOnly !== false;
    const cleanParams: Record<string, number | boolean> = {};
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'number' && Number.isFinite(v)) cleanParams[k] = v;
        else if (typeof v === 'boolean') cleanParams[k] = v;
      }
    }
    const rows = store.runScanner(kind, {
      end: endStr,
      minAvgTurnover: minTurn,
      equityOnly: eqOnly,
      params: cleanParams,
    });
    res.json({ rows });
  });

  // ---------------------------------------------------------------- Quantitative Statistical Advantage Engine Routes
  app.post('/api/quant/analyze', (req, res) => {
    try {
      const dates = store.getDates();
      if (dates.length === 0) {
        res.status(404).json({ error: 'No trading data loaded' });
        return;
      }
      const rawAsOf = typeof req.body?.asOf === 'string' ? req.body.asOf : undefined;
      if (rawAsOf && !isValidDateStr(rawAsOf)) {
        res.status(400).json({ error: 'Invalid asOf date format (expected YYYY-MM-DD)' });
        return;
      }
      const equityOnly = req.body?.equityOnly !== false;
      const config =
        req.body?.config && typeof req.body.config === 'object'
          ? (req.body.config as Partial<QuantEngineConfig>)
          : undefined;
      const result = runQuantAnalysis(store, { asOf: rawAsOf, equityOnly, config });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Quantitative analysis engine failed',
      });
    }
  });

  app.post('/api/quant/backtest', (req, res) => {
    try {
      const dates = store.getDates();
      if (dates.length === 0) {
        res.status(404).json({ error: 'No trading data loaded' });
        return;
      }
      const rawAsOf = typeof req.body?.asOf === 'string' ? req.body.asOf : undefined;
      if (rawAsOf && !isValidDateStr(rawAsOf)) {
        res.status(400).json({ error: 'Invalid asOf date format (expected YYYY-MM-DD)' });
        return;
      }
      const asOfDate = rawAsOf && dates.includes(rawAsOf) ? rawAsOf : dates[dates.length - 1];
      const equityOnly = req.body?.equityOnly !== false;
      const config =
        req.body?.config && typeof req.body.config === 'object'
          ? (req.body.config as Partial<QuantEngineConfig>)
          : undefined;
      const { backtest } = runQuantBacktest(store, asOfDate, equityOnly, config);
      res.json(backtest);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Quantitative backtest failed',
      });
    }
  });

  app.get('/api/quant/high-conviction', (req, res) => {
    try {
      const dates = store.getDates();
      if (dates.length === 0) {
        res.status(404).json({ error: 'No trading data loaded' });
        return;
      }
      const rawAsOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
      if (rawAsOf && !isValidDateStr(rawAsOf)) {
        res.status(400).json({ error: 'Invalid asOf date format (expected YYYY-MM-DD)' });
        return;
      }
      const equityOnly = req.query.equityOnly !== 'false';
      const feed = getHighConvictionFeed(store, rawAsOf, equityOnly);
      res.json(feed);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to compute high-conviction buy feed',
      });
    }
  });

  app.post('/api/quant/refresh-catalysts', async (req, res) => {
    try {
      const rawSymbols = Array.isArray(req.body?.symbols)
        ? req.body.symbols.map((s: unknown) => String(s || '').trim().toUpperCase()).filter(Boolean)
        : [];
      if (rawSymbols.length === 0) {
        res.status(400).json({ error: 'Provide at least one stock symbol to refresh catalysts' });
        return;
      }
      const nDays = req.body?.nDays ? Math.max(5, Math.min(250, Number(req.body.nDays))) : 20;
      const data = await auditCohortStocks(store, rawSymbols.slice(0, 5), nDays);
      invalidateQuantFeedCache();
      res.json(data);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to refresh stock catalysts',
      });
    }
  });

  // ---------------------------------------------------------------- Auto Analyzer Routes
  app.get('/api/analyzer/scan', (req, res) => {
    try {
      const tfRaw = typeof req.query.tf === 'string' && req.query.tf ? req.query.tf : '1D';
      if (!VALID_ANALYZER_TF.has(tfRaw as AnalyzerTimeframe)) {
        res.status(400).json({ error: 'Invalid timeframe (expected 1D, 1W, or 1M)' });
        return;
      }
      const stratRaw =
        typeof req.query.strategy === 'string' && req.query.strategy ? req.query.strategy : 'All';
      if (!VALID_ANALYZER_STRATEGIES.has(stratRaw as AnalyzerStrategyFilter)) {
        res.status(400).json({ error: 'Invalid strategy filter' });
        return;
      }
      const asOfRaw = typeof req.query.asOf === 'string' && req.query.asOf ? req.query.asOf : undefined;
      if (asOfRaw && !isValidDateStr(asOfRaw)) {
        res.status(400).json({ error: 'Invalid asOf date format (expected YYYY-MM-DD)' });
        return;
      }
      const gradeRaw = typeof req.query.minGrade === 'string' ? req.query.minGrade.toUpperCase() : 'B';
      if (!['A', 'B', 'C'].includes(gradeRaw)) {
        res.status(400).json({ error: 'Invalid minGrade (expected A, B, or C)' });
        return;
      }
      const equityOnly = req.query.equityOnly !== 'false';
      const config = parseAnalyzerConfigQuery(req.query);
      const payload = scanAnalyzerMarket(store, {
        tf: tfRaw as AnalyzerTimeframe,
        strategy: stratRaw as AnalyzerStrategyFilter,
        asOf: asOfRaw,
        minGrade: gradeRaw as 'A' | 'B' | 'C',
        equityOnly,
        config,
      });
      res.json(payload);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Auto Analyzer scan failed',
      });
    }
  });

  app.get('/api/analyzer/backtest', (req, res) => {
    try {
      const symRaw =
        typeof req.query.symbol === 'string' && req.query.symbol.trim()
          ? req.query.symbol.trim().toUpperCase()
          : undefined;
      if (symRaw && !/^[A-Z0-9._-]{1,20}$/.test(symRaw)) {
        res.status(400).json({ error: 'Invalid symbol parameter' });
        return;
      }
      const tfRaw = typeof req.query.tf === 'string' && req.query.tf ? req.query.tf : '1D';
      if (!VALID_ANALYZER_TF.has(tfRaw as AnalyzerTimeframe)) {
        res.status(400).json({ error: 'Invalid timeframe (expected 1D, 1W, or 1M)' });
        return;
      }
      const stratRaw =
        typeof req.query.strategy === 'string' && req.query.strategy ? req.query.strategy : 'All';
      if (!VALID_ANALYZER_STRATEGIES.has(stratRaw as AnalyzerStrategyFilter)) {
        res.status(400).json({ error: 'Invalid strategy filter' });
        return;
      }
      const holdoutRatio =
        req.query.holdoutRatio !== undefined ? Number(req.query.holdoutRatio) : 0.35;
      if (!Number.isFinite(holdoutRatio) || holdoutRatio < 0.1 || holdoutRatio > 0.7) {
        res.status(400).json({ error: 'holdoutRatio must be between 0.1 and 0.7' });
        return;
      }
      const equityOnly = req.query.equityOnly !== 'false';
      const config = parseAnalyzerConfigQuery(req.query);
      const summary = runAnalyzerBacktest(store, {
        symbol: symRaw,
        tf: tfRaw as AnalyzerTimeframe,
        strategy: stratRaw as AnalyzerStrategyFilter,
        holdoutRatio,
        equityOnly,
        config,
      });
      res.json(summary);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Auto Analyzer backtest failed',
      });
    }
  });

  app.get('/api/analyzer/:symbol', (req, res) => {
    try {
      const symbol = String(req.params.symbol || '').trim().toUpperCase();
      if (!/^[A-Z0-9._-]{1,20}$/.test(symbol)) {
        res.status(400).json({ error: 'Invalid ticker symbol' });
        return;
      }
      const tfRaw = typeof req.query.tf === 'string' && req.query.tf ? req.query.tf : '1D';
      if (!VALID_ANALYZER_TF.has(tfRaw as AnalyzerTimeframe)) {
        res.status(400).json({ error: 'Invalid timeframe (expected 1D, 1W, or 1M)' });
        return;
      }
      const stratRaw =
        typeof req.query.strategy === 'string' && req.query.strategy ? req.query.strategy : 'All';
      if (!VALID_ANALYZER_STRATEGIES.has(stratRaw as AnalyzerStrategyFilter)) {
        res.status(400).json({ error: 'Invalid strategy filter' });
        return;
      }
      const asOfRaw = typeof req.query.asOf === 'string' && req.query.asOf ? req.query.asOf : undefined;
      if (asOfRaw && !isValidDateStr(asOfRaw)) {
        res.status(400).json({ error: 'Invalid asOf date format (expected YYYY-MM-DD)' });
        return;
      }
      const config = parseAnalyzerConfigQuery(req.query);
      const analysis = analyzeSymbolFromStore(store, {
        symbol,
        tf: tfRaw as AnalyzerTimeframe,
        strategy: stratRaw as AnalyzerStrategyFilter,
        asOf: asOfRaw,
        config,
      });
      if (!analysis) {
        res.status(404).json({ error: `No historical sessions found for ${symbol}` });
        return;
      }
      res.json(analysis);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Auto Analyzer failed',
      });
    }
  });

  // ---------------------------------------------------------------- ShareSansar Quarterly Financials (data/financial/)
  app.get('/api/financials', (_req, res) => {
    try {
      res.json({
        folder: 'data/financial',
        items: listSavedFinancials(DATA_DIR),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to list saved financials',
      });
    }
  });

  app.post('/api/financials/scrape-batch', async (req, res) => {
    try {
      const force = Boolean(req.body?.force);
      let symbols: string[] = Array.isArray(req.body?.symbols)
        ? req.body.symbols.map((s: unknown) => String(s || '').trim().toUpperCase()).filter(isValidSymbol)
        : [];

      if (symbols.length === 0) {
        const allDates = store.getDates();
        const latestDay = allDates[allDates.length - 1];
        if (latestDay) {
          symbols = store
            .getDayPrices(latestDay, true)
            .sort((a, b) => b.turnover - a.turnover)
            .slice(0, 10)
            .map((r) => r.symbol);
        }
      }

      if (symbols.length === 0) {
        res.status(400).json({ error: 'No valid symbols available to fetch' });
        return;
      }

      const activeQ = getActiveNepalFiscalQuarter(new Date(), 15);
      const skipped: string[] = [];
      const toScrape = force
        ? symbols
        : symbols.filter((sym) => {
            if (fundamentalVault.hasQuarterData(sym, activeQ.fiscalYear, activeQ.quarter)) {
              skipped.push(sym);
              return false;
            }
            return true;
          });

      const result =
        toScrape.length > 0
          ? await scrapeBatchFinancials(DATA_DIR, toScrape)
          : { total: 0, succeeded: [], failed: [] };

      for (const sym of result.succeeded) {
        const snap = getSavedFinancials(DATA_DIR, sym);
        if (snap) {
          for (const rec of normalizeShareSansarSnapshot(snap)) {
            fundamentalVault.upsertStatementRecord(rec, [
              {
                title: `${sym} Financial Reports`,
                uri: snap.sourceUrl,
                category: 'NEPSE Portal',
              },
            ]);
          }
        }
      }
      if (result.succeeded.length > 0) {
        fundamentalVault.writeConsolidatedQuarterlyCsv();
        void scheduler.triggerAutoGitHubPush(
          'kb',
          `chore(financials): update quarterly financials for ${result.succeeded.slice(0, 5).join(', ')}`
        );
      }
      fundamentalMonitor.syncEntriesFromMarketAndVault(true);

      res.json({
        ...result,
        skipped,
        items: listSavedFinancials(DATA_DIR),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Batch financials fetch failed',
      });
    }
  });

  app.get('/api/screener/vault-csv', (_req, res) => {
    try {
      const csvPath = fundamentalVault.writeConsolidatedQuarterlyCsv();
      res.download(csvPath, 'nepse_quarterly_metrics.csv');
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to build consolidated vault CSV',
      });
    }
  });

  app.get('/api/financials/:symbol', (req, res) => {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!isValidSymbol(symbol)) {
      res.status(400).json({ error: 'Invalid ticker symbol' });
      return;
    }
    if (req.query.format === 'csv') {
      const csvPath = getSavedFinancialCsvPath(DATA_DIR, symbol);
      if (!csvPath) {
        res.status(404).json({ error: `No saved CSV financials found for ${symbol}` });
        return;
      }
      res.download(csvPath, `${symbol}_quarterly_financials.csv`);
      return;
    }
    const saved = getSavedFinancials(DATA_DIR, symbol);
    if (!saved) {
      res.status(404).json({ error: `No saved financials for ${symbol} yet` });
      return;
    }
    res.json(saved);
  });

  app.post('/api/financials/:symbol/scrape', async (req, res) => {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!isValidSymbol(symbol)) {
      res.status(400).json({ error: 'Invalid ticker symbol' });
      return;
    }
    try {
      const force = Boolean(req.body?.force);
      const activeQ = getActiveNepalFiscalQuarter(new Date(), 15);
      if (!force && fundamentalVault.hasQuarterData(symbol, activeQ.fiscalYear, activeQ.quarter)) {
        const existing = getSavedFinancials(DATA_DIR, symbol);
        if (existing) {
          res.json({ ...existing, skipped: true });
          return;
        }
      }

      const snapshot = await scrapeCompanyFinancials(DATA_DIR, symbol);
      for (const rec of normalizeShareSansarSnapshot(snapshot)) {
        fundamentalVault.upsertStatementRecord(rec, [
          {
            title: `${symbol} Financial Reports`,
            uri: snapshot.sourceUrl,
            category: 'NEPSE Portal',
          },
        ]);
      }
      fundamentalVault.writeConsolidatedQuarterlyCsv();
      fundamentalMonitor.syncEntriesFromMarketAndVault(true);
      void scheduler.triggerAutoGitHubPush(
        'kb',
        `chore(financials): update quarterly statement ledger for ${symbol}`
      );
      res.json(snapshot);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : `Failed to fetch financials for ${symbol}`,
      });
    }
  });

  // ---------------------------------------------------------------- Fundamental Intelligence & Multi-Investor Screener Routes
  app.get('/api/screener/overview', (req, res) => {
    try {
      const equityOnly = req.query.equityOnly !== 'false';
      const fiscalYear =
        typeof req.query.fiscalYear === 'string' && req.query.fiscalYear.trim()
          ? req.query.fiscalYear.trim()
          : undefined;
      const quarter =
        typeof req.query.quarter === 'string' &&
        ['Q1', 'Q2', 'Q3', 'Q4', 'Annual'].includes(req.query.quarter.trim())
          ? (req.query.quarter.trim() as QuarterCode)
          : undefined;

      const annualWeightRaw =
        typeof req.query.annualWeightPct === 'string' && req.query.annualWeightPct.trim()
          ? Number(req.query.annualWeightPct)
          : 70;
      const annualWeightPct = Number.isFinite(annualWeightRaw)
        ? Math.max(0, Math.min(100, Math.round(annualWeightRaw)))
        : 70;

      fundamentalMonitor.syncEntriesFromMarketAndVault(equityOnly);
      const statusMap = fundamentalMonitor.getStatusMap();
      const evaluated = evaluateScreenerUniverse(store, fundamentalVault, {
        equityOnly,
        fiscalYear,
        quarter,
        monitorStatusMap: statusMap,
        benchmarkFdRatePct: parseBenchmarkFdRate(),
        annualWeightPct,
        kbMap: regulatoryKb.getAllCompanyEntries(),
      });

      const activeQ = getActiveNepalFiscalQuarter(
        new Date(),
        fundamentalMonitor.getStatus(equityOnly).config.delayDaysAfterQuarterEnd
      );

      const rankingCounts: Record<RankingCategory, number> = {
        overall_top: 0,
        fundamentally_strong: 0,
        high_growth: 0,
        undervalued: 0,
        defensive_value: 0,
        high_turnover_fundamental: 0,
        positive_momentum_fundamental: 0,
        quality_compounders: 0,
      };
      const consensusCounts: Record<ConsensusTag, number> = {
        buffett_munger: 0,
        graham_marks: 0,
        lynch_fisher: 0,
        greenblatt_graham: 0,
        buffett_pabrai: 0,
        marks_templeton: 0,
      };

      const sectorSet = new Set<string>();
      for (const row of evaluated.rows) {
        sectorSet.add(row.sector);
        for (const rTag of row.rankingQualifiers) {
          rankingCounts[rTag]++;
        }
        for (const cMatch of row.consensusMatches) {
          if (cMatch.qualified) consensusCounts[cMatch.id]++;
        }
      }

      const fySet = new Set<string>();
      for (const ledger of fundamentalVault.getAllLedgers()) {
        for (const rec of ledger.records) fySet.add(rec.fiscalYear);
      }

      // Apply optional filters
      let rows = evaluated.rows;
      const sectorFilter =
        typeof req.query.sector === 'string' && req.query.sector !== 'All'
          ? req.query.sector.trim()
          : null;
      const rankingFilter =
        typeof req.query.ranking === 'string' && req.query.ranking !== 'all'
          ? (req.query.ranking.trim() as RankingCategory)
          : null;
      const consensusFilter =
        typeof req.query.consensus === 'string' && req.query.consensus !== 'all'
          ? (req.query.consensus.trim() as ConsensusTag)
          : null;
      const statusFilter =
        typeof req.query.status === 'string' && req.query.status !== 'all'
          ? req.query.status.trim()
          : null;
      const onlyEvaluated = req.query.onlyEvaluated === 'true';
      const searchQ =
        typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
      const minQuality = req.query.minQuality ? Number(req.query.minQuality) : null;
      const minMos = req.query.minMos ? Number(req.query.minMos) : null;
      const minPe = req.query.minPe ? Number(req.query.minPe) : null;
      const maxPe = req.query.maxPe ? Number(req.query.maxPe) : null;
      const maxPb = req.query.maxPb ? Number(req.query.maxPb) : null;
      const maxPeg = req.query.maxPeg ? Number(req.query.maxPeg) : null;
      const minEps = req.query.minEps ? Number(req.query.minEps) : null;
      const minRoe = req.query.minRoe ? Number(req.query.minRoe) : null;
      const maxDe = req.query.maxDe ? Number(req.query.maxDe) : null;
      const maxNpl = req.query.maxNpl ? Number(req.query.maxNpl) : null;
      const minEpsYoy = req.query.minEpsYoy ? Number(req.query.minEpsYoy) : null;
      const minEpsQoq = req.query.minEpsQoq ? Number(req.query.minEpsQoq) : null;
      const minProfitYoy = req.query.minProfitYoy ? Number(req.query.minProfitYoy) : null;
      const improvingQoq = req.query.improvingQoq === 'true';
      const outlookFilter =
        typeof req.query.outlook === 'string' && req.query.outlook !== 'all'
          ? req.query.outlook.trim()
          : null;

      if (onlyEvaluated) rows = rows.filter((r) => r.hasFundamentalData);
      if (outlookFilter === 'blow_up') {
        rows = rows.filter(
          (r) =>
            r.comingQuarterOutlook.direction === 'Blow Up' ||
            r.comingQuarterOutlook.direction === 'Moderate Upside'
        );
      } else if (outlookFilter === 'blow_down') {
        rows = rows.filter(
          (r) =>
            r.comingQuarterOutlook.direction === 'Blow Down' ||
            r.comingQuarterOutlook.direction === 'Downside Risk'
        );
      }
      if (sectorFilter) {
        rows = rows.filter(
          (r) => r.sector === sectorFilter || r.sectorGroup === sectorFilter
        );
      }
      if (rankingFilter) {
        rows = rows.filter((r) => r.rankingQualifiers.includes(rankingFilter));
      }
      if (consensusFilter) {
        rows = rows.filter((r) =>
          r.consensusMatches.some((c) => c.id === consensusFilter && c.qualified)
        );
      }
      if (statusFilter) {
        rows = rows.filter((r) => r.reportingStatus === statusFilter);
      }
      if (searchQ) {
        rows = rows.filter(
          (r) =>
            r.symbol.toLowerCase().includes(searchQ) ||
            r.companyName.toLowerCase().includes(searchQ) ||
            r.sector.toLowerCase().includes(searchQ)
        );
      }
      if (minQuality !== null && Number.isFinite(minQuality)) {
        rows = rows.filter((r) => r.scores.fundamentalQualityScore >= minQuality);
      }
      if (minMos !== null && Number.isFinite(minMos)) {
        rows = rows.filter((r) => (r.keyMetrics.marginOfSafetyPct ?? -999) >= minMos);
      }
      if (minPe !== null && Number.isFinite(minPe)) {
        rows = rows.filter((r) => r.keyMetrics.pe !== null && r.keyMetrics.pe >= minPe);
      }
      if (maxPe !== null && Number.isFinite(maxPe)) {
        rows = rows.filter(
          (r) => r.keyMetrics.pe !== null && r.keyMetrics.pe > 0 && r.keyMetrics.pe <= maxPe
        );
      }
      if (maxPb !== null && Number.isFinite(maxPb)) {
        rows = rows.filter(
          (r) => r.keyMetrics.pb !== null && r.keyMetrics.pb > 0 && r.keyMetrics.pb <= maxPb
        );
      }
      if (maxPeg !== null && Number.isFinite(maxPeg)) {
        rows = rows.filter(
          (r) => r.keyMetrics.peg !== null && r.keyMetrics.peg > 0 && r.keyMetrics.peg <= maxPeg
        );
      }
      if (minEps !== null && Number.isFinite(minEps)) {
        rows = rows.filter((r) => r.keyMetrics.eps !== null && r.keyMetrics.eps >= minEps);
      }
      if (minRoe !== null && Number.isFinite(minRoe)) {
        rows = rows.filter((r) => r.keyMetrics.roePct !== null && r.keyMetrics.roePct >= minRoe);
      }
      if (maxDe !== null && Number.isFinite(maxDe)) {
        rows = rows.filter(
          (r) => r.keyMetrics.debtToEquity === null || r.keyMetrics.debtToEquity <= maxDe
        );
      }
      if (maxNpl !== null && Number.isFinite(maxNpl)) {
        rows = rows.filter(
          (r) => r.keyMetrics.nplPct === null || r.keyMetrics.nplPct <= maxNpl
        );
      }
      if (minEpsYoy !== null && Number.isFinite(minEpsYoy)) {
        rows = rows.filter(
          (r) => r.keyMetrics.epsYoyPct !== null && r.keyMetrics.epsYoyPct >= minEpsYoy
        );
      }
      if (minEpsQoq !== null && Number.isFinite(minEpsQoq)) {
        rows = rows.filter(
          (r) => r.keyMetrics.epsQoqPct !== null && r.keyMetrics.epsQoqPct >= minEpsQoq
        );
      }
      if (minProfitYoy !== null && Number.isFinite(minProfitYoy)) {
        rows = rows.filter(
          (r) => r.keyMetrics.netProfitYoyPct !== null && r.keyMetrics.netProfitYoyPct >= minProfitYoy
        );
      }
      if (improvingQoq) {
        rows = rows.filter(
          (r) => r.keyMetrics.epsQoqPct !== null && r.keyMetrics.epsQoqPct > 0
        );
      }

      const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'overallScore';
      rows = [...rows].sort((a, b) => {
        if (a.hasFundamentalData !== b.hasFundamentalData) {
          return a.hasFundamentalData ? -1 : 1;
        }
        const getVal = (r: ScreenedCompanyRow): number => {
          switch (sortBy) {
            case 'quality':
              return r.scores.fundamentalQualityScore;
            case 'value':
              return r.scores.valuationAttractivenessScore;
            case 'growth':
              return r.scores.growthScore;
            case 'risk':
              return r.scores.riskManagementScore;
            case 'compounding':
              return r.scores.longTermCompoundingScore;
            case 'mos':
              return r.keyMetrics.marginOfSafetyPct ?? -999;
            case 'roe':
              return r.keyMetrics.roePct ?? -999;
            case 'pe':
              return r.keyMetrics.pe !== null && r.keyMetrics.pe > 0 ? -r.keyMetrics.pe : -999;
            case 'eps':
              return r.keyMetrics.eps ?? -999;
            case 'peg':
              return r.keyMetrics.peg !== null && r.keyMetrics.peg > 0 ? -r.keyMetrics.peg : -999;
            case 'epsYoy':
              return r.keyMetrics.epsYoyPct ?? -999;
            case 'epsQoq':
              return r.keyMetrics.epsQoqPct ?? -999;
            case 'profitYoy':
              return r.keyMetrics.netProfitYoyPct ?? -999;
            case 'cagr3y':
              return r.keyMetrics.epsCagr3yPct ?? -999;
            case 'turnover':
              return r.market.turnover ?? -1;
            case 'consensus':
              return r.passedInvestorCount;
            case 'blowUp':
              return r.hasFundamentalData ? r.comingQuarterOutlook.score : -999;
            case 'blowDown':
              return r.hasFundamentalData ? -r.comingQuarterOutlook.score : -999;
            default:
              return r.scores.overallScore;
          }
        };
        return getVal(b) - getVal(a);
      });

      const withFun = evaluated.rows.filter((r) => r.hasFundamentalData);
      res.json({
        generatedAt: new Date().toISOString(),
        marketDate: evaluated.marketDate,
        annualWeightPct: evaluated.annualWeightPct,
        activeFiscalQuarter: activeQ,
        universeStats: {
          totalSymbols: evaluated.rows.length,
          withFundamentals: withFun.length,
          withAnnualReports: withFun.filter((r) => r.reportWeighting.hasAnnualReport).length,
          publishedActiveQuarter: evaluated.rows.filter((r) => r.reportingStatus === 'Published').length,
          pendingActiveQuarter: evaluated.rows.filter((r) => r.reportingStatus === 'Pending').length,
          retryingCount: evaluated.rows.filter((r) => r.reportingStatus === 'Retrying').length,
          failedCount: evaluated.rows.filter((r) => r.reportingStatus === 'Failed').length,
          incompleteCount: withFun.filter((r) =>
            r.latestPeriod.dataQualityFlags.includes('incomplete')
          ).length,
          outdatedCount: withFun.filter((r) =>
            r.latestPeriod.dataQualityFlags.includes('outdated')
          ).length,
        },
        sectors: Array.from(sectorSet).sort(),
        fiscalYears: Array.from(fySet).sort().reverse(),
        rankingCounts,
        consensusCounts,
        rows,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Fundamental screener evaluation failed',
      });
    }
  });

  app.get('/api/screener/company/:symbol', (req, res) => {
    try {
      const symbol = String(req.params.symbol || '').trim().toUpperCase();
      if (!isValidSymbol(symbol)) {
        res.status(400).json({ error: 'Invalid ticker symbol' });
        return;
      }
      const equityOnly = req.query.equityOnly !== 'false';
      const fiscalYear =
        typeof req.query.fiscalYear === 'string' && req.query.fiscalYear.trim()
          ? req.query.fiscalYear.trim()
          : undefined;
      const quarter =
        typeof req.query.quarter === 'string' &&
        ['Q1', 'Q2', 'Q3', 'Q4', 'Annual'].includes(req.query.quarter.trim())
          ? (req.query.quarter.trim() as QuarterCode)
          : undefined;

      const annualWeightRaw =
        typeof req.query.annualWeightPct === 'string' && req.query.annualWeightPct.trim()
          ? Number(req.query.annualWeightPct)
          : 70;
      const annualWeightPct = Number.isFinite(annualWeightRaw)
        ? Math.max(0, Math.min(100, Math.round(annualWeightRaw)))
        : 70;

      const evaluated = evaluateScreenerUniverse(store, fundamentalVault, {
        equityOnly,
        fiscalYear,
        quarter,
        monitorStatusMap: fundamentalMonitor.getStatusMap(),
        benchmarkFdRatePct: parseBenchmarkFdRate(),
        annualWeightPct,
        kbMap: regulatoryKb.getAllCompanyEntries(),
      });

      const detail = evaluated.bySymbol.get(symbol);
      if (!detail) {
        const pendingRow = evaluated.rows.find((r) => r.symbol === symbol);
        if (pendingRow) {
          res.status(404).json({
            error: `No financial statements collected yet for ${symbol}. Click Refresh to collect.`,
            pendingSummary: pendingRow,
          });
          return;
        }
        res.status(404).json({ error: `Company ${symbol} not found in universe` });
        return;
      }
      res.json(detail);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to inspect company fundamentals',
      });
    }
  });

  app.get('/api/screener/export', (req, res) => {
    try {
      const format = req.query.format === 'excel' ? 'excel' : 'csv';
      const equityOnly = req.query.equityOnly !== 'false';
      const symbolParam =
        typeof req.query.symbol === 'string' && req.query.symbol.trim()
          ? req.query.symbol.trim().toUpperCase()
          : null;

      const annualWeightRaw =
        typeof req.query.annualWeightPct === 'string' && req.query.annualWeightPct.trim()
          ? Number(req.query.annualWeightPct)
          : 70;
      const annualWeightPct = Number.isFinite(annualWeightRaw)
        ? Math.max(0, Math.min(100, Math.round(annualWeightRaw)))
        : 70;

      const evaluated = evaluateScreenerUniverse(store, fundamentalVault, {
        equityOnly,
        monitorStatusMap: fundamentalMonitor.getStatusMap(),
        benchmarkFdRatePct: parseBenchmarkFdRate(),
        annualWeightPct,
        kbMap: regulatoryKb.getAllCompanyEntries(),
      });

      if (symbolParam) {
        const detail = evaluated.bySymbol.get(symbolParam);
        if (!detail) {
          res.status(404).json({ error: `No fundamental ledger available to export for ${symbolParam}` });
          return;
        }
        const exported = buildSpreadsheetExport(format, [
          {
            name: `${symbolParam} History`,
            headers: [
              'Symbol',
              'Fiscal Year',
              'Quarter',
              'Publication Date',
              'Collection Date',
              'Source',
              'Validation',
              'EPS (NPR)',
              'Net Profit (Cr)',
              'Revenue (Cr)',
              'Net Margin %',
              'ROE %',
              'ROA %',
              'ROIC %',
              'BVPS (NPR)',
              'Net Worth (Cr)',
              'Assets (Cr)',
              'Liabilities (Cr)',
              'Reserves (Cr)',
              'Debt/Equity',
              'NPL %',
              'CAR %',
              'OCF (Cr)',
              'FCF (Cr)',
            ],
            rows: detail.statements.map((st) => [
              st.symbol,
              st.fiscalYear,
              st.quarter,
              st.publicationDate ?? 'Unavailable',
              st.collectionDate.slice(0, 10),
              st.dataSource,
              st.validationStatus,
              st.metrics.eps.value,
              st.metrics.netProfit.value !== null ? Number((st.metrics.netProfit.value / 1e7).toFixed(2)) : null,
              st.metrics.revenue.value !== null ? Number((st.metrics.revenue.value / 1e7).toFixed(2)) : null,
              st.metrics.netProfitMarginPct.value,
              st.metrics.roePct.value,
              st.metrics.roaPct.value,
              st.metrics.roicPct.value,
              st.metrics.bvps.value,
              st.metrics.netWorth.value !== null ? Number((st.metrics.netWorth.value / 1e7).toFixed(2)) : null,
              st.metrics.totalAssets.value !== null ? Number((st.metrics.totalAssets.value / 1e7).toFixed(2)) : null,
              st.metrics.totalLiabilities.value !== null ? Number((st.metrics.totalLiabilities.value / 1e7).toFixed(2)) : null,
              st.metrics.reserves.value !== null ? Number((st.metrics.reserves.value / 1e7).toFixed(2)) : null,
              st.metrics.debtToEquity.value,
              st.metrics.nplPct.value,
              st.metrics.carPct.value,
              st.metrics.operatingCashFlow.value !== null ? Number((st.metrics.operatingCashFlow.value / 1e7).toFixed(2)) : null,
              st.metrics.freeCashFlow.value !== null ? Number((st.metrics.freeCashFlow.value / 1e7).toFixed(2)) : null,
            ]),
          },
          {
            name: 'Investor Models',
            headers: ['Investor', 'Score', 'Qualified', 'Coverage %', 'Philosophy', 'Summary'],
            rows: Object.values(detail.investorDetails).map((inv) => [
              inv.investorName,
              inv.score,
              inv.qualified ? 'YES' : 'NO',
              inv.dataCoveragePct,
              inv.philosophy,
              inv.summary,
            ]),
          },
        ]);

        res.setHeader('Content-Type', exported.contentType);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${symbolParam}_fundamentals.${exported.extension}"`
        );
        res.send(exported.body);
        return;
      }

      const targetRows = evaluated.rows.filter((r) => r.hasFundamentalData);
      const exported = buildSpreadsheetExport(format, [
        {
          name: 'NEPSE Screener',
          headers: [
            'Symbol',
            'Company',
            'Sector',
            'Period',
            'Source',
            'Validation',
            'Verdict',
            'Overall Score',
            'Quality Score',
            'Value Score',
            'Growth Score',
            'Risk Score',
            'LTP',
            'Intrinsic Value',
            'Margin of Safety %',
            'P/E',
            'P/B',
            'PEG',
            'EPS',
            'Prev Period',
            'Prev EPS',
            'EPS QoQ %',
            'EPS YoY %',
            '3Y EPS CAGR %',
            'Net Profit YoY %',
            'Revenue YoY %',
            'ROE %',
            'ROE Δ pp',
            'ROA %',
            'ROIC %',
            'Net Margin %',
            'NPL %',
            'D/E',
            'Buffett',
            'Munger',
            'Graham',
            'Lynch',
            'Marks',
            'Fisher',
            'Greenblatt',
            'Templeton',
            'Pabrai',
            'Passed Investors',
            'Consensus Matches',
            'Next Qtr Target',
            'Next Qtr Direction',
            'Next Qtr Score',
            'Next Qtr Reasons',
            'Next Qtr References',
          ],
          rows: targetRows.map((r) => [
            r.symbol,
            r.companyName,
            r.sector,
            r.latestPeriod.periodLabel,
            r.latestPeriod.dataSource,
            r.latestPeriod.validationStatus,
            r.recommendation.verdict,
            r.scores.overallScore,
            r.scores.fundamentalQualityScore,
            r.scores.valuationAttractivenessScore,
            r.scores.growthScore,
            r.scores.riskManagementScore,
            r.market.ltp,
            r.keyMetrics.intrinsicValue,
            r.keyMetrics.marginOfSafetyPct,
            r.keyMetrics.pe,
            r.keyMetrics.pb,
            r.keyMetrics.peg,
            r.keyMetrics.eps,
            r.keyMetrics.prevPeriodLabel,
            r.keyMetrics.prevEps,
            r.keyMetrics.epsQoqPct,
            r.keyMetrics.epsYoyPct,
            r.keyMetrics.epsCagr3yPct,
            r.keyMetrics.netProfitYoyPct,
            r.keyMetrics.revenueYoyPct,
            r.keyMetrics.roePct,
            r.keyMetrics.roeQoqDeltaPct,
            r.keyMetrics.roaPct,
            r.keyMetrics.roicPct,
            r.keyMetrics.netMarginPct,
            r.keyMetrics.nplPct,
            r.keyMetrics.debtToEquity,
            r.investorScores.buffett,
            r.investorScores.munger,
            r.investorScores.graham,
            r.investorScores.lynch,
            r.investorScores.marks,
            r.investorScores.fisher,
            r.investorScores.greenblatt,
            r.investorScores.templeton,
            r.investorScores.pabrai,
            r.passedInvestorCount,
            r.consensusMatches.filter((c) => c.qualified).map((c) => c.label).join('; '),
            r.comingQuarterOutlook.comingQuarterLabel,
            r.comingQuarterOutlook.direction,
            r.comingQuarterOutlook.score,
            r.comingQuarterOutlook.reasons.join(' | '),
            r.comingQuarterOutlook.references
              .map((ref) => (ref.url ? `${ref.label} (${ref.url})` : ref.label))
              .join(' | '),
          ]),
        },
      ]);

      res.setHeader('Content-Type', exported.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="nepse_fundamental_screener.${exported.extension}"`
      );
      res.send(exported.body);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Export failed',
      });
    }
  });

  app.get('/api/screener/monitor', (req, res) => {
    try {
      const equityOnly = req.query.equityOnly !== 'false';
      res.json(fundamentalMonitor.getStatus(equityOnly));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to fetch fundamental monitor status',
      });
    }
  });

  app.put('/api/screener/monitor/config', (req, res) => {
    try {
      const config = fundamentalMonitor.updateConfig(req.body ?? {});
      res.json({ config });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid monitor configuration',
      });
    }
  });

  app.post('/api/screener/refresh/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!isValidSymbol(symbol)) {
      res.status(400).json({ error: 'Invalid ticker symbol' });
      return;
    }
    try {
      const crossValidate = req.body?.crossValidate !== undefined ? Boolean(req.body.crossValidate) : undefined;
      const force = Boolean(req.body?.force);
      const result = await fundamentalMonitor.refreshSymbol(symbol, 'manual-single', crossValidate, {
        force,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : `Failed to refresh fundamentals for ${symbol}`,
      });
    }
  });

  app.post('/api/screener/refresh-batch', (req, res) => {
    try {
      const modeRaw = String(req.body?.mode || 'pending');
      const mode = (['pending', 'top25', 'top50', 'all', 'due'].includes(modeRaw)
        ? modeRaw
        : 'pending') as 'pending' | 'top25' | 'top50' | 'all' | 'due';
      const force = Boolean(req.body?.force);
      const customSymbols = Array.isArray(req.body?.symbols)
        ? req.body.symbols.map((s: unknown) => String(s || ''))
        : undefined;
      const batch = fundamentalMonitor.startBatchRefresh(mode, force, customSymbols);
      res.json(batch);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to start batch fundamental refresh',
      });
    }
  });

  // ---------------------------------------------------------------- Master Multi-Factor Screener Route
  app.get('/api/master-screener', (req, res) => {
    try {
      const equityOnly = req.query.equityOnly !== 'false';
      const annualWeightRaw =
        typeof req.query.annualWeightPct === 'string' && req.query.annualWeightPct.trim()
          ? Number(req.query.annualWeightPct)
          : 70;
      const annualWeightPct = Number.isFinite(annualWeightRaw)
        ? Math.max(0, Math.min(100, Math.round(annualWeightRaw)))
        : 70;

      fundamentalMonitor.syncEntriesFromMarketAndVault(equityOnly);
      res.json(
        computeMasterScreener(store, fundamentalVault, regulatoryKb, {
          equityOnly,
          benchmarkFdRatePct: parseBenchmarkFdRate(),
          annualWeightPct,
          monitorStatusMap: fundamentalMonitor.getStatusMap(),
        })
      );
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to compute master screener',
      });
    }
  });

  // ---------------------------------------------------------------- Pricing & Annual Report Valuation Lab Routes
  app.get('/api/valuation/universe', (req, res) => {
    try {
      const equityOnly = req.query.equityOnly !== 'false';
      const annualWeightRaw =
        typeof req.query.annualWeightPct === 'string' && req.query.annualWeightPct.trim()
          ? Number(req.query.annualWeightPct)
          : 70;
      const annualWeightPct = Number.isFinite(annualWeightRaw)
        ? Math.max(0, Math.min(100, Math.round(annualWeightRaw)))
        : 70;

      fundamentalMonitor.syncEntriesFromMarketAndVault(equityOnly);
      res.json(
        getValuationUniverseSummary(store, fundamentalVault, regulatoryKb, {
          equityOnly,
          benchmarkFdRatePct: parseBenchmarkFdRate(),
          annualWeightPct,
          monitorStatusMap: fundamentalMonitor.getStatusMap(),
        })
      );
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to build valuation universe',
      });
    }
  });

  app.get('/api/valuation/company/:symbol', (req, res) => {
    try {
      const symbol = String(req.params.symbol || '').trim().toUpperCase();
      if (!isValidSymbol(symbol)) {
        res.status(400).json({ error: 'Invalid ticker symbol' });
        return;
      }
      const equityOnly = req.query.equityOnly !== 'false';
      const annualWeightRaw =
        typeof req.query.annualWeightPct === 'string' && req.query.annualWeightPct.trim()
          ? Number(req.query.annualWeightPct)
          : 70;
      const annualWeightPct = Number.isFinite(annualWeightRaw)
        ? Math.max(0, Math.min(100, Math.round(annualWeightRaw)))
        : 70;

      const dossier = buildCompanyValuationDossier(store, fundamentalVault, regulatoryKb, symbol, {
        equityOnly,
        benchmarkFdRatePct: parseBenchmarkFdRate(),
        annualWeightPct,
        monitorStatusMap: fundamentalMonitor.getStatusMap(),
      });
      if (!dossier) {
        res.status(404).json({
          error: `No fundamental statement ledger loaded yet for ${symbol}. Refresh statements first.`,
        });
        return;
      }
      res.json(dossier);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to compute company valuation dossier',
      });
    }
  });

  app.post('/api/valuation/annual-deep-dive', async (req, res) => {
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    if (!isValidSymbol(symbol)) {
      res.status(400).json({ error: 'Valid symbol required' });
      return;
    }
    try {
      const force = Boolean(req.body?.force);
      const out = await runAnnualReportDeepDive(
        store,
        fundamentalVault,
        regulatoryKb,
        symbol,
        force,
        parseBenchmarkFdRate()
      );
      res.json(out);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : `Annual report deep-dive failed for ${symbol}`,
      });
    }
  });

  // ---------------------------------------------------------------- Annual Report Analysis & Stock Intelligence Routes
  app.get('/api/annual-reports/universe', (req, res) => {
    try {
      const equityOnly = req.query.equityOnly !== 'false';
      fundamentalMonitor.syncEntriesFromMarketAndVault(equityOnly);
      res.json(getAnnualReportUniverse(store, fundamentalVault, regulatoryKb, { equityOnly }));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to build annual report universe',
      });
    }
  });

  app.get('/api/annual-reports/strategic-outlook', (req, res) => {
    try {
      const equityOnly = req.query.equityOnly !== 'false';
      fundamentalMonitor.syncEntriesFromMarketAndVault(equityOnly);
      res.json(
        buildStrategicOutlookHeatmap(store, fundamentalVault, regulatoryKb, {
          equityOnly,
          benchmarkFdRatePct: parseBenchmarkFdRate(),
        })
      );
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to build Strategic Outlook Heat Map',
      });
    }
  });

  app.get('/api/annual-reports/company/:symbol', (req, res) => {
    try {
      const symbol = String(req.params.symbol || '').trim().toUpperCase();
      if (!isValidSymbol(symbol)) {
        res.status(400).json({ error: 'Invalid ticker symbol' });
        return;
      }
      const equityOnly = req.query.equityOnly !== 'false';
      const intel = buildAnnualReportIntelligence(store, fundamentalVault, regulatoryKb, symbol, {
        equityOnly,
        benchmarkFdRatePct: parseBenchmarkFdRate(),
      });
      if (!intel) {
        res.status(404).json({
          error: `No annual or quarterly financial ledger found in the knowledge base for ${symbol}.`,
        });
        return;
      }
      res.json(intel);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to analyze company annual reports',
      });
    }
  });

  app.post('/api/annual-reports/distill', async (req, res) => {
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    if (!isValidSymbol(symbol)) {
      res.status(400).json({ error: 'Valid ticker symbol required' });
      return;
    }
    const fiscalYear =
      typeof req.body?.fiscalYear === 'string' && req.body.fiscalYear.trim()
        ? req.body.fiscalYear.trim()
        : undefined;
    const force = Boolean(req.body?.force);
    try {
      const result = await distillAnnualReportWithAi(
        store,
        fundamentalVault,
        regulatoryKb,
        symbol,
        fiscalYear,
        force
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : `Annual report distillation failed for ${symbol}`,
      });
    }
  });

  app.post('/api/annual-reports/ingest', async (req, res) => {
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    if (!isValidSymbol(symbol)) {
      res.status(400).json({ error: 'Valid symbol required' });
      return;
    }
    try {
      const result = await ingestAndDistillAnnualReport(store, fundamentalVault, regulatoryKb, {
        symbol,
        fiscalYear: typeof req.body?.fiscalYear === 'string' ? req.body.fiscalYear.trim() : undefined,
        reportUrl:
          typeof req.body?.reportUrl === 'string' && req.body.reportUrl.trim()
            ? req.body.reportUrl.trim()
            : typeof req.body?.sourceUrl === 'string' && req.body.sourceUrl.trim()
              ? req.body.sourceUrl.trim()
              : undefined,
        fileName: typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : undefined,
        mimeType: typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim() : undefined,
        fileBase64: typeof req.body?.fileBase64 === 'string' ? req.body.fileBase64.trim() : undefined,
        rawText: typeof req.body?.rawText === 'string' ? req.body.rawText : undefined,
      });
      res.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Annual report upload/link distillation failed for ${symbol}`;
      const status =
        /unsupported|invalid|provide|exceeds|private|localhost|http/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  // ---------------------------------------------------------------- Hidden Gems & Regulatory Knowledge Base Routes
  app.get('/api/screener/hidden-gems', (req, res) => {
    try {
      const equityOnly = req.query.equityOnly !== 'false';
      const archetypeRaw =
        typeof req.query.archetype === 'string' && req.query.archetype.trim()
          ? req.query.archetype.trim()
          : 'all';
      const numOpt = (key: string): number | null => {
        const raw = req.query[key];
        if (typeof raw !== 'string' || !raw.trim()) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };

      const annualWeightRaw = numOpt('annualWeightPct');
      const annualWeightPct =
        annualWeightRaw !== null ? Math.max(0, Math.min(100, Math.round(annualWeightRaw))) : 70;

      fundamentalMonitor.syncEntriesFromMarketAndVault(equityOnly);
      const result = evaluateHiddenGems(store, fundamentalVault, regulatoryKb, {
        equityOnly,
        benchmarkFdRatePct: parseBenchmarkFdRate(),
        annualWeightPct,
        monitorStatusMap: fundamentalMonitor.getStatusMap(),
        archetype: archetypeRaw as HiddenGemArchetype | 'all',
        sector: typeof req.query.sector === 'string' ? req.query.sector : 'All',
        search: typeof req.query.search === 'string' ? req.query.search : '',
        minScore: numOpt('minScore'),
        minMos: numOpt('minMos'),
        maxPe: numOpt('maxPe'),
        maxPb: numOpt('maxPb'),
        minRoe: numOpt('minRoe'),
        maxNpl: numOpt('maxNpl'),
        beatsFdOnly: req.query.beatsFdOnly === 'true',
        onlyWithKb: req.query.onlyWithKb === 'true',
        investmentGradeOnly: req.query.investmentGradeOnly === 'true',
        excludeAlertsAndLockIn: req.query.excludeAlertsAndLockIn === 'true',
        requireAnnualReport: req.query.requireAnnualReport === 'true',
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to evaluate hidden gems',
      });
    }
  });

  app.get('/api/screener/knowledge-base', (req, res) => {
    try {
      const agencyRaw =
        typeof req.query.agency === 'string' ? req.query.agency.trim().toUpperCase() : 'ALL';
      const agency =
        agencyRaw === 'ALL' || ALL_AGENCIES.includes(agencyRaw as RegulatoryAgency)
          ? (agencyRaw as RegulatoryAgency | 'ALL')
          : 'ALL';
      const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
      res.json(regulatoryKb.queryKnowledgeBase({ agency, symbol, q }));
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to query regulatory knowledge base',
      });
    }
  });

  app.post('/api/screener/knowledge-base/harvest', async (req, res) => {
    try {
      const rawAgencies = Array.isArray(req.body?.agencies)
        ? req.body.agencies
            .map((a: unknown) => String(a || '').trim().toUpperCase())
            .filter((a: string): a is RegulatoryAgency => ALL_AGENCIES.includes(a as RegulatoryAgency))
        : ALL_AGENCIES;
      const out = await regulatoryKb.harvestAgencies(
        rawAgencies.length > 0 ? rawAgencies : ALL_AGENCIES,
        store
      );
      res.json(out);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to harvest regulatory knowledge base',
      });
    }
  });

  app.post('/api/screener/knowledge-base/enrich', async (req, res) => {
    try {
      const force = Boolean(req.body?.force);
      const todayNpt = getNepalDateStr();
      let symbols: string[] = Array.isArray(req.body?.symbols)
        ? req.body.symbols
            .map((s: unknown) => String(s || '').trim().toUpperCase())
            .filter(isValidSymbol)
        : [];

      if (symbols.length === 0) {
        const equityOnly = req.body?.equityOnly !== false;
        const gemsResp = evaluateHiddenGems(store, fundamentalVault, regulatoryKb, {
          equityOnly,
          benchmarkFdRatePct: parseBenchmarkFdRate(),
          monitorStatusMap: fundamentalMonitor.getStatusMap(),
        });
        const withoutKb = gemsResp.gems
          .filter((g) => !g.kbEntry && (force || !regulatoryKb.hasDailySearchForDate(g.symbol, todayNpt)))
          .slice(0, 5);
        const notSearchedToday = gemsResp.gems
          .filter((g) => force || !regulatoryKb.hasDailySearchForDate(g.symbol, todayNpt))
          .slice(0, 5);
        symbols = (
          withoutKb.length > 0
            ? withoutKb
            : notSearchedToday.length > 0
              ? notSearchedToday
              : gemsResp.gems.slice(0, 5)
        ).map((g) => g.symbol);
      }

      if (symbols.length === 0) {
        res.status(400).json({ error: 'No eligible symbols found to enrich' });
        return;
      }

      const skippedSymbols = force
        ? []
        : symbols.filter((sym) => regulatoryKb.hasDailySearchForDate(sym, todayNpt));
      const targetSymbols = force
        ? symbols
        : symbols.filter((sym) => !regulatoryKb.hasDailySearchForDate(sym, todayNpt));

      if (targetSymbols.length === 0) {
        const existingEntries = skippedSymbols
          .map((sym) => regulatoryKb.getCompanyEntry(sym))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        res.json({
          updated: existingEntries,
          skippedToday: true,
          skippedSymbols,
          warnings: [
            `Already searched/enriched today (${todayNpt} NPT) for ${skippedSymbols.join(', ')}; skipped repeat crawl.`,
          ],
          summary: regulatoryKb.getSummary(),
        });
        return;
      }

      const out = await regulatoryKb.enrichCompanies(targetSymbols, store, fundamentalVault);
      for (const entry of out.updated) {
        regulatoryKb.markDailySymbolSearched(entry.symbol, todayNpt);
      }
      const cfg = scheduler.getStatus().config;
      let githubPushed = false;
      let githubPushMessage: string | undefined;
      if (out.updated.length > 0 && cfg.autoPushOnSearchUpdate && cfg.pushToGitHub) {
        const pushRes = await scheduler.triggerAutoGitHubPush(
          'kb',
          `chore(kb): enrich ${out.updated.map((e) => e.symbol).join(', ')} (${todayNpt})`
        );
        githubPushed = pushRes.committed;
        githubPushMessage = pushRes.message;
      }
      res.json({
        ...out,
        skippedToday: false,
        skippedSymbols,
        githubPushed,
        githubPushMessage,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to enrich companies from regulatory KB',
      });
    }
  });

  app.post('/api/knowledge-base/crawl-all', async (req, res) => {
    try {
      const rawAgencies = Array.isArray(req.body?.agencies)
        ? req.body.agencies
            .map((a: unknown) => String(a || '').trim().toUpperCase())
            .filter((a: string): a is RegulatoryAgency => ALL_AGENCIES.includes(a as RegulatoryAgency))
        : ALL_AGENCIES;
      const agencies = rawAgencies.length > 0 ? rawAgencies : ALL_AGENCIES;

      const enrichLimit = Math.max(
        0,
        Math.min(12, Number.isFinite(Number(req.body?.enrichLimit)) ? Number(req.body.enrichLimit) : 6)
      );
      const annualDistillLimit = Math.max(
        0,
        Math.min(
          6,
          Number.isFinite(Number(req.body?.annualDistillLimit))
            ? Number(req.body.annualDistillLimit)
            : 2
        )
      );
      const includeQuarterly = req.body?.includeQuarterly !== false;
      const equityOnly = req.body?.equityOnly !== false;
      const force = Boolean(req.body?.force);

      const explicitSymbols: string[] = Array.isArray(req.body?.symbols)
        ? req.body.symbols
            .map((s: unknown) => String(s || '').trim().toUpperCase())
            .filter(isValidSymbol)
        : [];

      const out = await runDailyKbPipeline({
        agencies,
        enrichLimit,
        annualDistillLimit,
        includeQuarterly,
        equityOnly,
        symbols: explicitSymbols,
        force,
        trigger: 'manual',
      });

      res.json(out);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to crawl regulatory, annual, and quarterly knowledge base',
      });
    }
  });

  // ---------------------------------------------------------------- Gemini Search Grounded Research
  app.post('/api/research/macro', async (req, res) => {
    try {
      const force = Boolean(req.body?.force);
      const data = await generateMacroResearch(store, force);
      res.json(data);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to fetch Nepal & global macro research',
      });
    }
  });

  app.post('/api/research/stock', async (req, res) => {
    const started = Date.now();
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    try {
      const force = Boolean(req.body?.force);
      const nDays = req.body?.nDays ? Math.max(5, Math.min(250, Number(req.body.nDays))) : 20;
      if (!symbol) {
        res.status(400).json({ error: 'Symbol is required' });
        return;
      }

      const todayNpt = getNepalDateStr();
      const cfg = scheduler.getStatus().config;
      const alreadySearchedInKbToday = regulatoryKb.hasDailySearchForDate(symbol, todayNpt);

      const data = await generateStockResearch(store, symbol, force, nDays);

      // Once-a-day skip: already researched & indexed in KB today -> skip repeat crawl & GitHub push
      if (!force && data.skippedToday && alreadySearchedInKbToday) {
        res.json({
          ...data,
          skippedToday: true,
          searchedDate: todayNpt,
          kbUpdated: false,
          githubPushed: false,
        });
        return;
      }

      // First search today (or forced refresh): sync findings into Knowledge Base
      regulatoryKb.recordStockSearchToKb({
        store,
        vault: fundamentalVault,
        research: data,
        dateStr: todayNpt,
      });

      if (cfg.autoCrawlOnSearch && regulatoryKb.isGeminiConfigured()) {
        const existingKb = regulatoryKb.getCompanyEntry(symbol);
        const needsRatingEnrich =
          force ||
          !existingKb ||
          !existingKb.creditRating.ratingGrade ||
          existingKb.updatedAt.slice(0, 10) !== todayNpt;
        if (needsRatingEnrich) {
          try {
            await regulatoryKb.enrichCompanies([symbol], store, fundamentalVault);
            regulatoryKb.recordStockSearchToKb({
              store,
              vault: fundamentalVault,
              research: data,
              dateStr: todayNpt,
            });
          } catch {
            // Do not fail stock research response if secondary KB enrichment hits quota/network limits
          }
        }
      }

      regulatoryKb.markDailySymbolSearched(symbol, todayNpt);
      scheduler.recordExternalLog({
        trigger: 'search',
        status: 'success',
        tradingDate: todayNpt,
        rowsSaved: 1,
        durationMs: Date.now() - started,
        message: `Searched ${symbol} & updated Knowledge Base (${todayNpt}).`,
      });

      let githubPushed = false;
      let githubPushMessage: string | undefined;
      if (cfg.autoPushOnSearchUpdate && cfg.pushToGitHub) {
        const pushRes = await scheduler.triggerAutoGitHubPush(
          'search',
          `chore(kb): update ${symbol} stock research & knowledge base (${todayNpt})`
        );
        githubPushed = pushRes.committed;
        githubPushMessage = pushRes.message;
      }

      res.json({
        ...data,
        searchedDate: todayNpt,
        kbUpdated: true,
        githubPushed,
        githubPushMessage,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to fetch stock risks and opportunities',
      });
    }
  });

  // ---------------------------------------------------------------- Risk & Opportunity Intelligence Routes
  app.get('/api/risk/technical', (req, res) => {
    const dates = store.getDates();
    const day =
      typeof req.query.day === 'string' && isValidDateStr(req.query.day)
        ? req.query.day
        : dates[dates.length - 1];
    const nDays = req.query.nDays ? Math.max(5, Math.min(250, Number(req.query.nDays))) : 20;
    const equityOnly = req.query.equityOnly !== 'false';
    res.json(computeTechnicalRiskRows(store, day, nDays, equityOnly));
  });

  app.get('/api/risk/fundamental', (req, res) => {
    const dates = store.getDates();
    const day =
      typeof req.query.day === 'string' && isValidDateStr(req.query.day)
        ? req.query.day
        : dates[dates.length - 1];
    const equityOnly = req.query.equityOnly !== 'false';
    res.json(getFundamentallyRiskyStocks(store, day, equityOnly));
  });

  app.get('/api/risk/do-not-buy', (req, res) => {
    const dates = store.getDates();
    const day =
      typeof req.query.day === 'string' && isValidDateStr(req.query.day)
        ? req.query.day
        : dates[dates.length - 1];
    const nDays = req.query.nDays ? Math.max(5, Math.min(250, Number(req.query.nDays))) : 20;
    const equityOnly = req.query.equityOnly !== 'false';
    res.json(getCompositeDoNotBuyStocks(store, day, nDays, equityOnly));
  });

  app.get('/api/risk/opportunity-vs-risk', (req, res) => {
    const dates = store.getDates();
    const day =
      typeof req.query.day === 'string' && isValidDateStr(req.query.day)
        ? req.query.day
        : dates[dates.length - 1];
    const nDays = req.query.nDays ? Math.max(5, Math.min(250, Number(req.query.nDays))) : 20;
    const equityOnly = req.query.equityOnly !== 'false';
    res.json(getMarketOpportunityVsRisk(store, day, nDays, equityOnly));
  });

  app.post('/api/risk/audit-batch', async (req, res) => {
    try {
      const symbols = Array.isArray(req.body?.symbols)
        ? req.body.symbols.map((s: unknown) => String(s || ''))
        : [];
      const nDays = req.body?.nDays ? Math.max(5, Math.min(250, Number(req.body.nDays))) : 20;
      if (symbols.length === 0) {
        res.status(400).json({ error: 'Provide at least one stock symbol to audit' });
        return;
      }
      const data = await auditCohortStocks(store, symbols, nDays);
      res.json(data);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Batch fundamental audit failed',
      });
    }
  });

  // ---------------------------------------------------------------- ShareSansar & Scheduler Routes
  app.get('/api/scheduler/status', (_req, res) => {
    res.json({
      ...scheduler.getStatus(),
      backfill: scheduler.getBackfillStatus(),
    });
  });

  app.put('/api/scheduler/config', (req, res) => {
    try {
      const config = scheduler.updateConfig(req.body ?? {});
      res.json({
        config,
        nextRunIso: scheduler.computeNextRunIso(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid scheduler configuration' });
    }
  });

  app.post('/api/scraper/latest', async (_req, res) => {
    const entry = await scheduler.pullLatest('manual', false);
    invalidateQuantFeedCache();
    res.json({
      entry,
      status: scheduler.getStatus(),
    });
  });

  app.get('/api/github/account', async (_req, res) => {
    try {
      const info = await getGitHubAccount();
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to inspect GitHub account' });
    }
  });

  app.post('/api/github/push-project', async (req, res) => {
    const started = Date.now();
    try {
      const { repo, branch, isPrivate } = req.body ?? {};
      const result = await pushProjectToGitHub(__dirname, {
        repo: String(repo || ''),
        branch: typeof branch === 'string' && branch.trim() ? branch.trim() : 'main',
        isPrivate: Boolean(isPrivate),
      });
      scheduler.updateConfig({
        githubRepo: result.repoFullName,
        githubBranch: result.branch,
        githubDataPath: 'data',
        sourceMode: 'github',
        pushToGitHub: false,
      });
      scheduler.recordExternalLog({
        trigger: 'github',
        status: 'success',
        tradingDate: null,
        rowsSaved: result.filesUploaded,
        durationMs: Date.now() - started,
        message: `Pushed ${result.filesUploaded} project file(s) to ${result.repoFullName}@${result.branch}.`,
      });
      res.json({ result, status: scheduler.getStatus() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Push failed';
      scheduler.recordExternalLog({
        trigger: 'github',
        status: 'error',
        tradingDate: null,
        rowsSaved: 0,
        durationMs: Date.now() - started,
        message: `Project push failed: ${msg}`,
      });
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/github/sync', async (req, res) => {
    const force = Boolean(req.body?.force);
    const entry = await scheduler.syncGitHubNow(force);
    invalidateQuantFeedCache();
    res.json({
      entry,
      status: scheduler.getStatus(),
    });
  });

  app.post('/api/github/push-data', async (req, res) => {
    try {
      const msg =
        typeof req.body?.commitMessage === 'string' && req.body.commitMessage.trim()
          ? req.body.commitMessage.trim()
          : undefined;
      const result = await scheduler.pushDataToGitHubNow('manual', msg);
      res.json({
        result,
        status: scheduler.getStatus(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to push data directory to GitHub',
      });
    }
  });

  app.post('/api/github/workflow-dispatch', async (req, res) => {
    try {
      const { repo, workflowFile, branch } = req.body ?? {};
      const status = scheduler.getStatus();
      const targetRepo = String(repo || status.config.githubRepo || '').trim();
      const targetBranch = String(branch || status.config.githubBranch || 'main').trim();
      const file = String(workflowFile || 'daily-sharesansar.yml').trim();
      const result = await dispatchGitHubWorkflow(targetRepo, file, targetBranch);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Workflow dispatch failed' });
    }
  });

  app.post('/api/scraper/backfill', (req, res) => {
    try {
      const { from, to, force } = req.body ?? {};
      const bf = scheduler.startBackfill(String(from || ''), String(to || ''), Boolean(force));
      res.json(bf);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid backfill request' });
    }
  });

  app.get('/api/scraper/backfill/status', (_req, res) => {
    res.json(scheduler.getBackfillStatus());
  });

  app.post('/api/data/upload', (req, res) => {
    const { files } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0 || files.length > 90) {
      res.status(400).json({ error: 'Provide between 1 and 90 CSV files' });
      return;
    }

    let totalRows = 0;
    let savedFiles = 0;
    const errors: string[] = [];

    for (const file of files) {
      const filename = String(file?.name || '').trim();
      const content = String(file?.content || '');
      const dateStr = filename.replace(/\.csv$/i, '');
      if (!isValidDateStr(dateStr)) {
        errors.push(`${filename}: filename must be YYYY-MM-DD.csv`);
        continue;
      }
      const rows = store.parseCsvContent(content, dateStr);
      if (rows.length === 0) {
        errors.push(`${filename}: no valid price rows parsed`);
        continue;
      }
      totalRows += store.saveDayRows(dateStr, rows);
      savedFiles++;
    }

    if (savedFiles > 0) {
      invalidateQuantFeedCache();
      scheduler.recordExternalLog({
        trigger: 'upload',
        status: errors.length > 0 ? 'error' : 'success',
        tradingDate: `${savedFiles} file(s)`,
        rowsSaved: totalRows,
        durationMs: 0,
        message: `Imported ${totalRows} rows across ${savedFiles} CSV file(s).${errors.length ? ` Errors: ${errors.join('; ')}` : ''}`,
      });
    }

    res.json({ savedFiles, totalRows, errors });
  });

  app.delete('/api/data/:date', (req, res) => {
    const { date } = req.params;
    if (!isValidDateStr(date)) {
      res.status(400).json({ error: 'Invalid date format' });
      return;
    }
    const deleted = store.deleteDate(date);
    invalidateQuantFeedCache();
    res.json({ deleted, dates: store.getDates() });
  });

  // ---------------------------------------------------------------- Vite / Static Serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NEPSE Turnover & Scanner Workbench running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
