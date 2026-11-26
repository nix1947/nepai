import fs from 'fs';
import path from 'path';
import type {
  DailyAggregate,
  MarketPulseResponse,
  MarketPulseRow,
  MarketPulseSummary,
  PriceRow,
  RangeSummaryRow,
  ScannerKind,
  ScannerResultRow,
  SymbolInfo,
  WeeklyTopRow,
} from '../src/types/market.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIGIT_RE = /\d/;

export const CSV_HEADERS = [
  'symbol',
  'name',
  'conf',
  'open',
  'high',
  'low',
  'close',
  'ltp',
  'close_ltp',
  'close_ltp_pct',
  'vwap',
  'vol',
  'prev_close',
  'turnover',
  'trans',
  'diff',
  'range',
  'diff_pct',
  'range_pct',
  'vwap_pct',
  'd120',
  'd180',
  'w52_high',
  'w52_low',
] as const;

export function isValidDateStr(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const parsed = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(d);
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function escapeCsvField(val: string | number | null | undefined): string {
  if (val === null || val === undefined || (typeof val === 'number' && Number.isNaN(val))) {
    return '';
  }
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toNum(val: string | undefined, fallback: number | null = null): number | null {
  if (val === undefined || val === null) return fallback;
  const cleaned = val.replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === 'N/A' || cleaned === 'NaN') return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clip(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export class MarketStore {
  public readonly dataDir: string;
  private byDate = new Map<string, PriceRow[]>();
  private bySymbol = new Map<string, PriceRow[]>();
  private sortedDates: string[] = [];

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir);
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.reloadAll();
  }

  private safeFilePath(dateStr: string): string {
    if (!isValidDateStr(dateStr)) {
      throw new Error(`Invalid date format: ${dateStr}`);
    }
    const resolved = path.resolve(this.dataDir, `${dateStr}.csv`);
    if (!resolved.startsWith(this.dataDir + path.sep)) {
      throw new Error('Unsafe file path rejected');
    }
    return resolved;
  }

  public reloadAll(): number {
    this.byDate.clear();
    this.bySymbol.clear();
    this.sortedDates = [];

    if (!fs.existsSync(this.dataDir)) return 0;
    const files = fs.readdirSync(this.dataDir).filter((f) => f.endsWith('.csv')).sort();
    let totalRows = 0;

    for (const file of files) {
      const stem = file.slice(0, -4);
      if (!isValidDateStr(stem)) continue;
      const fullPath = this.safeFilePath(stem);
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const rows = this.parseCsvContent(raw, stem);
      if (rows.length > 0) {
        this.byDate.set(stem, rows);
        totalRows += rows.length;
      }
    }

    this.rebuildIndexes();
    return totalRows;
  }

  private rebuildIndexes(): void {
    this.sortedDates = Array.from(this.byDate.keys()).sort();
    this.bySymbol.clear();
    for (const d of this.sortedDates) {
      const rows = this.byDate.get(d) || [];
      for (const r of rows) {
        let list = this.bySymbol.get(r.symbol);
        if (!list) {
          list = [];
          this.bySymbol.set(r.symbol, list);
        }
        list.push(r);
      }
    }
  }

  public parseCsvContent(raw: string, dateStr: string): PriceRow[] {
    const lines = raw
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headerFields = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idx = (names: string[]): number => {
      for (const name of names) {
        const i = headerFields.indexOf(name);
        if (i !== -1) return i;
      }
      return -1;
    };

    const iSym = idx(['symbol', 'ticker']);
    if (iSym === -1) return [];

    const iName = idx(['name', 'company', 'company_name']);
    const iConf = idx(['conf']);
    const iOpen = idx(['open']);
    const iHigh = idx(['high']);
    const iLow = idx(['low']);
    const iClose = idx(['close']);
    const iLtp = idx(['ltp']);
    const iCloseLtp = idx(['close_ltp', 'close - ltp']);
    const iCloseLtpPct = idx(['close_ltp_pct', 'close - ltp %']);
    const iVwap = idx(['vwap']);
    const iVol = idx(['vol', 'volume', 'qty']);
    const iPrev = idx(['prev_close', 'prev. close', 'previous close']);
    const iTurn = idx(['turnover']);
    const iTrans = idx(['trans', 'transactions']);
    const iDiff = idx(['diff']);
    const iRange = idx(['range', 'price_range']);
    const iDiffPct = idx(['diff_pct', 'diff %']);
    const iRangePct = idx(['range_pct', 'range %']);
    const iVwapPct = idx(['vwap_pct', 'vwap %']);
    const iD120 = idx(['d120', '120 days']);
    const iD180 = idx(['d180', '180 days']);
    const iW52H = idx(['w52_high', '52 weeks high']);
    const iW52L = idx(['w52_low', '52 weeks low']);

    const rows: PriceRow[] = [];
    const seen = new Set<string>();

    for (let li = 1; li < lines.length; li++) {
      const f = parseCsvLine(lines[li]);
      const symbol = (f[iSym] || '').trim().toUpperCase();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);

      const close = toNum(f[iClose], 0) ?? 0;
      const ltp = toNum(f[iLtp], close) ?? close;
      const prevClose = toNum(f[iPrev], close) ?? close;
      const open = toNum(f[iOpen], close) ?? close;
      const high = toNum(f[iHigh], close) ?? close;
      const low = toNum(f[iLow], close) ?? close;
      const volume = Math.round(toNum(f[iVol], 0) ?? 0);
      const turnover = toNum(f[iTurn], 0) ?? 0;
      const trans = Math.round(toNum(f[iTrans], 0) ?? 0);
      const diff = toNum(f[iDiff], prevClose ? round2(close - prevClose) : 0) ?? 0;
      const diffPct =
        toNum(f[iDiffPct], prevClose > 0 ? round2((diff / prevClose) * 100) : 0) ?? 0;

      const vwap = toNum(f[iVwap]);
      const rawRangePct = toNum(f[iRangePct]);
      const rawVwapPct = toNum(f[iVwapPct]);
      const rangePct =
        rawRangePct !== null
          ? rawRangePct
          : low > 0 && high >= low
            ? round2(((high - low) / low) * 100)
            : null;
      const vwapPct =
        rawVwapPct !== null
          ? rawVwapPct
          : vwap !== null && vwap > 0 && close > 0
            ? round2(((close - vwap) / vwap) * 100)
            : null;

      rows.push({
        date: dateStr,
        symbol,
        name: iName !== -1 ? (f[iName] || '').trim() : '',
        conf: toNum(f[iConf]),
        open,
        high,
        low,
        close,
        ltp,
        close_ltp: toNum(f[iCloseLtp]),
        close_ltp_pct: toNum(f[iCloseLtpPct]),
        vwap,
        volume,
        prev_close: prevClose,
        turnover,
        trans,
        diff,
        price_range: toNum(f[iRange], round2(high - low)),
        diff_pct: diffPct,
        range_pct: rangePct,
        vwap_pct: vwapPct,
        d120: toNum(f[iD120]),
        d180: toNum(f[iD180]),
        w52_high: toNum(f[iW52H]),
        w52_low: toNum(f[iW52L]),
      });
    }
    return rows;
  }

  public saveDayRows(dateStr: string, rows: PriceRow[]): number {
    if (!isValidDateStr(dateStr)) {
      throw new Error(`Invalid trading date: ${dateStr}`);
    }
    const filePath = this.safeFilePath(dateStr);
    const lines = [CSV_HEADERS.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.symbol,
          r.name,
          r.conf,
          r.open,
          r.high,
          r.low,
          r.close,
          r.ltp,
          r.close_ltp,
          r.close_ltp_pct,
          r.vwap,
          r.volume,
          r.prev_close,
          r.turnover,
          r.trans,
          r.diff,
          r.price_range,
          r.diff_pct,
          r.range_pct,
          r.vwap_pct,
          r.d120,
          r.d180,
          r.w52_high,
          r.w52_low,
        ]
          .map(escapeCsvField)
          .join(',')
      );
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    this.byDate.set(dateStr, rows.map((r) => ({ ...r, date: dateStr })));
    this.rebuildIndexes();
    return rows.length;
  }

  public hasDate(dateStr: string): boolean {
    return this.byDate.has(dateStr);
  }

  public deleteDate(dateStr: string): boolean {
    const filePath = this.safeFilePath(dateStr);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const existed = this.byDate.delete(dateStr);
    this.rebuildIndexes();
    return existed;
  }

  public getDates(): string[] {
    return [...this.sortedDates];
  }

  public getDailyAggregates(): DailyAggregate[] {
    return this.sortedDates.map((d) => {
      const rows = this.byDate.get(d) || [];
      let turnover = 0;
      let volume = 0;
      let advancers = 0;
      let decliners = 0;
      let unchanged = 0;
      for (const r of rows) {
        turnover += r.turnover || 0;
        volume += r.volume || 0;
        if (r.diff > 0) advancers++;
        else if (r.diff < 0) decliners++;
        else unchanged++;
      }
      return {
        date: d,
        turnover,
        volume,
        companies: rows.length,
        advancers,
        decliners,
        unchanged,
      };
    });
  }

  public getDayPrices(day: string, equityOnly = false): PriceRow[] {
    const rows = this.byDate.get(day) || [];
    if (!equityOnly) return rows;
    return rows.filter((r) => !DIGIT_RE.test(r.symbol) && (r.close || 0) >= 50);
  }

  public getSymbols(day: string, equityOnly = false): SymbolInfo[] {
    const rows = this.getDayPrices(day, false);
    const filtered = equityOnly ? rows.filter((r) => !DIGIT_RE.test(r.symbol)) : rows;
    return filtered
      .map((r) => ({ symbol: r.symbol, name: r.name }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  public getSymbolHistory(symbol: string, end?: string, days?: number): PriceRow[] {
    const rows = this.bySymbol.get(symbol.toUpperCase()) || [];
    const filtered = end && isValidDateStr(end) ? rows.filter((r) => r.date <= end) : rows;
    if (days && days > 0) {
      return filtered.slice(-days);
    }
    return filtered;
  }

  public rangeSummary(start: string, end: string, equityOnly = false): RangeSummaryRow[] {
    if (!isValidDateStr(start) || !isValidDateStr(end)) return [];
    const datesInRange = this.sortedDates.filter((d) => d >= start && d <= end);
    if (datesInRange.length === 0) return [];

    interface Acc {
      symbol: string;
      name: string;
      turnover: number;
      volume: number;
      trans: number;
      days_traded: number;
      up_days: number;
      down_days: number;
      firstRow: PriceRow;
      lastRow: PriceRow;
    }

    const map = new Map<string, Acc>();
    for (const d of datesInRange) {
      const rows = this.byDate.get(d) || [];
      for (const r of rows) {
        let acc = map.get(r.symbol);
        if (!acc) {
          acc = {
            symbol: r.symbol,
            name: r.name,
            turnover: 0,
            volume: 0,
            trans: 0,
            days_traded: 0,
            up_days: 0,
            down_days: 0,
            firstRow: r,
            lastRow: r,
          };
          map.set(r.symbol, acc);
        }
        if (r.name && r.name > acc.name) acc.name = r.name;
        acc.turnover += r.turnover || 0;
        acc.volume += r.volume || 0;
        acc.trans += r.trans || 0;
        acc.days_traded += 1;
        if (r.diff > 0) acc.up_days += 1;
        else if (r.diff < 0) acc.down_days += 1;
        acc.lastRow = r;
      }
    }

    const result: RangeSummaryRow[] = [];
    for (const acc of map.values()) {
      const startPrice = acc.firstRow.prev_close || null;
      const endPrice = acc.lastRow.close || null;
      const changePct =
        startPrice && endPrice && startPrice > 0
          ? round2((endPrice / startPrice - 1) * 100)
          : null;
      const avgPrice = acc.volume > 0 ? round2(acc.turnover / acc.volume) : null;

      if (equityOnly) {
        if (DIGIT_RE.test(acc.symbol)) continue;
        const refPrice = avgPrice ?? endPrice ?? 0;
        if (refPrice < 50) continue;
      }

      result.push({
        symbol: acc.symbol,
        name: acc.name,
        turnover: acc.turnover,
        volume: acc.volume,
        trans: acc.trans,
        days_traded: acc.days_traded,
        up_days: acc.up_days,
        down_days: acc.down_days,
        start_price: startPrice,
        end_price: endPrice,
        change_pct: changePct,
        avg_price: avgPrice,
      });
    }

    return result.sort((a, b) => b.turnover - a.turnover);
  }

  public static getNepseWeeks(start: string, end: string): Array<{ week_start: string; week_end: string }> {
    const s = new Date(`${start}T00:00:00Z`);
    const e = new Date(`${end}T00:00:00Z`);
    // Roll back to Monday (UTCDay: Sun=0, Mon=1 ... Sat=6)
    const ws = new Date(s);
    ws.setUTCDate(ws.getUTCDate() - ((ws.getUTCDay() + 6) % 7));

    const weeks: Array<{ week_start: string; week_end: string }> = [];
    while (ws <= e) {
      const we = new Date(ws);
      we.setUTCDate(we.getUTCDate() + 6);
      const clampedStart = ws < s ? s : ws;
      const clampedEnd = we > e ? e : we;
      weeks.push({
        week_start: clampedStart.toISOString().slice(0, 10),
        week_end: clampedEnd.toISOString().slice(0, 10),
      });
      ws.setUTCDate(ws.getUTCDate() + 7);
    }
    return weeks;
  }

  public weeklyTopTurnover(
    start: string,
    end: string,
    n = 15,
    equityOnly = false
  ): { weeks: Array<{ label: string; week_start: string; week_end: string; map: Record<string, number> }>; rows: WeeklyTopRow[] } {
    if (!isValidDateStr(start) || !isValidDateStr(end)) return { weeks: [], rows: [] };
    const weekBuckets = MarketStore.getNepseWeeks(start, end);
    const weeks: Array<{ label: string; week_start: string; week_end: string; map: Record<string, number> }> = [];
    const rows: WeeklyTopRow[] = [];

    for (const { week_start, week_end } of weekBuckets) {
      const summary = this.rangeSummary(week_start, week_end, equityOnly);
      if (summary.length === 0) continue;
      const map: Record<string, number> = {};
      for (const r of summary) map[r.symbol] = r.turnover;
      weeks.push({ label: `${week_start} → ${week_end}`, week_start, week_end, map });
      summary.slice(0, n).forEach((r, idx) => {
        rows.push({
          ...r,
          week_start,
          week_end,
          rank: idx + 1,
        });
      });
    }
    return { weeks, rows };
  }

  public turnoverDirection(
    start: string,
    end: string,
    topPct = 10,
    consistent = false,
    equityOnly = true
  ): {
    all: RangeSummaryRow[];
    up: RangeSummaryRow[];
    down: RangeSummaryRow[];
    cutoff: number;
  } {
    const all = this.rangeSummary(start, end, equityOnly).filter(
      (r) => r.start_price !== null && r.end_price !== null && r.change_pct !== null
    );
    if (all.length === 0) return { all: [], up: [], down: [], cutoff: 0 };

    const cutoff = quantile(
      all.map((r) => r.turnover),
      clip(1 - topPct / 100, 0, 1)
    );
    const hi = all.filter((r) => r.turnover >= cutoff);
    let up = hi.filter((r) => (r.change_pct ?? 0) > 0);
    let down = hi.filter((r) => (r.change_pct ?? 0) < 0);

    if (consistent) {
      up = up.filter((r) => r.up_days / r.days_traded >= 0.6);
      down = down.filter((r) => r.down_days / r.days_traded >= 0.6);
    }

    return {
      all,
      up: up.sort((a, b) => b.turnover - a.turnover),
      down: down.sort((a, b) => b.turnover - a.turnover),
      cutoff,
    };
  }

  // ---------------------------------------------------------------- Scanners
  private loadScannerHistories(
    end: string | undefined,
    days: number,
    equityOnly: boolean
  ): { map: Map<string, PriceRow[]>; lastDate: string | null } {
    let ds = this.sortedDates;
    if (end && isValidDateStr(end)) {
      ds = ds.filter((d) => d <= end);
    }
    ds = ds.slice(-days);
    if (ds.length === 0) return { map: new Map(), lastDate: null };
    const firstDate = ds[0];
    const lastDate = ds[ds.length - 1];

    const out = new Map<string, PriceRow[]>();
    for (const [sym, fullRows] of this.bySymbol.entries()) {
      const g = fullRows.filter((r) => r.date >= firstDate && r.date <= lastDate);
      if (g.length === 0 || g[g.length - 1].date !== lastDate) continue;
      if (equityOnly) {
        if (DIGIT_RE.test(sym) || mean(g.map((x) => x.close)) < 50) continue;
      }
      out.set(sym, g);
    }
    return { map: out, lastDate };
  }

  private getLatestName(g: PriceRow[]): string | null {
    for (let i = g.length - 1; i >= 0; i--) {
      if (g[i].name) return g[i].name;
    }
    return null;
  }

  public runScanner(
    kind: ScannerKind,
    opts: {
      end?: string;
      minAvgTurnover?: number;
      equityOnly?: boolean;
      params?: Record<string, number | boolean>;
    }
  ): ScannerResultRow[] {
    const end = opts.end;
    const minAvgTurnover = opts.minAvgTurnover ?? 1_000_000;
    const equityOnly = opts.equityOnly ?? true;
    const p = opts.params ?? {};

    switch (kind) {
      case 'potential':
        return this.consolidationBreakout(
          end,
          Number(p.base_min ?? 20),
          Number(p.base_max ?? 90),
          Number(p.max_range_pct ?? 12.0),
          Number(p.vol_mult ?? 2.0),
          Number(p.max_age ?? 3),
          Number(p.setup_pct ?? 3.0),
          minAvgTurnover,
          Boolean(p.include_setups ?? true),
          equityOnly
        );
      case 'support':
        return this.streakScan(
          'up',
          end,
          Number(p.min_days ?? 3),
          Number(p.lookback ?? 20),
          Number(p.vol_mult ?? 1.5),
          Number(p.sustain_mult ?? 1.0),
          Number(p.tol_pct ?? 3.0),
          Number(p.min_move_pct ?? 2.0),
          8,
          minAvgTurnover,
          equityOnly
        );
      case 'selloff':
        return this.streakScan(
          'down',
          end,
          Number(p.min_days ?? 1),
          Number(p.lookback ?? 20),
          Number(p.vol_mult ?? 1.5),
          Number(p.sustain_mult ?? 1.0),
          Number(p.tol_pct ?? 3.0),
          Number(p.min_move_pct ?? 3.0),
          8,
          minAvgTurnover,
          equityOnly
        );
      case 'highbreak':
        return this.highBreakout(
          end,
          Number(p.lookback ?? 20),
          Number(p.vol_mult ?? 2.0),
          minAvgTurnover,
          equityOnly
        );
      case 'breakdown':
        return this.supportBreakdown(
          end,
          Number(p.lookback ?? 20),
          Number(p.vol_mult ?? 2.0),
          minAvgTurnover,
          equityOnly
        );
      case 'accumulation':
        return this.accumulationWatch(
          end,
          Number(p.days ?? 10),
          Number(p.max_range_pct ?? 8.0),
          Number(p.min_ud ?? 1.5),
          minAvgTurnover,
          equityOnly
        );
      case 'near52':
        return this.near52wHigh(
          end,
          Number(p.within_pct ?? 3.0),
          Number(p.turnover_boost ?? 1.3),
          minAvgTurnover,
          equityOnly
        );
      case 'rs':
        return this.relativeStrength(end, Number(p.days ?? 20), minAvgTurnover, equityOnly);
      default:
        return [];
    }
  }

  private findBase(
    g: PriceRow[],
    b: number,
    maxLen: number,
    maxRangePct: number
  ): { L: number; bh: number; bl: number } {
    let h = -Infinity;
    let l = Infinity;
    let L = 0;
    const stop = Math.max(b - 1 - maxLen, -1);
    for (let i = b - 1; i > stop; i--) {
      const nh = Math.max(h, g[i].high);
      const nl = Math.min(l, g[i].low);
      if (nl <= 0 || (nh / nl - 1) * 100 > maxRangePct) break;
      h = nh;
      l = nl;
      L++;
    }
    return { L, bh: h, bl: l };
  }

  private scoreConsolidation(
    g: PriceRow[],
    b: number,
    L: number,
    breakout: boolean
  ): { score: number; signals: string[] } {
    const base = g.slice(b - L, b);
    const last = g[g.length - 1];
    let pts = 0;
    const flags: string[] = [];

    // 1. Long base (15)
    pts += (15 * Math.min(L, 60)) / 60;
    if (L >= 40) flags.push(`long-base(${L}d)`);

    // 2. Volatility squeeze (10)
    const rng = base.map((r) => (r.close > 0 ? ((r.high - r.low) / r.close) * 100 : 0));
    const third = Math.max(Math.floor(L / 3), 1);
    const ratio = mean(rng.slice(-third)) / Math.max(mean(rng.slice(0, third)), 1e-9);
    pts += 10 * clip((1 - ratio) / 0.4, 0, 1);
    if (ratio < 0.8) flags.push('volatility-squeeze');

    // 3. Volume dry-up (10)
    const avgBaseVol = Math.max(mean(base.map((r) => r.volume)), 1);
    const dry = mean(base.slice(-5).map((r) => r.volume)) / avgBaseVol;
    pts += 10 * clip((1 - dry) / 0.4, 0, 1);
    if (dry < 0.8) flags.push('volume-dry-up');

    // 4. Accumulation (10)
    const upVol = base.filter((r) => r.diff > 0).reduce((s, r) => s + r.volume, 0);
    const dnVol = base.filter((r) => r.diff < 0).reduce((s, r) => s + r.volume, 0);
    const ud = upVol / Math.max(dnVol, 1);
    pts += 10 * clip(ud / 2, 0, 1);
    if (ud >= 1.3) flags.push(`accumulation(up/down vol ${ud.toFixed(1)}x)`);

    if (breakout) {
      const br = g[b];
      // 5. Breakout volume (20)
      const vr = br.volume / avgBaseVol;
      pts += 20 * clip(vr / 4, 0, 1);

      // 6. Strong close (10)
      const rngDay = br.high - br.low;
      const strength = rngDay > 0 ? (br.close - br.low) / rngDay : 1.0;
      pts += 10 * clip(strength, 0, 1);
      if (strength >= 0.7) flags.push('strong-close');

      // 7. Wider participation (5)
      const avgTrans = Math.max(mean(base.map((r) => r.trans)), 1);
      const tr = br.trans / avgTrans;
      if (tr >= 1.5) {
        pts += 5;
        flags.push(`more-trades(${tr.toFixed(1)}x)`);
      }
      if (br.vwap_pct && br.vwap_pct > 0) {
        flags.push('closed-above-VWAP');
      }
    }

    // 8. Trend alignment (10)
    if (last.d120 && last.d120 > 0 && last.close > last.d120) {
      pts += 5;
      flags.push('>MA120');
    }
    if (last.d180 && last.d180 > 0 && last.close > last.d180) {
      pts += 5;
      flags.push('>MA180');
    }

    // 9. 52-week high proximity (10)
    if (last.w52_high && last.w52_high > 0 && last.close > 0) {
      const below = (last.w52_high / last.close - 1) * 100;
      if (below <= 5) {
        pts += 10;
        flags.push('near-52w-high');
      } else if (below <= 15) {
        pts += 5;
      }
    }

    return { score: round1(pts), signals: flags };
  }

  public consolidationBreakout(
    end: string | undefined,
    baseMin = 20,
    baseMax = 90,
    maxRangePct = 12.0,
    volMult = 2.0,
    maxAge = 3,
    setupPct = 3.0,
    minAvgTurnover = 1_000_000,
    includeSetups = true,
    equityOnly = true
  ): ScannerResultRow[] {
    const { map } = this.loadScannerHistories(end, baseMax + maxAge + 5, equityOnly);
    const rows: ScannerResultRow[] = [];

    for (const [sym, g] of map.entries()) {
      const n = g.length;
      let matched: ScannerResultRow | null = null;
      let bhFound = 0;
      let blFound = 0;

      for (let b = Math.max(n - maxAge, baseMin); b < n; b++) {
        const { L, bh, bl } = this.findBase(g, b, baseMax, maxRangePct);
        if (L < baseMin) continue;
        const baseSlice = g.slice(b - L, b);
        const avgVol = mean(baseSlice.map((r) => r.volume));
        const avgTurn = mean(baseSlice.map((r) => r.turnover));
        if (avgVol <= 0 || avgTurn < minAvgTurnover) continue;

        const vr = g[b].volume / avgVol;
        if (g[b].close > bh && g[b].diff > 0 && vr >= volMult && g[n - 1].close >= bh) {
          const { score, signals } = this.scoreConsolidation(g, b, L, true);
          bhFound = bh;
          blFound = bl;
          matched = {
            symbol: sym,
            name: this.getLatestName(g),
            status: 'BREAKOUT',
            score,
            base_days: L,
            base_range_pct: round1((bh / bl - 1) * 100),
            base_low: bl,
            base_high: bh,
            last_close: g[n - 1].close,
            move_pct: round2((g[n - 1].close / bh - 1) * 100),
            vol_ratio: round2(vr),
            breakout_date: g[b].date,
            days_ago: n - 1 - b,
            signals: signals.join(', '),
          };
          break;
        }
      }

      if (!matched && includeSetups) {
        const { L, bh, bl } = this.findBase(g, n, baseMax, maxRangePct);
        const baseSlice = g.slice(n - L, n);
        if (
          L >= baseMin &&
          mean(baseSlice.map((r) => r.turnover)) >= minAvgTurnover &&
          (bh / g[n - 1].close - 1) * 100 <= setupPct
        ) {
          const { score, signals } = this.scoreConsolidation(g, n, L, false);
          bhFound = bh;
          blFound = bl;
          matched = {
            symbol: sym,
            name: this.getLatestName(g),
            status: 'SETUP',
            score,
            base_days: L,
            base_range_pct: round1((bh / bl - 1) * 100),
            base_low: bl,
            base_high: bh,
            last_close: g[n - 1].close,
            move_pct: round2((g[n - 1].close / bh - 1) * 100),
            vol_ratio: round2(g[n - 1].volume / Math.max(mean(baseSlice.map((r) => r.volume)), 1)),
            breakout_date: null,
            days_ago: null,
            signals: signals.join(', '),
          };
        }
      }

      if (matched && bhFound > 0 && blFound > 0) {
        rows.push(matched);
      }
    }

    return rows.sort((a, b) => {
      const ao = a.status === 'BREAKOUT' ? 0 : 1;
      const bo = b.status === 'BREAKOUT' ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return b.score - a.score;
    });
  }

  private streakScan(
    side: 'up' | 'down',
    end: string | undefined,
    minDays: number,
    lookback: number,
    volMult: number,
    sustainMult: number,
    tolPct: number,
    minMovePct: number,
    minBaseDays: number,
    minAvgTurnover: number,
    equityOnly: boolean
  ): ScannerResultRow[] {
    const { map, lastDate } = this.loadScannerHistories(end, lookback + 15, equityOnly);
    if (!lastDate) return [];
    const tol = tolPct / 100;
    const out: ScannerResultRow[] = [];

    for (const [sym, g] of map.entries()) {
      const n = g.length;
      if (g[n - 1].date !== lastDate) continue;

      let i = n - 1;
      while (i >= 0 && (side === 'up' ? g[i].diff > 0 : g[i].diff < 0)) {
        i--;
      }
      const first = i + 1;
      if (n - first < minDays) continue;

      for (let s = first; s <= n - minDays; s++) {
        const base = g.slice(Math.max(0, s - lookback), s);
        if (base.length < minBaseDays) continue;
        const avgVol = mean(base.map((r) => r.volume));
        const avgTurn = mean(base.map((r) => r.turnover));
        if (!avgVol || avgTurn < minAvgTurnover) continue;

        const run = g.slice(s);
        if (run[0].volume < volMult * avgVol) continue;
        if (run.some((r) => r.volume < sustainMult * avgVol)) continue;
        if (run[0].prev_close <= 0) continue;

        const move = (run[run.length - 1].close / run[0].prev_close - 1) * 100;
        let level: number;
        let touch: number;

        if (side === 'up') {
          level = Math.min(...base.map((r) => r.low));
          if (run[0].low > level * (1 + tol) || run[run.length - 1].close <= level) continue;
          if (move < minMovePct) continue;
          touch = run[0].low;
        } else {
          level = Math.max(...base.map((r) => r.high));
          if (run[0].high < level * (1 - tol)) continue;
          if (move > -minMovePct) continue;
          touch = run[0].high;
        }

        const vr = mean(run.map((r) => r.volume)) / avgVol;
        out.push({
          symbol: sym,
          name: this.getLatestName(g),
          start_date: run[0].date,
          days: run.length,
          level: round2(level),
          start_touch: touch,
          last_close: run[run.length - 1].close,
          dist_from_level_pct: round2((run[run.length - 1].close / level - 1) * 100),
          move_pct: round2(move),
          vol_ratio: round2(vr),
          run_turnover: run.reduce((acc, r) => acc + r.turnover, 0),
          score: round2(vr * Math.abs(move)),
        });
        break;
      }
    }

    return out.sort((a, b) => b.score - a.score);
  }

  private highBreakout(
    end: string | undefined,
    lookback = 20,
    volMult = 2.0,
    minAvgTurnover = 1_000_000,
    equityOnly = true
  ): ScannerResultRow[] {
    const { map } = this.loadScannerHistories(end, lookback + 1, equityOnly);
    const rows: ScannerResultRow[] = [];
    for (const [sym, g] of map.entries()) {
      if (g.length < lookback + 1) continue;
      const base = g.slice(0, -1);
      const t = g[g.length - 1];
      const avgVol = mean(base.map((r) => r.volume));
      const avgTurn = mean(base.map((r) => r.turnover));
      if (!avgVol || avgTurn < minAvgTurnover) continue;
      const priorHigh = Math.max(...base.map((r) => r.high));
      const vr = t.volume / avgVol;
      if (t.close > priorHigh && t.diff > 0 && vr >= volMult && t.prev_close > 0) {
        rows.push({
          symbol: sym,
          name: this.getLatestName(g),
          last_close: t.close,
          prior_high: priorHigh,
          move_pct: round2((t.diff / t.prev_close) * 100),
          vol_ratio: round2(vr),
          score: round2(vr * (t.close / priorHigh - 1) * 100),
        });
      }
    }
    return rows.sort((a, b) => b.score - a.score);
  }

  private supportBreakdown(
    end: string | undefined,
    lookback = 20,
    volMult = 2.0,
    minAvgTurnover = 1_000_000,
    equityOnly = true
  ): ScannerResultRow[] {
    const { map } = this.loadScannerHistories(end, lookback + 1, equityOnly);
    const rows: ScannerResultRow[] = [];
    for (const [sym, g] of map.entries()) {
      if (g.length < lookback + 1) continue;
      const base = g.slice(0, -1);
      const t = g[g.length - 1];
      const avgVol = mean(base.map((r) => r.volume));
      const avgTurn = mean(base.map((r) => r.turnover));
      if (!avgVol || avgTurn < minAvgTurnover) continue;
      const priorLow = Math.min(...base.map((r) => r.low));
      const vr = t.volume / avgVol;
      if (t.close < priorLow && t.diff < 0 && vr >= volMult && t.prev_close > 0 && priorLow > 0) {
        rows.push({
          symbol: sym,
          name: this.getLatestName(g),
          last_close: t.close,
          prior_low: priorLow,
          move_pct: round2((t.diff / t.prev_close) * 100),
          vol_ratio: round2(vr),
          score: round2(vr * (1 - t.close / priorLow) * 100),
        });
      }
    }
    return rows.sort((a, b) => b.score - a.score);
  }

  private accumulationWatch(
    end: string | undefined,
    days = 10,
    maxRangePct = 8.0,
    minUd = 1.5,
    minAvgTurnover = 1_000_000,
    equityOnly = true
  ): ScannerResultRow[] {
    const { map } = this.loadScannerHistories(end, days + 20, equityOnly);
    const rows: ScannerResultRow[] = [];
    for (const [sym, g] of map.entries()) {
      if (g.length < days + 5) continue;
      const r = g.slice(-days);
      const prior = g.slice(0, -days);
      const minLow = Math.min(...r.map((x) => x.low));
      const maxHigh = Math.max(...r.map((x) => x.high));
      if (minLow <= 0) continue;
      const rng = (maxHigh / minLow - 1) * 100;
      const up = r.filter((x) => x.diff > 0).reduce((s, x) => s + x.volume, 0);
      const dn = r.filter((x) => x.diff < 0).reduce((s, x) => s + x.volume, 0);
      const ud = up / Math.max(dn, 1);
      const pv = mean(prior.map((x) => x.volume));
      const vr = pv > 0 ? mean(r.map((x) => x.volume)) / pv : 0;

      if (
        rng <= maxRangePct &&
        ud >= minUd &&
        vr >= 1.0 &&
        mean(r.map((x) => x.turnover)) >= minAvgTurnover
      ) {
        rows.push({
          symbol: sym,
          name: this.getLatestName(g),
          last_close: r[r.length - 1].close,
          range_pct: round1(rng),
          up_down_vol: round2(ud),
          vol_vs_prior: round2(vr),
          score: round1(Math.min(ud, 4) * 10 + Math.min(vr, 3) * 5 - rng),
        });
      }
    }
    return rows.sort((a, b) => b.score - a.score);
  }

  private near52wHigh(
    end: string | undefined,
    withinPct = 3.0,
    turnoverBoost = 1.3,
    minAvgTurnover = 1_000_000,
    equityOnly = true
  ): ScannerResultRow[] {
    const { map } = this.loadScannerHistories(end, 25, equityOnly);
    const rows: ScannerResultRow[] = [];
    for (const [sym, g] of map.entries()) {
      const t = g[g.length - 1];
      if (!t.w52_high || t.w52_high <= 0 || t.close <= 0 || g.length < 10) continue;
      const gap = (t.w52_high / t.close - 1) * 100;
      const recent = mean(g.slice(-5).map((x) => x.turnover));
      const prior = mean(g.slice(0, -5).map((x) => x.turnover));
      const boost = prior > 0 ? recent / prior : 0;
      if (gap <= withinPct && boost >= turnoverBoost && recent >= minAvgTurnover) {
        rows.push({
          symbol: sym,
          name: this.getLatestName(g),
          last_close: t.close,
          w52_high: t.w52_high,
          gap_to_high_pct: round2(gap),
          turnover_boost: round2(boost),
          score: round2(boost * 10 - gap),
        });
      }
    }
    return rows.sort((a, b) => b.score - a.score);
  }

  private relativeStrength(
    end: string | undefined,
    days = 20,
    minAvgTurnover = 1_000_000,
    equityOnly = true
  ): ScannerResultRow[] {
    const { map } = this.loadScannerHistories(end, days, equityOnly);
    const rets = new Map<string, number>();
    for (const [sym, g] of map.entries()) {
      if (
        g.length >= days &&
        g[0].prev_close > 0 &&
        mean(g.map((x) => x.turnover)) >= minAvgTurnover
      ) {
        rets.set(sym, (g[g.length - 1].close / g[0].prev_close - 1) * 100);
      }
    }
    if (rets.size === 0) return [];
    const med = median(Array.from(rets.values()));
    const rows: ScannerResultRow[] = [];
    for (const [sym, r] of rets.entries()) {
      const g = map.get(sym)!;
      rows.push({
        symbol: sym,
        name: this.getLatestName(g),
        last_close: g[g.length - 1].close,
        return_pct: round2(r),
        market_median_pct: round2(med),
        score: round2(r - med),
      });
    }
    return rows.sort((a, b) => b.score - a.score).slice(0, 50);
  }

  public getMarketPulse(day: string, equityOnly = true): MarketPulseResponse {
    const raw = this.getDayPrices(day, equityOnly);
    let aboveMa120 = 0;
    let ma120Eligible = 0;
    let aboveMa180 = 0;
    let ma180Eligible = 0;
    let goldenCross = 0;
    let maEligible = 0;
    let aboveVwap = 0;
    let vwapEligible = 0;
    let near52HighCount = 0;
    let near52LowCount = 0;
    let upperCircuitCount = 0;
    let lowerCircuitCount = 0;
    const tradeSizes: number[] = [];
    const rangePcts: number[] = [];

    const enriched: MarketPulseRow[] = raw.map((r) => {
      const avgTradeSize = r.trans > 0 ? round1(r.turnover / r.trans) : 0;
      if (avgTradeSize > 0) tradeSizes.push(avgTradeSize);

      const closePosPct =
        r.high > r.low ? round1(clip(((r.close - r.low) / (r.high - r.low)) * 100, 0, 100)) : 50;
      if (r.range_pct !== null) rangePcts.push(r.range_pct);

      const pos52w =
        r.w52_high !== null && r.w52_low !== null && r.w52_high > r.w52_low
          ? round1(clip(((r.close - r.w52_low) / (r.w52_high - r.w52_low)) * 100, 0, 100))
          : null;

      const gap52h =
        r.w52_high !== null && r.w52_high > 0
          ? round2(((r.w52_high - r.close) / r.w52_high) * 100)
          : null;

      const vsD120 =
        r.d120 !== null && r.d120 > 0 ? round2((r.close / r.d120 - 1) * 100) : null;
      const vsD180 =
        r.d180 !== null && r.d180 > 0 ? round2((r.close / r.d180 - 1) * 100) : null;

      if (r.d120 !== null && r.d120 > 0) {
        ma120Eligible++;
        if (r.close > r.d120) aboveMa120++;
      }
      if (r.d180 !== null && r.d180 > 0) {
        ma180Eligible++;
        if (r.close > r.d180) aboveMa180++;
      }
      if (r.d120 !== null && r.d120 > 0 && r.d180 !== null && r.d180 > 0) {
        maEligible++;
        if (r.d120 > r.d180) goldenCross++;
      }
      if (r.vwap !== null && r.vwap > 0) {
        vwapEligible++;
        if (r.close > r.vwap) aboveVwap++;
      }
      if (gap52h !== null && gap52h <= 5.0) near52HighCount++;
      if (r.w52_low !== null && r.w52_low > 0 && ((r.close - r.w52_low) / r.w52_low) * 100 <= 5.0) {
        near52LowCount++;
      }
      if ((r.diff_pct ?? 0) >= 9.0) upperCircuitCount++;
      if ((r.diff_pct ?? 0) <= -9.0) lowerCircuitCount++;

      return {
        ...r,
        avg_trade_size: avgTradeSize,
        close_pos_pct: closePosPct,
        pos_52w_pct: pos52w,
        gap_52h_pct: gap52h,
        vs_d120_pct: vsD120,
        vs_d180_pct: vsD180,
      };
    });

    const summary: MarketPulseSummary = {
      date: day,
      total: raw.length,
      aboveMa120,
      ma120Eligible,
      aboveMa180,
      ma180Eligible,
      goldenCross,
      maEligible,
      aboveVwap,
      vwapEligible,
      near52HighCount,
      near52LowCount,
      upperCircuitCount,
      lowerCircuitCount,
      medianAvgTradeSize: round1(median(tradeSizes)),
      medianRangePct: round2(median(rangePcts)),
    };

    return { summary, rows: enriched };
  }
}
