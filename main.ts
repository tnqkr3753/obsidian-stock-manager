import { Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, debounce } from "obsidian";
import { computeState, type PortfolioState } from "./src/app/state";
import { VaultRepository } from "./src/data/repository";
import { replayTrades } from "./src/domain/replay";
import { PriceService } from "./src/price/service";
import { DEFAULT_DATA, type AssetSnapshot, type PersistedData } from "./src/settings";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./src/ui/dashboardView";
import { renderAllocation, renderHero, renderHoldings } from "./src/ui/render";
import { TableView, VIEW_TYPE_TABLE } from "./src/ui/tableView";
import { TradeModal } from "./src/ui/tradeModal";
import { CsvImportModal } from "./src/ui/csvModal";

const MAX_SNAPSHOTS = 730;

export default class StockManagerPlugin extends Plugin {
  data: PersistedData = structuredClone(DEFAULT_DATA);
  repository!: VaultRepository;
  prices!: PriceService;
  state: PortfolioState | undefined;

  async onload(): Promise<void> {
    this.data = { ...structuredClone(DEFAULT_DATA), ...((await this.loadData()) ?? {}) };
    this.data.settings = { ...DEFAULT_DATA.settings, ...this.data.settings };

    this.repository = new VaultRepository(
      this.app,
      () => this.data.settings.rootFolder,
      () => this.data.settings.tradesFolder,
    );
    this.prices = new PriceService(
      () => this.data,
      () => this.saveData(this.data),
    );

    this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_TYPE_TABLE, (leaf) => new TableView(leaf, this));
    this.addRibbonIcon("trending-up", "주식 매니저 대시보드", () => void this.activateView(VIEW_TYPE_DASHBOARD, "right"));

    this.addCommand({
      id: "open-dashboard",
      name: "대시보드 열기",
      callback: () => void this.activateView(VIEW_TYPE_DASHBOARD, "right"),
    });
    this.addCommand({
      id: "open-table",
      name: "보유 종목 상세 테이블 열기",
      callback: () => void this.activateView(VIEW_TYPE_TABLE, "tab"),
    });
    this.addCommand({ id: "record-trade", name: "매매 기록", callback: () => this.openTradeModal() });
    this.addCommand({
      id: "import-csv",
      name: "CSV 가져오기 (거래내역)",
      callback: () => new CsvImportModal(this).open(),
    });
    this.addCommand({
      id: "refresh-quotes",
      name: "시세 새로고침",
      callback: () => void this.refreshQuotes(),
    });

    this.registerMarkdownCodeBlockProcessor("stock-portfolio", (_source, el) => {
      el.addClass("sm-view", "sm-embed");
      if (!this.state) {
        el.createDiv({ cls: "sm-basis", text: "주식 매니저 데이터를 불러오는 중입니다…" });
        return;
      }
      renderHero(el, this.state);
      renderAllocation(el, this.state);
      renderHoldings(el, this.state, (path) => this.openPath(path));
    });

    this.addSettingTab(new StockManagerSettingTab(this));

