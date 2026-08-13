import { Modal, Notice, Setting } from "obsidian";
import type StockManagerPlugin from "../../main";
import { parseTrade } from "../data/parse";
import type { TradeAction } from "../domain/types";
import { toLocalDateString } from "../util/date";

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

/** 매매 기록 입력 → 매매일지 노트 생성. 검증은 parseTrade를 그대로 재사용한다. */
export class TradeModal extends Modal {
  private action: TradeAction = "buy";
  private date = toLocalDateString();
  private ticker = "";
  private qty = "";
  private price = "";
  private amount = "";
  private currency = "KRW";
  private tags = "";
  private memo = "";
  private checks: boolean[] = [];

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

    if (needsTicker(this.action)) {
      new Setting(contentEl)
        .setName("종목 코드")
        .setDesc("예: 005930, AAPL — 종목 노트의 ticker와 일치해야 합니다")
        .addText((t) => t.setValue(this.ticker).onChange((v) => (this.ticker = v.trim())));
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
      new Notice(`기록했어요: ${file.basename}`);
      this.close();
      await this.plugin.reload();
    } catch (e) {
      new Notice(`노트 생성에 실패했습니다: ${String(e)}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
