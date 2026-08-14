import { ItemView, WorkspaceLeaf } from "obsidian";
import type StockManagerPlugin from "../../main";
import { formatTime } from "./format";
import {
  renderAccounts,
  renderAllocation,
  renderAssetFlow,
  renderCashflow,
  renderEvents,
  renderHero,
  renderHoldings,
  renderJournal,
  renderMacros,
  renderTags,
  renderTrend,
  renderWarnings,
  renderWatchlist,
} from "./render";

export const VIEW_TYPE_DASHBOARD = "stock-manager-dashboard";

/** 사이드바용 토스식 요약 대시보드. */
export class DashboardView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: StockManagerPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_DASHBOARD;
  }
  getDisplayText(): string {
    return "내 투자";
  }
  getIcon(): string {
    return "trending-up";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("sm-view");

    const state = this.plugin.state;
    const topbar = root.createDiv({ cls: "sm-topbar" });
    topbar.createEl("h1", { text: "내 투자" });
    const right = topbar.createDiv({ cls: "sm-topbar-right" });
    if (state?.lastUpdated) {
      right.createSpan({ cls: "sm-updated", text: `${formatTime(state.lastUpdated)} 기준` });
    }
    const refreshBtn = right.createEl("button", {
      cls: "sm-icon-btn",
      text: "⟳",
      attr: { "aria-label": "시세 새로고침" },
    });
    refreshBtn.onClickEvent(() => void this.plugin.refreshQuotes());

    if (!state || state.tradeCount === 0) {
      const empty = root.createDiv({ cls: "sm-card sm-empty" });
      empty.createDiv({ text: "아직 매매일지가 없어요." });
      empty.createDiv({
        cls: "sm-basis",
        text: "아래 버튼으로 기초 보유(opening)부터 기록하면 대시보드가 채워집니다.",
      });
    } else {
      const openPath = (path: string): void => this.plugin.openPath(path);
      // 흐름 중심 배치: 자산이 어떻게 흘러왔는지(흐름·시장 비교·현금흐름·계좌) → 지금 구성 → 상세
      renderHero(root, state);
      renderAssetFlow(root, this.plugin.assetFlow());
      renderTrend(root, this.plugin.snapshots(), this.plugin.benchmarkSeries());
      renderCashflow(root, state);
      renderAccounts(root, state);
      renderAllocation(root, state);
      renderHoldings(root, state, openPath, () => void this.plugin.openTableView());
      renderTags(root, state);
      renderWatchlist(root, state, openPath);
      renderEvents(root, state);
      renderJournal(root, state, openPath);
      renderMacros(root, state, openPath);
      renderWarnings(root, state);
    }

    const foot = root.createDiv({ cls: "sm-panel-foot" });
    const cta = foot.createEl("button", { cls: "sm-cta", text: "＋ 매매 기록" });
    cta.onClickEvent(() => this.plugin.openTradeModal());
  }
}
