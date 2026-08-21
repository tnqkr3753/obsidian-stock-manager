import {
  MarkdownRenderChild,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import { computeState, type PortfolioState } from "./src/app/state";
import { VaultRepository } from "./src/data/repository";
import { SnapshotStore } from "./src/data/snapshotStore";
import { buildAssetFlow, type AssetFlow } from "./src/domain/assetFlow";
import type { BenchSeries } from "./src/domain/benchmark";
import { replayTrades } from "./src/domain/replay";
import { buildMonthlyReportMarkdown, computeMonthlyReport } from "./src/domain/report";
import { PriceService, quoteTickers } from "./src/price/service";
import { DEFAULT_DATA, type AssetSnapshot, type PersistedData } from "./src/settings";
import type { ReviewRow } from "./src/domain/review";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./src/ui/dashboardView";
import { renderAllocation, renderHero, renderHoldings } from "./src/ui/render";
import { ReviewsView, VIEW_TYPE_REVIEWS } from "./src/ui/reviewsView";
import { TableView, VIEW_TYPE_TABLE } from "./src/ui/tableView";
import { TradeModal } from "./src/ui/tradeModal";
import { CsvImportModal } from "./src/ui/csvModal";
import { toLocalDateString } from "./src/util/date";
import { noteBasename } from "./src/util/path";

const MAX_SNAPSHOTS = 730;

/** stock-portfolio 코드블록 — 노트가 열려 있는 동안 상태 변경 시 다시 그린다. */
class PortfolioEmbed extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private readonly plugin: StockManagerPlugin,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.plugin.embeds.add(this);
    this.render();
  }
  onunload(): void {
    this.plugin.embeds.delete(this);
  }

  render(): void {
    const el = this.containerEl;
    el.empty();
    el.addClass("sm-view", "sm-embed");
    const state = this.plugin.state;
    if (!state) {
      el.createDiv({ cls: "sm-basis", text: "주식 매니저 데이터를 불러오는 중입니다…" });
      return;
    }
    renderHero(el, state);
    renderAllocation(el, state);
    renderHoldings(el, state, (path) => this.plugin.openPath(path));
  }
}

export default class StockManagerPlugin extends Plugin {
  data: PersistedData = structuredClone(DEFAULT_DATA);
  repository!: VaultRepository;
  prices!: PriceService;
  state: PortfolioState | undefined;
  embeds = new Set<PortfolioEmbed>();
  private pollingId: number | null = null;
  private snapshotStore!: SnapshotStore;
  private snapshotList: AssetSnapshot[] = [];
  private snapshotsReady = false; // loadSnapshots 완료 전 저장·리포트 차단 (빈 리스트로 이력 덮어쓰기 방지)
  private snapshotsWritable = true; // 파일 파싱 실패 시 false — 저장하면 이력이 파괴되므로 읽기 전용
  private flow: AssetFlow = { points: [], latestProfit: 0, hasInvested: false, fxIncomplete: false };

  async onload(): Promise<void> {
    this.data = { ...structuredClone(DEFAULT_DATA), ...((await this.loadData()) ?? {}) };
    this.data.settings = { ...DEFAULT_DATA.settings, ...this.data.settings };

    this.repository = new VaultRepository(
      this.app,
      () => this.data.settings.rootFolder,
      () => this.data.settings.tradesFolder,
    );
    this.snapshotStore = new SnapshotStore(this.app, () => this.data.settings.rootFolder);
    this.prices = new PriceService(
      () => this.data,
      () => this.saveData(this.data),
    );

    this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_TYPE_TABLE, (leaf) => new TableView(leaf, this));
    this.registerView(VIEW_TYPE_REVIEWS, (leaf) => new ReviewsView(leaf, this));
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
    this.addCommand({
      // 구 "경제 메모 작성" — id를 유지해 기존 단축키가 깨지지 않게 한다
      id: "new-macro-memo",
      name: "메모 작성",
      callback: () => void this.createMemo(),
    });
    this.addCommand({
      id: "open-reviews",
      name: "리뷰 보기 열기",
      callback: () => void this.activateView(VIEW_TYPE_REVIEWS, "tab"),
    });
    this.addCommand({
      id: "open-target-config",
      name: "포트폴리오 목표 설정 열기",
      callback: () => void this.openConfigNote(),
    });
    this.addCommand({
      id: "new-watch-note",
      name: "워치 종목 추가",
      callback: () => void this.createWatchNote(),
    });
    this.addCommand({
      id: "monthly-report",
      name: "월간 리포트 생성 (지난달)",
      callback: () => void this.createMonthlyReport(),
    });

