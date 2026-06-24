#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const mode = process.argv[2] || "build";
const projectRoot = path.resolve(__dirname, "..");
const androidDir = path.join(projectRoot, "android");
const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const gradlePath = path.join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const runtimeDir = path.join(projectRoot, ".runtime", "android-tools");
const wrapperJdkDir = path.join(runtimeDir, "jdk");
let shouldUseWrapperJava = false;

function isExecutable(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function findExecutable(command) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.split(/\r?\n/)[0].trim();
  }
  return "";
}

function writeUnixWrapper(filePath, targetPath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `#!/usr/bin/env bash\nexec "${targetPath}" "$@"\n`, "utf8");
  fs.chmodSync(filePath, 0o755);
}

function prepareWslAndroidTools() {
  if (process.platform !== "linux") {
    return {};
  }

  const linuxAndroidHome = "/usr/lib/android-sdk";
  const mountedJavaHome = "/mnt/c/Program Files/Android/Android Studio/jbr";
  const mountedAndroidHome = "/mnt/c/Users/cyhuh/AppData/Local/Android/Sdk";
  const javaExe = path.join(mountedJavaHome, "bin", "java.exe");
  const adbExe = path.join(mountedAndroidHome, "platform-tools", "adb.exe");
  const emulatorExe = path.join(mountedAndroidHome, "emulator", "emulator.exe");
  const envPatch = {};

  if (!findExecutable("java") && isExecutable(javaExe)) {
    writeUnixWrapper(path.join(wrapperJdkDir, "bin", "java"), javaExe);
    envPatch.JAVA_HOME = wrapperJdkDir;
    shouldUseWrapperJava = true;
  }

  if (!process.env.ANDROID_HOME && fs.existsSync(linuxAndroidHome)) {
    envPatch.ANDROID_HOME = linuxAndroidHome;
  } else if (!process.env.ANDROID_HOME && fs.existsSync(mountedAndroidHome)) {
    envPatch.ANDROID_HOME = mountedAndroidHome;
  }
  if (!process.env.ANDROID_SDK_ROOT && fs.existsSync(linuxAndroidHome)) {
    envPatch.ANDROID_SDK_ROOT = linuxAndroidHome;
  } else if (!process.env.ANDROID_SDK_ROOT && fs.existsSync(mountedAndroidHome)) {
    envPatch.ANDROID_SDK_ROOT = mountedAndroidHome;
  }

  if (!findExecutable("adb") && isExecutable(adbExe)) {
    writeUnixWrapper(path.join(runtimeDir, "bin", "adb"), adbExe);
  }
  if (!findExecutable("emulator") && isExecutable(emulatorExe)) {
    writeUnixWrapper(path.join(runtimeDir, "bin", "emulator"), emulatorExe);
  }

  return envPatch;
}

const detectedEnv = prepareWslAndroidTools();
const commandEnv = {
  ...process.env,
  ...detectedEnv,
};
commandEnv.PATH = [
  path.join(runtimeDir, "bin"),
  shouldUseWrapperJava ? path.join(wrapperJdkDir, "bin") : "",
  commandEnv.ANDROID_HOME ? path.join(commandEnv.ANDROID_HOME, "platform-tools") : "",
  commandEnv.ANDROID_HOME ? path.join(commandEnv.ANDROID_HOME, "emulator") : "",
  commandEnv.ANDROID_HOME ? path.join(commandEnv.ANDROID_HOME, "cmdline-tools", "latest", "bin") : "",
  process.env.PATH,
].filter(Boolean).join(path.delimiter);

function fail(code, message) {
  console.error(`STATUS=blocked`);
  console.error(`BLOCKER=${code}`);
  console.error(`DETAIL=${message}`);
  process.exit(2);
}

function hasConnectedDevice(adbCommand) {
  const result = spawnSync(adbCommand, ["devices"], {
    encoding: "utf8",
    env: commandEnv,
  });
  if (result.status !== 0) {
    return false;
  }
  return result.stdout.split(/\r?\n/).some((line) => /\tdevice$/.test(line.trim()));
}

function runGradleAssembleDebug() {
  return spawnSync(gradleCommand, ["assembleDebug"], {
    cwd: androidDir,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
    env: commandEnv,
  });
}

if (!fs.existsSync(androidDir)) {
  fail("ANDROID_PROJECT_MISSING", "frontend/mobile-app/android is missing");
}

if (!fs.existsSync(gradlePath)) {
  fail("GRADLE_WRAPPER_MISSING", `${path.relative(projectRoot, gradlePath)} is missing`);
}

const javaPath = spawnSync(process.platform === "win32" ? "where" : "which", ["java"], { encoding: "utf8", env: commandEnv });
if (javaPath.status !== 0 && !commandEnv.JAVA_HOME) {
  fail("JAVA_RUNTIME_MISSING", "JAVA_HOME is not set and java is not available in PATH");
}

if (mode === "run") {
  const adbPath = spawnSync(process.platform === "win32" ? "where" : "which", ["adb"], { encoding: "utf8", env: commandEnv });
  if (adbPath.status !== 0) {
    fail("ADB_MISSING", "adb is not available in PATH");
  }

  const resolvedAdbPath = adbPath.stdout.split(/\r?\n/)[0].trim();
  const mountedWindowsAdb = "/mnt/c/Users/cyhuh/AppData/Local/Android/Sdk/platform-tools/adb.exe";
  if (!hasConnectedDevice(resolvedAdbPath) && process.platform === "linux" && isExecutable(mountedWindowsAdb) && hasConnectedDevice(mountedWindowsAdb)) {
    console.warn("INFO=using_windows_adb_from_wsl");
    const buildResult = runGradleAssembleDebug();
    if ((buildResult.status ?? 1) !== 0) {
      process.exit(buildResult.status ?? 1);
    }

    const apkPath = path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
    if (!fs.existsSync(apkPath)) {
      fail("APK_MISSING", `${apkPath} is missing after assembleDebug`);
    }

    const installResult = spawnSync(mountedWindowsAdb, ["install", "-r", apkPath], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "inherit",
      env: commandEnv,
    });
    if ((installResult.status ?? 1) !== 0) {
      process.exit(installResult.status ?? 1);
    }

    const launchResult = spawnSync(mountedWindowsAdb, ["shell", "am", "start", "-n", "com.moaworks.mobile/.MainActivity"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "inherit",
      env: commandEnv,
    });
    if ((launchResult.status ?? 1) !== 0) {
      process.exit(launchResult.status ?? 1);
    }
    console.log("STATUS=success");
    console.log("DEVICE_BRIDGE=windows-adb-from-wsl");
    process.exit(0);
  }

  const reactNativePath = findExecutable("react-native") || path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "react-native.cmd" : "react-native");
  const result = spawnSync(reactNativePath, ["run-android"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
    env: commandEnv,
  });
  process.exit(result.status ?? 1);
}

const result = runGradleAssembleDebug();

process.exit(result.status ?? 1);
