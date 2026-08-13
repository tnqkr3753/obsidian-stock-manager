import type { VaultSnapshot } from "../data/repository";
import { computeCashflow, type Cashflow } from "../domain/cashflow";
import { upcomingEvents, type UpcomingEvent } from "../domain/events";
import { computeRebalance } from "../domain/rebalance";
import { replayTrades } from "../domain/replay";
import { computeTagExposure } from "../domain/tags";
import { toLocalDateString } from "../util/date";
import type {
  FxMap,
  MacroMemo,
  PortfolioConfig,
  QuoteMap,
  RebalanceResult,
  StockMeta,
  TagExposure,
  Trade,
  Valuation,
} from "../domain/types";
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
  recentMacros: readonly MacroMemo[];
  watchRows: readonly WatchRow[];
  upcoming: readonly UpcomingEvent[]; // 다가오는 이벤트 (30일)
  cashflow: Cashflow; // 최근 6개월 입출금 + 누적 투입 원금
  todayPnl: number; // 당일 등락 기반 오늘 손익 (KRW)
  config: PortfolioConfig;
  metas: Readonly<Record<string, StockMeta>>;
  tradeCount: number;
  warnings: readonly string[];
  lastUpdated?: number;
}

const RECENT_TRADES = 5;
const RECENT_MACROS = 3;
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

  const recentMacros = [...snapshot.macros]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, RECENT_MACROS);

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

  const allEvents = [
    ...Object.values(snapshot.metas).flatMap((m) => m.events),
    ...snapshot.watches.flatMap((w) => w.events),
    ...snapshot.macros.flatMap((m) => m.events),
  ];

  return {
    upcoming: upcomingEvents(allEvents, today, EVENT_HORIZON_DAYS),
    cashflow: computeCashflow(snapshot.trades, today, CASHFLOW_MONTHS),
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
    recentMacros,
    watchRows,
    todayPnl,
    config: snapshot.config,
    metas: snapshot.metas,
    tradeCount: snapshot.trades.length,
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
