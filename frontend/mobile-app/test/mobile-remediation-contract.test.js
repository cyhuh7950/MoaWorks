const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const gradle = fs.readFileSync(path.join(root, "android", "app", "build.gradle"), "utf8");
const androidCommand = fs.readFileSync(path.join(root, "scripts", "mobile-android-command.js"), "utf8");
const packager = fs.readFileSync(path.join(root, "scripts", "mobile-package-android.js"), "utf8");
const gradleProperties = fs.readFileSync(path.join(root, "android", "gradle.properties"), "utf8");
const mainApplication = fs.readFileSync(
  path.join(root, "android", "app", "src", "main", "java", "com", "moaworks", "mobile", "MainApplication.kt"),
  "utf8",
);
const proguardRules = fs.readFileSync(path.join(root, "android", "app", "proguard-rules.pro"), "utf8");

test("legacy architecture MainApplication does not connect the unused ReactHost path", () => {
  assert.match(gradleProperties, /^newArchEnabled=false$/m);
  assert.match(mainApplication, /override val reactNativeHost:\s*ReactNativeHost/);
  assert.doesNotMatch(mainApplication, /import com\.facebook\.react\.ReactHost/);
  assert.doesNotMatch(mainApplication, /DefaultReactHost\.getDefaultReactHost/);
  assert.doesNotMatch(mainApplication, /override val reactHost:\s*ReactHost/);
});

test("release R8 fixes React Native development mode to false", () => {
  assert.match(
    proguardRules,
    /-assumevalues class com\.facebook\.react\.common\.build\.ReactBuildConfig\s*\{[\s\S]*public static boolean DEBUG return false;[\s\S]*\}/,
  );
  assert.match(
    proguardRules,
    /-assumevalues class com\.facebook\.react\.BuildConfig\s*\{[\s\S]*public static boolean DEBUG return false;[\s\S]*\}/,
  );
});

test("debug variant is restored without standalone, non-debuggable or minify overrides", () => {
  assert.doesNotMatch(gradle, /^\s*debuggableVariants\s*=/m);
  const debugBlock = gradle.match(/buildTypes\s*\{\s*debug\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";
  assert.doesNotMatch(debugBlock, /debuggable\s+false|minifyEnabled\s+true/);
});

test("internal release uses assembleRelease and a release APK source", () => {
  assert.match(androidCommand, /assembleRelease/);
  assert.match(packager, /app-release\.apk/);
  assert.doesNotMatch(packager, /app-debug\.apk/);
});

test("artifact and manifest are classified internal-release but never public", () => {
  assert.match(packager, /MoaWorks-Mobile-\$\{version\}-android-internal-release\.apk/);
  assert.match(packager, /buildType:\s*"internal-release"/);
  assert.match(packager, /publicReleaseEligible:\s*false/);
  assert.match(packager, /repository-debug-keystore/);
});

test("packager requires an audit reachability report before success", () => {
  assert.match(packager, /mobile-audit-reachability/);
  assert.match(packager, /auditReachability/);
  assert.doesNotMatch(packager, /shell:\s*process\.platform\s*===\s*"win32"/);
});

test("packager blocks debuggable APKs and embedded development server constants", () => {
  assert.match(packager, /mobile-verify-apk/);
  assert.match(packager, /APK_DEBUGGABLE/);
  assert.match(packager, /APK_DEV_SERVER_CONSTANTS_PRESENT/);
});

test("audit reachability classifier is implemented as a machine-readable module", () => {
  const modulePath = path.join(root, "scripts", "mobile-audit-reachability.js");
  assert.equal(fs.existsSync(modulePath), true);
  const module = require(modulePath);
  for (const name of ["classifyAudit", "summarizeAudit", "writeReachabilityReport"]) {
    assert.equal(typeof module[name], "function", `${name} is required`);
  }
});
