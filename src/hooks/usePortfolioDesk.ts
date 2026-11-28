import { useCallback, useEffect, useState } from 'react';

export type HoldingTerm = 'short' | 'long';

export interface PortfolioHolding {
  id: string;
  symbol: string;
  shares: number;
  buyPrice: number; // WACC / buy price per kitta
  holdingTerm: HoldingTerm; // short = 7.5% CGT, long (>365d) = 5% CGT
  buyDate?: string; // YYYY-MM-DD purchase date for exact 365-day CGT countdown
  stopLoss: number | null;
  targetPrice: number | null;
  addedAt: string;
  notes: string;
}

export type TradeSetupTag =
  | 'Undervalued Compounder'
  | 'Qtr Blow-Up Catalyst'
  | 'ICT Order Block'
  | '20D Breakout'
  | 'Swing Pullback'
  | 'Dividend / Bonus Play';

export interface TradeJournalEntry {
  id: string;
  symbol: string;
  status: 'open' | 'closed';
  shares: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  exitPrice: number | null;
  cgtRate: 0.075 | 0.05;
  setupTag: TradeSetupTag;
  thesis: string;
  rulesFollowed: boolean;
  openedAt: string;
  closedAt: string | null;
}

const HOLDINGS_KEY = 'nepse_portfolio_holdings_v1';
const JOURNAL_KEY = 'nepse_trade_journal_v1';
const CASH_KEY = 'nepse_portfolio_cash_v1';

const HOLDINGS_EVENT = 'nepse-portfolio-holdings-change';
const JOURNAL_EVENT = 'nepse-portfolio-journal-change';
const CASH_EVENT = 'nepse-portfolio-cash-change';

function safeParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function readHoldings(): PortfolioHolding[] {
  try {
    return safeParseArray<PortfolioHolding>(localStorage.getItem(HOLDINGS_KEY)).filter(
      (h) => h && typeof h.symbol === 'string' && Number(h.shares) > 0 && Number(h.buyPrice) > 0
    );
  } catch {
    return [];
  }
}

function readJournal(): TradeJournalEntry[] {
  try {
    return safeParseArray<TradeJournalEntry>(localStorage.getItem(JOURNAL_KEY)).filter(
      (j) => j && typeof j.symbol === 'string' && Number(j.shares) > 0 && Number(j.entryPrice) > 0
    );
  } catch {
    return [];
  }
}

function readCash(): number {
  try {
    const raw = localStorage.getItem(CASH_KEY);
    if (!raw) return 250_000;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 250_000;
  } catch {
    return 250_000;
  }
}

