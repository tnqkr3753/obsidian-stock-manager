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

import type { CalendarEvent } from "./events";

/** 종목 메타 노트 (태그·자산군·통화). */
export interface StockMeta {
  ticker: string;
  name: string;
  assetClass: HoldingClass;
  currency: string;
  tags: readonly string[];
  events: readonly CalendarEvent[]; // 실적 발표·배당락 등
  market?: string;
  yahooSymbol?: string; // 시세 조회용 심볼 재정의 (기본: ticker)
  path?: string;
}

export interface PortfolioConfig {
  target: Allocation; // 0~1 비율
  concentrationLimit: number; // 0~1, 태그 집중 경고 기준
  checklist: readonly string[]; // 매수 전 확인 항목 (매매 Modal에 표시)
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

/** 매도 1건의 실현 기록 — 월간 리포트의 기간 귀속·회고 태그 성적표에 쓰인다. */
export interface SellEvent {
  date: string;
  ticker: string;
  qty: number;
  pnl: number; // 종목 통화
  currency: string;
  tags: readonly string[];
}

export interface ReplayResult {
  positions: readonly Position[];
  cash: Readonly<Record<string, number>>; // 통화별 현금
  realized: Readonly<Record<string, RealizedEntry>>; // 청산분 포함 종목별 누계
  sellEvents: readonly SellEvent[];
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
  missingFx: readonly string[]; // 환율을 구하지 못해 1로 표시된 통화 (경고 대상)
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

/** 경제 메모 노트 (2차). 태그로 종목 태그와 연결된다. */
export interface MacroMemo {
  date: string;
  title: string;
  tags: readonly string[];
  events: readonly CalendarEvent[]; // FOMC 등 거시 일정
  path?: string;
}

/** 워치리스트 노트 (2차). targetPrice 도달 시 대시보드에 배지. */
export interface WatchItem {
  ticker: string;
  name: string;
  targetPrice?: number; // 종목 통화
  currency: string;
  tags: readonly string[];
  events: readonly CalendarEvent[];
  market?: string;
  yahooSymbol?: string;
  path?: string;
}

export interface RetroTagStat {
  tag: string;
  count: number; // 해당 월 태그 사용 횟수 (모든 액션)
  pnl: Readonly<Record<string, number>>; // 통화별 실현손익 (매도 이벤트 기준)
}

export interface MonthlyReport {
  month: string; // YYYY-MM
  tradeCounts: { buy: number; sell: number; dividend: number; deposit: number; withdraw: number };
  realizedPnl: Readonly<Record<string, number>>; // 통화별
  dividends: Readonly<Record<string, number>>;
  netDeposits: Readonly<Record<string, number>>; // 입금 - 출금
  startAssets?: number; // 월 내 첫/마지막 스냅샷 (KRW)
  endAssets?: number;
  retroTags: readonly RetroTagStat[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T>(error: string): Result<T> => ({ ok: false, error });
