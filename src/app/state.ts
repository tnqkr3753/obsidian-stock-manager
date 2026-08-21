import type { VaultSnapshot } from "../data/repository";
import { computeAccountBreakdown, type AccountBreakdown } from "../domain/accounts";
import { computeCashflow, type Cashflow } from "../domain/cashflow";
import { upcomingEvents, type UpcomingEvent } from "../domain/events";
import { computeRebalance } from "../domain/rebalance";
import { replayTrades } from "../domain/replay";
import { computeTagExposure } from "../domain/tags";
import { toLocalDateString } from "../util/date";
import type {
  FxMap,
  Memo,
  PortfolioConfig,
  QuoteMap,
  RebalanceResult,
  StockMeta,
  TagExposure,
  Trade,
  Valuation,
} from "../domain/types";
import { organizeReviews, type ReviewRow } from "../domain/review";
import { valuePortfolio } from "../domain/valuation";

/** 워치리스트 한 행 — 시세가 붙고 목표가 도달 여부가 계산된 상태. */
export interface WatchRow {
  ticker: string;
  name: string;
  currency: string; // 노트가 선언한 통화 (목표가 기준)
  priceCurrency: string; // 시세가 알려준 통화 (현재가 표기 기준)
  currencyMismatch: boolean; // 둘이 다르면 목표가 비교 불가
  targetPrice?: number;
  price?: number;
  changePct?: number;
  targetHit: boolean;
  path?: string;
}

export interface PortfolioState {
  valuation: Valuation;
  tagExposure: readonly TagExposure[];
  rebalance: RebalanceResult;
  recentTrades: readonly Trade[];
  trades: readonly Trade[]; // 전체 매매일지 — 리뷰 상세의 "그날의 Trades" 연결에 쓴다
  recentMemos: readonly Memo[];
  memos: readonly Memo[]; // 전체 메모 — 리뷰 상세의 연결 메모 조회에 쓴다
  reviews: readonly ReviewRow[]; // 최신순 + superseded 계산 완료 (stock-review)
  watchRows: readonly WatchRow[];
  upcoming: readonly UpcomingEvent[]; // 다가오는 이벤트 (30일)
  cashflow: Cashflow; // 최근 6개월 입출금 + 누적 투입 원금
  accounts: readonly AccountBreakdown[]; // 계좌별 자산 (ISA·신한 ...)
  names: Readonly<Record<string, string>>; // ticker → 표시 이름 (종목 노트 > 시세 응답)
  totalRealizedPnl: number; // 전 계좌·청산 종목 포함 총 실현손익 (KRW) — 살아있는 행 합계와 다를 수 있다
  todayPnl: number; // 당일 등락 기반 오늘 손익 (KRW)
  config: PortfolioConfig;
  configPath?: string; // stock-config 노트 경로 — 목표 조정 버튼이 이 노트를 연다
  metas: Readonly<Record<string, StockMeta>>;
  tradeCount: number;
  warnings: readonly string[];
  reviewErrors: readonly string[]; // 리뷰 노트 파싱 실패분 — Reviews 뷰에 표시
  lastUpdated?: number;
}

const RECENT_TRADES = 5;
const RECENT_MEMOS = 3;
const EVENT_HORIZON_DAYS = 30;
const CASHFLOW_MONTHS = 6;

/** vault 스냅샷 + 시세 + 환율 → 화면이 쓰는 모든 파생 상태. 순수 함수라 어느 뷰에서든 재사용된다. */
export function computeState(
  snapshot: VaultSnapshot,
  quotes: QuoteMap,
  fx: FxMap,
  tolerancePct: number,
  lastUpdated?: number,
  today: string = toLocalDateString(),
): PortfolioState {
  const replay = replayTrades(snapshot.trades);
  const valuation = valuePortfolio({
    positions: replay.positions,
    cash: replay.cash,
    metas: snapshot.metas,
    quotes,
    fx,
  });

  const todayPnl = valuation.rows.reduce((sum, row) => {
    // changePct가 -100% 이하면 전일가 역산이 0으로 나눗셈이 된다 — 방어적으로 제외
    if (row.changePct === undefined || row.changePct <= -0.999) return sum;
    const prevValue = row.marketValue / (1 + row.changePct);
    return sum + (row.marketValue - prevValue);
  }, 0);

  const recentTrades = [...snapshot.trades]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, RECENT_TRADES);

  const memos = [...snapshot.memos].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recentMemos = memos.slice(0, RECENT_MEMOS);

  const watchRows: WatchRow[] = snapshot.watches.map((w) => {
    const quote = quotes[w.ticker];
    // 목표가는 노트 통화, 시세는 quote 통화 — 다르면 비교 자체가 무의미하므로 배지를 켜지 않는다
    const currencyMismatch = quote !== undefined && quote.currency !== w.currency;
    return {
      ticker: w.ticker,
      name: w.name,
      currency: w.currency,
      priceCurrency: quote?.currency ?? w.currency,
      currencyMismatch,
      targetPrice: w.targetPrice,
      price: quote?.price,
      changePct: quote?.changePct,
      targetHit:
        w.targetPrice !== undefined &&
        quote !== undefined &&
        !currencyMismatch &&
        quote.price <= w.targetPrice,
      path: w.path,
    };
  });

  const names: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(quotes).flatMap(([ticker, quote]) => (quote.name ? [[ticker, quote.name]] : [])),
    ),
    ...Object.fromEntries(Object.values(snapshot.metas).map((m) => [m.ticker, m.name])),
  };

  const allEvents = [
    ...Object.values(snapshot.metas).flatMap((m) => m.events),
    ...snapshot.watches.flatMap((w) => w.events),
    ...snapshot.memos.flatMap((m) => m.events),
  ];

  return {
    upcoming: upcomingEvents(allEvents, today, EVENT_HORIZON_DAYS),
    cashflow: computeCashflow(snapshot.trades, today, CASHFLOW_MONTHS),
    accounts: computeAccountBreakdown({
      rows: valuation.rows,
      cashByAccount: replay.cashByAccount,
      fx,
    }),
    names,
    totalRealizedPnl: replay.sellEvents.reduce(
      (sum, e) => sum + e.pnl * (e.currency === "KRW" ? 1 : fx[e.currency] ?? 1),
      0,
    ),
    valuation,
    tagExposure: computeTagExposure({
      rows: valuation.rows,
      metas: snapshot.metas,
      totalAssets: valuation.totalAssets,
      concentrationLimit: snapshot.config.concentrationLimit,
    }),
    rebalance: computeRebalance({
      allocation: valuation.allocation,
      target: snapshot.config.target,
      totalAssets: valuation.totalAssets,
      tolerance: tolerancePct / 100,
    }),
    recentTrades,
    trades: snapshot.trades,
    recentMemos,
    memos,
    reviews: organizeReviews(snapshot.reviews),
    watchRows,
    todayPnl,
    config: snapshot.config,
    configPath: snapshot.configPath,
    metas: snapshot.metas,
    tradeCount: snapshot.trades.length,
    reviewErrors: snapshot.reviewErrors,
    warnings: [
      ...snapshot.errors,
      ...replay.warnings,
      ...valuation.missingFx.map(
        (c) => `${c} 환율을 가져오지 못해 1로 표시 중입니다 — 해당 금액이 원화로 잘못 보일 수 있어요.`,
      ),
    ],
    lastUpdated,
  };
}
