import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FundamentalMonitorService } from '../server/fundamental/fundamentalCollector.ts';
import {
  buildSpreadsheetExport,
  computeGrowthComparisons,
  FundamentalVault,
  normalizeShareSansarSnapshot,
} from '../server/fundamental/fundamentalVault.ts';
import { evaluateScreenerUniverse } from '../server/fundamental/investorScoringEngine.ts';
import {
  getActiveNepalFiscalQuarter,
  getUpcomingNepalFiscalQuarter,
  parseNepalPeriodLabel,
} from '../server/fundamental/nepalCalendar.ts';
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
