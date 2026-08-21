import { describe, expect, it } from "vitest";
import {
  parseConfig,
  parseMemo,
  parseReview,
  parseStockMeta,
  parseTrade,
  parseWatch,
} from "../src/data/parse";

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

  it("passes the account through, trims it, and stringifies numeric accounts", () => {
    const r1 = parseTrade(
      { type: "trade", date: "2026-01-01", action: "buy", ticker: "A", qty: 1, price: 10, account: " ISA " },
      "t.md",
    );
    const r2 = parseTrade(
      { type: "trade", date: "2026-01-01", action: "deposit", amount: 1, account: 123 },
      "t.md",
    );
    expect(r1.ok && r1.value.account).toBe("ISA");
    expect(r2.ok && r2.value.account).toBe("123");
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

  it("parses events from a stock note with the note name as origin", () => {
    const r = parseStockMeta(
      { type: "stock", ticker: "005930", name: "삼성전자", events: ["2026-08-20 실적 발표"] },
      "s.md",
    );
    expect(r.ok && r.value.events).toEqual([
      { date: "2026-08-20", title: "실적 발표", origin: "삼성전자" },
    ]);
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

describe("parseMemo", () => {
  it("parses a memo note with scope and tags", () => {
    const r = parseMemo(
      { type: "memo", date: "2026-08-21", scope: "portfolio", tags: ["리뷰후속"] },
      "Stocks/Memos/2026-08-21 리뷰 후속.md",
    );
    expect(r.ok && r.value).toMatchObject({
      date: "2026-08-21",
      title: "2026-08-21 리뷰 후속",
      scope: "portfolio",
      tags: ["리뷰후속"],
    });
  });

  it("still reads legacy macro notes as market-scope memos", () => {
    const r = parseMemo(
      { type: "macro", date: "2026-08-10", tags: ["#금리", "반도체사이클"] },
      "Stocks/Macro/2026-08-10 FOMC.md",
    );
    expect(r.ok && r.value).toMatchObject({
      date: "2026-08-10",
      title: "2026-08-10 FOMC",
      scope: "market",
      tags: ["금리", "반도체사이클"],
    });
  });

  it("requires a ticker when scope is stock", () => {
    expect(parseMemo({ type: "memo", date: "2026-08-21", scope: "stock" }, "m.md").ok).toBe(false);
    const r = parseMemo(
      { type: "memo", date: "2026-08-21", scope: "stock", ticker: "005930" },
      "m.md",
    );
    expect(r.ok && r.value.ticker).toBe("005930");
  });

  it("unwraps a wikilinked relatedReview to the note name", () => {
    const r = parseMemo(
      {
        type: "memo",
        date: "2026-08-21",
        scope: "portfolio",
        relatedReview: "[[2026-08-21 1800 evening]]",
      },
      "m.md",
    );
    expect(r.ok && r.value.relatedReview).toBe("2026-08-21 1800 evening");
  });

  it("defaults an unknown scope to market", () => {
    const r = parseMemo({ type: "memo", date: "2026-08-21", scope: "잘못됨" }, "m.md");
    expect(r.ok && r.value.scope).toBe("market");
  });

  it("rejects a memo note without a date", () => {
    expect(parseMemo({ type: "memo" }, "m.md").ok).toBe(false);
  });
});

describe("parseReview", () => {
  const base = {
    type: "stock-review",
    schemaVersion: 1,
    reviewId: "20260821-0800-morning",
    session: "morning",
    date: "2026-08-21",
    generatedAt: "2026-08-21T08:00:00+09:00",
    portfolioAsOf: "2026-08-21T07:55:00+09:00",
    marketAsOf: "2026-08-21T07:50:00+09:00",
    dataStatus: "complete",
    health: "watch",
    riskLevel: "high",
    marketRegime: "risk-off",
    confidence: "medium",
    headline: "시장 약세와 특정 종목 집중 위험으로 방어적 관찰이 필요함",
    tags: ["daily-review", "morning"],
  };

  it("parses a full schemaVersion 1 review frontmatter", () => {
    const r = parseReview(base, "Stocks/Reviews/2026-08/2026-08-21 0800 morning.md");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        reviewId: "20260821-0800-morning",
        session: "morning",
        date: "2026-08-21",
        dataStatus: "complete",
        health: "watch",
        riskLevel: "high",
        marketRegime: "risk-off",
        confidence: "medium",
        headline: "시장 약세와 특정 종목 집중 위험으로 방어적 관찰이 필요함",
        path: "Stocks/Reviews/2026-08/2026-08-21 0800 morning.md",
      });
      expect(r.value.supersedes).toBeUndefined();
    }
  });

  it("keeps the supersedes link for reruns", () => {
    const r = parseReview(
      { ...base, reviewId: "20260821-0800-morning-r2", supersedes: "20260821-0800-morning" },
      "r.md",
    );
    expect(r.ok && r.value.supersedes).toBe("20260821-0800-morning");
  });

  it("falls back to the basename when reviewId is missing", () => {
    const { reviewId: _omit, ...noId } = base;
    const r = parseReview(noId, "Stocks/Reviews/2026-08/2026-08-21 0800 morning.md");
    expect(r.ok && r.value.reviewId).toBe("2026-08-21 0800 morning");
  });

  it("rejects an unknown session and a missing date", () => {
    expect(parseReview({ ...base, session: "midnight" }, "r.md").ok).toBe(false);
    expect(parseReview({ ...base, date: undefined }, "r.md").ok).toBe(false);
  });

  it("degrades invalid enum values instead of dropping the review", () => {
    const r = parseReview(
      { ...base, dataStatus: "great", health: "fine", riskLevel: "extreme", marketRegime: "bull", confidence: "sure" },
      "r.md",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.dataStatus).toBeUndefined();
      expect(r.value.health).toBe("unknown");
      expect(r.value.riskLevel).toBeUndefined();
      expect(r.value.marketRegime).toBe("unknown");
      expect(r.value.confidence).toBeUndefined();
    }
  });

  it("rejects notes of a different type", () => {
    expect(parseReview({ type: "memo" }, "r.md").ok).toBe(false);
  });
});

describe("parseWatch", () => {
  it("parses a watch note with target price", () => {
    const r = parseWatch(
      { type: "watch", ticker: "TSLA", name: "테슬라", targetPrice: 180, currency: "usd" },
      "w.md",
    );
    expect(r.ok && r.value).toMatchObject({
      ticker: "TSLA",
      name: "테슬라",
      targetPrice: 180,
      currency: "USD",
    });
  });

  it("defaults the name to the ticker and rejects missing ticker", () => {
    const r = parseWatch({ type: "watch", ticker: "005930" }, "w.md");
    expect(r.ok && r.value.name).toBe("005930");
    expect(parseWatch({ type: "watch" }, "w.md").ok).toBe(false);
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

  it("collects the buy checklist items", () => {
    const r = parseConfig({ type: "stock-config", checklist: ["원칙 확인", " 손절선 정했나 ", ""] });
    expect(r.ok && r.value.checklist).toEqual(["원칙 확인", "손절선 정했나"]);
  });

  it("normalizes a target whose parts do not sum to 100%", () => {
    const r = parseConfig({ type: "stock-config", target: { stock: 50, bond: 30, cash: 10 } });
    expect(r.ok && r.value.target.stock).toBeCloseTo(50 / 90);
    expect(r.ok && r.value.target.bond).toBeCloseTo(30 / 90);
  });
});
