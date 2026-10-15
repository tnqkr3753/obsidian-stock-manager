import { Notice, requestUrl, type Plugin } from "obsidian";
import { compareVersions, parseLatestRelease, RELEASE_FILES, type LatestRelease } from "./release";

const UPDATE_REPO = "tnqkr3753/obsidian-stock-manager";
const LATEST_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

/** 코어의 비공개 플러그인 관리자 — 업데이트 후 재로드에만 쓴다. */
interface PluginManager {
  disablePlugin(id: string): Promise<void>;
  enablePlugin(id: string): Promise<void>;
}

export interface UpdaterHost {
  plugin: Plugin;
  getSkippedVersion: () => string;
  skipVersion: (version: string) => Promise<void>;
}

/** GitHub 최신 릴리스 확인 → 알림 → 파일 교체 → 플러그인 재로드. */
export class Updater {
  private installing = false;

  constructor(private readonly host: UpdaterHost) {}

  private get manifest() {
    return this.host.plugin.manifest;
  }

  /** silent: 시작 시 자동 확인 — 최신이거나 실패해도 조용히 지나간다. */
  async check(silent: boolean): Promise<void> {
    const release = await this.fetchLatest();
    if (!release.ok) {
      if (!silent) new Notice(`업데이트 확인 실패: ${release.error}`);
      return;
    }
    const { version } = release.value;
    const isNewer = compareVersions(version, this.manifest.version) > 0;
    if (!isNewer) {
      if (!silent) new Notice(`최신 버전입니다 (${this.manifest.version})`);
      return;
    }
    if (silent && this.host.getSkippedVersion() === version) return;
    this.showUpdateNotice(release.value);
  }

  private async fetchLatest() {
    try {
      const res = await requestUrl({
        url: LATEST_URL,
        headers: { Accept: "application/vnd.github+json" },
        throw: false,
      });
      if (res.status !== 200) return { ok: false as const, error: `HTTP ${res.status}` };
      return parseLatestRelease(res.json);
    } catch (e) {
      return { ok: false as const, error: String(e) };
    }
  }

  private showUpdateNotice(release: LatestRelease): void {
    const fragment = createFragment((f) => {
      f.createDiv({
        text: `Stock Manager 새 버전 ${release.version}이 있습니다 (현재 ${this.manifest.version})`,
      });
      const actions = f.createDiv({ cls: "sm-update-actions" });
      actions.createEl("button", { text: "업데이트", cls: "mod-cta" }).onclick = (e) => {
        e.stopPropagation();
        notice.hide();
        void this.install(release);
      };
      actions.createEl("button", { text: "이 버전 건너뛰기" }).onclick = (e) => {
        e.stopPropagation();
        notice.hide();
        void this.host.skipVersion(release.version);
      };
      if (release.pageUrl) {
        actions.createEl("a", { text: "변경 내역", href: release.pageUrl });
      }
    });
    const notice = new Notice(fragment, 0); // 0 = 사용자가 닫을 때까지 유지
  }

  private async install(release: LatestRelease): Promise<void> {
    if (this.installing) return;
    this.installing = true;
    const progress = new Notice(`${release.version} 내려받는 중…`, 0);
    try {
      // 전부 내려받고 검증한 뒤에만 쓴다 — 중간 실패로 플러그인이 반쯤 바뀐 상태가 되지 않게
      const files = await Promise.all(
        RELEASE_FILES.map(async (name) => {
          const res = await requestUrl({ url: release.assets[name], throw: false });
          if (res.status !== 200) throw new Error(`${name} 다운로드 실패 (HTTP ${res.status})`);
          return { name, text: res.text };
        }),
      );
      this.verifyManifest(files.find((f) => f.name === "manifest.json")!.text, release.version);

      const dir = this.manifest.dir;
      if (!dir) throw new Error("플러그인 폴더를 찾지 못했습니다");
      const adapter = this.host.plugin.app.vault.adapter;
      for (const file of files) await adapter.write(`${dir}/${file.name}`, file.text);

      progress.hide();
      new Notice(`Stock Manager ${release.version}로 업데이트했어요. 다시 불러옵니다…`);
      await this.reloadPlugin();
    } catch (e) {
      progress.hide();
      new Notice(`업데이트 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.installing = false;
    }
  }

  private verifyManifest(text: string, expectedVersion: string): void {
    const parsed: unknown = JSON.parse(text);
    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    if (record["id"] !== this.manifest.id) throw new Error("다른 플러그인의 릴리스입니다");
    if (record["version"] !== expectedVersion) throw new Error("릴리스 태그와 manifest 버전이 다릅니다");
  }

  private async reloadPlugin(): Promise<void> {
    const plugins = (this.host.plugin.app as unknown as { plugins?: PluginManager }).plugins;
    if (!plugins) {
      new Notice("Obsidian을 다시 시작하면 새 버전이 적용됩니다.");
      return;
    }
    const id = this.manifest.id;
    await plugins.disablePlugin(id);
    await plugins.enablePlugin(id);
  }
}
