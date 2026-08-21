import { describe, expect, it } from "vitest";
import { latestBySession, organizeReviews } from "../src/domain/review";
import type { StockReview } from "../src/domain/review";

const review = (over: Partial<StockReview>): StockReview => ({
  reviewId: "20260821-0800-morning",
  schemaVersion: 1,
  session: "morning",
  date: "2026-08-21",
  health: "watch",
  marketRegime: "risk-off",
  headline: "방어적 관찰",
  tags: [],
  ...over,
});

describe("organizeReviews", () => {
  it("sorts newest first by date, then generatedAt", () => {
    const rows = organizeReviews([
      review({ reviewId: "a", date: "2026-08-20" }),
      review({ reviewId: "b", date: "2026-08-21", generatedAt: "2026-08-21T08:00:00+09:00" }),
      review({ reviewId: "c", date: "2026-08-21", generatedAt: "2026-08-21T18:00:00+09:00", session: "evening" }),
    ]);
    expect(rows.map((r) => r.reviewId)).toEqual(["c", "b", "a"]);
  });

  it("marks a review superseded when another review's supersedes points at it", () => {
    const rows = organizeReviews([
      review({ reviewId: "20260821-0800-morning" }),
      review({
        reviewId: "20260821-0800-morning-r2",
        supersedes: "20260821-0800-morning",
        generatedAt: "2026-08-21T09:00:00+09:00",
      }),
    ]);
    const original = rows.find((r) => r.reviewId === "20260821-0800-morning");
    const rerun = rows.find((r) => r.reviewId === "20260821-0800-morning-r2");
    expect(original?.superseded).toBe(true);
    expect(rerun?.superseded).toBe(false);
  });

  it("orders mixed-offset generatedAt timestamps by actual time, not lexicographically", () => {
    const rows = organizeReviews([
      // 00:30Z = 09:30 KST — 사전식으로는 "+09:00"보다 앞서지만 실제로는 더 최신
      review({ reviewId: "utc", generatedAt: "2026-08-21T00:30:00Z" }),
      review({ reviewId: "kst", generatedAt: "2026-08-21T09:00:00+09:00" }),
    ]);
    expect(rows.map((r) => r.reviewId)).toEqual(["utc", "kst"]);
  });

  it("marks a review superseded when supersedes points at its file basename (no reviewId frontmatter)", () => {
    const rows = organizeReviews([
      review({
        reviewId: "2026-08-21 0800 morning", // reviewId 누락 → 파서가 basename으로 폴백한 경우
        path: "Stocks/Reviews/2026-08/2026-08-21 0800 morning.md",
      }),
      review({
        reviewId: "20260821-0800-morning-r2",
        supersedes: "2026-08-21 0800 morning",
        generatedAt: "2026-08-21T09:00:00+09:00",
      }),
    ]);
    expect(rows.find((r) => r.reviewId === "2026-08-21 0800 morning")?.superseded).toBe(true);
  });

  it("links a canonical-form supersedes to a note whose id fell back to its basename", () => {
    const rows = organizeReviews([
      review({
        reviewId: "2026-08-21 0800 morning", // reviewId 누락 → basename 폴백
        path: "Stocks/Reviews/2026-08/2026-08-21 0800 morning.md",
      }),
      review({
        reviewId: "20260821-0800-morning-r2",
        supersedes: "20260821-0800-morning", // README 규약의 canonical id 형식
        generatedAt: "2026-08-21T09:00:00+09:00",
      }),
    ]);
    expect(rows.find((r) => r.reviewId === "2026-08-21 0800 morning")?.superseded).toBe(true);
  });

  it("does not mutate the input array", () => {
    const input = [review({ reviewId: "a", date: "2026-08-20" }), review({ reviewId: "b" })];
    const before = input.map((r) => r.reviewId);
    organizeReviews(input);
    expect(input.map((r) => r.reviewId)).toEqual(before);
  });
});

describe("latestBySession", () => {
  it("returns the newest non-superseded review per session for the given date", () => {
    const rows = organizeReviews([
      review({ reviewId: "m1" }),
      review({ reviewId: "m2", supersedes: "m1", generatedAt: "2026-08-21T09:00:00+09:00" }),
      review({ reviewId: "e1", session: "evening", generatedAt: "2026-08-21T18:00:00+09:00" }),
      review({ reviewId: "old", date: "2026-08-20" }),
    ]);
    const picked = latestBySession(rows, "2026-08-21");
    expect(picked["morning"]?.reviewId).toBe("m2");
    expect(picked["evening"]?.reviewId).toBe("e1");
    expect(picked["weekly"]).toBeUndefined();
  });

  it("returns an empty record when no review matches the date", () => {
    const rows = organizeReviews([review({ date: "2026-08-20" })]);
    expect(latestBySession(rows, "2026-08-21")).toEqual({});
  });
});
