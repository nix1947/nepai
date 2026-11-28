import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildAnnualReportIntelligence,
  getAnnualReportUniverse,
  ingestAndDistillAnnualReport,
} from '../server/fundamental/annualReportIntelEngine.ts';
import {
  buildCompanyValuationDossier,
  getValuationUniverseSummary,
} from '../server/fundamental/annualValuationEngine.ts';
import { computeComingQuarterOutlook } from '../server/fundamental/comingQuarterOutlook.ts';
import { FundamentalMonitorService } from '../server/fundamental/fundamentalCollector.ts';
import {
  buildSpreadsheetExport,
  computeGrowthComparisons,
  computeQ4ThreeYearBenchmark,
  FundamentalVault,
  normalizeShareSansarSnapshot,
} from '../server/fundamental/fundamentalVault.ts';
import { buildExplorerOverview } from '../server/fundamental/explorerEngine.ts';
import { evaluateHiddenGems } from '../server/fundamental/hiddenGemsEngine.ts';
import { evaluateScreenerUniverse } from '../server/fundamental/investorScoringEngine.ts';
import { computeMasterScreener } from '../server/fundamental/masterScreenerEngine.ts';
import {
  getActiveNepalFiscalQuarter,
  getNepalFiscalYearCalendarContext,
  getUpcomingNepalFiscalQuarter,
  parseNepalPeriodLabel,
} from '../server/fundamental/nepalCalendar.ts';
import { RegulatoryKnowledgeBase } from '../server/fundamental/regulatoryKnowledgeBase.ts';
import { computeSectorRotation } from '../server/fundamental/sectorRotationEngine.ts';
import { computeSectorValuation } from '../server/fundamental/sectorMethodology.ts';
import { computeSignalScorecard } from '../server/fundamental/signalScorecardEngine.ts';
import { buildStrategicOutlookHeatmap } from '../server/fundamental/strategicOutlookEngine.ts';
import { MarketStore } from '../server/marketStore.ts';
import {
  buildFinancialCsv,
  mergeFinancialSnapshots,
  type CompanyFinancialSnapshot,
} from '../server/financialScraper.ts';
import { DailyScheduler } from '../server/scheduler.ts';
import { evaluateLatestHtml } from '../server/scraper.ts';
import type { PriceRow } from '../src/types/market.ts';
import { applyCorporateActionAdjustments } from '../src/utils/adjustedPrices.ts';

test('Nepal BS fiscal quarter parsing & quarter-end + 15-day trigger window', () => {
  const parsedQ1 = parseNepalPeriodLabel('1st Quarter 2083/2084');
  assert.ok(parsedQ1);
  assert.equal(parsedQ1.fiscalYear, '2083/84');
  assert.equal(parsedQ1.quarter, 'Q1');
  assert.equal(parsedQ1.periodLabel, 'Q1 FY 2083/84');

  // Q1 FY 2083/84 ends ~2026-10-17 -> check starts 2026-11-01 (+15d)
  const beforeDue = getActiveNepalFiscalQuarter(new Date('2026-10-25T00:00:00Z'), 15);
  assert.equal(beforeDue.fiscalYear, '2083/84');
  assert.equal(beforeDue.quarter, 'Q1');
  assert.equal(beforeDue.isDueNow, false);

  const afterDue = getActiveNepalFiscalQuarter(new Date('2026-11-10T00:00:00Z'), 15);
  assert.equal(afterDue.fiscalYear, '2083/84');
  assert.equal(afterDue.quarter, 'Q1');
  assert.equal(afterDue.isDueNow, true);

  const upcoming = getUpcomingNepalFiscalQuarter(new Date('2026-11-27T00:00:00Z'), 15);
  assert.equal(upcoming.fiscalYear, '2083/84');
  assert.equal(upcoming.quarter, 'Q2');
  assert.equal(upcoming.checkStartDate, '2027-01-29');
  assert.equal(upcoming.isDueNow, false);
});

test('ShareSansar snapshot normalization scales Rs in 000 cleanly while keeping per-share units intact', () => {
  const mockSnap: CompanyFinancialSnapshot = {
    symbol: 'NABIL',
    companyName: 'Nabil Bank Limited',
    sector: 'Commercial Banks',
    companyId: '1',
    scrapedAt: '2026-11-15T06:00:00.000Z',
    sourceUrl: 'https://www.sharesansar.com/company/nabil',
    periods: ['1st Quarter 2083/2084'],
    tabs: [
      {
        key: 'balance_sheet',
        title: "Balance Sheet (Rs. in '000)",
        headers: ["Particulars (Rs. in '000)", '1st Quarter 2083/2084'],
        rows: [
          {
            section: 'Equity',
            isSectionHeader: false,
            particulars: "Total Shareholder's Equity",
            values: ['62,000,000'],
            numericValues: [62_000_000],
          },
          {
            section: 'Assets',
            isSectionHeader: false,
            particulars: 'Total Assets',
            values: ['580,000,000'],
            numericValues: [580_000_000],
          },
          {
            section: 'Liabilities',
            isSectionHeader: false,
            particulars: 'Total Liabilities',
            values: ['518,000,000'],
            numericValues: [518_000_000],
          },
        ],
      },
      {
        key: 'key_metrics',
        title: 'Key Metrics',
        headers: ['Particulars', '1st Quarter 2083/2084'],
        rows: [
          {
            section: 'Valuation',
            isSectionHeader: false,
            particulars: 'Basic Earnings Per Share',
            values: ['28.5'],
            numericValues: [28.5],
          },
          {
            section: 'Valuation',
            isSectionHeader: false,
            particulars: 'Net Worth Per Share',
            values: ['229.0'],
            numericValues: [229.0],
          },
          {
            section: 'Profitability',
            isSectionHeader: false,
            particulars: 'Return on Equity',
            values: ['14.2'],
            numericValues: [14.2],
          },
          {
            section: 'Quality',
            isSectionHeader: false,
            particulars: 'Non-Performing Loan (NPL) Ratio',
            values: ['2.4'],
            numericValues: [2.4],
          },
        ],
      },
    ],
  };

  const records = normalizeShareSansarSnapshot(mockSnap);
  assert.equal(records.length, 1);
  const r = records[0];
  assert.equal(r.metrics.eps.value, 28.5);
  assert.equal(r.metrics.bvps.value, 229.0);
  assert.equal(r.metrics.netWorth.value, 62_000_000_000);
  assert.equal(r.metrics.debtToEquity.value, null); // BFI should never apply industrial D/E
  assert.equal(r.validationStatus, 'Verified');
});

