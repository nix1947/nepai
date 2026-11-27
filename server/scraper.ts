import * as cheerio from 'cheerio';
import type { PriceRow } from '../src/types/market.ts';
import { isValidDateStr } from './marketStore.ts';

const SHARESANSAR_TODAY_URL = 'https://www.sharesansar.com/today-share-price';
const SHARESANSAR_AJAX_URL = 'https://www.sharesansar.com/ajaxtodayshareprice';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface SessionContext {
  token: string;
  cookieHeader: string;
  latestHtml: string;
}

function cleanNumber(raw: string): number | null {
  const s = raw.replace(/,/g, '').replace(/%/g, '').trim();
  if (!s || s === '-' || s === 'N/A' || s === '--') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function extractCookies(res: Response): string {
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') {
    const rawCookies = anyHeaders.getSetCookie();
    if (rawCookies.length > 0) {
      return rawCookies.map((c) => c.split(';')[0]).join('; ');
    }
  }
  const single = res.headers.get('set-cookie');
  if (!single) return '';
  return single
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((c) => c.split(';')[0].trim())
    .join('; ');
}

function extractDateFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  // Check hidden/input date field or heading text
  const inputVal = $('input[name="date"]').attr('value') || $('#fromdate').attr('value') || '';
  if (isValidDateStr(inputVal.trim())) return inputVal.trim();

  const textCandidates = [
    $('h5').text(),
    $('.text-org').text(),
    $('span.text-org').text(),
    $('#headFixed').prevAll().text(),
    $.text(),
  ];

  for (const txt of textCandidates) {
    const match = txt.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (match && isValidDateStr(match[1])) {
      return match[1];
    }
  }
  return null;
}

