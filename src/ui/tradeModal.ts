import { AbstractInputSuggest, Modal, Notice, Setting, type App } from "obsidian";
import type StockManagerPlugin from "../../main";
import { parseTrade } from "../data/parse";
import type { TradeAction } from "../domain/types";
import type { SymbolSearchHit } from "../price/symbolSearch";
import { toLocalDateString } from "../util/date";
import { TickerSuggest } from "./tickerSuggest";

const ACTION_OPTIONS: Record<TradeAction, string> = {
  buy: "매수",
  sell: "매도",
  opening: "기초 보유 (현금 미반영)",
  dividend: "배당",
  deposit: "입금",
  withdraw: "출금",
};

const needsTicker = (a: TradeAction): boolean =>
  ["buy", "sell", "opening", "dividend"].includes(a);
const needsQtyPrice = (a: TradeAction): boolean => ["buy", "sell", "opening"].includes(a);

/** 계좌 입력 자동완성 — 기존 매매일지에 등장한 계좌명을 제안한다. */
class AccountSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private readonly el: HTMLInputElement,
    private readonly accounts: readonly string[],
  ) {
    super(app, el);
  }
  getSuggestions(query: string): string[] {
    const lower = query.toLowerCase();
    return this.accounts.filter((a) => a.toLowerCase().includes(lower));
  }
  renderSuggestion(account: string, el: HTMLElement): void {
    el.setText(account);
  }
  selectSuggestion(account: string): void {
    this.el.value = account;
    this.el.trigger("input");
    this.close();
  }
}

/** 매매 기록 입력 → 매매일지 노트 생성. 검증은 parseTrade를 그대로 재사용한다. */
export class TradeModal extends Modal {
  private action: TradeAction = "buy";
  private date = toLocalDateString();
  private ticker = "";
  private qty = "";
  private price = "";
  private amount = "";
  private currency = "KRW";
  private account = "";
  private tags = "";
  private memo = "";
  private checks: boolean[] = [];
  private pickedHit: SymbolSearchHit | null = null; // 검색으로 고른 종목 (미등록이면 노트 자동 생성)

  constructor(private readonly plugin: StockManagerPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.titleEl.setText("매매 기록");
    this.modalEl.addClass("sm-modal");
    this.renderForm();
  }

  private renderForm(): void {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName("구분").addDropdown((dd) => {
      Object.entries(ACTION_OPTIONS).forEach(([value, label]) => dd.addOption(value, label));
      dd.setValue(this.action).onChange((value) => {
        this.action = value as TradeAction;
        this.renderForm();
      });
    });

    new Setting(contentEl).setName("날짜").addText((t) =>
      t.setValue(this.date).onChange((v) => (this.date = v)),
    );

    new Setting(contentEl)
      .setName("계좌")
      .setDesc("비우면 '기본'. 예: ISA, 신한, 연금")
      .addText((t) => {
        t.setPlaceholder("기본").setValue(this.account).onChange((v) => (this.account = v.trim()));
        const known = this.plugin.state?.accounts.map((a) => a.account) ?? [];
        if (known.length > 0) new AccountSuggest(this.app, t.inputEl, known);
      });

    if (needsTicker(this.action)) {
      new Setting(contentEl)
        .setName("종목")
        .setDesc("회사명이나 코드로 검색하세요 — 예: 삼성전자, AAPL")
        .addText((t) => {
          t.setPlaceholder("삼성전자").setValue(this.ticker).onChange((v) => (this.ticker = v.trim()));
          new TickerSuggest(this.app, t.inputEl, this.plugin, (hit) => {
            this.ticker = hit.ticker;
            this.pickedHit = hit;
            if (hit.currency) {
              this.currency = hit.currency;
              this.renderForm(); // 통화 드롭다운에 반영
            }
          });
        });
    }
    if (needsQtyPrice(this.action)) {
      new Setting(contentEl).setName("수량").addText((t) =>
        t.setPlaceholder("10").setValue(this.qty).onChange((v) => (this.qty = v)),
      );
      new Setting(contentEl).setName("단가 (종목 통화)").addText((t) =>
        t.setPlaceholder("71000").setValue(this.price).onChange((v) => (this.price = v)),
      );
    } else {
      new Setting(contentEl).setName("금액").addText((t) =>
        t.setPlaceholder("41200").setValue(this.amount).onChange((v) => (this.amount = v)),
      );
    }

    new Setting(contentEl).setName("통화").addDropdown((dd) => {
      ["KRW", "USD", "JPY", "EUR"].forEach((c) => dd.addOption(c, c));
      dd.setValue(this.currency).onChange((v) => (this.currency = v));
    });

    new Setting(contentEl)
      .setName("회고 태그")
      .setDesc("쉼표 구분. 예: 원칙매수, 분할매수")
      .addText((t) => t.setValue(this.tags).onChange((v) => (this.tags = v)));

    // 매수 전 체크리스트 — config 노트의 checklist 항목. 상태는 노트 본문에 기록된다.
    const checklist = this.action === "buy" ? (this.plugin.state?.config.checklist ?? []) : [];
    if (checklist.length > 0) {
      if (this.checks.length !== checklist.length) {
        this.checks = checklist.map(() => false);
      }
      contentEl.createEl("h3", { text: "매수 체크리스트", cls: "sm-checklist-title" });
      checklist.forEach((item, i) => {
        new Setting(contentEl).setName(item).addToggle((toggle) =>
          toggle
            .setValue(this.checks[i] ?? false)
            .onChange((v) => (this.checks = this.checks.map((c, idx) => (idx === i ? v : c)))),
        );
      });
    }

    new Setting(contentEl).setName("메모 (노트 본문)").addTextArea((t) => {
      t.setPlaceholder("매매 근거를 남겨두면 나중에 회고할 때 좋습니다.")
        .setValue(this.memo)
        .onChange((v) => (this.memo = v));
      t.inputEl.rows = 4;
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("기록하기")
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    const result = parseTrade(
      {
        type: "trade",
        date: this.date,
        action: this.action,
        account: this.account || undefined,
        ticker: this.ticker || undefined,
        qty: this.qty || undefined,
        price: this.price || undefined,
        amount: this.amount || undefined,
        currency: this.currency,
        tags: this.tags ? this.tags.split(",") : [],
      },
      "입력값",
    );
    if (!result.ok) {
      new Notice(result.error);
      return;
    }

    const checklist = this.action === "buy" ? (this.plugin.state?.config.checklist ?? []) : [];
    const memoWithChecklist =
      checklist.length > 0
        ? [
            this.memo,
            "",
            "### 매수 체크리스트",
            ...checklist.map((item, i) => `- [${this.checks[i] ? "x" : " "}] ${item}`),
          ]
            .join("\n")
            .trim()
        : this.memo;

    try {
      const file = await this.plugin.repository.createTradeNote(result.value, memoWithChecklist);
      // 검색으로 고른 미등록 종목이면 메타 노트를 함께 만들어 시세·태그 분석이 바로 동작하게
      const ticker = result.value.ticker;
      if (
        this.pickedHit &&
        ticker === this.pickedHit.ticker &&
        !this.plugin.state?.metas[ticker]
      ) {
        await this.plugin.repository
          .createStockNote(this.pickedHit)
          .then((stockFile) => new Notice(`종목 노트도 만들었어요: ${stockFile.basename}`))
          .catch(() => undefined); // 종목 노트 실패가 매매 기록 자체를 막지 않게
      }
      new Notice(`기록했어요: ${file.basename}`);
      this.close();
      await this.plugin.reload(true);
    } catch (e) {
      new Notice(`노트 생성에 실패했습니다: ${String(e)}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
