import type {
  HoldingClass,
  MacroMemo,
  PortfolioConfig,
  Result,
  StockMeta,
  Trade,
  TradeAction,
  WatchItem,
} from "../domain/types";
import { err, ok, TRADE_ACTIONS } from "../domain/types";
import { parseEventStrings } from "../domain/events";
import { toLocalDateString } from "../util/date";

type Frontmatter = Record<string, unknown>;

const DEFAULT_TARGET = { stock: 0.6, bond: 0.2, cash: 0.2 } as const;
const DEFAULT_CONCENTRATION_LIMIT = 0.4;

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

const asNumber = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const asDateString = (v: unknown): string | undefined => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return toLocalDateString(v);
  const s = asString(v);
  if (s && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return undefined;
};

const asTags = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : [])
    .map((t) => String(t).trim().replace(/^#/, ""))
    .filter((t) => t !== "");

/** 백분율(55) 또는 비율(0.55) 표기를 모두 0~1 비율로 정규화. */
const asRatio = (v: unknown): number | undefined => {
  const n = asNumber(v);
  if (n === undefined || n < 0) return undefined;
  return n > 1 ? n / 100 : n;
};

export function parseTrade(fm: Frontmatter, path: string): Result<Trade> {
  if (fm["type"] !== "trade") return err(`type이 trade가 아닙니다: ${path}`);

  const action = asString(fm["action"]);
  if (!action || !TRADE_ACTIONS.includes(action as TradeAction)) {
    return err(`지원하지 않는 action "${action ?? ""}": ${path}`);
  }
  const date = asDateString(fm["date"]);
  if (!date) return err(`date가 없거나 YYYY-MM-DD 형식이 아닙니다: ${path}`);

  const trade: Trade = {
    date,
    action: action as TradeAction,
    currency: (asString(fm["currency"]) ?? "KRW").toUpperCase(),
    // 계좌명이 숫자(예: 123-45 없이 123)로 적혀도 문자열로 받아들인다
    account:
      asString(fm["account"]) ??
      (typeof fm["account"] === "number" ? String(fm["account"]) : undefined),
    ticker: asString(fm["ticker"]),
    qty: asNumber(fm["qty"]),
    price: asNumber(fm["price"]),
    amount: asNumber(fm["amount"]),
    tags: asTags(fm["tags"]),
    path,
  };

  const isPositionAction = ["buy", "sell", "opening"].includes(trade.action);
  if (isPositionAction) {
    if (!trade.ticker) return err(`ticker가 없습니다: ${path}`);
    if (!trade.qty || trade.qty <= 0) return err(`qty는 양수여야 합니다: ${path}`);
    if (trade.price === undefined || trade.price < 0) return err(`price가 없습니다: ${path}`);
  } else if (trade.action === "dividend") {
    if (!trade.ticker) return err(`배당 기록에 ticker가 없습니다: ${path}`);
    if (!trade.amount || trade.amount <= 0) return err(`amount는 양수여야 합니다: ${path}`);
  } else if (!trade.amount || trade.amount <= 0) {
    return err(`amount는 양수여야 합니다: ${path}`);
  }

  return ok(trade);
}

export function parseStockMeta(fm: Frontmatter, path: string): Result<StockMeta> {
  if (fm["type"] !== "stock") return err(`type이 stock이 아닙니다: ${path}`);

  const ticker = asString(fm["ticker"]);
  if (!ticker) return err(`종목 노트에 ticker가 없습니다: ${path}`);

  const rawClass = asString(fm["assetClass"]);
  const assetClass: HoldingClass = rawClass === "bond" ? "bond" : "stock";

  const name = asString(fm["name"]) ?? ticker;
  return ok({
    ticker,
    name,
    assetClass,
    currency: (asString(fm["currency"]) ?? "KRW").toUpperCase(),
    tags: asTags(fm["tags"]),
    events: parseEventStrings(Array.isArray(fm["events"]) ? fm["events"] : [], name),
    market: asString(fm["market"]),
    yahooSymbol: asString(fm["yahooSymbol"]),
    path,
  });
}

export function parseMacro(fm: Frontmatter, path: string): Result<MacroMemo> {
  if (fm["type"] !== "macro") return err(`type이 macro가 아닙니다: ${path}`);

  const date = asDateString(fm["date"]);
  if (!date) return err(`경제 메모에 date가 없습니다: ${path}`);

  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  const title = asString(fm["title"]) ?? basename;
  return ok({
    date,
    title,
    tags: asTags(fm["tags"]),
    events: parseEventStrings(Array.isArray(fm["events"]) ? fm["events"] : [], title),
    path,
  });
}

export function parseWatch(fm: Frontmatter, path: string): Result<WatchItem> {
  if (fm["type"] !== "watch") return err(`type이 watch가 아닙니다: ${path}`);

  const ticker = asString(fm["ticker"]);
  if (!ticker) return err(`워치 노트에 ticker가 없습니다: ${path}`);

  const name = asString(fm["name"]) ?? ticker;
  return ok({
    ticker,
    name,
    targetPrice: asNumber(fm["targetPrice"]),
    currency: (asString(fm["currency"]) ?? "KRW").toUpperCase(),
    tags: asTags(fm["tags"]),
    events: parseEventStrings(Array.isArray(fm["events"]) ? fm["events"] : [], name),
    market: asString(fm["market"]),
    yahooSymbol: asString(fm["yahooSymbol"]),
    path,
  });
}

export function parseConfig(fm: Frontmatter): Result<PortfolioConfig> {
  if (fm["type"] !== "stock-config") return err("type이 stock-config가 아닙니다");

  const rawTarget = (fm["target"] ?? {}) as Frontmatter;
  const stock = asRatio(rawTarget["stock"]);
  const bond = asRatio(rawTarget["bond"]);
  const cash = asRatio(rawTarget["cash"]);
  const complete = stock !== undefined && bond !== undefined && cash !== undefined;

  // 합이 100%가 아니면(예: 50/30/10) 그대로 두면 편차 계산이 왜곡되므로 비례 정규화
  const sum = complete ? stock + bond + cash : 0;
  const target =
    complete && sum > 0
      ? { stock: stock / sum, bond: bond / sum, cash: cash / sum }
      : { ...DEFAULT_TARGET };

  const checklist = (Array.isArray(fm["checklist"]) ? fm["checklist"] : [])
    .map((item) => String(item).trim())
    .filter((item) => item !== "");

  return ok({
    target,
    concentrationLimit: asRatio(fm["concentrationLimit"]) ?? DEFAULT_CONCENTRATION_LIMIT,
    checklist,
    baseCurrency: "KRW",
  });
}
