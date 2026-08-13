import { describe, expect, it } from "vitest";
import { replayTrades } from "../src/domain/replay";
import { buildMonthlyReportMarkdown, computeMonthlyReport } from "../src/domain/report";
import type { Trade } from "../src/domain/types";

const t = (partial: Partial<Trade>): Trade => ({
  date: "2026-07-15",
  action: "buy",
  currency: "KRW",
  ...partial,
});

const TRADES: Trade[] = [
  t({ date: "2026-06-20", ticker: "A", qty: 20, price: 100 }), // 전월 매수 (집계 제외)
  t({ date: "2026-07-02", ticker: "A", qty: 10, price: 120 }),
  t({ date: "2026-07-10", action: "sell", ticker: "A", qty: 10, price: 150, tags: ["원칙매도"] }),
  t({ date: "2026-07-18", action: "dividend", ticker: "A", amount: 5000 }),
  t({ date: "2026-07-20", action: "deposit", amount: 1_000_000 }),
  t({ date: "2026-08-01", action: "sell", ticker: "A", qty: 5, price: 90 }), // 익월 (제외)
];

describe("computeMonthlyReport", () => {
  const replay = replayTrades(TRADES);

  it("counts only trades inside the month", () => {
    const r = computeMonthlyReport({
      trades: TRADES,
      sellEvents: replay.sellEvents,
      snapshots: [],
      month: "2026-07",
    });
    expect(r.tradeCounts).toMatchObject({ buy: 1, sell: 1, dividend: 1, deposit: 1, withdraw: 0 });
  });

  it("attributes realized pnl and dividends to the month per currency", () => {
    const r = computeMonthlyReport({
      trades: TRADES,
      sellEvents: replay.sellEvents,
      snapshots: [],
      month: "2026-07",
    });
    // 7/10 매도: 평단 (20*100+10*120)/30 = 106.67 → (150-106.67)*10 = 433.33
    expect(r.realizedPnl["KRW"]).toBeCloseTo((150 - 320 / 3) * 10, 5);
    expect(r.dividends["KRW"]).toBe(5000);
  });

  it("aggregates retro tag stats with per-tag realized pnl", () => {
    const r = computeMonthlyReport({
      trades: TRADES,
      sellEvents: replay.sellEvents,
      snapshots: [],
      month: "2026-07",
    });
    const tag = r.retroTags.find((x) => x.tag === "원칙매도")!;
    expect(tag.count).toBe(1);
    expect(tag.pnl["KRW"]).toBeCloseTo((150 - 320 / 3) * 10, 5);
  });

  it("takes start and end assets from snapshots inside the month", () => {
    const r = computeMonthlyReport({
      trades: [],
      sellEvents: [],
      snapshots: [
        { date: "2026-06-30", totalAssets: 100 },
        { date: "2026-07-01", totalAssets: 110 },
        { date: "2026-07-31", totalAssets: 130 },
        { date: "2026-08-01", totalAssets: 140 },
      ],
      month: "2026-07",
    });
    expect(r.startAssets).toBe(110);
    expect(r.endAssets).toBe(130);
  });

  it("leaves assets undefined when the month has no snapshots", () => {
    const r = computeMonthlyReport({ trades: [], sellEvents: [], snapshots: [], month: "2026-07" });
    expect(r.startAssets).toBeUndefined();
  });
});

describe("replayTrades sell events", () => {
  it("emits one event per sell with pnl, currency and retro tags", () => {
    const { sellEvents } = replayTrades([
      t({ date: "2026-01-01", ticker: "B", qty: 10, price: 100, currency: "USD" }),
      t({
        date: "2026-01-05",
        action: "sell",
        ticker: "B",
        qty: 4,
        price: 130,
        currency: "USD",
        tags: ["익절"],
      }),
    ]);
    expect(sellEvents).toHaveLength(1);
    expect(sellEvents[0]).toMatchObject({
      date: "2026-01-05",
      ticker: "B",
      qty: 4,
      pnl: 120,
      currency: "USD",
      tags: ["익절"],
    });
  });
});

describe("buildMonthlyReportMarkdown", () => {
  it("renders a report note with frontmatter and key figures", () => {
    const replay = replayTrades(TRADES);
    const md = buildMonthlyReportMarkdown(
      computeMonthlyReport({
        trades: TRADES,
        sellEvents: replay.sellEvents,
        snapshots: [
          { date: "2026-07-01", totalAssets: 1000 },
          { date: "2026-07-31", totalAssets: 1200 },
        ],
        month: "2026-07",
      }),
    );
    expect(md).toContain("type: stock-report");
    expect(md).toContain("2026-07");
    expect(md).toContain("원칙매도");
    expect(md).toContain("+20.0%"); // 1000 → 1200
  });
});
