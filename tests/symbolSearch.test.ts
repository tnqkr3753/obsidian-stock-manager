import { describe, expect, it } from "vitest";
import { mapNaverItem, mapSearchQuote } from "../src/price/symbolSearch";

describe("mapNaverItem", () => {
  it("maps a KOSPI stock with the Korean name and .KS yahoo symbol", () => {
    expect(
      mapNaverItem({ code: "005930", name: "삼성전자", typeCode: "KOSPI", category: "stock", nationCode: "KOR" }),
    ).toEqual({
      ticker: "005930",
      name: "삼성전자",
      market: "KOSPI",
      currency: "KRW",
      yahooSymbol: "005930.KS",
    });
  });

  it("maps KOSDAQ to a .KQ suffix and keeps alphanumeric ETF codes", () => {
    const kosdaq = mapNaverItem({ code: "035720", name: "카카오", typeCode: "KOSDAQ", category: "stock", nationCode: "KOR" });
    expect(kosdaq).toMatchObject({ market: "KOSDAQ", yahooSymbol: "035720.KQ" });
    const etf = mapNaverItem({ code: "0162Z0", name: "RISE 혼합50", typeCode: "KOSPI", category: "stock", nationCode: "KOR" });
    expect(etf).toMatchObject({ ticker: "0162Z0", yahooSymbol: "0162Z0.KS" });
  });

  it("drops non-stock or non-Korean items", () => {
    expect(mapNaverItem({ code: "X", name: "지수", typeCode: "KOSPI", category: "index", nationCode: "KOR" })).toBeNull();
    expect(mapNaverItem({ code: "AAPL", name: "애플", typeCode: "NASDAQ", category: "stock", nationCode: "USA" })).toBeNull();
  });
});

describe("mapSearchQuote", () => {
  it("maps a .KS symbol to a 6-digit KOSPI ticker in KRW", () => {
    expect(
      mapSearchQuote({ symbol: "005930.KS", shortname: "Samsung Electronics", exchDisp: "KSE", quoteType: "EQUITY" }),
    ).toEqual({
      ticker: "005930",
      name: "Samsung Electronics",
      market: "KOSPI",
      currency: "KRW",
      yahooSymbol: "005930.KS",
    });
  });

  it("maps a .KQ symbol to KOSDAQ", () => {
    const hit = mapSearchQuote({ symbol: "035720.KQ", longname: "카카오", quoteType: "EQUITY" });
    expect(hit).toMatchObject({ ticker: "035720", market: "KOSDAQ", currency: "KRW", name: "카카오" });
  });

  it("maps US exchange symbols to USD and keeps the raw ticker", () => {
    const hit = mapSearchQuote({ symbol: "AAPL", shortname: "Apple Inc.", exchange: "NMS", exchDisp: "NASDAQ", quoteType: "EQUITY" });
    expect(hit).toMatchObject({ ticker: "AAPL", currency: "USD", market: "NASDAQ", yahooSymbol: "AAPL" });
  });

  it("prefers longname over shortname and falls back to the symbol", () => {
    expect(mapSearchQuote({ symbol: "X1", longname: "롱네임", shortname: "숏", quoteType: "ETF" })!.name).toBe("롱네임");
    expect(mapSearchQuote({ symbol: "X2", quoteType: "EQUITY" })!.name).toBe("X2");
  });

  it("keeps ETFs but drops non-tradable quote types", () => {
    expect(mapSearchQuote({ symbol: "SPY", shortname: "SPDR S&P 500", exchange: "PCX", quoteType: "ETF" })).not.toBeNull();
    expect(mapSearchQuote({ symbol: "USDKRW=X", quoteType: "CURRENCY" })).toBeNull();
    expect(mapSearchQuote({ symbol: "^GSPC", quoteType: "INDEX" })).toBeNull();
  });

  it("leaves currency undefined for unknown exchanges so the caller keeps its default", () => {
    const hit = mapSearchQuote({ symbol: "7203.T", shortname: "Toyota", exchDisp: "Tokyo", quoteType: "EQUITY" });
    expect(hit).toMatchObject({ ticker: "7203.T", currency: undefined });
  });
});
