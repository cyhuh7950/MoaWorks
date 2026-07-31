#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { findAndroidSdk, findJavaHome, sha256File } = require("./mobile-build-support");
const { writeReachabilityReport } = require("./mobile-audit-reachability");
const { verifyApk } = require("./mobile-verify-apk");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const evidenceDir = path.join(projectRoot, "build-evidence");
const artifactName = `MoaWorks-Mobile-${version}-android-public-release.aab`;
const artifactPath = path.join(evidenceDir, artifactName);
const manifestPath = path.join(evidenceDir, `${artifactName}.manifest.json`);
const auditReportName = `MoaWorks-Mobile-${version}-android-public-release.audit-reachability.json`;
const auditReportPath = path.join(evidenceDir, auditReportName);
const requiredEnvironment = [
  "MOAWORKS_UPLOAD_KEYSTORE_PATH",
  "MOAWORKS_UPLOAD_KEYSTORE_PASSWORD",
  "MOAWORKS_UPLOAD_KEY_ALIAS",
  "MOAWORKS_UPLOAD_KEY_PASSWORD",
];

function fail(code) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(artifactPath, { force: true });
  fs.rmSync(manifestPath, { force: true });
  console.error(`STATUS=blocked\nBLOCKER=${code}`);
  process.exit(2);
}

function isInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function findNpmCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]?.trim());
if (missingEnvironment.length > 0) fail("UPLOAD_KEY_NOT_CONFIGURED");

const keystorePath = path.resolve(process.env.MOAWORKS_UPLOAD_KEYSTORE_PATH);
if (isInside(projectRoot, keystorePath)) fail("KEYSTORE_INSIDE_REPOSITORY");
if (!fs.existsSync(keystorePath) || !fs.statSync(keystorePath).isFile()) fail("UPLOAD_KEYSTORE_NOT_FOUND");

fs.mkdirSync(evidenceDir, { recursive: true });
fs.rmSync(artifactPath, { force: true });
fs.rmSync(manifestPath, { force: true });
fs.rmSync(auditReportPath, { force: true });

const npmCli = findNpmCli();
if (!npmCli) fail("NPM_CLI_MISSING");
const auditResult = spawnSync(process.execPath, [npmCli, "audit", "--omit=dev", "--json"], {
  cwd: projectRoot,
  encoding: "utf8",
});
let audit;
try {
  audit = JSON.parse(auditResult.stdout);
} catch {
  fail("NPM_AUDIT_REPORT_INVALID");
}
const auditReachability = writeReachabilityReport(auditReportPath, audit);
if (auditReachability.summary.runtime > 0 || auditReachability.summary.unclassified > 0) {
  fail("RUNTIME_AUDIT_REACHABILITY");
}

const build = spawnSync(process.execPath, [path.join(__dirname, "mobile-android-command.js"), "public"], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});
if ((build.status ?? 1) !== 0) fail("ANDROID_PUBLIC_BUNDLE_FAILED");

const sourceAab = path.join(
  projectRoot,
  "android",
  "app",
  "build",
  "outputs",
  "bundle",
  "publicRelease",
  "app-publicRelease.aab",
);
if (!fs.existsSync(sourceAab)) fail("PUBLIC_AAB_MISSING");
fs.copyFileSync(sourceAab, artifactPath);

const sourceApk = path.join(
  projectRoot,
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "publicRelease",
  "app-publicRelease.apk",
);
if (!fs.existsSync(sourceApk)) fail("PUBLIC_VERIFICATION_APK_MISSING");
const androidSdk = findAndroidSdk();
const javaHome = findJavaHome();
if (!androidSdk || !javaHome) fail("PUBLIC_VERIFICATION_TOOLS_MISSING");
const apkVerification = verifyApk(
  sourceApk,
  androidSdk,
  javaHome,
  projectRoot,
  packageJson.dependencies["react-native"],
  "publicRelease",
);
if (apkVerification.code === "APK_DEBUGGABLE") fail("APK_DEBUGGABLE");
if (apkVerification.code === "APK_DEV_SERVER_CONSTANTS_PRESENT") fail("APK_DEV_SERVER_CONSTANTS_PRESENT");
if (apkVerification.status !== "success") fail(apkVerification.code || "PUBLIC_VERIFICATION_APK_INVALID");
const executable = (name) => path.join(javaHome, "bin", process.platform === "win32" ? `${name}.exe` : name);
const signature = spawnSync(executable("jarsigner"), ["-verify", artifactPath], { encoding: "utf8" });
if (signature.status !== 0) fail("PUBLIC_AAB_SIGNATURE_INVALID");
const certificate = spawnSync(executable("keytool"), ["-printcert", "-jarfile", artifactPath], { encoding: "utf8" });
if (certificate.status !== 0) fail("PUBLIC_AAB_CERTIFICATE_UNREADABLE");
if (/Android Debug/i.test(`${certificate.stdout}\n${certificate.stderr}`)) fail("PUBLIC_AAB_DEBUG_CERTIFICATE");

const archive = spawnSync(executable("jar"), ["tf", artifactPath], { encoding: "utf8" });
if (archive.status !== 0) fail("PUBLIC_AAB_ARCHIVE_INVALID");
const entries = archive.stdout.split(/\r?\n/);
for (const requiredEntry of ["base/manifest/AndroidManifest.xml", "base/assets/index.android.bundle"]) {
  if (!entries.includes(requiredEntry)) fail("PUBLIC_AAB_REQUIRED_ENTRY_MISSING");
}

const manifest = {
  product: "MoaWorks Mobile",
  version,
  packageId: "com.moaworks.mobile",
  appVersionName: "1.0",
  appVersionCode: 1,
  platform: "android",
  format: "aab",
  buildType: "public-release",
  androidVariant: "publicRelease",
  compileSdkVersion: 36,
  targetSdkVersion: 36,
  signing: "play-app-signing-upload-key",
  playInternalUploadEligible: true,
  publicReleaseEligible: false,
  debuggable: false,
  standaloneBundleEmbedded: true,
  minified: true,
  artifact: {
    fileName: artifactName,
    size: fs.statSync(artifactPath).size,
    sha256: sha256File(artifactPath),
  },
  auditReachability: {
    fileName: auditReportName,
    summary: auditReachability.summary,
  },
  apkVerification,
  verification: {
    jarSignature: "verified",
    certificate: "non-debug",
    requiredEntries: "verified",
  },
  status: "success",
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
console.log(`STATUS=success\nAAB=${artifactName}\nAAB_SHA256=${manifest.artifact.sha256}`);
