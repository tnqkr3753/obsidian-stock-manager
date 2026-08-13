import { describe, expect, it } from "vitest";
import { computeState } from "../src/app/state";
import type { VaultSnapshot } from "../src/data/repository";
import type { WatchItem } from "../src/domain/types";

const snapshot = (watches: WatchItem[]): VaultSnapshot => ({
  trades: [],
  metas: {},
  macros: [],
  watches,
  config: {
    target: { stock: 0.6, bond: 0.2, cash: 0.2 },
    concentrationLimit: 0.4,
    baseCurrency: "KRW",
  },
  errors: [],
});

const watch = (partial: Partial<WatchItem>): WatchItem => ({
  ticker: "AAPL",
  name: "애플",
  currency: "KRW",
  tags: [],
  ...partial,
});

describe("computeState watch rows", () => {
  it("marks targetHit only when the quote currency matches the note currency", () => {
    const state = computeState(
      snapshot([watch({ currency: "KRW", targetPrice: 150000 })]),
      { AAPL: { price: 180, currency: "USD" } }, // 노트는 KRW를 주장하지만 시세는 USD
      { USD: 1400 },
      1,
    );
    expect(state.watchRows[0]!.targetHit).toBe(false);
    expect(state.watchRows[0]!.currencyMismatch).toBe(true);
    expect(state.watchRows[0]!.priceCurrency).toBe("USD");
  });

  it("marks targetHit when currencies match and price is at or below target", () => {
    const state = computeState(
      snapshot([watch({ currency: "USD", targetPrice: 180 })]),
      { AAPL: { price: 175, currency: "USD" } },
      { USD: 1400 },
      1,
    );
    expect(state.watchRows[0]!.targetHit).toBe(true);
    expect(state.watchRows[0]!.currencyMismatch).toBe(false);
  });
});