    this.registerMarkdownCodeBlockProcessor("stock-portfolio", (_source, el, ctx) => {
      ctx.addChild(new PortfolioEmbed(el, this));
    });

    this.addSettingTab(new StockManagerSettingTab(this));

    const reloadDebounced = debounce(() => void this.reload(false), 800, true);
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (this.repository.isWatched(file.path)) reloadDebounced();
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        // 어느 단계가 실패해도 폴링은 반드시 시작돼야 한다 — 조용한 전면 정지 방지
        try {
          await this.loadSnapshots();
        } catch (e) {
          console.error("[stock-manager] 스냅샷 로드 실패", e);
          this.snapshotsWritable = false;
          new Notice("자산 스냅샷 로드에 실패해 스냅샷 저장을 중단합니다.");
        }
        try {
          await this.reload(true);
        } catch (e) {
          console.error("[stock-manager] 초기 로드 실패", e);
          new Notice("주식 매니저 초기 로드에 실패했습니다. 콘솔을 확인해주세요.");
        }
        this.restartPolling();
      })();
    });
  }

  onunload(): void {
    // registerEvent/registerInterval로 등록된 리소스는 코어가 정리한다.
  }

  snapshots(): readonly AssetSnapshot[] {
    return this.snapshotList;
  }

  benchmarkSeries(): readonly BenchSeries[] {
    return this.prices.benchSeries(this.data.settings.benchmarks);
  }

  assetFlow(): AssetFlow {
    return this.flow;
  }

  async openTableView(): Promise<void> {
    await this.activateView(VIEW_TYPE_TABLE, "tab");
  }

  /** vault의 snapshots.json을 원본으로 로드하고, 구버전 data.json 스냅샷은 1회 머지 후 비운다. */
  private async loadSnapshots(): Promise<void> {
    const { snapshots: vaultSnapshots, healthy } = await this.snapshotStore.load();
    this.snapshotsWritable = healthy;
    if (!healthy) {
      new Notice(
        "snapshots.json을 읽지 못했습니다 — 이력 보호를 위해 스냅샷 저장을 중단합니다. 파일을 확인해주세요.",
        10_000,
      );
    }
    this.snapshotList = this.snapshotStore
      .merge(vaultSnapshots, this.data.snapshots)
      .slice(-MAX_SNAPSHOTS);
    if (healthy && this.data.snapshots.length > 0) {
      await this.snapshotStore.save(this.snapshotList);
      this.data.snapshots = [];
      await this.saveData(this.data);
    }
    this.snapshotsReady = true;
  }

  /** 데이터 폴더 변경 시 스냅샷 파일을 따라 옮긴다 — 안 옮기면 이력이 실종된 것처럼 보인다. */
  async handleRootFolderChange(oldRoot: string): Promise<void> {
    try {
      await this.snapshotStore.moveFrom(oldRoot);
    } catch (e) {
      console.error("[stock-manager] snapshots.json 이동 실패", e);
      new Notice(`snapshots.json을 새 폴더로 옮기지 못했습니다: ${String(e)}`);
    }
  }

  /** 스냅샷 구간 길이에 맞는 야후 range 파라미터. */
  private benchRange(): string {
    const first = this.snapshotList[0]?.date;
    if (!first) return "3mo";
    const days = (Date.now() - Date.parse(first)) / 86_400_000;
    return days < 95 ? "3mo" : days < 185 ? "6mo" : days < 370 ? "1y" : "2y";
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
    const tickers = quoteTickers(replay.positions, snapshot.watches);
    const cashCurrencies = Object.keys(replay.cash).filter((c) => c !== "KRW");

    if (withFetch) {
      await this.prices.refreshBenchmarks(this.data.settings.benchmarks, this.benchRange());
    }
    const { quotes, fx } = withFetch
      ? await this.prices.refresh(replay.positions, snapshot.metas, cashCurrencies, snapshot.watches)
      : this.prices.fromCache(tickers);

    this.state = computeState(
      snapshot,
      quotes,
      fx,
      this.data.settings.rebalanceTolerance,
      // 기준 시각은 valuation이 실제로 쓰는 보유 종목 시세만 반영 (워치 시세가 신선도를 가리지 않도록)
      this.prices.lastUpdatedAt(replay.positions.map((p) => p.ticker)),
    );

    if (withFetch && this.data.settings.snapshotEnabled && this.state.tradeCount > 0) {
      await this.recordSnapshot(this.state.valuation.totalAssets);
    }
    this.flow = buildAssetFlow(this.snapshotList, snapshot.trades, fx);
    this.rerenderViews();
  }

  /** 설정 변경 등에서 호출하는 디바운스된 시세 갱신 (키 입력마다 fetch가 나가지 않게). */
  requestQuoteRefresh = debounce(() => void this.reload(true), 2500, true);

  async refreshQuotes(): Promise<void> {
    new Notice("시세를 갱신하는 중…");
    await this.reload(true);
    new Notice("시세 갱신 완료");
  }

  async createMemo(): Promise<void> {
    try {
      const file = await this.repository.createMemoNote(toLocalDateString());
      this.openPath(file.path);
    } catch (e) {
      new Notice(`메모 생성에 실패했습니다: ${String(e)}`);
    }
  }

  /** "이 리뷰에 메모 남기기" — 리뷰 본문은 불변으로 두고 연결된 후속 메모를 만든다. */
  async createReviewMemo(review: ReviewRow): Promise<void> {
    const reviewName = review.path ? noteBasename(review.path) : review.reviewId;
    try {
      const file = await this.repository.createMemoNote(toLocalDateString(), {
        scope: "portfolio",
        relatedReview: reviewName,
      });
      this.openPath(file.path);
    } catch (e) {
      new Notice(`리뷰 메모 생성에 실패했습니다: ${String(e)}`);
    }
  }

  /** 목표 배분(stock-config) 노트를 연다 — 없으면 기본 템플릿으로 만들어 연다. */
  async openConfigNote(): Promise<void> {
    // state.configPath는 파싱 성공본만 안다 — 로드 전이나 파싱 실패한 config 노트가 있어도
    // 새로 만들면 기존 설정을 가리므로 vault를 직접 확인한다
    const existing = this.repository.findConfigNotePath();
    if (existing) {
      this.openPath(existing);
      return;
    }
    try {
      const file = await this.repository.createConfigNote();
      new Notice("목표 배분 노트를 만들었어요 — target 비율을 수정해보세요.");
      this.openPath(file.path);
    } catch (e) {
      new Notice(`설정 노트 생성에 실패했습니다: ${String(e)}`);
    }
  }

  async openReviewsView(): Promise<void> {
    await this.activateView(VIEW_TYPE_REVIEWS, "tab");
  }

  private async createWatchNote(): Promise<void> {
    try {
      const file = await this.repository.createWatchNote();
      this.openPath(file.path);
    } catch (e) {
      new Notice(`워치 노트 생성에 실패했습니다: ${String(e)}`);
    }
  }

  /** 지난달 매매·손익·자산 변화를 집계한 리포트 노트를 생성하고 연다. */
  private async createMonthlyReport(): Promise<void> {
    if (!this.snapshotsReady) {
      new Notice("스냅샷을 아직 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = toLocalDateString(prev).slice(0, 7);

    const snapshot = this.repository.loadSnapshot();
    const replay = replayTrades(snapshot.trades);
    const report = computeMonthlyReport({
      trades: snapshot.trades,
      sellEvents: replay.sellEvents,
      snapshots: this.snapshotList,
      month,
    });

    try {
      const file = await this.repository.createReportNote(
        month,
        buildMonthlyReportMarkdown(report),
      );
      new Notice(`${month} 리포트를 만들었어요.`);
      this.openPath(file.path);
    } catch (e) {
      new Notice(`리포트 생성에 실패했습니다: ${String(e)}`);
    }
  }

  private async recordSnapshot(totalAssets: number): Promise<void> {
    // 로드 완료 전(빈 리스트)이나 파일 손상 상태에서 저장하면 동기화된 이력을 덮어써 파괴한다
    if (!this.snapshotsReady || !this.snapshotsWritable) return;

    const today = toLocalDateString();
    const existing = this.snapshotList.find((s) => s.date === today);
    if (existing && existing.totalAssets === totalAssets) return; // 무변경 재작성은 동기화 낭비

    this.snapshotList = [...this.snapshotList.filter((s) => s.date !== today), { date: today, totalAssets }]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-MAX_SNAPSHOTS);
    try {
      await this.snapshotStore.save(this.snapshotList);
    } catch (e) {
      // 저장 실패가 reload 전체(뷰 갱신 포함)를 중단시키면 안 된다
      console.error("[stock-manager] 스냅샷 저장 실패", e);
      new Notice(`자산 스냅샷 저장에 실패했습니다: ${String(e)}`);
    }
  }

  private rerenderViews(): void {
    for (const type of [VIEW_TYPE_DASHBOARD, VIEW_TYPE_TABLE, VIEW_TYPE_REVIEWS]) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const view = leaf.view;
        if (view instanceof DashboardView || view instanceof TableView || view instanceof ReviewsView) {
          view.render();
        }
      }
    }
    this.embeds.forEach((embed) => embed.render());
  }

  /** 설정에서 주기가 바뀌어도 즉시 반영되도록 기존 인터벌을 지우고 다시 건다. */
  restartPolling(): void {
    if (this.pollingId !== null) {
      window.clearInterval(this.pollingId);
      this.pollingId = null;
    }
    const minutes = this.data.settings.refreshMinutes;
    if (minutes <= 0) return;
    this.pollingId = window.setInterval(() => void this.reload(true), minutes * 60 * 1000);
    this.registerInterval(this.pollingId);
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
      .setDesc("이 폴더 아래의 trade/stock/config 노트를 스캔합니다. 스냅샷 파일도 함께 이동합니다.")
      .addText((t) =>
        t.setValue(s.rootFolder).onChange((v) => {
          const oldRoot = s.rootFolder;
          s.rootFolder = v.trim() || "Stocks";
          save();
          if (oldRoot !== s.rootFolder) void this.plugin.handleRootFolderChange(oldRoot);
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
          this.plugin.restartPolling();
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
      .setName("벤치마크")
      .setDesc("자산 추이에 겹칠 지수. '심볼=라벨' 쉼표 구분, 최대 2개 표시. 예: ^KS11=KOSPI, ^GSPC=S&P500")
      .addText((t) =>
        t
          .setValue(s.benchmarks.map((b) => `${b.symbol}=${b.label}`).join(", "))
          .onChange((v) => {
            s.benchmarks = v
              .split(",")
              .map((part) => part.trim())
              .filter((part) => part !== "")
              .map((part) => {
                // 야후 심볼에도 '='가 들어간다 (GC=F 등) — 마지막 '='만 라벨 구분자로 취급
                const cut = part.lastIndexOf("=");
                const symbol = (cut < 0 ? part : part.slice(0, cut)).trim();
                const label = (cut < 0 ? "" : part.slice(cut + 1)).trim() || symbol;
                return { symbol, label };
              })
              .filter((b) => b.symbol !== "");
            save();
            this.plugin.requestQuoteRefresh(); // 새 벤치마크가 다음 폴링까지 빈 채로 남지 않도록
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
      text: "목표 배분·집중 경고 기준은 stock-config 노트에서 설정합니다 — 대시보드 자산 구성 카드의 \"목표 조정\" 버튼이 노트를 열어줍니다 (없으면 생성).",
    });
  }
}
