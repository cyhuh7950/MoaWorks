#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

function isoNow() {
  return new Date().toISOString();
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      copyFile(sourcePath, targetPath);
    }
  }
}

function writeLogLine(logPath, line) {
  fs.appendFileSync(logPath, `${isoNow()} ${line}\n`, "utf8");
}

const projectRoot = path.resolve(__dirname, "..");
const evidenceRoot = path.join(projectRoot, "build-evidence");
fs.mkdirSync(evidenceRoot, { recursive: true });

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

writeLogLine(logPath, `tar status=${archiveResult.status ?? 1}`);
if (archiveResult.stdout) {
  writeLogLine(logPath, `tar stdout=${archiveResult.stdout.trim()}`);
}
if (archiveResult.stderr) {
  writeLogLine(logPath, `tar stderr=${archiveResult.stderr.trim()}`);
}

const artifactFiles = [];
for (const relativePath of [
  "index.html",
  "package.json",
  "README.md",
  path.join("electron", "main.js"),
]) {
  const artifactPath = path.join(bundleDir, relativePath);
  artifactFiles.push({
    path: path.relative(projectRoot, artifactPath),
    size: fs.statSync(artifactPath).size,
    sha256: sha256(artifactPath),
  });
}

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
writeLogLine(logPath, `manifest=${path.relative(projectRoot, manifestPath)}`);

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
