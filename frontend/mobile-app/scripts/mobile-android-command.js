#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const mode = process.argv[2] || "build";
const projectRoot = path.resolve(__dirname, "..");
const androidDir = path.join(projectRoot, "android");
const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const gradlePath = path.join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");

function findExecutable(command) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.split(/\r?\n/)[0].trim();
  }
  return "";
}

function fail(code, message) {
  console.error(`STATUS=blocked`);
  console.error(`BLOCKER=${code}`);
  console.error(`DETAIL=${message}`);
  process.exit(2);
}

if (!fs.existsSync(androidDir)) {
  fail("ANDROID_PROJECT_MISSING", "frontend/mobile-app/android is missing");
}

if (!fs.existsSync(gradlePath)) {
  fail("GRADLE_WRAPPER_MISSING", `${path.relative(projectRoot, gradlePath)} is missing`);
}

const javaPath = findExecutable("java");
if (!javaPath && !process.env.JAVA_HOME) {
  fail("JAVA_RUNTIME_MISSING", "JAVA_HOME is not set and java is not available in PATH");
}

if (mode === "run") {
  const adbPath = findExecutable("adb");
  if (!adbPath) {
    fail("ADB_MISSING", "adb is not available in PATH");
  }
  const reactNativePath = findExecutable("react-native") || path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "react-native.cmd" : "react-native");
  const result = spawnSync(reactNativePath, ["run-android"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exit(result.status ?? 1);
}

const result = spawnSync(gradleCommand, ["assembleDebug"], {
  cwd: androidDir,
  encoding: "utf8",
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
