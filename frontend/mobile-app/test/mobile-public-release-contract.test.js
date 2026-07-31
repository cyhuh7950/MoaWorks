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
const packageJson = JSON.parse(read("package.json"));
const publicPackager = read("scripts/mobile-package-public-android.js");
const gitignore = fs.readFileSync(path.resolve(root, "..", "..", ".gitignore"), "utf8");

test("Google Play build targets API 36", () => {
  assert.match(rootGradle, /compileSdkVersion\s*=\s*36/);
  assert.match(rootGradle, /targetSdkVersion\s*=\s*36/);
});

test("public release has a dedicated upload signing configuration", () => {
  assert.match(appGradle, /publicRelease\s*\{/);
  assert.match(appGradle, /MOAWORKS_UPLOAD_KEYSTORE_PATH/);
  assert.match(appGradle, /MOAWORKS_UPLOAD_KEYSTORE_PASSWORD/);
  assert.match(appGradle, /MOAWORKS_UPLOAD_KEY_ALIAS/);
  assert.match(appGradle, /MOAWORKS_UPLOAD_KEY_PASSWORD/);
  assert.match(appGradle, /signingConfig\s+signingConfigs\.publicUpload/);
  assert.doesNotMatch(appGradle, /storePassword\s+['"][^'"]+['"]\s*\n\s*keyAlias/);
});

test("public AAB packager is separate from the internal APK packager", () => {
  assert.equal(packageJson.scripts["build:public:android"], "node ./scripts/mobile-package-public-android.js");
  assert.match(publicPackager, /bundlePublicRelease/);
  assert.match(publicPackager, /android-public-release\.aab/);
  assert.match(publicPackager, /publicReleaseEligible:\s*true/);
  assert.match(publicPackager, /play-app-signing-upload-key/);
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
