import fs from 'fs';
import path from 'path';
import type {
  CompareStockSummary,
  DailyAggregate,
  HomepageHeatmapStock,
  HomepageHistoryPoint,
  HomepagePulseResponse,
  HomepageScriptSpotlight,
  HomepageSectorHeatmapRow,
  HomepageTopTurnoverRow,
  HomepageUnusualStockRow,
  HomepageWowInsight,
  MarketPulseResponse,
  MarketPulseRow,
  MarketPulseSummary,
  OpportunityRadarResponse,
  PriceRow,
  RadarPoint,
  RangeSummaryRow,
  ScannerKind,
  ScannerResultRow,
  SectorPulseMetric,
  SectorRotationQuadrantNode,
  SmartMoneyRadarRow,
  StockComparisonResponse,
  SymbolInfo,
  TopTurnoverAnalyticsResponse,
  TopTurnoverEnhancedRow,
  TurnoverSignalType,
  WeeklyTopRow,
} from '../src/types/market.ts';
import { getNepseSector } from './sectors.ts';

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

      const avgTradeSize = acc.trans > 0 ? round1(acc.turnover / acc.trans) : 0;
      const winRatePct = acc.days_traded > 0 ? round1((acc.up_days / acc.days_traded) * 100) : 0;
      const vsD120 =
        acc.lastRow.d120 !== null && acc.lastRow.d120 > 0
          ? round2((acc.lastRow.close / acc.lastRow.d120 - 1) * 100)
          : null;
      const gap52h =
        acc.lastRow.w52_high !== null && acc.lastRow.w52_high > 0
          ? round2(((acc.lastRow.w52_high - acc.lastRow.close) / acc.lastRow.w52_high) * 100)
          : null;
      const closePosPct =
        acc.lastRow.high > acc.lastRow.low
          ? round1(clip(((acc.lastRow.close - acc.lastRow.low) / (acc.lastRow.high - acc.lastRow.low)) * 100, 0, 100))
          : 50;

      result.push({
        symbol: acc.symbol,
        name: acc.name,
        sector: getNepseSector(acc.symbol, acc.name),
        ltp: acc.lastRow.ltp || acc.lastRow.close,
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
        avg_trade_size: avgTradeSize,
        win_rate_pct: winRatePct,
        vwap_pct: acc.lastRow.vwap_pct,
        vs_d120_pct: vsD120,
        gap_52h_pct: gap52h,
        close_pos_pct: closePosPct,
      });
    }

    return result.sort((a, b) => b.turnover - a.turnover);
  }

  public getTopTurnoverAnalytics(
    start: string,
    end: string,
    nDays = 20,
    limitN = 20,
    equityOnly = true
  ): TopTurnoverAnalyticsResponse {
    const cleanN = Math.max(2, Math.min(250, Math.round(nDays)));
    const currentAll = this.rangeSummary(start, end, equityOnly);
    const datesInRange = this.sortedDates.filter((d) => d >= start && d <= end);
    const spanLen = Math.max(1, datesInRange.length);

    // Find immediately preceding equivalent-length window
    const startIdx = this.sortedDates.findIndex((d) => d >= start);
    let prevStart: string | null = null;
    let prevEnd: string | null = null;
    const prevMap = new Map<string, RangeSummaryRow>();
    let prevMarketTotalTurnover: number | null = null;

    if (startIdx > 0) {
      const prevEndIdx = startIdx - 1;
      const prevStartIdx = Math.max(0, prevEndIdx - spanLen + 1);
      prevStart = this.sortedDates[prevStartIdx];
      prevEnd = this.sortedDates[prevEndIdx];
      const prevRows = this.rangeSummary(prevStart, prevEnd, equityOnly);
      prevMarketTotalTurnover = prevRows.reduce((s, r) => s + r.turnover, 0);
      for (const pr of prevRows) prevMap.set(pr.symbol, pr);
    }

    const marketTotalTurnover = currentAll.reduce((s, r) => s + r.turnover, 0);

    const enhancedAll: TopTurnoverEnhancedRow[] = currentAll.map((r) => {
      const fullHist = (this.bySymbol.get(r.symbol) || []).filter((h) => h.date <= end);
      const rollSlice = fullHist.slice(-cleanN);
      const sparkSlice = fullHist.slice(-Math.min(Math.max(cleanN, 12), 20));
      const lastRow = fullHist[fullHist.length - 1];

      const avgDailyTurn = r.turnover / Math.max(1, r.days_traded);
      const avgDailyVol = r.volume / Math.max(1, r.days_traded);

      const avgTurnN = rollSlice.length > 0 ? mean(rollSlice.map((h) => h.turnover)) : avgDailyTurn;
      const avgVolN = rollSlice.length > 0 ? mean(rollSlice.map((h) => h.volume)) : avgDailyVol;
      const avgPriceN = rollSlice.length > 0 ? mean(rollSlice.map((h) => h.close)) : r.end_price ?? 0;

      const turnVsAvgN = avgTurnN > 0 ? round2(avgDailyTurn / avgTurnN) : 1;
      const volVsAvgN = avgVolN > 0 ? round2(avgDailyVol / avgVolN) : 1;
      const priceVsAvgNPct =
        avgPriceN > 0 && r.end_price !== null ? round2((r.end_price / avgPriceN - 1) * 100) : null;

      const upVol = rollSlice.filter((h) => h.diff > 0).reduce((s, h) => s + h.volume, 0);
      const dnVol = rollSlice.filter((h) => h.diff < 0).reduce((s, h) => s + h.volume, 0);
      const upDownVolRatio = round2(upVol / Math.max(dnVol, 1));

      const prevRow = prevMap.get(r.symbol);
      const prevTurn = prevRow ? prevRow.turnover : null;
      const prevAvgTurn = prevRow && prevRow.days_traded > 0 ? prevRow.turnover / prevRow.days_traded : null;
      const turnVsPrevPct =
        prevAvgTurn && prevAvgTurn > 0 ? round1(((avgDailyTurn - prevAvgTurn) / prevAvgTurn) * 100) : null;

      const chg = r.change_pct ?? 0;
      const closePos = r.close_pos_pct ?? 50;
      const vwapPct = r.vwap_pct ?? 0;

      const signals: TurnoverSignalType[] = [];
      if (turnVsAvgN >= 1.5 || (turnVsPrevPct !== null && turnVsPrevPct >= 35)) {
        signals.push('rising_turnover');
      }
      if (turnVsAvgN <= 0.65 || (turnVsPrevPct !== null && turnVsPrevPct <= -35)) {
        signals.push('declining_activity');
      }
      if (volVsAvgN >= 1.8) {
        signals.push('volume_spike');
      }
      if (
        (chg <= 0.5 && turnVsAvgN >= 1.6 && closePos >= 55) ||
        (chg < 0 && upDownVolRatio >= 1.35 && turnVsAvgN >= 1.3)
      ) {
        signals.push('bullish_divergence');
      }
      if (
        (chg >= 2.0 && volVsAvgN <= 0.75) ||
        (chg >= 1.5 && vwapPct < -0.5 && closePos <= 35 && turnVsAvgN >= 1.4)
      ) {
        signals.push('bearish_divergence');
      }
      if (upDownVolRatio >= 1.4 && vwapPct >= 0 && closePos >= 60) {
        signals.push('accumulation');
      }
      if (turnVsAvgN >= 2.2 || volVsAvgN >= 2.5) {
        signals.push('unusual_attention');
      }

      // Build concise plain-English insight
      let insight = `Trading near its ${cleanN}d liquidity baseline (${turnVsAvgN.toFixed(1)}x avg).`;
      if (signals.includes('bearish_divergence') && volVsAvgN <= 0.75) {
        insight = `Volume is declining (${Math.round((volVsAvgN - 1) * 100)}% vs ${cleanN}d avg) despite rising price (+${chg.toFixed(1)}%).`;
      } else if (signals.includes('bullish_divergence')) {
        insight = `Silent absorption: turnover is ${turnVsAvgN.toFixed(1)}x ${cleanN}d avg while price stays compressed.`;
      } else if (signals.includes('unusual_attention')) {
        insight = `Turnover is ${turnVsAvgN.toFixed(1)}x its ${cleanN}-day average with ${volVsAvgN.toFixed(1)}x volume participation.`;
      } else if (signals.includes('accumulation')) {
        insight = `Accumulation bias: ${upDownVolRatio.toFixed(1)}x up/down volume over ${cleanN}d and closed above VWAP.`;
      } else if (signals.includes('rising_turnover')) {
        insight = `Rising liquidity: ${turnVsAvgN.toFixed(1)}x ${cleanN}d avg turnover${
          turnVsPrevPct !== null ? ` (${turnVsPrevPct >= 0 ? '+' : ''}${turnVsPrevPct}% vs prior window)` : ''
        }.`;
      } else if (signals.includes('declining_activity')) {
        insight = `Cooling activity: turnover fell to ${turnVsAvgN.toFixed(1)}x its ${cleanN}d average.`;
      }

      return {
        ...r,
        sector: r.sector || getNepseSector(r.symbol, r.name),
        ltp: lastRow ? lastRow.ltp || lastRow.close : r.end_price ?? 0,
        market_share_pct: marketTotalTurnover > 0 ? round2((r.turnover / marketTotalTurnover) * 100) : 0,
        avg_daily_turnover: round1(avgDailyTurn),
        avg_daily_volume: Math.round(avgDailyVol),
        prev_turnover: prevTurn,
        turnover_vs_prev_pct: turnVsPrevPct,
        prev_change_pct: prevRow?.change_pct ?? null,
        avg_turnover_n: round1(avgTurnN),
        avg_volume_n: Math.round(avgVolN),
        avg_price_n: round2(avgPriceN),
        turnover_vs_avg_n: turnVsAvgN,
        volume_vs_avg_n: volVsAvgN,
        price_vs_avg_n_pct: priceVsAvgNPct,
        up_down_vol_ratio: upDownVolRatio,
        signals,
        insight,
        sparkline_close: sparkSlice.map((s) => s.close),
        sparkline_turnover: sparkSlice.map((s) => s.turnover),
      };
    });

    const topRows = enhancedAll.slice(0, Math.max(1, limitN));
    const insights: string[] = [];

    const biggestSurge = [...topRows].sort((a, b) => b.turnover_vs_avg_n - a.turnover_vs_avg_n)[0];
    if (biggestSurge && biggestSurge.turnover_vs_avg_n >= 1.3) {
      insights.push(
        `${biggestSurge.symbol} leads unusual activity: turnover is ${biggestSurge.turnover_vs_avg_n.toFixed(1)}x its ${cleanN}-day average (${biggestSurge.change_pct !== null && biggestSurge.change_pct >= 0 ? '+' : ''}${biggestSurge.change_pct ?? 0}%).`
      );
    }

    const accumLeader = topRows.find((r) => r.signals.includes('accumulation'));
    if (accumLeader) {
      insights.push(
        `${accumLeader.symbol} shows accumulation: ${accumLeader.up_down_vol_ratio.toFixed(1)}x up/down volume ratio over ${cleanN}d with positive VWAP control.`
      );
    }

    const divRow = topRows.find(
      (r) => r.signals.includes('bearish_divergence') || r.signals.includes('bullish_divergence')
    );
    if (divRow) {
      insights.push(`Price-vs-turnover divergence on ${divRow.symbol}: ${divRow.insight}`);
    }

    const coolingCount = topRows.filter((r) => r.signals.includes('declining_activity')).length;
    if (coolingCount > 0) {
      insights.push(
        `${coolingCount} of top ${topRows.length} liquidity names are trading below 0.65x of their ${cleanN}-day average turnover.`
      );
    }

    return {
      start,
      end,
      prevStart,
      prevEnd,
      nDays: cleanN,
      total: enhancedAll.length,
      marketTotalTurnover,
      prevMarketTotalTurnover,
      insights,
      rows: topRows,
    };
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
    upTurnover: number;
    downTurnover: number;
  } {
    const all = this.rangeSummary(start, end, equityOnly).filter(
      (r) => r.start_price !== null && r.end_price !== null && r.change_pct !== null
    );
    if (all.length === 0) {
      return { all: [], up: [], down: [], cutoff: 0, upTurnover: 0, downTurnover: 0 };
    }

    const cutoff = quantile(
      all.map((r) => r.turnover),
      clip(1 - topPct / 100, 0, 1)
    );
    const hi = all.filter((r) => r.turnover >= cutoff);
    const maxHiTurn = Math.max(...hi.map((r) => r.turnover), 1);

    const scoreRow = (r: RangeSummaryRow, dir: 'up' | 'down'): RangeSummaryRow => {
      const turnPts = 30 * (Math.log10(Math.max(r.turnover, 1)) / Math.log10(Math.max(maxHiTurn, 10)));
      const chgMag = Math.abs(r.change_pct ?? 0);
      const chgPts = 25 * clip(chgMag / 15, 0, 1);
      const dirDays = dir === 'up' ? r.up_days : r.down_days;
      const consistency = r.days_traded > 0 ? dirDays / r.days_traded : 0;
      const consPts = 20 * consistency;

      const vwapAligned = dir === 'up' ? (r.vwap_pct ?? 0) > 0 : (r.vwap_pct ?? 0) < 0;
      const closePos = r.close_pos_pct ?? 50;
      const convicPts = (vwapAligned ? 8 : 0) + 7 * (dir === 'up' ? closePos / 100 : (100 - closePos) / 100);

      let trendPts = 0;
      if (dir === 'up') {
        if ((r.vs_d120_pct ?? -99) > 0) trendPts += 5;
        if (r.gap_52h_pct !== null && r.gap_52h_pct !== undefined && r.gap_52h_pct <= 10) trendPts += 5;
      } else {
        if ((r.vs_d120_pct ?? 99) < 0) trendPts += 5;
        if (r.gap_52h_pct !== null && r.gap_52h_pct !== undefined && r.gap_52h_pct >= 20) trendPts += 5;
      }

      const momentumScore = round1(clip(turnPts + chgPts + consPts + convicPts + trendPts, 0, 100));
      const isBlockOnly = r.trans < Math.max(12, r.days_traded * 10) && (r.avg_trade_size ?? 0) > 500_000;

      let flowTag = dir === 'up' ? 'Active Buying' : 'Supply Pressure';
      if (dir === 'up') {
        if (isBlockOnly) flowTag = 'Block / Low Trades';
        else if (momentumScore >= 68 && consistency >= 0.6) flowTag = 'Momentum Leader';
        else if (consistency >= 0.6) flowTag = 'Steady Accumulation';
        else if ((r.change_pct ?? 0) >= 4 && (r.vwap_pct ?? 0) > 0) flowTag = 'Breakout Surge';
      } else {
        if (isBlockOnly) flowTag = 'Block Exit';
        else if (consistency >= 0.6 && (r.change_pct ?? 0) <= -3) flowTag = 'Heavy Distribution';
        else if ((r.vwap_pct ?? 0) < -1) flowTag = 'Intraday Fade';
      }

      return {
        ...r,
        momentum_score: momentumScore,
        flow_tag: flowTag,
      };
    };

    let up = hi.filter((r) => (r.change_pct ?? 0) > 0).map((r) => scoreRow(r, 'up'));
    let down = hi.filter((r) => (r.change_pct ?? 0) < 0).map((r) => scoreRow(r, 'down'));

    if (consistent) {
      up = up.filter((r) => r.up_days / r.days_traded >= 0.6);
      down = down.filter((r) => r.down_days / r.days_traded >= 0.6);
    }

    const upTurnover = up.reduce((s, r) => s + r.turnover, 0);
    const downTurnover = down.reduce((s, r) => s + r.turnover, 0);

    return {
      all,
      up: up.sort((a, b) => (b.momentum_score ?? 0) - (a.momentum_score ?? 0)),
      down: down.sort((a, b) => (b.momentum_score ?? 0) - (a.momentum_score ?? 0)),
      cutoff,
      upTurnover,
      downTurnover,
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

  public getMarketPulse(
    day: string,
    equityOnly = true,
    opts?: { start?: string; end?: string; nDays?: number }
  ): MarketPulseResponse {
    const startDate = opts?.start && isValidDateStr(opts.start) ? opts.start : day;
    const endDate = opts?.end && isValidDateStr(opts.end) ? opts.end : day;
    const nDays = Math.max(2, Math.min(250, Math.round(opts?.nDays ?? 20)));

    const datesInWindow = this.sortedDates.filter((d) => d >= startDate && d <= endDate);
    const activeDates = datesInWindow.length > 0 ? datesInWindow : [day];
    const windowDays = activeDates.length;
    const anchorEnd = activeDates[activeDates.length - 1];

    // Build aggregated rows for the active window (identical to single day when windowDays === 1)
    let baseRows: PriceRow[];
    if (windowDays === 1) {
      baseRows = this.getDayPrices(anchorEnd, equityOnly);
    } else {
      interface WindowAcc {
        first: PriceRow;
        last: PriceRow;
        high: number;
        low: number;
        volume: number;
        turnover: number;
        trans: number;
        vwapWeightedSum: number;
      }
      const accMap = new Map<string, WindowAcc>();
      for (const d of activeDates) {
        for (const r of this.getDayPrices(d, equityOnly)) {
          let acc = accMap.get(r.symbol);
          if (!acc) {
            acc = {
              first: r,
              last: r,
              high: r.high,
              low: r.low,
              volume: 0,
              turnover: 0,
              trans: 0,
              vwapWeightedSum: 0,
            };
            accMap.set(r.symbol, acc);
          }
          acc.last = r;
          if (r.high > acc.high) acc.high = r.high;
          if (r.low > 0 && (acc.low <= 0 || r.low < acc.low)) acc.low = r.low;
          acc.volume += r.volume || 0;
          acc.turnover += r.turnover || 0;
          acc.trans += r.trans || 0;
          if (r.vwap && r.volume) acc.vwapWeightedSum += r.vwap * r.volume;
        }
      }

      baseRows = Array.from(accMap.values()).map((acc) => {
        const prevClose = acc.first.prev_close > 0 ? acc.first.prev_close : acc.first.open;
        const close = acc.last.close;
        const diff = round2(close - prevClose);
        const diffPct = prevClose > 0 ? round2((diff / prevClose) * 100) : 0;
        const vwap = acc.volume > 0 ? round2(acc.turnover / acc.volume) : acc.last.vwap;
        const vwapPct = vwap && vwap > 0 ? round2(((close - vwap) / vwap) * 100) : acc.last.vwap_pct;
        const rangePct = acc.low > 0 ? round2(((acc.high - acc.low) / acc.low) * 100) : acc.last.range_pct;
        return {
          ...acc.last,
          open: acc.first.open,
          high: acc.high,
          low: acc.low,
          prev_close: prevClose,
          volume: acc.volume,
          turnover: acc.turnover,
          trans: acc.trans,
          diff,
          diff_pct: diffPct,
          vwap,
          vwap_pct: vwapPct,
          range_pct: rangePct,
        };
      });
    }

    // Rolling N-day baseline dates ending at anchorEnd
    const endIdx = this.sortedDates.indexOf(anchorEnd);
    const nWindowDates =
      endIdx >= 0 ? this.sortedDates.slice(Math.max(0, endIdx - nDays + 1), endIdx + 1) : [anchorEnd];

    const symAvgTurnN = new Map<string, number>();
    const symAvgVolN = new Map<string, number>();
    const sectorTurnN = new Map<string, number>();
    let totalMarketTurnN = 0;

    for (const d of nWindowDates) {
      for (const r of this.getDayPrices(d, equityOnly)) {
        symAvgTurnN.set(r.symbol, (symAvgTurnN.get(r.symbol) || 0) + (r.turnover || 0));
        symAvgVolN.set(r.symbol, (symAvgVolN.get(r.symbol) || 0) + (r.volume || 0));
        const sec = getNepseSector(r.symbol, r.name);
        sectorTurnN.set(sec, (sectorTurnN.get(sec) || 0) + (r.turnover || 0));
        totalMarketTurnN += r.turnover || 0;
      }
    }
    const denomDaysN = Math.max(1, nWindowDates.length);

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
    let advancers = 0;
    let decliners = 0;
    let unchanged = 0;
    let totalTurnover = 0;
    let totalVolume = 0;
    let totalTrades = 0;
    let retailCount = 0;
    let midCount = 0;
    let hniCount = 0;
    let institutionalCount = 0;

    const tradeSizes: number[] = [];
    const rangePcts: number[] = [];

    const sectorBuckets = new Map<
      string,
      {
        stocks: number;
        advancers: number;
        decliners: number;
        unchanged: number;
        turnover: number;
        chgSum: number;
        aboveVwap: number;
        vwapCount: number;
        leaderSymbol: string;
        leaderChg: number;
      }
    >();

    const enriched: MarketPulseRow[] = baseRows.map((r) => {
      const sector = getNepseSector(r.symbol, r.name);
      const avgTradeSize = r.trans > 0 ? round1(r.turnover / r.trans) : 0;
      if (avgTradeSize > 0) {
        tradeSizes.push(avgTradeSize);
        if (avgTradeSize < 50_000) retailCount++;
        else if (avgTradeSize < 250_000) midCount++;
        else if (avgTradeSize < 1_000_000) hniCount++;
        else institutionalCount++;
      }

      totalTurnover += r.turnover || 0;
      totalVolume += r.volume || 0;
      totalTrades += r.trans || 0;

      if ((r.diff_pct ?? 0) > 0) advancers++;
      else if ((r.diff_pct ?? 0) < 0) decliners++;
      else unchanged++;

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

      const avgTurnDaily = (symAvgTurnN.get(r.symbol) || r.turnover || 0) / denomDaysN;
      const avgVolDaily = (symAvgVolN.get(r.symbol) || r.volume || 0) / denomDaysN;
      const dailyTurn = (r.turnover || 0) / windowDays;
      const dailyVol = (r.volume || 0) / windowDays;

      // Sector bucket accumulation
      let sb = sectorBuckets.get(sector);
      if (!sb) {
        sb = {
          stocks: 0,
          advancers: 0,
          decliners: 0,
          unchanged: 0,
          turnover: 0,
          chgSum: 0,
          aboveVwap: 0,
          vwapCount: 0,
          leaderSymbol: r.symbol,
          leaderChg: r.diff_pct ?? 0,
        };
        sectorBuckets.set(sector, sb);
      }
      sb.stocks++;
      if ((r.diff_pct ?? 0) > 0) sb.advancers++;
      else if ((r.diff_pct ?? 0) < 0) sb.decliners++;
      else sb.unchanged++;
      sb.turnover += r.turnover || 0;
      sb.chgSum += r.diff_pct ?? 0;
      if (r.vwap !== null && r.vwap > 0) {
        sb.vwapCount++;
        if (r.close > r.vwap) sb.aboveVwap++;
      }
      if ((r.diff_pct ?? 0) > sb.leaderChg) {
        sb.leaderChg = r.diff_pct ?? 0;
        sb.leaderSymbol = r.symbol;
      }

      return {
        ...r,
        sector,
        avg_trade_size: avgTradeSize,
        close_pos_pct: closePosPct,
        pos_52w_pct: pos52w,
        gap_52h_pct: gap52h,
        vs_d120_pct: vsD120,
        vs_d180_pct: vsD180,
        turnover_vs_avg_n: avgTurnDaily > 0 ? round2(dailyTurn / avgTurnDaily) : 1,
        volume_vs_avg_n: avgVolDaily > 0 ? round2(dailyVol / avgVolDaily) : 1,
      };
    });

    const sortedByTurn = [...enriched].sort((a, b) => b.turnover - a.turnover);
    const top5Turn = sortedByTurn.slice(0, 5).reduce((s, r) => s + r.turnover, 0);
    const top10Turn = sortedByTurn.slice(0, 10).reduce((s, r) => s + r.turnover, 0);
    const top5ConcentrationPct = totalTurnover > 0 ? round1((top5Turn / totalTurnover) * 100) : 0;
    const top10ConcentrationPct = totalTurnover > 0 ? round1((top10Turn / totalTurnover) * 100) : 0;

    const avgMarketTurnN = totalMarketTurnN / denomDaysN;
    const dailyMarketTurn = totalTurnover / windowDays;
    const turnoverVsAvgN = avgMarketTurnN > 0 ? round2(dailyMarketTurn / avgMarketTurnN) : 1;

    const sectors: SectorPulseMetric[] = Array.from(sectorBuckets.entries())
      .map(([sector, sb]) => {
        const sharePct = totalTurnover > 0 ? round2((sb.turnover / totalTurnover) * 100) : 0;
        const secTotalN = sectorTurnN.get(sector) || 0;
        const avgSecShareN = totalMarketTurnN > 0 ? round2((secTotalN / totalMarketTurnN) * 100) : sharePct;
        const avgSecDailyN = secTotalN / denomDaysN;
        const secDaily = sb.turnover / windowDays;
        return {
          sector,
          stocks: sb.stocks,
          advancers: sb.advancers,
          decliners: sb.decliners,
          unchanged: sb.unchanged,
          turnover: sb.turnover,
          turnoverSharePct: sharePct,
          avgTurnoverShareN: avgSecShareN,
          rotationDeltaPct: round2(sharePct - avgSecShareN),
          turnoverVsAvgN: avgSecDailyN > 0 ? round2(secDaily / avgSecDailyN) : 1,
          avgChangePct: sb.stocks > 0 ? round2(sb.chgSum / sb.stocks) : 0,
          aboveVwapPct: sb.vwapCount > 0 ? round1((sb.aboveVwap / sb.vwapCount) * 100) : 0,
          leaderSymbol: sb.leaderSymbol,
          leaderChangePct: round2(sb.leaderChg),
        };
      })
      .sort((a, b) => b.turnover - a.turnover);

    // Composite Sentiment Score (0-100)
    const adShare = advancers + decliners > 0 ? advancers / (advancers + decliners) : 0.5;
    const vwapShare = vwapEligible > 0 ? aboveVwap / vwapEligible : 0.5;
    const maShare = ma120Eligible > 0 ? aboveMa120 / ma120Eligible : 0.5;
    const liqScore = clip((turnoverVsAvgN - 0.5) / 1.2, 0, 1);
    const sentimentScore = round1(
      clip(adShare * 40 + vwapShare * 25 + maShare * 20 + liqScore * 15, 0, 100)
    );
    const sentimentLabel: MarketPulseSummary['sentimentLabel'] =
      sentimentScore >= 66
        ? 'Risk-On / Bullish'
        : sentimentScore >= 52
          ? 'Constructive'
          : sentimentScore >= 38
            ? 'Neutral / Selective'
            : 'Risk-Off / Cautious';

    const summary: MarketPulseSummary = {
      date: anchorEnd,
      startDate: activeDates[0],
      endDate: anchorEnd,
      windowDays,
      nDays,
      total: baseRows.length,
      advancers,
      decliners,
      unchanged,
      adRatio: decliners > 0 ? round2(advancers / decliners) : advancers > 0 ? advancers : 1,
      totalTurnover,
      totalVolume,
      totalTrades,
      turnoverVsAvgN,
      top5ConcentrationPct,
      top10ConcentrationPct,
      sentimentScore,
      sentimentLabel,
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
      ticketDistribution: {
        retailCount,
        midCount,
        hniCount,
        institutionalCount,
      },
    };

    return { summary, sectors, rows: enriched };
  }

  public getOpportunityRadar(
    day: string | undefined,
    nDays = 20,
    equityOnly = true
  ): OpportunityRadarResponse {
    const cleanN = Math.max(5, Math.min(250, Math.round(nDays)));
    const targetDay = day && isValidDateStr(day) ? day : this.sortedDates[this.sortedDates.length - 1];
    if (!targetDay) {
      return {
        date: '',
        nDays: cleanN,
        points: [],
        accelerationAlerts: [],
        stealthAccumulation: [],
        divergences: [],
        breakoutWatchlist: [],
        sectorLeaders: [],
      };
    }

    const pulse = this.getMarketPulse(targetDay, equityOnly, { nDays: cleanN });
    const points: RadarPoint[] = [];

    for (const row of pulse.rows) {
      const fullHist = (this.bySymbol.get(row.symbol) || []).filter((h) => h.date <= targetDay);
      if (fullHist.length < Math.min(5, cleanN)) continue;

      const windowRows = fullHist.slice(-cleanN);
      const avgTurnN = mean(windowRows.map((h) => h.turnover));
      const avgVolN = mean(windowRows.map((h) => h.volume));
      const avgPriceN = mean(windowRows.map((h) => h.close));
      if (avgTurnN < 500_000 || avgVolN <= 0 || avgPriceN <= 0) continue;

      const turnMult = round2(row.turnover / avgTurnN);
      const volMult = round2(row.volume / avgVolN);
      const priceVsAvgNPct = round2((row.close / avgPriceN - 1) * 100);
      const firstClose = windowRows[0]?.prev_close > 0 ? windowRows[0].prev_close : windowRows[0].close;
      const periodReturnN = firstClose > 0 ? round2((row.close / firstClose - 1) * 100) : 0;

      const upVol = windowRows.filter((h) => h.diff > 0).reduce((s, h) => s + h.volume, 0);
      const dnVol = windowRows.filter((h) => h.diff < 0).reduce((s, h) => s + h.volume, 0);
      const upDownVolRatio = round2(upVol / Math.max(dnVol, 1));

      const ranges = windowRows.map((h) => (h.close > 0 ? ((h.high - h.low) / h.close) * 100 : 0));
      const recentAvgRange = mean(ranges.slice(-3));
      const baseAvgRange = Math.max(mean(ranges), 0.1);
      const rangeCompressionRatio = round2(recentAvgRange / baseAvgRange);

      const priorRows = windowRows.slice(0, -1);
      const resN = priorRows.length > 0 ? Math.max(...priorRows.map((h) => h.high)) : row.high;
      const gapResPct = resN > 0 ? ((resN - row.close) / resN) * 100 : 99;
      const chg = row.diff_pct ?? 0;

      let category: RadarPoint['category'] | null = null;
      let headline = '';
      let radarScore = 0;

      if (turnMult >= 1.75 && chg >= 0.5 && (row.vwap_pct ?? 0) >= 0) {
        category = 'acceleration';
        headline = `Turnover accelerated to ${turnMult.toFixed(1)}x ${cleanN}d avg with +${chg.toFixed(1)}% move above VWAP.`;
        radarScore = round1(clip(turnMult * 22 + chg * 4 + (row.close_pos_pct ?? 50) * 0.2, 0, 100));
      } else if (
        chg >= 1.8 &&
        volMult <= 0.72 &&
        avgTurnN >= 1_500_000
      ) {
        category = 'bearish_div';
        headline = `Price rose +${chg.toFixed(1)}% on weak volume (${volMult.toFixed(2)}x ${cleanN}d avg) — exhaustion risk.`;
        radarScore = round1(clip(chg * 8 + (1 - volMult) * 45, 0, 100));
      } else if (
        chg <= 0.6 &&
        chg >= -2.5 &&
        turnMult >= 1.55 &&
        upDownVolRatio >= 1.25 &&
        (row.close_pos_pct ?? 50) >= 52
      ) {
        category = 'bullish_div';
        headline = `Silent absorption: ${turnMult.toFixed(1)}x ${cleanN}d turnover while price stayed flat (${chg.toFixed(1)}%).`;
        radarScore = round1(clip(turnMult * 20 + upDownVolRatio * 15, 0, 100));
      } else if (
        upDownVolRatio >= 1.4 &&
        rangeCompressionRatio <= 0.9 &&
        (row.vwap_pct ?? 0) >= -0.3
      ) {
        category = 'accumulation';
        headline = `Tight coil (${rangeCompressionRatio.toFixed(2)}x range) with ${upDownVolRatio.toFixed(1)}x up/down volume over ${cleanN}d.`;
        radarScore = round1(clip(upDownVolRatio * 20 + (1 - rangeCompressionRatio) * 35 + turnMult * 10, 0, 100));
      } else if (
        (gapResPct <= 3.5 || (row.gap_52h_pct !== null && row.gap_52h_pct <= 4.5)) &&
        turnMult >= 1.2 &&
        chg >= 0
      ) {
        category = 'breakout_watch';
        headline = `Pressing ${cleanN}d / 52w ceiling (${gapResPct.toFixed(1)}% below ${cleanN}d high) on ${turnMult.toFixed(1)}x turnover.`;
        radarScore = round1(clip((5 - Math.max(0, gapResPct)) * 10 + turnMult * 18, 0, 100));
      }

      if (category) {
        points.push({
          symbol: row.symbol,
          name: row.name,
          sector: row.sector,
          ltp: row.ltp || row.close,
          close: row.close,
          changePct: chg,
          periodReturnN,
          turnover: row.turnover,
          avgTurnoverN: round1(avgTurnN),
          turnoverMult: turnMult,
          volumeMult: volMult,
          priceVsAvgNPct,
          upDownVolRatio,
          rangeCompressionRatio,
          vwapPct: row.vwap_pct,
          gap52hPct: row.gap_52h_pct,
          radarScore,
          category,
          headline,
        });
      }
    }

    const smartMoneyLeaders: SmartMoneyRadarRow[] = [];
    const sectorAvgTradeMap = new Map<string, number[]>();
    const sectorRet20Map = new Map<string, number[]>();
    const sectorRet5Map = new Map<string, number[]>();
    const marketRet20List: number[] = [];
    const marketRet5List: number[] = [];

    for (const row of pulse.rows) {
      const fullHist = (this.bySymbol.get(row.symbol) || []).filter((h) => h.date <= targetDay);
      if (fullHist.length < 5) continue;

      const last = fullHist[fullHist.length - 1];
      const base20 = fullHist[Math.max(0, fullHist.length - 20)];
      const base5 = fullHist[Math.max(0, fullHist.length - 5)];
      const ret20 =
        (base20.prev_close || base20.close) > 0
          ? (last.close / (base20.prev_close || base20.close) - 1) * 100
          : 0;
      const ret5 =
        (base5.prev_close || base5.close) > 0
          ? (last.close / (base5.prev_close || base5.close) - 1) * 100
          : 0;

      marketRet20List.push(ret20);
      marketRet5List.push(ret5);
      const sec20 = sectorRet20Map.get(row.sector) || [];
      sec20.push(ret20);
      sectorRet20Map.set(row.sector, sec20);

      const sec5 = sectorRet5Map.get(row.sector) || [];
      sec5.push(ret5);
      sectorRet5Map.set(row.sector, sec5);

      const avgTx = row.trans > 0 ? row.turnover / row.trans : 0;
      if (avgTx > 0) {
        const arr = sectorAvgTradeMap.get(row.sector) || [];
        arr.push(avgTx);
        sectorAvgTradeMap.set(row.sector, arr);
      }

      const window20 = fullHist.slice(-Math.max(cleanN, 20));
      const avgTurn20 = mean(window20.map((h) => h.turnover));
      if (avgTurn20 < 800_000) continue;

      const avgTxList20 = window20
        .filter((h) => h.trans > 0)
        .map((h) => h.turnover / h.trans);
      const baseAvgTx = Math.max(1, mean(avgTxList20));
      const avgTradeSizeMult = round2(avgTx / baseAvgTx);

      const upVol = window20.filter((h) => h.diff > 0).reduce((s, h) => s + h.volume, 0);
      const dnVol = window20.filter((h) => h.diff < 0).reduce((s, h) => s + h.volume, 0);
      const upDownVolRatio = round2(upVol / Math.max(dnVol, 1));

      // Pocket Pivot check: today up, vol > max down-day vol in prior 10 sessions, close >= 97% of SMA20
      const prior10 = fullHist.slice(-11, -1);
      const maxDownVol10 = prior10
        .filter((h) => h.diff < 0)
        .reduce((mx, h) => Math.max(mx, h.volume), 0);
      const sma20 = mean(window20.map((h) => h.close));
      const pocketPivot =
        (row.diff_pct ?? 0) > 0 &&
        maxDownVol10 > 0 &&
        row.volume > maxDownVol10 &&
        row.close >= sma20 * 0.97 &&
        row.close <= sma20 * 1.12;

      // Stage-2 proxy out of 6 quick checks
      let st2 = 0;
      if (row.close > sma20) st2++;
      if (row.d120 && row.close > row.d120) st2++;
      if (row.d180 && row.close > row.d180) st2++;
      if (row.gap_52h_pct !== null && row.gap_52h_pct <= 20) st2++;
      if (row.pos_52w_pct !== null && row.pos_52w_pct >= 55) st2++;
      if (upDownVolRatio >= 1.2) st2++;

      const closePos = row.close_pos_pct ?? 50;
      const smScore = round1(
        clip(
          clip((upDownVolRatio / 2.2) * 40, 0, 40) +
            clip((avgTradeSizeMult / 2.0) * 28, 0, 28) +
            (closePos / 100) * 18 +
            (pocketPivot ? 14 : 0),
          0,
          100
        )
      );

      if (smScore >= 52 || pocketPivot) {
        smartMoneyLeaders.push({
          symbol: row.symbol,
          name: row.name,
          sector: row.sector,
          ltp: row.ltp || row.close,
          changePct: row.diff_pct ?? 0,
          smartMoneyScore: smScore,
          avgTradeSizeNpr: Math.round(avgTx),
          avgTradeSizeMult,
          upDownVolRatio,
          pocketPivot,
          stage2ProxyScore: st2,
          vwapPct: row.vwap_pct,
        });
      }
    }

    const mktMean20 = mean(marketRet20List);
    const mktMean5 = mean(marketRet5List);
    const sectorRotationMatrix: SectorRotationQuadrantNode[] = pulse.sectors.map((sec) => {
      const r20 = mean(sectorRet20Map.get(sec.sector) || [0]);
      const r5 = mean(sectorRet5Map.get(sec.sector) || [0]);
      const rsRatio = round2(100 + (r20 - mktMean20));
      const rsMomentum = round2(100 + ((r5 - mktMean5) - (r20 - mktMean20) * 0.25));
      const quadrant: SectorRotationQuadrantNode['quadrant'] =
        rsRatio >= 100 && rsMomentum >= 100
          ? 'Leading'
          : rsRatio < 100 && rsMomentum >= 100
            ? 'Improving'
            : rsRatio >= 100 && rsMomentum < 100
              ? 'Weakening'
              : 'Lagging';
      return {
        sector: sec.sector,
        stockCount: sec.stocks,
        rsRatio,
        rsMomentum,
        quadrant,
        turnoverSharePct: sec.turnoverSharePct,
        rotationDeltaPct: sec.rotationDeltaPct,
        avgChangePct: sec.avgChangePct,
        avgTradeSizeNpr: Math.round(mean(sectorAvgTradeMap.get(sec.sector) || [0])),
        leaderSymbol: sec.leaderSymbol,
        leaderChangePct: sec.leaderChangePct,
      };
    });

    const sorted = points.sort((a, b) => b.radarScore - a.radarScore);
    return {
      date: targetDay,
      nDays: cleanN,
      points: sorted.slice(0, 90),
      accelerationAlerts: sorted.filter((p) => p.category === 'acceleration').slice(0, 20),
      stealthAccumulation: sorted.filter((p) => p.category === 'accumulation').slice(0, 20),
      divergences: sorted
        .filter((p) => p.category === 'bullish_div' || p.category === 'bearish_div')
        .slice(0, 20),
      breakoutWatchlist: sorted.filter((p) => p.category === 'breakout_watch').slice(0, 20),
      sectorLeaders: [...pulse.sectors]
        .sort((a, b) => b.rotationDeltaPct - a.rotationDeltaPct)
        .slice(0, 11),
      sectorRotationMatrix,
      smartMoneyLeaders: smartMoneyLeaders
        .sort((a, b) => b.smartMoneyScore - a.smartMoneyScore)
        .slice(0, 25),
    };
  }

  public compareStocks(
    symbols: string[],
    nDays = 20,
    end?: string
  ): StockComparisonResponse {
    const cleanN = Math.max(2, Math.min(250, Math.round(nDays)));
    const anchorEnd = end && isValidDateStr(end) ? end : this.sortedDates[this.sortedDates.length - 1];
    const cleanSyms = Array.from(
      new Set(
        symbols
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z0-9._-]{1,20}$/.test(s))
      )
    ).slice(0, 5);

    const endIdx = anchorEnd ? this.sortedDates.indexOf(anchorEnd) : this.sortedDates.length - 1;
    const alignedDates =
      endIdx >= 0 ? this.sortedDates.slice(Math.max(0, endIdx - cleanN + 1), endIdx + 1) : [];

    const stocks: CompareStockSummary[] = [];

    for (const sym of cleanSyms) {
      const fullHist = (this.bySymbol.get(sym) || []).filter((h) => !anchorEnd || h.date <= anchorEnd);
      if (fullHist.length === 0) continue;
      const slice = fullHist.slice(-cleanN);
      const last = slice[slice.length - 1];
      const first = slice[0];
      const basePrice = first.prev_close > 0 ? first.prev_close : first.close;
      const avgTurnoverN = mean(slice.map((s) => s.turnover));
      const avgVolumeN = mean(slice.map((s) => s.volume));

      const pos52w =
        last.w52_high !== null && last.w52_low !== null && last.w52_high > last.w52_low
          ? round1(clip(((last.close - last.w52_low) / (last.w52_high - last.w52_low)) * 100, 0, 100))
          : null;

      stocks.push({
        symbol: sym,
        name: this.getLatestName(slice) || last.name || sym,
        sector: getNepseSector(sym, last.name),
        ltp: last.ltp || last.close,
        close: last.close,
        dayChangePct: last.diff_pct ?? 0,
        returnNPct: basePrice > 0 ? round2((last.close / basePrice - 1) * 100) : null,
        avgTurnoverN: round1(avgTurnoverN),
        avgVolumeN: Math.round(avgVolumeN),
        latestTurnover: last.turnover,
        turnoverMultN: avgTurnoverN > 0 ? round2(last.turnover / avgTurnoverN) : 1,
        volumeMultN: avgVolumeN > 0 ? round2(last.volume / avgVolumeN) : 1,
        vwapPct: last.vwap_pct,
        vsD120Pct: last.d120 && last.d120 > 0 ? round2((last.close / last.d120 - 1) * 100) : null,
        pos52wPct: pos52w,
        avgTradeSize: last.trans > 0 ? round1(last.turnover / last.trans) : 0,
        upDaysN: slice.filter((s) => s.diff > 0).length,
        daysN: slice.length,
        series: slice.map((s) => ({
          date: s.date,
          close: s.close,
          indexedPct: basePrice > 0 ? round2((s.close / basePrice - 1) * 100) : 0,
          turnover: s.turnover,
        })),
      });
    }

    return { nDays: cleanN, dates: alignedDates, stocks };
  }

  public getHomepageCommand(
    day?: string,
    nDays = 20,
    equityOnly = true
  ): HomepagePulseResponse | null {
    const cleanN = Math.max(5, Math.min(250, Math.round(nDays)));
    const targetDay =
      day && isValidDateStr(day) ? day : this.sortedDates[this.sortedDates.length - 1];
    if (!targetDay) return null;

    const endIdx = this.sortedDates.indexOf(targetDay);
    const prevDate = endIdx > 0 ? this.sortedDates[endIdx - 1] : null;
    const pulse = this.getMarketPulse(targetDay, equityOnly, { nDays: cleanN });

    const prevMap = new Map<string, PriceRow>();
    let prevTurnover: number | null = null;
    let prevVolume: number | null = null;
    let prevTrades: number | null = null;
    const prevSectorTurn = new Map<string, number>();
    const prevSectorVol = new Map<string, number>();

    if (prevDate) {
      const prevRows = this.getDayPrices(prevDate, equityOnly);
      prevTurnover = 0;
      prevVolume = 0;
      prevTrades = 0;
      for (const r of prevRows) {
        prevMap.set(r.symbol, r);
        prevTurnover += r.turnover || 0;
        prevVolume += r.volume || 0;
        prevTrades += r.trans || 0;
        const sec = getNepseSector(r.symbol, r.name);
        prevSectorTurn.set(sec, (prevSectorTurn.get(sec) || 0) + (r.turnover || 0));
        prevSectorVol.set(sec, (prevSectorVol.get(sec) || 0) + (r.volume || 0));
      }
    }

    const pctChange = (cur: number, base: number | null): number | null =>
      base !== null && base > 0 ? round2(((cur - base) / base) * 100) : null;

    // Equity-consistent rolling window history strip (last 14 sessions up to targetDay)
    const histStartIdx = endIdx >= 0 ? Math.max(0, endIdx - Math.max(cleanN, 14) + 1) : 0;
    const rollingDates =
      endIdx >= 0 ? this.sortedDates.slice(histStartIdx, endIdx + 1) : [targetDay];

    const dailyEqTotals = rollingDates.map((d) => {
      const rows = this.getDayPrices(d, equityOnly);
      let turnover = 0;
      let volume = 0;
      let advancers = 0;
      let decliners = 0;
      let unchanged = 0;
      for (const r of rows) {
        turnover += r.turnover || 0;
        volume += r.volume || 0;
        if ((r.diff_pct ?? 0) > 0) advancers++;
        else if ((r.diff_pct ?? 0) < 0) decliners++;
        else unchanged++;
      }
      return { date: d, turnover, volume, advancers, decliners, unchanged };
    });

    const last5Totals = dailyEqTotals.slice(-5);
    const lastNTotals = dailyEqTotals.slice(-cleanN);
    const avg5dTurnover = mean(last5Totals.map((x) => x.turnover));
    const avgNdTurnover = mean(lastNTotals.map((x) => x.turnover));
    const avg5dVolume = mean(last5Totals.map((x) => x.volume));
    const avgNdVolume = mean(lastNTotals.map((x) => x.volume));

    const stripSource = dailyEqTotals.slice(-14);
    const historyStrip: HomepageHistoryPoint[] = stripSource.map((pt, i) => {
      const prevPt = i > 0 ? stripSource[i - 1] : null;
      return {
        ...pt,
        turnoverVsPrevPct: prevPt ? pctChange(pt.turnover, prevPt.turnover) : null,
        volumeVsPrevPct: prevPt ? pctChange(pt.volume, prevPt.volume) : null,
      };
    });

    // Flow balance (Up-stock rupees vs Down-stock rupees)
    let upTurnover = 0;
    let downTurnover = 0;
    let flatTurnover = 0;
    for (const r of pulse.rows) {
      if ((r.diff_pct ?? 0) > 0) upTurnover += r.turnover;
      else if ((r.diff_pct ?? 0) < 0) downTurnover += r.turnover;
      else flatTurnover += r.turnover;
    }
    const netFlowTiltPct =
      pulse.summary.totalTurnover > 0
        ? round1(((upTurnover - downTurnover) / pulse.summary.totalTurnover) * 100)
        : 0;

    const isPromoterOrFund = (r: PriceRow) =>
      /\bPromoter\b|\bDebenture\b|\bMutual Fund\b|\bPreference\b/i.test(r.name);

    const activeStatsCache = new Map<
      string,
      { activeDays: number; turnMult: number; volMult: number; prior20High: number | null; prior20Low: number | null }
    >();
    const getActiveStats = (r: MarketPulseRow) => {
      const hit = activeStatsCache.get(r.symbol);
      if (hit) return hit;
      const hist = (this.bySymbol.get(r.symbol) || []).filter((h) => h.date <= targetDay);
      const priorWindow = hist.slice(-(cleanN + 1), -1);
      const prior20 = hist.slice(-21, -1);
      const prior20High = prior20.length > 0 ? Math.max(...prior20.map((h) => h.high)) : null;
      const prior20Low = prior20.length > 0 ? Math.min(...prior20.map((h) => h.low)) : null;
      const avgTurn = priorWindow.length > 0 ? mean(priorWindow.map((h) => h.turnover)) : 0;
      const avgVol = priorWindow.length > 0 ? mean(priorWindow.map((h) => h.volume)) : 0;
      const res = {
        activeDays: priorWindow.length,
        turnMult: priorWindow.length >= 3 && avgTurn > 0 ? round2(r.turnover / avgTurn) : r.turnover_vs_avg_n,
        volMult: priorWindow.length >= 3 && avgVol > 0 ? round2(r.volume / avgVol) : r.volume_vs_avg_n,
        prior20High,
        prior20Low,
      };
      activeStatsCache.set(r.symbol, res);
      return res;
    };

    const stockCandidatePool = pulse.rows.filter((r) =>
      equityOnly ? !isPromoterOrFund(r) && r.trans >= 5 : r.trans >= 1
    );

    // Blow-out (Bullish expansion / breakout) & Short-Bias (Distribution / blow-off trap) Scripts of the Day
    const liquidThreshold = Math.max(
      1_500_000,
      pulse.rows.length > 0 ? Math.min(3_000_000, pulse.summary.totalTurnover * 0.0008) : 1_500_000
    );

    const buildSpotlights = (bias: 'blowout' | 'short'): HomepageScriptSpotlight[] => {
      const scored: HomepageScriptSpotlight[] = [];
      for (const r of stockCandidatePool) {
        if (r.turnover < liquidThreshold) continue;
        const stats = getActiveStats(r);
        if (stats.activeDays < 3) continue;
        const chg = r.diff_pct ?? 0;
        const prev = prevMap.get(r.symbol);
        const turnPrevPct = pctChange(r.turnover, prev?.turnover ?? null);
        const volPrevPct = pctChange(r.volume, prev?.volume ?? null);

        if (bias === 'blowout') {
          if (chg <= 0.4) continue;
          const is20dBreak = stats.prior20High !== null && r.close > stats.prior20High;
          const isNear52h = r.gap_52h_pct !== null && r.gap_52h_pct <= 4.0;
          const aboveVwap = (r.vwap_pct ?? 0) > 0;
          const score = round1(
            clip(
              chg * 4.5 +
                Math.min(stats.turnMult, 5) * 9 +
                Math.min(stats.volMult, 5) * 8 +
                (r.close_pos_pct >= 75 ? (r.close_pos_pct - 60) * 0.35 : 0) +
                (aboveVwap ? 8 : 0) +
                (is20dBreak ? 10 : 0) +
                (isNear52h ? 6 : 0),
              0,
              100
            )
          );
          const triggers: string[] = [];
          if (stats.volMult >= 1.5) triggers.push(`${stats.volMult.toFixed(1)}x Vol`);
          if (stats.turnMult >= 1.5) triggers.push(`${stats.turnMult.toFixed(1)}x TO`);
          if (r.close_pos_pct >= 80) triggers.push(`Strong Close (${r.close_pos_pct.toFixed(0)}%)`);
          if (aboveVwap) triggers.push(`Above VWAP (+${(r.vwap_pct ?? 0).toFixed(1)}%)`);
          if (is20dBreak) triggers.push('20D Breakout');
          else if (isNear52h) triggers.push('Near 52W High');

          const setupLabel = is20dBreak
            ? '20D Volume Breakout'
            : chg >= 8.5
              ? 'Circuit Expansion'
              : stats.turnMult >= 2.2
                ? 'Flow Acceleration'
                : 'Momentum Leader';

          scored.push({
            symbol: r.symbol,
            name: r.name,
            sector: r.sector,
            bias: 'blowout',
            setupLabel,
            ltp: r.ltp || r.close,
            diffPct: chg,
            turnover: r.turnover,
            volume: r.volume,
            prevTurnover: prev?.turnover ?? null,
            prevVolume: prev?.volume ?? null,
            turnoverVsPrevPct: turnPrevPct,
            volumeVsPrevPct: volPrevPct,
            turnoverMultN: stats.turnMult,
            volumeMultN: stats.volMult,
            closePosPct: r.close_pos_pct,
            rangePct: r.range_pct ?? 0,
            vwapPct: r.vwap_pct,
            avgTradeSize: r.avg_trade_size,
            score,
            headline: `Gained +${chg.toFixed(1)}% on ${stats.volMult.toFixed(1)}x vol & ${stats.turnMult.toFixed(1)}x turnover (Rs ${(r.turnover / 1e7).toFixed(2)} Cr), closing at ${r.close_pos_pct.toFixed(0)}% of day range.`,
            triggers: triggers.slice(0, 4),
          });
        } else {
          const isWickTrap =
            (r.range_pct ?? 0) >= 3.2 && r.close_pos_pct <= 28 && (r.vwap_pct ?? 0) < 0;
          const isSelloff = chg <= -0.8;
          if (!isSelloff && !isWickTrap) continue;

          const is20dBreakDown = stats.prior20Low !== null && r.close < stats.prior20Low;
          const belowVwap = (r.vwap_pct ?? 0) < 0;
          const score = round1(
            clip(
              Math.max(0, -chg) * 5.0 +
                Math.min(stats.turnMult, 5) * 8 +
                Math.min(stats.volMult, 5) * 7 +
                (r.close_pos_pct <= 35 ? (40 - r.close_pos_pct) * 0.45 : 0) +
                (belowVwap ? 8 : 0) +
                (isWickTrap ? 12 : 0) +
                (is20dBreakDown ? 10 : 0),
              0,
              100
            )
          );
          const triggers: string[] = [];
          if (stats.volMult >= 1.5) triggers.push(`${stats.volMult.toFixed(1)}x Vol`);
          if (stats.turnMult >= 1.5) triggers.push(`${stats.turnMult.toFixed(1)}x TO`);
          if (r.close_pos_pct <= 30) triggers.push(`Weak Close (${r.close_pos_pct.toFixed(0)}%)`);
          if (belowVwap) triggers.push(`Below VWAP (${(r.vwap_pct ?? 0).toFixed(1)}%)`);
          if (isWickTrap) triggers.push('Upper-Wick Trap');
          if (is20dBreakDown) triggers.push('20D Breakdown');

          const setupLabel = isWickTrap && chg >= -0.8
            ? 'Blow-Off Wick Exhaustion'
            : is20dBreakDown
              ? 'Heavy Breakdown'
              : stats.turnMult >= 2.0
                ? 'High-Volume Distribution'
                : 'Short-Bias Selloff';

          scored.push({
            symbol: r.symbol,
            name: r.name,
            sector: r.sector,
            bias: 'short',
            setupLabel,
            ltp: r.ltp || r.close,
            diffPct: chg,
            turnover: r.turnover,
            volume: r.volume,
            prevTurnover: prev?.turnover ?? null,
            prevVolume: prev?.volume ?? null,
            turnoverVsPrevPct: turnPrevPct,
            volumeVsPrevPct: volPrevPct,
            turnoverMultN: stats.turnMult,
            volumeMultN: stats.volMult,
            closePosPct: r.close_pos_pct,
            rangePct: r.range_pct ?? 0,
            vwapPct: r.vwap_pct,
            avgTradeSize: r.avg_trade_size,
            score,
            headline: isWickTrap && chg >= -0.8
              ? `Intraday blow-off fade: ${(r.range_pct ?? 0).toFixed(1)}% swing closed at bottom ${r.close_pos_pct.toFixed(0)}% of range below VWAP on ${stats.volMult.toFixed(1)}x vol.`
              : `Dropped ${chg.toFixed(1)}% on ${stats.volMult.toFixed(1)}x vol & ${stats.turnMult.toFixed(1)}x turnover (Rs ${(r.turnover / 1e7).toFixed(2)} Cr), closing near low (${r.close_pos_pct.toFixed(0)}%).`,
            triggers: triggers.slice(0, 4),
          });
        }
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, 4);
    };

    const blowoutScripts = buildSpotlights('blowout');
    const shortScripts = buildSpotlights('short');

    // Unusual Activity: ranked by Volume Spike + Turnover Spike (with liquidity & active-history floors)
    const minUnusualTurn = Math.max(1_500_000, pulse.summary.totalTurnover * 0.0005);
    const unusualPool = stockCandidatePool
      .filter((r) => r.turnover >= minUnusualTurn && getActiveStats(r).activeDays >= 4)
      .map((r) => {
        const stats = getActiveStats(r);
        const prev = prevMap.get(r.symbol);
        const chg = r.diff_pct ?? 0;
        let activityTag: HomepageUnusualStockRow['activityTag'] = 'Accumulation Surge';
        if (chg >= 2.0 && r.close_pos_pct >= 70) {
          activityTag = 'Breakout Spike';
        } else if (chg <= -1.5 && r.close_pos_pct <= 35) {
          activityTag = 'Heavy Distribution';
        } else if (r.close_pos_pct <= 28 && (r.range_pct ?? 0) >= 3.0) {
          activityTag = 'Wick Churn / Trap';
        } else if (Math.abs(chg) <= 1.2 && r.close_pos_pct >= 50) {
          activityTag = 'Silent Absorption';
        }
        return {
          row: r,
          stats,
          spikeScore: stats.volMult * 0.5 + stats.turnMult * 0.5,
          item: {
            symbol: r.symbol,
            name: r.name,
            sector: r.sector,
            ltp: r.ltp || r.close,
            diffPct: chg,
            turnover: r.turnover,
            volume: r.volume,
            trans: r.trans,
            prevTurnover: prev?.turnover ?? null,
            prevVolume: prev?.volume ?? null,
            turnoverVsPrevPct: pctChange(r.turnover, prev?.turnover ?? null),
            volumeVsPrevPct: pctChange(r.volume, prev?.volume ?? null),
            turnoverMultN: stats.turnMult,
            volumeMultN: stats.volMult,
            closePosPct: r.close_pos_pct,
            vwapPct: r.vwap_pct,
            avgTradeSize: r.avg_trade_size,
            activityTag,
          } satisfies HomepageUnusualStockRow,
        };
      });

    const spiked = unusualPool.filter(
      (x) => x.stats.volMult >= 1.5 || x.stats.turnMult >= 1.5
    );
    const unusualActivity = (spiked.length >= 6 ? spiked : unusualPool)
      .sort((a, b) => b.spikeScore - a.spikeScore)
      .slice(0, 15)
      .map((x) => x.item);

    // Top Turnover Up & Top Turnover Down
    const mapTopTurnover = (list: MarketPulseRow[]): HomepageTopTurnoverRow[] =>
      list.slice(0, 8).map((r, i) => {
        const stats = getActiveStats(r);
        const prev = prevMap.get(r.symbol);
        return {
          rank: i + 1,
          symbol: r.symbol,
          name: r.name,
          sector: r.sector,
          ltp: r.ltp || r.close,
          diffPct: r.diff_pct ?? 0,
          turnover: r.turnover,
          marketSharePct:
            pulse.summary.totalTurnover > 0
              ? round2((r.turnover / pulse.summary.totalTurnover) * 100)
              : 0,
          volume: r.volume,
          trans: r.trans,
          prevTurnover: prev?.turnover ?? null,
          turnoverVsPrevPct: pctChange(r.turnover, prev?.turnover ?? null),
          turnoverMultN: stats.turnMult,
          volumeMultN: stats.volMult,
          closePosPct: r.close_pos_pct,
          vwapPct: r.vwap_pct,
          avgTradeSize: r.avg_trade_size,
        };
      });

    const topTurnoverUp = mapTopTurnover(
      [...stockCandidatePool]
        .filter((r) => (r.diff_pct ?? 0) > 0)
        .sort((a, b) => b.turnover - a.turnover)
    );
    const topTurnoverDown = mapTopTurnover(
      [...stockCandidatePool]
        .filter((r) => (r.diff_pct ?? 0) < 0)
        .sort((a, b) => b.turnover - a.turnover)
    );

    // Sector & Stock Heat Map
    const secVolMap = new Map<string, number>();
    for (const r of pulse.rows) {
      secVolMap.set(r.sector, (secVolMap.get(r.sector) || 0) + (r.volume || 0));
    }

    const sectorHeatmap: HomepageSectorHeatmapRow[] = pulse.sectors.map((sec) => {
      const vol = secVolMap.get(sec.sector) || 0;
      const pTurn = prevDate ? (prevSectorTurn.get(sec.sector) ?? 0) : null;
      const pVol = prevDate ? (prevSectorVol.get(sec.sector) ?? 0) : null;
      return {
        ...sec,
        volume: vol,
        prevTurnover: pTurn,
        prevVolume: pVol,
        turnoverVsPrevPct: pctChange(sec.turnover, pTurn),
        volumeVsPrevPct: pctChange(vol, pVol),
      };
    });

    const stockHeatmap: HomepageHeatmapStock[] = [...stockCandidatePool]
      .sort((a, b) => b.turnover - a.turnover)
      .slice(0, 60)
      .map((r) => {
        const prev = prevMap.get(r.symbol);
        const stats = getActiveStats(r);
        return {
          symbol: r.symbol,
          name: r.name,
          sector: r.sector,
          ltp: r.ltp || r.close,
          diffPct: r.diff_pct ?? 0,
          turnover: r.turnover,
          turnoverSharePct:
            pulse.summary.totalTurnover > 0
              ? round2((r.turnover / pulse.summary.totalTurnover) * 100)
              : 0,
          volume: r.volume,
          turnoverMultN: stats.turnMult,
          volumeMultN: stats.volMult,
          turnoverVsPrevPct: pctChange(r.turnover, prev?.turnover ?? null),
          closePosPct: r.close_pos_pct,
          vwapPct: r.vwap_pct,
        };
      });

    // "Aha / Wow" automated discovery callouts
    const wowInsights: HomepageWowInsight[] = [];
    const topRotatingSector = [...sectorHeatmap].sort(
      (a, b) => b.rotationDeltaPct - a.rotationDeltaPct
    )[0];
    if (topRotatingSector) {
      wowInsights.push({
        id: 'sector-rotation',
        category: 'Sector Rotation',
        title: `${topRotatingSector.sector} leads money rotation`,
        detail: `Captured ${topRotatingSector.turnoverSharePct.toFixed(1)}% of NEPSE turnover (${topRotatingSector.rotationDeltaPct >= 0 ? '+' : ''}${topRotatingSector.rotationDeltaPct.toFixed(1)} pp vs ${cleanN}D avg) led by ${topRotatingSector.leaderSymbol}.`,
        symbol: topRotatingSector.leaderSymbol,
        tone: topRotatingSector.avgChangePct >= 0 ? 'emerald' : 'amber',
      });
    }

    wowInsights.push({
      id: 'flow-tilt',
      category: 'Capital Flow Balance',
      title:
        netFlowTiltPct >= 10
          ? 'Rupees decisively chasing green stocks'
          : netFlowTiltPct <= -10
            ? 'Turnover heavy in declining stocks'
            : 'Balanced two-way institutional rotation',
      detail: `Rs ${(upTurnover / 1e7).toFixed(1)} Cr flowed into advancing scripts vs Rs ${(downTurnover / 1e7).toFixed(1)} Cr into declining scripts (${netFlowTiltPct >= 0 ? '+' : ''}${netFlowTiltPct.toFixed(0)}% net tilt).`,
      tone: netFlowTiltPct >= 10 ? 'emerald' : netFlowTiltPct <= -10 ? 'red' : 'blue',
    });

    const stealthPick = unusualActivity.find((u) => u.activityTag === 'Silent Absorption');
    if (stealthPick) {
      wowInsights.push({
        id: 'stealth-absorption',
        category: 'Silent Absorption',
        title: `${stealthPick.symbol} absorbing ${stealthPick.turnoverMultN.toFixed(1)}x turnover quietly`,
        detail: `Price moved only ${stealthPick.diffPct >= 0 ? '+' : ''}${stealthPick.diffPct.toFixed(1)}% while volume spiked ${stealthPick.volumeMultN.toFixed(1)}x ${cleanN}D avg (avg ticket Rs ${(stealthPick.avgTradeSize / 1000).toFixed(0)}k).`,
        symbol: stealthPick.symbol,
        tone: 'blue',
      });
    } else if (blowoutScripts[0]) {
      const b0 = blowoutScripts[0];
      wowInsights.push({
        id: 'top-expansion',
        category: 'Expansion Leader',
        title: `${b0.symbol} triggered ${b0.setupLabel}`,
        detail: b0.headline,
        symbol: b0.symbol,
        tone: 'emerald',
      });
    }

    const trapOrShort = shortScripts[0];
    if (trapOrShort) {
      wowInsights.push({
        id: 'distribution-watch',
        category: 'Distribution / Trap Watch',
        title: `${trapOrShort.symbol} flagged (${trapOrShort.setupLabel})`,
        detail: trapOrShort.headline,
        symbol: trapOrShort.symbol,
        tone: 'red',
      });
    }

    return {
      summary: {
        date: targetDay,
        prevDate,
        nDays: cleanN,
        totalStocks: pulse.summary.total,
        advancers: pulse.summary.advancers,
        decliners: pulse.summary.decliners,
        unchanged: pulse.summary.unchanged,
        adRatio: pulse.summary.adRatio,
        todayTurnover: pulse.summary.totalTurnover,
        prevTurnover,
        avg5dTurnover,
        avgNdTurnover,
        turnoverVsPrevPct: pctChange(pulse.summary.totalTurnover, prevTurnover),
        turnoverVs5dPct: pctChange(pulse.summary.totalTurnover, avg5dTurnover),
        turnoverVsNdPct: pctChange(pulse.summary.totalTurnover, avgNdTurnover),
        todayVolume: pulse.summary.totalVolume,
        prevVolume,
        avg5dVolume,
        avgNdVolume,
        volumeVsPrevPct: pctChange(pulse.summary.totalVolume, prevVolume),
        volumeVs5dPct: pctChange(pulse.summary.totalVolume, avg5dVolume),
        volumeVsNdPct: pctChange(pulse.summary.totalVolume, avgNdVolume),
        todayTrades: pulse.summary.totalTrades,
        prevTrades,
        tradesVsPrevPct: pctChange(pulse.summary.totalTrades, prevTrades),
        upTurnover,
        downTurnover,
        flatTurnover,
        netFlowTiltPct,
        sentimentScore: pulse.summary.sentimentScore,
        sentimentLabel: pulse.summary.sentimentLabel,
        aboveVwap: pulse.summary.aboveVwap,
        vwapEligible: pulse.summary.vwapEligible,
        aboveMa120: pulse.summary.aboveMa120,
        ma120Eligible: pulse.summary.ma120Eligible,
        upperCircuitCount: pulse.summary.upperCircuitCount,
        lowerCircuitCount: pulse.summary.lowerCircuitCount,
        medianAvgTradeSize: pulse.summary.medianAvgTradeSize,
        top5ConcentrationPct: pulse.summary.top5ConcentrationPct,
      },
      historyStrip,
      blowoutScripts,
      shortScripts,
      unusualActivity,
      topTurnoverUp,
      topTurnoverDown,
      sectorHeatmap,
      stockHeatmap,
      wowInsights: wowInsights.slice(0, 4),
    };
  }
}
