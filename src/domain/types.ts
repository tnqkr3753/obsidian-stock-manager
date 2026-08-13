export type AssetClass = "stock" | "bond" | "cash";
export type HoldingClass = Exclude<AssetClass, "cash">;

export type TradeAction = "buy" | "sell" | "opening" | "dividend" | "deposit" | "withdraw";

export const TRADE_ACTIONS: readonly TradeAction[] = [
  "buy",
  "sell",
  "opening",
  "dividend",
  "deposit",
  "withdraw",
];

/** 매매일지 노트 한 건. vault의 유일한 진실이며 나머지는 전부 파생된다. */
export interface Trade {
  date: string; // YYYY-MM-DD
  action: TradeAction;
  currency: string; // KRW, USD ...
  ticker?: string;
  qty?: number;
  price?: number; // 종목 통화 기준
  amount?: number; // dividend/deposit/withdraw 금액
  tags?: readonly string[]; // 회고 태그 (손절, 원칙매수 ...)
  memo?: string;
  path?: string; // vault 내 노트 경로
}

/** 종목 메타 노트 (태그·자산군·통화). */
export interface StockMeta {
  ticker: string;
  name: string;
  assetClass: HoldingClass;
  currency: string;
  tags: readonly string[];
  market?: string;
  yahooSymbol?: string; // 시세 조회용 심볼 재정의 (기본: ticker)
  path?: string;
}

export interface PortfolioConfig {
  target: Allocation; // 0~1 비율
  concentrationLimit: number; // 0~1, 태그 집중 경고 기준
  baseCurrency: "KRW";
}

export interface Position {
  ticker: string;
  qty: number;
  avgCost: number; // 종목 통화
  costBasis: number; // qty * avgCost
  realizedPnl: number; // 종목 통화, 누적
  dividends: number; // 종목 통화, 누적
  currency: string;
}

export interface RealizedEntry {
  realizedPnl: number;
  dividends: number;
}

export interface ReplayResult {
  positions: readonly Position[];
  cash: Readonly<Record<string, number>>; // 통화별 현금
  realized: Readonly<Record<string, RealizedEntry>>; // 청산분 포함 종목별 누계
  warnings: readonly string[];
}

export interface Quote {
  price: number;
  currency: string;
  changePct?: number; // 당일 등락 (0.008 = +0.8%)
  asOf?: number; // epoch ms
}

export type QuoteMap = Readonly<Record<string, Quote>>;
export type FxMap = Readonly<Record<string, number>>; // "USD" → KRW 환율

/** 평가 완료된 보유 종목 한 행. 금액 필드는 전부 기준통화(KRW) 환산값. */
export interface HoldingRow {
  ticker: string;
  name: string;
  assetClass: HoldingClass;
  currency: string;
  qty: number;
  avgCost: number; // 종목 통화
  price: number; // 종목 통화
  changePct?: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  returnPct: number;
  realizedPnl: number;
  dividends: number;
  weight: number; // 총자산 대비
  stale: boolean; // 시세/환율 미확보로 평단 대체
  path?: string;
}

export interface Allocation {
  stock: number;
  bond: number;
  cash: number;
}

export interface Valuation {
  rows: readonly HoldingRow[];
  totalAssets: number;
  totalCash: number;
  totalMarketValue: number;
  totalCostBasis: number;
  totalUnrealizedPnl: number;
  allocation: Allocation;
}

export interface TagExposure {
  tag: string;
  value: number; // 기준통화 평가액
  ratio: number; // 총자산 대비
  concentrated: boolean;
}

export interface RebalanceEntry {
  assetClass: AssetClass;
  current: number;
  target: number;
  deviation: number; // current - target
  amount: number; // deviation * totalAssets (양수 = 초과보유)
}

export interface RebalanceResult {
  entries: readonly RebalanceEntry[];
  needsRebalancing: boolean;
  headline?: RebalanceEntry; // 가장 크게 초과보유된 자산군
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T>(error: string): Result<T> => ({ ok: false, error });
