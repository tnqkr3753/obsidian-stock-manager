const krw = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export const formatKrw = (value: number): string => `₩${krw.format(Math.round(value))}`;

export const formatSignedKrw = (value: number): string =>
  `${value >= 0 ? "+" : "−"}${krw.format(Math.round(Math.abs(value)))}원`;

export const formatPct = (ratio: number, digits = 1): string =>
  `${(ratio * 100).toFixed(digits)}%`;

export const formatSignedPct = (ratio: number, digits = 1): string =>
  `${ratio >= 0 ? "+" : "−"}${(Math.abs(ratio) * 100).toFixed(digits)}%`;

export const formatSignedPointPct = (ratio: number, digits = 1): string =>
  `${ratio >= 0 ? "+" : "−"}${(Math.abs(ratio) * 100).toFixed(digits)}%p`;

/** 종목 통화 기준 가격 표기. KRW는 원화, 그 외는 통화 기호 포함. */
export const formatNative = (value: number, currency: string): string => {
  if (currency === "KRW") return krw.format(Math.round(value));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
};

export const formatQty = (qty: number): string =>
  Number.isInteger(qty) ? krw.format(qty) : String(qty);

/** 큰 금액 축약: 1,277만 / 1.2억 — 태그 노출 등 보조 표기에 사용. */
export const formatCompactKrw = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${krw.format(Math.round(value / 10_000))}만`;
  return formatKrw(value);
};

export const signClass = (value: number): string =>
  value > 0 ? "sm-up" : value < 0 ? "sm-down" : "sm-flat";

export const formatTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
