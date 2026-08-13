import type { FxMap, Position, Quote, QuoteMap, StockMeta, WatchItem } from "../domain/types";
import type { PersistedData } from "../settings";
import { fetchFxToKrw, fetchQuote, toYahooSymbol, type SymbolSource } from "./yahoo";

const CONCURRENCY = 4;

/** 시세가 필요한 티커 집합 — fetch 경로와 캐시 경로가 반드시 같은 규칙을 쓰도록 단일화. */
export const quoteTickers = (
  positions: readonly Position[],
  watches: readonly WatchItem[],
): string[] => [...new Set([...positions.map((p) => p.ticker), ...watches.map((w) => w.ticker)])];

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
    extraCurrencies: readonly string[] = [], // 외화 현금 등 포지션 밖에서 필요한 환율
    watches: readonly WatchItem[] = [], // 워치리스트도 시세 조회 대상
  ): Promise<{ quotes: QuoteMap; fx: FxMap }> {
    // 심볼 해석 정보는 "정의된 소스 우선": 종목 메타 > 워치 노트 > undefined.
    // 단순 Map 생성은 last-write-wins라 undefined가 워치의 market/yahooSymbol을 덮어쓸 수 있다.
    const symbolSources = new Map<string, SymbolSource | undefined>();
    const candidates: readonly [string, SymbolSource | undefined][] = [
      ...positions.map((p): [string, SymbolSource | undefined] => [p.ticker, metas[p.ticker]]),
      ...watches.map((w): [string, SymbolSource] => [w.ticker, w]),
    ];
    for (const [ticker, source] of candidates) {
      if (!symbolSources.has(ticker) || (symbolSources.get(ticker) === undefined && source)) {
        symbolSources.set(ticker, source);
      }
    }
    const tickers = quoteTickers(positions, watches);
    const currencies = [
      ...new Set(
        [...positions.map((p) => p.currency), ...extraCurrencies].filter((c) => c !== "KRW"),
      ),
    ];

    const quoteResults = await mapWithLimit(tickers, CONCURRENCY, async (ticker) => ({
      ticker,
      quote: await fetchQuote(toYahooSymbol(ticker, symbolSources.get(ticker))),
    }));
    const fxResults = await mapWithLimit(currencies, CONCURRENCY, async (currency) => ({
      currency,
      rate: await fetchFxToKrw(currency),
    }));

    const store = this.data();
    // 시세가 알려준 통화의 환율도 필요할 수 있다 (노트 currency 누락 시 quote.currency로 환산하므로)
    const quoteCurrencies = quoteResults
      .map((r) => r.quote?.currency)
      .filter((c): c is string => c !== undefined && c !== "KRW" && !currencies.includes(c));
    const extraFxResults = await mapWithLimit(
      [...new Set(quoteCurrencies)],
      CONCURRENCY,
      async (currency) => ({ currency, rate: await fetchFxToKrw(currency) }),
    );

    store.quoteCache = {
      ...store.quoteCache,
      ...Object.fromEntries(
        quoteResults
          .filter((r) => r.quote)
          .map(({ ticker, quote }) => [
            ticker,
            {
              price: quote!.price,
              currency: quote!.currency,
              changePct: quote!.changePct,
              asOf: quote!.asOf ?? Date.now(),
            },
          ]),
      ),
    };
    store.fxCache = {
      ...store.fxCache,
      ...Object.fromEntries(
        [...fxResults, ...extraFxResults]
          .filter((r) => r.rate !== undefined)
          .map(({ currency, rate }) => [currency, { rate: rate!, asOf: Date.now() }]),
      ),
    };
    await this.persist();

    return this.fromCache(tickers);
  }

  /** 네트워크 없이 캐시만으로 시세 맵을 만든다. 환율은 캐시 전체를 준다(초과분은 무해). */
  fromCache(tickers: readonly string[]): { quotes: QuoteMap; fx: FxMap } {
    const store = this.data();
    const quotes: Record<string, Quote> = {};
    for (const ticker of tickers) {
      const cached = store.quoteCache[ticker];
      if (cached) quotes[ticker] = { ...cached };
    }
    const fx = Object.fromEntries(
      Object.entries(store.fxCache).map(([currency, cached]) => [currency, cached.rate]),
    );
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
