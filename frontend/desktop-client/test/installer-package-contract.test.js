const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("release scripts preserve portable packaging and add a Windows installer", () => {
  assert.match(packageJson.scripts["package:portable"] ?? "", /package-desktop-client/);
  assert.match(packageJson.scripts["package:installer"] ?? "", /electron-forge make/);
  assert.match(packageJson.scripts["package:installer"] ?? "", /win32/);
  assert.match(packageJson.scripts["package:installer"] ?? "", /x64/);
});

test("installer dependencies are exact and use the approved Forge Squirrel toolchain", () => {
  assert.equal(packageJson.devDependencies["@electron-forge/cli"], "7.11.2");
  assert.equal(packageJson.devDependencies["@electron-forge/maker-squirrel"], "7.11.2");
  assert.equal(packageJson.dependencies["electron-squirrel-startup"], "1.0.1");
});

test("Forge config fixes the app identity and versioned installer artifact", () => {
  const forgeConfig = read("forge.config.js");
  assert.match(forgeConfig, /@electron-forge\/maker-squirrel/);
  assert.match(forgeConfig, /name:\s*["']MoaWorksDesktop["']/);
  assert.match(forgeConfig, /MoaWorks-Desktop-\$\{version\}-Setup\.exe/);
  assert.match(forgeConfig, /asar:\s*true/);
  assert.match(forgeConfig, /noMsi:\s*true/);
});

test("main process consumes Squirrel install and update startup events before app setup", () => {
  const mainProcess = read("electron/main.js");
  assert.match(mainProcess, /electron-squirrel-startup/);
  assert.match(mainProcess, /app\.quit\(\)/);
  assert.ok(
    mainProcess.indexOf("electron-squirrel-startup") < mainProcess.indexOf("app.whenReady"),
    "Squirrel startup handling must run before normal app setup",
  );
});
