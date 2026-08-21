import type { PortfolioState } from "../app/state";
import type { AssetFlow } from "../domain/assetFlow";
import { buildOverlay, type BenchSeries } from "../domain/benchmark";
import { latestBySession, REVIEW_SESSIONS, type ReviewRow } from "../domain/review";
import type { Trade } from "../domain/types";
import type { AssetSnapshot } from "../settings";
import { toLocalDateString } from "../util/date";
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
export const ACTION_LABEL: Record<string, string> = {
  buy: "매수",
  sell: "매도",
  opening: "기초",
  dividend: "배당",
  deposit: "입금",
  withdraw: "출금",
};

/** 매매 한 건의 상세 문자열 — 수량×단가, 없으면 금액(배당·입출금). 저널·리뷰 뷰 공용. */
export const tradeDetailText = (trade: Trade): string =>
  trade.qty !== undefined && trade.price !== undefined
    ? `${formatQty(trade.qty)}주 × ${formatNative(trade.price, trade.currency)}`
    : trade.amount !== undefined
      ? formatNative(trade.amount, trade.currency)
      : "";

const card = (parent: HTMLElement): HTMLElement => parent.createDiv({ cls: "sm-card" });

const cardHead = (parent: HTMLElement, title: string): HTMLElement => {
  const head = parent.createDiv({ cls: "sm-card-head" });
  head.createEl("h2", { text: title });
  return head;
};

/** 카드 헤더 우측 끝에 텍스트 링크 버튼을 단다 (DESIGN.md의 sm-textlink 문법). */
const headAction = (head: HTMLElement, label: string, onClick: () => void): void => {
  const spacer = head.createSpan();
  spacer.style.flex = "1";
  const btn = head.createEl("button", { cls: "sm-textlink", text: label });
  btn.onClickEvent(onClick);
};

// ── 리뷰(stock-review) 배지 문법 — 대시보드 카드와 Reviews 뷰가 공유 ──
export const SESSION_LABEL: Record<string, string> = {
  morning: "오전",
  evening: "저녁",
  weekly: "주간",
  monthly: "월간",
  "on-demand": "수시",
};

type BadgeTone = "good" | "warn" | "bad" | "mute";

const HEALTH_BADGE: Record<string, [string, BadgeTone]> = {
  healthy: ["양호", "good"],
  watch: ["관찰", "warn"],
  "at-risk": ["위험신호", "bad"],
  unknown: ["상태 미상", "mute"],
};
const RISK_BADGE: Record<string, [string, BadgeTone]> = {
  low: ["위험 낮음", "good"],
  medium: ["위험 보통", "mute"],
  high: ["위험 높음", "warn"],
  critical: ["위험 심각", "bad"],
};
const REGIME_BADGE: Record<string, [string, BadgeTone]> = {
  "risk-on": ["위험선호", "good"],
  neutral: ["중립", "mute"],
  "risk-off": ["위험회피", "warn"],
  unknown: ["국면 미상", "mute"],
};
const DATA_BADGE: Record<string, [string, BadgeTone]> = {
  complete: ["데이터 완전", "mute"],
  partial: ["일부 데이터", "warn"],
  failed: ["데이터 실패", "bad"],
};

const badge = (parent: HTMLElement, label: string, tone: BadgeTone): void => {
  parent.createSpan({ cls: `sm-badge sm-badge-${tone}`, text: label });
};

/** health·riskLevel·marketRegime·dataStatus 배지 한 줄. 미기재 필드는 그리지 않는다. */
export function renderReviewBadges(parent: HTMLElement, review: ReviewRow): void {
  const row = parent.createDiv({ cls: "sm-badges" });
  const health = HEALTH_BADGE[review.health];
  if (health) badge(row, health[0], health[1]);
  const risk = review.riskLevel ? RISK_BADGE[review.riskLevel] : undefined;
  if (risk) badge(row, risk[0], risk[1]);
  const regime = REGIME_BADGE[review.marketRegime];
  if (regime) badge(row, regime[0], regime[1]);
  const data = review.dataStatus ? DATA_BADGE[review.dataStatus] : undefined;
  if (data) badge(row, data[0], data[1]);
  if (review.superseded) badge(row, "재실행으로 대체됨", "mute");
}

