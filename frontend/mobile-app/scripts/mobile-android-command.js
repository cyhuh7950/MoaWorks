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

function fail(code, detail) {
  console.error(`STATUS=blocked\nBLOCKER=${code}\nDETAIL=${detail}`);
  process.exit(2);
}

if (!fs.existsSync(gradlePath)) fail("GRADLE_WRAPPER_MISSING", "Android Gradle wrapper is missing");
const javaHome = findJavaHome();
if (!javaHome) fail("JAVA_RUNTIME_MISSING", "JDK was not found in JAVA_HOME or conventional locations");
const androidSdk = findAndroidSdk();
if (!androidSdk) fail("ANDROID_SDK_MISSING", "Android SDK was not found in ANDROID_HOME, ANDROID_SDK_ROOT or conventional locations");

const commandEnv = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
  PATH: [
    path.join(javaHome, "bin"),
    path.join(androidSdk, "platform-tools"),
    process.env.PATH,
  ].filter(Boolean).join(path.delimiter),
};
const publicReleaseMode = mode === "public";
const releaseMode = mode === "release" || mode === "run";
const gradleTasks = publicReleaseMode
  ? ["assemblePublicRelease", "bundlePublicRelease"]
  : [releaseMode ? "assembleRelease" : "assembleDebug"];
const build = spawnSync(process.platform === "win32" ? gradleName : `./${gradleName}`, gradleTasks, {
  cwd: androidDir,
  env: commandEnv,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1);
if (mode !== "run") process.exit(0);

const adbPath = path.join(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const devicesResult = spawnSync(adbPath, ["devices"], { env: commandEnv, encoding: "utf8" });
const devices = devicesResult.status === 0 ? parseConnectedDevices(devicesResult.stdout) : [];
if (devices.length === 0) fail("NO_CONNECTED_ANDROID_DEVICE", "No online Android device or emulator is connected");
const apkPath = releaseMode
  ? path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk")
  : path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const install = spawnSync(adbPath, ["install", "-r", apkPath], { env: commandEnv, stdio: "inherit" });
if ((install.status ?? 1) !== 0) process.exit(install.status ?? 1);
const launch = spawnSync(adbPath, ["shell", "am", "start", "-n", "com.moaworks.mobile/.MainActivity"], { env: commandEnv, stdio: "inherit" });
process.exit(launch.status ?? 1);
