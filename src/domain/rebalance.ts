import type { Allocation, AssetClass, RebalanceEntry, RebalanceResult } from "./types";

export interface RebalanceInput {
  allocation: Allocation;
  target: Allocation;
  totalAssets: number;
  tolerance?: number; // 허용 편차 (기본 1%p)
}

const CLASSES: readonly AssetClass[] = ["stock", "bond", "cash"];
const DEFAULT_TOLERANCE = 0.01;

/** 현재 배분과 목표 배분의 편차를 계산하고, 가장 크게 초과보유된 자산군을 헤드라인으로 뽑는다. */
export function computeRebalance(input: RebalanceInput): RebalanceResult {
  const { allocation, target, totalAssets } = input;
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;

  const entries: readonly RebalanceEntry[] = CLASSES.map((assetClass) => {
    const current = allocation[assetClass];
    const goal = target[assetClass];
    const deviation = current - goal;
    return { assetClass, current, target: goal, deviation, amount: deviation * totalAssets };
  });

  const needsRebalancing = entries.some((e) => Math.abs(e.deviation) > tolerance);
  const overweight = entries
    .filter((e) => e.deviation > tolerance)
    .sort((a, b) => b.deviation - a.deviation);

  return {
    entries,
    needsRebalancing,
    ...(needsRebalancing && overweight.length > 0 ? { headline: overweight[0] } : {}),
  };
}
