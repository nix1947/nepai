import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCompanyValuationDossier,
  getValuationUniverseSummary,
} from '../server/fundamental/annualValuationEngine.ts';
import { FundamentalMonitorService } from '../server/fundamental/fundamentalCollector.ts';
import {
  buildSpreadsheetExport,
  computeGrowthComparisons,
  FundamentalVault,
  normalizeShareSansarSnapshot,
} from '../server/fundamental/fundamentalVault.ts';
import { evaluateHiddenGems } from '../server/fundamental/hiddenGemsEngine.ts';
import { evaluateScreenerUniverse } from '../server/fundamental/investorScoringEngine.ts';
import { computeMasterScreener } from '../server/fundamental/masterScreenerEngine.ts';
import {
  getActiveNepalFiscalQuarter,
  getUpcomingNepalFiscalQuarter,
  parseNepalPeriodLabel,
} from '../server/fundamental/nepalCalendar.ts';
import { RegulatoryKnowledgeBase } from '../server/fundamental/regulatoryKnowledgeBase.ts';
import { computeSectorValuation } from '../server/fundamental/sectorMethodology.ts';
import { MarketStore } from '../server/marketStore.ts';
import {
  buildFinancialCsv,
  mergeFinancialSnapshots,
  type CompanyFinancialSnapshot,
} from '../server/financialScraper.ts';
import { evaluateLatestHtml } from '../server/scraper.ts';

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

