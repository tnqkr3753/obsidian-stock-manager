import type {
  Allocation,
  FxMap,
  HoldingRow,
  Position,
  QuoteMap,
  StockMeta,
  Valuation,
} from "./types";

export interface ValuationInput {
  positions: readonly Position[];
  cash: Readonly<Record<string, number>>;
  metas: Readonly<Record<string, StockMeta>>;
  quotes: QuoteMap;
  fx: FxMap;
}

const fxRate = (currency: string, fx: FxMap): number | undefined =>
  currency === "KRW" ? 1 : fx[currency];

/** 리플레이 결과 + 시세 + 환율 → 기준통화(KRW) 평가. 시세·환율이 없으면 평단으로 대체하고 stale 표시. */
export function valuePortfolio(input: ValuationInput): Valuation {
  const { positions, cash, metas, quotes, fx } = input;

  const baseRows = positions.map((pos) => {
    const meta = metas[pos.ticker];
    const quote = quotes[pos.ticker];
    const rate = fxRate(pos.currency, fx);
    const stale = !quote || rate === undefined;
    const price = quote?.price ?? pos.avgCost;
    const effectiveRate = rate ?? 1;
    const costBasis = pos.costBasis * effectiveRate;
    const marketValue = pos.qty * price * effectiveRate;
    const unrealizedPnl = marketValue - costBasis;
    return {
      ticker: pos.ticker,
      name: meta?.name ?? pos.ticker,
      assetClass: meta?.assetClass ?? "stock",
      currency: pos.currency,
      qty: pos.qty,
      avgCost: pos.avgCost,
      price,
      changePct: quote?.changePct,
      costBasis,
      marketValue,
      unrealizedPnl,
      returnPct: costBasis === 0 ? 0 : unrealizedPnl / costBasis,
      realizedPnl: pos.realizedPnl * effectiveRate,
      dividends: pos.dividends * effectiveRate,
      weight: 0,
      stale,
      path: meta?.path,
    };
  });

  const totalCash = Object.entries(cash).reduce(
    (sum, [currency, amount]) => sum + amount * (fxRate(currency, fx) ?? 1),
    0,
  );
  const totalMarketValue = baseRows.reduce((sum, row) => sum + row.marketValue, 0);
  const totalCostBasis = baseRows.reduce((sum, row) => sum + row.costBasis, 0);
  const totalAssets = totalMarketValue + totalCash;

  const rows: HoldingRow[] = baseRows
    .map((row) => ({
      ...row,
      weight: totalAssets > 0 ? row.marketValue / totalAssets : 0,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  const sumByClass = (assetClass: "stock" | "bond"): number =>
    rows.filter((row) => row.assetClass === assetClass).reduce((s, r) => s + r.marketValue, 0);

  const allocation: Allocation =
    totalAssets > 0
      ? {
          stock: sumByClass("stock") / totalAssets,
          bond: sumByClass("bond") / totalAssets,
          cash: totalCash / totalAssets,
        }
      : { stock: 0, bond: 0, cash: 0 };

  return {
    rows,
    totalAssets,
    totalCash,
    totalMarketValue,
    totalCostBasis,
    totalUnrealizedPnl: totalMarketValue - totalCostBasis,
    allocation,
  };
}
