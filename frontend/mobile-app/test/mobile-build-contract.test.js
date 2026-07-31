const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const smokeSource = fs.readFileSync(path.join(root, "scripts", "mobile-app-build-smoke.js"), "utf8");
const androidCommandSource = fs.readFileSync(path.join(root, "scripts", "mobile-android-command.js"), "utf8");
const supportSource = fs.readFileSync(path.join(root, "scripts", "mobile-build-support.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "App.tsx"), "utf8");

test("package scripts expose test, coverage, production bundle and Android internal package", () => {
  for (const name of ["test", "test:coverage", "bundle", "package:android"]) {
    assert.equal(typeof packageJson.scripts[name], "string", `${name} script is required`);
  }
});

test("Windows bundle execution uses npx.cmd and validates prerequisites", () => {
  assert.match(smokeSource, /npxCommand/);
  assert.match(supportSource, /npx\.cmd/);
  assert.match(smokeSource, /node_modules/);
  assert.match(smokeSource, /android/);
});

test("Android wrapper has no fixed Windows username and supports conventional JDK and SDK discovery", () => {
  assert.doesNotMatch(androidCommandSource, /Users[\\/]cyhuh/i);
  assert.match(androidCommandSource, /JAVA_HOME/);
  assert.match(androidCommandSource, /ANDROID_(?:HOME|SDK_ROOT)/);
  assert.match(supportSource, /LOCALAPPDATA|Program Files/);
});

test("packager contract names an internal release APK and writes a SHA-256 manifest", () => {
  const packagePath = path.join(root, "scripts", "mobile-package-android.js");
  assert.equal(fs.existsSync(packagePath), true);
  const source = fs.readFileSync(packagePath, "utf8");
  assert.match(source, /MoaWorks-Mobile-\$\{version\}-android-internal-release\.apk/);
  assert.match(source, /sha256/i);
  assert.match(source, /manifest/i);
  assert.match(source, /publicReleaseEligible\s*:\s*false/);
});

test("mobile source excludes local and Docker-only API addresses", () => {
  assert.doesNotMatch(appSource, /localhost|127\.0\.0\.1|10\.0\.2\.2|host\.docker\.internal/i);
  assert.match(appSource, /https:\/\//);
});

test("build support module exposes environment discovery and device classification", () => {
  const supportPath = path.join(root, "scripts", "mobile-build-support.js");
  assert.equal(fs.existsSync(supportPath), true);
  const support = require(supportPath);
  for (const name of ["findJavaHome", "findAndroidSdk", "npxCommand", "parseConnectedDevices", "sha256File"]) {
    assert.equal(typeof support[name], "function", `${name} helper is required`);
  }
});

test("Android build permits the approved non-ASCII worktree path", () => {
  const properties = fs.readFileSync(path.join(root, "android", "gradle.properties"), "utf8");
  assert.match(properties, /^android\.overridePathCheck=true$/m);
});

test("internal release APK uses the default release bundle embedding", () => {
  const gradle = fs.readFileSync(path.join(root, "android", "app", "build.gradle"), "utf8");
  assert.doesNotMatch(gradle, /^\s*debuggableVariants\s*=/m);
  assert.match(androidCommandSource, /assembleRelease/);
});

test("debug behavior remains standard while internal release is minified", () => {
  const gradle = fs.readFileSync(path.join(root, "android", "app", "build.gradle"), "utf8");
  const debugBlock = gradle.match(/buildTypes\s*\{\s*debug\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";
  assert.doesNotMatch(debugBlock, /debuggable\s+false|minifyEnabled\s+true/);
  assert.match(gradle, /enableProguardInReleaseBuilds\s*=\s*true/);
});
