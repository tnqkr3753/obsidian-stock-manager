import { describe, expect, it } from "vitest";
import { parseConfig, parseStockMeta, parseTrade } from "../src/data/parse";

describe("parseTrade", () => {
  it("parses a valid buy frontmatter into a Trade", () => {
    const r = parseTrade(
      { type: "trade", date: "2026-08-12", action: "buy", ticker: "005930", qty: 10, price: 71000 },
      "trades/2026-08-12-buy.md",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        date: "2026-08-12",
        action: "buy",
        ticker: "005930",
        qty: 10,
        price: 71000,
        currency: "KRW",
        path: "trades/2026-08-12-buy.md",
      });
    }
  });

  it("normalizes a Date frontmatter value to YYYY-MM-DD", () => {
    const r = parseTrade(
      { type: "trade", date: new Date("2026-08-12T09:00:00Z"), action: "deposit", amount: 1000 },
      "t.md",
    );
    expect(r.ok && r.value.date).toBe("2026-08-12");
  });

  it("rejects notes of a different type", () => {
    expect(parseTrade({ type: "stock" }, "s.md").ok).toBe(false);
  });

  it("rejects buy/sell without positive qty and price", () => {
    expect(
      parseTrade({ type: "trade", date: "2026-01-01", action: "buy", ticker: "A", qty: -1, price: 10 }, "t.md").ok,
    ).toBe(false);
    expect(
      parseTrade({ type: "trade", date: "2026-01-01", action: "sell", ticker: "A", qty: 1 }, "t.md").ok,
    ).toBe(false);
  });

  it("rejects dividend/deposit/withdraw without a positive amount", () => {
    expect(
      parseTrade({ type: "trade", date: "2026-01-01", action: "dividend", ticker: "A" }, "t.md").ok,
    ).toBe(false);
  });

  it("rejects unknown actions and invalid dates with a reason", () => {
    const r1 = parseTrade({ type: "trade", date: "2026-01-01", action: "short" }, "t.md");
    const r2 = parseTrade({ type: "trade", date: "언젠가", action: "deposit", amount: 1 }, "t.md");
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain("action");
  });

  it("accepts retro tags with or without leading #", () => {
    const r = parseTrade(
      { type: "trade", date: "2026-01-01", action: "sell", ticker: "A", qty: 1, price: 10, tags: ["#손절", "뇌동매매"] },
      "t.md",
    );
    expect(r.ok && r.value.tags).toEqual(["손절", "뇌동매매"]);
  });
});

describe("parseStockMeta", () => {
  it("parses a stock note with defaults", () => {
    const r = parseStockMeta({ type: "stock", ticker: "005930", name: "삼성전자", tags: ["반도체"] }, "s.md");
    expect(r.ok && r.value).toMatchObject({
      ticker: "005930",
      name: "삼성전자",
      assetClass: "stock",
      currency: "KRW",
      tags: ["반도체"],
    });
  });

  it("accepts bond asset class and foreign currency", () => {
    const r = parseStockMeta(
      { type: "stock", ticker: "KOSEF10Y", name: "국고채", assetClass: "bond", currency: "USD" },
      "s.md",
    );
    expect(r.ok && r.value.assetClass).toBe("bond");
  });

  it("rejects a stock note without ticker", () => {
    expect(parseStockMeta({ type: "stock", name: "이름만" }, "s.md").ok).toBe(false);
  });
});

describe("parseConfig", () => {
  it("parses target allocation given in percent", () => {
    const r = parseConfig({ type: "stock-config", target: { stock: 55, bond: 30, cash: 15 }, concentrationLimit: 40 });
    expect(r.ok && r.value.target.stock).toBeCloseTo(0.55);
    expect(r.ok && r.value.concentrationLimit).toBeCloseTo(0.4);
  });

  it("falls back to defaults when fields are missing", () => {
    const r = parseConfig({ type: "stock-config" });
    expect(r.ok && r.value.target).toEqual({ stock: 0.6, bond: 0.2, cash: 0.2 });
  });

  it("normalizes a target whose parts do not sum to 100%", () => {
    const r = parseConfig({ type: "stock-config", target: { stock: 50, bond: 30, cash: 10 } });
    expect(r.ok && r.value.target.stock).toBeCloseTo(50 / 90);
    expect(r.ok && r.value.target.bond).toBeCloseTo(30 / 90);
  });
});
