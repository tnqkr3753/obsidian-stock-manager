import type { PortfolioState } from "../app/state";
import type { AssetSnapshot } from "../settings";
import {
  formatCompactKrw,
  formatKrw,
  formatNative,
  formatPct,
  formatQty,
  formatSignedKrw,
  formatSignedPct,
  formatSignedPointPct,
  formatTime,
  signClass,
} from "./format";

export type OpenPath = (path: string) => void;

const CLASS_LABEL = { stock: "주식", bond: "채권", cash: "현금" } as const;
const ACTION_LABEL: Record<string, string> = {
  buy: "매수",
  sell: "매도",
  opening: "기초",
  dividend: "배당",
  deposit: "입금",
  withdraw: "출금",
};

const card = (parent: HTMLElement): HTMLElement => parent.createDiv({ cls: "sm-card" });

const cardHead = (parent: HTMLElement, title: string): HTMLElement => {
  const head = parent.createDiv({ cls: "sm-card-head" });
  head.createEl("h2", { text: title });
  return head;
};

export function renderHero(parent: HTMLElement, state: PortfolioState): void {
  const el = card(parent);
  el.addClass("sm-hero");
  el.createDiv({ cls: "sm-label", text: "총자산" });
  el.createDiv({ cls: "sm-total sm-num", text: formatKrw(state.valuation.totalAssets) });

  const delta = el.createDiv({ cls: `sm-hero-delta sm-num ${signClass(state.todayPnl)}` });
  delta.createSpan({ text: `오늘 ${formatSignedKrw(state.todayPnl)}` });
  const base = state.valuation.totalAssets - state.todayPnl;
  if (base > 0) {
    delta.createSpan({ cls: "sm-pill", text: formatSignedPct(state.todayPnl / base, 2) });
  }

  const basisParts = [`매매일지 ${state.tradeCount}건에서 계산됨`];
  if (state.lastUpdated) basisParts.push(`시세 ${formatTime(state.lastUpdated)} 기준`);
  el.createDiv({ cls: "sm-basis", text: basisParts.join(" · ") });
}

