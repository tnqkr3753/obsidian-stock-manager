import type { HoldingRow, StockMeta, TagExposure } from "./types";

export interface TagExposureInput {
  rows: readonly HoldingRow[];
  metas: Readonly<Record<string, StockMeta>>;
  totalAssets: number;
  concentrationLimit: number;
}

/**
 * 태그별 노출 = 해당 태그가 달린 보유 종목 평가액 합 / 총자산.
 * 한 종목의 여러 태그는 각 태그에 중복 집계된다("노출도"이므로 합이 100%를 넘을 수 있음).
 */
export function computeTagExposure(input: TagExposureInput): readonly TagExposure[] {
  const { rows, metas, totalAssets, concentrationLimit } = input;

  const valueByTag = rows.reduce<Record<string, number>>((acc, row) => {
    const tags = metas[row.ticker]?.tags ?? [];
    return tags.reduce(
      (inner, tag) => ({ ...inner, [tag]: (inner[tag] ?? 0) + row.marketValue }),
      acc,
    );
  }, {});

  return Object.entries(valueByTag)
    .map(([tag, value]) => {
      const ratio = totalAssets > 0 ? value / totalAssets : 0;
      return { tag, value, ratio, concentrated: ratio > concentrationLimit };
    })
    .sort((a, b) => b.value - a.value);
}