/** ISO 문자열 → HH:mm. 파싱 불가면 표시하지 않는다. */
const asOfTime = (iso?: string): string | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? formatTime(t) : undefined;
};

/** "포트폴리오 07:55 · 시장 07:50 기준" 형태의 기준 시각 문자열. */
export function reviewBasisText(review: ReviewRow): string | undefined {
  const parts = [
    ...(asOfTime(review.portfolioAsOf) ? [`포트폴리오 ${asOfTime(review.portfolioAsOf)}`] : []),
    ...(asOfTime(review.marketAsOf) ? [`시장 ${asOfTime(review.marketAsOf)}`] : []),
  ];
  if (parts.length > 0) return `${parts.join(" · ")} 기준`;
  const generated = asOfTime(review.generatedAt);
  return generated ? `${generated} 생성` : undefined;
}

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

/** "내 자산 흐름" — 총자산과 누적 투입 원금을 절대 금액으로 겹쳐, 원금 대비 얼마나 불었는지 보여준다. */
export function renderAssetFlow(parent: HTMLElement, flow: AssetFlow): void {
  // date는 저장 시 검증되지만, 파싱 불가한 값이 섞여도 차트가 통째로 깨지지 않게 한 번 더 거른다
  const points = flow.points.filter((p) => Number.isFinite(Date.parse(p.date)));
  if (points.length < 2) return;
  const el = card(parent);
  const head = cardHead(el, "자산 흐름");
  if (flow.hasInvested) {
    const pct = flow.latestProfitPct !== undefined ? ` (${formatSignedPct(flow.latestProfitPct)})` : "";
    head.createSpan({
      cls: `sm-legend-val sm-num ${signClass(flow.latestProfit)}`,
      text: `원금 대비 ${formatSignedKrw(flow.latestProfit)}${pct}`,
    });
  } else {
    head.createSpan({
      cls: "sm-basis",
      text: "입금(deposit)을 기록하면 원금 대비 수익이 계산돼요",
    });
  }

  const W = 360;
  const H = 130;
  const PAD = { x: 4, top: 8, bottom: 16 };
  const innerW = W - PAD.x * 2;
  const innerH = H - PAD.top - PAD.bottom;
  const t0 = Date.parse(points[0]!.date);
  const t1 = Date.parse(points[points.length - 1]!.date);
  const tSpan = t1 - t0 || 1;
  const values = points.flatMap((p) => [p.assets, p.invested]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (date: string): number => PAD.x + ((Date.parse(date) - t0) / tSpan) * innerW;
  const y = (v: number): number => PAD.top + (1 - (v - min + span * 0.08) / (span * 1.16)) * innerH;
  const path = (get: (p: AssetFlow["points"][number]) => number): string =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)} ${y(get(p)).toFixed(1)}`).join(" ");

  const assetsLine = path((p) => p.assets);
  const investedLine = path((p) => p.invested);
  const last = points[points.length - 1]!;
  // 라벨은 원시 문자열이 아니라 파싱된 시각에서 파생 — vault 파일은 외부 편집 가능한 신뢰 경계다
  const label = (epoch: number): string =>
    new Date(epoch).toISOString().slice(5, 10).replace("-", ".");
  const wrap = el.createDiv({ cls: "sm-trend" });
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="총자산과 누적 투입 원금 추이">
    <path d="${assetsLine} L${x(last.date).toFixed(1)} ${H - PAD.bottom} L${x(points[0]!.date).toFixed(1)} ${H - PAD.bottom} Z" fill="var(--sm-accent)" opacity="0.1"/>
    <path d="${assetsLine}" fill="none" stroke="var(--sm-accent)" stroke-width="2" stroke-linecap="round"/>
    <path d="${investedLine}" fill="none" stroke="var(--sm-bond)" stroke-width="1.5" stroke-dasharray="4 3" stroke-linecap="round"/>
    <circle cx="${x(last.date)}" cy="${y(last.assets)}" r="3.5" fill="var(--sm-accent)" stroke="var(--sm-card)" stroke-width="1.5"/>
    <text x="${PAD.x}" y="${H - 3}" class="sm-trend-label">${label(t0)}</text>
    <text x="${W - PAD.x}" y="${H - 3}" text-anchor="end" class="sm-trend-label">${label(t1)}</text>
  </svg>`;
  if (flow.fxIncomplete) {
    el.createDiv({
      cls: "sm-foot",
      text: "일부 외화 환율을 아직 받지 못해 원금이 부정확할 수 있어요 (시세 갱신 후 정확해집니다)",
    });
  }

  const legend = el.createDiv({ cls: "sm-legend sm-num" });
  const items: readonly [string, string, number][] = [
    ["총자산", "var(--sm-accent)", last.assets],
    ["투입 원금", "var(--sm-bond)", last.invested],
  ];
  for (const [label, color, value] of items) {
    const item = legend.createDiv({ cls: "sm-legend-item" });
    const dot = item.createSpan({ cls: "sm-dot" });
    dot.style.background = color;
    item.createSpan({ cls: "sm-name", text: label });
    item.createSpan({ cls: "sm-legend-val", text: formatKrw(value) });
  }
}

