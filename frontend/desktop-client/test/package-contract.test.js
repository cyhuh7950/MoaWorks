const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageScript = fs.readFileSync(path.join(root, "scripts", "package-desktop-client.js"), "utf8");

test("package scripts expose test, coverage, build and portable packaging", () => {
  for (const name of ["test", "test:coverage", "build", "package"]) {
    assert.equal(typeof packageJson.scripts[name], "string");
  }
  assert.match(packageJson.scripts.package, /package-desktop-client/);
});

test("clean install downloads the Electron runtime required by portable packaging", () => {
  assert.equal(packageJson.scripts.postinstall, "install-electron");
});

test("desktop runtime uses the approved Electron security baseline", () => {
  assert.equal(packageJson.devDependencies.electron, "43.2.0");
});

test("portable packaging contract includes versioned directory, EXE, ZIP and SHA-256 manifest", () => {
  assert.match(packageScript, /MoaWorks-Desktop-\$\{version\}-win-x64-portable/);
  assert.match(packageScript, /MoaWorks Desktop Client\.exe/);
  assert.match(packageScript, /\.zip/);
  assert.match(packageScript, /sha256/i);
  assert.match(packageScript, /manifest/i);
});

test("portable packaging includes the Squirrel startup runtime required by main process", () => {
  assert.match(packageScript, /electron-squirrel-startup/);
  assert.match(packageScript, /node_modules/);
});
