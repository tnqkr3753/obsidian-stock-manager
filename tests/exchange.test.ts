import { describe, expect, it } from "vitest";
import { parseTradesCsv } from "../src/data/csv";
import { parseTrade } from "../src/data/parse";
import { buildAssetFlow } from "../src/domain/assetFlow";
import { computeCashflow } from "../src/domain/cashflow";
import { computeMonthlyReport } from "../src/domain/report";
import { replayTrades } from "../src/domain/replay";
import type { Trade } from "../src/domain/types";

const t = (partial: Partial<Trade>): Trade => ({
  date: "2026-10-13",
  action: "deposit",
  currency: "KRW",
  ...partial,
});

const exchange = t({
  action: "exchange",
  account: "토스",
  amount: 1_400_000,
  currency: "KRW",
  toAmount: 1000,
  toCurrency: "USD",
});

describe("parseTrade — exchange", () => {
  it("parses source/target currency and amounts", () => {
    const r = parseTrade(
      {
        type: "trade",
        date: "2026-10-13",
        action: "exchange",
        amount: "1,400,000",
        currency: "krw",
        toAmount: 1000,
        toCurrency: "usd",
      },
      "t.md",
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toMatchObject({
      action: "exchange",
      amount: 1_400_000,
      currency: "KRW",
      toAmount: 1000,
      toCurrency: "USD",
    });
  });

  it("rejects exchange without a positive target amount", () => {
    const r = parseTrade(
      { type: "trade", date: "2026-10-13", action: "exchange", amount: 100, toCurrency: "USD" },
      "t.md",
    );
    expect(r.ok).toBe(false);
  });

  it("rejects exchange without a target currency or with the same currency", () => {
    const base = { type: "trade", date: "2026-10-13", action: "exchange", amount: 100, toAmount: 1 };
    expect(parseTrade(base, "t.md").ok).toBe(false);
    expect(parseTrade({ ...base, currency: "USD", toCurrency: "usd" }, "t.md").ok).toBe(false);
  });
});

describe("replayTrades — exchange", () => {
  it("moves cash between currencies inside the same account", () => {
    const { cashByAccount, cash } = replayTrades([
      t({ account: "토스", amount: 2_000_000 }),
      exchange,
    ]);
    expect(cashByAccount["토스"]).toEqual({ KRW: 600_000, USD: 1000 });
    expect(cash).toEqual({ KRW: 600_000, USD: 1000 });
  });

  it("applies a same-day exchange before a same-day buy", () => {
    const { cashByAccount } = replayTrades([
      t({ action: "buy", account: "토스", ticker: "TLT", qty: 10, price: 90, currency: "USD" }),
      exchange,
    ]);
    expect(cashByAccount["토스"]!["USD"]).toBeCloseTo(100);
  });
});

describe("exchange is not an external cash flow", () => {
  it("does not change invested principal", () => {
    const flow = buildAssetFlow(
      [
        { date: "2026-10-02", totalAssets: 2_000_000 },
        { date: "2026-10-14", totalAssets: 2_000_000 },
      ],
      [t({ date: "2026-10-01", amount: 2_000_000 }), exchange],
      { USD: 1500 },
    );
    expect(flow.points[1]!.invested).toBe(2_000_000);
  });

  it("is excluded from monthly net deposits", () => {
    const flow = computeCashflow([t({ amount: 2_000_000 }), exchange], "2026-10-15", 1);
    expect(flow.months[0]!.net).toEqual({ KRW: 2_000_000 });
  });

  it("is excluded from report net deposits", () => {
    const report = computeMonthlyReport({
      month: "2026-10",
      trades: [t({ amount: 2_000_000 }), exchange],
      sellEvents: [],
      snapshots: [],
    });
    expect(report.netDeposits).toEqual({ KRW: 2_000_000 });
  });
});

describe("parseTradesCsv — exchange", () => {
  it("reads toCurrency/toAmount columns case-insensitively", () => {
    const { trades, errors } = parseTradesCsv(
      "date,action,account,currency,amount,toCurrency,toAmount\n2026-10-13,exchange,토스,KRW,1400000,USD,1000",
    );
    expect(errors).toEqual([]);
    expect(trades[0]).toMatchObject({ action: "exchange", toCurrency: "USD", toAmount: 1000 });
  });
});
