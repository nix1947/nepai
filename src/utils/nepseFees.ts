// Single source of truth for SEBON-regulated Nepal Stock Exchange (NEPSE) equity fees,
// DP charges, slippage, Capital Gains Tax (CGT), and target net-proceeds solver.

export function calcNepseBrokerFee(amount: number): number {
  if (amount <= 0) return 0;
  let rate = 0.0024;
  if (amount <= 50_000) rate = 0.0036;
  else if (amount <= 500_000) rate = 0.0033;
  else if (amount <= 2_000_000) rate = 0.0031;
  else if (amount <= 10_000_000) rate = 0.0027;
  return Math.max(10, amount * rate);
}

export function calcNepseBuyCost(
  shares: number,
  price: number,
  slippagePct = 0
): {
  execPrice: number;
  gross: number;
  fee: number;
  total: number;
} {
  if (shares <= 0 || price <= 0) {
    return { execPrice: price, gross: 0, fee: 0, total: 0 };
  }
  const execPrice = price * (1 + Math.max(0, slippagePct) / 100);
  const gross = shares * execPrice;
  const fee = calcNepseBrokerFee(gross) + gross * 0.00015 + 25;
  return { execPrice, gross, fee, total: gross + fee };
}

export function calcNepseSellProceeds(
  shares: number,
  price: number,
  buyTotal: number,
  slippagePct = 0,
  cgtRate = 0.075
): {
  execPrice: number;
  gross: number;
  fee: number;
  cgt: number;
  netReceivable: number;
  netProfit: number;
} {
  if (shares <= 0 || price <= 0) {
    return {
      execPrice: price,
      gross: 0,
      fee: 0,
      cgt: 0,
      netReceivable: 0,
      netProfit: 0,
    };
  }
  const execPrice = Math.max(0.01, price * (1 - Math.max(0, slippagePct) / 100));
  const gross = shares * execPrice;
  const fee = calcNepseBrokerFee(gross) + gross * 0.00015 + 25;
  const preTax = gross - fee;
  const taxableGain = Math.max(0, preTax - buyTotal);
  const cgt = taxableGain * cgtRate;
  const netReceivable = preTax - cgt;
  return {
    execPrice,
    gross,
    fee,
    cgt,
    netReceivable,
    netProfit: netReceivable - buyTotal,
  };
}

/**
 * Solves exact per-share sell price where netReceivable === targetNetProceeds
 * after SEBON broker slabs, 0.015% SEBON fee, NPR 25 DP, and CGT.
 */
export function solvePriceForNetProceeds(
  shares: number,
  buyTotal: number,
  cgtRate: number,
  targetNetProceeds: number
): number {
  if (shares <= 0 || buyTotal <= 0) return 0;
  let lo = 0.01;
  let hi = (targetNetProceeds / shares) * 1.25 + 100;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const net = calcNepseSellProceeds(shares, mid, buyTotal, 0, cgtRate).netReceivable;
    if (net < targetNetProceeds) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
