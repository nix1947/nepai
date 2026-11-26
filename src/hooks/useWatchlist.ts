import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'nepse_watchlist_v1';
const EVENT_NAME = 'nepse-watchlist-change';

function readWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed
          .map((s) => String(s).trim().toUpperCase())
          .filter((s) => /^[A-Z0-9._-]{1,20}$/.test(s))
      )
    );
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(() => readWatchlist());

  useEffect(() => {
    const onSync = () => setSymbols(readWatchlist());
    window.addEventListener('storage', onSync);
    window.addEventListener(EVENT_NAME, onSync);
    return () => {
      window.removeEventListener('storage', onSync);
      window.removeEventListener(EVENT_NAME, onSync);
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

  const hasSymbol = useCallback(
    (symbol: string) => symbols.includes(symbol.trim().toUpperCase()),
    [symbols]
  );

  return {
    watchlist: symbols,
    hasSymbol,
    toggleSymbol,
  };
}
