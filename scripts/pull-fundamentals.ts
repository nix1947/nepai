import path from 'path';
import { fileURLToPath } from 'url';
import { FundamentalMonitorService } from '../server/fundamental/fundamentalCollector.ts';
import { FundamentalVault } from '../server/fundamental/fundamentalVault.ts';
import {
  getActiveNepalFiscalQuarter,
  getUpcomingNepalFiscalQuarter,
} from '../server/fundamental/nepalCalendar.ts';
import { MarketStore } from '../server/marketStore.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.NEPSE_DATA
  ? path.resolve(process.env.NEPSE_DATA)
  : path.resolve(__dirname, '..', 'data');

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith('--mode='))?.split('=')[1] || 'due';
  const rawLimit = args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '150';
  const limitArg =
    rawLimit.toLowerCase() === 'all' || Number(rawLimit) <= 0
      ? Number.POSITIVE_INFINITY
      : Number(rawLimit);
  const delayDaysArg = Number(
    args.find((a) => a.startsWith('--delay-days='))?.split('=')[1] || '15'
  );
  const concurrencyArg = Number(
    args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] || '3'
  );
  const symbolArg = args.find((a) => a.startsWith('--symbol='))?.split('=')[1];
  const force = args.includes('--force');
  const crossValidate = args.includes('--cross-validate');

  const delayDays = Number.isFinite(delayDaysArg)
    ? Math.max(0, Math.min(45, Math.round(delayDaysArg)))
    : 15;
  const concurrency = Number.isFinite(concurrencyArg)
    ? Math.max(1, Math.min(4, Math.round(concurrencyArg)))
    : 3;

  const store = new MarketStore(DATA_DIR);
  const vault = new FundamentalVault(DATA_DIR);
  const monitor = new FundamentalMonitorService(store, vault, { enableCron: false });

  const activeQ = getActiveNepalFiscalQuarter(new Date(), delayDays);
  const upcomingQ = getUpcomingNepalFiscalQuarter(new Date(), delayDays);
  console.log(
    `[Fundamental Pull] Current Quarter: ${activeQ.quarter} FY ${activeQ.fiscalYear} | Check start (+${delayDays}d): ${activeQ.checkStartDate} | Due now: ${activeQ.isDueNow}`
  );
  console.log(
    `[Fundamental Pull] Upcoming Quarter: ${upcomingQ.quarter} FY ${upcomingQ.fiscalYear} | Scheduled start (+${delayDays}d): ${upcomingQ.checkStartDate}`
  );

  if (symbolArg) {
    const res = await monitor.refreshSymbol(symbolArg, 'cli', crossValidate, {
      force,
      fiscalYear: activeQ.fiscalYear,
      quarter: activeQ.quarter,
    });
    if (res.skipped) {
      console.log(
        `[Fundamental Pull] ${res.symbol}: skipped (${activeQ.quarter} FY ${activeQ.fiscalYear} data already exists).`
      );
    } else {
      console.log(
        `[Fundamental Pull] ${res.symbol}: ${res.periodsAdded} period(s) saved (${res.validationStatus}).`
      );
    }
    return;
  }

  if (modeArg === 'due' && !activeQ.isDueNow && !force) {
    console.log(
      `[Fundamental Pull] Quarter-end + ${delayDays}-day reporting window (${activeQ.checkStartDate}) not reached yet. Pass --force to override.`
    );
    return;
  }

  const dates = store.getDates();
  const latestDay = dates[dates.length - 1];
  const universe = latestDay
    ? store
        .getDayPrices(latestDay, true)
        .sort((a, b) => b.turnover - a.turnover)
        .map((r) => r.symbol.toUpperCase())
    : vault.getAllLedgers().map((l) => l.symbol);

  const candidates =
    modeArg === 'top' ? universe.slice(0, Math.min(universe.length, 50)) : universe;

  let skippedExisting = 0;
  const missing = candidates.filter((sym) => {
    if (force) return true;
    const exists = vault.hasQuarterData(sym, activeQ.fiscalYear, activeQ.quarter);
    if (exists) {
      skippedExisting++;
      return false;
    }
    return true;
  });

  const selected = Number.isFinite(limitArg)
    ? missing.slice(0, Math.max(1, limitArg))
    : missing;

  console.log(
    `[Fundamental Pull] Skipped ${skippedExisting} company(ies) that already have ${activeQ.quarter} FY ${activeQ.fiscalYear} data.`
  );

  if (selected.length === 0) {
    console.log(
      `[Fundamental Pull] All target companies already have ${activeQ.quarter} FY ${activeQ.fiscalYear} data. Nothing to scrape.`
    );
    return;
  }

  console.log(
    `[Fundamental Pull] Batch pulling ${selected.length} pending company(ies) via ShareSansar (concurrency=${concurrency})...`
  );

  let ok = 0;
  let skippedInRun = 0;
  let fail = 0;
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= selected.length) break;
      const sym = selected[idx];
      try {
        const r = await monitor.refreshSymbol(sym, 'cli', crossValidate, {
          force,
          fiscalYear: activeQ.fiscalYear,
          quarter: activeQ.quarter,
        });
        if (r.skipped) {
          skippedInRun++;
          console.log(`  SKIP ${sym}: already exists`);
        } else {
          ok++;
          console.log(
            `  OK   [${ok + fail + skippedInRun}/${selected.length}] ${sym}: ${r.entry.latestQuarter ?? '?'} ${r.entry.latestFiscalYear ?? ''} (${r.periodsAdded} period(s), ${r.validationStatus})`
          );
        }
      } catch (err) {
        fail++;
        console.log(
          `  ERR  [${ok + fail + skippedInRun}/${selected.length}] ${sym}: ${err instanceof Error ? err.message : 'failed'}`
        );
      }
      await new Promise((r) => setTimeout(r, 180));
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

  const csvOut = vault.writeConsolidatedQuarterlyCsv();
  console.log(
    `[Fundamental Pull] Finished: ${ok} populated, ${skippedExisting + skippedInRun} skipped (already existed), ${fail} unavailable/failed.`
  );
  console.log(`[Fundamental Pull] Consolidated multi-quarter CSV updated: ${csvOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
