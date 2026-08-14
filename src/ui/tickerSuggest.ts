import { AbstractInputSuggest, type App } from "obsidian";
import type StockManagerPlugin from "../../main";
import { searchKrSymbols, searchSymbols } from "../price/yahoo";
import type { SymbolSearchHit } from "../price/symbolSearch";

/**
 * 종목 코드 입력 자동완성 — vault에 이미 있는 종목(메타·워치)을 먼저 보여주고,
 * 이어서 야후 심볼 검색(한글 회사명 지원) 결과를 붙인다. 선택하면 코드·통화가 자동 입력된다.
 */
export class TickerSuggest extends AbstractInputSuggest<SymbolSearchHit> {
  private remoteCache = new Map<string, SymbolSearchHit[]>();

  constructor(
    app: App,
    private readonly inputEl: HTMLInputElement,
    private readonly plugin: StockManagerPlugin,
    private readonly onPick: (hit: SymbolSearchHit) => void,
  ) {
    super(app, inputEl);
  }

  private vaultHits(query: string): SymbolSearchHit[] {
    const state = this.plugin.state;
    if (!state) return [];
    const lower = query.toLowerCase();
    const known = [
      ...Object.values(state.metas).map((m) => ({
        ticker: m.ticker,
        name: m.name,
        market: m.market,
        currency: m.currency,
        yahooSymbol: m.yahooSymbol ?? m.ticker,
      })),
      ...state.watchRows.map((w) => ({
        ticker: w.ticker,
        name: w.name,
        market: undefined,
        currency: w.currency,
        yahooSymbol: w.ticker,
      })),
    ];
    const unique = new Map(known.map((h) => [h.ticker, h]));
    return [...unique.values()].filter(
      (h) => h.ticker.toLowerCase().includes(lower) || h.name.toLowerCase().includes(lower),
    );
  }

  async getSuggestions(query: string): Promise<SymbolSearchHit[]> {
    const trimmed = query.trim();
    if (trimmed.length < 1) return [];

    const local = this.vaultHits(trimmed);
    if (trimmed.length < 2) return local; // 원격 검색은 2자부터 (요청 낭비 방지)

    let remote = this.remoteCache.get(trimmed);
    if (!remote) {
      // 국내(네이버, 한글명)를 먼저, 해외(야후)를 뒤에 — 코드 중복 시 한글명이 이긴다
      const [kr, global] = await Promise.all([searchKrSymbols(trimmed), searchSymbols(trimmed)]);
      const krTickers = new Set(kr.map((h) => h.ticker));
      remote = [...kr, ...global.filter((h) => !krTickers.has(h.ticker))];
      this.remoteCache.set(trimmed, remote);
    }
    const localTickers = new Set(local.map((h) => h.ticker));
    return [...local, ...remote.filter((h) => !localTickers.has(h.ticker))].slice(0, 10);
  }

  renderSuggestion(hit: SymbolSearchHit, el: HTMLElement): void {
    el.addClass("sm-ticker-suggestion");
    el.createDiv({ cls: "sm-nm", text: hit.name });
    el.createDiv({
      cls: "sm-sub",
      text: [hit.ticker, hit.market, hit.currency].filter(Boolean).join(" · "),
    });
  }

  selectSuggestion(hit: SymbolSearchHit): void {
    this.inputEl.value = hit.ticker;
    this.inputEl.trigger("input");
    this.onPick(hit);
    this.close();
  }
}
