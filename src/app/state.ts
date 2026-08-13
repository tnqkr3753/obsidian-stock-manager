import type { VaultSnapshot } from "../data/repository";
import { computeRebalance } from "../domain/rebalance";
import { replayTrades } from "../domain/replay";
import { computeTagExposure } from "../domain/tags";
import type {
  FxMap,
  PortfolioConfig,
  QuoteMap,
  RebalanceResult,
  StockMeta,
  TagExposure,
  Trade,
  Valuation,
} from "../domain/types";
import { valuePortfolio } from "../domain/valuation";

export interface PortfolioState {
  valuation: Valuation;
  tagExposure: readonly TagExposure[];
  rebalance: RebalanceResult;
  recentTrades: readonly Trade[];
  todayPnl: number; // 당일 등락 기반 오늘 손익 (KRW)
  config: PortfolioConfig;
  metas: Readonly<Record<string, StockMeta>>;
  tradeCount: number;
  warnings: readonly string[];
  lastUpdated?: number;
}

const RECENT_TRADES = 5;

/** vault 스냅샷 + 시세 + 환율 → 화면이 쓰는 모든 파생 상태. 순수 함수라 어느 뷰에서든 재사용된다. */
export function computeState(
  snapshot: VaultSnapshot,
  quotes: QuoteMap,
  fx: FxMap,
  tolerancePct: number,
  lastUpdated?: number,
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

  return {
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
