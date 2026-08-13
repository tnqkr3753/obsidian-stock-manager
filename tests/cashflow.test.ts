import { describe, expect, it } from "vitest";
import { computeCashflow } from "../src/domain/cashflow";
import type { Trade } from "../src/domain/types";

const t = (partial: Partial<Trade>): Trade => ({
  date: "2026-07-15",
  action: "deposit",
  currency: "KRW",
  ...partial,
});

describe("computeCashflow", () => {
  const trades: Trade[] = [
    t({ date: "2026-05-10", amount: 500_000 }),
    t({ date: "2026-07-01", amount: 1_000_000 }),
    t({ date: "2026-07-20", action: "withdraw", amount: 300_000 }),
    t({ date: "2026-08-05", amount: 200_000 }),
    t({ date: "2026-08-06", amount: 100, currency: "USD" }),
    t({ date: "2026-08-07", ticker: "A", action: "buy", qty: 1, price: 10 }), // 매매는 현금흐름 아님
  ];

  it("aggregates net deposits per month over the window, including empty months", () => {
    const flow = computeCashflow(trades, "2026-08-13", 4);
    expect(flow.months.map((m) => m.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(flow.months[0]!.net["KRW"]).toBe(500_000);
    expect(flow.months[1]!.net["KRW"] ?? 0).toBe(0);
    expect(flow.months[2]!.net["KRW"]).toBe(700_000);
    expect(flow.months[3]!.net["USD"]).toBe(100);
  });

  it("computes cumulative invested principal per currency across all history", () => {
    const flow = computeCashflow(trades, "2026-08-13", 2);
    // 윈도 밖(5월) 입금도 누적 원금에는 포함
    expect(flow.totalInvested["KRW"]).toBe(500_000 + 1_000_000 - 300_000 + 200_000);
    expect(flow.totalInvested["USD"]).toBe(100);
  });
});