export function renderTrend(parent: HTMLElement, snapshots: readonly AssetSnapshot[]): void {
  if (snapshots.length < 2) return;
  const el = card(parent);
  cardHead(el, "자산 추이");

  const W = 360;
  const H = 110;
  const PAD = { x: 4, top: 8, bottom: 16 };
  const values = snapshots.map((s) => s.totalAssets);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = W - PAD.x * 2;
  const innerH = H - PAD.top - PAD.bottom;

  const points = snapshots.map((s, i) => ({
    x: PAD.x + (i / (snapshots.length - 1)) * innerW,
    y: PAD.top + (1 - (s.totalAssets - min - span * 0.05) / (span * 1.15)) * innerH,
  }));
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1]!;
  const area = `${line} L${last.x.toFixed(1)} ${H - PAD.bottom} L${points[0]!.x.toFixed(1)} ${H - PAD.bottom} Z`;

  const wrap = el.createDiv({ cls: "sm-trend" });
  const first = snapshots[0]!;
  const latest = snapshots[snapshots.length - 1]!;
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="총자산 추이">
    <path d="${area}" class="sm-trend-area"/>
    <path d="${line}" class="sm-trend-line"/>
    <circle cx="${last.x}" cy="${last.y}" r="4" class="sm-trend-dot"/>
    <text x="${PAD.x}" y="${H - 3}" class="sm-trend-label">${first.date.slice(5)}</text>
    <text x="${W - PAD.x}" y="${H - 3}" text-anchor="end" class="sm-trend-label">${latest.date.slice(5)}</text>
  </svg>`;
}

export function renderAllocation(parent: HTMLElement, state: PortfolioState): void {
  const el = card(parent);
  cardHead(el, "자산 구성");
  const { allocation } = state.valuation;

  const bar = el.createDiv({ cls: "sm-alloc-bar" });
  (["stock", "bond", "cash"] as const).forEach((cls) => {
    const seg = bar.createSpan({ cls: `sm-alloc-${cls}` });
    seg.style.width = `${Math.max(allocation[cls] * 100, 0)}%`;
  });

  const list = el.createDiv({ cls: "sm-alloc-list sm-num" });
  const amounts = {
    stock: state.valuation.rows
      .filter((r) => r.assetClass === "stock")
      .reduce((s, r) => s + r.marketValue, 0),
    bond: state.valuation.rows
      .filter((r) => r.assetClass === "bond")
      .reduce((s, r) => s + r.marketValue, 0),
    cash: state.valuation.totalCash,
  };
  (["stock", "bond", "cash"] as const).forEach((cls) => {
    const row = list.createDiv({ cls: "sm-alloc-row" });
    row.createSpan({ cls: `sm-dot sm-alloc-${cls}` });
    row.createSpan({ cls: "sm-name", text: CLASS_LABEL[cls] });
    row.createSpan({ cls: "sm-pct", text: formatPct(allocation[cls]) });
    row.createSpan({ cls: "sm-amt", text: formatKrw(amounts[cls]) });
  });

  renderRebalance(el, state);
}

function renderRebalance(parent: HTMLElement, state: PortfolioState): void {
  const { rebalance } = state;
  if (!rebalance.needsRebalancing) return;

  const el = parent.createDiv({ cls: "sm-rebal" });
  const title = el.createDiv({ cls: "sm-rebal-title" });
  if (rebalance.headline) {
    const label = CLASS_LABEL[rebalance.headline.assetClass];
    title.setText("목표 배분까지 ");
    title.createEl("strong", {
      text: `${label} ${formatSignedPointPct(-rebalance.headline.deviation)}`,
    });
    title.appendText(" 조정이 필요해요");
  } else {
    title.setText("목표 배분에서 벗어나 있어요");
  }

  for (const entry of rebalance.entries) {
    const row = el.createDiv({ cls: "sm-dev-row sm-num" });
    row.createSpan({ text: CLASS_LABEL[entry.assetClass] });
    const track = row.createDiv({ cls: "sm-dev-track" });
    track.createDiv({ cls: "sm-dev-axis" });
    const fill = track.createDiv({ cls: `sm-dev-fill sm-alloc-${entry.assetClass}` });
    const width = Math.min(Math.abs(entry.deviation) * 250, 50);
    fill.style.width = `${width}%`;
    if (entry.deviation >= 0) fill.style.left = "50%";
    else fill.style.right = "50%";
    row.createSpan({ cls: "sm-dev-val", text: formatSignedPointPct(entry.deviation) });
  }

  if (rebalance.headline) {
    const hint = el.createDiv({ cls: "sm-rebal-hint sm-num" });
    hint.setText(
      `${CLASS_LABEL[rebalance.headline.assetClass]} 약 ${formatKrw(Math.abs(rebalance.headline.amount))} 줄이면 목표에 근접해요`,
    );
  }
}

export function renderHoldings(
  parent: HTMLElement,
  state: PortfolioState,
  openPath: OpenPath,
): void {
  const el = card(parent);
  const head = cardHead(el, "보유 종목");
  head.createSpan({ cls: "sm-count sm-num", text: String(state.valuation.rows.length) });

  const list = el.createDiv({ cls: "sm-holding-list sm-num" });
  for (const row of state.valuation.rows) {
    const item = list.createDiv({ cls: "sm-holding" });
    if (row.path) item.onClickEvent(() => openPath(row.path!));

    const avatar = item.createSpan({ cls: "sm-avatar", text: row.name.slice(0, 2) });
    avatar.addClass(`sm-avatar-${row.assetClass}`);

    const mid = item.createDiv({ cls: "sm-mid" });
    const nameLine = mid.createDiv({ cls: "sm-nm" });
    nameLine.setText(row.name);
    if (row.currency !== "KRW") nameLine.createSpan({ cls: "sm-ccy", text: row.currency });
    if (row.stale) nameLine.createSpan({ cls: "sm-stale", text: "시세 없음" });
    mid.createDiv({
      cls: "sm-sub",
      text: `${formatQty(row.qty)}주 · 평단 ${formatNative(row.avgCost, row.currency)}`,
    });

    const right = item.createDiv({ cls: "sm-right" });
    right.createDiv({ cls: "sm-val", text: formatKrw(row.marketValue) });
    right.createDiv({
      cls: `sm-chg ${signClass(row.unrealizedPnl)}`,
      text: formatSignedPct(row.returnPct),
    });
  }
}

export function renderTags(parent: HTMLElement, state: PortfolioState): void {
  if (state.tagExposure.length === 0) return;
  const el = card(parent);
  cardHead(el, "태그 노출");

  const maxRatio = state.tagExposure[0]!.ratio || 1;
  const list = el.createDiv({ cls: "sm-tag-list sm-num" });
  for (const exposure of state.tagExposure) {
    const row = list.createDiv({ cls: "sm-tag-row" });
    const name = row.createSpan({ cls: "sm-tname", text: `#${exposure.tag}` });
    if (exposure.concentrated) name.createSpan({ cls: "sm-warn-chip", text: "⚠ 집중" });
    const track = row.createDiv({ cls: "sm-tag-track" });
    const fill = track.createDiv({ cls: "sm-tag-fill" });
    fill.style.width = `${(exposure.ratio / maxRatio) * 100}%`;
    const val = row.createSpan({ cls: "sm-tag-val" });
    val.createSpan({ cls: "sm-p", text: formatPct(exposure.ratio) });
    val.createSpan({ cls: "sm-a", text: formatCompactKrw(exposure.value) });
  }
  el.createDiv({
    cls: "sm-foot",
    text: `태그는 중복 집계 · 총자산 대비 · ${formatPct(state.config.concentrationLimit, 0)} 초과 시 집중 표시`,
  });
}

