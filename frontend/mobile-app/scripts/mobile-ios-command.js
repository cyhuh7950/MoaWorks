#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createIosCommand, IosBuildError } = require("./mobile-ios-support");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

try {
  const result = createIosCommand({
    projectRoot,
    packageVersion: packageJson.version,
    platform: process.platform,
    environment: process.env,
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync,
    rmSync: fs.rmSync,
    spawn: spawnSync,
  }).execute(process.argv[2]);
  console.log(
    `STATUS=success\nMODE=${result.mode}\nBUNDLE_ID=${result.bundleIdentifier}` +
      (result.artifact ? `\nARCHIVE=${path.basename(result.artifact)}` : ""),
  );
} catch (error) {
  if (!(error instanceof IosBuildError)) throw error;
  console.error(`STATUS=blocked\nBLOCKER=${error.code}`);
  process.exit(2);
}
