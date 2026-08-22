const { version } = require("./package.json");
const fs = require("node:fs");
const path = require("node:path");

module.exports = {
  packagerConfig: {
    asar: true,
    ignore: [
      /^\/(?:build-evidence|\.build-home|\.installer-build|\.npm-cache|out|scripts|test)(?:\/|$)/,
      /^\/forge\.config\.js$/,
      /^\/package-lock\.json$/,
    ],
  },
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      const preparedAsar = path.join(__dirname, ".installer-build", "app.asar");
      for (const outputPath of packageResult.outputPaths) {
        const packagedAsar = path.join(outputPath, "resources", "app.asar");
        fs.copyFileSync(preparedAsar, packagedAsar);
        fs.rmSync(`${packagedAsar}.unpacked`, { recursive: true, force: true });
      }
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "MoaWorksDesktop",
        authors: "MoaWorks",
        description: "MoaWorks secure desktop mail and groupware client",
        setupExe: `MoaWorks-Desktop-${version}-Setup.exe`,
        noMsi: true,
      },
    },
  ],
};
