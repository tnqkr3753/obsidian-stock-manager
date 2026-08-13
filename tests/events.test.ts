import { describe, expect, it } from "vitest";
import { parseEventStrings, upcomingEvents } from "../src/domain/events";

describe("parseEventStrings", () => {
  it("parses 'YYYY-MM-DD title' strings and skips malformed ones", () => {
    const events = parseEventStrings(["2026-08-20 실적 발표", "언젠가 배당락", "2026-09-01"], "삼성전자");
    expect(events).toEqual([
      { date: "2026-08-20", title: "실적 발표", origin: "삼성전자" },
      { date: "2026-09-01", title: "일정", origin: "삼성전자" },
    ]);
  });
});

describe("upcomingEvents", () => {
  const all = [
    { date: "2026-08-12", title: "지난 일정", origin: "A" },
    { date: "2026-08-13", title: "오늘 일정", origin: "A" },
    { date: "2026-08-20", title: "실적", origin: "B" },
    { date: "2026-10-01", title: "너무 먼 일정", origin: "C" },
  ];

  it("keeps events from today up to the horizon, sorted by date, with d-day", () => {
    const upcoming = upcomingEvents(all, "2026-08-13", 30);
    expect(upcoming.map((e) => e.title)).toEqual(["오늘 일정", "실적"]);
    expect(upcoming[0]!.dday).toBe(0);
    expect(upcoming[1]!.dday).toBe(7);
  });

  it("returns empty for no matching events", () => {
    expect(upcomingEvents([], "2026-08-13", 30)).toEqual([]);
  });
});
