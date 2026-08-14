import type { Position, ReplayResult, SellEvent, Trade } from "./types";
import { DEFAULT_ACCOUNT } from "./types";

interface Lot {
  ticker: string;
  account: string;
  qty: number;
  avgCost: number;
  currency: string;
}

const EPSILON = 1e-9;

/**
 * 날짜가 같은 거래의 순서. Trade는 시각 없이 날짜만 가지므로 파일 열거 순서에 기대면
 * 당일 매수보다 매도가 먼저 리플레이돼 매도가 통째로 버려질 수 있다 → 매도를 항상 뒤로 보낸다.
 */
const SAME_DATE_ORDER: Record<Trade["action"], number> = {
  opening: 0,
  deposit: 1,
  buy: 2,
  dividend: 3,
  sell: 4,
  withdraw: 5,
};

const lotKey = (account: string, ticker: string): string => `${account}\u0000${ticker}`;

/**
 * 매매일지 리플레이 — 보유량·평단·실현손익·배당·현금을 전부 일지에서 파생한다.
 * lot은 계좌+종목 단위: 같은 종목이라도 계좌(ISA·신한 등)가 다르면 평단·보유량이 분리된다.
 * opening은 기존 보유 스냅샷이므로 현금에 영향을 주지 않고, buy/sell/배당/입출금만 현금을 움직인다.
 * 데이터 오류(과매도·통화 불일치 등)는 던지지 않고 경고로 수집해 대시보드가 항상 그려지게 한다.
 */
