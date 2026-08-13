export interface StockManagerSettings {
  rootFolder: string; // 이 폴더 아래에서 trade/stock/config 노트를 스캔
  tradesFolder: string; // 매매 기록 Modal이 노트를 생성할 폴더
  refreshMinutes: number; // 시세 폴링 주기 (0 = 수동)
  rebalanceTolerance: number; // %p 단위 허용 편차
  snapshotEnabled: boolean; // 하루 1회 총자산 스냅샷 저장
}

export const DEFAULT_SETTINGS: StockManagerSettings = {
  rootFolder: "Stocks",
  tradesFolder: "Stocks/Trades",
  refreshMinutes: 5,
  rebalanceTolerance: 1,
  snapshotEnabled: true,
};

export interface AssetSnapshot {
  date: string; // YYYY-MM-DD
  totalAssets: number;
}

/** data.json에 저장되는 플러그인 상태 (설정 + 시세 캐시 + 자산 스냅샷). */
export interface PersistedData {
  settings: StockManagerSettings;
  quoteCache: Record<string, { price: number; currency: string; changePct?: number; asOf: number }>;
  fxCache: Record<string, { rate: number; asOf: number }>;
  snapshots: AssetSnapshot[];
}

export const DEFAULT_DATA: PersistedData = {
  settings: DEFAULT_SETTINGS,
  quoteCache: {},
  fxCache: {},
  snapshots: [],
};