    const reloadDebounced = debounce(() => void this.reload(false), 800, true);
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file.path.startsWith(this.data.settings.rootFolder + "/")) reloadDebounced();
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      void this.reload(true);
      this.registerPolling();
    });
  }

  onunload(): void {
    // registerEvent/registerInterval로 등록된 리소스는 코어가 정리한다.
  }

  snapshots(): readonly AssetSnapshot[] {
    return this.data.snapshots;
  }

  openTradeModal(): void {
    new TradeModal(this).open();
  }

  openPath(path: string): void {
    void this.app.workspace.openLinkText(path, "", false);
  }

  /** vault 재스캔 → (선택) 시세 갱신 → 상태 재계산 → 열린 뷰 다시 그림. */
  async reload(withFetch = false): Promise<void> {
    const snapshot = this.repository.loadSnapshot();
    const replay = replayTrades(snapshot.trades);
    const tickers = replay.positions.map((p) => p.ticker);
    const currencies = [...new Set(replay.positions.map((p) => p.currency).filter((c) => c !== "KRW"))];

    const { quotes, fx } = withFetch
      ? await this.prices.refresh(replay.positions, snapshot.metas)
      : this.prices.fromCache(tickers, currencies);

    this.state = computeState(
      snapshot,
      quotes,
      fx,
      this.data.settings.rebalanceTolerance,
      this.prices.lastUpdatedAt(tickers),
    );

    if (withFetch && this.data.settings.snapshotEnabled && this.state.tradeCount > 0) {
      await this.recordSnapshot(this.state.valuation.totalAssets);
    }
    this.rerenderViews();
  }

  async refreshQuotes(): Promise<void> {
    new Notice("시세를 갱신하는 중…");
    await this.reload(true);
    new Notice("시세 갱신 완료");
  }

  private async recordSnapshot(totalAssets: number): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const rest = this.data.snapshots.filter((s) => s.date !== today);
    this.data.snapshots = [...rest, { date: today, totalAssets }]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-MAX_SNAPSHOTS);
    await this.saveData(this.data);
  }

  private rerenderViews(): void {
    for (const type of [VIEW_TYPE_DASHBOARD, VIEW_TYPE_TABLE]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const view = leaf.view;
        if (view instanceof DashboardView || view instanceof TableView) view.render();
      }
    }
  }

  private registerPolling(): void {
    const minutes = this.data.settings.refreshMinutes;
    if (minutes <= 0) return;
    this.registerInterval(
      window.setInterval(() => void this.reload(true), minutes * 60 * 1000),
    );
  }

  private async activateView(type: string, side: "right" | "tab"): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(type)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf: WorkspaceLeaf | null =
      side === "right" ? this.app.workspace.getRightLeaf(false) : this.app.workspace.getLeaf("tab");
    if (!leaf) return;
    await leaf.setViewState({ type, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}

class StockManagerSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: StockManagerPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.data.settings;
    const save = (): void => void this.plugin.saveData(this.plugin.data);

    new Setting(containerEl)
      .setName("데이터 폴더")
      .setDesc("이 폴더 아래의 trade/stock/config 노트를 스캔합니다.")
      .addText((t) =>
        t.setValue(s.rootFolder).onChange((v) => {
          s.rootFolder = v.trim() || "Stocks";
          save();
        }),
      );

    new Setting(containerEl)
      .setName("매매일지 폴더")
      .setDesc("매매 기록 버튼이 노트를 생성할 폴더.")
      .addText((t) =>
        t.setValue(s.tradesFolder).onChange((v) => {
          s.tradesFolder = v.trim() || "Stocks/Trades";
          save();
        }),
      );

    new Setting(containerEl)
      .setName("시세 갱신 주기 (분)")
      .setDesc("0이면 수동 새로고침만 사용합니다.")
      .addText((t) =>
        t.setValue(String(s.refreshMinutes)).onChange((v) => {
          const n = Number(v);
          s.refreshMinutes = Number.isFinite(n) && n >= 0 ? n : 5;
          save();
        }),
      );

    new Setting(containerEl)
      .setName("리밸런싱 허용 편차 (%p)")
      .setDesc("목표 배분과의 편차가 이 값 이하면 조정 제안을 하지 않습니다.")
      .addText((t) =>
        t.setValue(String(s.rebalanceTolerance)).onChange((v) => {
          const n = Number(v);
          s.rebalanceTolerance = Number.isFinite(n) && n >= 0 ? n : 1;
          save();
        }),
      );

    new Setting(containerEl)
      .setName("자산 스냅샷 기록")
      .setDesc("시세 갱신 시 하루 1회 총자산을 저장해 자산 추이 차트를 그립니다.")
      .addToggle((t) =>
        t.setValue(s.snapshotEnabled).onChange((v) => {
          s.snapshotEnabled = v;
          save();
        }),
      );

    containerEl.createEl("p", {
      cls: "sm-basis",
      text: "목표 배분·집중 경고 기준은 데이터 폴더의 stock-config 노트(frontmatter)에서 설정합니다.",
    });
  }
}
