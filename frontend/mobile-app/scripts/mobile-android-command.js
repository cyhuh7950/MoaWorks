#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { findAndroidSdk, findJavaHome, parseConnectedDevices } = require("./mobile-build-support");

const mode = process.argv[2] || "release";
const projectRoot = path.resolve(__dirname, "..");
const androidDir = path.join(projectRoot, "android");
const gradleName = process.platform === "win32" ? "gradlew.bat" : "gradlew";
const gradlePath = path.join(androidDir, gradleName);

function fail(code, message) {
  console.error("STATUS=blocked");
  console.error(`BLOCKER=${code}`);
  console.error(`DETAIL=${message}`);
  process.exit(2);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
}

if (!["release", "public", "run"].includes(mode)) {
  fail("ANDROID_COMMAND_INVALID", "Supported modes are release, public, and run");
}
if (!fs.existsSync(androidDir)) fail("ANDROID_PROJECT_MISSING", "frontend/mobile-app/android is missing");
if (!fs.existsSync(gradlePath)) fail("GRADLE_WRAPPER_MISSING", `${path.relative(projectRoot, gradlePath)} is missing`);

const javaHome = findJavaHome();
if (!javaHome) fail("JAVA_RUNTIME_MISSING", "JDK was not found in JAVA_HOME or conventional locations");
const androidSdk = findAndroidSdk();
if (!androidSdk) fail("ANDROID_SDK_MISSING", "Android SDK was not found in ANDROID_HOME, ANDROID_SDK_ROOT or conventional locations");

const commandEnv = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
  PATH: [path.join(javaHome, "bin"), path.join(androidSdk, "platform-tools"), process.env.PATH].filter(Boolean).join(path.delimiter),
};
const gradleTasks = mode === "public"
  ? ["assemblePublicRelease", "bundlePublicRelease"]
  : [mode === "release" ? "assembleRelease" : "assembleDebug"];
const build = run(process.platform === "win32" ? gradleName : `./${gradleName}`, gradleTasks, {
  cwd: androidDir,
  env: commandEnv,
  shell: process.platform === "win32",
});
if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1);
if (mode !== "run") process.exit(0);

const adbPath = path.join(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
if (!fs.existsSync(adbPath)) fail("ADB_MISSING", "adb is not available in the detected Android SDK");
const devices = spawnSync(adbPath, ["devices"], { encoding: "utf8", env: commandEnv });
if ((devices.status ?? 1) !== 0 || parseConnectedDevices(devices.stdout).length === 0) {
  fail("ANDROID_DEVICE_MISSING", "Connect an authorized Android device or emulator before running the app");
}
const apkPath = path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
if (!fs.existsSync(apkPath)) fail("APK_MISSING", "Debug APK is missing after assembleDebug");
const install = run(adbPath, ["install", "-r", apkPath], { env: commandEnv });
if ((install.status ?? 1) !== 0) process.exit(install.status ?? 1);
const launch = run(adbPath, ["shell", "am", "start", "-n", "com.moaworks.mobile/.MainActivity"], { env: commandEnv });
process.exit(launch.status ?? 1);