/** 계좌별 자산 카드 — ISA·연금·증권사 계좌 단위 평가액+현금과 비중. */
export function renderAccounts(parent: HTMLElement, state: PortfolioState): void {
  // 계좌를 실제로 나눠 쓰는 경우에만 (기본 계좌 하나뿐이면 노이즈)
  if (state.accounts.length < 2) return;
  const el = card(parent);
  cardHead(el, "계좌별 자산");

  const list = el.createDiv({ cls: "sm-alloc-list sm-num" });
  const maxWeight = state.accounts[0]?.weight || 1;
  for (const account of state.accounts) {
    const row = list.createDiv({ cls: "sm-account-row" });
    const top = row.createDiv({ cls: "sm-alloc-row" });
    top.createSpan({ cls: "sm-name", text: account.account });
    top.createSpan({ cls: "sm-pct", text: formatPct(account.weight) });
    top.createSpan({ cls: "sm-amt", text: formatKrw(account.totalValue) });
    const track = row.createDiv({ cls: "sm-tag-track" });
    const fill = track.createDiv({ cls: "sm-tag-fill" });
    fill.style.width = `${(account.weight / maxWeight) * 100}%`;
    row.createDiv({
      cls: "sm-foot",
      text: `평가 ${formatKrw(account.holdingsValue)} · 현금 ${formatKrw(account.cashValue)}`,
    });
  }
}

const SERIES_COLORS = ["var(--sm-accent)", "var(--sm-bond)", "var(--sm-cash)"];
const MAX_OVERLAY_SERIES = SERIES_COLORS.length;

