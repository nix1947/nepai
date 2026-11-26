import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface TradingSettings {
  lookbackDays: number; // 5, 10, 20, 50, 100 (or custom)
  volumeSpikeMult: number;
  turnoverSpikeMult: number;
  rsiOverbought: number;
  rsiOversold: number;
  near52Pct: number;
  blockTicketMinRs: number;
}

export const DEFAULT_TRADING_SETTINGS: TradingSettings = {
  lookbackDays: 20,
  volumeSpikeMult: 1.5,
  turnoverSpikeMult: 1.5,
  rsiOverbought: 70,
  rsiOversold: 30,
  near52Pct: 5,
  blockTicketMinRs: 350_000,
};

export const LOOKBACK_PRESETS = [5, 10, 20, 50, 100] as const;

const STORAGE_KEY = 'nepse-trading-settings-v1';

interface TradingSettingsContextValue {
  settings: TradingSettings;
  updateSettings: (patch: Partial<TradingSettings>) => void;
  resetSettings: () => void;
}

const TradingSettingsContext = createContext<TradingSettingsContextValue>({
  settings: DEFAULT_TRADING_SETTINGS,
  updateSettings: () => undefined,
  resetSettings: () => undefined,
});

function loadStoredSettings(): TradingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TRADING_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<TradingSettings>;
    return {
      lookbackDays:
        typeof parsed.lookbackDays === 'number' && parsed.lookbackDays >= 2 && parsed.lookbackDays <= 250
          ? Math.round(parsed.lookbackDays)
          : DEFAULT_TRADING_SETTINGS.lookbackDays,
      volumeSpikeMult:
        typeof parsed.volumeSpikeMult === 'number' && parsed.volumeSpikeMult >= 1
          ? parsed.volumeSpikeMult
          : DEFAULT_TRADING_SETTINGS.volumeSpikeMult,
      turnoverSpikeMult:
        typeof parsed.turnoverSpikeMult === 'number' && parsed.turnoverSpikeMult >= 1
          ? parsed.turnoverSpikeMult
          : DEFAULT_TRADING_SETTINGS.turnoverSpikeMult,
      rsiOverbought:
        typeof parsed.rsiOverbought === 'number' && parsed.rsiOverbought >= 55 && parsed.rsiOverbought <= 95
          ? parsed.rsiOverbought
          : DEFAULT_TRADING_SETTINGS.rsiOverbought,
      rsiOversold:
        typeof parsed.rsiOversold === 'number' && parsed.rsiOversold >= 5 && parsed.rsiOversold <= 45
          ? parsed.rsiOversold
          : DEFAULT_TRADING_SETTINGS.rsiOversold,
      near52Pct:
        typeof parsed.near52Pct === 'number' && parsed.near52Pct >= 1 && parsed.near52Pct <= 25
          ? parsed.near52Pct
          : DEFAULT_TRADING_SETTINGS.near52Pct,
      blockTicketMinRs:
        typeof parsed.blockTicketMinRs === 'number' && parsed.blockTicketMinRs >= 50_000
          ? parsed.blockTicketMinRs
          : DEFAULT_TRADING_SETTINGS.blockTicketMinRs,
    };
  } catch {
    return DEFAULT_TRADING_SETTINGS;
  }
}

export const TradingSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<TradingSettings>(loadStoredSettings);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota errors
    }
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<TradingSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_TRADING_SETTINGS);
  }, []);

  return (
    <TradingSettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
      {children}
    </TradingSettingsContext.Provider>
  );
};

export function useTradingSettings(): TradingSettingsContextValue {
  return useContext(TradingSettingsContext);
}
