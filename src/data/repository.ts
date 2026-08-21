import type { App, TFile } from "obsidian";
import { normalizePath } from "obsidian";
import type { Memo, MemoScope, PortfolioConfig, StockMeta, Trade, WatchItem } from "../domain/types";
import type { StockReview } from "../domain/review";
import { parseConfig, parseMemo, parseReview, parseStockMeta, parseTrade, parseWatch } from "./parse";

export interface VaultSnapshot {
  trades: readonly Trade[];
  metas: Readonly<Record<string, StockMeta>>;
  memos: readonly Memo[];
  reviews: readonly StockReview[];
  watches: readonly WatchItem[];
  config: PortfolioConfig;
  configPath?: string; // stock-config 노트 경로 — "목표 조정"이 이 노트를 연다
  errors: readonly string[];
  reviewErrors: readonly string[]; // errors 중 stock-review 파싱 실패분 — Reviews 뷰가 따로 표시
}

/** YAML 큰따옴표 스칼라 이스케이프 — 따옴표·역슬래시·줄바꿈이 노트를 깨지 않게. */
const yamlString = (s: string): string =>
  `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;

const FALLBACK_CONFIG: PortfolioConfig = {
  target: { stock: 0.6, bond: 0.2, cash: 0.2 },
  concentrationLimit: 0.4,
  checklist: [],
  baseCurrency: "KRW",
};

/** vault의 마크다운 frontmatter를 읽어 도메인 객체로 변환한다. 쓰기는 매매 노트 생성뿐이다. */
export class VaultRepository {
  constructor(
    private readonly app: App,
    private readonly getRootFolder: () => string,
    private readonly getTradesFolder: () => string,
  ) {}

  /** rootFolder 또는 tradesFolder 아래인지 — 스캔과 변경 감지가 같은 기준을 쓰도록 단일화. */
  isWatched(path: string): boolean {
    const roots = [normalizePath(this.getRootFolder()), normalizePath(this.getTradesFolder())];
    return roots.some((root) => root === "/" || root === "" || path === root || path.startsWith(root + "/"));
  }

  loadSnapshot(): VaultSnapshot {
    const trades: Trade[] = [];
    const metas: Record<string, StockMeta> = {};
    const memos: Memo[] = [];
    const reviews: StockReview[] = [];
    const watches: WatchItem[] = [];
    const errors: string[] = [];
    const reviewErrors: string[] = [];
    let config = FALLBACK_CONFIG;
    let configPath: string | undefined;

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isWatched(file.path)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || typeof fm["type"] !== "string") continue;
      // 작성 중인 노트는 draft: true로 표시하면 파싱 경고 없이 건너뛴다
      if (fm["draft"] === true) continue;

      switch (fm["type"]) {
        case "trade": {
          const r = parseTrade(fm, file.path);
          if (r.ok) trades.push(r.value);
          else errors.push(r.error);
          break;
        }
        case "stock": {
          const r = parseStockMeta(fm, file.path);
          if (r.ok) metas[r.value.ticker] = r.value;
          else errors.push(r.error);
          break;
        }
        case "stock-config": {
          const r = parseConfig(fm);
          if (r.ok) {
            config = r.value;
            configPath = file.path;
          } else errors.push(r.error);
          break;
        }
        // macro는 구 경제 메모 타입 — market 범위 메모로 계속 읽는다
        case "macro":
        case "memo": {
          const r = parseMemo(fm, file.path);
          if (r.ok) memos.push(r.value);
          else errors.push(r.error);
          break;
        }
        case "stock-review": {
          const r = parseReview(fm, file.path);
          if (r.ok) reviews.push(r.value);
          else {
            errors.push(r.error);
            reviewErrors.push(r.error);
          }
          break;
        }
        case "watch": {
          const r = parseWatch(fm, file.path);
          if (r.ok) watches.push(r.value);
          else errors.push(r.error);
          break;
        }
      }
    }

    return { trades, metas, memos, reviews, watches, config, configPath, errors, reviewErrors };
  }

  /**
   * 오늘 날짜의 메모 노트를 Memos 폴더에 만들고 경로를 반환한다. 이미 있으면 번호를 붙인다.
   * relatedReview를 주면 해당 리뷰에 연결된 후속 메모가 된다 ("이 리뷰에 메모 남기기").
   */
  async createMemoNote(
    date: string,
    // scope: stock은 ticker 없이는 파서가 거부하는 노트가 되므로 생성 API에서 제외 (필요해지면 ticker와 함께 추가)
    opts: { scope?: Exclude<MemoScope, "stock">; relatedReview?: string } = {},
  ): Promise<TFile> {
    const folder = normalizePath(`${this.getRootFolder()}/Memos`);
    await this.ensureFolder(folder);
    const scope = opts.scope ?? "market";
    const content = [
      "---",
      "type: memo",
      `date: ${date}`,
      `scope: ${scope}`,
      ...(opts.relatedReview
        ? [`relatedReview: ${yamlString(`[[${opts.relatedReview}]]`)}`, "tags: [리뷰후속]"]
        : ["tags: []"]),
      "---",
      "",
      opts.relatedReview
        ? "<!-- 리뷰를 읽고 든 생각·후속 판단을 남기세요. 리뷰 본문은 수정하지 않습니다. -->"
        : "<!-- 금리·환율·실적 등 시장 메모. scope를 portfolio/stock으로 바꿔 범위를 좁힐 수 있어요. tags에 종목 태그와 같은 태그를 쓰면 서로 연결됩니다. -->",
      "",
    ].join("\n");
    const base = opts.relatedReview ? `${date} 리뷰 메모` : `${date} 메모`;
    return this.app.vault.create(await this.availablePath(folder, base), content);
  }

  /** 파싱 성공 여부와 무관하게 vault의 stock-config 노트 경로를 찾는다 — 중복 생성·기존 설정 가림 방지. */
  findConfigNotePath(): string | undefined {
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.isWatched(file.path)) continue;
      if (this.app.metadataCache.getFileCache(file)?.frontmatter?.["type"] === "stock-config") {
        return file.path;
      }
    }
    return undefined;
  }

  /** 목표 배분(stock-config) 노트가 없을 때 기본 템플릿으로 생성한다. */
  async createConfigNote(): Promise<TFile> {
    const folder = normalizePath(this.getRootFolder());
    await this.ensureFolder(folder);
    const content = [
      "---",
      "type: stock-config",
      "target:",
      "  stock: 60",
      "  bond: 20",
      "  cash: 20",
      "concentrationLimit: 40",
      "checklist: []",
      "---",
      "",
      "<!-- target의 비율(%)을 바꾸면 자산 구성 카드의 목표·리밸런싱 제안이 바뀝니다. -->",
      "<!-- checklist에 항목을 넣으면 매수 기록 시 확인 목록으로 표시됩니다. -->",
      "",
    ].join("\n");
    return this.app.vault.create(await this.availablePath(folder, "포트폴리오 설정"), content);
  }

  /** 검색으로 고른 미등록 종목의 메타 노트를 자동 생성한다 (태그는 사용자가 추후 추가). */
  async createStockNote(hit: {
    ticker: string;
    name: string;
    market?: string;
    currency?: string;
    yahooSymbol?: string;
  }): Promise<TFile> {
    const folder = normalizePath(`${this.getRootFolder()}/Stocks`);
    await this.ensureFolder(folder);
    const content = [
      "---",
      "type: stock",
      `ticker: ${yamlString(hit.ticker)}`,
      `name: ${yamlString(hit.name)}`,
      ...(hit.market ? [`market: ${yamlString(hit.market)}`] : []),
      `currency: ${hit.currency ?? "KRW"}`,
      ...(hit.yahooSymbol && hit.yahooSymbol !== hit.ticker
        ? [`yahooSymbol: ${yamlString(hit.yahooSymbol)}`]
        : []),
      "tags: []",
      "---",
      "",
      "<!-- 종목 검색으로 자동 생성됨. tags에 태그를 달면 태그 노출 분석에 반영됩니다. -->",
      "",
    ].join("\n");
    return this.app.vault.create(await this.availablePath(folder, hit.name), content);
  }

  /** 워치 노트 초안을 만들고 경로를 반환한다. draft: true 동안은 스캔에서 제외된다. */
  async createWatchNote(): Promise<TFile> {
    const folder = normalizePath(`${this.getRootFolder()}/Watch`);
    await this.ensureFolder(folder);
    const content = [
      "---",
      "type: watch",
      "draft: true",
      'ticker: ""',
      'name: ""',
      "targetPrice: 0",
      "currency: KRW",
      "tags: []",
      "---",
      "",
      "<!-- ticker·name·targetPrice를 채우고 draft 줄을 지우면 워치리스트에 나타납니다. -->",
      "",
    ].join("\n");
    return this.app.vault.create(await this.availablePath(folder, "새 워치 종목"), content);
  }

  /** 월간 리포트 노트를 만들고 경로를 반환한다. */
  async createReportNote(month: string, markdown: string): Promise<TFile> {
    const folder = normalizePath(`${this.getRootFolder()}/Reports`);
    await this.ensureFolder(folder);
    return this.app.vault.create(await this.availablePath(folder, `${month} 투자 리포트`), markdown);
  }

  async createTradeNote(trade: Trade, memo: string): Promise<TFile> {
    const folder = normalizePath(this.getTradesFolder());
    await this.ensureFolder(folder);

    const lines = [
      "---",
      "type: trade",
      `date: ${trade.date}`,
      `action: ${trade.action}`,
      ...(trade.account ? [`account: ${yamlString(trade.account)}`] : []),
      ...(trade.ticker ? [`ticker: ${yamlString(trade.ticker)}`] : []),
      ...(trade.qty !== undefined ? [`qty: ${trade.qty}`] : []),
      ...(trade.price !== undefined ? [`price: ${trade.price}`] : []),
      ...(trade.amount !== undefined ? [`amount: ${trade.amount}`] : []),
      `currency: ${trade.currency}`,
      ...(trade.tags && trade.tags.length > 0
        ? [`tags: [${trade.tags.map(yamlString).join(", ")}]`]
        : []),
      "---",
      "",
      memo,
      "",
    ].join("\n");

    const base = `${trade.date} ${trade.action}${trade.ticker ? ` ${trade.ticker}` : ""}`;
    return this.app.vault.create(await this.availablePath(folder, base), lines);
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (this.app.vault.getFolderByPath(folder)) return;
    await this.app.vault.createFolder(folder).catch(() => undefined);
  }

  private async availablePath(folder: string, base: string): Promise<string> {
    const sanitized = base.replace(/[\\/:*?"<>|]/g, "-");
    for (let n = 0; ; n++) {
      const candidate = normalizePath(`${folder}/${sanitized}${n === 0 ? "" : ` ${n}`}.md`);
      if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
    }
  }
}
