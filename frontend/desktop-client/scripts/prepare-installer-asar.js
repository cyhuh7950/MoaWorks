const fs = require("node:fs");
const path = require("node:path");
const { createPackage } = require("@electron/asar");

const root = path.resolve(__dirname, "..");
const buildRoot = path.join(root, ".installer-build");
const stageRoot = path.join(buildRoot, "stage");
const asarPath = path.join(buildRoot, "app.asar");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

fs.rmSync(buildRoot, { recursive: true, force: true });
fs.mkdirSync(stageRoot, { recursive: true });

for (const relativePath of ["electron", "index.html"]) {
  fs.cpSync(path.join(root, relativePath), path.join(stageRoot, relativePath), { recursive: true });
}

const runtimePackage = "electron-squirrel-startup";
fs.cpSync(
  path.join(root, "node_modules", runtimePackage),
  path.join(stageRoot, "node_modules", runtimePackage),
  { recursive: true },
);

const runtimeManifest = {
  name: packageJson.name,
  productName: packageJson.productName,
  version: packageJson.version,
  main: packageJson.main,
  private: true,
  dependencies: {
    [runtimePackage]: packageJson.dependencies[runtimePackage],
  },
};
fs.writeFileSync(
  path.join(stageRoot, "package.json"),
  `${JSON.stringify(runtimeManifest, null, 2)}\n`,
  "utf8",
);

createPackage(stageRoot, asarPath)
  .then(() => {
    const size = fs.statSync(asarPath).size;
    process.stdout.write(`INSTALLER_ASAR=${path.relative(root, asarPath)}\n`);
    process.stdout.write(`INSTALLER_ASAR_BYTES=${size}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