test('Vault deduplicates (symbol, fiscalYear, quarter), calculates YoY/QoQ/3Y/5Y CAGR, and runs 9-investor screening', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-fund-test-'));
  try {
    // Create minimal daily price CSV so MarketOverlay works
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-15.csv'),
      'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low\nSHIVM,Shivam Cements Ltd.,510,525,505,520,512,8,1.56,50000,26000000,520,690,460\n',
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);

    const makeQ = (fy: string, qtrLabel: string, eps: number, profitCr: number, revCr: number): CompanyFinancialSnapshot => ({
      symbol: 'SHIVM',
      companyName: 'Shivam Cements Ltd.',
      sector: 'Manufacturing and Processing',
      companyId: '99',
      scrapedAt: '2026-11-15T06:00:00.000Z',
      sourceUrl: 'https://www.sharesansar.com/company/shivm',
      periods: [`${qtrLabel} ${fy}`],
      tabs: [
        {
          key: 'profit_loss',
          title: 'Profit and Loss',
          headers: ["Particulars (Rs. in '000)", `${qtrLabel} ${fy}`],
          rows: [
            { section: 'Income', isSectionHeader: false, particulars: 'Revenue', values: [String(revCr * 10_000)], numericValues: [revCr * 10_000] },
            { section: 'Income', isSectionHeader: false, particulars: 'Operating Profit', values: [String(profitCr * 13_000)], numericValues: [profitCr * 13_000] },
            { section: 'Profit', isSectionHeader: false, particulars: 'Profit for the period', values: [String(profitCr * 10_000)], numericValues: [profitCr * 10_000] },
            { section: 'Cash', isSectionHeader: false, particulars: 'Cash Flow from Operating Activities', values: [String(profitCr * 11_000)], numericValues: [profitCr * 11_000] },
          ],
        },
        {
          key: 'balance_sheet',
          title: 'Balance Sheet',
          headers: ["Particulars (Rs. in '000)", `${qtrLabel} ${fy}`],
          rows: [
            { section: 'Equity', isSectionHeader: false, particulars: "Total Shareholder's Equity", values: ['10000000'], numericValues: [10_000_000] },
            { section: 'Equity', isSectionHeader: false, particulars: 'Share Capital', values: ['5000000'], numericValues: [5_000_000] },
            { section: 'Equity', isSectionHeader: false, particulars: 'Reserves', values: ['5000000'], numericValues: [5_000_000] },
            { section: 'Debt', isSectionHeader: false, particulars: 'Long Term Debt', values: ['1500000'], numericValues: [1_500_000] },
            { section: 'Assets', isSectionHeader: false, particulars: 'Total Assets', values: ['13500000'], numericValues: [13_500_000] },
            { section: 'Liabilities', isSectionHeader: false, particulars: 'Total Liabilities', values: ['3500000'], numericValues: [3_500_000] },
          ],
        },
        {
          key: 'key_metrics',
          title: 'Key Metrics',
          headers: ['Particulars', `${qtrLabel} ${fy}`],
          rows: [
            { section: 'Ratios', isSectionHeader: false, particulars: 'Basic Earnings Per Share', values: [String(eps)], numericValues: [eps] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Net Worth Per Share', values: ['200'], numericValues: [200] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Return on Equity', values: ['19.5'], numericValues: [19.5] },
          ],
        },
      ],
    });

    for (const [fy, qLabel, eps, pCr, rCr] of [
      ['2078/79', '1st Quarter', 18, 90, 500],
      ['2080/81', '1st Quarter', 24, 120, 620],
      ['2082/83', '1st Quarter', 31, 155, 760],
      ['2082/83', '4th Quarter', 33, 165, 810],
      ['2083/84', '1st Quarter', 36, 180, 880],
    ] as const) {
      for (const rec of normalizeShareSansarSnapshot(makeQ(fy, qLabel, eps, pCr, rCr))) {
        vault.upsertStatementRecord(rec);
      }
    }
    // Duplicate upsert of 2083/84 Q1 should not create a duplicate row
    for (const rec of normalizeShareSansarSnapshot(makeQ('2083/84', '1st Quarter', 36, 180, 880))) {
      vault.upsertStatementRecord(rec);
    }

    const ledger = vault.getCompanyLedger('SHIVM')!;
    assert.equal(ledger.records.length, 5);

    const growth = computeGrowthComparisons(ledger.records);
    assert.ok(growth.epsYoyPct !== null && growth.epsYoyPct > 15);
    assert.ok(growth.epsQoqPct !== null && growth.epsQoqPct > 5);
    assert.ok(growth.epsCagr3yPct !== null && growth.epsCagr3yPct > 10);
    assert.ok(growth.epsCagr5yPct !== null && growth.epsCagr5yPct > 10);

    const valuation = computeSectorValuation({
      record: ledger.records[0],
      growth,
      currentPrice: 520,
      benchmarkFdRatePct: 6.5,
    });
    assert.ok(valuation.intrinsicValue !== null && valuation.intrinsicValue > 520);
    assert.ok(valuation.earningsYieldPct !== null && valuation.earningsYieldPct > 0);

    const evaluated = evaluateScreenerUniverse(store, vault, { equityOnly: true });
    assert.equal(evaluated.rows.length, 1);
    const row = evaluated.rows[0];
    assert.equal(row.symbol, 'SHIVM');
    assert.ok(row.passedInvestorCount >= 5);
    assert.ok(row.scores.overallScore >= 60);
    assert.equal(row.keyMetrics.periodsAvailable, 5);
    assert.equal(row.keyMetrics.prevPeriodLabel, 'Q4 FY 2082/83');
    assert.equal(row.keyMetrics.prevEps, 33);
    assert.equal(row.keyMetrics.prevNetProfitCr, 165);
    assert.ok(row.keyMetrics.epsQoqPct !== null && row.keyMetrics.epsQoqPct > 8);
    assert.ok(row.keyMetrics.netProfitQoqPct !== null && row.keyMetrics.netProfitQoqPct > 8);
    assert.equal(row.keyMetrics.roeQoqDeltaPct, 0);
    assert.equal(row.keyMetrics.yoyPeriodLabel, 'Q1 FY 2082/83');
    assert.equal(row.keyMetrics.yoyEps, 31);
    assert.equal(row.keyMetrics.yoyNetProfitCr, 155);
    assert.equal(row.keyMetrics.yoyRevenueCr, 760);
    assert.equal(row.keyMetrics.trends.periods.length, 5);
    assert.equal(row.keyMetrics.trends.periods[0], 'Q1 FY 2078/79');
    assert.equal(row.keyMetrics.trends.periods[4], 'Q1 FY 2083/84');
    assert.deepEqual(row.keyMetrics.trends.eps, [18, 24, 31, 33, 36]);
    assert.deepEqual(row.keyMetrics.trends.revenueCr, [500, 620, 760, 810, 880]);
    assert.deepEqual(row.keyMetrics.trends.netProfitCr, [90, 120, 155, 165, 180]);

    const excel = buildSpreadsheetExport('excel', [
      {
        name: 'Screener',
        headers: ['Symbol', 'Score'],
        rows: [[row.symbol, row.scores.overallScore]],
      },
    ]);
    assert.equal(excel.extension, 'xls');
    assert.ok(excel.body.includes('<Workbook'));
    assert.ok(excel.body.includes('SHIVM'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hasQuarterData and FundamentalMonitorService skip scraping when current quarter data already exists', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-skip-test-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-26.csv'),
      'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low\nNABIL,Nabil Bank Limited,500,510,498,505,500,5,1.0,10000,5050000,505,560,440\n',
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    const activeQ = getActiveNepalFiscalQuarter(new Date(), 15);

    const snap: CompanyFinancialSnapshot = {
      symbol: 'NABIL',
      companyName: 'Nabil Bank Limited',
      sector: 'Commercial Banks',
      companyId: '16',
      scrapedAt: new Date().toISOString(),
      sourceUrl: 'https://www.sharesansar.com/company/nabil',
      periods: [
        `${activeQ.quarter === 'Q1' ? '1st' : activeQ.quarter === 'Q2' ? '2nd' : activeQ.quarter === 'Q3' ? '3rd' : '4th'} Quarter ${activeQ.fiscalYear}`,
      ],
      tabs: [
        {
          key: 'key_metrics',
          title: 'Key Metrics',
          headers: ['Particulars', `Quarter ${activeQ.fiscalYear}`],
          rows: [
            {
              section: 'Valuation',
              isSectionHeader: false,
              particulars: 'Basic Earnings Per Share',
              values: ['30.34'],
              numericValues: [30.34],
            },
          ],
        },
      ],
    };

    for (const rec of normalizeShareSansarSnapshot(snap)) {
      vault.upsertStatementRecord(rec);
    }

    assert.equal(vault.hasQuarterData('NABIL', activeQ.fiscalYear, activeQ.quarter), true);
    assert.equal(vault.hasQuarterData('ADBL', activeQ.fiscalYear, activeQ.quarter), false);

    const monitor = new FundamentalMonitorService(store, vault, { enableCron: false });
    const res = await monitor.refreshSymbol('NABIL', 'manual-single', false, {
      force: false,
      fiscalYear: activeQ.fiscalYear,
      quarter: activeQ.quarter,
    });
    assert.equal(res.skipped, true);
    assert.equal(res.periodsAdded, 0);

    const batch = monitor.startBatchRefresh('all', false);
    assert.equal(batch.active, false);
    assert.equal(batch.total, 0);
    assert.equal(batch.skipped, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('mergeFinancialSnapshots + buildFinancialCsv + writeConsolidatedQuarterlyCsv combine upcoming and existing quarters cleanly', () => {
  const existing: CompanyFinancialSnapshot = {
    symbol: 'NABIL',
    companyName: 'Nabil Bank Limited',
    sector: 'Commercial Bank',
    companyId: '16',
    scrapedAt: '2026-11-27T05:00:00Z',
    sourceUrl: 'https://www.sharesansar.com/company/nabil',
    periods: ['1st Quarter 2083/2084', '4th Quarter 2082/2083'],
    tabs: [
      {
        key: 'profit',
        title: 'PROFIT AND LOSS',
        headers: ['Particulars', '1st Quarter 2083/2084', '4th Quarter 2082/2083'],
        rows: [
          {
            section: 'General',
            isSectionHeader: false,
            particulars: 'Net Profit',
            values: ['2,555,104.00', '7,100,000.00'],
            numericValues: [2555104, 7100000],
          },
        ],
      },
      {
        key: 'ratios',
        title: 'KEY RATIOS',
        headers: ['Particulars', '1st Quarter 2083/2084', '4th Quarter 2082/2083'],
        rows: [
          {
            section: 'General',
            isSectionHeader: false,
            particulars: 'EPS (Annualized)',
            values: ['30.34', '26.50'],
            numericValues: [30.34, 26.5],
          },
        ],
      },
    ],
  };

  // ShareSansar returns only Q2 2083/84 when Q2 publishes (dropping older columns)
  const incomingQ2: CompanyFinancialSnapshot = {
    symbol: 'NABIL',
    companyName: 'Nabil Bank Limited',
    sector: 'Commercial Bank',
    companyId: '16',
    scrapedAt: '2027-02-01T05:00:00Z',
    sourceUrl: 'https://www.sharesansar.com/company/nabil',
    periods: ['2nd Quarter 2083/2084'],
    tabs: [
      {
        key: 'profit',
        title: 'PROFIT AND LOSS',
        headers: ['Particulars', '2nd Quarter 2083/2084'],
        rows: [
          {
            section: 'General',
            isSectionHeader: false,
            particulars: 'Net Profit',
            values: ['5,300,000.00'],
            numericValues: [5300000],
          },
        ],
      },
      {
        key: 'ratios',
        title: 'KEY RATIOS',
        headers: ['Particulars', '2nd Quarter 2083/2084'],
        rows: [
          {
            section: 'General',
            isSectionHeader: false,
            particulars: 'EPS (Annualized)',
            values: ['32.10'],
            numericValues: [32.1],
          },
        ],
      },
    ],
  };

  const merged = mergeFinancialSnapshots(existing, incomingQ2);
  assert.deepEqual(merged.periods, [
    '2nd Quarter 2083/2084',
    '1st Quarter 2083/2084',
    '4th Quarter 2082/2083',
  ]);
  const plRow = merged.tabs[0].rows[0];
  assert.deepEqual(plRow.values, ['5,300,000.00', '2,555,104.00', '7,100,000.00']);

  const csvText = buildFinancialCsv(merged);
  assert.ok(
    csvText.includes('Symbol,Tab,Section,Particulars,2nd Quarter 2083/2084,1st Quarter 2083/2084,4th Quarter 2082/2083')
  );
  assert.ok(csvText.includes('NABIL,PROFIT AND LOSS,General,Net Profit,"5,300,000.00","2,555,104.00","7,100,000.00"'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-vault-csv-'));
  try {
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();
    for (const rec of normalizeShareSansarSnapshot(merged)) {
      vault.upsertStatementRecord(rec);
    }
    const ledger = vault.getCompanyLedger('NABIL');
    assert.ok(ledger);
    assert.equal(ledger.records.length, 3);
    assert.equal(ledger.records[0].quarter, 'Q2');
    assert.equal(ledger.records[1].quarter, 'Q1');
    assert.equal(ledger.records[2].quarter, 'Q4');

    const masterCsvPath = vault.writeConsolidatedQuarterlyCsv();
    assert.ok(fs.existsSync(masterCsvPath));
    const masterCsv = fs.readFileSync(masterCsvPath, 'utf8');
    assert.ok(masterCsv.includes('NABIL,Nabil Bank Limited'));
    assert.ok(masterCsv.includes('Q2 FY 2083/84'));
    assert.ok(masterCsv.includes('Q1 FY 2083/84'));
    assert.ok(masterCsv.includes('Q4 FY 2082/83'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('evaluateLatestHtml handles market holidays and zero-data days without throwing', () => {
  const noRecordHtml = `
    <html><body>
      <h5>As of 2026-11-30</h5>
      <table id="headFixed"><thead><tr><th>Symbol</th><th>Close</th></tr></thead>
      <tbody><tr><td colspan="2">No Record Found</td></tr></tbody></table>
    </body></html>
  `;
  const noRec = evaluateLatestHtml(noRecordHtml);
  assert.equal(noRec.status, 'no_data');
  assert.equal(noRec.date, '2026-11-30');

  const zeroVolHtml = `
    <html><body>
      <h5>As of 2026-11-30</h5>
      <table id="headFixed">
        <thead><tr><th>Symbol</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>LTP</th><th>Vol</th><th>Prev Close</th><th>Turnover</th><th>Trans</th></tr></thead>
        <tbody><tr><td>NABIL</td><td>500</td><td>500</td><td>500</td><td>500</td><td>500</td><td>0</td><td>500</td><td>0</td><td>0</td></tr></tbody>
      </table>
    </body></html>
  `;
  const zeroVol = evaluateLatestHtml(zeroVolHtml);
  assert.equal(zeroVol.status, 'no_data');
  assert.match(zeroVol.reason, /Zero volume/i);

  const activeHtml = `
    <html><body>
      <h5>As of 2026-11-27</h5>
      <table id="headFixed">
        <thead><tr><th>Symbol</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>LTP</th><th>Vol</th><th>Prev Close</th><th>Turnover</th><th>Trans</th></tr></thead>
        <tbody><tr><td><a title="Nabil Bank">NABIL</a></td><td>510</td><td>515</td><td>505</td><td>512</td><td>512</td><td>12500</td><td>508</td><td>6400000</td><td>142</td></tr></tbody>
      </table>
    </body></html>
  `;
  const active = evaluateLatestHtml(activeHtml);
  assert.equal(active.status, 'ok');
  if (active.status === 'ok') {
    assert.equal(active.date, '2026-11-27');
    assert.equal(active.rows.length, 1);
    assert.equal(active.rows[0].symbol, 'NABIL');
  }
});

test('RegulatoryKnowledgeBase seeds from existing macro/intel caches without duplicating and supports filtering', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-kb-test-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '.macro-rates-cache.json'),
      JSON.stringify({
        generatedAt: '2026-11-20T00:00:00Z',
        regulatoryUpdates: [
          {
            authority: 'NRB',
            date: '2026-11-18',
            title: 'NRB eases working capital guidelines for BFIs',
            summary: 'Nepal Rastra Bank circular supports credit growth and NPL recovery across Class A banks.',
            impact: 'Positive',
            impactedSectors: ['Commercial Banks'],
          },
          {
            authority: 'NIA',
            date: '2026-11-19',
            title: 'Nepal Insurance Authority solvency directive Q1 2083/84',
            summary: 'NIA reinforces minimum solvency margin compliance for life and non-life insurers.',
            impact: 'Neutral',
            impactedSectors: ['Life Insurance', 'Non Life Insurance'],
          },
        ],
      }),
      'utf8'
    );

    fs.writeFileSync(
      path.join(tmpDir, '.fundamental-intel.json'),
      JSON.stringify({
        EBL: {
          symbol: 'EBL',
          companyName: 'Everest Bank Limited',
          sector: 'Commercial Banks',
          generatedAt: '2026-11-20T00:00:00Z',
          governanceRegulatoryFlags: ['NRB clean supervisory compliance with low NPL'],
          fundamentalRedFlags: [],
          macroLinkage: 'Beneficiary of easing credit rates.',
          sources: [{ title: 'ICRA Nepal Rating', uri: 'https://www.icranepal.com/ebl' }],
        },
      }),
      'utf8'
    );

    const kb1 = new RegulatoryKnowledgeBase(tmpDir);
    kb1.initIfNeeded();
    const initial = kb1.queryKnowledgeBase();
    assert.ok(initial.notices.length >= 2);
    assert.ok(initial.summary.totalCompaniesIndexed >= 1);
    assert.equal(kb1.getCompanyEntry('EBL')?.symbol, 'EBL');
    assert.equal(kb1.getCompanyEntry('EBL')?.citations[0]?.agency, 'ICRA');

    const nrbOnly = kb1.queryKnowledgeBase({ agency: 'NRB' });
    assert.equal(nrbOnly.notices.length, 1);
    assert.equal(nrbOnly.notices[0].agency, 'NRB');

    const eblOnly = kb1.queryKnowledgeBase({ symbol: 'ebl' });
    assert.equal(eblOnly.companies.length, 1);
    assert.equal(eblOnly.companies[0].symbol, 'EBL');

    // Re-loading from disk must not duplicate seeded notices or company records
    const kb2 = new RegulatoryKnowledgeBase(tmpDir);
    kb2.initIfNeeded();
    assert.equal(kb2.queryKnowledgeBase().notices.length, initial.notices.length);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('evaluateHiddenGems scores, classifies archetypes, and applies KB rating & lock-in filters', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-gems-test-'));
  try {
    // Two companies: EBL (clean high-ROE bank, low turnover rank, ICRA AA-) and HBL (flagged lock-in/alert)
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-27.csv'),
      [
        'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low',
        'EBL,Everest Bank Limited,540,548,536,545,540,5,0.93,12000,6540000,545,700,490',
        'HBL,Himalayan Bank Limited,215,218,210,212,216,-4,-1.85,18000,3816000,212,290,195',
      ].join('\n'),
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();

    const makeBankSnap = (
      symbol: string,
      companyName: string,
      fy: string,
      qLabel: string,
      eps: number,
      bvps: number,
      roe: number,
      npl: number
    ): CompanyFinancialSnapshot => ({
      symbol,
      companyName,
      sector: 'Commercial Banks',
      companyId: symbol === 'EBL' ? '10' : '11',
      scrapedAt: '2026-11-27T06:00:00.000Z',
      sourceUrl: `https://www.sharesansar.com/company/${symbol.toLowerCase()}`,
      periods: [`${qLabel} ${fy}`],
      tabs: [
        {
          key: 'balance_sheet',
          title: "Balance Sheet (Rs. in '000)",
          headers: ["Particulars (Rs. in '000)", `${qLabel} ${fy}`],
          rows: [
            { section: 'Equity', isSectionHeader: false, particulars: "Total Shareholder's Equity", values: ['25000000'], numericValues: [25_000_000] },
            { section: 'Assets', isSectionHeader: false, particulars: 'Total Assets', values: ['260000000'], numericValues: [260_000_000] },
            { section: 'Liabilities', isSectionHeader: false, particulars: 'Total Liabilities', values: ['235000000'], numericValues: [235_000_000] },
          ],
        },
        {
          key: 'profit_loss',
          title: "Profit and Loss (Rs. in '000)",
          headers: ["Particulars (Rs. in '000)", `${qLabel} ${fy}`],
          rows: [
            { section: 'Profit', isSectionHeader: false, particulars: 'Profit for the period', values: ['1200000'], numericValues: [1_200_000] },
          ],
        },
        {
          key: 'key_metrics',
          title: 'Key Metrics',
          headers: ['Particulars', `${qLabel} ${fy}`],
          rows: [
            { section: 'Ratios', isSectionHeader: false, particulars: 'Basic Earnings Per Share', values: [String(eps)], numericValues: [eps] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Net Worth Per Share', values: [String(bvps)], numericValues: [bvps] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Return on Equity', values: [String(roe)], numericValues: [roe] },
            { section: 'Quality', isSectionHeader: false, particulars: 'Non-Performing Loan (NPL) Ratio', values: [String(npl)], numericValues: [npl] },
            { section: 'Quality', isSectionHeader: false, particulars: 'Capital Adequacy Ratio', values: ['13.5'], numericValues: [13.5] },
          ],
        },
      ],
    });

    for (const [fy, qLabel, eps] of [
      ['2081/82', '1st Quarter', 34],
      ['2082/83', '1st Quarter', 41],
      ['2082/83', '4th Quarter', 45],
      ['2083/84', '1st Quarter', 52],
    ] as const) {
      for (const rec of normalizeShareSansarSnapshot(
        makeBankSnap('EBL', 'Everest Bank Limited', fy, qLabel, eps, 340, 17.8, 0.7)
      )) {
        vault.upsertStatementRecord(rec);
      }
      for (const rec of normalizeShareSansarSnapshot(
        makeBankSnap('HBL', 'Himalayan Bank Limited', fy, qLabel, 14, 175, 8.2, 4.9)
      )) {
        vault.upsertStatementRecord(rec);
      }
    }

    // Seed KB with strong ICRA AA- rating for EBL and CDSC lock-in + negative watch for HBL
    const vaultDir = path.join(tmpDir, 'financial', 'vault');
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, 'regulatory-kb.json'),
      JSON.stringify({
        notices: [],
        lastHarvestAt: '2026-11-27T07:00:00Z',
        agencyLastFetch: { ICRA: '2026-11-27T07:00:00Z', CDSC: '2026-11-27T07:00:00Z' },
        companies: {
          EBL: {
            symbol: 'EBL',
            companyName: 'Everest Bank Limited',
            sector: 'Commercial Banks',
            sectorGroup: 'Banking',
            updatedAt: '2026-11-27T07:00:00Z',
            dataStatus: 'Live',
            creditRating: {
              agency: 'ICRA',
              ratingGrade: '[ICRANP-IR] AA-',
              outlook: 'Positive',
              ratingAction: 'Reaffirmed',
              rationale: 'Best-in-class asset quality and strong CASA franchise.',
              lastRatedDate: '2026-11-15',
            },
            regulatoryStanding: 'Positive',
            nrbAssessment: 'Lowest NPL in peer group with comfortable CAR.',
            niaAssessment: null,
            sebonStatus: 'Compliant',
            nepseDisclosures: 'Consistent dividend track record.',
            cdscStatus: 'No promoter lock-in overhang.',
            lockInOverhangFlag: false,
            tailwinds: ['ICRA AA- Positive outlook with sub-1% NPL'],
            riskFlags: [],
            citations: [{ title: 'ICRA Nepal EBL', uri: 'https://www.icranepal.com/ebl', agency: 'ICRA' }],
          },
          HBL: {
            symbol: 'HBL',
            companyName: 'Himalayan Bank Limited',
            sector: 'Commercial Banks',
            sectorGroup: 'Banking',
            updatedAt: '2026-11-27T07:00:00Z',
            dataStatus: 'Live',
            creditRating: {
              agency: 'CARE',
              ratingGrade: 'CARE-NP BB+',
              outlook: 'Negative',
              ratingAction: 'Downgraded',
              rationale: 'Elevated NPL pressure.',
              lastRatedDate: '2026-11-10',
            },
            regulatoryStanding: 'Alert',
            nrbAssessment: 'Elevated NPL near 5%.',
            niaAssessment: null,
            sebonStatus: null,
            nepseDisclosures: null,
            cdscStatus: 'Upcoming promoter share unlock supply.',
            lockInOverhangFlag: true,
            tailwinds: [],
            riskFlags: ['CDSC lock-in unlock pending'],
            citations: [{ title: 'CDSC Notice', uri: 'https://cdsc.com.np/notice', agency: 'CDSC' }],
          },
        },
      }),
      'utf8'
    );

    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();

    const gemsAll = evaluateHiddenGems(store, vault, kb, {
      equityOnly: true,
      benchmarkFdRatePct: 6.5,
    });
    const ebl = gemsAll.gems.find((c) => c.symbol === 'EBL');
    assert.ok(ebl, 'EBL should qualify as a hidden gem');
    assert.ok(ebl.archetypes.includes('clean_bfi_yield'));
    assert.ok(ebl.archetypes.includes('kb_tailwind'));
    assert.ok(ebl.subScores.knowledgeBaseConviction >= 8);
    assert.ok(ebl.whyHiddenGem.length >= 2);

    const igClean = evaluateHiddenGems(store, vault, kb, {
      equityOnly: true,
      onlyWithKb: true,
      investmentGradeOnly: true,
      excludeAlertsAndLockIn: true,
      beatsFdOnly: true,
    });
    assert.ok(igClean.gems.some((c) => c.symbol === 'EBL'));
    assert.equal(igClean.gems.some((c) => c.symbol === 'HBL'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('70% Annual / 30% Quarterly weighting blends metrics, scores, and Hidden Gems annual filter accurately', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-annual-weight-test-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-27.csv'),
      [
        'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low',
        'ADBL,Agricultural Development Bank Limited,300,305,298,302,300,2,0.67,10000,3020000,302,360,260',
        'NBL,Nepal Bank Limited,240,244,238,242,240,2,0.83,12000,2904000,242,280,210',
        'QONLY,Quarterly Only Hydro Limited,250,255,248,250,250,0,0,8000,2000000,250,310,210',
      ].join('\n'),
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();

    const makeSnap = (
      symbol: string,
      companyName: string,
      sector: string,
      fy: string,
      qLabel: string,
      eps: number,
      roe: number,
      bvps: number
    ): CompanyFinancialSnapshot => ({
      symbol,
      companyName,
      sector,
      companyId: symbol,
      scrapedAt: '2026-11-27T06:00:00.000Z',
      sourceUrl: `https://www.sharesansar.com/company/${symbol.toLowerCase()}`,
      periods: [`${qLabel} ${fy}`],
      tabs: [
        {
          key: 'balance_sheet',
          title: "Balance Sheet (Rs. in '000)",
          headers: ["Particulars (Rs. in '000)", `${qLabel} ${fy}`],
          rows: [
            { section: 'Equity', isSectionHeader: false, particulars: "Total Shareholder's Equity", values: ['18000000'], numericValues: [18_000_000] },
            { section: 'Assets', isSectionHeader: false, particulars: 'Total Assets', values: ['200000000'], numericValues: [200_000_000] },
            { section: 'Liabilities', isSectionHeader: false, particulars: 'Total Liabilities', values: ['182000000'], numericValues: [182_000_000] },
          ],
        },
        {
          key: 'profit_loss',
          title: "Profit and Loss (Rs. in '000)",
          headers: ["Particulars (Rs. in '000)", `${qLabel} ${fy}`],
          rows: [
            { section: 'Profit', isSectionHeader: false, particulars: 'Profit for the period', values: ['1500000'], numericValues: [1_500_000] },
          ],
        },
        {
          key: 'key_metrics',
          title: 'Key Metrics',
          headers: ['Particulars', `${qLabel} ${fy}`],
          rows: [
            { section: 'Ratios', isSectionHeader: false, particulars: 'Basic Earnings Per Share', values: [String(eps)], numericValues: [eps] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Net Worth Per Share', values: [String(bvps)], numericValues: [bvps] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Return on Equity', values: [String(roe)], numericValues: [roe] },
            { section: 'Quality', isSectionHeader: false, particulars: 'Non-Performing Loan (NPL) Ratio', values: ['1.8'], numericValues: [1.8] },
            { section: 'Quality', isSectionHeader: false, particulars: 'Capital Adequacy Ratio', values: ['13.0'], numericValues: [13.0] },
          ],
        },
      ],
    });

    // ADBL has both Q4 (Annual) and newer Q1 interim report
    for (const rec of normalizeShareSansarSnapshot(
      makeSnap('ADBL', 'Agricultural Development Bank Limited', 'Commercial Banks', '2082/83', '4th Quarter', 20, 12, 220)
    )) {
      vault.upsertStatementRecord(rec);
    }
    for (const rec of normalizeShareSansarSnapshot(
      makeSnap('ADBL', 'Agricultural Development Bank Limited', 'Commercial Banks', '2083/84', '1st Quarter', 40, 22, 240)
    )) {
      vault.upsertStatementRecord(rec);
    }

    // NBL peer bank with Q1 interim report (so Commercial Banks has 2 peers for industry averages)
    for (const rec of normalizeShareSansarSnapshot(
      makeSnap('NBL', 'Nepal Bank Limited', 'Commercial Banks', '2083/84', '1st Quarter', 18, 11, 260)
    )) {
      vault.upsertStatementRecord(rec);
    }

    // QONLY only has a Q1 interim report (no Annual/Q4 record)
    for (const rec of normalizeShareSansarSnapshot(
      makeSnap('QONLY', 'Quarterly Only Hydro Limited', 'Hydro Power', '2083/84', '1st Quarter', 30, 18, 160)
    )) {
      vault.upsertStatementRecord(rec);
    }

    const res70 = evaluateScreenerUniverse(store, vault, { equityOnly: true });
    assert.equal(res70.annualWeightPct, 70);
    const adbl70 = res70.rows.find((r) => r.symbol === 'ADBL')!;
    const qonly70 = res70.rows.find((r) => r.symbol === 'QONLY')!;

    assert.equal(adbl70.reportWeighting.basis, 'blended');
    assert.equal(adbl70.reportWeighting.hasAnnualReport, true);
    assert.equal(adbl70.reportWeighting.annualWeightPct, 70);
    assert.equal(adbl70.reportWeighting.interimWeightPct, 30);
    assert.equal(adbl70.reportWeighting.annualPeriodLabel, 'Q4 FY 2082/83');
    assert.equal(adbl70.reportWeighting.interimPeriodLabel, 'Q1 FY 2083/84');
    assert.equal(adbl70.keyMetrics.eps, 26); // 0.7 * 20 + 0.3 * 40
    assert.equal(adbl70.keyMetrics.roePct, 15); // 0.7 * 12 + 0.3 * 22
    assert.ok(adbl70.reportWeighting.annualOverallScore !== null);
    assert.ok(adbl70.reportWeighting.interimOverallScore !== null);
    const expectedOverall70 =
      Math.round(
        (adbl70.reportWeighting.annualOverallScore! * 0.7 +
          adbl70.reportWeighting.interimOverallScore! * 0.3) *
          10
      ) / 10;
    assert.equal(adbl70.scores.overallScore, expectedOverall70);
    assert.match(adbl70.recommendation.whyQualifies, /Weighted 70% Annual/i);

    assert.equal(qonly70.reportWeighting.basis, 'quarterly_only');
    assert.equal(qonly70.reportWeighting.hasAnnualReport, false);
    assert.equal(qonly70.keyMetrics.eps, 30);

    // Switching weight to 100% Annual vs 0% Annual (Latest Quarter) shifts blended EPS & ROE cleanly
    const res100 = evaluateScreenerUniverse(store, vault, { equityOnly: true, annualWeightPct: 100 });
    const adbl100 = res100.rows.find((r) => r.symbol === 'ADBL')!;
    assert.equal(adbl100.keyMetrics.eps, 20);
    assert.equal(adbl100.keyMetrics.roePct, 12);

    const res0 = evaluateScreenerUniverse(store, vault, { equityOnly: true, annualWeightPct: 0 });
    const adbl0 = res0.rows.find((r) => r.symbol === 'ADBL')!;
    assert.equal(adbl0.keyMetrics.eps, 40);
    assert.equal(adbl0.keyMetrics.roePct, 22);

    // Hidden Gems annual report filter & weighting
    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();
    const gemsAnnualOnly = evaluateHiddenGems(store, vault, kb, {
      equityOnly: true,
      annualWeightPct: 70,
      requireAnnualReport: true,
    });
    assert.equal(gemsAnnualOnly.annualWeightPct, 70);
    assert.ok(gemsAnnualOnly.gems.every((g) => g.screenerRow.reportWeighting.hasAnnualReport));
    assert.equal(gemsAnnualOnly.gems.some((g) => g.symbol === 'QONLY'), false);

    // Annual Report Pricing & Valuation Lab Dossier verification
    const valUniverse = getValuationUniverseSummary(store, vault, kb, {
      equityOnly: true,
      annualWeightPct: 70,
    });
    assert.equal(valUniverse.annualWeightPct, 70);
    assert.equal(valUniverse.withAnnualReports, 1);
    assert.ok(valUniverse.candidates.some((c) => c.symbol === 'ADBL' && c.hasAnnualReport));

    const dossier = buildCompanyValuationDossier(store, vault, kb, 'ADBL', {
      equityOnly: true,
      annualWeightPct: 70,
    });
    assert.ok(dossier, 'Valuation dossier should be built for ADBL');
    assert.equal(dossier.annualWeightPct, 70);
    assert.equal(dossier.forensics.hasAnnualReport, true);
    assert.equal(dossier.forensics.annualEps, 20);
    assert.equal(dossier.forensics.interimEps, 40);
    assert.equal(dossier.forensics.annualVsInterimDivergence.flag, 'Interim Elevated');
    assert.ok(dossier.models.filter((m) => m.available).length >= 4);
    assert.ok(dossier.compositeFairValue !== null && dossier.compositeFairValue > 0);
    assert.equal(dossier.scenarios.length, 3);
    assert.equal(dossier.sensitivityGrid.keValues.length, 5);
    assert.equal(dossier.sensitivityGrid.cells.length, 5);
    assert.ok(dossier.swot.strengths.length >= 1);
    assert.ok(dossier.swot.opportunities.length >= 1);
    assert.ok(dossier.swot.risks.length >= 1);
    assert.ok(dossier.swot.futureWorthVerdict.considerableInvestmentScore > 0);

    // Valuation Health Score & Annual Report Dissector vs Industry Peers
    const adblCand = valUniverse.candidates.find((c) => c.symbol === 'ADBL')!;
    assert.ok(adblCand.valuationHealthScore >= 0 && adblCand.valuationHealthScore <= 100);
    assert.ok(adblCand.safetyScore >= 0 && adblCand.growthScore >= 0);

    const hs = dossier.valuationHealthScore;
    assert.ok(hs.overallScore > 0 && hs.overallScore <= 100);
    assert.ok(hs.safetyScore > 0 && hs.safetyScore <= 100);
    assert.ok(hs.growthScore > 0 && hs.growthScore <= 100);
    assert.equal(hs.pillars.length, 4);
    assert.equal(
      hs.pillars.reduce((s, p) => s + p.weightPct, 0),
      100
    );
    assert.ok(hs.metricsBreakdown.length >= 8);
    assert.equal(hs.hasAnnualReport, true);

    const diss = dossier.annualReportDissector;
    assert.equal(diss.peerCount, 2); // ADBL + NBL in Commercial Banks
    assert.equal(diss.annualVerifiedPeerCount, 1);
    assert.equal(diss.sections.length, 4);
    assert.equal(diss.peerMatrix.length, 2);
    assert.equal(diss.industryAverages.roePct, 13); // avg of ADBL (15%) and NBL (11%)
    assert.equal(diss.industryAverages.eps, 22); // avg of ADBL (26) and NBL (18)
    const roeDissect = diss.sections
      .flatMap((s) => s.metrics)
      .find((m) => m.key === 'roePct');
    assert.ok(roeDissect);
    assert.equal(roeDissect.annualReportValue, 12);
    assert.equal(roeDissect.interimValue, 22);
    assert.equal(roeDissect.companyValue, 15);

    // Master Multi-Factor Screener verification
    const master = computeMasterScreener(store, vault, kb, {
      equityOnly: true,
      annualWeightPct: 70,
    });
    assert.equal(master.annualWeightPct, 70);
    assert.equal(master.totalSymbols, 3);
    assert.equal(master.presetCounts.master_all, 3);
    assert.ok(master.sectors.includes('Commercial Banks'));
    const adblMaster = master.rows.find((r) => r.symbol === 'ADBL')!;
    assert.ok(adblMaster);
    assert.equal(adblMaster.hasAnnualReport, true);
    assert.ok(adblMaster.masterScore >= 0 && adblMaster.masterScore <= 100);
    assert.ok(adblMaster.liquidity.playerInterestScore >= 0);
    assert.ok(adblMaster.liquidity.avgTurnover20Cr > 0);
    assert.ok(adblMaster.technical.technicalScore >= 0);
    assert.ok(adblMaster.valuation.valuationHealthScore !== null);
    assert.ok(adblMaster.tenX.tenXScore >= 0 && adblMaster.tenX.tenXScore <= 100);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Annual Report Intelligence builds per-FY analyses, 8 key pillars, comparison matrix, and multi-year trendSeries', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-ar-intel-test-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-27.csv'),
      'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low\nSHIVM,Shivam Cements Ltd.,510,525,505,520,512,8,1.56,50000,26000000,520,690,460\n',
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();
    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();

    const makeFySnap = (
      fy: string,
      qLabel: string,
      eps: number,
      profitCr: number,
      revCr: number,
      equityCr: number,
      assetsCr: number,
      roe: number
    ): CompanyFinancialSnapshot => ({
      symbol: 'SHIVM',
      companyName: 'Shivam Cements Ltd.',
      sector: 'Manufacturing and Processing',
      companyId: '99',
      scrapedAt: '2026-11-27T06:00:00.000Z',
      sourceUrl: 'https://www.sharesansar.com/company/shivm',
      periods: [`${qLabel} ${fy}`],
      tabs: [
        {
          key: 'profit_loss',
          title: 'Profit and Loss',
          headers: ["Particulars (Rs. in '000)", `${qLabel} ${fy}`],
          rows: [
            { section: 'Income', isSectionHeader: false, particulars: 'Revenue', values: [String(revCr * 10_000)], numericValues: [revCr * 10_000] },
            { section: 'Profit', isSectionHeader: false, particulars: 'Profit for the period', values: [String(profitCr * 10_000)], numericValues: [profitCr * 10_000] },
          ],
        },
        {
          key: 'balance_sheet',
          title: 'Balance Sheet',
          headers: ["Particulars (Rs. in '000)", `${qLabel} ${fy}`],
          rows: [
            { section: 'Equity', isSectionHeader: false, particulars: "Total Shareholder's Equity", values: [String(equityCr * 10_000)], numericValues: [equityCr * 10_000] },
            { section: 'Equity', isSectionHeader: false, particulars: 'Share Capital', values: ['5000000'], numericValues: [5_000_000] },
            { section: 'Equity', isSectionHeader: false, particulars: 'Reserves', values: [String((equityCr - 500) * 10_000)], numericValues: [(equityCr - 500) * 10_000] },
            { section: 'Debt', isSectionHeader: false, particulars: 'Long Term Debt', values: ['1200000'], numericValues: [1_200_000] },
            { section: 'Assets', isSectionHeader: false, particulars: 'Total Assets', values: [String(assetsCr * 10_000)], numericValues: [assetsCr * 10_000] },
          ],
        },
        {
          key: 'key_metrics',
          title: 'Key Metrics',
          headers: ['Particulars', `${qLabel} ${fy}`],
          rows: [
            { section: 'Ratios', isSectionHeader: false, particulars: 'Basic Earnings Per Share', values: [String(eps)], numericValues: [eps] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Net Worth Per Share', values: ['210'], numericValues: [210] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Return on Equity', values: [String(roe)], numericValues: [roe] },
          ],
        },
      ],
    });

    for (const [fy, qLabel, eps, profitCr, revCr, eqCr, asCr, roe] of [
      ['2080/81', 'Annual', 22, 110, 620, 920, 1250, 12.0],
      ['2081/82', 'Annual', 28, 140, 740, 1020, 1340, 14.2],
      ['2082/83', '4th Quarter', 34, 170, 860, 1120, 1420, 15.8],
      ['2083/84', '1st Quarter', 38, 190, 920, 1180, 1490, 16.5],
    ] as const) {
      for (const rec of normalizeShareSansarSnapshot(
        makeFySnap(fy, qLabel, eps, profitCr, revCr, eqCr, asCr, roe)
      )) {
        vault.upsertStatementRecord(rec);
      }
    }

    const universe = getAnnualReportUniverse(store, vault, kb, { equityOnly: true });
    assert.equal(universe.totalCompanies, 1);
    assert.equal(universe.multiFyCount, 1);
    assert.equal(universe.auditedAnnualCount, 1);
    assert.equal(universe.candidates[0].symbol, 'SHIVM');
    assert.equal(universe.candidates[0].totalFyCount, 4);
    assert.equal(universe.candidates[0].auditedFyCount, 2);

    const prePoushNow = new Date('2026-11-28T00:00:00Z');
    const intel = buildAnnualReportIntelligence(store, vault, kb, 'SHIVM', {
      now: prePoushNow,
    });
    assert.ok(intel, 'Expected AnnualReportIntelligenceResponse for SHIVM');
    assert.equal(intel.symbol, 'SHIVM');
    assert.equal(intel.fiscalContext.currentFy, '2083/84');
    assert.equal(intel.fiscalContext.latestCompletedFy, '2082/83');
    assert.equal(intel.fiscalContext.previousCompletedFy, '2081/82');
    assert.equal(intel.fiscalContext.poushEndPassed, false);
    // Before Poush end, since 2082/83 only has 4th Quarter (not Audited Annual), recommend prior Audited FY 2081/82
    assert.equal(intel.recommendedAnnualFy, '2081/82');
    assert.equal(intel.fallbackUsed, true);
    assert.ok(intel.fallbackReason?.includes('2081/82'));
    assert.equal(intel.fiscalYears.length, 4);
    assert.equal(intel.auditedFyCount, 2);
    assert.equal(intel.totalFyCount, 4);

    // Every FY has all 8 required key analysis pillars
    const expectedPillarIds = [
      'managementQuality',
      'growth',
      'businessOpportunities',
      'risks',
      'weaknesses',
      'uncertainties',
      'upcomingBusinessPlans',
      'businessDirection',
    ];
    for (const fyObj of intel.fiscalYears) {
      assert.deepEqual(Object.keys(fyObj.pillars).sort(), [...expectedPillarIds].sort());
      for (const pid of expectedPillarIds) {
        assert.ok(fyObj.pillars[pid as keyof typeof fyObj.pillars].findings.length >= 1);
      }
    }

    // Active recommended annual tab (2081/82) compares vs 2080/81
    const recommendedTab = intel.fiscalYears.find((f) => f.fiscalYear === '2081/82');
    assert.ok(recommendedTab);
    assert.equal(recommendedTab.isLatest, true);
    assert.equal(recommendedTab.basis, 'Audited Annual');
    assert.equal(recommendedTab.yoyDeltas.priorFiscalYear, '2080/81');
    assert.ok(recommendedTab.yoyDeltas.revenueYoYPct !== null && recommendedTab.yoyDeltas.revenueYoYPct > 10);
    assert.ok(recommendedTab.yoyDeltas.netProfitYoYPct !== null && recommendedTab.yoyDeltas.netProfitYoYPct > 20);

    // Current-FY 2083/84 remains accessible as Interim Quarterly
    const interimTab = intel.fiscalYears.find((f) => f.fiscalYear === '2083/84');
    assert.ok(interimTab);
    assert.equal(interimTab.basis, 'Interim Quarterly');

    // Comparison matrix defaults to recommendedAnnualFy (2081/82) vs prior (2080/81)
    assert.ok(intel.comparison);
    assert.equal(intel.comparison.latestFy, '2081/82');
    assert.equal(intel.comparison.priorFy, '2080/81');
    assert.ok(intel.comparison.metricDeltas.length >= 5);
    assert.equal(intel.trendSeries.length, 4);
    assert.equal(intel.trendSeries[0].fiscalYear, '2080/81');
    assert.equal(intel.trendSeries[3].fiscalYear, '2083/84');

    // Once Poush end is crossed (Feb 2027), latest closed FY 2082/83 becomes primary target
    const postPoushIntel = buildAnnualReportIntelligence(store, vault, kb, 'SHIVM', {
      now: new Date('2027-02-01T00:00:00Z'),
    });
    assert.ok(postPoushIntel);
    assert.equal(postPoushIntel.fiscalContext.poushEndPassed, true);
    assert.equal(postPoushIntel.recommendedAnnualFy, '2082/83');
    assert.equal(postPoushIntel.fallbackUsed, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MarketStore.getHomepageCommand computes volume/turnover comparisons, blowout/short scripts, spikes, top turnover up/down, and heatmap', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-home-cmd-test-'));
  try {
    const header = 'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,vwap,trans,w52_high,w52_low';
    // Day 1-5 baseline sessions
    const baseDates = ['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'];
    for (const d of baseDates) {
      fs.writeFileSync(
        path.join(tmpDir, `${d}.csv`),
        [
          header,
          'NABIL,Nabil Bank Limited,500,505,498,502,500,2,0.4,10000,5020000,502,501,100,550,450',
          'SAHAS,Sahas Urja Limited,410,415,405,412,410,2,0.49,8000,3296000,412,410,80,460,350',
          'HBL,Himalayan Bank Limited,220,222,218,219,220,-1,-0.45,9000,1971000,219,220,90,260,195',
        ].join('\n'),
        'utf8'
      );
    }

    // Latest day: SAHAS blows out +7.8% on 4x vol/TO; HBL dumps -5.5% on 3x vol/TO; NABIL steady up
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-27.csv'),
      [
        header,
        'NABIL,Nabil Bank Limited,502,512,501,510,502,8,1.59,18000,9180000,510,508,160,550,450',
        'SAHAS,Sahas Urja Limited,414,446,412,444,412,32,7.77,36000,15840000,444,435,320,460,350',
        'HBL,Himalayan Bank Limited,219,220,206,207,219,-12,-5.48,28000,5796000,207,211,240,260,195',
      ].join('\n'),
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const cmd = store.getHomepageCommand('2026-11-27', 20, true);
    assert.ok(cmd, 'Expected HomepagePulseResponse');
    assert.equal(cmd.summary.date, '2026-11-27');
    assert.equal(cmd.summary.prevDate, '2026-11-26');
    assert.ok(cmd.summary.turnoverVsPrevPct !== null && cmd.summary.turnoverVsPrevPct > 100);
    assert.ok(cmd.summary.volumeVsPrevPct !== null && cmd.summary.volumeVsPrevPct > 100);
    assert.equal(cmd.historyStrip.length, 6);

    assert.ok(cmd.blowoutScripts.length >= 1);
    assert.equal(cmd.blowoutScripts[0].symbol, 'SAHAS');

    assert.ok(cmd.shortScripts.length >= 1);
    assert.equal(cmd.shortScripts[0].symbol, 'HBL');

    assert.ok(cmd.unusualActivity.length >= 2);
    assert.ok(cmd.unusualActivity.some((u) => u.symbol === 'SAHAS' && u.volumeMultN > 2));

    assert.deepEqual(
      cmd.topTurnoverUp.map((r) => r.symbol),
      ['SAHAS', 'NABIL']
    );
    assert.deepEqual(
      cmd.topTurnoverDown.map((r) => r.symbol),
      ['HBL']
    );

    assert.ok(cmd.sectorHeatmap.length >= 2);
    assert.equal(cmd.stockHeatmap.length, 3);
    assert.ok(cmd.wowInsights.length >= 2);
    assert.ok(Array.isArray(cmd.smartMoneyFootprints));
    assert.ok(cmd.summary.ticketDistribution !== undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getNepalFiscalYearCalendarContext tracks FY 83/84, latest closed 82/83, prior 81/82, and Poush-end cutoff', () => {
  const before = getNepalFiscalYearCalendarContext(new Date('2026-11-28T00:00:00Z'));
  assert.equal(before.currentFy, '2083/84');
  assert.equal(before.latestCompletedFy, '2082/83');
  assert.equal(before.previousCompletedFy, '2081/82');
  assert.equal(before.poushEndApproxDate, '2027-01-14');
  assert.equal(before.poushEndPassed, false);
  assert.ok(before.daysUntilPoushEnd > 40);

  const after = getNepalFiscalYearCalendarContext(new Date('2027-02-01T00:00:00Z'));
  assert.equal(after.currentFy, '2083/84');
  assert.equal(after.latestCompletedFy, '2082/83');
  assert.equal(after.poushEndPassed, true);
  assert.equal(after.daysUntilPoushEnd, 0);
});

test('ingestAndDistillAnnualReport saves uploaded report, distills FY, and updates Regulatory Knowledge Base', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-ingest-ar-test-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-27.csv'),
      'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp\nNABIL,Nabil Bank Limited,500,510,498,508,500,8,1.6,40000,20320000,508\n',
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();
    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();

    const snap: CompanyFinancialSnapshot = {
      symbol: 'NABIL',
      companyName: 'Nabil Bank Limited',
      sector: 'Commercial Banks',
      companyId: '1',
      scrapedAt: '2026-11-27T06:00:00.000Z',
      sourceUrl: 'https://www.sharesansar.com/company/nabil',
      periods: ['1st Quarter 2083/2084'],
      tabs: [
        {
          key: 'key_metrics',
          title: 'Key Metrics',
          headers: ['Particulars', '1st Quarter 2083/2084'],
          rows: [
            { section: 'Ratios', isSectionHeader: false, particulars: 'Basic Earnings Per Share', values: ['29.5'], numericValues: [29.5] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Return on Equity', values: ['14.8'], numericValues: [14.8] },
          ],
        },
      ],
    };
    for (const rec of normalizeShareSansarSnapshot(snap)) {
      vault.upsertStatementRecord(rec);
    }

    const reportText = [
      'Nabil Bank Limited - Annual Report FY 2082/83',
      'Executive Overview: Net profit rose 18.4% YoY with steady deposit mobilization and improving SME credit yields.',
      'Management & Governance: Strong board risk oversight and disciplined digital banking cost ratios.',
      'Opportunities: SME digital lending expansion, remittance fee growth, and lower cost of funds.',
      'Risks: Elevated NPL recovery provisioning in construction portfolios and NRB CAR buffer compliance.',
      'Upcoming Plans: Proposed 12% bonus share plus 8% cash dividend and core-banking cloud upgrade.',
      'Long-Term Direction: Diversify non-funded fee income and sustain ROE above 15%.',
    ].join('\n');

    const ingested = await ingestAndDistillAnnualReport(store, vault, kb, {
      symbol: 'NABIL',
      fiscalYear: '2082/83',
      fileName: 'nabil-annual-report-2082-83.txt',
      mimeType: 'text/plain',
      fileBase64: Buffer.from(reportText, 'utf8').toString('base64'),
    });

    assert.equal(ingested.symbol, 'NABIL');
    assert.equal(ingested.fiscalYear, '2082/83');
    assert.equal(ingested.sourceType, 'upload');
    assert.equal(ingested.kbUpdated, true);
    assert.ok(fs.existsSync(path.resolve(process.cwd(), ingested.savedFilePath)));
    assert.ok(ingested.distillation.executiveSummary.length > 20);

    // KB updated with notice and company dossier
    const kbEntry = kb.getCompanyEntry('NABIL');
    assert.ok(kbEntry);
    assert.ok(kb.getSummary().totalNotices >= 1);

    // Subsequent intelligence read picks up synthetic FY 2082/83 tab with AI distillation
    const intel = buildAnnualReportIntelligence(store, vault, kb, 'NABIL', {
      now: new Date('2026-11-28T00:00:00Z'),
    });
    assert.ok(intel);
    assert.equal(intel.recommendedAnnualFy, '2082/83');
    assert.equal(intel.fallbackUsed, false);
    assert.ok(intel.fiscalYears.some((f) => f.fiscalYear === '2082/83' && Boolean(f.aiDistillation)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeComingQuarterOutlook identifies Blow Up vs Blow Down catalysts with inline citations and references', () => {
  const bullSnap: CompanyFinancialSnapshot = {
    symbol: 'SHIVM',
    companyName: 'Shivam Cements Ltd.',
    sector: 'Manufacturing and Processing',
    companyId: '99',
    scrapedAt: '2026-11-27T06:00:00.000Z',
    sourceUrl: 'https://www.sharesansar.com/company/shivm',
    periods: ['1st Quarter 2083/2084', '4th Quarter 2082/2083', '1st Quarter 2082/2083'],
    tabs: [
      {
        key: 'profit_loss',
        title: 'Profit and Loss',
        headers: ['Particulars', '1st Quarter 2083/2084', '4th Quarter 2082/2083', '1st Quarter 2082/2083'],
        rows: [
          { section: 'Income', isSectionHeader: false, particulars: 'Revenue', values: ['3500000', '2400000', '2100000'], numericValues: [3500000, 2400000, 2100000] },
          { section: 'Profit', isSectionHeader: false, particulars: 'Profit for the period', values: ['720000', '410000', '340000'], numericValues: [720000, 410000, 340000] },
        ],
      },
      {
        key: 'balance_sheet',
        title: 'Balance Sheet',
        headers: ['Particulars', '1st Quarter 2083/2084', '4th Quarter 2082/2083', '1st Quarter 2082/2083'],
        rows: [
          { section: 'Equity', isSectionHeader: false, particulars: 'Share Capital', values: ['5000000', '5000000', '5000000'], numericValues: [5000000, 5000000, 5000000] },
          { section: 'Equity', isSectionHeader: false, particulars: 'Reserves', values: ['4200000', '3500000', '3100000'], numericValues: [4200000, 3500000, 3100000] },
        ],
      },
      {
        key: 'key_metrics',
        title: 'Key Metrics',
        headers: ['Particulars', '1st Quarter 2083/2084', '4th Quarter 2082/2083', '1st Quarter 2082/2083'],
        rows: [
          { section: 'Ratios', isSectionHeader: false, particulars: 'Basic Earnings Per Share', values: ['42.0', '26.0', '21.0'], numericValues: [42.0, 26.0, 21.0] },
          { section: 'Ratios', isSectionHeader: false, particulars: 'Return on Equity', values: ['18.5', '13.2', '12.0'], numericValues: [18.5, 13.2, 12.0] },
        ],
      },
    ],
  };

  const bullRecords = normalizeShareSansarSnapshot(bullSnap);
  const bullGrowth = computeGrowthComparisons(bullRecords);
  const bullOutlook = computeComingQuarterOutlook({
    sectorGroup: 'Manufacturing',
    ledger: { records: bullRecords, companyName: 'Shivam Cements Ltd.' },
    activeRecord: bullRecords[0],
    growth: bullGrowth,
    valuation: {
      method: 'Sector Valuation Blended',
      sectorMethodologyNote: 'Blended P/E, P/B and DCF manufacturing model',
      currentPrice: 520,
      livePe: 12.4,
      livePb: 1.8,
      livePeg: 0.45,
      marketCap: 26_000_000_000,
      enterpriseValue: null,
      earningsYieldPct: 10.5,
      earningsYieldBasis: 'TTM EPS / Price',
      ncavPerShare: null,
      intrinsicValue: 730,
      intrinsicValueLow: 650,
      intrinsicValueHigh: 810,
      marginOfSafetyPct: 28.4,
      provenance: 'Calculated',
      formulaInputs: [],
      assumptions: [],
      limitations: [],
    },
    market: {
      date: '2026-11-27',
      ltp: 520,
      changePct: 3.1,
      turnover: 35_000_000,
      volume: 67_000,
      avgTurnoverN: 18_000_000,
      turnoverMultN: 1.9,
      periodReturnNPct: 4.5,
      vsD120Pct: 5.1,
      vsD180Pct: 6.1,
      w52High: 690,
      w52Low: 460,
      gap52hPct: -24.6,
      momentumScore: 76,
      liquidityTier: 'High',
    },
    kbEntry: null,
    now: new Date('2026-11-28T00:00:00Z'),
  });

  assert.equal(bullOutlook.currentPeriodLabel, 'Q1 FY 2083/84');
  assert.equal(bullOutlook.comingQuarterLabel, 'Q2 FY 2083/84');
  assert.equal(bullOutlook.direction, 'Blow Up');
  assert.ok(bullOutlook.score >= 30);
  assert.ok(bullOutlook.catalysts.length >= 2);
  assert.ok(bullOutlook.reasons.every((r) => r.includes('[Ref:')));
  assert.ok(bullOutlook.references.length >= 1);

  const bearSnap: CompanyFinancialSnapshot = {
    symbol: 'RISK',
    companyName: 'Risk Finance Ltd.',
    sector: 'Finance',
    companyId: '88',
    scrapedAt: '2026-11-27T06:00:00.000Z',
    sourceUrl: 'https://www.sharesansar.com/company/risk',
    periods: ['1st Quarter 2083/2084', '4th Quarter 2082/2083', '1st Quarter 2082/2083'],
    tabs: [
      {
        key: 'profit_loss',
        title: 'Profit and Loss',
        headers: ['Particulars', '1st Quarter 2083/2084', '4th Quarter 2082/2083', '1st Quarter 2082/2083'],
        rows: [
          { section: 'Income', isSectionHeader: false, particulars: 'Revenue', values: ['500000', '780000', '820000'], numericValues: [500000, 780000, 820000] },
          { section: 'Profit', isSectionHeader: false, particulars: 'Profit for the period', values: ['-80000', '65000', '90000'], numericValues: [-80000, 65000, 90000] },
        ],
      },
      {
        key: 'key_metrics',
        title: 'Key Metrics',
        headers: ['Particulars', '1st Quarter 2083/2084', '4th Quarter 2082/2083', '1st Quarter 2082/2083'],
        rows: [
          { section: 'Ratios', isSectionHeader: false, particulars: 'Basic Earnings Per Share', values: ['-4.5', '7.2', '9.5'], numericValues: [-4.5, 7.2, 9.5] },
          { section: 'Ratios', isSectionHeader: false, particulars: 'NPL', values: ['8.9', '5.1', '4.2'], numericValues: [8.9, 5.1, 4.2] },
          { section: 'Ratios', isSectionHeader: false, particulars: 'CAR', values: ['9.4', '11.2', '12.0'], numericValues: [9.4, 11.2, 12.0] },
        ],
      },
    ],
  };

  const bearRecords = normalizeShareSansarSnapshot(bearSnap);
  const bearGrowth = computeGrowthComparisons(bearRecords);
  const bearOutlook = computeComingQuarterOutlook({
    sectorGroup: 'Banking',
    ledger: { records: bearRecords, companyName: 'Risk Finance Ltd.' },
    activeRecord: bearRecords[0],
    growth: bearGrowth,
    valuation: {
      method: 'Sector Valuation Blended',
      sectorMethodologyNote: 'Banking/Finance P/B and Residual Income model',
      currentPrice: 450,
      livePe: null,
      livePb: 3.1,
      livePeg: null,
      marketCap: 4_500_000_000,
      enterpriseValue: null,
      earningsYieldPct: -1.0,
      earningsYieldBasis: 'TTM EPS / Price',
      ncavPerShare: null,
      intrinsicValue: 305,
      intrinsicValueLow: 270,
      intrinsicValueHigh: 340,
      marginOfSafetyPct: -32,
      provenance: 'Calculated',
      formulaInputs: [],
      assumptions: [],
      limitations: [],
    },
    market: {
      date: '2026-11-27',
      ltp: 450,
      changePct: -3.2,
      turnover: 1_200_000,
      volume: 2_600,
      avgTurnoverN: 1_500_000,
      turnoverMultN: 0.8,
      periodReturnNPct: -6.4,
      vsD120Pct: -3.2,
      vsD180Pct: -4.3,
      w52High: 520,
      w52Low: 380,
      gap52hPct: -13.5,
      momentumScore: 30,
      liquidityTier: 'Low',
    },
    kbEntry: null,
    now: new Date('2026-11-28T00:00:00Z'),
  });

  assert.equal(bearOutlook.comingQuarterLabel, 'Q2 FY 2083/84');
  assert.equal(bearOutlook.direction, 'Blow Down');
  assert.ok(bearOutlook.score <= -30);
  assert.ok(bearOutlook.risks.length >= 2);
  assert.ok(bearOutlook.reasons.every((r) => r.includes('[Ref:')));
  assert.ok(bearOutlook.references.length >= 1);
});

test('buildStrategicOutlookHeatmap categorizes management quality, growth potential, and historical outperformance while sanitizing outliers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-strategic-heatmap-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-27.csv'),
      [
        'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low',
        'COMP,Compounder Bank Limited,500,510,495,505,500,5,1.0,15000,7575000,505,560,410',
        'LAGG,Lagging Microfinance Limited,320,324,315,316,320,-4,-1.25,5000,1580000,316,420,290',
      ].join('\n'),
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();
    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();

    const makeSnapshot = (
      symbol: string,
      companyName: string,
      sector: string,
      periodLabel: string,
      roe: number,
      eps: number,
      np: number,
      rev: number,
      npl: number,
      reserves: number,
      sc: number
    ): CompanyFinancialSnapshot => ({
      symbol,
      companyName,
      sector,
      companyId: symbol,
      periods: [periodLabel],
      scrapedAt: '2026-11-27T00:00:00Z',
      sourceUrl: 'https://www.sharesansar.com',
      tabs: [
        {
          key: 'ratios',
          title: 'Key Metrics',
          headers: ['Particulars', periodLabel],
          rows: [
            { section: 'Ratios', particulars: 'Basic Earnings Per Share', isSectionHeader: false, values: [String(eps)], numericValues: [eps] },
            { section: 'Ratios', particulars: 'Return on Equity', isSectionHeader: false, values: [String(roe)], numericValues: [roe] },
            { section: 'Ratios', particulars: 'Return on Assets', isSectionHeader: false, values: ['1.8'], numericValues: [1.8] },
            { section: 'Ratios', particulars: 'Non-Performing Loan (NPL) Ratio', isSectionHeader: false, values: [String(npl)], numericValues: [npl] },
            { section: 'Ratios', particulars: 'Capital Adequacy Ratio', isSectionHeader: false, values: ['13.5'], numericValues: [13.5] },
          ],
        },
        {
          key: 'balance',
          title: "Balance Sheet (Rs. in '000)",
          headers: ["Particulars (Rs. in '000)", periodLabel],
          rows: [
            { section: 'Equity', particulars: 'Paid Up Capital', isSectionHeader: false, values: [String(sc / 1000)], numericValues: [sc / 1000] },
            { section: 'Equity', particulars: 'Reserves', isSectionHeader: false, values: [String(reserves / 1000)], numericValues: [reserves / 1000] },
          ],
        },
        {
          key: 'pnl',
          title: "Profit and Loss (Rs. in '000)",
          headers: ["Particulars (Rs. in '000)", periodLabel],
          rows: [
            { section: 'Income', particulars: 'Total Operating Income', isSectionHeader: false, values: [String(rev / 1000)], numericValues: [rev / 1000] },
            { section: 'Profit', particulars: 'Profit for the period', isSectionHeader: false, values: [String(np / 1000)], numericValues: [np / 1000] },
          ],
        },
      ],
    });

    const snapshots = [
      makeSnapshot(
        'COMP',
        'Compounder Bank Limited',
        'Commercial Banks',
        'Annual Report 2081/2082',
        11.0,
        18.0,
        2_200_000_000,
        8_000_000_000,
        1.4,
        9_500_000_000,
        10_000_000_000
      ),
      makeSnapshot(
        'COMP',
        'Compounder Bank Limited',
        'Commercial Banks',
        'Annual Report 2082/2083',
        21.0,
        28.5,
        3_200_000_000,
        10_500_000_000,
        0.95,
        11_500_000_000,
        10_000_000_000
      ),
      makeSnapshot(
        'LAGG',
        'Lagging Microfinance Limited',
        'Microfinance',
        'Annual Report 2081/2082',
        5833333333.33,
        24.0,
        400_000_000,
        1_200_000_000,
        3.2,
        250_000_000,
        1_000_000_000
      ),
      makeSnapshot(
        'LAGG',
        'Lagging Microfinance Limited',
        'Microfinance',
        'Annual Report 2082/2083',
        2.5,
        4.0,
        120_000_000,
        800_000_000,
        7.8,
        180_000_000,
        1_000_000_000
      ),
    ];
    for (const snap of snapshots) {
      for (const rec of normalizeShareSansarSnapshot(snap)) {
        vault.upsertStatementRecord(rec);
      }
    }

    const res = buildStrategicOutlookHeatmap(store, vault, kb, {
      equityOnly: true,
      now: new Date('2026-11-28T00:00:00Z'),
    });

    assert.equal(res.totalCompanies, 2);
    assert.equal(res.multiFyCompanies, 2);

    const comp = res.rows.find((r) => r.symbol === 'COMP');
    const lagg = res.rows.find((r) => r.symbol === 'LAGG');
    assert.ok(comp && lagg);

    assert.equal(comp.baselineMode, 'self-multi-fy');
    assert.equal(comp.outperformanceStatus, 'Outperforming');
    assert.equal(comp.quadrant, 'Compounders');
    assert.ok(comp.managementQualityScore >= 65);
    assert.ok(comp.growthPotentialScore >= 60);
    assert.ok(comp.outperformanceScore > 15);
    assert.equal(comp.histRoePct, 11);

    // Corrupt ROE 5833333333.33 must be filtered out from LAGG's historical average
    assert.equal(lagg.histRoePct, null);
    assert.equal(lagg.outperformanceStatus, 'Lagging');
    assert.equal(lagg.quadrant, 'Restructuring Watch');
    assert.ok(lagg.outperformanceScore < -15);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('RegulatoryKnowledgeBase records stock search updates to KB and tracks once-a-day search deduplication', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-kb-search-dedup-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-28.csv'),
      'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low\nNABIL,Nabil Bank Limited,500,510,498,505,500,5,1.0,10000,5050000,505,560,440\n',
      'utf8'
    );
    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();
    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();

    const today = '2026-11-28';
    const tomorrow = '2026-11-29';

    assert.equal(kb.hasDailySearchForDate('NABIL', today), false);
    assert.equal(kb.getDailySearchCountForDate(today), 0);

    kb.recordStockSearchToKb({
      store,
      vault,
      dateStr: today,
      research: {
        symbol: 'NABIL',
        companyName: 'Nabil Bank Limited',
        sector: 'Commercial Banks',
        generatedAt: '2026-11-28T06:00:00.000Z',
        retrievedAt: '2026-11-28T06:00:00.000Z',
        dataStatus: 'Live',
        model: 'test-model',
        cached: false,
        reportingPeriod: 'Q1 FY 2083/84',
        publicationDate: today,
        reportType: 'Quarterly',
        limitations: [],
        recommendation: 'BUY',
        riskScore: 35,
        opportunityScore: 76,
        riskBreakdown: [],
        opportunityBreakdown: [],
        fundamentalRedFlags: [],
        governanceRegulatoryFlags: ['NRB credit directive compliance'],
        summary: 'Asset quality improving with steady CASA franchise.',
        stance: 'Bullish',
        opportunities: [
          {
            title: 'ICRA NP-IR AA- rating support',
            detail: 'Lower cost of funds supporting net interest margin expansion.',
            impact: 'High',
            evidence: 'CASA deposit growth and benign NPL ratio.',
          },
        ],
        risks: [
          {
            title: 'SME portfolio pressure',
            detail: 'Monitor SME lending quota compliance across Q2.',
            impact: 'Medium',
            evidence: 'NRB regulatory lending mix threshold.',
          },
        ],
        macroLinkage: 'Supports private sector credit growth.',
        catalysts: [{ headline: 'Q2 earnings release', timeframe: 'Next 60 days' }],
        sources: [{ title: 'ICRA Nepal Rating', uri: 'https://www.icranepal.com/nabil' }],
      },
    });

    assert.equal(kb.hasDailySearchForDate('nabil', today), true);
    assert.equal(kb.hasDailySearchForDate('NABIL', tomorrow), false);
    assert.equal(kb.getDailySearchCountForDate(today), 1);

    const entry = kb.getCompanyEntry('NABIL');
    assert.ok(entry);
    assert.ok(entry.tailwinds.some((t) => t.includes('ICRA NP-IR AA-')));
    assert.ok(entry.riskFlags.some((r) => r.includes('NRB credit directive')));
    assert.ok(entry.citations.some((c) => c.agency === 'ICRA'));

    // Re-loading from disk preserves dailySearchDates & company KB entry
    const kbReloaded = new RegulatoryKnowledgeBase(tmpDir);
    kbReloaded.initIfNeeded();
    assert.equal(kbReloaded.hasDailySearchForDate('NABIL', today), true);
    assert.equal(kbReloaded.getDailySearchCountForDate(today), 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('DailyScheduler executes scheduled KB crawl at most once per day and skips repeat scheduled runs', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-sched-daily-'));
  let scheduler: DailyScheduler | null = null;
  try {
    // Seed pre-existing scheduler.json with enabled=false & sourceMode=github (no repo) so no background startup timer or cron runs
    fs.writeFileSync(
      path.join(tmpDir, 'scheduler.json'),
      JSON.stringify({
        config: {
          enabled: false,
          time: '15:40',
          timezone: 'Asia/Kathmandu',
          days: [1, 2, 3, 4, 5],
          retryIfNotUpdated: false,
          retryDelayMinutes: 20,
          sourceMode: 'github',
          githubRepo: '',
          githubBranch: 'main',
          githubDataPath: 'data',
          pushToGitHub: false,
          crawlKbDaily: true,
          autoCrawlOnSearch: true,
          autoPushOnSearchUpdate: false,
        },
        history: [],
        lastKbCrawlDate: null,
        lastGitHubPushDate: null,
        lastGitHubPushAt: null,
      }),
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    scheduler = new DailyScheduler(store);

    let kbRunCount = 0;
    let lastDateStr = '';
    scheduler.setDailyKbHandler(async () => {
      kbRunCount += 1;
      lastDateStr = '2026-11-28';
      return {
        skipped: false,
        addedNotices: 2,
        companiesUpdated: 1,
        enrichedSymbols: ['NABIL'],
        annualDistilledSymbols: [],
        quarterlyRefreshed: [],
        warnings: [],
        date: lastDateStr,
      };
    });

    await scheduler.pullLatest('scheduled');
    assert.equal(kbRunCount, 1);

    // Second scheduled run on the same calendar day must skip KB crawl
    const secondLog = await scheduler.pullLatest('scheduled');
    assert.equal(kbRunCount, 1);
    assert.match(secondLog.message, /KB crawl: already completed today/i);
  } finally {
    if (scheduler?.getStatus().config.enabled) {
      scheduler.updateConfig({ enabled: false });
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeQ4ThreeYearBenchmark averages 3 years of Q4 data and integrates into buildExplorerOverview', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-q4-explorer-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-27.csv'),
      'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low\nNTC,Nepal Doorsanchar Company Limited,890,905,885,900,895,5,0.56,15000,13500000,900,1020,820\n',
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();

    const makeQ4 = (fy: string, eps: number, roe: number, revCr: number, opCr: number, npCr: number): CompanyFinancialSnapshot => ({
      symbol: 'NTC',
      companyName: 'Nepal Doorsanchar Company Limited',
      sector: 'Others',
      companyId: '150',
      scrapedAt: '2026-11-27T06:00:00.000Z',
      sourceUrl: 'https://example.com/ntc',
      periods: [`4th Quarter ${fy}`],
      tabs: [
        {
          key: 'profit_loss',
          title: 'Profit and Loss',
          headers: ["Particulars (Rs. in '000)", `4th Quarter ${fy}`],
          rows: [
            { section: 'Income', isSectionHeader: false, particulars: 'Revenue', values: [String(revCr * 10_000)], numericValues: [revCr * 10_000] },
            { section: 'Profit', isSectionHeader: false, particulars: 'Operating Profit', values: [String(opCr * 10_000)], numericValues: [opCr * 10_000] },
            { section: 'Profit', isSectionHeader: false, particulars: 'Profit for the period', values: [String(npCr * 10_000)], numericValues: [npCr * 10_000] },
          ],
        },
        {
          key: 'balance_sheet',
          title: 'Balance Sheet',
          headers: ["Particulars (Rs. in '000)", `4th Quarter ${fy}`],
          rows: [
            { section: 'Equity', isSectionHeader: false, particulars: "Total Shareholder's Equity", values: ['90000000'], numericValues: [90_000_000] },
            { section: 'Assets', isSectionHeader: false, particulars: 'Total Assets', values: ['140000000'], numericValues: [140_000_000] },
          ],
        },
        {
          key: 'key_metrics',
          title: 'Key Metrics',
          headers: ['Particulars', `4th Quarter ${fy}`],
          rows: [
            { section: 'Ratios', isSectionHeader: false, particulars: 'Basic Earnings Per Share', values: [String(eps)], numericValues: [eps] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Net Worth Per Share', values: ['510'], numericValues: [510] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Return on Equity', values: [String(roe)], numericValues: [roe] },
          ],
        },
      ],
    });

    for (const [fy, eps, roe, revCr, opCr, npCr] of [
      ['2080/81', 38, 10.5, 4200, 900, 680],
      ['2081/82', 41, 11.5, 4400, 960, 740],
      ['2082/83', 47, 13.0, 4800, 1140, 860],
    ] as const) {
      for (const rec of normalizeShareSansarSnapshot(makeQ4(fy, eps, roe, revCr, opCr, npCr))) {
        vault.upsertStatementRecord(rec);
      }
    }

    const ledger = vault.getCompanyLedger('NTC')!;
    const bench = computeQ4ThreeYearBenchmark(ledger.records);
    assert.ok(bench);
    assert.equal(bench.yearsCount, 3);
    assert.equal(bench.avgEps, 42); // (38 + 41 + 47) / 3 = 42
    assert.equal(bench.avgOperatingProfitCr, 1000); // (900 + 960 + 1140) / 3 = 1000
    assert.equal(bench.avgRoePct, 11.67); // (10.5 + 11.5 + 13) / 3 = 11.67

    const explorer = buildExplorerOverview({ store, vault, symbol: 'NTC' });
    assert.equal(explorer.symbol, 'NTC');
    assert.ok(explorer.fundamental);
    assert.ok(explorer.decisionPlaybook.pillars.length >= 3);
    assert.ok(explorer.fundamental.growth.q4Benchmark);

    const screener = evaluateScreenerUniverse(store, vault, { equityOnly: true });
    const ntcRow = screener.rows.find((r) => r.symbol === 'NTC')!;
    assert.ok(ntcRow);
    assert.equal(ntcRow.keyMetrics.q4AvgYearsCount, 3);
    assert.equal(ntcRow.keyMetrics.q4AvgEps3y, 42);
    assert.equal(ntcRow.keyMetrics.q4AvgOperatingProfitCr3y, 1000);
    assert.equal(ntcRow.keyMetrics.q4AvgRoePct3y, 11.67);
    assert.equal(ntcRow.keyMetrics.q4AnnualizedOpProfitCr, 1140);
    assert.equal(ntcRow.keyMetrics.operatingProfitVsQ4Avg3yPct, 14);

    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();
    const master = computeMasterScreener(store, vault, kb, { equityOnly: true });
    const ntcMaster = master.rows.find((r) => r.symbol === 'NTC')!;
    assert.ok(ntcMaster);
    assert.equal(ntcMaster.earnings.q4AvgYearsCount, 3);
    assert.equal(ntcMaster.earnings.q4AvgEps3y, 42);
    assert.equal(ntcMaster.earnings.q4AvgOperatingProfitCr3y, 1000);
    assert.equal(ntcMaster.earnings.operatingProfitVsQ4Avg3yPct, 14);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Non-operating investment/property gains trigger One-Off Caution and anchor valuation/scoring on Operating Profit', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-op-caution-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-27.csv'),
      [
        'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low',
        'ONEFF,OneOff Cement Limited,540,550,535,545,540,5,0.93,12000,6540000,545,620,460',
        'CORECO,Core Hydro Limited,490,505,488,500,495,5,1.01,14000,7000000,500,560,410',
      ].join('\n') + '\n',
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();
    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();

    const makeSnapshot = (params: {
      symbol: string;
      name: string;
      sector: string;
      fy: string;
      qLabel: string;
      revCr: number;
      opProfitCr: number;
      netProfitCr: number;
      eps: number;
      gainOnInvCr?: number;
    }): CompanyFinancialSnapshot => ({
      symbol: params.symbol,
      companyName: params.name,
      sector: params.sector,
      companyId: params.symbol === 'ONEFF' ? '201' : '202',
      scrapedAt: '2026-11-27T06:00:00.000Z',
      sourceUrl: `https://example.com/${params.symbol.toLowerCase()}`,
      periods: [`${params.qLabel} ${params.fy}`],
      tabs: [
        {
          key: 'profit_loss',
          title: 'Profit and Loss',
          headers: ["Particulars (Rs. in '000)", `${params.qLabel} ${params.fy}`],
          rows: [
            { section: 'Income', isSectionHeader: false, particulars: 'Revenue from operations', values: [String(params.revCr * 10_000)], numericValues: [params.revCr * 10_000] },
            { section: 'Profit', isSectionHeader: false, particulars: 'Operating Profit', values: [String(params.opProfitCr * 10_000)], numericValues: [params.opProfitCr * 10_000] },
            ...(params.gainOnInvCr
              ? [
                  {
                    section: 'Other',
                    isSectionHeader: false,
                    particulars: 'Gain on sale of investments and property',
                    values: [String(params.gainOnInvCr * 10_000)],
                    numericValues: [params.gainOnInvCr * 10_000],
                  },
                ]
              : []),
            { section: 'Profit', isSectionHeader: false, particulars: 'Net Profit', values: [String(params.netProfitCr * 10_000)], numericValues: [params.netProfitCr * 10_000] },
          ],
        },
        {
          key: 'balance_sheet',
          title: 'Balance Sheet',
          headers: ["Particulars (Rs. in '000)", `${params.qLabel} ${params.fy}`],
          rows: [
            { section: 'Equity', isSectionHeader: false, particulars: 'Share Capital', values: ['20000000'], numericValues: [20_000_000] },
            { section: 'Equity', isSectionHeader: false, particulars: "Total Shareholder's Equity", values: ['42000000'], numericValues: [42_000_000] },
            { section: 'Assets', isSectionHeader: false, particulars: 'Total Assets', values: ['70000000'], numericValues: [70_000_000] },
          ],
        },
        {
          key: 'key_metrics',
          title: 'Key Metrics',
          headers: ['Particulars', `${params.qLabel} ${params.fy}`],
          rows: [
            { section: 'Ratios', isSectionHeader: false, particulars: 'Basic Earnings Per Share', values: [String(params.eps)], numericValues: [params.eps] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Net Worth Per Share', values: ['210'], numericValues: [210] },
            { section: 'Ratios', isSectionHeader: false, particulars: 'Return on Equity', values: ['16.5'], numericValues: [16.5] },
          ],
        },
      ],
    });

    // ONEFF: Operating Profit stays flat (100 Cr -> 100 Cr, 0% YoY), while asset/investment sale (130 Cr) pushes Net Profit & EPS +95%
    for (const [fy, qLabel, revCr, opCr, npCr, eps, gainCr] of [
      ['2082/83', '1st Quarter', 600, 100, 75, 20, 0],
      ['2082/83', '4th Quarter', 610, 100, 76, 20.5, 0],
      ['2083/84', '1st Quarter', 605, 100, 146.25, 39, 130],
    ] as const) {
      for (const rec of normalizeShareSansarSnapshot(
        makeSnapshot({
          symbol: 'ONEFF',
          name: 'OneOff Cement Limited',
          sector: 'Manufacturing And Processing',
          fy,
          qLabel,
          revCr,
          opProfitCr: opCr,
          netProfitCr: npCr,
          eps,
          gainOnInvCr: gainCr > 0 ? gainCr : undefined,
        })
      )) {
        vault.upsertStatementRecord(rec);
      }
    }

    // CORECO: Operating Profit exceeds Net Profit and both grow steadily (+20% YoY) without non-operating inflation
    for (const [fy, qLabel, revCr, opCr, npCr, eps] of [
      ['2082/83', '1st Quarter', 500, 150, 100, 22],
      ['2082/83', '4th Quarter', 540, 165, 110, 24],
      ['2083/84', '1st Quarter', 600, 180, 120, 26.4],
    ] as const) {
      for (const rec of normalizeShareSansarSnapshot(
        makeSnapshot({
          symbol: 'CORECO',
          name: 'Core Hydro Limited',
          sector: 'Hydro Power',
          fy,
          qLabel,
          revCr,
          opProfitCr: opCr,
          netProfitCr: npCr,
          eps,
        })
      )) {
        vault.upsertStatementRecord(rec);
      }
    }

    const oneOffLedger = vault.getCompanyLedger('ONEFF')!;
    const oneOffGrowth = computeGrowthComparisons(oneOffLedger.records);
    assert.equal(oneOffGrowth.operatingProfitYoyPct, 0);
    assert.ok((oneOffGrowth.epsYoyPct ?? 0) >= 90);
    assert.equal(oneOffGrowth.earningsQuality.status, 'One-Off Caution');
    assert.equal(oneOffGrowth.earningsQuality.hasNonOperatingCaution, true);
    assert.equal(oneOffGrowth.earningsQuality.focusMetric, 'Operating Profit');
    assert.ok((oneOffGrowth.earningsQuality.nonOperatingIncomeCr ?? 0) >= 100);
    assert.ok(oneOffGrowth.earningsQuality.cautionMessage);

    const oneOffVal = computeSectorValuation({
      record: oneOffLedger.records[0],
      growth: oneOffGrowth,
      currentPrice: 545,
      benchmarkFdRatePct: 6.5,
    });
    assert.ok(
      oneOffVal.limitations.some((l) => /Operating Profit|non-operating|one-off/i.test(l)),
      'Valuation limitations should flag non-operating earnings distortion'
    );

    const evaluated = evaluateScreenerUniverse(store, vault, { equityOnly: true });
    const oneOffRow = evaluated.rows.find((r) => r.symbol === 'ONEFF')!;
    const coreRow = evaluated.rows.find((r) => r.symbol === 'CORECO')!;

    assert.equal(oneOffRow.keyMetrics.earningsQuality.status, 'One-Off Caution');
    assert.equal(oneOffRow.keyMetrics.earningsQuality.hasNonOperatingCaution, true);
    assert.ok(
      oneOffRow.recommendation.downsideRisks.some((r) => /Operating Profit|non-operating/i.test(r))
    );

    assert.equal(coreRow.keyMetrics.earningsQuality.status, 'Core-Driven');
    assert.equal(coreRow.keyMetrics.earningsQuality.hasNonOperatingCaution, false);
    assert.ok((coreRow.keyMetrics.operatingProfitYoyPct ?? 0) >= 19);

    const oneOffDossier = buildCompanyValuationDossier(store, vault, kb, 'ONEFF', {
      equityOnly: true,
    });
    assert.ok(oneOffDossier);
    assert.ok(
      oneOffDossier.swot.weaknesses.some((w) => /Operating Profit|non-operating|one-off/i.test(w))
    );

    const oneOffExplorer = buildExplorerOverview({ store, vault, symbol: 'ONEFF' });
    assert.ok(
      oneOffExplorer.decisionPlaybook.riskPoints.some((r) =>
        /Operating Profit|non-operating|one-off/i.test(r)
      )
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('applyCorporateActionAdjustments scales pre-ex-date OHLC prices and leaves post-ex bars untouched', () => {
  const mkBar = (date: string, price: number): PriceRow => ({
    date,
    symbol: 'NABIL',
    name: 'Nabil Bank Limited',
    conf: null,
    open: price,
    high: price + 5,
    low: price - 5,
    close: price,
    ltp: price,
    close_ltp: 0,
    close_ltp_pct: 0,
    vwap: price,
    prev_close: price,
    diff: 0,
    diff_pct: 0,
    range_pct: 1.5,
    volume: 10000,
    turnover: price * 10000,
    trans: 100,
    w52_high: price + 40,
    w52_low: price - 40,
    d120: price,
    d180: price,
    price_range: 10,
    vwap_pct: 0,
  });

  const history: PriceRow[] = [
    mkBar('2026-10-01', 600),
    mkBar('2026-10-10', 625),
    mkBar('2026-10-15', 500),
    mkBar('2026-10-20', 515),
  ];

  const { adjustedHistory, applied } = applyCorporateActionAdjustments(history, [
    {
      id: 'ca_nabil_2026',
      symbol: 'NABIL',
      companyName: 'Nabil Bank Limited',
      fiscalYear: '2082/83',
      actionType: 'Dividend',
      bonusPct: 25,
      cashPct: 10,
      rightRatioPct: null,
      bookClosureDate: '2026-10-15',
      exDate: '2026-10-15',
      agmDate: '2026-11-01',
      status: 'Approved',
      headline: '25% Bonus & 10% Cash Dividend',
      sourceLabel: 'NEPSE Corporate Portal',
      sourceUrl: 'https://www.nepalstock.com/news',
      retrievedAt: '2026-10-05T00:00:00Z',
      method: 'Portal Feed',
    },
  ]);

  assert.equal(applied.length, 1);
  assert.equal(applied[0].factor, 0.8);
  // Pre-ex bars scaled by 1 / 1.25 = 0.8
  assert.equal(adjustedHistory[0].close, 480);
  assert.equal(adjustedHistory[1].close, 500);
  // On & after exDate unchanged
  assert.equal(adjustedHistory[2].close, 500);
  assert.equal(adjustedHistory[3].close, 515);
});

test('RegulatoryKnowledgeBase indexes corporate actions & lock-in events with tiers and exports corporate-actions-kb.csv', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-kb-actions-'));
  try {
    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();

    kb.upsertCorporateAction({
      id: 'ca_ebl_1',
      symbol: 'EBL',
      companyName: 'Everest Bank Limited',
      fiscalYear: '2082/83',
      actionType: 'Dividend',
      bonusPct: 10,
      cashPct: 5.53,
      rightRatioPct: null,
      bookClosureDate: '2026-12-10',
      exDate: '2026-12-10',
      agmDate: '2026-12-28',
      status: 'Proposed',
      headline: 'EBL proposes 10% Bonus and 5.53% Cash Dividend',
      sourceLabel: 'NEPSE Corporate Portal',
      sourceUrl: 'https://www.nepalstock.com/ebl',
      retrievedAt: '2026-11-28T00:00:00Z',
      method: 'Portal Feed',
    });

    kb.upsertLockInEvent({
      id: 'li_sah_1',
      symbol: 'SAHAS',
      companyName: 'Sahas Urja Limited',
      shareholderCategory: 'Promoter',
      unlockDate: '2026-12-12',
      lockedShares: 12000000,
      pctOfTotalShares: 35,
      headline: 'SAHAS 12,000,000 Promoter & Local Shares lock-in expires 2026-12-12',
      sourceLabel: 'CDSC',
      sourceUrl: 'https://cdsc.com.np/notice',
      retrievedAt: '2026-11-28T00:00:00Z',
      method: 'Portal Feed',
    });

    // Persist JSON + CSV via save()
    kb.setLastDailyCrawlDate('2026-11-28');

    const lockIns = kb.getLockInEvents('SAHAS', new Date('2026-11-28T00:00:00Z'));
    assert.equal(lockIns.length, 1);
    assert.equal(lockIns[0].daysRemaining, 14);
    assert.equal(lockIns[0].overhangTier, 'Critical (<30d)');

    const queried = kb.queryKnowledgeBase({ symbol: 'EBL' });
    assert.equal(queried.corporateActions.length, 1);
    assert.equal(queried.corporateActions[0].bonusPct, 10);

    const csvPath = path.join(tmpDir, 'financial', 'vault', 'corporate-actions-kb.csv');
    assert.ok(fs.existsSync(csvPath), 'corporate-actions-kb.csv should be written on save');
    const csvText = fs.readFileSync(csvPath, 'utf8');
    assert.match(csvText, /record_type,symbol,company_name/);
    assert.match(csvText, /CORPORATE_ACTION,EBL/);
    assert.match(csvText, /LOCK_IN_EXPIRY,SAHAS/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeSectorRotation tracks multi-horizon turnover share shifts and classifies rotation phases', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-sector-rot-'));
  try {
    const header = 'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low';
    // Generate 22 sessions: early 17 sessions favor NABIL (Commercial Banks), latest 5 sessions rotate strongly into SHPC (Hydro Power)
    const dates: string[] = [];
    for (let i = 1; i <= 22; i++) {
      const d = `2026-10-${String(i).padStart(2, '0')}`;
      dates.push(d);
      const isRecent5 = i > 17;
      const nabilTurn = isRecent5 ? 2_000_000 : 12_000_000;
      const nabilChg = isRecent5 ? -1.2 : 1.0;
      const nabilClose = isRecent5 ? 495 : 510;
      const shpcTurn = isRecent5 ? 18_000_000 : 2_500_000;
      const shpcChg = isRecent5 ? 4.2 : 0.2;
      const shpcClose = isRecent5 ? 360 + i : 340;
      fs.writeFileSync(
        path.join(tmpDir, `${d}.csv`),
        [
          header,
          `NABIL,Nabil Bank Limited,${nabilClose},${nabilClose + 3},${nabilClose - 3},${nabilClose},500,-6,${nabilChg},4000,${nabilTurn},${nabilClose},550,450`,
          `SHPC,Sanima Mai Hydropower Ltd.,${shpcClose},${shpcClose + 8},${shpcClose - 2},${shpcClose},340,14,${shpcChg},45000,${shpcTurn},${shpcClose},410,290`,
        ].join('\n') + '\n',
        'utf8'
      );
    }

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();

    const rot = computeSectorRotation(store, vault, { equityOnly: true });
    assert.equal(rot.datesUsed, 22);
    assert.ok(rot.sectors.length >= 2);
    const hydro = rot.sectors.find((s) => /Hydro/i.test(s.sector))!;
    const banks = rot.sectors.find((s) => /Bank/i.test(s.sector))!;
    assert.ok(hydro && banks);
    assert.ok(hydro.shareShift5vs20Pp > 0, 'Hydro should exhibit positive 5D vs 20D inflow shift');
    assert.ok(banks.shareShift5vs20Pp < 0, 'Banks should exhibit negative 5D vs 20D share shift');
    assert.equal(hydro.rotationPhase, 'Leading Inflow');
    assert.equal(banks.rotationPhase, 'Lagging Outflow');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('computeSignalScorecard evaluates causal 5D/10D/20D forward stats across multi-session market history', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-scorecard-'));
  try {
    const header = 'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,vwap,trans,w52_high,w52_low,d120';
    // Build 32 sessions with steadily trending NABIL & SAHAS triggering turnover surge / top-15 VWAP leaders
    for (let i = 1; i <= 32; i++) {
      const month = i <= 30 ? '10' : '11';
      const day = i <= 30 ? i : i - 30;
      const d = `2026-${month}-${String(day).padStart(2, '0')}`;
      const baseP = 400 + i * 3;
      const surge = i % 6 === 0;
      const nabilTurn = surge ? 25_000_000 : 7_000_000;
      const nabilVol = surge ? 60_000 : 16_000;
      fs.writeFileSync(
        path.join(tmpDir, `${d}.csv`),
        [
          header,
          `NABIL,Nabil Bank Limited,${baseP - 2},${baseP + 6},${baseP - 3},${baseP + 5},${baseP},5,1.8,${nabilVol},${nabilTurn},${baseP + 5},${baseP + 1},300,560,380,${baseP - 40}`,
          `ADBL,Agricultural Development Bank Limited,300,304,296,299,300,-1,-0.33,12000,3612000,299,301,120,340,260,290`,
        ].join('\n') + '\n',
        'utf8'
      );
    }

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();
    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();

    const scorecard = computeSignalScorecard(store, vault, kb, { equityOnly: true });
    assert.equal(scorecard.totalSessionsAnalyzed, 32);
    assert.ok(scorecard.evaluationCheckpoints >= 1);
    assert.equal(scorecard.cohorts.length, 5);
    assert.ok(scorecard.baselineByHorizon['5'].samples > 0);
    const leaders = scorecard.cohorts.find((c) => c.id === 'liquidity_leaders')!;
    assert.ok(leaders);
    assert.ok(leaders.statsByHorizon['5'].samples > 0);
    assert.ok((leaders.statsByHorizon['5'].winRatePct ?? 0) >= 80);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildExplorerOverview integrates KB entry, corporate actions, and lock-in expiry risks into playbook', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nepse-explorer-kb-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '2026-11-27.csv'),
      'symbol,name,open,high,low,close,prev_close,diff,diff_pct,volume,turnover,ltp,w52_high,w52_low\nEBL,Everest Bank Limited,600,610,595,605,600,5,0.83,20000,12100000,605,650,520\n',
      'utf8'
    );

    const store = new MarketStore(tmpDir);
    const vault = new FundamentalVault(tmpDir);
    vault.initIfNeeded();
    const kb = new RegulatoryKnowledgeBase(tmpDir);
    kb.initIfNeeded();

    const soonDate = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    kb.upsertCorporateAction({
      id: 'ca_ebl_exp',
      symbol: 'EBL',
      companyName: 'Everest Bank Limited',
      fiscalYear: '2082/83',
      actionType: 'Dividend',
      bonusPct: 15,
      cashPct: 5,
      rightRatioPct: null,
      bookClosureDate: soonDate,
      exDate: soonDate,
      agmDate: null,
      status: 'Approved',
      headline: '15% Bonus & 5% Cash Dividend',
      sourceLabel: 'NEPSE Corporate Portal',
      sourceUrl: null,
      retrievedAt: new Date().toISOString(),
      method: 'Portal Feed',
    });

    kb.upsertLockInEvent({
      id: 'li_ebl_exp',
      symbol: 'EBL',
      companyName: 'Everest Bank Limited',
      shareholderCategory: 'Promoter',
      unlockDate: soonDate,
      lockedShares: 5000000,
      pctOfTotalShares: 18,
      headline: 'Promoter lock-in expires soon',
      sourceLabel: 'CDSC',
      sourceUrl: null,
      retrievedAt: new Date().toISOString(),
      method: 'Portal Feed',
    });

    const overview = buildExplorerOverview({ store, vault, kb, symbol: 'EBL', equityOnly: true });
    assert.equal(overview.corporateActions.length, 1);
    assert.equal(overview.lockInEvents.length, 1);
    assert.ok(
      overview.decisionPlaybook.riskPoints.some((r) => /lock-in\s+(?:expiry|expires|overhang)/i.test(r)),
      'Playbook risk points should highlight imminent lock-in expiry'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


