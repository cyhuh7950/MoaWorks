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

const appDir = path.join(bundleDir, "resources", "app");
fs.mkdirSync(appDir, { recursive: true });
for (const name of ["index.html", "package.json", "README.md"]) {
  fs.copyFileSync(path.join(projectRoot, name), path.join(appDir, name));
}
copyDirectory(path.join(projectRoot, "electron"), path.join(appDir, "electron"));
fs.rmSync(path.join(bundleDir, "resources", "default_app.asar"), { force: true });

const executablePath = path.join(bundleDir, executableName);
const appCodePath = path.join(appDir, "electron", "main.js");
const portableInfo = {
  product: "MoaWorks Desktop Client",
  version,
  platform: "win32",
  arch: "x64",
  executable: { name: executableName, sha256: sha256(executablePath) },
  appCode: { path: "resources/app/electron/main.js", sha256: sha256(appCodePath) },
};
fs.writeFileSync(path.join(bundleDir, "portable-info.json"), JSON.stringify(portableInfo, null, 2), "utf8");

const archive = spawnSync("tar.exe", ["-a", "-c", "-f", zipPath, "-C", evidenceRoot, bundleName], {
  encoding: "utf8",
});
if (archive.status !== 0 || !fs.existsSync(zipPath)) fail(`Portable ZIP creation failed: ${archive.stderr || "unknown error"}`);

const manifest = {
  product: "MoaWorks Desktop Client",
  version,
  platform: "win32",
  arch: "x64",
  packageType: "portable-zip",
  portableDirectory: bundleName,
  zip: { fileName: path.basename(zipPath), size: fs.statSync(zipPath).size, sha256: sha256(zipPath) },
  executable: { fileName: executableName, size: fs.statSync(executablePath).size, sha256: sha256(executablePath) },
  appCode: { path: "resources/app/electron/main.js", size: fs.statSync(appCodePath).size, sha256: sha256(appCodePath) },
  status: "success",
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
fs.writeFileSync(logPath, `STATUS=success\nPACKAGE=${manifest.zip.fileName}\nZIP_SHA256=${manifest.zip.sha256}\n`, "utf8");
fs.rmSync(bundleDir, { recursive: true, force: true });

console.log("STATUS=success");
console.log(`PACKAGE=${path.relative(projectRoot, zipPath)}`);
console.log(`ZIP_SHA256=${manifest.zip.sha256}`);
console.log(`MANIFEST=${path.relative(projectRoot, manifestPath)}`);
console.log(`LOG=${path.relative(projectRoot, logPath)}`);
