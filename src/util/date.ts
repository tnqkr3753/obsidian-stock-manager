/** 로컬 타임존 기준 YYYY-MM-DD. toISOString()은 UTC라 KST 오전 9시 이전에 어제로 밀린다. */
export const toLocalDateString = (d: Date = new Date()): string => {
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
};
