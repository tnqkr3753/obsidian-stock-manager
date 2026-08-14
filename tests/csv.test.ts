import { describe, expect, it } from "vitest";
import { parseTradesCsv } from "../src/data/csv";

describe("parseTradesCsv", () => {
  it("parses trades from a headered CSV", () => {
    const csv = [
      "date,action,ticker,qty,price,currency,amount,tags",
      "2026-08-12,buy,005930,10,71000,KRW,,원칙매수;분할매수",
      "2026-08-08,dividend,TIGER360750,,,KRW,41200,",
    ].join("\n");
    const { trades, errors } = parseTradesCsv(csv);
    expect(errors).toHaveLength(0);
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ action: "buy", ticker: "005930", qty: 10, tags: ["원칙매수", "분할매수"] });
    expect(trades[1]).toMatchObject({ action: "dividend", amount: 41200 });
  });

  it("imports the account column and leaves it undefined when absent", () => {
    const withAccount = parseTradesCsv(
      "date,action,ticker,qty,price,account\n2026-01-01,buy,A,1,100,ISA",
    );
    expect(withAccount.trades[0]!.account).toBe("ISA");
    const without = parseTradesCsv("date,action,ticker,qty,price\n2026-01-01,buy,A,1,100");
    expect(without.trades[0]!.account).toBeUndefined();
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'date,action,ticker,qty,price,name\n2026-01-01,buy,"BRK,B",1,100,"버크셔, B주"';
    const { trades, errors } = parseTradesCsv(csv);
    expect(errors).toHaveLength(0);
    expect(trades[0]!.ticker).toBe("BRK,B");
  });

  it("collects row errors without dropping valid rows", () => {
    const csv = [
      "date,action,ticker,qty,price",
      "2026-01-01,buy,A,10,100",
      "not-a-date,buy,B,1,1",
      "2026-01-03,sell,A,5,120",
    ].join("\n");
    const { trades, errors } = parseTradesCsv(csv);
    expect(trades).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("2행");
  });

  it("fails clearly when required headers are missing", () => {
    const { trades, errors } = parseTradesCsv("foo,bar\n1,2");
    expect(trades).toHaveLength(0);
    expect(errors[0]).toContain("헤더");
  });
});
