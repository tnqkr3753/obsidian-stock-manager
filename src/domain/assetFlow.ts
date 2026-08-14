import type { FxMap, Trade } from "./types";

export interface AssetFlowPoint {
  date: string;
  assets: number; // 총자산 (KRW)
  invested: number; // 그 날짜까지의 누적 투입 원금 (KRW, 현재 환율 환산)
}

export interface AssetFlow {
  points: readonly AssetFlowPoint[];
  latestProfit: number; // 최신 시점 자산 - 원금
  latestProfitPct: number;
}

const EMPTY: AssetFlow = { points: [], latestProfit: 0, latestProfitPct: 0 };

const rate = (currency: string, fx: FxMap): number => (currency === "KRW" ? 1 : fx[currency] ?? 1);

/**
 * "내 자산 흐름" — 총자산 스냅샷에 누적 투입 원금(입금-출금)을 겹쳐,
 * 자산이 원금 때문에 늘었는지 수익 때문에 늘었는지를 보여준다.
 */
export function buildAssetFlow(
  snapshots: readonly { date: string; totalAssets: number }[],
  trades: readonly Trade[],
  fx: FxMap,
): AssetFlow {
  const sorted = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length < 2) return EMPTY;

  const flows = trades
    .filter((t) => t.action === "deposit" || t.action === "withdraw")
    .map((t) => ({
      date: t.date,
      amount: (t.action === "deposit" ? 1 : -1) * (t.amount ?? 0) * rate(t.currency, fx),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  let cursor = 0;
  let invested = 0;
  const points = sorted.map((snapshot) => {
    while (cursor < flows.length && flows[cursor]!.date <= snapshot.date) {
      invested += flows[cursor]!.amount;
      cursor++;
    }
    return { date: snapshot.date, assets: snapshot.totalAssets, invested };
  });

  const latest = points[points.length - 1]!;
  const latestProfit = latest.assets - latest.invested;
  return {
    points,
    latestProfit,
    latestProfitPct: latest.invested > 0 ? latestProfit / latest.invested : 0,
  };
}
