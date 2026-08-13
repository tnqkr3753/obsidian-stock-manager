import type { Trade } from "./types";

export interface MonthCashflow {
  month: string; // YYYY-MM
  net: Readonly<Record<string, number>>; // 통화별 입금-출금
}

export interface Cashflow {
  months: readonly MonthCashflow[]; // 오래된 달부터, 빈 달 포함
  totalInvested: Readonly<Record<string, number>>; // 전체 기간 누적 순입금 (투입 원금)
}

const monthOf = (date: string): string => date.slice(0, 7);

const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** 입출금만으로 월별 현금흐름과 누적 투입 원금을 집계한다. 매수·매도·배당은 자산 내부 이동이라 제외. */
export function computeCashflow(
  trades: readonly Trade[],
  today: string,
  windowMonths: number,
): Cashflow {
  const flows = trades
    .filter((t) => t.action === "deposit" || t.action === "withdraw")
    .map((t) => ({
      month: monthOf(t.date),
      currency: t.currency,
      amount: (t.action === "deposit" ? 1 : -1) * (t.amount ?? 0),
    }));

  const currentMonth = monthOf(today);
  const months: MonthCashflow[] = Array.from({ length: windowMonths }, (_, i) => {
    const month = shiftMonth(currentMonth, i - (windowMonths - 1));
    const net = flows
      .filter((f) => f.month === month)
      .reduce<Record<string, number>>(
        (acc, f) => ({ ...acc, [f.currency]: (acc[f.currency] ?? 0) + f.amount }),
        {},
      );
    return { month, net };
  });

  const totalInvested = flows.reduce<Record<string, number>>(
    (acc, f) => ({ ...acc, [f.currency]: (acc[f.currency] ?? 0) + f.amount }),
    {},
  );

  return { months, totalInvested };
}
