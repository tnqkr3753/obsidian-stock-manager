import type { Position, RealizedEntry, ReplayResult, SellEvent, Trade } from "./types";

interface Lot {
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

/**
 * 매매일지 리플레이 — 보유량·평단·실현손익·배당·현금을 전부 일지에서 파생한다.
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
  const cash = new Map<string, number>();
  const realized = new Map<string, RealizedEntry>();
  const sellEvents: SellEvent[] = [];
  const warnings: string[] = [];

  const addCash = (currency: string, delta: number): void => {
    cash.set(currency, (cash.get(currency) ?? 0) + delta);
  };
  const addRealized = (ticker: string, pnl: number, dividend: number): void => {
    const prev = realized.get(ticker) ?? { realizedPnl: 0, dividends: 0 };
    realized.set(ticker, {
      realizedPnl: prev.realizedPnl + pnl,
      dividends: prev.dividends + dividend,
    });
  };
  const where = (trade: Trade): string => trade.path ?? trade.date;

  for (const trade of sorted) {
    const currency = trade.currency || "KRW";
    switch (trade.action) {
      case "deposit":
        addCash(currency, trade.amount ?? 0);
        break;
      case "withdraw":
        addCash(currency, -(trade.amount ?? 0));
        break;
      case "dividend": {
        if (!trade.ticker || !trade.amount) {
          warnings.push(`배당 기록에 ticker/amount가 없습니다: ${where(trade)}`);
          break;
        }
        addCash(currency, trade.amount);
        addRealized(trade.ticker, 0, trade.amount);
        break;
      }
      case "opening":
      case "buy": {
        if (!trade.ticker || !trade.qty || trade.price == null) {
          warnings.push(`매수 기록에 ticker/qty/price가 없습니다: ${where(trade)}`);
          break;
        }
        const prev = lots.get(trade.ticker) ?? { qty: 0, avgCost: 0, currency };
        // 기존 보유와 통화가 다르면 평단이 서로 다른 단위를 섞게 된다 — 보유 통화 기준으로 처리하고 경고
        const lotCurrency = prev.qty > EPSILON ? prev.currency : currency;
        if (prev.qty > EPSILON && prev.currency !== currency) {
          warnings.push(
            `통화 불일치(보유 ${prev.currency}, 기록 ${currency}) — 보유 통화 기준으로 처리했습니다: ${trade.ticker} (${where(trade)})`,
          );
        }
        const qty = prev.qty + trade.qty;
        const avgCost = (prev.qty * prev.avgCost + trade.qty * trade.price) / qty;
        lots.set(trade.ticker, { qty, avgCost, currency: lotCurrency });
        if (trade.action === "buy") addCash(lotCurrency, -trade.qty * trade.price);
        break;
      }
      case "sell": {
        if (!trade.ticker || !trade.qty || trade.price == null) {
          warnings.push(`매도 기록에 ticker/qty/price가 없습니다: ${where(trade)}`);
          break;
        }
        const prev = lots.get(trade.ticker);
        if (!prev || prev.qty <= EPSILON) {
          warnings.push(`보유하지 않은 종목을 매도했습니다: ${trade.ticker} (${where(trade)})`);
          break;
        }
        if (prev.currency !== currency) {
          warnings.push(
            `통화 불일치(보유 ${prev.currency}, 기록 ${currency}) — 매도 대금을 보유 통화로 입금했습니다: ${trade.ticker} (${where(trade)})`,
          );
        }
        const sellQty = Math.min(trade.qty, prev.qty);
        if (sellQty < trade.qty) {
          warnings.push(
            `보유량(${prev.qty})보다 많은 수량(${trade.qty})을 매도해 ${sellQty}로 조정했습니다: ${trade.ticker} (${where(trade)})`,
          );
        }
        const pnl = sellQty * (trade.price - prev.avgCost);
        addRealized(trade.ticker, pnl, 0);
        addCash(prev.currency, sellQty * trade.price);
        sellEvents.push({
          date: trade.date,
          ticker: trade.ticker,
          qty: sellQty,
          pnl,
          currency: prev.currency,
          tags: trade.tags ?? [],
        });
        lots.set(trade.ticker, { ...prev, qty: prev.qty - sellQty });
        break;
      }
    }
  }

  const positions: Position[] = [...lots.entries()]
    .filter(([, lot]) => lot.qty > EPSILON)
    .map(([ticker, lot]) => {
      const ledger = realized.get(ticker) ?? { realizedPnl: 0, dividends: 0 };
      return {
        ticker,
        qty: lot.qty,
        avgCost: lot.avgCost,
        costBasis: lot.qty * lot.avgCost,
        realizedPnl: ledger.realizedPnl,
        dividends: ledger.dividends,
        currency: lot.currency,
      };
    });

  return {
    positions,
    cash: Object.fromEntries(cash),
    realized: Object.fromEntries(realized),
    sellEvents,
    warnings,
  };
}