/** 자산 추이 + 벤치마크 오버레이. 모든 계열을 창 시작일 = 100으로 지수화해 같은 축에 그린다. */
export function renderTrend(
  parent: HTMLElement,
  snapshots: readonly AssetSnapshot[],
  benchmarks: readonly BenchSeries[] = [],
): void {
  const overlay = buildOverlay(snapshots, benchmarks).slice(0, MAX_OVERLAY_SERIES);
  if (overlay.length === 0) return;

  const el = card(parent);
  // 제목은 설정이 아니라 실제로 그려지는 계열 수를 따른다
  cardHead(el, overlay.length > 1 ? "자산 추이 · 시장 비교" : "자산 추이");

  const W = 360;
  const H = 120;
  const PAD = { x: 4, top: 8, bottom: 16 };
  const innerW = W - PAD.x * 2;
  const innerH = H - PAD.top - PAD.bottom;

  const allPoints = overlay.flatMap((s) => s.points);
  const allDates = allPoints.map((p) => Date.parse(p.date));
  const t0 = Math.min(...allDates);
  const t1 = Math.max(...allDates);
  const tSpan = t1 - t0 || 1;
  const values = allPoints.map((p) => p.index);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (date: string): number => PAD.x + ((Date.parse(date) - t0) / tSpan) * innerW;
  const y = (index: number): number =>
    PAD.top + (1 - (index - min + span * 0.08) / (span * 1.16)) * innerH;

  const paths = overlay
    .map((series, i) => {
      const d = series.points
        .map((p, j) => `${j === 0 ? "M" : "L"}${x(p.date).toFixed(1)} ${y(p.index).toFixed(1)}`)
        .join(" ");
      const last = series.points[series.points.length - 1]!;
      const isMine = i === 0;
      const area = isMine
        ? `<path d="${d} L${x(last.date).toFixed(1)} ${H - PAD.bottom} L${x(series.points[0]!.date).toFixed(1)} ${H - PAD.bottom} Z" fill="${SERIES_COLORS[0]}" opacity="0.1"/>`
        : "";
      return `${area}<path d="${d}" fill="none" stroke="${SERIES_COLORS[i]}" stroke-width="${isMine ? 2 : 1.5}" ${isMine ? "" : 'stroke-dasharray="4 3"'} stroke-linecap="round"/>
        <circle cx="${x(last.date)}" cy="${y(last.index)}" r="3.5" fill="${SERIES_COLORS[i]}" stroke="var(--sm-card)" stroke-width="1.5"/>`;
    })
    .join("");

  const firstDate = new Date(t0).toISOString().slice(5, 10).replace("-", ".");
  const lastDate = new Date(t1).toISOString().slice(5, 10).replace("-", ".");
  const wrap = el.createDiv({ cls: "sm-trend" });
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="자산 추이와 벤치마크 비교 (기준일 100 지수)">
    ${paths}
    <text x="${PAD.x}" y="${H - 3}" class="sm-trend-label">${firstDate}</text>
    <text x="${W - PAD.x}" y="${H - 3}" text-anchor="end" class="sm-trend-label">${lastDate}</text>
  </svg>`;

  // 계열이 2개 이상이면 색만으로 구분하지 않도록 범례 + 최종 수익률 직접 라벨
  if (overlay.length > 1) {
    const legend = el.createDiv({ cls: "sm-legend sm-num" });
    overlay.forEach((series, i) => {
      const last = series.points[series.points.length - 1]!.index;
      const item = legend.createDiv({ cls: "sm-legend-item" });
      const dot = item.createSpan({ cls: "sm-dot" });
      dot.style.background = SERIES_COLORS[i]!;
      item.createSpan({ cls: "sm-name", text: series.label });
      item.createSpan({
        cls: `sm-legend-val ${signClass(last - 100)}`,
        text: formatSignedPct((last - 100) / 100),
      });
    });
    el.createDiv({ cls: "sm-foot", text: "구간 시작일 = 100 기준 지수" });
  }
}

export function renderAllocation(
  parent: HTMLElement,
  state: PortfolioState,
  onEditTarget?: () => void,
): void {
  const el = card(parent);
  const head = cardHead(el, "자산 구성");
  // 목표 배분은 stock-config 노트로만 조정 가능했는데 진입점이 없었다 — 여기서 노트를 연다/만든다
  if (onEditTarget) headAction(head, "목표 조정", onEditTarget);
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
  openTable?: () => void,
): void {
  const el = card(parent);
  const head = cardHead(el, "보유 종목");
  head.createSpan({ cls: "sm-count sm-num", text: String(state.valuation.rows.length) });
  if (openTable) headAction(head, "상세 테이블 →", openTable);

  const multiAccount = state.accounts.length > 1;
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
      text: [
        ...(multiAccount ? [row.account] : []),
        `${formatQty(row.qty)}주 · 평단 ${formatNative(row.avgCost, row.currency)}`,
      ].join(" · "),
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

export function renderWatchlist(
  parent: HTMLElement,
  state: PortfolioState,
  openPath: OpenPath,
): void {
  if (state.watchRows.length === 0) return;
  const el = card(parent);
  cardHead(el, "워치리스트");

  const list = el.createDiv({ cls: "sm-holding-list sm-num" });
  for (const row of state.watchRows) {
    const item = list.createDiv({ cls: "sm-holding" });
    if (row.path) item.onClickEvent(() => openPath(row.path!));

    const mid = item.createDiv({ cls: "sm-mid" });
    const nameLine = mid.createDiv({ cls: "sm-nm" });
    nameLine.setText(row.name);
    if (row.targetHit) nameLine.createSpan({ cls: "sm-target-chip", text: "◎ 목표가 도달" });
    const subParts = [
      row.targetPrice !== undefined
        ? `목표 ${formatNative(row.targetPrice, row.currency)}`
        : "목표가 미설정",
      ...(row.currencyMismatch
        ? [`통화 확인 필요 (노트 ${row.currency} · 시세 ${row.priceCurrency})`]
        : []),
    ];
    mid.createDiv({ cls: "sm-sub", text: subParts.join(" · ") });

    const right = item.createDiv({ cls: "sm-right" });
    right.createDiv({
      cls: "sm-val",
      text: row.price !== undefined ? formatNative(row.price, row.priceCurrency) : "—",
    });
    if (row.changePct !== undefined) {
      right.createDiv({
        cls: `sm-chg ${signClass(row.changePct)}`,
        text: formatSignedPct(row.changePct),
      });
    }
  }
}

const MEMO_SCOPE_LABEL: Record<string, string> = { portfolio: "포트폴리오", stock: "종목" };

/** 오늘의 리뷰 — AI 평가 기록(stock-review)의 세션별 최신본 요약. 진입점 카드라 비어 있어도 그린다. */
export function renderTodayReview(
  parent: HTMLElement,
  state: PortfolioState,
  openPath: OpenPath,
  openReviews?: () => void,
): void {
  const el = card(parent);
  const head = cardHead(el, "오늘의 리뷰");
  if (openReviews && state.reviews.length > 0) headAction(head, "전체 보기 →", openReviews);

  if (state.reviews.length === 0) {
    el.createDiv({ cls: "sm-basis", text: "아직 리뷰가 없어요. Stocks/Reviews 폴더에 stock-review 노트가 생기면 여기 표시됩니다." });
    return;
  }

  // 오늘은 렌더 시점 기준 — computeState 시점 값이면 자정 넘긴 뒤 어제 리뷰를 오늘로 보인다
  const today = toLocalDateString();
  const todays = latestBySession(state.reviews, today);
  // 세션 진행 순서대로, 오늘 있는 것만
  const rows = REVIEW_SESSIONS.map((s) => todays[s]).filter((r): r is ReviewRow => r !== undefined);

  // 오늘 리뷰가 없으면 가장 최근 리뷰 하나를 날짜와 함께 보여준다
  const fallback = state.reviews.find((r) => !r.superseded);
  const display = rows.length > 0 ? rows : fallback ? [fallback] : [];
  if (display.length === 0) return;

  const list = el.createDiv({ cls: "sm-review-list" });
  for (const review of display) {
    const item = list.createDiv({ cls: "sm-review-item" });
    if (review.path) {
      item.addClass("sm-clickable");
      item.setAttribute("tabindex", "0");
      item.setAttribute("role", "button");
      item.onClickEvent(() => openPath(review.path!));
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault(); // Space의 페이지 스크롤 기본 동작 억제
          openPath(review.path!);
        }
      });
    }
    const line = item.createDiv({ cls: "sm-jline" });
    line.createSpan({ cls: "sm-act sm-act-deposit", text: SESSION_LABEL[review.session] ?? review.session });
    if (review.date !== today) {
      line.createSpan({ cls: "sm-jdate-inline", text: review.date.slice(5).replace("-", ".") });
    }
    item.createDiv({ cls: "sm-review-headline", text: review.headline || "(headline 없음)" });
    renderReviewBadges(item, review);
    const basis = reviewBasisText(review);
    if (basis) item.createDiv({ cls: "sm-basis", text: basis });
  }
}

/** 메모 카드 — 진입점 역할이라 비어 있어도 그리고, 헤더에서 바로 작성한다. */
export function renderMemos(
  parent: HTMLElement,
  state: PortfolioState,
  openPath: OpenPath,
  onCreate?: () => void,
): void {
  const el = card(parent);
  const head = cardHead(el, "메모");
  if (onCreate) headAction(head, "＋ 작성", onCreate);

  if (state.recentMemos.length === 0) {
    el.createDiv({ cls: "sm-basis", text: "금리·환율 같은 시장 메모나 투자 생각을 남겨보세요." });
    return;
  }

  const list = el.createDiv({ cls: "sm-journal sm-num" });
  for (const memo of state.recentMemos) {
    const row = list.createDiv({ cls: "sm-jrow" });
    if (memo.path) row.onClickEvent(() => openPath(memo.path!));
    row.createSpan({ cls: "sm-jdate", text: memo.date.slice(5).replace("-", ".") });

    const body = row.createDiv({ cls: "sm-jbody" });
    const line = body.createDiv({ cls: "sm-jline" });
    line.createSpan({ cls: "sm-jnm", text: memo.title });
    const scopeLabel = memo.scope === "stock" ? memo.ticker : MEMO_SCOPE_LABEL[memo.scope];
    if (scopeLabel) line.createSpan({ cls: "sm-jtag", text: scopeLabel });
    if (memo.tags.length > 0) {
      const tags = body.createDiv({ cls: "sm-jtags" });
      memo.tags.forEach((t) => tags.createSpan({ cls: "sm-jtag", text: `#${t}` }));
    }
  }
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
    const name = trade.ticker ? (state.names[trade.ticker] ?? trade.ticker) : "현금";
    line.createSpan({ cls: "sm-jnm", text: name });

    const detail = tradeDetailText(trade);
    if (detail) body.createDiv({ cls: "sm-jdetail", text: detail });

    if (trade.tags && trade.tags.length > 0) {
      const tags = body.createDiv({ cls: "sm-jtags" });
      trade.tags.forEach((t) => tags.createSpan({ cls: "sm-jtag", text: `#${t}` }));
    }
  }
}

