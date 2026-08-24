#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { npxCommand, sha256File } = require("./mobile-build-support");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const evidenceDir = path.join(projectRoot, "build-evidence");
const bundleName = `MoaWorks-Mobile-${packageJson.version}-android-production.bundle`;
const bundlePath = path.join(evidenceDir, bundleName);
const assetsDir = path.join(evidenceDir, "mobile-assets");
const logPath = path.join(evidenceDir, `${bundleName}.log`);

function fail(code, detail) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(logPath, `STATUS=blocked\nBLOCKER=${code}\n`, "utf8");
  console.error(`STATUS=blocked\nBLOCKER=${code}\nDETAIL=${detail}`);
  process.exit(2);
}

for (const required of ["node_modules", "index.js", "App.tsx", "android"]) {
  if (!fs.existsSync(path.join(projectRoot, required))) fail("MOBILE_BUILD_PREREQUISITE_MISSING", `${required} is missing`);
}

fs.mkdirSync(evidenceDir, { recursive: true });
fs.rmSync(bundlePath, { force: true });
const bundleArgs = [
  "react-native", "bundle", "--platform", "android", "--dev", "false",
  "--entry-file", "index.js", "--bundle-output", bundlePath,
  "--assets-dest", assetsDir, "--reset-cache",
];
const result = process.platform === "win32"
  ? spawnSync(process.execPath, [
      path.join(projectRoot, "node_modules", "react-native", "cli.js"),
      ...bundleArgs.slice(1),
    ], { cwd: projectRoot, stdio: "inherit" })
  : spawnSync(npxCommand(), bundleArgs, { cwd: projectRoot, stdio: "inherit" });
if ((result.status ?? 1) !== 0 || !fs.existsSync(bundlePath)) fail("MOBILE_BUNDLE_FAILED", "React Native production bundle failed");

const hash = sha256File(bundlePath);
fs.writeFileSync(logPath, `STATUS=success\nBUNDLE=${bundleName}\nBUNDLE_SHA256=${hash}\n`, "utf8");
console.log(`STATUS=success\nBUNDLE=${path.relative(projectRoot, bundlePath)}\nBUNDLE_SHA256=${hash}`);
