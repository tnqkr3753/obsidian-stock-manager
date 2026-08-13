import type { MonthlyReport, RetroTagStat, SellEvent, Trade } from "./types";

export interface MonthlyReportInput {
  trades: readonly Trade[];
  sellEvents: readonly SellEvent[];
  snapshots: readonly { date: string; totalAssets: number }[];
  month: string; // YYYY-MM
}

const inMonth = (date: string, month: string): boolean => date.startsWith(month + "-");

const addTo = (
  acc: Readonly<Record<string, number>>,
  currency: string,
  delta: number,
): Record<string, number> => ({ ...acc, [currency]: (acc[currency] ?? 0) + delta });

/** 한 달치 매매·실현손익·배당·자산 변화·회고 태그 성적을 집계한다. 순수 함수. */
export function computeMonthlyReport(input: MonthlyReportInput): MonthlyReport {
  const { month } = input;
  const trades = input.trades.filter((t) => inMonth(t.date, month));
  const sells = input.sellEvents.filter((e) => inMonth(e.date, month));

  const tradeCounts = { buy: 0, sell: 0, dividend: 0, deposit: 0, withdraw: 0 };
  let dividends: Record<string, number> = {};
  let netDeposits: Record<string, number> = {};
  const tagCounts = new Map<string, number>();

  for (const trade of trades) {
    if (trade.action in tradeCounts) {
      tradeCounts[trade.action as keyof typeof tradeCounts] += 1;
    }
    if (trade.action === "dividend") dividends = addTo(dividends, trade.currency, trade.amount ?? 0);
    if (trade.action === "deposit") netDeposits = addTo(netDeposits, trade.currency, trade.amount ?? 0);
    if (trade.action === "withdraw") netDeposits = addTo(netDeposits, trade.currency, -(trade.amount ?? 0));
    for (const tag of trade.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  let realizedPnl: Record<string, number> = {};
  const tagPnl = new Map<string, Record<string, number>>();
  for (const event of sells) {
    realizedPnl = addTo(realizedPnl, event.currency, event.pnl);
    for (const tag of event.tags) {
      tagPnl.set(tag, addTo(tagPnl.get(tag) ?? {}, event.currency, event.pnl));
    }
  }

  const retroTags: RetroTagStat[] = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count, pnl: tagPnl.get(tag) ?? {} }))
    .sort((a, b) => b.count - a.count);

  const monthly = input.snapshots
    .filter((s) => inMonth(s.date, month))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    month,
    tradeCounts,
    realizedPnl,
    dividends,
    netDeposits,
    startAssets: monthly[0]?.totalAssets,
    endAssets: monthly[monthly.length - 1]?.totalAssets,
    retroTags,
  };
}

const formatByCurrency = (map: Readonly<Record<string, number>>): string => {
  const entries = Object.entries(map).filter(([, v]) => v !== 0);
  if (entries.length === 0) return "—";
  return entries
    .map(([currency, value]) => {
      const rounded = Math.round(value * 100) / 100;
      const sign = rounded > 0 ? "+" : "";
      return currency === "KRW"
        ? `${sign}${Math.round(rounded).toLocaleString("ko-KR")}원`
        : `${sign}${rounded.toLocaleString("en-US")} ${currency}`;
    })
    .join(" · ");
};

/** 월간 리포트 → 마크다운 노트 본문. */
export function buildMonthlyReportMarkdown(report: MonthlyReport): string {
  const { tradeCounts } = report;
  const change =
    report.startAssets !== undefined && report.endAssets !== undefined && report.startAssets > 0
      ? (report.endAssets - report.startAssets) / report.startAssets
      : undefined;

  const assetLine =
    report.startAssets !== undefined && report.endAssets !== undefined
      ? `₩${Math.round(report.startAssets).toLocaleString("ko-KR")} → ₩${Math.round(report.endAssets).toLocaleString("ko-KR")}` +
        (change !== undefined
          ? ` (${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(1)}%)`
          : "")
      : "스냅샷 없음 (설정에서 자산 스냅샷 기록을 켜면 다음 달부터 집계됩니다)";

  const tagLines =
    report.retroTags.length > 0
      ? report.retroTags.map(
          (t) => `| #${t.tag} | ${t.count}회 | ${formatByCurrency(t.pnl)} |`,
        )
      : ["| — | — | — |"];

  return [
    "---",
    "type: stock-report",
    `month: "${report.month}"`,
    "---",
    "",
    `# ${report.month} 투자 리포트`,
    "",
    `- **총자산**: ${assetLine}`,
    `- **매매**: 매수 ${tradeCounts.buy}회 · 매도 ${tradeCounts.sell}회 · 배당 ${tradeCounts.dividend}회`,
    `- **실현손익**: ${formatByCurrency(report.realizedPnl)}`,
    `- **배당 수령**: ${formatByCurrency(report.dividends)}`,
    `- **순입출금**: ${formatByCurrency(report.netDeposits)}`,
    "",
    "## 회고 태그 성적표",
    "",
    "| 태그 | 횟수 | 실현손익 |",
    "|---|---|---|",
    ...tagLines,
    "",
    "## 이 달의 회고",
    "",
    "<!-- 잘한 결정과 반복하지 말아야 할 결정을 남겨보세요. -->",
    "",
  ].join("\n");
}