export function renderEvents(
  parent: HTMLElement,
  state: PortfolioState,
): void {
  if (state.upcoming.length === 0) return;
  const el = card(parent);
  cardHead(el, "다가오는 이벤트");

  const list = el.createDiv({ cls: "sm-journal sm-num" });
  for (const event of state.upcoming.slice(0, 5)) {
    const row = list.createDiv({ cls: "sm-jrow sm-event-row" });
    row.createSpan({
      cls: `sm-dday ${event.dday <= 3 ? "sm-dday-soon" : ""}`,
      text: event.dday === 0 ? "오늘" : `D-${event.dday}`,
    });
    const body = row.createDiv({ cls: "sm-jbody" });
    const line = body.createDiv({ cls: "sm-jline" });
    line.createSpan({ cls: "sm-jnm", text: event.title });
    body.createDiv({
      cls: "sm-jdetail",
      text: `${event.origin} · ${event.date.slice(5).replace("-", ".")}`,
    });
  }
  el.createDiv({
    cls: "sm-foot",
    text: "종목·워치·메모 노트의 events 항목에서 수집 (30일 이내)",
  });
}

export function renderCashflow(parent: HTMLElement, state: PortfolioState): void {
  const { months, totalInvested } = state.cashflow;
  const hasFlow = months.some((m) => Object.keys(m.net).length > 0);
  if (!hasFlow && Object.keys(totalInvested).length === 0) return;

  const el = card(parent);
  cardHead(el, "현금흐름");

  const maxAbs = Math.max(1, ...months.map((m) => Math.abs(m.net["KRW"] ?? 0)));
  const chart = el.createDiv({ cls: "sm-cashflow sm-num" });
  for (const month of months) {
    const net = month.net["KRW"] ?? 0;
    const col = chart.createDiv({ cls: "sm-cf-col" });
    const barArea = col.createDiv({ cls: "sm-cf-bars" });
    const bar = barArea.createDiv({
      cls: `sm-cf-bar ${net >= 0 ? "sm-cf-in" : "sm-cf-out"}`,
    });
    bar.style.height = `${(Math.abs(net) / maxAbs) * 100}%`;
    if (net !== 0) bar.setAttribute("title", formatSignedKrw(net));
    col.createDiv({ cls: "sm-cf-month", text: month.month.slice(5) + "월" });
  }

  const foreign = Object.entries(totalInvested).filter(([c]) => c !== "KRW");
  const investedParts = [
    ...(totalInvested["KRW"] !== undefined ? [formatKrw(totalInvested["KRW"])] : []),
    ...foreign.map(([currency, value]) => formatNative(value, currency)),
  ];
  if (investedParts.length > 0) {
    el.createDiv({
      cls: "sm-basis",
      text: `누적 투입 원금 ${investedParts.join(" · ")} · 막대는 월별 순입출금(KRW)`,
    });
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
