const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { classifyVendorDevServerEvidence } = require("./mobile-apk-vendor-evidence");

const DEV_SERVER_CONSTANTS = ["10.0.2.2", "localhost:8081", "127.0.0.1", "host.docker.internal"];

function findBuildTool(androidSdk, toolName) {
  const root = path.join(androidSdk, "build-tools");
  const executable = process.platform === "win32" ? `${toolName}.exe` : toolName;
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, executable))
    .filter((candidate) => fs.existsSync(candidate))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))[0];
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function constantHits(files) {
  return DEV_SERVER_CONSTANTS.filter((constant) => {
    const needle = Buffer.from(constant);
    return files.some((file) => fs.readFileSync(file).includes(needle));
  });
}

function findReactNativeReleaseAar(version) {
  const gradleHome = process.env.GRADLE_USER_HOME || path.join(os.homedir(), ".gradle");
  const versionRoot = path.join(
    gradleHome,
    "caches",
    "modules-2",
    "files-2.1",
    "com.facebook.react",
    "react-android",
    version,
  );
  if (!fs.existsSync(versionRoot)) return null;
  for (const entry of fs.readdirSync(versionRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(versionRoot, entry.name, `react-android-${version}-release.aar`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function inspectReactNativeReleaseAar(aarPath, javaHome, tempDir) {
  if (!aarPath) return { status: "blocked", code: "RN_RELEASE_AAR_MISSING" };
  const aarDir = path.join(tempDir, "rn-release-aar");
  fs.mkdirSync(aarDir);
  const jar = path.join(javaHome, "bin", process.platform === "win32" ? "jar.exe" : "jar");
  const javap = path.join(javaHome, "bin", process.platform === "win32" ? "javap.exe" : "javap");
  const extracted = spawnSync(jar, ["xf", aarPath, "classes.jar"], { cwd: aarDir, encoding: "utf8" });
  if (extracted.status !== 0) return { status: "blocked", code: "RN_RELEASE_AAR_EXTRACT_FAILED" };
  const classesJar = path.join(aarDir, "classes.jar");
  const disassembly = spawnSync(
    javap,
    ["-classpath", classesJar, "-c", "-p", "com.facebook.react.modules.systeminfo.AndroidInfoModule"],
    { encoding: "utf8" },
  );
  if (disassembly.status !== 0) return { status: "blocked", code: "RN_RELEASE_AAR_INSPECTION_FAILED" };
  return {
    status: "success",
    disassembly: disassembly.stdout,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(aarPath)).digest("hex"),
  };
}

function applicationSourceFiles(projectRoot) {
  const roots = [
    path.join(projectRoot, "App.tsx"),
    path.join(projectRoot, "index.js"),
    path.join(projectRoot, "android", "app", "src", "main"),
  ];
  return roots.flatMap((sourcePath) => {
    if (!fs.existsSync(sourcePath)) return [];
    return fs.statSync(sourcePath).isDirectory() ? walkFiles(sourcePath) : [sourcePath];
  }).filter((file) => /\.(?:js|jsx|ts|tsx|kt|java|xml)$/.test(file));
}

function verifyApk(apkPath, androidSdk, javaHome, projectRoot, reactNativeVersion, variant = "release") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moaworks-apk-verify-"));
  try {
    const asciiApk = path.join(tempDir, "app-release.apk");
    const expandedDir = path.join(tempDir, "expanded");
    fs.copyFileSync(apkPath, asciiApk);
    fs.mkdirSync(expandedDir);

    const aapt = findBuildTool(androidSdk, "aapt");
    if (!aapt) return { status: "blocked", code: "AAPT_MISSING" };
    const badging = spawnSync(aapt, ["dump", "badging", asciiApk], { encoding: "utf8" });
    if (badging.status !== 0) return { status: "blocked", code: "APK_BADGING_FAILED", detail: badging.stderr };
    if (/^application-debuggable$/m.test(badging.stdout)) return { status: "blocked", code: "APK_DEBUGGABLE" };

    const jar = path.join(javaHome, "bin", process.platform === "win32" ? "jar.exe" : "jar");
    const extracted = spawnSync(jar, ["xf", asciiApk], { cwd: expandedDir, encoding: "utf8" });
    if (extracted.status !== 0) return { status: "blocked", code: "APK_EXTRACT_FAILED", detail: extracted.stderr };

    const files = walkFiles(expandedDir);
    const embeddedBundle = files.some((file) => path.relative(expandedDir, file).replaceAll("\\", "/") === "assets/index.android.bundle");
    if (!embeddedBundle) return { status: "blocked", code: "APK_EMBEDDED_BUNDLE_MISSING" };
    const bundlePath = path.join(expandedDir, "assets", "index.android.bundle");
    const mappingPath = path.join(projectRoot, "android", "app", "build", "outputs", "mapping", variant, "mapping.txt");
    if (!fs.existsSync(mappingPath)) return { status: "blocked", code: "RELEASE_MAPPING_MISSING" };
    const aarInspection = inspectReactNativeReleaseAar(
      findReactNativeReleaseAar(reactNativeVersion),
      javaHome,
      tempDir,
    );
    if (aarInspection.status !== "success") return aarInspection;
    const vendorEvidence = classifyVendorDevServerEvidence({
      apkConstants: constantHits(files),
      bundleConstants: constantHits([bundlePath]),
      appSourceConstants: constantHits(applicationSourceFiles(projectRoot)),
      releaseAarDisassembly: aarInspection.disassembly,
      mappingText: fs.readFileSync(mappingPath, "utf8"),
    });
    if (vendorEvidence.status === "blocked") {
      return {
        status: "blocked",
        code: vendorEvidence.code,
        devServerConstants: vendorEvidence.constants,
      };
    }
    return {
      status: "success",
      debuggable: false,
      embeddedBundle: true,
      devServerConstants: [],
      vendorEvidence: {
        ...vendorEvidence,
        releaseAarSha256: aarInspection.sha256,
      },
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  DEV_SERVER_CONSTANTS,
  findBuildTool,
  findReactNativeReleaseAar,
  inspectReactNativeReleaseAar,
  verifyApk,
  walkFiles,
};
