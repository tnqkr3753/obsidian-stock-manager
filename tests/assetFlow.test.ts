import { describe, expect, it } from "vitest";
import { buildAssetFlow } from "../src/domain/assetFlow";
import type { Trade } from "../src/domain/types";

const t = (partial: Partial<Trade>): Trade => ({
  date: "2026-07-01",
  action: "deposit",
  currency: "KRW",
  ...partial,
});

describe("buildAssetFlow", () => {
  const snapshots = [
    { date: "2026-07-01", totalAssets: 1_000_000 },
    { date: "2026-07-10", totalAssets: 1_150_000 },
    { date: "2026-07-20", totalAssets: 1_400_000 },
  ];
  const trades: Trade[] = [
    t({ date: "2026-06-01", amount: 1_000_000 }),
    t({ date: "2026-07-15", amount: 300_000 }),
    t({ date: "2026-07-25", action: "withdraw", amount: 100_000 }), // 창 밖(마지막 스냅샷 이후)
    t({ date: "2026-07-05", ticker: "A", action: "buy", qty: 1, price: 10 }), // 매매는 원금 아님
  ];

  it("pairs each snapshot with the cumulative invested principal up to that date", () => {
    const flow = buildAssetFlow(snapshots, trades, {});
    expect(flow.points.map((p) => p.invested)).toEqual([1_000_000, 1_000_000, 1_300_000]);
    expect(flow.points.map((p) => p.assets)).toEqual([1_000_000, 1_150_000, 1_400_000]);
  });

  it("converts foreign-currency deposits with the given fx rates", () => {
    const flow = buildAssetFlow(
      [{ date: "2026-07-10", totalAssets: 500 }, { date: "2026-07-11", totalAssets: 600 }],
      [t({ date: "2026-07-01", amount: 100, currency: "USD" })],
      { USD: 1400 },
    );
    expect(flow.points[0]!.invested).toBe(140_000);
  });

  it("reports the profit versus invested principal at the latest point", () => {
    const flow = buildAssetFlow(snapshots, trades, {});
    expect(flow.latestProfit).toBe(1_400_000 - 1_300_000);
    expect(flow.latestProfitPct).toBeCloseTo(100_000 / 1_300_000);
  });

  it("returns empty for fewer than two snapshots", () => {
    expect(buildAssetFlow([{ date: "2026-07-01", totalAssets: 1 }], trades, {}).points).toEqual([]);
  });

  it("flags missing fx instead of silently converting at rate 1", () => {
    const flow = buildAssetFlow(
      [{ date: "2026-07-10", totalAssets: 500 }, { date: "2026-07-11", totalAssets: 600 }],
      [t({ date: "2026-07-01", amount: 100, currency: "USD" })],
      {},
    );
    expect(flow.fxIncomplete).toBe(true);
  });

  it("omits the profit percentage when there is no positive invested principal", () => {
    const flow = buildAssetFlow(
      [{ date: "2026-07-10", totalAssets: 500 }, { date: "2026-07-11", totalAssets: 600 }],
      [], // opening만으로 시작 — 입금 기록 없음
      {},
    );
    expect(flow.latestProfitPct).toBeUndefined();
    expect(flow.hasInvested).toBe(false);
  });
});
