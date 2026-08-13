export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  title: string;
  origin: string; // 이벤트가 적힌 노트의 이름 (종목명·메모 제목)
}

export interface UpcomingEvent extends CalendarEvent {
  dday: number; // 0 = 오늘
}

const EVENT_PATTERN = /^(\d{4}-\d{2}-\d{2})\s*(.*)$/;

/** frontmatter의 `events: ["YYYY-MM-DD 제목", ...]` 문자열을 이벤트로 변환. 형식이 어긋나면 건너뛴다. */
export function parseEventStrings(
  raw: readonly unknown[],
  origin: string,
): readonly CalendarEvent[] {
  return raw.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const match = entry.trim().match(EVENT_PATTERN);
    if (!match) return [];
    return [{ date: match[1]!, title: match[2]!.trim() || "일정", origin }];
  });
}

const DAY_MS = 86_400_000;

/** 오늘~지평(일) 안의 이벤트를 날짜순으로 D-day와 함께 돌려준다. */
export function upcomingEvents(
  events: readonly CalendarEvent[],
  today: string,
  horizonDays: number,
): readonly UpcomingEvent[] {
  const base = Date.parse(today);
  return events
    .filter((e) => e.date >= today)
    .map((e) => ({ ...e, dday: Math.round((Date.parse(e.date) - base) / DAY_MS) }))
    .filter((e) => e.dday <= horizonDays)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
