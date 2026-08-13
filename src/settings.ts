export interface BenchmarkSetting {
  symbol: string; // 야후 심볼 (^KS11, ^GSPC ...)
  label: string;
}

export interface StockManagerSettings {
  rootFolder: string; // 이 폴더 아래에서 trade/stock/config 노트를 스캔
  tradesFolder: string; // 매매 기록 Modal이 노트를 생성할 폴더
  refreshMinutes: number; // 시세 폴링 주기 (0 = 수동)
  rebalanceTolerance: number; // %p 단위 허용 편차
  snapshotEnabled: boolean; // 하루 1회 총자산 스냅샷 저장
  benchmarks: BenchmarkSetting[]; // 자산 추이에 겹쳐 그릴 지수
}

export const DEFAULT_SETTINGS: StockManagerSettings = {
  rootFolder: "Stocks",
  tradesFolder: "Stocks/Trades",
  refreshMinutes: 5,
  rebalanceTolerance: 1,
  snapshotEnabled: true,
  benchmarks: [
    { symbol: "^KS11", label: "KOSPI" },
    { symbol: "^GSPC", label: "S&P500" },
  ],
};

export interface AssetSnapshot {
  date: string; // YYYY-MM-DD
  totalAssets: number;
}

/**
 * data.json에 저장되는 플러그인 상태 (설정 + 캐시).
 * snapshots는 3차부터 vault의 snapshots.json이 원본이고, 여기 남은 값은 최초 1회 마이그레이션 소스다.
 */
export interface PersistedData {
  settings: StockManagerSettings;
  quoteCache: Record<string, { price: number; currency: string; changePct?: number; asOf: number }>;
  fxCache: Record<string, { rate: number; asOf: number }>;
  benchCache: Record<string, { series: { date: string; close: number }[]; asOf: number; range?: string }>;
  snapshots: AssetSnapshot[];
}

export const DEFAULT_DATA: PersistedData = {
  settings: DEFAULT_SETTINGS,
  quoteCache: {},
  fxCache: {},
  benchCache: {},
  snapshots: [],
};
