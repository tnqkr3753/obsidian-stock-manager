// `npm version <patch|minor|major>`가 package.json을 올린 뒤 실행된다.
// manifest.json·versions.json을 같은 버전으로 맞추고 커밋에 포함시킨다.
import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

writeFileSync("manifest.json", JSON.stringify({ ...manifest, version: targetVersion }, null, 2) + "\n");
writeFileSync(
  "versions.json",
  JSON.stringify({ ...versions, [targetVersion]: manifest.minAppVersion }, null, 2) + "\n",
);
