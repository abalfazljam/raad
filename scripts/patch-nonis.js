#!/usr/bin/env node
/*
 * patch-nonis.js — enable wine-free NSIS installer builds on Linux/CI.
 *
 * electron-builder (25.x) normally runs the intermediate uninstaller-builder
 * installer under Wine on Linux. On machines/CI without Wine this fails with:
 *   "wine is required, please see https://electron.build/multi-platform-build#linux"
 *
 * app-builder-lib already ships a pure-JS alternative (UninstallerReader) that
 * extracts the uninstaller without executing anything — it is selected when
 * isMacOsCatalina() returns true. This patch makes that code path the default
 * on non-Windows platforms, so `npm run dist:win` works without Wine.
 *
 * Applied automatically via the package.json "postinstall" hook.
 * (No effect on Windows, where Wine is never needed.)
 */
const path = require("path");
const fs = require("fs");

if (process.platform === "win32") {
  process.exit(0);
}

const target = path.join(
  __dirname, "..", "node_modules", "app-builder-lib", "out", "util", "macosVersion.js"
);

if (!fs.existsSync(target)) {
  console.log("[patch-nonis] app-builder-lib not installed yet — skipping");
  process.exit(0);
}

let src = fs.readFileSync(target, "utf8");
const original = 'function isMacOsCatalina() {\n    return process.platform === "darwin" && semver.gte((0, os_1.release)(), "19.0.0");\n}';
const patched = 'function isMacOsCatalina() {\n    return true; // [patch-nonis] use pure-JS UninstallerReader instead of Wine on Linux/macOS CI\n}';

if (src.includes(patched)) {
  console.log("[patch-nonis] already applied");
  process.exit(0);
}

if (!src.includes(original)) {
  console.warn("[patch-nonis] target pattern not found (electron-builder version changed?) — leaving unpatched");
  process.exit(0);
}

src = src.replace(original, patched);
fs.writeFileSync(target, src);
console.log("[patch-nonis] applied — NSIS builds will use UninstallerReader (no Wine required)");
