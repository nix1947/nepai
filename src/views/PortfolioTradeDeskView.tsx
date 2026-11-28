import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  CandlestickChart,
  CheckCircle2,
  Crosshair,
  Download,
  Layers,
  Plus,
  Rocket,
  Scale,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
} from 'lucide-react';
import {
  usePortfolioDesk,
  type HoldingTerm,
  type PortfolioHolding,
  type TradeJournalEntry,
  type TradeSetupTag,
} from '../hooks/usePortfolioDesk';
import { useWatchlist } from '../hooks/useWatchlist';
import type { MasterScreenerResponse, MasterScreenerRow } from '../types/fundamental';
import {
  calcNepseBuyCost,
  calcNepseSellProceeds,
  solvePriceForNetProceeds,
} from '../utils/nepseFees';

interface PortfolioTradeDeskViewProps {
  masterData: MasterScreenerResponse | null;
  loadingMaster: boolean;
  onInspectSymbol: (symbol: string) => void;
  onInspectInAnalyzer: (symbol: string) => void;
  onOpenValuation: (symbol: string) => void;
  onInspectInScreener: (symbol: string) => void;
}

type DeskTab = 'holdings' | 'deployer' | 'journal';
type DeployGoal = 'balanced' | 'undervalued' | 'blowup_qtr' | 'fd_yield';

const SETUP_TAGS: TradeSetupTag[] = [
  'Undervalued Compounder',
  'Qtr Blow-Up Catalyst',
  'ICT Order Block',
  '20D Breakout',
  'Swing Pullback',
  'Dividend / Bonus Play',
];

function fmtNpr(val: number | null | undefined, decimals = 0): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const abs = Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return val < 0 ? `-NPR ${abs}` : `NPR ${abs}`;
}

function fmtPct(val: number | null | undefined, digits = 1): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return `${val >= 0 ? '+' : ''}${val.toFixed(digits)}%`;
}

interface EnrichedHolding {
  holding: PortfolioHolding;
  row: MasterScreenerRow | null;
  ltp: number;
  buyCost: ReturnType<typeof calcNepseBuyCost>;
  grossMarketValue: number;
  sellCalc: ReturnType<typeof calcNepseSellProceeds>;
  breakevenPrice: number;
  netPnlPct: number;
  dayChangeNpr: number;
  mosPct: number | null;
  effectiveBuyDate: string;
  daysHeld: number;
  daysToLongTerm: number;
  ltcgUnlockDate: string;
  cgtSavingsNpr: number;
  alerts: Array<{ severity: 'high' | 'warn'; text: string }>;
}

