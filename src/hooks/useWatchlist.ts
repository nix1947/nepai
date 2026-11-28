import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'nepse_watchlist_v1';
const ALERTS_STORAGE_KEY = 'nepse_watchlist_alerts_v1';
const COMPARE_STORAGE_KEY = 'nepse_compare_v1';

const EVENT_NAME = 'nepse-watchlist-change';
const ALERTS_EVENT_NAME = 'nepse-watchlist-alerts-change';
const COMPARE_EVENT_NAME = 'nepse-compare-change';

export interface WatchlistAlertRule {
  targetBuyPrice?: number | null;
  targetSellPrice?: number | null;
  alertOnBuyZone?: boolean;
  alertOnBreakout?: boolean;
}

function normalizeSymbolList(rawList: unknown, maxItems?: number): string[] {
  if (!Array.isArray(rawList)) return [];
  const clean = Array.from(
    new Set(
      rawList
        .map((s) => String(s).trim().toUpperCase())
        .filter((s) => /^[A-Z0-9._-]{1,20}$/.test(s))
    )
  );
  return typeof maxItems === 'number' ? clean.slice(0, maxItems) : clean;
}

function readWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeSymbolList(JSON.parse(raw));
  } catch {
    return [];
  }
}

function readAlertRules(): Record<string, WatchlistAlertRule> {
  try {
    const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readCompareList(): string[] {
  try {
    const raw = localStorage.getItem(COMPARE_STORAGE_KEY);
    if (!raw) return [];
    return normalizeSymbolList(JSON.parse(raw), 4);
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(() => readWatchlist());
  const [alertRules, setAlertRules] = useState<Record<string, WatchlistAlertRule>>(() =>
    readAlertRules()
  );

  useEffect(() => {
    const onSync = () => setSymbols(readWatchlist());
    const onAlertSync = () => setAlertRules(readAlertRules());
    window.addEventListener('storage', onSync);
    window.addEventListener('storage', onAlertSync);
    window.addEventListener(EVENT_NAME, onSync);
    window.addEventListener(ALERTS_EVENT_NAME, onAlertSync);
    return () => {
      window.removeEventListener('storage', onSync);
      window.removeEventListener('storage', onAlertSync);
      window.removeEventListener(EVENT_NAME, onSync);
      window.removeEventListener(ALERTS_EVENT_NAME, onAlertSync);
    };
  }, []);

  const toggleSymbol = useCallback((symbol: string) => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return;
    const current = readWatchlist();
    const next = current.includes(clean)
      ? current.filter((s) => s !== clean)
      : [...current, clean].sort();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {
      // Ignore storage quota errors
    }
    setSymbols(next);
  }, []);

  const addSymbol = useCallback((symbol: string) => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return;
    const current = readWatchlist();
    if (current.includes(clean)) return;
    const next = [...current, clean].sort();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {
      // Ignore storage quota errors
    }
    setSymbols(next);
  }, []);

  const hasSymbol = useCallback(
    (symbol: string) => symbols.includes(symbol.trim().toUpperCase()),
    [symbols]
  );

  const setAlertRule = useCallback((symbol: string, rule: WatchlistAlertRule) => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return;
    const current = readAlertRules();
    const next = { ...current, [clean]: { ...current[clean], ...rule } };
    try {
      localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(ALERTS_EVENT_NAME));
    } catch {
      // Ignore storage quota errors
    }
    setAlertRules(next);
  }, []);

  const clearAlertRule = useCallback((symbol: string) => {
    const clean = symbol.trim().toUpperCase();
    const current = readAlertRules();
    if (!(clean in current)) return;
    const next = { ...current };
    delete next[clean];
    try {
      localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(ALERTS_EVENT_NAME));
    } catch {
      // Ignore storage quota errors
    }
    setAlertRules(next);
  }, []);

  return {
    watchlist: symbols,
    hasSymbol,
    toggleSymbol,
    addSymbol,
    alertRules,
    setAlertRule,
    clearAlertRule,
  };
}

export function useCompareList() {
  const [compareSymbols, setCompareState] = useState<string[]>(() => readCompareList());

  useEffect(() => {
    const onSync = () => setCompareState(readCompareList());
    window.addEventListener('storage', onSync);
    window.addEventListener(COMPARE_EVENT_NAME, onSync);
    return () => {
      window.removeEventListener('storage', onSync);
      window.removeEventListener(COMPARE_EVENT_NAME, onSync);
    };
  }, []);

  const persist = (next: string[]) => {
    const clean = normalizeSymbolList(next, 4);
    try {
      localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(clean));
      window.dispatchEvent(new Event(COMPARE_EVENT_NAME));
    } catch {
      // Ignore storage quota errors
    }
    setCompareState(clean);
  };

  const toggleCompare = useCallback((symbol: string) => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return;
    const current = readCompareList();
    if (current.includes(clean)) {
      persist(current.filter((s) => s !== clean));
    } else if (current.length >= 4) {
      persist([...current.slice(1), clean]);
    } else {
      persist([...current, clean]);
    }
  }, []);

  const removeCompare = useCallback((symbol: string) => {
    const clean = symbol.trim().toUpperCase();
    persist(readCompareList().filter((s) => s !== clean));
  }, []);

  const clearCompare = useCallback(() => {
    persist([]);
  }, []);

  const setCompareSymbols = useCallback((next: string[]) => {
    persist(next);
  }, []);

  const hasCompare = useCallback(
    (symbol: string) => compareSymbols.includes(symbol.trim().toUpperCase()),
    [compareSymbols]
  );

  return {
    compareSymbols,
    hasCompare,
    toggleCompare,
    removeCompare,
    clearCompare,
    setCompareSymbols,
  };
}
