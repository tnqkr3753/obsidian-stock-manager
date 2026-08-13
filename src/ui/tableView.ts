import { ItemView, WorkspaceLeaf } from "obsidian";
import type StockManagerPlugin from "../../main";
import type { HoldingRow } from "../domain/types";
import {
  formatKrw,
  formatNative,
  formatPct,
  formatQty,
  formatSignedKrw,
  formatSignedPct,
  signClass,
} from "./format";

export const VIEW_TYPE_TABLE = "stock-manager-table";

interface Column {
  key: string;
  label: string;
  sortValue?: (row: HoldingRow) => number | string;
  render: (cell: HTMLElement, row: HoldingRow, tags: readonly string[]) => void;
  total?: (rows: readonly HoldingRow[], cell: HTMLElement) => void;
}

const sum = (rows: readonly HoldingRow[], fn: (r: HoldingRow) => number): number =>
  rows.reduce((s, r) => s + fn(r), 0);

const COLUMNS: readonly Column[] = [
  {
    key: "name",
    label: "종목",
    sortValue: (r) => r.name,
    render: (cell, row) => {
      cell.addClass("sm-td-name");
      cell.createDiv({ cls: "sm-nm", text: row.name });
      cell.createDiv({
        cls: "sm-sub",
        text: [
          row.assetClass === "bond" ? "채권" : "주식",
          ...(row.currency !== "KRW" ? [row.currency] : []),
          ...(row.stale ? ["시세 없음"] : []),
        ].join(" · "),
      });
    },
    total: (_rows, cell) => cell.setText("합계"),
  },
  {
    key: "tags",
    label: "태그",
    render: (cell, _row, tags) => {
      cell.addClass("sm-td-tags");
      tags.forEach((t) => cell.createSpan({ cls: "sm-jtag", text: `#${t}` }));
    },
  },
  {
    key: "qty",
    label: "수량",
    sortValue: (r) => r.qty,
    render: (cell, row) => cell.setText(formatQty(row.qty)),
  },
  {
    key: "price",
    label: "평단 → 현재가",
    sortValue: (r) => r.price,
    render: (cell, row) =>
      cell.setText(`${formatNative(row.avgCost, row.currency)} → ${formatNative(row.price, row.currency)}`),
  },
  {
    key: "changePct",
    label: "당일",
    sortValue: (r) => r.changePct ?? 0,
    render: (cell, row) => {
      if (row.changePct === undefined) {
        cell.setText("—");
        cell.addClass("sm-muted");
      } else {
        cell.setText(formatSignedPct(row.changePct));
        cell.addClass(signClass(row.changePct));
      }
    },
  },
  {
    key: "costBasis",
    label: "매입금액",
    sortValue: (r) => r.costBasis,
    render: (cell, row) => {
      cell.setText(formatKrw(row.costBasis));
      cell.addClass("sm-muted");
    },
    total: (rows, cell) => cell.setText(formatKrw(sum(rows, (r) => r.costBasis))),
  },
  {
    key: "marketValue",
    label: "평가액",
    sortValue: (r) => r.marketValue,
    render: (cell, row) => {
      cell.setText(formatKrw(row.marketValue));
      cell.addClass("sm-strong");
    },
    total: (rows, cell) => cell.setText(formatKrw(sum(rows, (r) => r.marketValue))),
  },
  {
    key: "unrealizedPnl",
    label: "평가손익",
    sortValue: (r) => r.unrealizedPnl,
    render: (cell, row) => {
      cell.setText(formatSignedKrw(row.unrealizedPnl));
      cell.addClass(signClass(row.unrealizedPnl));
    },
    total: (rows, cell) => {
      const v = sum(rows, (r) => r.unrealizedPnl);
      cell.setText(formatSignedKrw(v));
      cell.addClass(signClass(v));
    },
  },
  {
    key: "returnPct",
    label: "수익률",
    sortValue: (r) => r.returnPct,
    render: (cell, row) => {
      cell.setText(formatSignedPct(row.returnPct));
      cell.addClass(signClass(row.returnPct));
    },
    total: (rows, cell) => {
      const cost = sum(rows, (r) => r.costBasis);
      const pnl = sum(rows, (r) => r.unrealizedPnl);
      cell.setText(cost > 0 ? formatSignedPct(pnl / cost) : "—");
      cell.addClass(signClass(pnl));
    },
  },
  {
    key: "realizedPnl",
    label: "실현손익",
    sortValue: (r) => r.realizedPnl,
    render: (cell, row) => {
      if (row.realizedPnl === 0) {
        cell.setText("—");
        cell.addClass("sm-muted");
      } else {
        cell.setText(formatSignedKrw(row.realizedPnl));
        cell.addClass(signClass(row.realizedPnl));
      }
    },
    total: (rows, cell) => cell.setText(formatSignedKrw(sum(rows, (r) => r.realizedPnl))),
  },
  {
    key: "dividends",
    label: "배당누적",
    sortValue: (r) => r.dividends,
    render: (cell, row) => {
      cell.setText(row.dividends === 0 ? "—" : formatKrw(row.dividends));
      if (row.dividends === 0) cell.addClass("sm-muted");
    },
    total: (rows, cell) => cell.setText(formatKrw(sum(rows, (r) => r.dividends))),
  },
  {
    key: "weight",
    label: "비중",
    sortValue: (r) => r.weight,
    render: (cell, row) => cell.setText(formatPct(row.weight)),
    total: (rows, cell) => cell.setText(formatPct(sum(rows, (r) => r.weight))),
  },
];

