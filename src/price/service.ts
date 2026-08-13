import type { FxMap, Position, Quote, QuoteMap, StockMeta } from "../domain/types";
import type { PersistedData } from "../settings";
import { fetchFxToKrw, fetchQuote, toYahooSymbol } from "./yahoo";

const CONCURRENCY = 4;

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 보유 종목 시세 + 환율을 갱신한다. 실패한 심볼은 캐시(마지막 가격)로 대체해
 * 오프라인에서도 대시보드가 마지막 상태로 그려지게 한다.
 */
export class PriceService {
  constructor(
    private readonly data: () => PersistedData,
    private readonly persist: () => Promise<void>,
  ) {}

  async refresh(
    positions: readonly Position[],
    metas: Readonly<Record<string, StockMeta>>,
  ): Promise<{ quotes: QuoteMap; fx: FxMap }> {
    const tickers = positions.map((p) => p.ticker);
    const currencies = [
      ...new Set(positions.map((p) => p.currency).filter((c) => c !== "KRW")),
    ];

    const quoteResults = await mapWithLimit(tickers, CONCURRENCY, async (ticker) => ({
      ticker,
      quote: await fetchQuote(toYahooSymbol(ticker, metas[ticker])),
    }));
    const fxResults = await mapWithLimit(currencies, CONCURRENCY, async (currency) => ({
      currency,
      rate: await fetchFxToKrw(currency),
    }));

    const store = this.data();
    for (const { ticker, quote } of quoteResults) {
      if (quote) {
        store.quoteCache[ticker] = {
          price: quote.price,
          currency: quote.currency,
          changePct: quote.changePct,
          asOf: quote.asOf ?? Date.now(),
        };
      }
    }
    for (const { currency, rate } of fxResults) {
      if (rate !== undefined) store.fxCache[currency] = { rate, asOf: Date.now() };
    }
    await this.persist();

    return this.fromCache(tickers, currencies);
  }

  /** 네트워크 없이 캐시만으로 시세 맵을 만든다. */
  fromCache(tickers: readonly string[], currencies: readonly string[]): { quotes: QuoteMap; fx: FxMap } {
    const store = this.data();
    const quotes: Record<string, Quote> = {};
    for (const ticker of tickers) {
      const cached = store.quoteCache[ticker];
      if (cached) quotes[ticker] = { ...cached };
    }
    const fx: Record<string, number> = {};
    for (const currency of currencies) {
      const cached = store.fxCache[currency];
      if (cached) fx[currency] = cached.rate;
    }
    return { quotes, fx };
  }

  lastUpdatedAt(tickers: readonly string[]): number | undefined {
    const store = this.data();
    const times = tickers
      .map((t) => store.quoteCache[t]?.asOf)
      .filter((t): t is number => t !== undefined);
    return times.length > 0 ? Math.max(...times) : undefined;
  }
}
