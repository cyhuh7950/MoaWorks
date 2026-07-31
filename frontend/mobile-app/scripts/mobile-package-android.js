#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { findAndroidSdk, findJavaHome, parseConnectedDevices, sha256File } = require("./mobile-build-support");
const { writeReachabilityReport } = require("./mobile-audit-reachability");
const { verifyApk } = require("./mobile-verify-apk");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const evidenceDir = path.join(projectRoot, "build-evidence");
const artifactName = `MoaWorks-Mobile-${version}-android-internal-release.apk`;
const artifactPath = path.join(evidenceDir, artifactName);
const manifestPath = path.join(evidenceDir, `${artifactName}.manifest.json`);
const logPath = path.join(evidenceDir, `${artifactName}.log`);
const auditReportName = `MoaWorks-Mobile-${version}-android-internal-release.audit-reachability.json`;
const auditReportPath = path.join(evidenceDir, auditReportName);
const bundleName = `MoaWorks-Mobile-${version}-android-production.bundle`;
const bundlePath = path.join(evidenceDir, bundleName);

function findNpmCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function fail(code, detail) {
  fs.rmSync(manifestPath, { force: true });
  fs.writeFileSync(logPath, `STATUS=blocked\nBLOCKER=${code}\n`, "utf8");
  console.error(`STATUS=blocked\nBLOCKER=${code}\nDETAIL=${detail}`);
  process.exit(2);
}

fs.mkdirSync(evidenceDir, { recursive: true });
fs.rmSync(manifestPath, { force: true });
fs.rmSync(auditReportPath, { force: true });
fs.rmSync(artifactPath, { force: true });
const bundle = spawnSync(process.execPath, [path.join(__dirname, "mobile-app-build-smoke.js")], { cwd: projectRoot, stdio: "inherit" });
if ((bundle.status ?? 1) !== 0 || !fs.existsSync(bundlePath)) fail("MOBILE_BUNDLE_FAILED", "Production bundle was not generated");
const androidBuild = spawnSync(process.execPath, [path.join(__dirname, "mobile-android-command.js"), "release"], { cwd: projectRoot, stdio: "inherit" });
if ((androidBuild.status ?? 1) !== 0) fail("ANDROID_ASSEMBLE_RELEASE_FAILED", "assembleRelease failed");

const sourceApk = path.join(projectRoot, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!fs.existsSync(sourceApk)) fail("APK_MISSING", "assembleRelease did not produce app-release.apk");
fs.copyFileSync(sourceApk, artifactPath);

const npmCli = findNpmCli();
if (!npmCli) fail("NPM_CLI_MISSING", "npm CLI was not found beside Node or in the user npm directory");
const auditResult = spawnSync(process.execPath, [npmCli, "audit", "--omit=dev", "--json"], {
  cwd: projectRoot,
  encoding: "utf8",
});
let audit;
try {
  audit = JSON.parse(auditResult.stdout);
} catch {
  fail("NPM_AUDIT_REPORT_INVALID", auditResult.stderr || "npm audit did not return JSON");
}
const auditReachability = writeReachabilityReport(auditReportPath, audit);
if (auditReachability.summary.runtime > 0 || auditReachability.summary.unclassified > 0) {
  fail("RUNTIME_AUDIT_REACHABILITY", JSON.stringify(auditReachability.summary));
}

const androidSdk = findAndroidSdk();
const javaHome = findJavaHome();
if (!androidSdk || !javaHome) fail("APK_VERIFICATION_TOOLS_MISSING", "Android SDK or JDK is unavailable");
const apkVerification = verifyApk(
  artifactPath,
  androidSdk,
  javaHome,
  projectRoot,
  packageJson.dependencies["react-native"],
);
if (apkVerification.code === "APK_DEBUGGABLE") fail("APK_DEBUGGABLE", "Release APK is debuggable");
if (apkVerification.code === "APK_DEV_SERVER_CONSTANTS_PRESENT") {
  fail("APK_DEV_SERVER_CONSTANTS_PRESENT", apkVerification.devServerConstants.join(","));
}
if (apkVerification.status !== "success") fail(apkVerification.code, apkVerification.detail || "APK verification failed");

let installVerification = { status: "GAP", code: "NO_CONNECTED_ANDROID_DEVICE", devices: 0 };
if (androidSdk) {
  const adbPath = path.join(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  const deviceResult = spawnSync(adbPath, ["devices"], { encoding: "utf8" });
  const devices = deviceResult.status === 0 ? parseConnectedDevices(deviceResult.stdout) : [];
  if (devices.length > 0) installVerification = { status: "AVAILABLE", code: null, devices: devices.length };
}

const manifest = {
  product: "MoaWorks Mobile",
  version,
  packageId: "com.moaworks.mobile",
  appVersionName: "1.0",
  appVersionCode: 1,
  platform: "android",
  buildType: "internal-release",
  androidVariant: "release",
  signing: "repository-debug-keystore",
  publicReleaseEligible: false,
  debuggable: false,
  standaloneBundleEmbedded: true,
  minified: true,
  artifact: { fileName: artifactName, size: fs.statSync(artifactPath).size, sha256: sha256File(artifactPath) },
  bundle: { fileName: bundleName, size: fs.statSync(bundlePath).size, sha256: sha256File(bundlePath) },
  auditReachability: { fileName: auditReportName, summary: auditReachability.summary },
  apkVerification,
  installVerification,
  status: "success",
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
fs.writeFileSync(logPath, `STATUS=success\nBUILD_TYPE=internal-release\nAPK=${artifactName}\nAPK_SHA256=${manifest.artifact.sha256}\nAUDIT_RUNTIME=${auditReachability.summary.runtime}\nAUDIT_UNCLASSIFIED=${auditReachability.summary.unclassified}\nDEVICE_STATUS=${installVerification.code || "CONNECTED_DEVICE_AVAILABLE"}\n`, "utf8");
console.log(`STATUS=success\nAPK=${path.relative(projectRoot, artifactPath)}\nAPK_SHA256=${manifest.artifact.sha256}\nMANIFEST=${path.relative(projectRoot, manifestPath)}\nDEVICE_STATUS=${installVerification.code || "CONNECTED_DEVICE_AVAILABLE"}`);
