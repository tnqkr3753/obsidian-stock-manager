import { describe, expect, it } from "vitest";
import { compareVersions, parseLatestRelease, RELEASE_FILES } from "../src/update/release";

describe("compareVersions", () => {
  it("compares numerically per segment, not lexically", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.5.1", "0.5.1")).toBe(0);
    expect(compareVersions("0.5.0", "0.5.1")).toBeLessThan(0);
  });

  it("ignores a leading v and treats missing segments as zero", () => {
    expect(compareVersions("v1.2", "1.2.0")).toBe(0);
  });
});

const asset = (name: string) => ({
  name,
  browser_download_url: `https://github.com/o/r/releases/download/0.6.0/${name}`,
});

describe("parseLatestRelease", () => {
  const json = {
    tag_name: "0.6.0",
    html_url: "https://github.com/o/r/releases/tag/0.6.0",
    draft: false,
    prerelease: false,
    assets: RELEASE_FILES.map(asset),
  };

  it("returns version, page url and download url per required file", () => {
    const r = parseLatestRelease(json);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.version).toBe("0.6.0");
    expect(r.ok && r.value.assets["main.js"]).toBe(
      "https://github.com/o/r/releases/download/0.6.0/main.js",
    );
  });

  it("fails when a required file is missing from the release", () => {
    const r = parseLatestRelease({ ...json, assets: [asset("main.js")] });
    expect(r.ok).toBe(false);
  });

  it("fails on draft or prerelease", () => {
    expect(parseLatestRelease({ ...json, prerelease: true }).ok).toBe(false);
    expect(parseLatestRelease({ ...json, draft: true }).ok).toBe(false);
  });

  it("rejects download urls outside github.com", () => {
    const evil = {
      ...json,
      assets: RELEASE_FILES.map((name) => ({
        name,
        browser_download_url: `https://evil.example/${name}`,
      })),
    };
    expect(parseLatestRelease(evil).ok).toBe(false);
  });

  it("fails on malformed payloads", () => {
    expect(parseLatestRelease(null).ok).toBe(false);
    expect(parseLatestRelease({ message: "Not Found" }).ok).toBe(false);
  });
});
