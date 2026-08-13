import { describe, expect, it } from "vitest";
import { computeTagExposure } from "../src/domain/tags";
import type { HoldingRow, StockMeta } from "../src/domain/types";

const row = (ticker: string, marketValue: number): HoldingRow =>
  ({
    ticker,
    name: ticker,
    qty: 1,
    avgCost: 1,
    costBasis: 1,
    currency: "KRW",
    price: 1,
    marketValue,
    unrealizedPnl: 0,
    returnPct: 0,
    realizedPnl: 0,
    dividends: 0,
    weight: 0,
    assetClass: "stock",
    stale: false,
  }) as HoldingRow;

const meta = (ticker: string, tags: string[]): StockMeta => ({
  ticker,
  name: ticker,
  assetClass: "stock",
  currency: "KRW",
  tags,
});

describe("computeTagExposure", () => {
  it("aggregates overlapping tags against total assets", () => {
    const exposure = computeTagExposure({
      rows: [row("A", 600), row("B", 400)],
      metas: { A: meta("A", ["반도체", "대형주"]), B: meta("B", ["대형주"]) },
      totalAssets: 2000,
      concentrationLimit: 0.4,
    });
    const big = exposure.find((e) => e.tag === "대형주")!;
    expect(big.value).toBe(1000);
    expect(big.ratio).toBeCloseTo(0.5);
  });

  it("sorts by exposure descending and flags concentration above the limit", () => {
    const exposure = computeTagExposure({
      rows: [row("A", 900), row("B", 100)],
      metas: { A: meta("A", ["집중태그"]), B: meta("B", ["소수태그"]) },
      totalAssets: 1000,
      concentrationLimit: 0.4,
    });
    expect(exposure[0]!.tag).toBe("집중태그");
    expect(exposure[0]!.concentrated).toBe(true);
    expect(exposure[1]!.concentrated).toBe(false);
  });

  it("returns empty for holdings without tagged metas", () => {
    expect(
      computeTagExposure({ rows: [row("A", 100)], metas: {}, totalAssets: 100, concentrationLimit: 0.4 }),
    ).toEqual([]);
  });

  it("ignores tags on tickers not currently held", () => {
    const exposure = computeTagExposure({
      rows: [row("A", 100)],
      metas: { A: meta("A", ["보유"]), GHOST: meta("GHOST", ["미보유"]) },
      totalAssets: 100,
      concentrationLimit: 0.4,
    });
    expect(exposure.map((e) => e.tag)).toEqual(["보유"]);
  });
});
