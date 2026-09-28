const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolvePublicVersionCode } = require("../scripts/mobile-public-version-code");

const gradle = (code) => `android {\n  defaultConfig {\n    applicationId "com.moaworks.mobile"\n    versionCode ${code}\n    versionName "1.0"\n  }\n}`;
const badging = (code) => `package: name='com.moaworks.mobile' versionCode='${code}' versionName='1.0'`;

test("public manifest versionCode follows the matching Gradle and built APK version", () => {
  assert.equal(resolvePublicVersionCode(gradle(2), badging(2)), 2);
  assert.equal(resolvePublicVersionCode(gradle(3), badging(3)), 3);
});

test("public manifest versionCode rejects source/artifact disagreement and unreadable versions", () => {
  assert.throws(() => resolvePublicVersionCode(gradle(3), badging(2)), /VERSION_CODE_MISMATCH/);
  assert.throws(() => resolvePublicVersionCode(gradle(3), ""), /VERSION_CODE_UNREADABLE/);
  assert.throws(() => resolvePublicVersionCode(gradle("unknown"), badging(3)), /VERSION_CODE_UNREADABLE/);
});

test("current public source version is accepted without a hardcoded manifest number", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../android/app/build.gradle"), "utf8");
  assert.equal(resolvePublicVersionCode(source, badging(3)), 3);
  const packager = fs.readFileSync(path.resolve(__dirname, "../scripts/mobile-package-public-android.js"), "utf8");
  assert.match(packager, /appVersionCode:\s*appVersionCode/);
  assert.doesNotMatch(packager, /appVersionCode:\s*\d+/);
});
