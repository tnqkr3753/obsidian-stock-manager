import type { Result } from "../domain/types";
import { err, ok } from "../domain/types";

/** 릴리스에 반드시 있어야 하는 플러그인 파일. manifest.json은 마지막에 써야 하므로 끝에 둔다. */
export const RELEASE_FILES = ["main.js", "styles.css", "manifest.json"] as const;
export type ReleaseFile = (typeof RELEASE_FILES)[number];

export interface LatestRelease {
  version: string;
  pageUrl: string;
  assets: Record<ReleaseFile, string>; // 파일명 → 다운로드 URL
}

const segments = (v: string): number[] =>
  v
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((s) => Number.parseInt(s, 10) || 0);

/** 세그먼트별 숫자 비교 — "0.10.0" > "0.9.9". a가 크면 양수. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [segments(a), segments(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** 다운로드 받은 코드를 그대로 실행하므로 GitHub 릴리스 경로만 허용한다. */
const isGithubDownload = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "github.com" && u.pathname.includes("/releases/download/");
  } catch {
    return false;
  }
};

/** GitHub `releases/latest` 응답 → 업데이트에 필요한 정보. 형식이 어긋나면 업데이트하지 않는다. */
export function parseLatestRelease(json: unknown): Result<LatestRelease> {
  if (!isRecord(json) || typeof json["tag_name"] !== "string") {
    return err("릴리스 정보를 읽지 못했습니다");
  }
  if (json["draft"] === true || json["prerelease"] === true) {
    return err("정식 릴리스가 아닙니다");
  }
  const rawAssets = Array.isArray(json["assets"]) ? json["assets"] : [];
  const urlOf = (name: string): string | undefined => {
    const found = rawAssets.find((a) => isRecord(a) && a["name"] === name);
    const url = isRecord(found) ? found["browser_download_url"] : undefined;
    return typeof url === "string" && isGithubDownload(url) ? url : undefined;
  };

  const entries = RELEASE_FILES.map((name) => [name, urlOf(name)] as const);
  const missing = entries.filter(([, url]) => url === undefined).map(([name]) => name);
  if (missing.length > 0) return err(`릴리스에 파일이 없습니다: ${missing.join(", ")}`);

  return ok({
    version: json["tag_name"].replace(/^v/i, ""),
    pageUrl: typeof json["html_url"] === "string" ? json["html_url"] : "",
    assets: Object.fromEntries(entries) as Record<ReleaseFile, string>,
  });
}
