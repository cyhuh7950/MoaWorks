const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
};

const rootGradle = read("android/build.gradle");
const appGradle = read("android/app/build.gradle");
const gradleWrapper = read("android/gradle/wrapper/gradle-wrapper.properties");
const packageJson = JSON.parse(read("package.json"));
const publicPackager = read("scripts/mobile-package-public-android.js");
const androidCommand = read("scripts/mobile-android-command.js");
const gitignore = fs.readFileSync(path.resolve(root, "..", "..", ".gitignore"), "utf8");

test("Google Play build targets API 36", () => {
  assert.match(rootGradle, /compileSdkVersion\s*=\s*36/);
  assert.match(rootGradle, /targetSdkVersion\s*=\s*36/);
});

test("API 36 uses an officially compatible Android Gradle toolchain", () => {
  assert.match(rootGradle, /com\.android\.tools\.build:gradle:8\.10\.1/);
  assert.match(gradleWrapper, /gradle-8\.11\.1-all\.zip/);
});

test("public release has a dedicated upload signing configuration", () => {
  assert.match(appGradle, /publicRelease\s*\{/);
  assert.match(appGradle, /MOAWORKS_UPLOAD_KEYSTORE_PATH/);
  assert.match(appGradle, /MOAWORKS_UPLOAD_KEYSTORE_PASSWORD/);
  assert.match(appGradle, /MOAWORKS_UPLOAD_KEY_ALIAS/);
  assert.match(appGradle, /MOAWORKS_UPLOAD_KEY_PASSWORD/);
  assert.match(appGradle, /signingConfig\s+signingConfigs\.publicUpload/);
  const publicUploadBlock = appGradle.match(/publicUpload\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";
  assert.doesNotMatch(publicUploadBlock, /storePassword\s+['"][^'"]+['"]/);
  assert.doesNotMatch(publicUploadBlock, /keyPassword\s+['"][^'"]+['"]/);
});

test("public AAB packager is separate from the internal APK packager", () => {
  assert.equal(packageJson.scripts["build:public:android"], "node ./scripts/mobile-package-public-android.js");
  assert.match(publicPackager, /mobile-android-command\.js"\), "public"/);
  assert.match(androidCommand, /assemblePublicRelease/);
  assert.match(androidCommand, /bundlePublicRelease/);
  assert.match(publicPackager, /android-public-release\.aab/);
  assert.match(publicPackager, /playInternalUploadEligible:\s*true/);
  assert.match(publicPackager, /publicReleaseEligible:\s*false/);
  assert.match(publicPackager, /play-app-signing-upload-key/);
});

test("public release reuses runtime audit and APK security verification", () => {
  assert.match(publicPackager, /mobile-audit-reachability/);
  assert.match(publicPackager, /mobile-verify-apk/);
  assert.match(publicPackager, /verifyApk/);
  assert.match(publicPackager, /RUNTIME_AUDIT_REACHABILITY/);
  assert.match(publicPackager, /APK_DEBUGGABLE/);
  assert.match(publicPackager, /APK_DEV_SERVER_CONSTANTS_PRESENT/);
});

test("public packager fails closed without secrets and never logs them", () => {
  assert.match(publicPackager, /UPLOAD_KEY_NOT_CONFIGURED/);
  assert.match(publicPackager, /KEYSTORE_INSIDE_REPOSITORY/);
  assert.doesNotMatch(publicPackager, /console\.(?:log|error)\([^\n]*(?:PASSWORD|KEY_ALIAS)/);
  assert.doesNotMatch(publicPackager, /process\.argv[^\n]*(?:PASSWORD|KEY_ALIAS)/);
});

test("keystores and public AAB artifacts are ignored", () => {
  assert.match(gitignore, /^\*\.jks$/m);
  assert.match(gitignore, /^\*\.keystore$/m);
  assert.match(gitignore, /^frontend\/mobile-app\/build-evidence\/\*\.aab$/m);
});