function parsePriceTable(html: string, dateStr: string): PriceRow[] {
  const $ = cheerio.load(html);
  const table = $('#headFixed').length ? $('#headFixed') : $('table').first();
  if (!table.length) return [];

  const headerCells: string[] = [];
  table
    .find('thead tr')
    .last()
    .find('th')
    .each((_, el) => {
      headerCells.push(normalizeHeader($(el).text()));
    });

  const findCol = (candidates: string[]): number => {
    for (const c of candidates) {
      const idx = headerCells.indexOf(c);
      if (idx !== -1) return idx;
    }
    for (const c of candidates) {
      const idx = headerCells.findIndex((h) => h.includes(c));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const cSym = findCol(['symbol']);
  if (cSym === -1) return [];

  const cConf = findCol(['conf']);
  const cOpen = findCol(['open']);
  const cHigh = findCol(['high']);
  const cLow = findCol(['low']);
  const cClose = findCol(['close']);
  const cLtp = findCol(['ltp']);
  const cCloseLtp = findCol(['close ltp']);
  const cCloseLtpPct = findCol(['close ltp %', 'close ltp pct']);
  const cVwap = findCol(['vwap']);
  const cVol = findCol(['vol', 'volume', 'qty']);
  const cPrev = findCol(['prev close', 'previous close']);
  const cTurn = findCol(['turnover']);
  const cTrans = findCol(['trans', 'transactions']);
  const cDiff = findCol(['diff']);
  const cRange = findCol(['range']);
  const cDiffPct = findCol(['diff %', 'diff pct']);
  const cRangePct = findCol(['range %', 'range pct']);
  const cVwapPct = findCol(['vwap %', 'vwap pct']);
  const c120 = findCol(['120 days', 'd120']);
  const c180 = findCol(['180 days', 'd180']);
  const c52H = findCol(['52 weeks high', '52w high']);
  const c52L = findCol(['52 weeks low', '52w low']);

  const rows: PriceRow[] = [];
  const seen = new Set<string>();

  table.find('tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;

    const text = (idx: number) => (idx >= 0 && idx < tds.length ? $(tds[idx]).text().trim() : '');
    const symCell = tds.eq(cSym);
    const symbol = symCell.text().trim().toUpperCase();
    if (!symbol || symbol.includes('NO RECORD') || seen.has(symbol)) return;
    seen.add(symbol);

    const anchorTitle = symCell.find('a').attr('title')?.trim() || '';
    const close = cleanNumber(text(cClose)) ?? 0;
    const ltp = cleanNumber(text(cLtp)) ?? close;
    const prevClose = cleanNumber(text(cPrev)) ?? close;
    const open = cleanNumber(text(cOpen)) ?? close;
    const high = cleanNumber(text(cHigh)) ?? close;
    const low = cleanNumber(text(cLow)) ?? close;
    const vol = Math.round(cleanNumber(text(cVol)) ?? 0);
    const turnover = cleanNumber(text(cTurn)) ?? 0;
    const trans = Math.round(cleanNumber(text(cTrans)) ?? 0);
    const diff = cleanNumber(text(cDiff)) ?? (prevClose ? Math.round((close - prevClose) * 100) / 100 : 0);
    const diffPct =
      cleanNumber(text(cDiffPct)) ??
      (prevClose > 0 ? Math.round((diff / prevClose) * 10000) / 100 : 0);

    rows.push({
      date: dateStr,
      symbol,
      name: anchorTitle,
      conf: cleanNumber(text(cConf)),
      open,
      high,
      low,
      close,
      ltp,
      close_ltp: cleanNumber(text(cCloseLtp)),
      close_ltp_pct: cleanNumber(text(cCloseLtpPct)),
      vwap: cleanNumber(text(cVwap)),
      volume: vol,
      prev_close: prevClose,
      turnover,
      trans,
      diff,
      price_range: cleanNumber(text(cRange)),
      diff_pct: diffPct,
      range_pct: cleanNumber(text(cRangePct)),
      vwap_pct: cleanNumber(text(cVwapPct)),
      d120: cleanNumber(text(c120)),
      d180: cleanNumber(text(c180)),
      w52_high: cleanNumber(text(c52H)),
      w52_low: cleanNumber(text(c52L)),
    });
  });

  return rows;
}

export class ShareSansarClient {
  private async initSession(): Promise<SessionContext> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(SHARESANSAR_TODAY_URL, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Market feed returned HTTP ${res.status}`);
      }
      const html = await res.text();
      const $ = cheerio.load(html);
      const token =
        $('meta[name="csrf-token"]').attr('content') ||
        $('input[name="_token"]').attr('value') ||
        '';
      const cookieHeader = extractCookies(res);
      return { token, cookieHeader, latestHtml: html };
    } finally {
      clearTimeout(timer);
    }
  }

  public async fetchLatest(): Promise<{ date: string; rows: PriceRow[] }> {
    const session = await this.initSession();
    const dateStr = extractDateFromHtml(session.latestHtml);
    if (!dateStr) {
      throw new Error('Could not determine the trading date from market feed page.');
    }
    const rows = parsePriceTable(session.latestHtml, dateStr);
    if (rows.length === 0) {
      throw new Error(`Market feed returned 0 rows for ${dateStr}.`);
    }
    return { date: dateStr, rows };
  }

  public async fetchByDate(
    dateStr: string,
    existingSession?: SessionContext
  ): Promise<{ date: string; rows: PriceRow[]; session: SessionContext }> {
    if (!isValidDateStr(dateStr)) {
      throw new Error(`Invalid date format: ${dateStr}`);
    }
    const session = existingSession ?? (await this.initSession());
    if (!session.token) {
      throw new Error('Could not extract CSRF token for historical query.');
    }

    const body = new URLSearchParams({
      _token: session.token,
      sector: 'all_sec',
      date: dateStr,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(SHARESANSAR_AJAX_URL, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: SHARESANSAR_TODAY_URL,
          Origin: 'https://www.sharesansar.com',
          ...(session.cookieHeader ? { Cookie: session.cookieHeader } : {}),
        },
        body: body.toString(),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Market feed AJAX returned HTTP ${res.status} for ${dateStr}`);
      }

      const html = await res.text();
      if (/no record found/i.test(html)) {
        return { date: dateStr, rows: [], session };
      }

      const rows = parsePriceTable(html, dateStr);
      return { date: dateStr, rows, session };
    } finally {
      clearTimeout(timer);
    }
  }

  public async createSession(): Promise<SessionContext> {
    return this.initSession();
  }
}
