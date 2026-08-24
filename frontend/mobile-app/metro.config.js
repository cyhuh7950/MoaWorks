const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const config = {
  watchFolders: [fs.realpathSync(path.join(__dirname, "node_modules"))],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
