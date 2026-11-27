import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getGitHubAccount, pushProjectToGitHub } from './server/githubSync.ts';
import { isValidDateStr, MarketStore } from './server/marketStore.ts';
import {
  auditCohortStocks,
  generateMacroResearch,
  generateStockResearch,
} from './server/researchAi.ts';
import {
  computeTechnicalRiskRows,
  getCompositeDoNotBuyStocks,
  getFundamentallyRiskyStocks,
  getMarketOpportunityVsRisk,
} from './server/riskEngine.ts';
import { runQuantAnalysis, runQuantBacktest } from './server/quantEngine.ts';
import { DailyScheduler } from './server/scheduler.ts';
import type { ScannerKind } from './src/types/market.ts';
import type { QuantEngineConfig } from './src/types/quant.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.NEPSE_DATA
  ? path.resolve(process.env.NEPSE_DATA)
  : path.resolve(__dirname, 'data');

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
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  const store = new MarketStore(DATA_DIR);
  const scheduler = new DailyScheduler(store);

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
    try {
      const symbol = String(req.body?.symbol || '').trim();
      const force = Boolean(req.body?.force);
      const nDays = req.body?.nDays ? Math.max(5, Math.min(250, Number(req.body.nDays))) : 20;
      if (!symbol) {
        res.status(400).json({ error: 'Symbol is required' });
        return;
      }
      const data = await generateStockResearch(store, symbol, force, nDays);
      res.json(data);
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
    res.json({
      entry,
      status: scheduler.getStatus(),
    });
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
    res.json({ deleted, dates: store.getDates() });
  });

  // ---------------------------------------------------------------- Vite / Static Serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
