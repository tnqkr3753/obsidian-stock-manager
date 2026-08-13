export interface BenchPoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface BenchSeries {
  label: string;
  series: readonly BenchPoint[];
}

export interface OverlayPoint {
  date: string;
  index: number; // 창 안 첫 값 = 100
}

export interface OverlaySeries {
  label: string;
  points: readonly OverlayPoint[];
}

const MY_LABEL = "내 자산";

const indexTo100 = (points: readonly { date: string; value: number }[]): OverlayPoint[] => {
  const base = points[0]?.value;
  if (base === undefined || base <= 0) return [];
  return points.map((p) => ({ date: p.date, index: (p.value / base) * 100 }));
};

/**
 * 자산 스냅샷과 벤치마크 시계열을 "내 스냅샷 구간의 첫 날 = 100"으로 지수화해 겹쳐 그릴 수 있게 만든다.
 * 절대 금액과 지수는 축을 공유할 수 없으므로 지수화가 유일하게 정직한 비교 방법이다.
 */
export function buildOverlay(
  snapshots: readonly { date: string; totalAssets: number }[],
  benchmarks: readonly BenchSeries[],
): readonly OverlaySeries[] {
  const mine = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (mine.length < 2) return [];
  const windowStart = mine[0]!.date;
  const windowEnd = mine[mine.length - 1]!.date;

  const result: OverlaySeries[] = [
    { label: MY_LABEL, points: indexTo100(mine.map((s) => ({ date: s.date, value: s.totalAssets }))) },
  ];

  for (const bench of benchmarks) {
    const clipped = [...bench.series]
      .filter((p) => p.date >= windowStart && p.date <= windowEnd)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (clipped.length < 2) continue;
    result.push({
      label: bench.label,
      points: indexTo100(clipped.map((p) => ({ date: p.date, value: p.close }))),
    });
  }
  return result;
}
