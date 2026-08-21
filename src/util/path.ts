/** "Stocks/Reviews/2026-08/2026-08-21 0800 morning.md" → "2026-08-21 0800 morning".
 * 리뷰↔메모 링크 매칭의 정체성 규칙이므로 반드시 이 헬퍼 하나만 쓴다. */
export const noteBasename = (path: string): string =>
  path.split("/").pop()?.replace(/\.md$/, "") ?? path;
