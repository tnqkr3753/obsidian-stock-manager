import { requestUrl } from "obsidian";
import type { Quote } from "../domain/types";

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

const toLocalDate = (epochSec: number): string => {
  const d = new Date(epochSec * 1000);
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
};

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
      return typeof close === "number" && close > 0 ? [{ date: toLocalDate(ts), close }] : [];
    });
    return points.length > 0 ? points : undefined;
  } catch {
    return undefined;
  }
}

/** 통화 → KRW 환율. 예: USD → "USDKRW=X" */
export async function fetchFxToKrw(currency: string): Promise<number | undefined> {
  const quote = await fetchQuote(`${currency.toUpperCase()}KRW=X`);
  return quote?.price;
}