export function renderJournal(
  parent: HTMLElement,
  state: PortfolioState,
  openPath: OpenPath,
): void {
  if (state.recentTrades.length === 0) return;
  const el = card(parent);
  cardHead(el, "최근 매매일지");

  const list = el.createDiv({ cls: "sm-journal sm-num" });
  for (const trade of state.recentTrades) {
    const row = list.createDiv({ cls: "sm-jrow" });
    if (trade.path) row.onClickEvent(() => openPath(trade.path!));
    row.createSpan({ cls: "sm-jdate", text: trade.date.slice(5).replace("-", ".") });

    const body = row.createDiv({ cls: "sm-jbody" });
    const line = body.createDiv({ cls: "sm-jline" });
    line.createSpan({ cls: `sm-act sm-act-${trade.action}`, text: ACTION_LABEL[trade.action] ?? trade.action });
    const name = trade.ticker ? (state.metas[trade.ticker]?.name ?? trade.ticker) : "현금";
    line.createSpan({ cls: "sm-jnm", text: name });

    const detail =
      trade.qty !== undefined && trade.price !== undefined
        ? `${formatQty(trade.qty)}주 × ${formatNative(trade.price, trade.currency)}`
        : trade.amount !== undefined
          ? formatNative(trade.amount, trade.currency)
          : "";
    if (detail) body.createDiv({ cls: "sm-jdetail", text: detail });

    if (trade.tags && trade.tags.length > 0) {
      const tags = body.createDiv({ cls: "sm-jtags" });
      trade.tags.forEach((t) => tags.createSpan({ cls: "sm-jtag", text: `#${t}` }));
    }
  }
}

export function renderWarnings(parent: HTMLElement, state: PortfolioState): void {
  if (state.warnings.length === 0) return;
  const el = card(parent);
  el.addClass("sm-warnings");
  cardHead(el, `데이터 경고 ${state.warnings.length}건`);
  const list = el.createEl("ul");
  state.warnings.slice(0, 5).forEach((w) => list.createEl("li", { text: w }));
  if (state.warnings.length > 5) {
    el.createDiv({ cls: "sm-foot", text: `외 ${state.warnings.length - 5}건` });
  }
}
