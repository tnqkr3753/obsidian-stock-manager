import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type { AssetSnapshot } from "../settings";

/**
 * 자산 스냅샷 저장소 — vault 파일(`{root}/snapshots.json`)이 원본.
 * data.json(기기 로컬)에 두면 기기마다 자산 추이·월간 리포트가 달라지므로 vault로 옮겨 동기화를 태운다.
 */
export class SnapshotStore {
  constructor(
    private readonly app: App,
    private readonly getRootFolder: () => string,
  ) {}

  private path(): string {
    return normalizePath(`${this.getRootFolder()}/snapshots.json`);
  }

  async load(): Promise<AssetSnapshot[]> {
    try {
      if (!(await this.app.vault.adapter.exists(this.path()))) return [];
      const raw = JSON.parse(await this.app.vault.adapter.read(this.path())) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter(
        (s): s is AssetSnapshot =>
          typeof s === "object" &&
          s !== null &&
          typeof (s as AssetSnapshot).date === "string" &&
          typeof (s as AssetSnapshot).totalAssets === "number",
      );
    } catch {
      return [];
    }
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
