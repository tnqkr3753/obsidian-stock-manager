/** 야후 심볼 검색 응답 1건 → 플러그인이 쓰는 종목 정보. 순수 함수라 단위 테스트 대상. */

export interface RawSearchQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchange?: string; // NMS, NYQ, KSC ...
  exchDisp?: string; // NASDAQ, NYSE, KSE ...
  quoteType?: string; // EQUITY | ETF | INDEX | CURRENCY ...
}

export interface SymbolSearchHit {
  ticker: string; // 매매일지에 기록할 코드 (KRX는 6자리)
  name: string;
  market?: string;
  currency?: string; // 확실할 때만 — 모르면 호출부 기본값(KRW) 유지
  yahooSymbol: string;
}

/** 네이버 증권 자동완성 응답 1건 — 국내 종목의 한글명·시장 구분의 원천. */
export interface RawNaverItem {
  code: string;
  name: string;
  typeCode?: string; // KOSPI | KOSDAQ ...
  category?: string; // stock | index ...
  nationCode?: string; // KOR ...
}

export function mapNaverItem(raw: RawNaverItem): SymbolSearchHit | null {
  if (raw.category !== "stock" || raw.nationCode !== "KOR") return null;
  const market = raw.typeCode === "KOSDAQ" ? "KOSDAQ" : "KOSPI";
  return {
    ticker: raw.code,
    name: raw.name,
    market,
    currency: "KRW",
    yahooSymbol: `${raw.code}.${market === "KOSDAQ" ? "KQ" : "KS"}`,
  };
}

const TRADABLE_TYPES = new Set(["EQUITY", "ETF", "MUTUALFUND"]);
const US_EXCHANGES = new Set(["NMS", "NYQ", "NGM", "NCM", "PCX", "ASE", "BTS", "PNK"]);

export function mapSearchQuote(raw: RawSearchQuote): SymbolSearchHit | null {
  if (!TRADABLE_TYPES.has(raw.quoteType ?? "")) return null;

  const name = raw.longname ?? raw.shortname ?? raw.symbol;

  if (raw.symbol.endsWith(".KS") || raw.symbol.endsWith(".KQ")) {
    return {
      ticker: raw.symbol.slice(0, -3),
      name,
      market: raw.symbol.endsWith(".KS") ? "KOSPI" : "KOSDAQ",
      currency: "KRW",
      yahooSymbol: raw.symbol,
    };
  }

  const isUs = US_EXCHANGES.has(raw.exchange ?? "");
  return {
    ticker: raw.symbol,
    name,
    market: raw.exchDisp,
    currency: isUs ? "USD" : undefined,
    yahooSymbol: raw.symbol,
  };
}