export function replayTrades(trades: readonly Trade[]): ReplayResult {
  const sorted = trades
    .map((trade, index) => ({ trade, index }))
    .sort((a, b) => {
      if (a.trade.date !== b.trade.date) return a.trade.date < b.trade.date ? -1 : 1;
      const byAction = SAME_DATE_ORDER[a.trade.action] - SAME_DATE_ORDER[b.trade.action];
      return byAction !== 0 ? byAction : a.index - b.index;
    })
    .map((x) => x.trade);

  const lots = new Map<string, Lot>();
  const cashByAccount = new Map<string, Map<string, number>>();
  const dividendsByLot = new Map<string, { ticker: string; amount: number }>();
  const sellEvents: SellEvent[] = [];
  const warnings: string[] = [];

  const addCash = (account: string, currency: string, delta: number): void => {
    const bucket = cashByAccount.get(account) ?? new Map<string, number>();
    bucket.set(currency, (bucket.get(currency) ?? 0) + delta);
    cashByAccount.set(account, bucket);
  };
  const where = (trade: Trade): string => trade.path ?? trade.date;

  for (const trade of sorted) {
    const currency = trade.currency || "KRW";
    const account = trade.account || DEFAULT_ACCOUNT;
    switch (trade.action) {
      case "deposit":
        addCash(account, currency, trade.amount ?? 0);
        break;
      case "withdraw":
        addCash(account, currency, -(trade.amount ?? 0));
        break;
      case "dividend": {
        if (!trade.ticker || !trade.amount) {
          warnings.push(`배당 기록에 ticker/amount가 없습니다: ${where(trade)}`);
          break;
        }
        // account 없는 배당이 유령 '기본' 계좌를 만들지 않도록, 그 종목을 실제 보유한 계좌로 귀속한다
        const ticker = trade.ticker;
        let lot = lots.get(lotKey(account, ticker));
        if (!lot || lot.qty <= EPSILON) {
          const holders = [...lots.values()].filter((l) => l.ticker === ticker && l.qty > EPSILON);
          if (holders.length === 1) {
            lot = holders[0];
            if (trade.account && trade.account !== lot!.account) {
              warnings.push(
                `배당의 계좌(${trade.account})에 보유가 없어 ${lot!.account} 계좌로 귀속했습니다: ${ticker} (${where(trade)})`,
              );
            }
          } else if (holders.length === 0) {
            warnings.push(`보유하지 않은 종목의 배당입니다: ${ticker} (${where(trade)})`);
          }
          // 여러 계좌가 보유 중이면 기록된 계좌를 그대로 쓴다 (자동 배분은 추측이 된다)
        }
        const targetAccount = lot?.account ?? account;
        let dividendCurrency = currency;
        if (lot && lot.currency !== currency) {
          warnings.push(
            `통화 불일치(보유 ${lot.currency}, 기록 ${currency}) — 배당을 보유 통화로 간주했습니다: ${ticker} (${where(trade)})`,
          );
          dividendCurrency = lot.currency;
        }
        addCash(targetAccount, dividendCurrency, trade.amount);
        const key = lotKey(targetAccount, ticker);
        dividendsByLot.set(key, {
          ticker,
          amount: (dividendsByLot.get(key)?.amount ?? 0) + trade.amount,
        });
        break;
      }
      case "opening":
      case "buy": {
        if (!trade.ticker || !trade.qty || trade.price == null) {
          warnings.push(`매수 기록에 ticker/qty/price가 없습니다: ${where(trade)}`);
          break;
        }
        const key = lotKey(account, trade.ticker);
        const prev = lots.get(key) ?? {
          ticker: trade.ticker,
          account,
          qty: 0,
          avgCost: 0,
          currency,
        };
        // 기존 보유와 통화가 다르면 평단이 서로 다른 단위를 섞게 된다 — 보유 통화 기준으로 처리하고 경고
        const lotCurrency = prev.qty > EPSILON ? prev.currency : currency;
        if (prev.qty > EPSILON && prev.currency !== currency) {
          warnings.push(
            `통화 불일치(보유 ${prev.currency}, 기록 ${currency}) — 보유 통화 기준으로 처리했습니다: ${trade.ticker} (${where(trade)})`,
          );
        }
        const qty = prev.qty + trade.qty;
        const avgCost = (prev.qty * prev.avgCost + trade.qty * trade.price) / qty;
        lots.set(key, { ...prev, qty, avgCost, currency: lotCurrency });
        if (trade.action === "buy") addCash(account, lotCurrency, -trade.qty * trade.price);
        break;
      }
      case "sell": {
        if (!trade.ticker || !trade.qty || trade.price == null) {
          warnings.push(`매도 기록에 ticker/qty/price가 없습니다: ${where(trade)}`);
          break;
        }
        const key = lotKey(account, trade.ticker);
        const prev = lots.get(key);
        if (!prev || prev.qty <= EPSILON) {
          warnings.push(
            `${account} 계좌에 보유하지 않은 종목을 매도했습니다: ${trade.ticker} (${where(trade)})`,
          );
          break;
        }
        if (prev.currency !== currency) {
          warnings.push(
            `통화 불일치(보유 ${prev.currency}, 기록 ${currency}) — 가격을 보유 통화로 간주해 대금·손익을 계산했습니다: ${trade.ticker} (${where(trade)})`,
          );
        }
        const sellQty = Math.min(trade.qty, prev.qty);
        if (sellQty < trade.qty) {
          warnings.push(
            `${account} 계좌 보유량(${prev.qty})보다 많은 수량(${trade.qty})을 매도해 ${sellQty}로 조정했습니다: ${trade.ticker} (${where(trade)})`,
          );
        }
        // 실현손익의 유일한 기록처는 sellEvents — realized 원장은 아래에서 이벤트 합으로 파생된다
        const pnl = sellQty * (trade.price - prev.avgCost);
        addCash(account, prev.currency, sellQty * trade.price);
        sellEvents.push({
          date: trade.date,
          ticker: trade.ticker,
          account,
          qty: sellQty,
          pnl,
          currency: prev.currency,
          tags: trade.tags ?? [],
        });
        lots.set(key, { ...prev, qty: prev.qty - sellQty });
        break;
      }
    }
  }

  // per-lot 원장은 sellEvents 합에서 파생 — 이중 기록으로 인한 불일치를 원천 차단
  const pnlByLot = new Map<string, number>();
  for (const event of sellEvents) {
    const key = lotKey(event.account, event.ticker);
    pnlByLot.set(key, (pnlByLot.get(key) ?? 0) + event.pnl);
  }

  const positions: Position[] = [...lots.entries()]
    .filter(([, lot]) => lot.qty > EPSILON)
    .map(([key, lot]) => ({
      ticker: lot.ticker,
      account: lot.account,
      qty: lot.qty,
      avgCost: lot.avgCost,
      costBasis: lot.qty * lot.avgCost,
      realizedPnl: pnlByLot.get(key) ?? 0,
      dividends: dividendsByLot.get(key)?.amount ?? 0,
      currency: lot.currency,
    }));

  const flatCash = new Map<string, number>();
  for (const bucket of cashByAccount.values()) {
    for (const [currency, amount] of bucket) {
      flatCash.set(currency, (flatCash.get(currency) ?? 0) + amount);
    }
  }

  return {
    positions,
    cash: Object.fromEntries(flatCash),
    cashByAccount: Object.fromEntries(
      [...cashByAccount.entries()].map(([account, bucket]) => [account, Object.fromEntries(bucket)]),
    ),
    sellEvents,
    warnings,
  };
}
