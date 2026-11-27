import path from 'path';
import { fileURLToPath } from 'url';
import { MarketStore } from '../server/marketStore.ts';
import { ShareSansarClient } from '../server/scraper.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');

function getKathmanduToday(): { dateStr: string; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday || '',
  };
}

async function main() {
  const { dateStr: todayNpt, weekday } = getKathmanduToday();
  if (weekday === 'Sun' || weekday === 'Sat') {
    console.log(`[Off Day] Market closed on ${weekday} (${todayNpt} NPT). Skipping ShareSansar pull.`);
    return;
  }

  const store = new MarketStore(dataDir);
  const scraper = new ShareSansarClient();
  const res = await scraper.fetchLatestOrHoliday();

  if (res.status === 'no_data') {
    console.log(`[Holiday / No Data] ${res.reason}. Skipping CSV write cleanly.`);
    return;
  }

  if (res.date < todayNpt && store.hasDate(res.date)) {
    console.log(
      `[Holiday / Stale Feed] ShareSansar still displays ${res.date} (today in Kathmandu is ${todayNpt}) and data/${res.date}.csv is already saved. Skipping.`
    );
    return;
  }

  const saved = store.saveDayRows(res.date, res.rows);
  console.log(`Saved ${saved} rows to data/${res.date}.csv`);
}

main().catch((err) => {
  console.error('ShareSansar daily pull failed:', err);
  process.exit(1);
});
