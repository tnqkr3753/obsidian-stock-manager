import { describe, expect, it } from "vitest";
import { buildOverlay } from "../src/domain/benchmark";

const mine = [
  { date: "2026-07-01", totalAssets: 1000 },
  { date: "2026-07-10", totalAssets: 1100 },
  { date: "2026-07-20", totalAssets: 1050 },
];

const kospi = [
  { date: "2026-06-25", close: 2500 }, // 내 구간 시작 전 데이터는 잘림
  { date: "2026-07-01", close: 2600 },
  { date: "2026-07-10", close: 2730 },
  { date: "2026-07-20", close: 2470 },
];

describe("buildOverlay", () => {
  it("indexes every series to 100 at its first point inside my date window", () => {
    const overlay = buildOverlay(mine, [{ label: "KOSPI", series: kospi }]);
    const my = overlay.find((s) => s.label === "내 자산")!;
    const bench = overlay.find((s) => s.label === "KOSPI")!;

    expect(my.points[0]).toEqual({ date: "2026-07-01", index: 100 });
    expect(my.points[1]!.index).toBeCloseTo(110);
    expect(bench.points[0]).toEqual({ date: "2026-07-01", index: 100 });
    expect(bench.points[1]!.index).toBeCloseTo((2730 / 2600) * 100);
  });

  it("clips benchmark points outside my snapshot window", () => {
    const overlay = buildOverlay(mine, [{ label: "KOSPI", series: kospi }]);
    const bench = overlay.find((s) => s.label === "KOSPI")!;
    expect(bench.points.every((p) => p.date >= "2026-07-01")).toBe(true);
  });

  it("omits benchmarks with fewer than two points in the window", () => {
    const overlay = buildOverlay(mine, [
      { label: "빈지수", series: [{ date: "2026-07-05", close: 10 }] },
    ]);
    expect(overlay.map((s) => s.label)).toEqual(["내 자산"]);
  });

  it("returns empty when my snapshots cannot form a line", () => {
    expect(buildOverlay([{ date: "2026-07-01", totalAssets: 1 }], [])).toEqual([]);
  });

  it("returns empty instead of an empty-point series when the first snapshot is zero", () => {
    const zeroFirst = [
      { date: "2026-07-01", totalAssets: 0 },
      { date: "2026-07-10", totalAssets: 100 },
    ];
    expect(buildOverlay(zeroFirst, [{ label: "KOSPI", series: kospi }])).toEqual([]);
  });
});
