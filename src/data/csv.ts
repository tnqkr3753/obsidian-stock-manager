import type { Trade } from "../domain/types";
import { parseTrade } from "./parse";

export interface CsvParseResult {
  trades: readonly Trade[];
  errors: readonly string[];
}

const REQUIRED_HEADERS = ["date", "action"] as const;

/** 따옴표("...")로 감싼 필드와 내부 콤마, 이스케이프("")를 지원하는 한 줄 파서. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * 증권사 거래내역 CSV → Trade 목록. 헤더: date, action(필수), ticker, qty, price, currency, amount, tags.
 * 잘못된 행은 건너뛰고 "N행: 사유" 형식으로 수집한다 (N은 데이터 행 기준 1부터).
 */
export function parseTradesCsv(text: string): CsvParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) return { trades: [], errors: ["빈 파일입니다"] };

  const headers = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return { trades: [], errors: [`필수 헤더가 없습니다: ${missing.join(", ")}`] };
  }

  const trades: Trade[] = [];
  const errors: string[] = [];

  lines.slice(1).forEach((line, index) => {
    const fields = splitCsvLine(line);
    const record = Object.fromEntries(
      headers.map((header, col) => [header, fields[col] ?? ""]),
    ) as Record<string, string>;

    const result = parseTrade(
      {
        type: "trade",
        date: record["date"],
        action: record["action"],
        ticker: record["ticker"],
        qty: record["qty"],
        price: record["price"],
        currency: record["currency"],
        amount: record["amount"],
        tags: record["tags"] ? record["tags"].split(";") : [],
      },
      `CSV ${index + 1}행`,
    );

    if (result.ok) trades.push(result.value);
    else errors.push(`${index + 1}행: ${result.error}`);
  });

  return { trades, errors };
}
