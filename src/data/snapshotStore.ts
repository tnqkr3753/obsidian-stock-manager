import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type { AssetSnapshot } from "../settings";

/**
 * 자산 스냅샷 저장소 — vault 파일(`{root}/snapshots.json`)이 원본.
 * data.json(기기 로컬)에 두면 기기마다 자산 추이·월간 리포트가 달라지므로 vault로 옮겨 동기화를 태운다.
 */
export interface SnapshotLoadResult {
  snapshots: AssetSnapshot[];
  /** false = 파일은 있는데 읽기/파싱 실패 — 이때 저장하면 이력을 덮어써 파괴하므로 쓰기를 멈춰야 한다 */
  healthy: boolean;
}

export class SnapshotStore {
  constructor(
    private readonly app: App,
    private readonly getRootFolder: () => string,
  ) {}

  private path(root = this.getRootFolder()): string {
    return normalizePath(`${root}/snapshots.json`);
  }

  async load(): Promise<SnapshotLoadResult> {
    try {
      if (!(await this.app.vault.adapter.exists(this.path()))) {
        return { snapshots: [], healthy: true }; // 파일 없음 = 신규 설치, 정상
      }
      const raw = JSON.parse(await this.app.vault.adapter.read(this.path())) as unknown;
      if (!Array.isArray(raw)) return { snapshots: [], healthy: false };
      return {
        snapshots: raw.filter(
          (s): s is AssetSnapshot =>
            typeof s === "object" &&
            s !== null &&
            typeof (s as AssetSnapshot).date === "string" &&
            typeof (s as AssetSnapshot).totalAssets === "number",
        ),
        healthy: true,
      };
    } catch {
      return { snapshots: [], healthy: false };
    }
  }

  /** rootFolder 변경 시 기존 스냅샷 파일을 새 위치로 옮긴다 (새 위치에 이미 있으면 건드리지 않음). */
  async moveFrom(oldRoot: string): Promise<void> {
    const oldPath = this.path(oldRoot);
    const newPath = this.path();
    if (oldPath === newPath) return;
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(oldPath)) || (await adapter.exists(newPath))) return;
    const content = await adapter.read(oldPath);
    const folder = normalizePath(this.getRootFolder());
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => undefined);
    }
    await adapter.write(newPath, content);
    await adapter.remove(oldPath);
  }

  async save(snapshots: readonly AssetSnapshot[]): Promise<void> {
    const folder = normalizePath(this.getRootFolder());
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => undefined);
    }
    await this.app.vault.adapter.write(this.path(), JSON.stringify(snapshots, null, 1));
  }

  /** vault 스냅샷과 구버전 data.json 스냅샷을 날짜 기준으로 머지한다 (vault 값 우선). */
  merge(
    vaultSnapshots: readonly AssetSnapshot[],
    legacy: readonly AssetSnapshot[],
  ): AssetSnapshot[] {
    const byDate = new Map<string, AssetSnapshot>();
    for (const s of legacy) byDate.set(s.date, s);
    for (const s of vaultSnapshots) byDate.set(s.date, s);
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }
}
