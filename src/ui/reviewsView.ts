import { ItemView, MarkdownRenderer, TFile, WorkspaceLeaf } from "obsidian";
import type StockManagerPlugin from "../../main";
import type { ReviewRow, ReviewSession } from "../domain/review";
import type { Memo, Trade } from "../domain/types";
import { toLocalDateString } from "../util/date";
import { noteBasename } from "../util/path";
import {
  ACTION_LABEL,
  renderReviewBadges,
  reviewBasisText,
  SESSION_LABEL,
  tradeDetailText,
} from "./render";

export const VIEW_TYPE_REVIEWS = "stock-manager-reviews";

type RangeFilter = "all" | "7" | "30" | "90";
const RANGE_CHIPS: readonly [RangeFilter, string][] = [
  ["all", "전체 기간"],
  ["7", "최근 7일"],
  ["30", "최근 30일"],
  ["90", "최근 90일"],
];

/** "all" 포함 칩 필터 한 그룹의 선택 상태. */
interface Filters {
  range: RangeFilter;
  session: "all" | ReviewSession;
  health: string; // "all" | ReviewHealth
  risk: string; // "all" | ReviewRiskLevel
  data: string; // "all" | ReviewDataStatus
}

/** Reviews 조회 뷰 — 필터 + 최신순 목록 + Markdown 상세. frontmatter만 해석하고 본문은 그대로 렌더한다. */
export class ReviewsView extends ItemView {
  private filters: Filters = { range: "all", session: "all", health: "all", risk: "all", data: "all" };
  private selectedPath: string | undefined;
  private renderSeq = 0; // 비동기 본문 렌더가 이전 세대 DOM에 그리는 것 방지
  // 같은 파일·같은 수정본이면 Markdown 재렌더를 건너뛴다 — 필터 클릭·vault 변경마다 통째 재파싱 방지
  private mdCache: { path: string; mtime: number; el: HTMLElement } | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: StockManagerPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_REVIEWS;
  }
  getDisplayText(): string {
    return "리뷰";
  }
  getIcon(): string {
    return "clipboard-check";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const seq = ++this.renderSeq;
    const root = this.contentEl;
    root.empty();
    root.addClass("sm-view", "sm-reviews-view");

    const state = this.plugin.state;
    if (!state) {
      root.createDiv({ cls: "sm-card sm-empty", text: "데이터를 불러오는 중입니다…" });
      return;
    }

    if (state.reviewErrors.length > 0) {
      const errCard = root.createDiv({ cls: "sm-card sm-warnings" });
      errCard.createDiv({ cls: "sm-rebal-title", text: `리뷰 파싱 오류 ${state.reviewErrors.length}건 — 목록에서 빠져 있어요` });
      const ul = errCard.createEl("ul");
      state.reviewErrors.slice(0, 3).forEach((e) => ul.createEl("li", { text: e }));
      if (state.reviewErrors.length > 3) {
        errCard.createDiv({ cls: "sm-foot", text: `외 ${state.reviewErrors.length - 3}건` });
      }
    }

    if (state.reviews.length === 0) {
      const empty = root.createDiv({ cls: "sm-card sm-empty" });
      empty.createDiv({ text: "아직 리뷰가 없어요." });
      empty.createDiv({
        cls: "sm-basis",
        text: "Stocks/Reviews/YYYY-MM/ 폴더에 type: stock-review 노트가 생기면 여기서 모아 볼 수 있습니다.",
      });
      return;
    }

    this.renderFilters(root);

    const rows = this.filteredRows(state.reviews);
    const layout = root.createDiv({ cls: "sm-review-layout" });
    const listPane = layout.createDiv({ cls: "sm-review-listpane sm-card" });
    const detailPane = layout.createDiv({ cls: "sm-review-detail sm-card" });

    if (rows.length === 0) {
      listPane.createDiv({ cls: "sm-basis", text: "필터에 맞는 리뷰가 없어요." });
      detailPane.createDiv({ cls: "sm-basis", text: "왼쪽 필터를 조정해보세요." });
      return;
    }

    // 선택이 없거나 필터로 사라졌으면 첫 행 선택
    if (!rows.some((r) => r.path === this.selectedPath)) this.selectedPath = rows[0]!.path;

    for (const review of rows) {
      const item = listPane.createEl("button", { cls: "sm-review-item sm-review-rowbtn" });
      if (review.path === this.selectedPath) item.addClass("sm-selected");
      item.onClickEvent(() => {
        this.selectedPath = review.path;
        this.render();
      });

      const line = item.createDiv({ cls: "sm-jline" });
      line.createSpan({ cls: "sm-act sm-act-deposit", text: SESSION_LABEL[review.session] ?? review.session });
      line.createSpan({ cls: "sm-jdate-inline", text: review.date });
      item.createDiv({ cls: "sm-review-headline", text: review.headline || "(headline 없음)" });
      renderReviewBadges(item, review);
    }

    const selected = rows.find((r) => r.path === this.selectedPath);
    if (selected) void this.renderDetail(detailPane, selected, seq);
  }

  private renderFilters(root: HTMLElement): void {
    const box = root.createDiv({ cls: "sm-card sm-review-filters" });
    const group = (label: string, chips: readonly [string, string][], get: () => string, set: (v: string) => void): void => {
      const row = box.createDiv({ cls: "sm-filter-group" });
      row.createSpan({ cls: "sm-filter-label", text: label });
      const chipRow = row.createDiv({ cls: "sm-filter-row" });
      for (const [value, text] of chips) {
        const chip = chipRow.createEl("button", { cls: "sm-fchip", text });
        chip.setAttribute("aria-pressed", String(get() === value));
        chip.onClickEvent(() => {
          set(value);
          this.render();
        });
      }
    };

    const setFilter = (patch: Partial<Filters>): void => {
      this.filters = { ...this.filters, ...patch };
    };

    group("기간", RANGE_CHIPS, () => this.filters.range, (v) => setFilter({ range: v as RangeFilter }));
    group(
      "세션",
      [["all", "전체"], ...Object.entries(SESSION_LABEL)] as [string, string][],
      () => this.filters.session,
      (v) => setFilter({ session: v as Filters["session"] }),
    );
    group(
      "상태",
      [
        ["all", "전체"],
        ["healthy", "양호"],
        ["watch", "관찰"],
        ["at-risk", "위험신호"],
        ["unknown", "미상"],
      ],
      () => this.filters.health,
      (v) => setFilter({ health: v }),
    );
    group(
      "위험",
      [
        ["all", "전체"],
        ["low", "낮음"],
        ["medium", "보통"],
        ["high", "높음"],
        ["critical", "심각"],
      ],
      () => this.filters.risk,
      (v) => setFilter({ risk: v }),
    );
    group(
      "데이터",
      [
        ["all", "전체"],
        ["complete", "완전"],
        ["partial", "일부"],
        ["failed", "실패"],
      ],
      () => this.filters.data,
      (v) => setFilter({ data: v }),
    );
  }

  private filteredRows(reviews: readonly ReviewRow[]): readonly ReviewRow[] {
    const { range, session, health, risk, data } = this.filters;
    // 기준일은 렌더 시점 — computeState 시점 값이면 자정 이후 필터가 하루 밀린다
    const today = toLocalDateString();
    const cutoff =
      range === "all"
        ? undefined
        : new Date(Date.parse(today) - (Number(range) - 1) * 86_400_000).toISOString().slice(0, 10);
    return reviews.filter(
      (r) =>
        (cutoff === undefined || r.date >= cutoff) &&
        (session === "all" || r.session === session) &&
        (health === "all" || r.health === health) &&
        (risk === "all" || r.riskLevel === risk) &&
        (data === "all" || r.dataStatus === data),
    );
  }

  /** 선택된 리뷰의 헤더·연결 정보·Markdown 본문. 본문은 frontmatter만 떼고 그대로 렌더한다. */
  private async renderDetail(pane: HTMLElement, review: ReviewRow, seq: number): Promise<void> {
    const state = this.plugin.state!;

    const header = pane.createDiv({ cls: "sm-review-head" });
    const line = header.createDiv({ cls: "sm-jline" });
    line.createSpan({ cls: "sm-act sm-act-deposit", text: SESSION_LABEL[review.session] ?? review.session });
    line.createSpan({ cls: "sm-jdate-inline", text: review.date });
    header.createDiv({ cls: "sm-review-title", text: review.headline || "(headline 없음)" });
    renderReviewBadges(header, review);
    const basis = reviewBasisText(review);
    if (basis) header.createDiv({ cls: "sm-basis", text: basis });
    if (review.superseded) {
      header.createDiv({
        cls: "sm-basis sm-warn-text",
        text: "같은 세션이 재실행되어 더 새 리뷰로 대체된 기록입니다.",
      });
    }
    if (review.supersedes) {
      header.createDiv({ cls: "sm-basis", text: `재실행 리뷰 — 이전 기록 ${review.supersedes} 대체` });
    }

    const memoBtn = header.createEl("button", { cls: "sm-textlink", text: "＋ 이 리뷰에 메모 남기기" });
    memoBtn.onClickEvent(() => void this.plugin.createReviewMemo(review));

    this.renderLinked(pane, review, state.trades, state.memos);

    if (!review.path) {
      pane.createDiv({ cls: "sm-basis", text: "노트 경로를 찾을 수 없어 본문을 표시하지 못했어요." });
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(review.path);
    if (!(file instanceof TFile)) {
      pane.createDiv({ cls: "sm-basis", text: "리뷰 노트 파일을 찾을 수 없어요." });
      return;
    }

    // 같은 파일·같은 수정본이면 렌더된 DOM을 그대로 다시 붙인다 (위임 핸들러도 노드에 남아 있음)
    if (this.mdCache && this.mdCache.path === review.path && this.mdCache.mtime === file.stat.mtime) {
      pane.appendChild(this.mdCache.el);
      return;
    }

    const body = pane.createDiv({ cls: "sm-review-md markdown-rendered" });
    // 내부 위키링크(근거 자료·Memos 링크)가 클릭으로 열리게 위임 핸들러 한 개만 단다
    const sourcePath = review.path;
    body.addEventListener("click", (evt) => {
      const link = (evt.target as HTMLElement).closest("a.internal-link");
      if (!(link instanceof HTMLAnchorElement)) return;
      evt.preventDefault();
      const target = link.getAttribute("data-href") ?? link.getAttribute("href");
      if (target) void this.app.workspace.openLinkText(target, sourcePath, false);
    });

    const raw = await this.app.vault.cachedRead(file);
    if (seq !== this.renderSeq) return; // 읽는 사이 다시 그려졌으면 버린다
    // frontmatter 경계는 Obsidian이 이미 계산한 위치를 신뢰 — BOM·YAML 내 '---' 변형에 안전
    const fmEnd = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
    const markdown =
      fmEnd !== undefined ? raw.slice(fmEnd) : raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    await MarkdownRenderer.render(this.app, markdown, body, sourcePath, this);
    this.mdCache = { path: sourcePath, mtime: file.stat.mtime, el: body };
  }

  /** 리뷰 날짜의 매매일지·이 리뷰를 가리키는 메모 목록 — 이동용 링크. */
  private renderLinked(
    pane: HTMLElement,
    review: ReviewRow,
    trades: readonly Trade[],
    memos: readonly Memo[],
  ): void {
    const state = this.plugin.state!;
    const dayTrades = trades.filter((t) => t.date === review.date);
    const reviewName = review.path ? noteBasename(review.path) : undefined;
    const linkedMemos = memos.filter(
      (m) => m.relatedReview !== undefined && (m.relatedReview === reviewName || m.relatedReview === review.reviewId),
    );
    if (dayTrades.length === 0 && linkedMemos.length === 0) return;

    const box = pane.createDiv({ cls: "sm-review-linked" });
    if (dayTrades.length > 0) {
      box.createDiv({ cls: "sm-filter-label", text: `이날의 매매 ${dayTrades.length}건` });
      const list = box.createDiv({ cls: "sm-journal sm-num" });
      for (const trade of dayTrades) {
        const row = list.createEl("button", { cls: "sm-jrow sm-jrow-btn" });
        if (trade.path) row.onClickEvent(() => this.plugin.openPath(trade.path!));
        const lineEl = row.createDiv({ cls: "sm-jline" });
        lineEl.createSpan({ cls: `sm-act sm-act-${trade.action}`, text: ACTION_LABEL[trade.action] ?? trade.action });
        lineEl.createSpan({ cls: "sm-jnm", text: trade.ticker ? (state.names[trade.ticker] ?? trade.ticker) : "현금" });
        const detail = tradeDetailText(trade); // 배당·입출금(amount-only)도 저널과 동일하게 표시
        if (detail) lineEl.createSpan({ cls: "sm-jdetail", text: detail });
      }
    }
    if (linkedMemos.length > 0) {
      box.createDiv({ cls: "sm-filter-label", text: `연결된 메모 ${linkedMemos.length}건` });
      const list = box.createDiv({ cls: "sm-journal sm-num" });
      for (const memo of linkedMemos) {
        const row = list.createEl("button", { cls: "sm-jrow sm-jrow-btn" });
        if (memo.path) row.onClickEvent(() => this.plugin.openPath(memo.path!));
        const lineEl = row.createDiv({ cls: "sm-jline" });
        lineEl.createSpan({ cls: "sm-jdate-inline", text: memo.date.slice(5).replace("-", ".") });
        lineEl.createSpan({ cls: "sm-jnm", text: memo.title });
      }
    }
  }
}
