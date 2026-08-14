import { describe, expect, it } from "vitest";
import { computeAccountBreakdown } from "../src/domain/accounts";
import type { HoldingRow } from "../src/domain/types";

const row = (account: string, marketValue: number): HoldingRow =>
  ({ account, marketValue }) as HoldingRow;

describe("computeAccountBreakdown", () => {
  it("aggregates holdings and cash per account in base currency", () => {
    const breakdown = computeAccountBreakdown({
      rows: [row("ISA", 3_000_000), row("ISA", 1_000_000), row("신한", 2_000_000)],
      cashByAccount: { ISA: { KRW: 500_000 }, 연금: { USD: 100 } },
      fx: { USD: 1400 },
    });
    const isa = breakdown.find((a) => a.account === "ISA")!;
    expect(isa.holdingsValue).toBe(4_000_000);
    expect(isa.cashValue).toBe(500_000);
    expect(isa.totalValue).toBe(4_500_000);
    expect(breakdown.find((a) => a.account === "연금")!.cashValue).toBe(140_000);
  });

  it("sorts accounts by total value descending and computes weights", () => {
    const breakdown = computeAccountBreakdown({
      rows: [row("작은", 100), row("큰", 900)],
      cashByAccount: {},
      fx: {},
    });
    expect(breakdown.map((a) => a.account)).toEqual(["큰", "작은"]);
    expect(breakdown[0]!.weight).toBeCloseTo(0.9);
  });

  it("returns empty for no data", () => {
    expect(computeAccountBreakdown({ rows: [], cashByAccount: {}, fx: {} })).toEqual([]);
  });
});
