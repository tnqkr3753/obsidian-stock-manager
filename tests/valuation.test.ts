import { describe, expect, it } from "vitest";
import { valuePortfolio } from "../src/domain/valuation";
import type { Position, StockMeta } from "../src/domain/types";

const pos = (partial: Partial<Position>): Position => ({
  ticker: "A",
  qty: 10,
  avgCost: 100,
  costBasis: 1000,
  realizedPnl: 0,
  dividends: 0,
  currency: "KRW",
  ...partial,
});

const meta = (partial: Partial<StockMeta>): StockMeta => ({
  ticker: "A",
  name: "종목A",
  assetClass: "stock",
  currency: "KRW",
  tags: [],
  ...partial,
});

describe("valuePortfolio", () => {
  it("values a KRW position with its quote", () => {
    const v = valuePortfolio({
      positions: [pos({})],
      cash: { KRW: 500 },
      metas: { A: meta({}) },
      quotes: { A: { price: 120, currency: "KRW" } },
      fx: {},
    });
    expect(v.rows[0]).toMatchObject({
      marketValue: 1200,
      unrealizedPnl: 200,
      stale: false,
    });
    expect(v.rows[0]!.returnPct).toBeCloseTo(0.2);
    expect(v.totalAssets).toBe(1700);
  });

  it("converts foreign-currency positions and cash with fx rates", () => {
    const v = valuePortfolio({
      positions: [pos({ ticker: "AAPL", qty: 2, avgCost: 100, costBasis: 200, currency: "USD" })],
      cash: { USD: 10, KRW: 1000 },
      metas: { AAPL: meta({ ticker: "AAPL", currency: "USD" }) },
      quotes: { AAPL: { price: 110, currency: "USD" } },
      fx: { USD: 1400 },
    });
    expect(v.rows[0]!.marketValue).toBe(2 * 110 * 1400);
    expect(v.totalCash).toBe(10 * 1400 + 1000);
  });

  it("falls back to average cost and flags the row when quote is missing", () => {
    const v = valuePortfolio({
      positions: [pos({})],
      cash: {},
      metas: { A: meta({}) },
      quotes: {},
      fx: {},
    });
    expect(v.rows[0]!.marketValue).toBe(1000);
    expect(v.rows[0]!.stale).toBe(true);
  });

  it("converts the price using the quote currency even when the position currency differs", () => {
    // 매매 노트에 currency를 깜빡해 포지션이 KRW로 잡혀도, Yahoo가 USD를 알려주면 시세는 USD로 환산
    const v = valuePortfolio({
      positions: [pos({ ticker: "AAPL", qty: 2, avgCost: 100, costBasis: 200 })],
      cash: {},
      metas: { AAPL: meta({ ticker: "AAPL" }) },
      quotes: { AAPL: { price: 230, currency: "USD" } },
      fx: { USD: 1400 },
    });
    expect(v.rows[0]!.marketValue).toBe(2 * 230 * 1400);
  });

  it("flags rows stale and reports missing fx instead of silently using rate 1", () => {
    const v = valuePortfolio({
      positions: [pos({ ticker: "AAPL", qty: 1, avgCost: 100, costBasis: 100, currency: "USD" })],
      cash: { EUR: 50 },
      metas: {},
      quotes: { AAPL: { price: 110, currency: "USD" } },
      fx: {},
    });
    expect(v.rows[0]!.stale).toBe(true);
    expect([...v.missingFx].sort()).toEqual(["EUR", "USD"]);
  });

  it("computes allocation across stock, bond and cash", () => {
    const v = valuePortfolio({
      positions: [
        pos({ ticker: "S", costBasis: 600, qty: 6, avgCost: 100 }),
        pos({ ticker: "B", costBasis: 300, qty: 3, avgCost: 100 }),
      ],
      cash: { KRW: 100 },
      metas: {
        S: meta({ ticker: "S" }),
        B: meta({ ticker: "B", assetClass: "bond" }),
      },
      quotes: { S: { price: 100, currency: "KRW" }, B: { price: 100, currency: "KRW" } },
      fx: {},
    });
    expect(v.allocation.stock).toBeCloseTo(0.6);
    expect(v.allocation.bond).toBeCloseTo(0.3);
    expect(v.allocation.cash).toBeCloseTo(0.1);
  });

  it("treats tickers without meta as stocks and computes weights", () => {
    const v = valuePortfolio({
      positions: [pos({ ticker: "X" })],
      cash: {},
      metas: {},
      quotes: { X: { price: 100, currency: "KRW" } },
      fx: {},
    });
    expect(v.allocation.stock).toBe(1);
    expect(v.rows[0]!.weight).toBe(1);
  });

  it("sorts rows by market value descending", () => {
    const v = valuePortfolio({
      positions: [
        pos({ ticker: "SMALL", qty: 1, avgCost: 10, costBasis: 10 }),
        pos({ ticker: "BIG", qty: 100, avgCost: 10, costBasis: 1000 }),
      ],
      cash: {},
      metas: {},
      quotes: {
        SMALL: { price: 10, currency: "KRW" },
        BIG: { price: 10, currency: "KRW" },
      },
      fx: {},
    });
    expect(v.rows.map((r) => r.ticker)).toEqual(["BIG", "SMALL"]);
  });
});
