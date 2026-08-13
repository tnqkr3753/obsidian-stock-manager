import { describe, expect, it } from "vitest";
import { replayTrades } from "../src/domain/replay";
import type { Trade } from "../src/domain/types";

const t = (partial: Partial<Trade>): Trade => ({
  date: "2026-01-01",
  action: "buy",
  currency: "KRW",
  ...partial,
});

describe("replayTrades", () => {
  it("creates a position from an opening entry", () => {
    const { positions } = replayTrades([
      t({ action: "opening", ticker: "005930", qty: 10, price: 50000 }),
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      ticker: "005930",
      qty: 10,
      avgCost: 50000,
      costBasis: 500000,
    });
  });

  it("averages cost across multiple buys", () => {
    const { positions } = replayTrades([
      t({ ticker: "A", qty: 10, price: 100 }),
      t({ date: "2026-01-02", ticker: "A", qty: 10, price: 200 }),
    ]);
    expect(positions[0]!.qty).toBe(20);
    expect(positions[0]!.avgCost).toBe(150);
  });

  it("realizes profit on sell and keeps average cost unchanged", () => {
    const { positions } = replayTrades([
      t({ ticker: "A", qty: 10, price: 150 }),
      t({ date: "2026-01-02", action: "sell", ticker: "A", qty: 5, price: 180 }),
    ]);
    expect(positions[0]!.qty).toBe(5);
    expect(positions[0]!.avgCost).toBe(150);
    expect(positions[0]!.realizedPnl).toBe(150);
  });

  it("removes fully sold positions from the result", () => {
    const { positions, realized } = replayTrades([
      t({ ticker: "A", qty: 10, price: 100 }),
      t({ date: "2026-01-02", action: "sell", ticker: "A", qty: 10, price: 90 }),
    ]);
    expect(positions).toHaveLength(0);
    expect(realized["A"]).toMatchObject({ realizedPnl: -100 });
  });

  it("replays trades in date order even when input is unsorted", () => {
    const { positions } = replayTrades([
      t({ date: "2026-01-03", action: "sell", ticker: "A", qty: 5, price: 200 }),
      t({ date: "2026-01-01", ticker: "A", qty: 10, price: 100 }),
    ]);
    expect(positions[0]!.qty).toBe(5);
    expect(positions[0]!.realizedPnl).toBe(500);
  });

  it("clamps oversell to zero and records a warning instead of throwing", () => {
    const { positions, warnings } = replayTrades([
      t({ ticker: "A", qty: 5, price: 100 }),
      t({ date: "2026-01-02", action: "sell", ticker: "A", qty: 8, price: 110 }),
    ]);
    expect(positions).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("A");
  });

  it("warns when a sell references a ticker never held", () => {
    const { warnings } = replayTrades([
      t({ action: "sell", ticker: "GHOST", qty: 1, price: 10 }),
    ]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("accumulates dividends per ticker and into cash", () => {
    const { positions, cash } = replayTrades([
      t({ ticker: "A", qty: 10, price: 100 }),
      t({ date: "2026-02-01", action: "dividend", ticker: "A", amount: 41200 }),
    ]);
    expect(positions[0]!.dividends).toBe(41200);
    expect(cash["KRW"]).toBe(-1000 + 41200);
  });

  it("tracks cash per currency: deposits, buys and sells", () => {
    const { cash } = replayTrades([
      t({ action: "deposit", amount: 1_000_000 }),
      t({ date: "2026-01-02", action: "deposit", amount: 500, currency: "USD" }),
      t({ date: "2026-01-03", ticker: "AAPL", qty: 2, price: 180, currency: "USD" }),
      t({ date: "2026-01-04", action: "sell", ticker: "AAPL", qty: 1, price: 200, currency: "USD" }),
      t({ date: "2026-01-05", action: "withdraw", amount: 200_000 }),
    ]);
    expect(cash["KRW"]).toBe(800_000);
    expect(cash["USD"]).toBe(500 - 360 + 200);
  });

  it("keeps trade tags on the realized ledger for retro statistics", () => {
    const { realized } = replayTrades([
      t({ ticker: "A", qty: 10, price: 100 }),
      t({
        date: "2026-01-02",
        action: "sell",
        ticker: "A",
        qty: 10,
        price: 120,
        tags: ["손절"],
      }),
    ]);
    expect(realized["A"]!.realizedPnl).toBe(200);
  });

  it("applies same-date buys before sells regardless of input order", () => {
    const { positions, warnings } = replayTrades([
      t({ date: "2026-01-01", action: "sell", ticker: "A", qty: 5, price: 120 }),
      t({ date: "2026-01-01", action: "buy", ticker: "A", qty: 10, price: 100 }),
    ]);
    expect(warnings).toHaveLength(0);
    expect(positions[0]!.qty).toBe(5);
    expect(positions[0]!.realizedPnl).toBe(100);
  });

  it("credits sell proceeds to the lot currency and warns on currency mismatch", () => {
    const { cash, warnings } = replayTrades([
      t({ ticker: "AAPL", qty: 10, price: 150, currency: "USD" }),
      // 매도 노트에서 currency를 깜빡한 경우 — 기본 KRW로 들어오지만 보유 통화(USD) 기준으로 처리
      t({ date: "2026-01-02", action: "sell", ticker: "AAPL", qty: 10, price: 160 }),
    ]);
    expect(cash["USD"]).toBe(-1500 + 1600);
    expect(cash["KRW"]).toBeUndefined();
    expect(warnings.some((w) => w.includes("통화"))).toBe(true);
  });

  it("warns when buying an existing position in a different currency", () => {
    const { positions, warnings } = replayTrades([
      t({ ticker: "AAPL", qty: 10, price: 150, currency: "USD" }),
      t({ date: "2026-01-02", ticker: "AAPL", qty: 1, price: 200000, currency: "KRW" }),
    ]);
    expect(warnings.some((w) => w.includes("통화"))).toBe(true);
    expect(positions[0]!.currency).toBe("USD");
  });

  it("keeps the realized ledger equal to the sum of sell events per ticker", () => {
    const { realized, sellEvents } = replayTrades([
      t({ ticker: "A", qty: 10, price: 100 }),
      t({ date: "2026-01-02", action: "sell", ticker: "A", qty: 3, price: 120 }),
      t({ date: "2026-01-03", action: "sell", ticker: "A", qty: 7, price: 90 }),
      t({ date: "2026-02-01", action: "dividend", ticker: "A", amount: 500 }),
    ]);
    const eventSum = sellEvents
      .filter((e) => e.ticker === "A")
      .reduce((s, e) => s + e.pnl, 0);
    expect(realized["A"]!.realizedPnl).toBe(eventSum);
    expect(realized["A"]!.dividends).toBe(500);
  });

  it("does not mutate the input array", () => {
    const input = [
      t({ date: "2026-01-02", ticker: "A", qty: 1, price: 1 }),
      t({ date: "2026-01-01", ticker: "B", qty: 1, price: 1 }),
    ];
    const snapshot = JSON.stringify(input);
    replayTrades(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
