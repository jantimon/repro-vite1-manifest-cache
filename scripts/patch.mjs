// Applies or reverts patches/*.patch on node_modules/vinext. Rebuild afterwards:
// vinext's server code is bundled into dist/server at build time
// Usage: node scripts/patch.mjs apply|revert
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATCH = new URL("../patches/vinext-1.0.0-cache-manifest-lookups.patch", import.meta.url).pathname;
const TARGET = "node_modules/vinext/dist/server/pages-asset-tags.js";

export function isPatched() {
  return readFileSync(TARGET, "utf8").includes("sharedChunkCache");
}

export function setPatched(wanted) {
  if (isPatched() === wanted) return;
  const args = ["-p1", "-d", "node_modules/vinext", "-i", PATCH];
  execFileSync("patch", wanted ? args : ["-R", ...args], { stdio: "inherit" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  if (mode !== "apply" && mode !== "revert") throw new Error("usage: patch.mjs apply|revert");
  setPatched(mode === "apply");
  console.log(`vinext ${isPatched() ? "patched" : "unpatched"}; run npm run build`);
}
