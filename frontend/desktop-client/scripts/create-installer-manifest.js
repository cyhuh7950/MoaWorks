const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const makerRoot = path.join(root, "out", "make", "squirrel.windows", "x64");
const artifacts = [
  { role: "installer", file: `MoaWorks-Desktop-${version}-Setup.exe` },
  { role: "update-package", file: `MoaWorksDesktop-${version}-full.nupkg` },
  { role: "update-index", file: "RELEASES" },
  {
    role: "runtime-asar",
    file: path.relative(root, path.join(root, "out", "MoaWorks Desktop Client-win32-x64", "resources", "app.asar")),
    absolutePath: path.join(root, "out", "MoaWorks Desktop Client-win32-x64", "resources", "app.asar"),
  },
].map((artifact) => {
  const absolutePath = artifact.absolutePath ?? path.join(makerRoot, artifact.file);
  const content = fs.readFileSync(absolutePath);
  return {
    role: artifact.role,
    file: artifact.file.split(path.sep).join("/"),
    bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
});

const manifest = {
  product: "MoaWorks Desktop Client",
  version,
  platform: "win32",
  arch: "x64",
  generatedAt: new Date().toISOString(),
  artifacts,
};
const evidencePath = path.join(
  root,
  "build-evidence",
  `MoaWorks-Desktop-${version}-win-x64-installer.manifest.json`,
);
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`INSTALLER_MANIFEST=${path.relative(root, evidencePath)}\n`);
