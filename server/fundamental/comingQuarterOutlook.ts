import type {
  ComingQuarterDirection,
  ComingQuarterOutlook,
  ComingQuarterReference,
  CompanyKnowledgeBaseEntry,
  GrowthComparisons,
  MarketOverlay,
  QuarterCode,
  QuarterlyStatementRecord,
  SectorGroup,
  ValuationBreakdown,
} from '../../src/types/fundamental.ts';
import {
  extractStartBsYear,
  formatFiscalYearFromBs,
  getNepalFiscalYearCalendarContext,
  quarterOrderValue,
} from './nepalCalendar.ts';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clip(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function pctDiff(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (
    curr === null ||
    curr === undefined ||
    prev === null ||
    prev === undefined ||
    !Number.isFinite(curr) ||
    !Number.isFinite(prev) ||
    Math.abs(prev) < 1e-9
  ) {
    return null;
  }
  return round1(((curr - prev) / Math.abs(prev)) * 100);
}

function nextQuarterAfter(
  fiscalYear: string,
  quarter: QuarterCode,
  fallbackBsYear: number
): { comingQuarter: QuarterCode; comingFiscalYear: string } {
  const startBs = extractStartBsYear(fiscalYear) ?? fallbackBsYear;
  switch (quarter) {
    case 'Q1':
      return { comingQuarter: 'Q2', comingFiscalYear: fiscalYear };
    case 'Q2':
      return { comingQuarter: 'Q3', comingFiscalYear: fiscalYear };
    case 'Q3':
      return { comingQuarter: 'Q4', comingFiscalYear: fiscalYear };
    case 'Q4':
    case 'Annual':
    default:
      return {
        comingQuarter: 'Q1',
        comingFiscalYear: formatFiscalYearFromBs(startBs + 1),
      };
  }
}

export function emptyComingQuarterOutlook(now: Date = new Date()): ComingQuarterOutlook {
  const cal = getNepalFiscalYearCalendarContext(now);
  return {
    direction: 'Insufficient Data',
    score: 0,
    signalStrength: 0,
    confidence: 'Low',
    isCurrentFyQuarter: false,
    currentFy: cal.currentFy,
    currentQuarter: null,
    currentPeriodLabel: 'Pending Collection',
    comingQuarter: null,
    comingFiscalYear: cal.currentFy,
    comingQuarterLabel: `Next Qtr (FY ${cal.currentFy})`,
    headline: 'Insufficient current-quarter fundamental statements to project next-quarter direction.',
    reasons: [],
    catalysts: [],
    risks: [],
    references: [],
  };
}

export function computeComingQuarterOutlook(params: {
  sectorGroup: SectorGroup;
  ledger: { records: QuarterlyStatementRecord[]; companyName?: string } | null;
  activeRecord: QuarterlyStatementRecord | null;
  growth: GrowthComparisons;
  valuation: ValuationBreakdown | null;
  market: MarketOverlay;
  kbEntry?: CompanyKnowledgeBaseEntry | null;
  benchmarkFdRatePct?: number;
  now?: Date;
}): ComingQuarterOutlook {
  const {
    sectorGroup,
    ledger,
    activeRecord,
    growth,
    valuation,
    market,
    kbEntry = null,
    benchmarkFdRatePct = 6.5,
    now = new Date(),
  } = params;

  const cal = getNepalFiscalYearCalendarContext(now);
  const allRecs = ledger?.records ?? (activeRecord ? [activeRecord] : []);
  if (allRecs.length === 0) {
    return emptyComingQuarterOutlook(now);
  }

  // Prefer the latest reported quarter inside the current Nepal BS FY (e.g. Q1 FY 2083/84).
  const currentFyQuarterly = allRecs
    .filter((r) => r.fiscalYear === cal.currentFy)
    .sort((a, b) => quarterOrderValue(b.quarter) - quarterOrderValue(a.quarter));

  const sortedAllByRecency = [...allRecs].sort((a, b) => {
    const yDiff = (extractStartBsYear(b.fiscalYear) ?? 0) - (extractStartBsYear(a.fiscalYear) ?? 0);
    if (yDiff !== 0) return yDiff;
    return quarterOrderValue(b.quarter) - quarterOrderValue(a.quarter);
  });

  const qtrRec = currentFyQuarterly[0] ?? sortedAllByRecency[0] ?? activeRecord;
  if (!qtrRec) {
    return emptyComingQuarterOutlook(now);
  }

  const isCurrentFyQuarter = qtrRec.fiscalYear === cal.currentFy;
  const { comingQuarter, comingFiscalYear } = nextQuarterAfter(
    qtrRec.fiscalYear,
    qtrRec.quarter,
    cal.currentStartBs
  );
  const comingQuarterLabel = `${comingQuarter} FY ${comingFiscalYear}`;

  const qtrChronoIdx = sortedAllByRecency.findIndex((r) => r.id === qtrRec.id);
  const prevRec =
    qtrChronoIdx >= 0 && qtrChronoIdx + 1 < sortedAllByRecency.length
      ? sortedAllByRecency[qtrChronoIdx + 1]
      : null;
  const qtrBsYear = extractStartBsYear(qtrRec.fiscalYear);
  const yoyRec =
    qtrBsYear !== null
      ? sortedAllByRecency.find(
          (r) =>
            extractStartBsYear(r.fiscalYear) === qtrBsYear - 1 && r.quarter === qtrRec.quarter
        ) ??
        sortedAllByRecency.find(
          (r) => extractStartBsYear(r.fiscalYear) === qtrBsYear - 1 && r.quarter === 'Annual'
        ) ??
        null
      : null;

  const stmtRef = `[Ref: ${qtrRec.periodLabel} · ${qtrRec.dataSource}]`;
  const yoyRef = yoyRec
    ? `[Ref: ${qtrRec.periodLabel} vs ${yoyRec.periodLabel} · ${qtrRec.dataSource}]`
    : stmtRef;
  const prevRef = prevRec
    ? `[Ref: ${qtrRec.periodLabel} vs ${prevRec.periodLabel} · ${qtrRec.dataSource}]`
    : stmtRef;

  const m = qtrRec.metrics;
  const eps = m.eps.value;
  const netProfitCr = m.netProfit.value !== null ? round2(m.netProfit.value / 1e7) : null;
  const revenueCr = m.revenue.value !== null ? round2(m.revenue.value / 1e7) : null;
  const roePct = m.roePct.value;
  const netMarginPct = m.netProfitMarginPct.value;
  const ocfCr = m.operatingCashFlow.value !== null ? round2(m.operatingCashFlow.value / 1e7) : null;
  const debtToEquity = m.debtToEquity.value;
  const nplPct = m.nplPct.value;
  const carPct = m.carPct.value;
  const costOfFundsPct = m.costOfFundsPct.value;
  const claimRatioPct = m.claimRatioPct.value;
  const solvencyRatio = m.solvencyRatio.value;

  const useProvidedGrowth = activeRecord?.id === qtrRec.id;
  const epsQoq = useProvidedGrowth
    ? growth.epsQoqPct
    : pctDiff(eps, prevRec?.metrics.eps.value);
  const epsYoy = useProvidedGrowth
    ? growth.epsYoyPct
    : pctDiff(eps, yoyRec?.metrics.eps.value);
  const npQoq = useProvidedGrowth
    ? growth.netProfitQoqPct
    : pctDiff(m.netProfit.value, prevRec?.metrics.netProfit.value);
  const npYoy = useProvidedGrowth
    ? growth.netProfitYoyPct
    : pctDiff(m.netProfit.value, yoyRec?.metrics.netProfit.value);
  const revYoy = useProvidedGrowth
    ? growth.revenueYoyPct
    : pctDiff(m.revenue.value, yoyRec?.metrics.revenue.value);
  const epsVsQ4Avg = growth.q4Benchmark.epsVsAvgPct;

  const nplQoqDelta =
    nplPct !== null &&
    prevRec?.metrics.nplPct.value !== null &&
    prevRec?.metrics.nplPct.value !== undefined
      ? round2(nplPct - prevRec.metrics.nplPct.value)
      : null;
  const roeQoqDelta =
    roePct !== null &&
    prevRec?.metrics.roePct.value !== null &&
    prevRec?.metrics.roePct.value !== undefined
      ? round2(roePct - prevRec.metrics.roePct.value)
      : null;

  let score = 0;
  let dataDimensions = 0;
  const catalysts: string[] = [];
  const risks: string[] = [];

  // 1. Earnings & Revenue Momentum
  if (eps !== null || netProfitCr !== null) {
    dataDimensions++;
    if (eps !== null && eps <= 0) {
      score -= 26;
      risks.push(
        `Negative earnings in ${qtrRec.periodLabel} (EPS Rs ${eps.toFixed(1)}) signals operating pressure heading into ${comingQuarterLabel}. ${stmtRef}`
      );
    } else if (
      (epsYoy !== null && epsYoy >= 25) ||
      (epsQoq !== null && epsQoq >= 22) ||
      (npYoy !== null && npYoy >= 28)
    ) {
      score += 22;
      const driver =
        epsYoy !== null && epsYoy >= 25
          ? `EPS +${epsYoy.toFixed(1)}% YoY`
          : npYoy !== null && npYoy >= 28
            ? `Net profit +${npYoy.toFixed(1)}% YoY`
            : `EPS +${(epsQoq ?? 0).toFixed(1)}% QoQ`;
      catalysts.push(
        `Strong profit momentum (${driver}; EPS Rs ${eps !== null ? eps.toFixed(1) : 'N/A'}) builds earnings tailwind for ${comingQuarterLabel}. ${epsYoy !== null && epsYoy >= 25 ? yoyRef : prevRef}`
      );
    } else if (
      (epsYoy !== null && epsYoy >= 8) ||
      (epsQoq !== null && epsQoq >= 8) ||
      (npYoy !== null && npYoy >= 10)
    ) {
      score += 11;
      const driver =
        epsYoy !== null && epsYoy >= 8
          ? `EPS +${epsYoy.toFixed(1)}% YoY`
          : `EPS +${(epsQoq ?? npYoy ?? 0).toFixed(1)}% sequential growth`;
      catalysts.push(
        `Steady earnings expansion (${driver} in ${qtrRec.periodLabel}) supports ${comingQuarter} run-rate. ${epsYoy !== null && epsYoy >= 8 ? yoyRef : prevRef}`
      );
    } else if (
      (epsYoy !== null && epsYoy <= -25) ||
      (epsQoq !== null && epsQoq <= -25) ||
      (npYoy !== null && npYoy <= -25)
    ) {
      score -= 22;
      const dropStr =
        epsYoy !== null && epsYoy <= -25
          ? `EPS ${epsYoy.toFixed(1)}% YoY`
          : npYoy !== null && npYoy <= -25
            ? `Net profit ${npYoy.toFixed(1)}% YoY`
            : `EPS ${(epsQoq ?? 0).toFixed(1)}% QoQ`;
      risks.push(
        `Sharp earnings contraction (${dropStr} in ${qtrRec.periodLabel}) raises downside risk in ${comingQuarterLabel}. ${epsYoy !== null && epsYoy <= -25 ? yoyRef : prevRef}`
      );
    } else if (
      (epsYoy !== null && epsYoy <= -10) ||
      (epsQoq !== null && epsQoq <= -10) ||
      (npQoq !== null && npQoq <= -12)
    ) {
      score -= 11;
      const dropVal =
        epsYoy !== null && epsYoy <= -10
          ? `${epsYoy.toFixed(1)}% YoY`
          : `${(epsQoq ?? npQoq ?? 0).toFixed(1)}% QoQ`;
      risks.push(
        `Softening profitability (${dropVal}) could weigh on ${comingQuarter} earnings if costs remain elevated. ${epsYoy !== null && epsYoy <= -10 ? yoyRef : prevRef}`
      );
    }

    if (revYoy !== null) {
      if (revYoy >= 15 && (npYoy === null || npYoy >= 8)) {
        score += 7;
        catalysts.push(
          `Top-line growth (+${revYoy.toFixed(1)}% YoY revenue) expands operating leverage into ${comingQuarter}. ${yoyRef}`
        );
      } else if (revYoy <= -12) {
        score -= 9;
        risks.push(
          `Revenue fell ${revYoy.toFixed(1)}% YoY${revenueCr !== null ? ` (Rs ${revenueCr} Cr)` : ''}, limiting near-term margin expansion. ${yoyRef}`
        );
      }
    }

    if (epsVsQ4Avg !== null) {
      if (epsVsQ4Avg >= 20) {
        score += 8;
        catalysts.push(
          `Current run-rate EPS stands +${epsVsQ4Avg.toFixed(1)}% above its 3-year Q4 average baseline. [Ref: 3Y Q4 Ledger Benchmark]`
        );
      } else if (epsVsQ4Avg <= -25) {
        score -= 8;
        risks.push(
          `Current EPS trails its 3-year Q4 historical benchmark by ${epsVsQ4Avg.toFixed(1)}%. [Ref: 3Y Q4 Ledger Benchmark]`
        );
      }
    }
  }

  // 2. Profitability, ROE & Cash Conversion
  if (roePct !== null || netMarginPct !== null || ocfCr !== null) {
    dataDimensions++;
    if (roePct !== null) {
      if (roePct >= 18) {
        score += 11;
        catalysts.push(
          `High capital efficiency (ROE ${roePct.toFixed(1)}%) compounds book value each quarter. ${stmtRef}`
        );
      } else if (roePct >= 12) {
        score += 5;
        catalysts.push(
          `Healthy ROE (${roePct.toFixed(1)}%) sustains steady earnings compounding. ${stmtRef}`
        );
      } else if (roePct < 6) {
        score -= 12;
        risks.push(
          `Weak ROE (${roePct.toFixed(1)}%) leaves thin buffer against rising expenses or provisions. ${stmtRef}`
        );
      }
    }

    if (roeQoqDelta !== null) {
      if (roeQoqDelta >= 1.5) {
        score += 6;
        catalysts.push(
          `ROE improved +${roeQoqDelta.toFixed(2)} pp sequentially, confirming margin traction. ${prevRef}`
        );
      } else if (roeQoqDelta <= -1.5) {
        score -= 7;
        risks.push(
          `ROE compressed ${roeQoqDelta.toFixed(2)} pp vs previous period. ${prevRef}`
        );
      }
    }

    if (ocfCr !== null && netProfitCr !== null && netProfitCr > 0) {
      const ocfRatio = (ocfCr / netProfitCr) * 100;
      if (ocfRatio >= 85) {
        score += 6;
        catalysts.push(
          `Operating cash flow (Rs ${ocfCr} Cr, ${Math.round(ocfRatio)}% of profit) verifies cash-backed earnings. ${stmtRef}`
        );
      } else if (ocfCr < 0) {
        score -= 9;
        risks.push(
          `Negative operating cash flow (Rs ${ocfCr} Cr vs Rs ${netProfitCr} Cr profit) flags working-capital strain. ${stmtRef}`
        );
      }
    }
  }

  // 3. Sector-Specific Nepal Next-Quarter Drivers
  const isBfi = sectorGroup === 'Banking' || sectorGroup === 'Microfinance';
  if (isBfi && (nplPct !== null || carPct !== null || costOfFundsPct !== null)) {
    dataDimensions++;
    if (nplPct !== null) {
      if (nplPct <= 1.8) {
        score += 11;
        catalysts.push(
          `Low NPL (${nplPct.toFixed(2)}%) keeps impairment charges restrained into ${comingQuarterLabel}. [Ref: ${qtrRec.periodLabel} · NRB Asset Quality]`
        );
      } else if (nplPct > 4.5) {
        score -= 17;
        risks.push(
          `Elevated NPL (${nplPct.toFixed(2)}%) threatens higher NRB loan-loss provisioning next quarter. [Ref: ${qtrRec.periodLabel} · NRB Asset Quality]`
        );
      } else if (nplPct > 3.2) {
        score -= 8;
        risks.push(
          `NPL at ${nplPct.toFixed(2)}% warrants caution on credit-cost trajectory in ${comingQuarter}. [Ref: ${qtrRec.periodLabel} · NRB Asset Quality]`
        );
      }
    }
    if (nplQoqDelta !== null) {
      if (nplQoqDelta <= -0.3) {
        score += 8;
        catalysts.push(
          `Falling NPL (${nplQoqDelta.toFixed(2)} pp QoQ) opens provision write-back potential in ${comingQuarter}. ${prevRef}`
        );
      } else if (nplQoqDelta >= 0.4) {
        score -= 11;
        risks.push(
          `Rising NPL (+${nplQoqDelta.toFixed(2)} pp QoQ) increases impairment drag risk next quarter. ${prevRef}`
        );
      }
    }
    if (carPct !== null) {
      if (carPct >= 13.0) {
        score += 5;
        catalysts.push(
          `Strong CAR (${carPct.toFixed(2)}%) provides ample capital headroom to expand credit. [Ref: ${qtrRec.periodLabel} · CAR Disclosure]`
        );
      } else if (carPct < 11.0) {
        score -= 12;
        risks.push(
          `Tight CAR (${carPct.toFixed(2)}%) constrains loan growth and dividend capacity. [Ref: ${qtrRec.periodLabel} · NRB CAR Rule]`
        );
      }
    }
    if (costOfFundsPct !== null) {
      if (costOfFundsPct <= 5.5) {
        score += 6;
        catalysts.push(
          `Low cost of funds (${costOfFundsPct.toFixed(2)}%) supports resilient net interest spreads. ${stmtRef}`
        );
      } else if (costOfFundsPct >= 8.0) {
        score -= 7;
        risks.push(
          `High cost of funds (${costOfFundsPct.toFixed(2)}%) compresses net interest margins. ${stmtRef}`
        );
      }
    }
  } else if (sectorGroup === 'Hydropower') {
    dataDimensions++;
    if (comingQuarter === 'Q2' || comingQuarter === 'Q3') {
      score -= 8;
      risks.push(
        `Seasonal winter hydrology ahead of ${comingQuarterLabel} typically lowers run-of-river MWh generation vs monsoon Q1. [Ref: Nepal BS Hydrology Cycle]`
      );
    } else if (comingQuarter === 'Q4' || comingQuarter === 'Q1') {
      score += 11;
      catalysts.push(
        `Seasonal snowmelt/monsoon discharge ramp into ${comingQuarterLabel} boosts hydro generation and PPA revenue. [Ref: Nepal BS Hydrology Cycle]`
      );
    }
    if (debtToEquity !== null) {
      if (debtToEquity <= 0.8) {
        score += 10;
        catalysts.push(
          `Deleveraged balance sheet (D/E ${debtToEquity.toFixed(2)}x) converts generation directly to free cash flow. ${stmtRef}`
        );
      } else if (debtToEquity >= 2.2) {
        score -= 13;
        risks.push(
          `High leverage (D/E ${debtToEquity.toFixed(2)}x) magnifies interest drag during softer generation quarters. ${stmtRef}`
        );
      }
    }
  } else if (sectorGroup === 'Insurance' && (claimRatioPct !== null || solvencyRatio !== null)) {
    dataDimensions++;
    if (solvencyRatio !== null && solvencyRatio >= 2.0) {
      score += 7;
      catalysts.push(
        `Strong solvency margin (${solvencyRatio.toFixed(2)}x) supports underwriting growth and investment float. [Ref: ${qtrRec.periodLabel} · NIA Solvency]`
      );
    } else if (solvencyRatio !== null && solvencyRatio < 1.5) {
      score -= 11;
      risks.push(
        `Lower solvency ratio (${solvencyRatio.toFixed(2)}x) narrows statutory capital cushion. [Ref: ${qtrRec.periodLabel} · NIA Solvency]`
      );
    }
    if (claimRatioPct !== null) {
      if (claimRatioPct <= 55) {
        score += 7;
        catalysts.push(
          `Disciplined claim ratio (${claimRatioPct.toFixed(1)}%) preserves underwriting surplus. ${stmtRef}`
        );
      } else if (claimRatioPct >= 75) {
        score -= 11;
        risks.push(
          `Elevated claim ratio (${claimRatioPct.toFixed(1)}%) pressures near-term underwriting profit. ${stmtRef}`
        );
      }
    }
  } else if (debtToEquity !== null) {
    dataDimensions++;
    if (debtToEquity <= 0.6) {
      score += 7;
      catalysts.push(
        `Conservative leverage (D/E ${debtToEquity.toFixed(2)}x) insulates margins from financing costs. ${stmtRef}`
      );
    } else if (debtToEquity >= 1.8) {
      score -= 11;
      risks.push(
        `High leverage (D/E ${debtToEquity.toFixed(2)}x) creates earnings sensitivity if demand softens. ${stmtRef}`
      );
    }
    if (
      sectorGroup === 'Other' &&
      /hotel|tourism|resort|chandragiri/i.test(qtrRec.companyName) &&
      (comingQuarter === 'Q2' || comingQuarter === 'Q3')
    ) {
      score += 6;
      catalysts.push(
        `Peak Nepal tourism window supports occupancy & RevPAR into ${comingQuarterLabel}. [Ref: Nepal Seasonal Tourism Cycle]`
      );
    }
  }

  // 4. Valuation Cushion & FD Yield Spread
  if (valuation && (valuation.marginOfSafetyPct !== null || valuation.earningsYieldPct !== null)) {
    dataDimensions++;
    const mos = valuation.marginOfSafetyPct;
    const valRef = `[Ref: ${valuation.method}${market.date ? ` @ EOD ${market.date}` : ''}]`;
    if (mos !== null) {
      if (mos >= 25) {
        score += 12;
        catalysts.push(
          `Deep valuation cushion (+${mos.toFixed(1)}% Margin of Safety) offers upside re-rating room on ${comingQuarter} numbers. ${valRef}`
        );
      } else if (mos >= 10) {
        score += 6;
        catalysts.push(
          `Attractive Margin of Safety (+${mos.toFixed(1)}%) limits multiple-compression risk. ${valRef}`
        );
      } else if (mos <= -25) {
        score -= 13;
        risks.push(
          `Rich valuation (${mos.toFixed(1)}% MoS vs fair value) leaves stock vulnerable to any ${comingQuarter} earnings miss. ${valRef}`
        );
      }
    }
    if (valuation.earningsYieldPct !== null) {
      const spread = round2(valuation.earningsYieldPct - benchmarkFdRatePct);
      if (spread >= 3.0) {
        score += 7;
        catalysts.push(
          `Earnings yield beats bank FD benchmark by +${spread.toFixed(2)} pp (${valuation.earningsYieldPct.toFixed(1)}% vs ${benchmarkFdRatePct}% FD). [Ref: Macro FD Spread]`
        );
      } else if (spread <= -3.0 && (valuation.livePe ?? 0) > 28) {
        score -= 6;
        risks.push(
          `Rich multiple (P/E ${valuation.livePe?.toFixed(1)}x; ${spread.toFixed(2)} pp below FD yield) requires flawless growth. [Ref: Macro FD Spread]`
        );
      }
    }
  }

  // 5. Liquidity / Momentum & Regulatory Knowledge Base Signals
  if (market.ltp !== null || kbEntry) {
    dataDimensions++;
    const mktRef = market.date ? `[Ref: NEPSE EOD ${market.date}]` : '[Ref: NEPSE EOD Feed]';
    if ((market.turnoverMultN ?? 0) >= 1.6 && (market.periodReturnNPct ?? 0) > 2) {
      score += 7;
      catalysts.push(
        `Turnover spike (${market.turnoverMultN?.toFixed(1)}x avg) alongside +${market.periodReturnNPct?.toFixed(1)}% price flow hints at accumulation. ${mktRef}`
      );
    } else if ((market.momentumScore ?? 50) <= 30 && (market.periodReturnNPct ?? 0) <= -5) {
      score -= 6;
      risks.push(
        `Weak price momentum (${market.periodReturnNPct?.toFixed(1)}% over recent sessions) reflects cautious positioning. ${mktRef}`
      );
    }

    if (kbEntry) {
      const kbRef = kbEntry.creditRating?.agency
        ? `[Ref: ${kbEntry.creditRating.agency} / Regulatory KB]`
        : '[Ref: Regulatory KB]';
      if (kbEntry.regulatoryStanding === 'Alert' || kbEntry.creditRating?.outlook === 'Negative') {
        score -= 12;
        risks.push(
          `Regulatory/rating watch (${kbEntry.regulatoryStanding}${kbEntry.creditRating?.ratingGrade ? `, ${kbEntry.creditRating.ratingGrade}` : ''}) poses headwind risk. ${kbRef}`
        );
      }
      if (kbEntry.lockInOverhangFlag) {
        score -= 9;
        risks.push(
          `Share lock-in expiry overhang could trigger supply pressure around ${comingQuarterLabel}. [Ref: CDSC / Regulatory KB]`
        );
      }
      if (kbEntry.tailwinds.length > 0) {
        score += 5;
        catalysts.push(`KB catalyst: ${kbEntry.tailwinds[0]} ${kbRef}`);
      }
    }
  }

  // Fallback baseline reason if ledger had sparse fields
  if (catalysts.length === 0 && risks.length === 0) {
    if (eps !== null && eps > 0) {
      catalysts.push(
        `Positive baseline earnings (EPS Rs ${eps.toFixed(1)}${roePct !== null ? `, ROE ${roePct.toFixed(1)}%` : ''}) reported in ${qtrRec.periodLabel}. ${stmtRef}`
      );
    } else {
      risks.push(
        `Limited multi-period ratios in ${qtrRec.periodLabel}; monitor ${comingQuarterLabel} filing. ${stmtRef}`
      );
    }
  }

  // Build structured Reference links / sources
  const references: ComingQuarterReference[] = [
    {
      label: `${qtrRec.periodLabel} Financial Statement`,
      source: qtrRec.dataSource,
      period: qtrRec.periodLabel,
      url: qtrRec.sourceUrl,
    },
  ];
  if (prevRec) {
    references.push({
      label: `Sequential Baseline (${prevRec.periodLabel})`,
      source: prevRec.dataSource,
      period: prevRec.periodLabel,
      url: prevRec.sourceUrl,
    });
  }
  if (yoyRec && yoyRec.id !== prevRec?.id) {
    references.push({
      label: `YoY Comparison (${yoyRec.periodLabel})`,
      source: yoyRec.dataSource,
      period: yoyRec.periodLabel,
      url: yoyRec.sourceUrl,
    });
  }
  if (valuation && valuation.intrinsicValue !== null) {
    references.push({
      label: `${valuation.method} (Intrinsic Rs ${valuation.intrinsicValue.toFixed(0)})`,
      source: `Valuation Engine · FD ${benchmarkFdRatePct}%`,
      period: market.date,
      url: null,
    });
  }
  if (kbEntry) {
    if (kbEntry.creditRating?.ratingGrade) {
      references.push({
        label: `${kbEntry.creditRating.agency ?? 'Credit'} Rating: ${kbEntry.creditRating.ratingGrade} (${kbEntry.creditRating.outlook})`,
        source: kbEntry.creditRating.agency ?? 'Regulatory KB',
        period: kbEntry.creditRating.lastRatedDate,
        url: kbEntry.citations[0]?.uri ?? null,
      });
    }
    for (const c of kbEntry.citations.slice(0, 2)) {
      if (!references.some((r) => r.url && r.url === c.uri)) {
        references.push({
          label: c.title,
          source: `${c.agency} KB`,
          period: kbEntry.updatedAt.slice(0, 10),
          url: c.uri,
        });
      }
    }
  }

  const finalScore = Math.round(clip(score, -100, 100));
  let direction: ComingQuarterDirection;
  if (finalScore >= 25) direction = 'Blow Up';
  else if (finalScore >= 10) direction = 'Moderate Upside';
  else if (finalScore > -10) direction = 'Balanced';
  else if (finalScore > -25) direction = 'Downside Risk';
  else direction = 'Blow Down';

  const confidence: ComingQuarterOutlook['confidence'] =
    dataDimensions >= 4 ? 'High' : dataDimensions >= 2 ? 'Moderate' : 'Low';
  const signalStrength = Math.round(
    clip(Math.abs(finalScore) * 1.5 + (catalysts.length + risks.length) * 3, 10, 100)
  );

  const reasons =
    finalScore >= 0
      ? [...catalysts.slice(0, 3), ...risks.slice(0, 2)].slice(0, 4)
      : [...risks.slice(0, 3), ...catalysts.slice(0, 2)].slice(0, 4);

  const leadReason = reasons[0] ?? `Monitored from ${qtrRec.periodLabel}.`;
  let headline: string;
  if (direction === 'Blow Up') {
    headline = `Potential ${comingQuarterLabel} Blow-Up (+${finalScore}): ${leadReason}`;
  } else if (direction === 'Moderate Upside') {
    headline = `Constructive ${comingQuarterLabel} Setup (+${finalScore}): ${leadReason}`;
  } else if (direction === 'Blow Down') {
    headline = `Potential ${comingQuarterLabel} Blow-Down (${finalScore}): ${leadReason}`;
  } else if (direction === 'Downside Risk') {
    headline = `Caution Into ${comingQuarterLabel} (${finalScore}): ${leadReason}`;
  } else {
    headline = `Balanced ${comingQuarterLabel} Outlook (${finalScore >= 0 ? '+' : ''}${finalScore}): ${leadReason}`;
  }

  return {
    direction,
    score: finalScore,
    signalStrength,
    confidence,
    isCurrentFyQuarter,
    currentFy: qtrRec.fiscalYear,
    currentQuarter: qtrRec.quarter,
    currentPeriodLabel: qtrRec.periodLabel,
    comingQuarter,
    comingFiscalYear,
    comingQuarterLabel,
    headline,
    reasons,
    catalysts: catalysts.slice(0, 4),
    risks: risks.slice(0, 4),
    references: references.slice(0, 6),
  };
}
