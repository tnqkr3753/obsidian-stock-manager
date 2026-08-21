/** AI가 생성한 불변 평가 기록(stock-review) — frontmatter만 도메인으로 올리고 본문은 해석하지 않는다. */
import { noteBasename } from "../util/path";

export const REVIEW_SESSIONS = ["morning", "evening", "weekly", "monthly", "on-demand"] as const;
export type ReviewSession = (typeof REVIEW_SESSIONS)[number];

export const REVIEW_DATA_STATUSES = ["complete", "partial", "failed"] as const;
export type ReviewDataStatus = (typeof REVIEW_DATA_STATUSES)[number];

export const REVIEW_HEALTHS = ["healthy", "watch", "at-risk", "unknown"] as const;
export type ReviewHealth = (typeof REVIEW_HEALTHS)[number];

export const REVIEW_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type ReviewRiskLevel = (typeof REVIEW_RISK_LEVELS)[number];

export const MARKET_REGIMES = ["risk-on", "neutral", "risk-off", "unknown"] as const;
export type MarketRegime = (typeof MARKET_REGIMES)[number];

export const REVIEW_CONFIDENCES = ["low", "medium", "high"] as const;
export type ReviewConfidence = (typeof REVIEW_CONFIDENCES)[number];

export interface StockReview {
  reviewId: string;
  schemaVersion: number;
  session: ReviewSession;
  date: string; // YYYY-MM-DD
  generatedAt?: string; // ISO — 생성 시각
  portfolioAsOf?: string;
  marketAsOf?: string;
  dataStatus?: ReviewDataStatus; // 누락·오기재 시 undefined ("—" 표시)
  health: ReviewHealth; // 누락·오기재 시 "unknown"
  riskLevel?: ReviewRiskLevel;
  marketRegime: MarketRegime; // 누락·오기재 시 "unknown"
  confidence?: ReviewConfidence;
  headline: string;
  supersedes?: string; // 재실행이 대체한 이전 reviewId
  tags: readonly string[];
  path?: string;
}

/** 정렬·대체 여부가 계산된 조회용 행. */
export interface ReviewRow extends StockReview {
  superseded: boolean; // 더 새 재실행(-r2 …)이 이 기록을 대체함
}

/** 파일명 규약 "YYYY-MM-DD HHmm session[-rN]" → canonical reviewId "YYYYMMDD-HHmm-session[-rN]".
 * reviewId frontmatter가 없는 노트도 규약 형식의 supersedes와 연결되게 한다. */
export const canonicalIdFromBasename = (basename: string): string | undefined => {
  const m = basename.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{4}) (\S+)$/);
  return m ? `${m[1]}${m[2]}${m[3]}-${m[4]}-${m[5]}` : undefined;
};

/** generatedAt을 epoch으로 — 오프셋 표기가 달라도(Z vs +09:00) 실제 시각 순서로 비교되게. */
const generatedEpoch = (r: StockReview): number => {
  const t = r.generatedAt !== undefined ? Date.parse(r.generatedAt) : NaN;
  return Number.isFinite(t) ? t : -Infinity; // 누락·파싱 불가는 같은 날짜 안에서 가장 오래된 것으로
};

/** 최신순 정렬 + supersedes 체인으로 대체된 기록 표시. 입력은 변경하지 않는다. */
export function organizeReviews(reviews: readonly StockReview[]): readonly ReviewRow[] {
  const supersededTargets = new Set(
    reviews.map((r) => r.supersedes).filter((id): id is string => id !== undefined),
  );
  // supersedes는 reviewId를 가리키지만, 원본에 reviewId가 없으면 파일명이 id가 되므로
  // basename과 규약상 canonical id까지 함께 본다
  const isSuperseded = (r: StockReview): boolean => {
    if (supersededTargets.has(r.reviewId)) return true;
    if (r.path === undefined) return false;
    const basename = noteBasename(r.path);
    const canonical = canonicalIdFromBasename(basename);
    return supersededTargets.has(basename) || (canonical !== undefined && supersededTargets.has(canonical));
  };

  return [...reviews]
    .sort(
      (a, b) =>
        (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
        generatedEpoch(b) - generatedEpoch(a) ||
        (a.reviewId < b.reviewId ? 1 : -1),
    )
    .map((r) => ({ ...r, superseded: isSuperseded(r) }));
}

/** 해당 날짜의 세션별 최신(대체되지 않은) 리뷰 — "오늘의 리뷰" 카드용. */
export function latestBySession(
  rows: readonly ReviewRow[],
  date: string,
): Partial<Record<ReviewSession, ReviewRow>> {
  const picked: Partial<Record<ReviewSession, ReviewRow>> = {};
  for (const row of rows) {
    // rows는 최신순 — 세션별 첫 항목이 최신
    if (row.date === date && !row.superseded && picked[row.session] === undefined) {
      picked[row.session] = row;
    }
  }
  return picked;
}
