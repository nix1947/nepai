import path from 'path';
import { fileURLToPath } from 'url';
import { MarketStore } from '../server/marketStore.ts';
import { ShareSansarClient } from '../server/scraper.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');

async function main() {
  const store = new MarketStore(dataDir);
  const scraper = new ShareSansarClient();
  const { date, rows } = await scraper.fetchLatest();
  const saved = store.saveDayRows(date, rows);
  console.log(`Saved ${saved} rows to data/${date}.csv`);
}

main().catch((err) => {
  console.error('ShareSansar daily pull failed:', err);
  process.exit(1);
});
