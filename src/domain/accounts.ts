import type { FxMap, HoldingRow } from "./types";

export interface AccountBreakdown {
  account: string;
  holdingsValue: number; // 기준통화(KRW)
  cashValue: number;
  totalValue: number;
  weight: number; // 총자산 대비
}

export interface AccountBreakdownInput {
  rows: readonly HoldingRow[];
  cashByAccount: Readonly<Record<string, Readonly<Record<string, number>>>>;
  fx: FxMap;
}

const rate = (currency: string, fx: FxMap): number => (currency === "KRW" ? 1 : fx[currency] ?? 1);

/** 계좌별 자산(평가액+현금) 집계 — ISA·연금 등 계좌 단위로 얼마가 들어있는지. */
export function computeAccountBreakdown(input: AccountBreakdownInput): readonly AccountBreakdown[] {
  const { rows, cashByAccount, fx } = input;

  const holdings = rows.reduce<Record<string, number>>(
    (acc, row) => ({ ...acc, [row.account]: (acc[row.account] ?? 0) + row.marketValue }),
    {},
  );
  const cash = Object.fromEntries(
    Object.entries(cashByAccount).map(([account, bucket]) => [
      account,
      Object.entries(bucket).reduce((sum, [currency, amount]) => sum + amount * rate(currency, fx), 0),
    ]),
  );

  const accounts = [...new Set([...Object.keys(holdings), ...Object.keys(cash)])];
  const entries = accounts.map((account) => {
    const holdingsValue = holdings[account] ?? 0;
    const cashValue = cash[account] ?? 0;
    return { account, holdingsValue, cashValue, totalValue: holdingsValue + cashValue, weight: 0 };
  });
  // 음수 잔액 계좌(입금 미기록 상태의 매수 등)가 있으면 총합 기준 비중이 100%를 넘어버린다
  // — 비중은 양수 자산의 합 대비로만 계산하고, 음수 계좌는 0%로 둔다
  const positiveSum = entries.reduce((sum, e) => sum + Math.max(e.totalValue, 0), 0);

  return entries
    .map((e) => ({
      ...e,
      weight: e.totalValue > 0 && positiveSum > 0 ? e.totalValue / positiveSum : 0,
    }))
    .sort((a, b) => b.totalValue - a.totalValue);
}
