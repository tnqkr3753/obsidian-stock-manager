import type { App, TFile } from "obsidian";
import { normalizePath } from "obsidian";
import type { MacroMemo, PortfolioConfig, StockMeta, Trade, WatchItem } from "../domain/types";
import { parseConfig, parseMacro, parseStockMeta, parseTrade, parseWatch } from "./parse";

export interface VaultSnapshot {
  trades: readonly Trade[];
  metas: Readonly<Record<string, StockMeta>>;
  macros: readonly MacroMemo[];
  watches: readonly WatchItem[];
  config: PortfolioConfig;
  errors: readonly string[];
}

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
    const macros: MacroMemo[] = [];
    const watches: WatchItem[] = [];
    const errors: string[] = [];
    let config = FALLBACK_CONFIG;

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
          if (r.ok) config = r.value;
          else errors.push(r.error);
          break;
        }
        case "macro": {
          const r = parseMacro(fm, file.path);
          if (r.ok) macros.push(r.value);
          else errors.push(r.error);
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

    return { trades, metas, macros, watches, config, errors };
  }

  /** 오늘 날짜의 경제 메모 노트를 만들고 경로를 반환한다. 이미 있으면 번호를 붙인다. */
  async createMacroNote(date: string): Promise<TFile> {
    const folder = normalizePath(`${this.getRootFolder()}/Macro`);
    await this.ensureFolder(folder);
    const content = [
      "---",
      "type: macro",
      `date: ${date}`,
      "tags: []",
      "---",
      "",
      "<!-- 금리·환율·실적 등 시장 메모. tags에 종목 태그와 같은 태그를 쓰면 서로 연결됩니다. -->",
      "",
    ].join("\n");
    return this.app.vault.create(await this.availablePath(folder, `${date} 경제 메모`), content);
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

    // 따옴표·역슬래시·줄바꿈이 그대로 들어가면 YAML이 깨져 노트가 조용히 무시된다
    const yamlString = (s: string): string =>
      `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;

    const lines = [
      "---",
      "type: trade",
      `date: ${trade.date}`,
      `action: ${trade.action}`,
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
