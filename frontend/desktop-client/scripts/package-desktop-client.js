#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

function fail(message) {
  console.error(`STATUS=blocked\nDETAIL=${message}`);
  process.exit(2);
}

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
const bundleName = `MoaWorks-Desktop-${version}-win-x64-portable`;
const evidenceRoot = path.join(projectRoot, "build-evidence");
const bundleDir = path.join(evidenceRoot, bundleName);
const zipPath = path.join(evidenceRoot, `${bundleName}.zip`);
const manifestPath = path.join(evidenceRoot, `${bundleName}.manifest.json`);
const logPath = path.join(evidenceRoot, `${bundleName}.log`);
const electronDist = path.join(projectRoot, "node_modules", "electron", "dist");
const executableName = "MoaWorks Desktop Client.exe";

if (process.platform !== "win32") fail("Windows x64 portable package must be built on Windows.");
if (!fs.existsSync(path.join(electronDist, "electron.exe"))) fail("Electron Windows runtime is missing. Run npm ci first.");

fs.mkdirSync(evidenceRoot, { recursive: true });
fs.rmSync(bundleDir, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
copyDirectory(electronDist, bundleDir);
fs.renameSync(path.join(bundleDir, "electron.exe"), path.join(bundleDir, executableName));

const runId = isoNow().replace(/[:.]/g, "-");
const bundleDirName = `desktop-client-package-${runId}`;
const bundleDir = path.join(evidenceRoot, bundleDirName);
const portableDirName = `${bundleDirName}-portable`;
const portableDir = path.join(evidenceRoot, portableDirName);
const portableAppDir = path.join(portableDir, "resources", "app");
const logPath = path.join(evidenceRoot, `${bundleDirName}.log`);
const manifestPath = path.join(evidenceRoot, `${bundleDirName}.json`);
const archivePath = path.join(evidenceRoot, `${bundleDirName}.tar.gz`);
const electronDistDir = path.join(projectRoot, "node_modules", "electron", "dist");
const portableExeName = "MoaWorks Desktop Client.exe";
const portableExePath = path.join(portableDir, portableExeName);

const filesToCopy = [
  "index.html",
  "package.json",
  "README.md",
];

const directoriesToCopy = [
  "electron",
];

writeLogLine(logPath, `desktop packaging start projectRoot=${projectRoot}`);

if (!fs.existsSync(electronDistDir)) {
  writeLogLine(logPath, `missing electron dist=${electronDistDir}`);
  console.error(`STATUS=blocked`);
  console.error(`BLOCKER=DESKTOP_ELECTRON_RUNTIME_MISSING`);
  console.error(`DETAIL=missing node_modules/electron/dist`);
  process.exit(2);
}

for (const file of filesToCopy) {
  const source = path.join(projectRoot, file);
  if (!fs.existsSync(source)) {
    writeLogLine(logPath, `missing required file=${file}`);
    console.error(`STATUS=blocked`);
    console.error(`BLOCKER=DESKTOP_PACKAGE_INPUT_MISSING`);
    console.error(`DETAIL=missing ${file}`);
    process.exit(2);
  }
  copyFile(source, path.join(bundleDir, file));
  copyFile(source, path.join(portableAppDir, file));
  writeLogLine(logPath, `copied file=${file}`);
}
copyDirectory(path.join(projectRoot, "electron"), path.join(appDir, "electron"));
fs.rmSync(path.join(bundleDir, "resources", "default_app.asar"), { force: true });

for (const dir of directoriesToCopy) {
  const source = path.join(projectRoot, dir);
  if (!fs.existsSync(source)) {
    writeLogLine(logPath, `missing required directory=${dir}`);
    console.error(`STATUS=blocked`);
    console.error(`BLOCKER=DESKTOP_PACKAGE_INPUT_MISSING`);
    console.error(`DETAIL=missing ${dir}`);
    process.exit(2);
  }
  copyDirectory(source, path.join(bundleDir, dir));
  copyDirectory(source, path.join(portableAppDir, dir));
  writeLogLine(logPath, `copied directory=${dir}`);
}

copyDirectory(electronDistDir, portableDir);
writeLogLine(logPath, `copied electron dist=${electronDistDir}`);

const copiedElectronExePath = path.join(portableDir, "electron.exe");
if (!fs.existsSync(copiedElectronExePath)) {
  writeLogLine(logPath, `missing copied electron exe=${copiedElectronExePath}`);
  console.error(`STATUS=blocked`);
  console.error(`BLOCKER=DESKTOP_ELECTRON_EXE_MISSING`);
  console.error(`DETAIL=missing electron.exe in copied runtime`);
  process.exit(2);
}

if (fs.existsSync(portableExePath)) {
  fs.unlinkSync(portableExePath);
}
fs.renameSync(copiedElectronExePath, portableExePath);
writeLogLine(logPath, `renamed portable exe=${path.relative(projectRoot, portableExePath)}`);

const archiveResult = spawnSync("tar", ["-czf", archivePath, "-C", evidenceRoot, bundleDirName], {
  encoding: "utf8",
});
if (archive.status !== 0 || !fs.existsSync(zipPath)) fail(`Portable ZIP creation failed: ${archive.stderr || "unknown error"}`);

const manifest = {
  executedAt: isoNow(),
  projectRoot,
  bundleDir: path.relative(projectRoot, bundleDir),
  portableDir: path.relative(projectRoot, portableDir),
  portableExePath: fs.existsSync(portableExePath) ? path.relative(projectRoot, portableExePath) : null,
  portableExeSha256: fs.existsSync(portableExePath) ? sha256(portableExePath) : null,
  archivePath: fs.existsSync(archivePath) ? path.relative(projectRoot, archivePath) : null,
  archiveSha256: fs.existsSync(archivePath) ? sha256(archivePath) : null,
  artifacts: artifactFiles,
  nodeModulesPresent: fs.existsSync(path.join(projectRoot, "node_modules")),
  electronBinaryPresent: fs.existsSync(path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron")),
  status: fs.existsSync(archivePath) && fs.existsSync(portableExePath) ? "success" : "partial",
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
fs.writeFileSync(logPath, `STATUS=success\nPACKAGE=${manifest.zip.fileName}\nZIP_SHA256=${manifest.zip.sha256}\n`, "utf8");
fs.rmSync(bundleDir, { recursive: true, force: true });

console.log(`STATUS=${manifest.status}`);
console.log(`BUNDLE_DIR=${path.relative(projectRoot, bundleDir)}`);
if (manifest.archivePath) {
  console.log(`ARCHIVE=${manifest.archivePath}`);
  console.log(`ARCHIVE_SHA256=${manifest.archiveSha256}`);
} else {
  console.log(`ARCHIVE=none`);
}
if (manifest.portableExePath) {
  console.log(`PORTABLE_EXE=${manifest.portableExePath}`);
  console.log(`PORTABLE_EXE_SHA256=${manifest.portableExeSha256}`);
} else {
  console.log(`PORTABLE_EXE=none`);
}
console.log(`MANIFEST=${path.relative(projectRoot, manifestPath)}`);
console.log(`LOG=${path.relative(projectRoot, logPath)}`);
