import { Modal, Notice, Setting } from "obsidian";
import type StockManagerPlugin from "../../main";
import { parseTradesCsv } from "../data/csv";
import type { Trade } from "../domain/types";

/**
 * 증권사 거래내역 CSV → 매매일지 노트 일괄 생성.
 * 붙여넣기 또는 파일 선택 → 미리보기(건수·오류) → 확인 후 생성.
 */
export class CsvImportModal extends Modal {
  private text = "";
  private preview: { trades: readonly Trade[]; errors: readonly string[] } | null = null;
  private previewEl!: HTMLElement;
  private importBtn!: import("obsidian").ButtonComponent;

  constructor(private readonly plugin: StockManagerPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.titleEl.setText("CSV 가져오기");
    this.modalEl.addClass("sm-modal");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createDiv({
      cls: "sm-basis",
      text: "헤더: date, action(필수), ticker, qty, price, currency, amount, account(계좌), tags(세미콜론 구분)",
    });

    new Setting(contentEl).setName("CSV 파일").addButton((btn) =>
      btn.setButtonText("파일 선택").onClick(() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv,text/csv";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          this.text = await file.text();
          area.value = this.text;
          this.updatePreview();
        };
        input.click();
      }),
    );

    const area = contentEl.createEl("textarea", {
      cls: "sm-csv-area",
      attr: { rows: "8", placeholder: "또는 CSV 내용을 붙여넣으세요" },
    });
    area.value = this.text;
    // 입력마다 전체를 다시 그리면 textarea 포커스가 날아간다 — 미리보기·버튼만 갱신
    area.addEventListener("input", () => {
      this.text = area.value;
      this.updatePreview();
    });

    this.previewEl = contentEl.createDiv({ cls: "sm-csv-preview" });

    new Setting(contentEl).addButton((btn) => {
      this.importBtn = btn;
      btn
        .setButtonText("노트 생성")
        .setCta()
        .setDisabled(true)
        .onClick(() => void this.importAll());
    });

    this.updatePreview();
  }

  private updatePreview(): void {
    this.preview = this.text.trim() ? parseTradesCsv(this.text) : null;
    this.previewEl.empty();
    if (this.preview) {
      const { trades, errors } = this.preview;
      this.previewEl.createDiv({
        text: `읽은 매매 기록 ${trades.length}건, 오류 ${errors.length}건`,
      });
      errors.slice(0, 5).forEach((e) => this.previewEl.createDiv({ cls: "sm-basis", text: e }));
    }
    const count = this.preview?.trades.length ?? 0;
    this.importBtn.setButtonText(count > 0 ? `${count}건 노트 생성` : "노트 생성");
    this.importBtn.setDisabled(count === 0);
  }

  private async importAll(): Promise<void> {
    if (!this.preview) return;
    let created = 0;
    for (const trade of this.preview.trades) {
      try {
        await this.plugin.repository.createTradeNote(trade, "CSV 가져오기로 생성됨");
        created++;
      } catch (e) {
        new Notice(`생성 실패 (${trade.date} ${trade.action}): ${String(e)}`);
      }
    }
    new Notice(`매매일지 노트 ${created}건을 만들었어요.`);
    this.close();
    await this.plugin.reload();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
