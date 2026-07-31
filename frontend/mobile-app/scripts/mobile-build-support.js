const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function npxCommand(platform = process.platform) {
  return platform === "win32" ? "npx.cmd" : "npx";
}

function firstValidHome(candidates, executableParts, exists) {
  return candidates.find((candidate) => candidate && exists(path.join(candidate, ...executableParts))) || "";
}

function findJavaHome(env = process.env, platform = process.platform, exists = fs.existsSync) {
  const candidates = [env.JAVA_HOME];
  if (platform === "win32") {
    candidates.push(
      env.ProgramFiles && path.join(env.ProgramFiles, "Android", "Android Studio", "jbr"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Android", "Android Studio", "jbr"),
    );
    return firstValidHome(candidates, ["bin", "java.exe"], exists);
  }
  candidates.push("/usr/lib/jvm/default-java", "/mnt/c/Program Files/Android/Android Studio/jbr");
  return firstValidHome(candidates, ["bin", platform === "linux" ? "java" : "java"], exists)
    || firstValidHome(candidates, ["bin", "java.exe"], exists);
}

function mountedWindowsSdkCandidates(exists = fs.existsSync, readDir = fs.readdirSync) {
  const usersRoot = "/mnt/c/Users";
  if (!exists(usersRoot)) return [];
  try {
    return readDir(usersRoot).map((name) => path.join(usersRoot, name, "AppData", "Local", "Android", "Sdk"));
  } catch {
    return [];
  }
}

function findAndroidSdk(env = process.env, platform = process.platform, exists = fs.existsSync, readDir = fs.readdirSync) {
  const candidates = [env.ANDROID_SDK_ROOT, env.ANDROID_HOME];
  if (platform === "win32") {
    candidates.push(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Android", "Sdk"));
    return firstValidHome(candidates, ["platform-tools", "adb.exe"], exists);
  }
  candidates.push("/usr/lib/android-sdk", ...mountedWindowsSdkCandidates(exists, readDir));
  return firstValidHome(candidates, ["platform-tools", "adb"], exists)
    || firstValidHome(candidates, ["platform-tools", "adb.exe"], exists);
}

function parseConnectedDevices(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^([^\s]+)\s+device$/)?.[1])
    .filter(Boolean);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

module.exports = {
  findAndroidSdk,
  findJavaHome,
  mountedWindowsSdkCandidates,
  npxCommand,
  parseConnectedDevices,
  sha256File,
};
