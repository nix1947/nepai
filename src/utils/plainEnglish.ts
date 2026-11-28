import type { MasterScreenerRow } from '../types/fundamental';
import type { WatchlistAlertRule } from '../hooks/useWatchlist';

export interface GlossaryEntry {
  title: string;
  body: string;
  example?: string;
}

export const METRIC_GLOSSARY = {
  masterScore: {
    title: 'Master Confluence Score (0–100)',
    body: 'Weighted blend combining Pricing & Valuation Health (28%), 9-Investor Fundamental Quality (27%), Technical Trend & Breakout Strength (23%), and Player Liquidity Flow (22%).',
    example: 'Scores ≥ 68 indicate strong alignment across price value, annual fundamentals, chart trend, and active market liquidity.',
  },
  valuationHealthScore: {
    title: 'Valuation Health Score (0–100)',
    body: 'Measures balance-sheet safety, earnings consistency, and multi-year compounding resilience using 70% Annual Report and 30% latest quarterly filings.',
    example: '≥ 70 = Healthy compounder; 55–69 = Solid; < 45 = Elevated leverage, weak ROE, or NPL pressure.',
  },
  marginOfSafetyPct: {
    title: 'Margin of Safety (MoS %)',
    body: 'How cheap the current LTP is compared to our 6-model Composite Fair Value. Positive MoS means you are paying less than estimated intrinsic value.',
    example: '+20% MoS means a Rs 500 Fair Value stock trades at Rs 400.',
  },
  buyZonePrice: {
    title: 'Buy Zone Price (≥ 15% Discount)',
    body: 'Target accumulation price set 15% below Composite Fair Value to cushion against market volatility or quarterly earnings noise.',
  },
  fdSpreadPct: {
    title: 'Earnings Yield vs. Nepal Bank FD',
    body: 'Compares the stock’s Earnings Yield (EPS ÷ Price) against a typical Nepal fixed deposit rate (~6.5%). Positive spread means earnings yield beats risk-free bank FD.',
  },
  reserveToCapitalRatio: {
    title: 'Reserve / Share Capital Cushion',
    body: 'Reserves and retained earnings divided by paid-up share capital. Higher ratios signal strong capacity for bonus shares, dividends, and self-funded expansion.',
    example: '1.20x means reserves exceed paid-up capital by 20%.',
  },
  playerInterestScore: {
    title: 'Player Flow & Liquidity Score (0–100)',
    body: 'Tracks 20-day average turnover, volume/turnover spikes, average trade ticket size (institutional vs. retail), and Up-Day vs. Down-Day accumulation ratio.',
  },
  upDownVolRatio: {
    title: '20D Up/Down Volume Ratio',
    body: 'Total volume traded on green close days divided by volume on red close days over the past 20 sessions. Above 1.3x suggests net institutional accumulation.',
  },
  rsi14: {
    title: 'RSI-14 Momentum Oscillator',
    body: 'Measures 14-day buying vs. selling pressure. 50–68 marks a healthy bullish trend; ≤ 35 flags oversold reversal territory; > 75 warns of short-term overheating.',
  },
  tenXScore: {
    title: 'Future 10x Multi-Bagger Runway (0–100)',
    body: 'Scores long-term compounding headroom using small/mid market cap base, ROE compounding, reserve reinvestment, margin of safety, and 5-year bull upside.',
  },
  annualWeighting: {
    title: '70% Annual / 30% Quarterly Blending',
    body: 'Prioritizes audited Annual / Q4 full-year figures (70% weight) while incorporating the latest interim quarter trend (30% weight) to filter out single-quarter distortions.',
  },
  lockInOverhang: {
    title: 'CDSC Lock-in / Regulatory Alert',
    body: 'Flags upcoming promoter/local share lock-in expiries tracked via CDSC or supervisory alerts from NRB, NIA, SEBON, and credit rating agencies.',
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof METRIC_GLOSSARY;

export interface PlainEnglishVerdict {
  headline: string;
  actionCue:
    | 'Strong Opportunity'
    | 'Value Accumulation'
    | 'Momentum Breakout'
    | 'Watch & Wait'
    | 'Caution / Risk Flag';
  tone: 'emerald' | 'blue' | 'amber' | 'red';
  summary: string;
}

export function buildPlainEnglishVerdict(row: MasterScreenerRow): PlainEnglishVerdict {
  const mos = row.valuation.marginOfSafetyPct;
  const health = row.valuation.valuationHealthScore;
  const trend = row.technical.trendState;
  const player = row.liquidity.playerInterestScore;
  const riskFlag =
    row.fundamentals.lockInOverhangFlag || row.fundamentals.regulatoryStanding === 'Alert';

  if (riskFlag) {
    return {
      headline: 'Regulatory or promoter lock-in overhang detected',
      actionCue: 'Caution / Risk Flag',
      tone: 'red',
      summary: `${row.symbol} carries a ${
        row.fundamentals.lockInOverhangFlag ? 'CDSC lock-in unlock overhang' : 'regulatory alert'
      }${mos !== null ? ` (MoS ${mos >= 0 ? '+' : ''}${mos.toFixed(0)}%)` : ''}. Verify supply risk in Valuation & Dissector before committing capital.`,
    };
  }

  if (
    row.valuation.inBuyZone &&
    (health ?? 0) >= 60 &&
    (trend === 'Strong Uptrend' || trend === 'Uptrend' || trend === 'Pullback in Uptrend')
  ) {
    return {
      headline: 'Undervalued quality stock with supportive price action',
      actionCue: 'Strong Opportunity',
      tone: 'emerald',
      summary: `Trades ${mos !== null ? `${mos.toFixed(0)}% below` : 'below'} estimated Fair Value with ${
        health !== null ? `${health.toFixed(0)}/100 Annual Health` : 'solid fundamentals'
      } and ${trend.toLowerCase()} structure${row.liquidity.accumulationFlag ? ' backed by buyer accumulation' : ''}.`,
    };
  }

  if (row.valuation.inBuyZone && (health ?? 0) >= 52) {
    return {
      headline: 'Trading in discount Buy Zone — await momentum confirmation',
      actionCue: 'Value Accumulation',
      tone: 'emerald',
      summary: `Priced at a ${mos !== null ? `${mos.toFixed(0)}%` : 'meaningful'} discount to Fair Value (${
        row.valuation.compositeFairValue ? `Rs ${row.valuation.compositeFairValue.toFixed(0)}` : 'n/a'
      }), though chart trend is ${trend.toLowerCase()}. Ideal for staggered Buy Zone accumulation.`,
    };
  }

  if (
    (row.technical.breakout20d || trend === 'Strong Uptrend') &&
    player >= 65
  ) {
    const valNote =
      mos !== null && mos < -12
        ? `Fair Value gap is stretched (${mos.toFixed(0)}% MoS), so manage stop-loss tightly.`
        : 'Valuation remains reasonable relative to peers.';
    return {
      headline: 'Active institutional/player flow driving a technical breakout',
      actionCue: 'Momentum Breakout',
      tone: 'blue',
      summary: `Strong 20D liquidity (${row.liquidity.avgTurnover20Cr.toFixed(1)} Cr/day) with ${trend.toLowerCase()} momentum. ${valNote}`,
    };
  }

  if (mos !== null && mos < -20) {
    return {
      headline: 'Priced richly above intrinsic value — wait for a pullback',
      actionCue: 'Watch & Wait',
      tone: 'amber',
      summary: `Currently trades ${Math.abs(mos).toFixed(0)}% above Fair Value${
        row.valuation.buyZonePrice ? ` (Buy Zone ≤ Rs ${row.valuation.buyZonePrice.toFixed(0)})` : ''
      }. Better to monitor on watchlist for a healthier entry.`,
    };
  }

  return {
    headline: 'Balanced risk/reward profile — review peer benchmarks',
    actionCue: 'Watch & Wait',
    tone: 'blue',
    summary: `${row.symbol} scores ${row.masterScore.toFixed(0)}/100 overall${
      row.hasAnnualReport ? ' with verified Annual/Q4 numbers' : ''
    }${row.tenX.tenXScore >= 60 ? ' and strong long-term compounding runway' : ''}.`,
  };
}

export interface WatchlistTriggeredAlert {
  label: string;
  severity: 'opportunity' | 'caution' | 'risk';
}

export function evaluateWatchlistAlerts(
  row: MasterScreenerRow | undefined,
  rule?: WatchlistAlertRule
): WatchlistTriggeredAlert[] {
  if (!row) return [];
  const alerts: WatchlistTriggeredAlert[] = [];

  if (row.fundamentals.lockInOverhangFlag) {
    alerts.push({ label: 'CDSC Lock-in Overhang', severity: 'risk' });
  } else if (row.fundamentals.regulatoryStanding === 'Alert') {
    alerts.push({ label: 'Regulatory Alert', severity: 'risk' });
  }

  const ltp = row.ltp;
  if (
    ltp !== null &&
    rule?.targetBuyPrice !== null &&
    rule?.targetBuyPrice !== undefined &&
    rule.targetBuyPrice > 0 &&
    ltp <= rule.targetBuyPrice
  ) {
    alerts.push({ label: `Hit Target Buy ≤ Rs ${rule.targetBuyPrice}`, severity: 'opportunity' });
  }
  if (
    ltp !== null &&
    rule?.targetSellPrice !== null &&
    rule?.targetSellPrice !== undefined &&
    rule.targetSellPrice > 0 &&
    ltp >= rule.targetSellPrice
  ) {
    alerts.push({ label: `Hit Target Sell ≥ Rs ${rule.targetSellPrice}`, severity: 'caution' });
  }

  if ((rule?.alertOnBuyZone ?? true) && row.valuation.inBuyZone) {
    alerts.push({ label: 'In Valuation Buy Zone', severity: 'opportunity' });
  }
  if ((rule?.alertOnBreakout ?? true) && row.technical.breakout20d) {
    alerts.push({ label: '20D Volume Breakout', severity: 'opportunity' });
  }
  if (row.technical.rsi14 !== null && row.technical.rsi14 <= 35) {
    alerts.push({ label: `RSI Oversold (${row.technical.rsi14.toFixed(0)})`, severity: 'caution' });
  }

  return alerts;
}
