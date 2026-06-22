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
const logPath = path.join(evidenceRoot, `${bundleDirName}.log`);
const manifestPath = path.join(evidenceRoot, `${bundleDirName}.json`);
const archivePath = path.join(evidenceRoot, `${bundleDirName}.tar.gz`);

const filesToCopy = [
  "index.html",
  "package.json",
  "README.md",
];

const directoriesToCopy = [
  "electron",
];

writeLogLine(logPath, `desktop packaging start projectRoot=${projectRoot}`);

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
  writeLogLine(logPath, `copied directory=${dir}`);
}

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
  archivePath: fs.existsSync(archivePath) ? path.relative(projectRoot, archivePath) : null,
  archiveSha256: fs.existsSync(archivePath) ? sha256(archivePath) : null,
  artifacts: artifactFiles,
  nodeModulesPresent: fs.existsSync(path.join(projectRoot, "node_modules")),
  electronBinaryPresent: fs.existsSync(path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron")),
  status: fs.existsSync(archivePath) ? "success" : "partial",
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
console.log(`MANIFEST=${path.relative(projectRoot, manifestPath)}`);
console.log(`LOG=${path.relative(projectRoot, logPath)}`);
