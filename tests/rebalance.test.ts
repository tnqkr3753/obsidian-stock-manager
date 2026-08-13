import { describe, expect, it } from "vitest";
import { computeRebalance } from "../src/domain/rebalance";

describe("computeRebalance", () => {
  it("computes deviation and adjustment amount per asset class", () => {
    const r = computeRebalance({
      allocation: { stock: 0.618, bond: 0.231, cash: 0.151 },
      target: { stock: 0.55, bond: 0.3, cash: 0.15 },
      totalAssets: 48_000_000,
    });
    const stock = r.entries.find((e) => e.assetClass === "stock")!;
    expect(stock.deviation).toBeCloseTo(0.068);
    expect(stock.amount).toBeCloseTo(0.068 * 48_000_000);
    expect(r.needsRebalancing).toBe(true);
  });

  it("stays quiet inside the tolerance band", () => {
    const r = computeRebalance({
      allocation: { stock: 0.555, bond: 0.295, cash: 0.15 },
      target: { stock: 0.55, bond: 0.3, cash: 0.15 },
      totalAssets: 1_000_000,
      tolerance: 0.01,
    });
    expect(r.needsRebalancing).toBe(false);
  });

  it("names the largest overweight class as the headline", () => {
    const r = computeRebalance({
      allocation: { stock: 0.7, bond: 0.1, cash: 0.2 },
      target: { stock: 0.5, bond: 0.3, cash: 0.2 },
      totalAssets: 100,
    });
    expect(r.headline?.assetClass).toBe("stock");
    expect(r.headline?.deviation).toBeCloseTo(0.2);
  });
});