type Filter = "all" | "stock" | "bond";

/** 메인 탭용 HTS식 상세 테이블 뷰. 헤더 클릭 정렬, 자산군 필터, 합계 행. */
export class TableView extends ItemView {
  private sortKey = "marketValue";
  private sortDesc = true;
  private filter: Filter = "all";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: StockManagerPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TABLE;
  }
  getDisplayText(): string {
    return "보유 종목 상세";
  }
  getIcon(): string {
    return "table";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("sm-view", "sm-table-view");

    const state = this.plugin.state;
    if (!state || state.valuation.rows.length === 0) {
      root.createDiv({ cls: "sm-card sm-empty", text: "보유 종목이 없습니다." });
      return;
    }

    const bar = root.createDiv({ cls: "sm-filter-row" });
    (
      [
        ["all", "전체"],
        ["stock", "주식"],
        ["bond", "채권"],
      ] as const
    ).forEach(([value, label]) => {
      const chip = bar.createEl("button", { cls: "sm-fchip", text: label });
      chip.setAttribute("aria-pressed", String(this.filter === value));
      chip.onClickEvent(() => {
        this.filter = value;
        this.render();
      });
    });

    const rows = this.sortedRows(state.valuation.rows);
    const scroll = root.createDiv({ cls: "sm-table-scroll" });
    const table = scroll.createEl("table", { cls: "sm-htable sm-num" });

    const headRow = table.createEl("thead").createEl("tr");
    for (const col of COLUMNS) {
      const sorted = this.sortKey === col.key;
      const th = headRow.createEl("th", {
        text: col.label + (sorted ? (this.sortDesc ? " ▾" : " ▴") : ""),
      });
      if (sorted) th.addClass("sm-sorted");
      if (col.sortValue) {
        th.addClass("sm-sortable");
        th.onClickEvent(() => {
          if (this.sortKey === col.key) this.sortDesc = !this.sortDesc;
          else {
            this.sortKey = col.key;
            this.sortDesc = true;
          }
          this.render();
        });
      }
    }

    const tbody = table.createEl("tbody");
    for (const row of rows) {
      const tr = tbody.createEl("tr");
      if (row.path) tr.onClickEvent(() => this.plugin.openPath(row.path!));
      const tags = state.metas[row.ticker]?.tags ?? [];
      for (const col of COLUMNS) col.render(tr.createEl("td"), row, tags);
    }

    const totalRow = table.createEl("tfoot").createEl("tr");
    for (const col of COLUMNS) {
      const cell = totalRow.createEl("td");
      col.total?.(rows, cell);
    }

    root.createDiv({
      cls: "sm-foot",
      text: "해외 종목은 평단·현재가만 현지 통화, 금액 열은 원화 환산 · 헤더 클릭 정렬 · 행 클릭 시 종목 노트 열기",
    });
  }

  private sortedRows(rows: readonly HoldingRow[]): HoldingRow[] {
    const filtered = rows.filter((r) => this.filter === "all" || r.assetClass === this.filter);
    const col = COLUMNS.find((c) => c.key === this.sortKey);
    const value = col?.sortValue;
    if (!value) return [...filtered];

    const dir = this.sortDesc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb), "ko") * dir;
      }
      return (va - vb) * dir;
    });
  }
}
