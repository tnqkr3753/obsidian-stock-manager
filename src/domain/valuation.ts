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

/**
 * 리플레이 결과 + 시세 + 환율 → 기준통화(KRW) 평가.
 * 가격은 시세가 알려준 통화(quote.currency)로 환산한다 — 매매 노트의 currency 누락이 평가를 왜곡하지 않도록.
 * 시세·환율이 없으면 평단으로 대체하고 stale 표시, 누락 환율 통화는 missingFx로 보고한다.
 */
export function valuePortfolio(input: ValuationInput): Valuation {
  const { positions, cash, metas, quotes, fx } = input;
  const missingFx = new Set<string>();
  const rateOrReport = (currency: string): number | undefined => {
    const rate = fxRate(currency, fx);
    if (rate === undefined) missingFx.add(currency);
    return rate;
  };

  const baseRows = positions.map((pos) => {
    const meta = metas[pos.ticker];
    const quote = quotes[pos.ticker];
    const costRate = rateOrReport(pos.currency);
    // 시세가 있으면 가격의 통화는 시세 기준, 없으면 평단(포지션 통화)으로 대체
    const priceRate = quote ? rateOrReport(quote.currency) : costRate;
    const stale = !quote || priceRate === undefined || costRate === undefined;
    const price = quote?.price ?? pos.avgCost;
    const costBasis = pos.costBasis * (costRate ?? 1);
    const marketValue = pos.qty * price * (priceRate ?? 1);
    const unrealizedPnl = marketValue - costBasis;
    return {
      ticker: pos.ticker,
      account: pos.account,
      // 종목 노트가 없으면 시세가 알려준 이름으로 — 티커(005930)가 그대로 보이지 않게
      name: meta?.name ?? quote?.name ?? pos.ticker,
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
      realizedPnl: pos.realizedPnl * (costRate ?? 1),
      dividends: pos.dividends * (costRate ?? 1),
      weight: 0,
      stale,
      path: meta?.path,
    };
  });

  const totalCash = Object.entries(cash).reduce(
    (sum, [currency, amount]) => sum + amount * (rateOrReport(currency) ?? 1),
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
    missingFx: [...missingFx],
  };
}
