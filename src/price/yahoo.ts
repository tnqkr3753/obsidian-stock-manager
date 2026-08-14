import { requestUrl } from "obsidian";
import type { Quote } from "../domain/types";
import {
  mapNaverItem,
  mapSearchQuote,
  type RawNaverItem,
  type RawSearchQuote,
  type SymbolSearchHit,
} from "./symbolSearch";

/** 심볼 해석에 필요한 최소 정보 — StockMeta와 WatchItem 둘 다 만족한다. */
export interface SymbolSource {
  market?: string;
  yahooSymbol?: string;
}

/**
 * Yahoo Finance 심볼 규칙: 국내 6자리 코드는 .KS(코스피)/.KQ(코스닥) 접미사가 필요하다.
 * 종목 노트의 yahooSymbol이 있으면 그대로 쓰고, 없으면 market으로 추정한다.
 */
export function toYahooSymbol(ticker: string, meta?: SymbolSource): string {
  if (meta?.yahooSymbol) return meta.yahooSymbol;
  if (/^\d{6}$/.test(ticker)) {
    return meta?.market?.toUpperCase() === "KOSDAQ" ? `${ticker}.KQ` : `${ticker}.KS`;
  }
  return ticker;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currency?: string;
        regularMarketTime?: number;
        shortName?: string;
        longName?: string;
      };
    }>;
  };
}

async function fetchChartMeta(symbol: string): Promise<Quote | undefined> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await requestUrl({ url, throw: false });
  if (res.status !== 200) return undefined;

  const meta = (res.json as YahooChartResponse).chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  // 0/null은 거래정지·상장폐지 등 비정상 응답 — 캐시에 들어가면 -100% 가짜 손실이 영속된다
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return undefined;

  const prev = meta?.chartPreviousClose ?? meta?.previousClose;
  return {
    price,
    currency: (meta?.currency ?? "KRW").toUpperCase(),
    changePct: typeof prev === "number" && prev > 0 ? (price - prev) / prev : undefined,
    asOf: (meta?.regularMarketTime ?? Math.floor(Date.now() / 1000)) * 1000,
    name: meta?.longName ?? meta?.shortName,
  };
}

export async function fetchQuote(symbol: string): Promise<Quote | undefined> {
  try {
    return await fetchChartMeta(symbol);
  } catch {
    return undefined;
  }
}

export interface SeriesPoint {
  date: string; // YYYY-MM-DD (로컬 기준)
  close: number;
}

interface YahooSeriesResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

/**
 * 일봉 timestamp → 거래일. 세션 시작 epoch를 사용자 로컬 시간대로 바꾸면 비KST 사용자에게
 * 하루 밀린 날짜가 나온다(KOSPI 09:00 KST = 00:00 UTC). UTC 달력일이 두 시장 모두에서 거래일과 일치한다.
 */
const toTradingDate = (epochSec: number): string =>
  new Date(epochSec * 1000).toISOString().slice(0, 10);

/** 일봉 종가 시계열 (벤치마크 오버레이용). range 예: "3mo" | "6mo" | "1y" | "2y" */
export async function fetchSeries(
  symbol: string,
  range: string,
): Promise<SeriesPoint[] | undefined> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
    const res = await requestUrl({ url, throw: false });
    if (res.status !== 200) return undefined;

    const result = (res.json as YahooSeriesResponse).chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const points = timestamps.flatMap((ts, i) => {
      const close = closes[i];
      return typeof close === "number" && close > 0 ? [{ date: toTradingDate(ts), close }] : [];
    });
    return points.length > 0 ? points : undefined;
  } catch {
    return undefined;
  }
}

/** 네이버 증권 자동완성 — 국내 종목을 한글로 검색하고 한글명을 받는다. */
export async function searchKrSymbols(query: string): Promise<SymbolSearchHit[]> {
  try {
    const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock`;
    const res = await requestUrl({
      url,
      throw: false,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (res.status !== 200) return [];
    const items = (res.json as { items?: RawNaverItem[] }).items ?? [];
    return items.map(mapNaverItem).filter((h): h is SymbolSearchHit => h !== null);
  } catch {
    return [];
  }
}

/** 국내 종목 코드 → 한글명 (정확히 일치하는 항목만). 표시 이름 캐시용. */
export async function lookupKrName(code: string): Promise<string | undefined> {
  const hits = await searchKrSymbols(code);
  return hits.find((h) => h.ticker === code)?.name;
}

/** 야후 심볼 검색 — 해외 종목·영문 검색용. */
export async function searchSymbols(query: string): Promise<SymbolSearchHit[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
    const res = await requestUrl({ url, throw: false });
    if (res.status !== 200) return [];
    const quotes = ((res.json as { quotes?: RawSearchQuote[] }).quotes ?? []);
    return quotes.map(mapSearchQuote).filter((h): h is SymbolSearchHit => h !== null);
  } catch {
    return [];
  }
}

/** 통화 → KRW 환율. 예: USD → "USDKRW=X" */
export async function fetchFxToKrw(currency: string): Promise<number | undefined> {
  const quote = await fetchQuote(`${currency.toUpperCase()}KRW=X`);
  return quote?.price;
}