export const PortfolioTradeDeskView: React.FC<PortfolioTradeDeskViewProps> = ({
  masterData,
  loadingMaster,
  onInspectSymbol,
  onInspectInAnalyzer,
  onOpenValuation,
  onInspectInScreener,
}) => {
  const {
    holdings,
    journal,
    liquidCash,
    setLiquidCash,
    addHolding,
    removeHolding,
    updateHolding,
    clearAllHoldings,
    addJournalTrade,
    closeJournalTrade,
    removeJournalTrade,
    importDeskBackup,
  } = usePortfolioDesk();
  const { watchlist, addSymbol: addToWatchlist } = useWatchlist();

  const [activeDeskTab, setActiveDeskTab] = useState<DeskTab>('holdings');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Add holding form state
  const [newSymbol, setNewSymbol] = useState<string>('');
  const [newShares, setNewShares] = useState<string>('100');
  const [newBuyPrice, setNewBuyPrice] = useState<string>('');
  const [newBuyDate, setNewBuyDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newTerm, setNewTerm] = useState<HoldingTerm>('short');
  const [newStop, setNewStop] = useState<string>('');
  const [newTarget, setNewTarget] = useState<string>('');
  const [newNotes, setNewNotes] = useState<string>('');

  // Close-to-journal / edit inline state
  const [closingHoldingId, setClosingHoldingId] = useState<string | null>(null);
  const [closingHoldingPrice, setClosingHoldingPrice] = useState<string>('');
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [closingTradePrice, setClosingTradePrice] = useState<string>('');

  // Smart Capital Deployer state
  const [deployBudget, setDeployBudget] = useState<number>(200_000);
  const [deployGoal, setDeployGoal] = useState<DeployGoal>('balanced');
  const [maxWeightPct, setMaxWeightPct] = useState<number>(25);
  const [minAvgTurnCr, setMinAvgTurnCr] = useState<number>(0.5);
  const [roundLot10, setRoundLot10] = useState<boolean>(true);

  // Trade Journal form state
  const [jSymbol, setJSymbol] = useState<string>('');
  const [jRiskNpr, setJRiskNpr] = useState<string>('3000');
  const [jEntry, setJEntry] = useState<string>('');
  const [jStop, setJStop] = useState<string>('');
  const [jTarget, setJTarget] = useState<string>('');
  const [jShares, setJShares] = useState<string>('');
  const [jCgtRate, setJCgtRate] = useState<0.075 | 0.05>(0.075);
  const [jTag, setJTag] = useState<TradeSetupTag>('Undervalued Compounder');
  const [jThesis, setJThesis] = useState<string>('');
  const [jRulesOk, setJRulesOk] = useState<boolean>(true);

  const rows = masterData?.rows ?? [];
  const rowMap = useMemo(() => {
    const m = new Map<string, MasterScreenerRow>();
    for (const r of rows) m.set(r.symbol, r);
    return m;
  }, [rows]);

  const sortedSymbols = useMemo(
    () => [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [rows]
  );

  // Enrich all holdings with live market, fees, CGT, and fundamental/KB danger flags
  const enrichedHoldings: EnrichedHolding[] = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayMs = Date.parse(`${todayIso}T00:00:00Z`);

    return holdings.map((h) => {
      const row = rowMap.get(h.symbol) ?? null;
      const ltp = row?.ltp && row.ltp > 0 ? row.ltp : h.buyPrice;
      const effectiveBuyDate =
        h.buyDate && /^\d{4}-\d{2}-\d{2}$/.test(h.buyDate) ? h.buyDate : h.addedAt;
      const buyMs = Date.parse(`${effectiveBuyDate}T00:00:00Z`);
      const daysHeld = Number.isNaN(buyMs)
        ? 0
        : Math.max(0, Math.floor((todayMs - buyMs) / 86_400_000));
      const daysToLongTerm = Math.max(0, 366 - daysHeld);
      const unlockDt = Number.isNaN(buyMs) ? new Date() : new Date(buyMs + 366 * 86_400_000);
      const ltcgUnlockDate = unlockDt.toISOString().slice(0, 10);

      const effectiveTerm: HoldingTerm = daysHeld > 365 ? 'long' : h.holdingTerm;
      const cgtRate = effectiveTerm === 'long' ? 0.05 : 0.075;
      const buyCost = calcNepseBuyCost(h.shares, h.buyPrice);
      const grossMarketValue = h.shares * ltp;
      const sellCalc = calcNepseSellProceeds(h.shares, ltp, buyCost.total, 0, cgtRate);
      const shortSellCalc = calcNepseSellProceeds(h.shares, ltp, buyCost.total, 0, 0.075);
      const longSellCalc = calcNepseSellProceeds(h.shares, ltp, buyCost.total, 0, 0.05);
      const cgtSavingsNpr = Math.max(0, shortSellCalc.cgt - longSellCalc.cgt);

      const breakevenPrice = solvePriceForNetProceeds(h.shares, buyCost.total, cgtRate, buyCost.total);
      const netPnlPct = buyCost.total > 0 ? (sellCalc.netProfit / buyCost.total) * 100 : 0;
      const prevClose =
        row?.changePct !== null && row?.changePct !== undefined && row.ltp
          ? row.ltp / (1 + row.changePct / 100)
          : ltp;
      const dayChangeNpr = (ltp - prevClose) * h.shares;
      const mosPct = row?.valuation.marginOfSafetyPct ?? null;

      const alerts: EnrichedHolding['alerts'] = [];
      if (row?.fundamentals.lockInOverhangFlag) {
        alerts.push({ severity: 'high', text: 'CDSC promoter/share lock-in overhang flagged' });
      }
      if (row?.fundamentals.regulatoryStanding === 'Alert') {
        alerts.push({ severity: 'high', text: 'Regulatory Knowledge Base alert active' });
      }
      if (row?.comingQuarterOutlook.direction === 'Blow Down') {
        alerts.push({
          severity: 'high',
          text: `${row.comingQuarterOutlook.comingQuarterLabel} Blow-Down risk (${row.comingQuarterOutlook.score})`,
        });
      } else if (row?.comingQuarterOutlook.direction === 'Downside Risk') {
        alerts.push({
          severity: 'warn',
          text: `${row.comingQuarterOutlook.comingQuarterLabel} Downside Risk (${row.comingQuarterOutlook.score})`,
        });
      }
      if (h.stopLoss && ltp <= h.stopLoss) {
        alerts.push({ severity: 'high', text: `LTP Rs ${ltp.toFixed(0)} breached SL Rs ${h.stopLoss.toFixed(0)}` });
      } else if (h.targetPrice && ltp >= h.targetPrice) {
        alerts.push({ severity: 'warn', text: `Target Rs ${h.targetPrice.toFixed(0)} reached — review exit` });
      }
      if (mosPct !== null && mosPct <= -25) {
        alerts.push({ severity: 'warn', text: `Overvalued by ${Math.abs(mosPct).toFixed(0)}% vs Fair Value` });
      }

      return {
        holding: h,
        row,
        ltp,
        buyCost,
        grossMarketValue,
        sellCalc,
        breakevenPrice,
        netPnlPct,
        dayChangeNpr,
        mosPct,
        effectiveBuyDate,
        daysHeld,
        daysToLongTerm,
        ltcgUnlockDate,
        cgtSavingsNpr,
        alerts,
      };
    });
  }, [holdings, rowMap]);

  const portfolioStats = useMemo(() => {
    let totalInvested = 0;
    let totalGrossMarket = 0;
    let totalNetLiquidationEquity = 0;
    let totalNetPnl = 0;
    let totalDayChange = 0;
    let totalPotentialCgtSavings = 0;
    let mosWeightedSum = 0;
    let mosWeightDenom = 0;
    let masterWeightedSum = 0;
    let masterWeightDenom = 0;
    const sectorMap = new Map<string, number>();
    const riskList: Array<{ symbol: string; severity: 'high' | 'warn'; text: string }> = [];

    for (const item of enrichedHoldings) {
      totalInvested += item.buyCost.total;
      totalGrossMarket += item.grossMarketValue;
      totalNetLiquidationEquity += item.sellCalc.netReceivable;
      totalNetPnl += item.sellCalc.netProfit;
      totalDayChange += item.dayChangeNpr;
      if (item.daysToLongTerm > 0 && item.cgtSavingsNpr > 0) {
        totalPotentialCgtSavings += item.cgtSavingsNpr;
      }

      const sec = item.row?.sector || 'Unclassified';
      sectorMap.set(sec, (sectorMap.get(sec) ?? 0) + item.grossMarketValue);

      if (item.mosPct !== null) {
        mosWeightedSum += item.mosPct * item.grossMarketValue;
        mosWeightDenom += item.grossMarketValue;
      }
      if (item.row) {
        masterWeightedSum += item.row.masterScore * item.grossMarketValue;
        masterWeightDenom += item.grossMarketValue;
      }
      for (const a of item.alerts) {
        riskList.push({ symbol: item.holding.symbol, severity: a.severity, text: a.text });
      }
    }

    const sectorBreakdown = Array.from(sectorMap.entries())
      .map(([sector, value]) => ({
        sector,
        value,
        weightPct: totalGrossMarket > 0 ? (value / totalGrossMarket) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);

    const concentratedSectors = sectorBreakdown.filter((s) => s.weightPct > 35 && enrichedHoldings.length >= 2);
    const totalEquityPlusCash = totalNetLiquidationEquity + liquidCash;
    const totalReturnPct = totalInvested > 0 ? (totalNetPnl / totalInvested) * 100 : 0;

    return {
      totalInvested,
      totalGrossMarket,
      totalNetLiquidationEquity,
      totalEquityPlusCash,
      totalNetPnl,
      totalReturnPct,
      totalDayChange,
      totalPotentialCgtSavings,
      weightedMosPct: mosWeightDenom > 0 ? mosWeightedSum / mosWeightDenom : null,
      weightedMasterScore: masterWeightDenom > 0 ? masterWeightedSum / masterWeightDenom : null,
      sectorBreakdown,
      concentratedSectors,
      riskList,
    };
  }, [enrichedHoldings, liquidCash]);

  // Journal Realized Metrics
  const journalSummary = useMemo(() => {
    const closed = journal.filter((t) => t.status === 'closed' && t.exitPrice && t.exitPrice > 0);
    const open = journal.filter((t) => t.status === 'open');
    let realizedNetNpr = 0;
    let winCount = 0;
    let grossWins = 0;
    let grossLosses = 0;
    let rSum = 0;
    let rCount = 0;
    let rulesKept = 0;

    const byTag = new Map<TradeSetupTag, { count: number; wins: number; netNpr: number }>();

    const enrichedEntries = journal.map((t) => {
      const row = rowMap.get(t.symbol) ?? null;
      const buyCost = calcNepseBuyCost(t.shares, t.entryPrice);
      const refPrice = t.status === 'closed' && t.exitPrice ? t.exitPrice : row?.ltp ?? t.entryPrice;
      const sellCalc = calcNepseSellProceeds(t.shares, refPrice, buyCost.total, 0, t.cgtRate);
      const riskPerShare = t.entryPrice - t.stopLoss;
      const rMultiple =
        riskPerShare > 0.05 ? (refPrice - t.entryPrice) / riskPerShare : null;

      if (t.status === 'closed' && t.exitPrice) {
        realizedNetNpr += sellCalc.netProfit;
        if (t.rulesFollowed) rulesKept++;
        if (sellCalc.netProfit > 0) {
          winCount++;
          grossWins += sellCalc.netProfit;
        } else {
          grossLosses += Math.abs(sellCalc.netProfit);
        }
        if (rMultiple !== null && Number.isFinite(rMultiple)) {
          rSum += rMultiple;
          rCount++;
        }
        const cur = byTag.get(t.setupTag) ?? { count: 0, wins: 0, netNpr: 0 };
        cur.count++;
        if (sellCalc.netProfit > 0) cur.wins++;
        cur.netNpr += sellCalc.netProfit;
        byTag.set(t.setupTag, cur);
      }

      return { entry: t, row, refPrice, buyCost, sellCalc, rMultiple };
    });

    const winRatePct = closed.length > 0 ? (winCount / closed.length) * 100 : null;
    const avgR = rCount > 0 ? rSum / rCount : null;
    const expectancyNpr = closed.length > 0 ? realizedNetNpr / closed.length : null;
    const profitFactor =
      grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99 : null;
    const disciplinePct = closed.length > 0 ? (rulesKept / closed.length) * 100 : null;

    return {
      enrichedEntries,
      openCount: open.length,
      closedCount: closed.length,
      realizedNetNpr,
      winRatePct,
      avgR,
      expectancyNpr,
      profitFactor,
      disciplinePct,
      tagBreakdown: Array.from(byTag.entries()).sort((a, b) => b[1].netNpr - a[1].netNpr),
    };
  }, [journal, rowMap]);

  // Smart Capital Deployer Engine
  const deploymentPlan = useMemo(() => {
    if (rows.length === 0 || deployBudget < 5000) return [];
    const safeMaxWeight = Math.min(50, Math.max(10, maxWeightPct)) / 100;
    const targetCount = Math.min(6, Math.max(3, Math.ceil(1 / safeMaxWeight)));

    const eligible = rows.filter((r) => {
      if (!r.ltp || r.ltp <= 0 || !r.hasFundamentalData) return false;
      if (r.fundamentals.lockInOverhangFlag) return false;
      if (r.fundamentals.regulatoryStanding === 'Alert') return false;
      if (r.fundamentals.verdict === 'AVOID') return false;
      if (r.comingQuarterOutlook.direction === 'Blow Down') return false;
      if (r.liquidity.avgTurnover20Cr < minAvgTurnCr) return false;
      if (deployGoal === 'undervalued' && (r.valuation.marginOfSafetyPct ?? -99) < 8) return false;
      if (
        deployGoal === 'blowup_qtr' &&
        r.comingQuarterOutlook.direction !== 'Blow Up' &&
        r.comingQuarterOutlook.direction !== 'Moderate Upside'
      ) {
        return false;
      }
      if (deployGoal === 'fd_yield' && (r.valuation.fdSpreadPct ?? -99) < 0) return false;
      return true;
    });

    const ranked = [...eligible]
      .sort((a, b) => {
        if (deployGoal === 'undervalued') {
          return (
            ((b.valuation.marginOfSafetyPct ?? 0) * 0.7 + (b.fundamentals.overallScore * 0.4)) -
            ((a.valuation.marginOfSafetyPct ?? 0) * 0.7 + (a.fundamentals.overallScore * 0.4))
          );
        }
        if (deployGoal === 'blowup_qtr') {
          return (
            (b.comingQuarterOutlook.score * 0.8 + b.liquidity.playerInterestScore * 0.35) -
            (a.comingQuarterOutlook.score * 0.8 + a.liquidity.playerInterestScore * 0.35)
          );
        }
        if (deployGoal === 'fd_yield') {
          return (
            ((b.valuation.fdSpreadPct ?? 0) * 4 + b.fundamentals.overallScore * 0.5) -
            ((a.valuation.fdSpreadPct ?? 0) * 4 + a.fundamentals.overallScore * 0.5)
          );
        }
        return b.masterScore - a.masterScore;
      })
      .slice(0, targetCount);

    if (ranked.length === 0) return [];

    // Diversity & weight allocation bounded by safeMaxWeight
    const rawWeights = ranked.map((_, idx) => ranked.length - idx + 1);
    const sumWeights = rawWeights.reduce((s, w) => s + w, 0);

    return ranked.map((r, idx) => {
      const price = r.ltp || 100;
      const idealWeight = Math.min(safeMaxWeight, rawWeights[idx] / sumWeights);
      const rawCap = deployBudget * idealWeight;
      const rawShares = Math.floor(rawCap / (price * 1.0045));
      const shares = roundLot10 ? Math.floor(rawShares / 10) * 10 : rawShares;
      const buyCost = calcNepseBuyCost(shares, price);
      const suggestedStop = Number((price * 0.92).toFixed(1));
      const suggestedTarget =
        r.valuation.compositeFairValue && r.valuation.compositeFairValue > price * 1.05
          ? Number(r.valuation.compositeFairValue.toFixed(1))
          : Number((price * 1.18).toFixed(1));

      return {
        row: r,
        shares,
        price,
        weightPct: deployBudget > 0 ? (buyCost.total / deployBudget) * 100 : 0,
        buyCost,
        suggestedStop,
        suggestedTarget,
      };
    }).filter((item) => item.shares > 0);
  }, [rows, deployBudget, deployGoal, maxWeightPct, minAvgTurnCr, roundLot10]);

  const handleSelectHoldingSymbol = (sym: string) => {
    const clean = sym.toUpperCase();
    setNewSymbol(clean);
    const match = rowMap.get(clean);
    if (match?.ltp) {
      setNewBuyPrice(String(match.ltp));
      setNewStop(String((match.ltp * 0.92).toFixed(1)));
      setNewTarget(
        match.valuation.compositeFairValue && match.valuation.compositeFairValue > match.ltp
          ? String(match.valuation.compositeFairValue.toFixed(1))
          : String((match.ltp * 1.15).toFixed(1))
      );
    }
  };

  const handleAddHoldingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    const shares = Number(newShares);
    const buyPrice = Number(newBuyPrice);
    if (!sym || !(shares > 0) || !(buyPrice > 0)) {
      setFeedback({ kind: 'err', text: 'Enter a valid symbol, kitta (>0), and WACC price (>0).' });
      return;
    }
    const buyMs = Date.parse(`${newBuyDate}T00:00:00Z`);
    const daysHeld = Number.isNaN(buyMs) ? 0 : Math.floor((Date.now() - buyMs) / 86_400_000);
    const resolvedTerm: HoldingTerm = daysHeld > 365 ? 'long' : newTerm;
    addHolding({
      symbol: sym,
      shares,
      buyPrice,
      holdingTerm: resolvedTerm,
      buyDate: newBuyDate,
      stopLoss: Number(newStop) > 0 ? Number(newStop) : null,
      targetPrice: Number(newTarget) > 0 ? Number(newTarget) : null,
      notes: newNotes,
    });
    setFeedback({ kind: 'ok', text: `Added ${shares} kitta of ${sym} @ Rs ${buyPrice} to portfolio.` });
    setNewSymbol('');
    setNewBuyPrice('');
    setNewStop('');
    setNewTarget('');
    setNewNotes('');
  };

  const handleLoadTopStarterPicks = () => {
    const picks = rows
      .filter(
        (r) =>
          r.hasFundamentalData &&
          r.ltp &&
          r.ltp > 0 &&
          !r.fundamentals.lockInOverhangFlag &&
          r.fundamentals.regulatoryStanding !== 'Alert'
      )
      .sort((a, b) => b.masterScore - a.masterScore)
      .slice(0, 3);
    if (picks.length === 0) return;
    for (const p of picks) {
      const ltp = p.ltp || 400;
      const kitta = Math.max(10, Math.round(50_000 / ltp / 10) * 10);
      addHolding({
        symbol: p.symbol,
        shares: kitta,
        buyPrice: Number((ltp * 0.96).toFixed(1)),
        holdingTerm: 'short',
        stopLoss: Number((ltp * 0.9).toFixed(1)),
        targetPrice:
          p.valuation.compositeFairValue && p.valuation.compositeFairValue > ltp
            ? Number(p.valuation.compositeFairValue.toFixed(1))
            : Number((ltp * 1.18).toFixed(1)),
        notes: `Seeded starter pick (Master ${p.masterScore.toFixed(0)})`,
      });
    }
    setFeedback({ kind: 'ok', text: `Seeded ${picks.length} sample holdings from top Master Screener picks.` });
  };

  const handleImportWatchlist = () => {
    const newSyms = watchlist.filter((s) => !holdings.some((h) => h.symbol === s));
    if (newSyms.length === 0) {
      setFeedback({ kind: 'err', text: 'Your watchlist is empty or all watchlist symbols are already in holdings.' });
      return;
    }
    let added = 0;
    for (const sym of newSyms) {
      const r = rowMap.get(sym);
      const ltp = r?.ltp && r.ltp > 0 ? r.ltp : null;
      if (!ltp) continue;
      const kitta = Math.max(10, Math.round(40_000 / ltp / 10) * 10);
      addHolding({
        symbol: sym,
        shares: kitta,
        buyPrice: ltp,
        holdingTerm: 'short',
        stopLoss: Number((ltp * 0.92).toFixed(1)),
        targetPrice:
          r?.valuation.compositeFairValue && r.valuation.compositeFairValue > ltp
            ? Number(r.valuation.compositeFairValue.toFixed(1))
            : Number((ltp * 1.16).toFixed(1)),
        notes: 'Imported from Watchlist',
      });
      added++;
    }
    setFeedback({ kind: 'ok', text: `Imported ${added} watchlist ticker${added === 1 ? '' : 's'} into portfolio tracker.` });
  };

  const handleSelectJournalSymbol = (sym: string) => {
    const clean = sym.toUpperCase();
    setJSymbol(clean);
    const match = rowMap.get(clean);
    if (match?.ltp) {
      const entry = match.ltp;
      const sl = Number((entry * 0.93).toFixed(1));
      const tp =
        match.valuation.compositeFairValue && match.valuation.compositeFairValue > entry * 1.05
          ? Number(match.valuation.compositeFairValue.toFixed(1))
          : Number((entry * 1.15).toFixed(1));
      setJEntry(String(entry));
      setJStop(String(sl));
      setJTarget(String(tp));
      const riskBudget = Number(jRiskNpr) || 3000;
      if (entry > sl) {
        const kitta = Math.max(10, Math.floor(riskBudget / (entry - sl) / 10) * 10);
        setJShares(String(kitta));
      }
    }
  };

  const jSizingPreview = useMemo(() => {
    const entry = Number(jEntry);
    const stop = Number(jStop);
    const target = Number(jTarget);
    const riskBudget = Number(jRiskNpr);
    const sharesInput = Number(jShares);
    const riskPerShare = entry > 0 && stop > 0 && entry > stop ? entry - stop : 0;
    const suggestedKitta =
      riskPerShare > 0 && riskBudget > 0 ? Math.max(1, Math.floor(riskBudget / riskPerShare)) : 0;
    const effShares = sharesInput > 0 ? sharesInput : suggestedKitta;
    const buyCost = effShares > 0 && entry > 0 ? calcNepseBuyCost(effShares, entry) : null;
    const targetSell =
      effShares > 0 && target > 0 && buyCost
        ? calcNepseSellProceeds(effShares, target, buyCost.total, 0, jCgtRate)
        : null;
    const rrRatio =
      riskPerShare > 0 && target > entry ? (target - entry) / riskPerShare : null;
    return { suggestedKitta, effShares, buyCost, targetSell, rrRatio };
  }, [jEntry, jStop, jTarget, jRiskNpr, jShares, jCgtRate]);

  const handleAddJournalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = jSymbol.trim().toUpperCase();
    const entry = Number(jEntry);
    const stop = Number(jStop);
    const target = Number(jTarget);
    const shares = Number(jShares) || jSizingPreview.suggestedKitta;
    if (!sym || !(entry > 0) || !(stop > 0) || !(target > 0) || !(shares > 0)) {
      setFeedback({ kind: 'err', text: 'Complete Symbol, Entry, Stop-Loss, Target, and Kitta before logging.' });
      return;
    }
    addJournalTrade({
      symbol: sym,
      status: 'open',
      shares,
      entryPrice: entry,
      stopLoss: stop,
      targetPrice: target,
      exitPrice: null,
      cgtRate: jCgtRate,
      setupTag: jTag,
      thesis: jThesis,
      rulesFollowed: jRulesOk,
      closedAt: null,
    });
    setFeedback({ kind: 'ok', text: `Logged ${shares} kitta ${sym} plan (${jTag}) into Trade Journal.` });
    setJSymbol('');
    setJEntry('');
    setJStop('');
    setJTarget('');
    setJShares('');
    setJThesis('');
  };

  const handleExportCsv = () => {
    const headers = [
      'Symbol',
      'Sector',
      'Kitta',
      'WACC',
      'Invested_NPR',
      'LTP',
      'Net_Market_Value_NPR',
      'Net_PnL_NPR',
      'Net_PnL_Pct',
      'Breakeven_NPR',
      'Margin_Of_Safety_Pct',
      'Next_Qtr_Outlook',
      'Notes',
    ];
    const lines = [headers.join(',')];
    for (const item of enrichedHoldings) {
      lines.push(
        [
          item.holding.symbol,
          `"${(item.row?.sector || '').replace(/"/g, '""')}"`,
          item.holding.shares,
          item.holding.buyPrice.toFixed(2),
          item.buyCost.total.toFixed(2),
          item.ltp.toFixed(2),
          item.sellCalc.netReceivable.toFixed(2),
          item.sellCalc.netProfit.toFixed(2),
          item.netPnlPct.toFixed(2),
          item.breakevenPrice.toFixed(2),
          item.mosPct !== null ? item.mosPct.toFixed(2) : '',
          `"${item.row?.comingQuarterOutlook.direction || ''}"`,
          `"${(item.holding.notes || '').replace(/"/g, '""')}"`,
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nepse-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      liquidCash,
      holdings,
      journal,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nepse-trade-desk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        importDeskBackup(parsed);
        setFeedback({ kind: 'ok', text: `Restored backup from ${file.name}.` });
      } catch {
        setFeedback({ kind: 'err', text: 'Invalid JSON backup file.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-5 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
              NEPSE Portfolio &amp; Trade Execution Desk
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Track MeroShare WACC holdings with exact SEBON, broker slab, DP, and CGT net exit math, audit sector and coming-quarter blow-down risks in real time, deploy fresh cash into top-ranked NEPSE setups, and measure closed-trade R-multiple expectancy.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
            <span>{holdings.length} active holdings</span>
            <span aria-hidden="true">·</span>
            <span>{journalSummary.openCount} open plans</span>
            <span aria-hidden="true">·</span>
            <span>{journalSummary.closedCount} closed trades</span>
            {masterData?.marketDate && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">Marked to EOD {masterData.marketDate}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950">
            <span className="whitespace-nowrap">Liquid Cash (NPR)</span>
            <input
              type="number"
              min={0}
              step={5000}
              value={liquidCash}
              onChange={(e) => setLiquidCash(Number(e.target.value) || 0)}
              className="w-28 bg-transparent font-mono font-semibold text-right text-slate-900 dark:text-slate-100 focus:outline-none tabular-nums"
            />
          </label>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={holdings.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Holdings CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Backup JSON</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Restore</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportJsonFile}
            className="hidden"
          />
        </div>
      </div>

      {feedback && (
        <div
          className={`px-4 py-2.5 rounded-md border text-xs flex items-center justify-between gap-3 ${
            feedback.kind === 'err'
              ? 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
              : 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-current opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4 Top Portfolio KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Net Liquidation + Cash</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {fmtNpr(portfolioStats.totalEquityPlusCash)}
          </div>
          <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Equities {fmtNpr(portfolioStats.totalNetLiquidationEquity)} · Cash {fmtNpr(liquidCash)}
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">After-Tax Unrealized P&amp;L</div>
          <div
            className={`mt-1 text-xl font-bold font-mono tabular-nums ${
              portfolioStats.totalNetPnl >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {fmtNpr(portfolioStats.totalNetPnl)}
          </div>
          <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Return {fmtPct(portfolioStats.totalReturnPct)} · Today{' '}
            <span
              className={
                portfolioStats.totalDayChange >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }
            >
              {fmtNpr(portfolioStats.totalDayChange)}
            </span>
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Fair Value &amp; CGT Tax Edge</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {portfolioStats.weightedMosPct !== null ? fmtPct(portfolioStats.weightedMosPct) : '—'} MOS
          </div>
          <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Master {portfolioStats.weightedMasterScore !== null ? `${portfolioStats.weightedMasterScore.toFixed(0)}/100` : '—'}
            {' · '}
            {portfolioStats.totalPotentialCgtSavings > 0
              ? `5% LTCG saves ${fmtNpr(portfolioStats.totalPotentialCgtSavings)}`
              : `${portfolioStats.riskList.filter((r) => r.severity === 'high').length} high alerts`}
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Closed Journal Performance</div>
          <div
            className={`mt-1 text-xl font-bold font-mono tabular-nums ${
              journalSummary.realizedNetNpr >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {journalSummary.closedCount > 0 ? fmtNpr(journalSummary.realizedNetNpr) : 'NPR 0'}
          </div>
          <div className="mt-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Win Rate{' '}
            {journalSummary.winRatePct !== null ? `${journalSummary.winRatePct.toFixed(0)}%` : '—'} · Avg{' '}
            {journalSummary.avgR !== null ? `${journalSummary.avgR.toFixed(2)}R` : '—'}
          </div>
        </div>
      </div>

      {/* Segmented Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-800 text-xs">
          {(
            [
              { id: 'holdings', label: `Holdings & Risk Audit (${holdings.length})`, icon: Layers },
              { id: 'deployer', label: 'Smart Capital Deployer', icon: Rocket },
              { id: 'journal', label: `Trade Journal & R-Stats (${journal.length})`, icon: Scale },
            ] as Array<{ id: DeskTab; label: string; icon: React.ComponentType<{ className?: string }> }>
          ).map((t) => {
            const Icon = t.icon;
            const active = activeDeskTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveDeskTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={handleImportWatchlist}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-amber-500" />
            <span>Import Watchlist ({watchlist.length})</span>
          </button>
          {holdings.length === 0 && (
            <button
              type="button"
              onClick={handleLoadTopStarterPicks}
              disabled={loadingMaster || rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load Top 3 Value Picks</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: HOLDINGS & RISK AUDIT */}
      {activeDeskTab === 'holdings' && (
        <div className="space-y-5">
          {/* Quick Add Holding Form */}
          <form
            onSubmit={handleAddHoldingSubmit}
            className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Add MeroShare / TMS Holding
              </h3>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                All buy fees (broker slab + 0.015% SEBON + Rs 25 DP) &amp; CGT applied automatically
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2.5 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Symbol</span>
                <input
                  type="text"
                  value={newSymbol}
                  onChange={(e) => handleSelectHoldingSymbol(e.target.value)}
                  placeholder="NABIL"
                  list="portfolio-symbol-list"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-semibold text-slate-900 dark:text-slate-100"
                />
                <datalist id="portfolio-symbol-list">
                  {sortedSymbols.map((r) => (
                    <option key={r.symbol} value={r.symbol}>
                      {r.companyName}
                    </option>
                  ))}
                </datalist>
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Kitta (Units)</span>
                <input
                  type="number"
                  min={1}
                  value={newShares}
                  onChange={(e) => setNewShares(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">WACC / Buy (Rs)</span>
                <input
                  type="number"
                  min={1}
                  step="0.1"
                  value={newBuyPrice}
                  onChange={(e) => setNewBuyPrice(e.target.value)}
                  placeholder="510"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Buy Date (365d CGT)</span>
                <input
                  type="date"
                  value={newBuyDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewBuyDate(val);
                    const ms = Date.parse(`${val}T00:00:00Z`);
                    if (!Number.isNaN(ms)) {
                      const held = Math.floor((Date.now() - ms) / 86_400_000);
                      setNewTerm(held > 365 ? 'long' : 'short');
                    }
                  }}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-[11px]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">CGT Term</span>
                <select
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value as HoldingTerm)}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  <option value="short">Short (&le;365d · 7.5%)</option>
                  <option value="long">Long (&gt;365d · 5%)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Stop-Loss (Rs)</span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={newStop}
                  onChange={(e) => setNewStop(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Target (Rs)</span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Thesis Note</span>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="e.g. Q1 accumulation"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </label>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Position</span>
                </button>
              </div>
            </div>
          </form>

          {enrichedHoldings.length === 0 ? (
            <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 p-8 text-center space-y-3">
              <Briefcase className="w-7 h-7 text-slate-400 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                No holdings logged yet
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Add your actual NEPSE kitta &amp; WACC above, import your starred watchlist, or seed top Master Screener picks to test sector exposure, break-even exit prices, and coming-quarter blow-down warnings.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleLoadTopStarterPicks}
                  disabled={loadingMaster || rows.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Load Top 3 Value Picks</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDeskTab('deployer')}
                  className="px-4 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Open Smart Capital Deployer
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Automated Portfolio Health & Sector Audit */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Sector Concentration
                    </h3>
                    <span className="text-[11px] font-mono text-slate-500">
                      {portfolioStats.sectorBreakdown.length} sectors
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {portfolioStats.sectorBreakdown.map((sec) => {
                      const overConcentrated = sec.weightPct > 35 && enrichedHoldings.length >= 2;
                      return (
                        <div key={sec.sector} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-700 dark:text-slate-300 truncate pr-2">
                              {sec.sector}
                            </span>
                            <span
                              className={`font-mono tabular-nums font-medium ${
                                overConcentrated
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              {sec.weightPct.toFixed(1)}% · {fmtNpr(sec.value)}
                            </span>
                          </div>
                          <div className="h-2 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full rounded ${
                                overConcentrated ? 'bg-amber-500' : 'bg-blue-600 dark:bg-blue-500'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(2, sec.weightPct))}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {portfolioStats.concentratedSectors.length > 0 && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 pt-1">
                      Concentration alert: {portfolioStats.concentratedSectors.map((s) => `${s.sector} (${s.weightPct.toFixed(0)}%)`).join(', ')} exceeds the 35% single-sector guardrail.
                    </p>
                  )}
                </div>

                <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Automated Fundamental, Lock-In &amp; Quarter Risk Audit
                    </h3>
                    <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                      {portfolioStats.riskList.length} flags
                    </span>
                  </div>
                  {portfolioStats.riskList.length === 0 ? (
                    <div className="p-4 rounded border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 flex items-center gap-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>
                        All current holdings pass CDSC lock-in checks, Regulatory KB standing, stop-loss levels, and Coming-Quarter Blow-Down screens.
                      </span>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-52 overflow-y-auto">
                      {portfolioStats.riskList.map((r, idx) => (
                        <div key={`${r.symbol}-${idx}`} className="py-2 flex items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <AlertTriangle
                              className={`w-3.5 h-3.5 shrink-0 ${
                                r.severity === 'high' ? 'text-rose-600' : 'text-amber-500'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => onInspectInScreener(r.symbol)}
                              className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                            >
                              {r.symbol}
                            </button>
                            <span className="text-slate-700 dark:text-slate-300 truncate">{r.text}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenValuation(r.symbol)}
                            className="text-[11px] text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 shrink-0 whitespace-nowrap"
                          >
                            Audit →
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Holdings Ledger Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Active Holdings Ledger
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      clearAllHoldings();
                      setFeedback({ kind: 'ok', text: 'Cleared all holdings.' });
                    }}
                    className="text-xs text-slate-500 hover:text-rose-600 transition-colors"
                  >
                    Clear All
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/60">
                        <th className="py-2.5 px-3 font-medium">Ticker</th>
                        <th className="py-2.5 px-3 font-medium text-right">Kitta</th>
                        <th className="py-2.5 px-3 font-medium text-right">WACC / BE</th>
                        <th className="py-2.5 px-3 font-medium text-right">LTP / Today</th>
                        <th className="py-2.5 px-3 font-medium text-right">Net Market</th>
                        <th className="py-2.5 px-3 font-medium text-right">Net P&amp;L (After Tax)</th>
                        <th className="py-2.5 px-3 font-medium text-right">Fair Val / MOS</th>
                        <th className="py-2.5 px-3 font-medium">Next Qtr &amp; Risk</th>
                        <th className="py-2.5 px-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {enrichedHoldings.map((item) => {
                        const { holding: h, row, ltp } = item;
                        const isClosing = closingHoldingId === h.id;
                        return (
                          <tr key={h.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 align-top">
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => onInspectSymbol(h.symbol)}
                                  className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  {h.symbol}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateHolding(h.id, {
                                      holdingTerm: h.holdingTerm === 'short' ? 'long' : 'short',
                                    })
                                  }
                                  title="Click to toggle CGT term (7.5% Short vs 5% Long)"
                                  className="text-[10px] font-mono text-slate-500 hover:text-blue-600"
                                >
                                  ({item.daysHeld > 365 || h.holdingTerm === 'long' ? '5% CGT' : '7.5% CGT'})
                                </button>
                              </div>
                              <div className="text-[11px] text-slate-500 truncate max-w-[175px]">
                                {row?.sector || h.notes || 'NEPSE Equity'}
                              </div>
                              <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                                <input
                                  type="date"
                                  value={item.effectiveBuyDate}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const ms = Date.parse(`${val}T00:00:00Z`);
                                    const held = Number.isNaN(ms)
                                      ? 0
                                      : Math.floor((Date.now() - ms) / 86_400_000);
                                    updateHolding(h.id, {
                                      buyDate: val,
                                      holdingTerm: held > 365 ? 'long' : 'short',
                                    });
                                  }}
                                  className="bg-transparent text-[10px] font-mono text-slate-500 dark:text-slate-400 focus:outline-none hover:text-slate-800 dark:hover:text-slate-200 w-[95px]"
                                />
                                <span>·</span>
                                {item.daysToLongTerm === 0 ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    5% LTCG Unlocked ({item.daysHeld}d)
                                  </span>
                                ) : (
                                  <span>
                                    {item.daysToLongTerm}d to 5% CGT
                                    {item.cgtSavingsNpr > 0 ? ` (saves ${fmtNpr(item.cgtSavingsNpr)})` : ''}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">
                              {h.shares.toLocaleString('en-US')}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              <div>Rs {h.buyPrice.toFixed(1)}</div>
                              <div className="text-[11px] text-slate-500">BE {item.breakevenPrice.toFixed(1)}</div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              <div className="font-semibold">Rs {ltp.toFixed(1)}</div>
                              <div
                                className={`text-[11px] ${
                                  (row?.changePct ?? 0) >= 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {row?.changePct !== null && row?.changePct !== undefined
                                  ? fmtPct(row.changePct)
                                  : '—'}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              <div>{fmtNpr(item.sellCalc.netReceivable)}</div>
                              <div className="text-[11px] text-slate-500">
                                Cost {fmtNpr(item.buyCost.total)}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              <div
                                className={`font-semibold ${
                                  item.sellCalc.netProfit >= 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {fmtNpr(item.sellCalc.netProfit)}
                              </div>
                              <div className="text-[11px] text-slate-500">{fmtPct(item.netPnlPct)}</div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              <div>
                                {row?.valuation.compositeFairValue
                                  ? `Rs ${row.valuation.compositeFairValue.toFixed(0)}`
                                  : '—'}
                              </div>
                              <div
                                className={`text-[11px] ${
                                  (item.mosPct ?? 0) >= 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-amber-600 dark:text-amber-400'
                                }`}
                              >
                                {item.mosPct !== null ? `${fmtPct(item.mosPct)} MOS` : 'No FY data'}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="text-[11px] text-slate-700 dark:text-slate-300">
                                {row?.comingQuarterOutlook.direction || '—'}
                              </div>
                              {item.alerts[0] && (
                                <div
                                  className={`text-[10px] mt-0.5 ${
                                    item.alerts[0].severity === 'high'
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : 'text-amber-600 dark:text-amber-400'
                                  }`}
                                >
                                  {item.alerts[0].text}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {isClosing ? (
                                <div className="inline-flex items-center gap-1 justify-end">
                                  <input
                                    type="number"
                                    value={closingHoldingPrice}
                                    onChange={(e) => setClosingHoldingPrice(e.target.value)}
                                    className="w-20 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-right"
                                    placeholder="Exit Rs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const ex = Number(closingHoldingPrice);
                                      if (!(ex > 0)) return;
                                      addJournalTrade({
                                        symbol: h.symbol,
                                        status: 'closed',
                                        shares: h.shares,
                                        entryPrice: h.buyPrice,
                                        stopLoss: h.stopLoss ?? Number((h.buyPrice * 0.92).toFixed(1)),
                                        targetPrice: h.targetPrice ?? ex,
                                        exitPrice: ex,
                                        cgtRate: h.holdingTerm === 'long' ? 0.05 : 0.075,
                                        setupTag: 'Undervalued Compounder',
                                        thesis: h.notes || 'Closed from Portfolio Holdings',
                                        rulesFollowed: true,
                                        closedAt: new Date().toISOString().slice(0, 10),
                                      });
                                      removeHolding(h.id);
                                      setClosingHoldingId(null);
                                      setFeedback({
                                        kind: 'ok',
                                        text: `Booked ${h.symbol} exit @ Rs ${ex} into Trade Journal.`,
                                      });
                                    }}
                                    className="px-2 py-1 rounded bg-emerald-600 text-white font-medium"
                                  >
                                    Book
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setClosingHoldingId(null)}
                                    className="px-1.5 py-1 text-slate-500"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => onInspectInAnalyzer(h.symbol)}
                                    title="Open in Auto Analyzer"
                                    className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                  >
                                    <Crosshair className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onInspectSymbol(h.symbol)}
                                    title="Open Stock Explorer Chart"
                                    className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                  >
                                    <CandlestickChart className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setClosingHoldingId(h.id);
                                      setClosingHoldingPrice(String(ltp));
                                    }}
                                    title="Close & record realized P&L in Journal"
                                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                                  >
                                    Book Exit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeHolding(h.id)}
                                    title="Delete holding"
                                    className="p-1.5 rounded text-slate-400 hover:text-rose-600"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: SMART CAPITAL DEPLOYER */}
      {activeDeskTab === 'deployer' && (
        <div className="space-y-5">
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Smart NEPSE Capital Deployment Simulator
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Filters out CDSC lock-in overhangs, Regulatory KB alerts, and Coming-Quarter Blow-Down risks, then sizes top-ranked equities into exact NEPSE kitta lots within your single-stock concentration cap.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Cash to Deploy (NPR)</span>
                <input
                  type="number"
                  min={10000}
                  step={10000}
                  value={deployBudget}
                  onChange={(e) => setDeployBudget(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-semibold tabular-nums"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Allocation Strategy</span>
                <select
                  value={deployGoal}
                  onChange={(e) => setDeployGoal(e.target.value as DeployGoal)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="balanced">Balanced Master Score (Value + Flow)</option>
                  <option value="undervalued">Deep Undervalued Compounders (MOS &ge; 8%)</option>
                  <option value="blowup_qtr">Coming-Quarter Blow-Up Catalysts</option>
                  <option value="fd_yield">Earnings Yield &gt; Nepal FD Rate</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Max Single Stock (%)</span>
                <input
                  type="number"
                  min={10}
                  max={50}
                  step={5}
                  value={maxWeightPct}
                  onChange={(e) => setMaxWeightPct(Number(e.target.value) || 25)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Min 20D Avg Turn (Cr)</span>
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={minAvgTurnCr}
                  onChange={(e) => setMinAvgTurnCr(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>

              <label className="flex items-center gap-2 pt-5 cursor-pointer text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={roundLot10}
                  onChange={(e) => setRoundLot10(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Round to 10-kitta NEPSE lots</span>
              </label>
            </div>
          </div>

          {deploymentPlan.length === 0 ? (
            <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 p-6 text-center text-xs text-slate-500">
              No NEPSE equities currently match all safety, liquidity, and strategy thresholds. Lower the Min 20D Avg Turnover floor or increase Cash to Deploy.
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  Suggested Basket ({deploymentPlan.length} positions ·{' '}
                  {fmtNpr(deploymentPlan.reduce((s, p) => s + p.buyCost.total, 0))} allocated incl. NEPSE fees)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    for (const p of deploymentPlan) {
                      addHolding({
                        symbol: p.row.symbol,
                        shares: p.shares,
                        buyPrice: p.price,
                        holdingTerm: 'short',
                        stopLoss: p.suggestedStop,
                        targetPrice: p.suggestedTarget,
                        notes: `Capital Deployer (${deployGoal})`,
                      });
                    }
                    setActiveDeskTab('holdings');
                    setFeedback({
                      kind: 'ok',
                      text: `Staged ${deploymentPlan.length} allocated positions into Portfolio Holdings.`,
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium whitespace-nowrap"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Stage All to Holdings</span>
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50/70 dark:bg-slate-950/60">
                      <th className="py-2.5 px-3 font-medium">Ticker &amp; Sector</th>
                      <th className="py-2.5 px-3 font-medium text-right">Master / Health</th>
                      <th className="py-2.5 px-3 font-medium text-right">LTP / MOS</th>
                      <th className="py-2.5 px-3 font-medium text-right">Kitta &amp; Wt</th>
                      <th className="py-2.5 px-3 font-medium text-right">Est. Cost (incl. fee)</th>
                      <th className="py-2.5 px-3 font-medium text-right">Stop / Fair Target</th>
                      <th className="py-2.5 px-3 font-medium">Next Qtr Outlook</th>
                      <th className="py-2.5 px-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                    {deploymentPlan.map((p) => (
                      <tr key={p.row.symbol} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-sans">
                          <button
                            type="button"
                            onClick={() => onOpenValuation(p.row.symbol)}
                            className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {p.row.symbol}
                          </button>
                          <div className="text-[11px] text-slate-500 truncate max-w-[160px]">
                            {p.row.sector}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="font-semibold">{p.row.masterScore.toFixed(0)}</div>
                          <div className="text-[11px] text-slate-500">
                            Fund {p.row.fundamentals.overallScore.toFixed(0)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div>Rs {p.price.toFixed(1)}</div>
                          <div
                            className={`text-[11px] ${
                              (p.row.valuation.marginOfSafetyPct ?? 0) >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600'
                            }`}
                          >
                            {fmtPct(p.row.valuation.marginOfSafetyPct)} MOS
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="font-semibold">{p.shares} kitta</div>
                          <div className="text-[11px] text-slate-500">{p.weightPct.toFixed(1)}%</div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div>{fmtNpr(p.buyCost.total)}</div>
                          <div className="text-[11px] text-slate-500">Fee Rs {p.buyCost.fee.toFixed(0)}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="text-rose-600 dark:text-rose-400">SL {p.suggestedStop}</div>
                          <div className="text-emerald-600 dark:text-emerald-400">TP {p.suggestedTarget}</div>
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="text-slate-800 dark:text-slate-200">
                            {p.row.comingQuarterOutlook.direction}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {p.row.comingQuarterOutlook.comingQuarterLabel} ({p.row.comingQuarterOutlook.score})
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-sans">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => addToWatchlist(p.row.symbol)}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              Watch
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                addHolding({
                                  symbol: p.row.symbol,
                                  shares: p.shares,
                                  buyPrice: p.price,
                                  holdingTerm: 'short',
                                  stopLoss: p.suggestedStop,
                                  targetPrice: p.suggestedTarget,
                                  notes: `Capital Deployer (${deployGoal})`,
                                });
                                setFeedback({
                                  kind: 'ok',
                                  text: `Added ${p.shares} kitta ${p.row.symbol} @ Rs ${p.price} to Holdings.`,
                                });
                              }}
                              className="px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
                            >
                              Add
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TRADE JOURNAL & R-ANALYTICS */}
      {activeDeskTab === 'journal' && (
        <div className="space-y-5">
          {/* Log New Trade Plan Form */}
          <form
            onSubmit={handleAddJournalSubmit}
            className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Log Execution Plan &amp; Position Sizer
              </h3>
              {jSizingPreview.effShares > 0 && jSizingPreview.buyCost && (
                <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  Size: <strong>{jSizingPreview.suggestedKitta}</strong> suggested kitta · Cost{' '}
                  <strong>{fmtNpr(jSizingPreview.buyCost.total)}</strong>
                  {jSizingPreview.rrRatio !== null && (
                    <>
                      {' '}
                      · Est. Net R:R{' '}
                      <strong
                        className={
                          jSizingPreview.rrRatio >= 1.8
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600'
                        }
                      >
                        {jSizingPreview.rrRatio.toFixed(2)}R
                      </strong>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs">
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Symbol</span>
                <input
                  type="text"
                  value={jSymbol}
                  onChange={(e) => handleSelectJournalSymbol(e.target.value)}
                  placeholder="SHIVM"
                  list="portfolio-symbol-list"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-semibold"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Max Risk (NPR)</span>
                <input
                  type="number"
                  min={100}
                  value={jRiskNpr}
                  onChange={(e) => setJRiskNpr(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Entry (Rs)</span>
                <input
                  type="number"
                  min={1}
                  step="0.1"
                  value={jEntry}
                  onChange={(e) => setJEntry(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Stop (Rs)</span>
                <input
                  type="number"
                  min={1}
                  step="0.1"
                  value={jStop}
                  onChange={(e) => setJStop(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Target (Rs)</span>
                <input
                  type="number"
                  min={1}
                  step="0.1"
                  value={jTarget}
                  onChange={(e) => setJTarget(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Kitta</span>
                <input
                  type="number"
                  min={1}
                  value={jShares}
                  onChange={(e) => setJShares(e.target.value)}
                  placeholder={jSizingPreview.suggestedKitta ? String(jSizingPreview.suggestedKitta) : '100'}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">Setup Tag</span>
                <select
                  value={jTag}
                  onChange={(e) => setJTag(e.target.value as TradeSetupTag)}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  {SETUP_TAGS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-slate-400 block">CGT Rate</span>
                <select
                  value={jCgtRate}
                  onChange={(e) => setJCgtRate(Number(e.target.value) as 0.075 | 0.05)}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value={0.075}>7.5% (&le;365d)</option>
                  <option value={0.05}>5.0% (&gt;365d)</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
                <input
                  type="text"
                  value={jThesis}
                  onChange={(e) => setJThesis(e.target.value)}
                  placeholder="Entry catalyst & invalidation thesis…"
                  className="flex-1 min-w-[220px] px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={jRulesOk}
                    onChange={(e) => setJRulesOk(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Checklist &amp; liquidity rules followed</span>
                </label>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Log Trade Plan</span>
              </button>
            </div>
          </form>

          {/* R-Metrics Summary Strip */}
          {journalSummary.closedCount > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
                <div className="text-slate-500">Profit Factor</div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums">
                  {journalSummary.profitFactor !== null
                    ? journalSummary.profitFactor >= 90
                      ? '∞'
                      : journalSummary.profitFactor.toFixed(2)
                    : '—'}
                </div>
              </div>
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
                <div className="text-slate-500">Expectancy / Trade</div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums">
                  {journalSummary.expectancyNpr !== null ? fmtNpr(journalSummary.expectancyNpr) : '—'}
                </div>
              </div>
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
                <div className="text-slate-500">Rule Discipline</div>
                <div className="mt-1 text-base font-bold font-mono tabular-nums">
                  {journalSummary.disciplinePct !== null
                    ? `${journalSummary.disciplinePct.toFixed(0)}%`
                    : '—'}
                </div>
              </div>
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-3.5">
                <div className="text-slate-500">Top Setup Edge</div>
                <div className="mt-1 text-xs font-semibold truncate text-slate-900 dark:text-slate-100">
                  {journalSummary.tagBreakdown[0]
                    ? `${journalSummary.tagBreakdown[0][0]} (${fmtNpr(journalSummary.tagBreakdown[0][1].netNpr)})`
                    : '—'}
                </div>
              </div>
            </div>
          )}

          {/* Journal Table */}
          {journalSummary.enrichedEntries.length === 0 ? (
            <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 p-6 text-center text-xs text-slate-500">
              No trade journal entries yet. Log an execution plan above or close any holding from Tab 1 to build your R-multiple and win-rate track record.
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 bg-slate-50/70 dark:bg-slate-950/60">
                      <th className="py-2.5 px-3 font-medium">Ticker &amp; Setup</th>
                      <th className="py-2.5 px-3 font-medium">Status</th>
                      <th className="py-2.5 px-3 font-medium text-right">Kitta</th>
                      <th className="py-2.5 px-3 font-medium text-right">Entry / SL / TP</th>
                      <th className="py-2.5 px-3 font-medium text-right">Mark / Exit</th>
                      <th className="py-2.5 px-3 font-medium text-right">Net P&amp;L</th>
                      <th className="py-2.5 px-3 font-medium text-right">R-Mult</th>
                      <th className="py-2.5 px-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                    {journalSummary.enrichedEntries.map(({ entry: tr, refPrice, sellCalc, rMultiple }) => {
                      const isClosing = closingTradeId === tr.id;
                      return (
                        <tr key={tr.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-sans">
                            <button
                              type="button"
                              onClick={() => onInspectInAnalyzer(tr.symbol)}
                              className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {tr.symbol}
                            </button>
                            <div className="text-[11px] text-slate-600 dark:text-slate-300">
                              {tr.setupTag}
                            </div>
                            {tr.thesis && (
                              <div className="text-[10px] text-slate-500 truncate max-w-[190px]">
                                {tr.thesis}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-sans">
                            <div className="flex items-center gap-1">
                              {tr.status === 'closed' ? (
                                sellCalc.netProfit >= 0 ? (
                                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
                                )
                              ) : null}
                              <span className="font-medium capitalize">{tr.status}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {tr.closedAt || tr.openedAt}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right">{tr.shares}</td>
                          <td className="py-2.5 px-3 text-right">
                            <div>E {tr.entryPrice.toFixed(1)}</div>
                            <div className="text-[11px] text-slate-500">
                              SL {tr.stopLoss.toFixed(1)} · TP {tr.targetPrice.toFixed(1)}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold">
                            Rs {refPrice.toFixed(1)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-semibold ${
                              sellCalc.netProfit >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {fmtNpr(sellCalc.netProfit)}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {rMultiple !== null ? `${rMultiple >= 0 ? '+' : ''}${rMultiple.toFixed(2)}R` : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-sans">
                            {isClosing ? (
                              <div className="inline-flex items-center gap-1 justify-end">
                                <input
                                  type="number"
                                  value={closingTradePrice}
                                  onChange={(e) => setClosingTradePrice(e.target.value)}
                                  className="w-20 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-right"
                                  placeholder="Exit Rs"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const px = Number(closingTradePrice);
                                    if (!(px > 0)) return;
                                    closeJournalTrade(tr.id, px);
                                    setClosingTradeId(null);
                                  }}
                                  className="px-2 py-1 rounded bg-emerald-600 text-white font-medium"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setClosingTradeId(null)}
                                  className="px-1.5 py-1 text-slate-500"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1 justify-end">
                                {tr.status === 'open' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setClosingTradeId(tr.id);
                                      setClosingTradePrice(String(refPrice));
                                    }}
                                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                                  >
                                    Close Trade
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeJournalTrade(tr.id)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600"
                                  title="Delete journal entry"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