export function usePortfolioDesk() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(() => readHoldings());
  const [journal, setJournal] = useState<TradeJournalEntry[]>(() => readJournal());
  const [liquidCash, setLiquidCashState] = useState<number>(() => readCash());

  useEffect(() => {
    const onH = () => setHoldings(readHoldings());
    const onJ = () => setJournal(readJournal());
    const onC = () => setLiquidCashState(readCash());
    window.addEventListener('storage', onH);
    window.addEventListener('storage', onJ);
    window.addEventListener('storage', onC);
    window.addEventListener(HOLDINGS_EVENT, onH);
    window.addEventListener(JOURNAL_EVENT, onJ);
    window.addEventListener(CASH_EVENT, onC);
    return () => {
      window.removeEventListener('storage', onH);
      window.removeEventListener('storage', onJ);
      window.removeEventListener('storage', onC);
      window.removeEventListener(HOLDINGS_EVENT, onH);
      window.removeEventListener(JOURNAL_EVENT, onJ);
      window.removeEventListener(CASH_EVENT, onC);
    };
  }, []);

  const persistHoldings = useCallback((next: PortfolioHolding[]) => {
    try {
      localStorage.setItem(HOLDINGS_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(HOLDINGS_EVENT));
    } catch {
      // ignore quota errors
    }
    setHoldings(next);
  }, []);

  const persistJournal = useCallback((next: TradeJournalEntry[]) => {
    try {
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(JOURNAL_EVENT));
    } catch {
      // ignore quota errors
    }
    setJournal(next);
  }, []);

  const setLiquidCash = useCallback((val: number) => {
    const safe = Number.isFinite(val) && val >= 0 ? Math.round(val) : 0;
    try {
      localStorage.setItem(CASH_KEY, String(safe));
      window.dispatchEvent(new Event(CASH_EVENT));
    } catch {
      // ignore
    }
    setLiquidCashState(safe);
  }, []);

  const addHolding = useCallback(
    (input: Omit<PortfolioHolding, 'id' | 'addedAt'>) => {
      const sym = input.symbol.trim().toUpperCase();
      if (!sym || input.shares <= 0 || input.buyPrice <= 0) return;
      const today = new Date().toISOString().slice(0, 10);
      const entry: PortfolioHolding = {
        ...input,
        id: `${sym}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: sym,
        shares: Math.round(input.shares),
        buyPrice: Number(input.buyPrice.toFixed(2)),
        buyDate: input.buyDate && /^\d{4}-\d{2}-\d{2}$/.test(input.buyDate) ? input.buyDate : today,
        stopLoss:
          input.stopLoss && input.stopLoss > 0 ? Number(input.stopLoss.toFixed(2)) : null,
        targetPrice:
          input.targetPrice && input.targetPrice > 0 ? Number(input.targetPrice.toFixed(2)) : null,
        addedAt: today,
        notes: (input.notes || '').trim(),
      };
      persistHoldings([entry, ...readHoldings()]);
    },
    [persistHoldings]
  );

  const removeHolding = useCallback(
    (id: string) => {
      persistHoldings(readHoldings().filter((h) => h.id !== id));
    },
    [persistHoldings]
  );

  const updateHolding = useCallback(
    (id: string, patch: Partial<PortfolioHolding>) => {
      persistHoldings(
        readHoldings().map((h) => (h.id === id ? { ...h, ...patch } : h))
      );
    },
    [persistHoldings]
  );

  const addJournalTrade = useCallback(
    (input: Omit<TradeJournalEntry, 'id' | 'openedAt'>) => {
      const sym = input.symbol.trim().toUpperCase();
      if (!sym || input.shares <= 0 || input.entryPrice <= 0) return;
      const item: TradeJournalEntry = {
        ...input,
        id: `tr-${sym}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: sym,
        shares: Math.round(input.shares),
        entryPrice: Number(input.entryPrice.toFixed(2)),
        stopLoss: Number(input.stopLoss.toFixed(2)),
        targetPrice: Number(input.targetPrice.toFixed(2)),
        exitPrice:
          input.exitPrice && input.exitPrice > 0 ? Number(input.exitPrice.toFixed(2)) : null,
        openedAt: new Date().toISOString().slice(0, 10),
        closedAt:
          input.status === 'closed'
            ? input.closedAt || new Date().toISOString().slice(0, 10)
            : null,
        thesis: (input.thesis || '').trim(),
      };
      persistJournal([item, ...readJournal()]);
    },
    [persistJournal]
  );

  const closeJournalTrade = useCallback(
    (id: string, exitPrice: number, rulesFollowed?: boolean) => {
      if (!(exitPrice > 0)) return;
      const today = new Date().toISOString().slice(0, 10);
      persistJournal(
        readJournal().map((t) =>
          t.id === id
            ? {
                ...t,
                status: 'closed',
                exitPrice: Number(exitPrice.toFixed(2)),
                closedAt: today,
                rulesFollowed: rulesFollowed ?? t.rulesFollowed,
              }
            : t
        )
      );
    },
    [persistJournal]
  );

  const removeJournalTrade = useCallback(
    (id: string) => {
      persistJournal(readJournal().filter((t) => t.id !== id));
    },
    [persistJournal]
  );

  const importDeskBackup = useCallback(
    (payload: {
      holdings?: PortfolioHolding[];
      journal?: TradeJournalEntry[];
      liquidCash?: number;
    }) => {
      if (Array.isArray(payload.holdings)) {
        persistHoldings(
          payload.holdings.filter(
            (h) => h && typeof h.symbol === 'string' && h.shares > 0 && h.buyPrice > 0
          )
        );
      }
      if (Array.isArray(payload.journal)) {
        persistJournal(
          payload.journal.filter(
            (j) => j && typeof j.symbol === 'string' && j.shares > 0 && j.entryPrice > 0
          )
        );
      }
      if (typeof payload.liquidCash === 'number' && Number.isFinite(payload.liquidCash)) {
        setLiquidCash(payload.liquidCash);
      }
    },
    [persistHoldings, persistJournal, setLiquidCash]
  );

  const clearAllHoldings = useCallback(() => persistHoldings([]), [persistHoldings]);

  return {
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
  };
}
