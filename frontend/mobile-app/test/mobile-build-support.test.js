const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("support module resolves Windows commands and environment paths without usernames", () => {
  const support = require("../scripts/mobile-build-support.js");
  const exists = (candidate) => candidate === "C:\\Java\\bin\\java.exe" || candidate === "C:\\Android\\platform-tools\\adb.exe";
  assert.equal(support.npxCommand("win32"), "npx.cmd");
  assert.equal(support.npxCommand("linux"), "npx");
  assert.equal(support.findJavaHome({ JAVA_HOME: "C:\\Java" }, "win32", exists), "C:\\Java");
  assert.equal(support.findAndroidSdk({ ANDROID_SDK_ROOT: "C:\\Android" }, "win32", exists), "C:\\Android");
});

test("device parser returns only online Android device identifiers", () => {
  const { parseConnectedDevices } = require("../scripts/mobile-build-support.js");
  const output = "List of devices attached\nemulator-5554\tdevice\noffline-one\toffline\nunauthorized-one\tunauthorized\n";
  assert.deepEqual(parseConnectedDevices(output), ["emulator-5554"]);
  assert.deepEqual(parseConnectedDevices(""), []);
});

test("support module falls back to conventional Windows and Linux locations", () => {
  const support = require("../scripts/mobile-build-support.js");
  const windowsExists = (candidate) => candidate.endsWith("Android\\Android Studio\\jbr\\bin\\java.exe")
    || candidate.endsWith("Android\\Sdk\\platform-tools\\adb.exe");
  assert.match(support.findJavaHome({ ProgramFiles: "C:\\Program Files" }, "win32", windowsExists), /Android Studio/);
  assert.match(support.findAndroidSdk({ LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" }, "win32", windowsExists), /Android\\Sdk$/);

  const linuxExists = (candidate) => candidate.replaceAll("\\", "/") === "/usr/lib/jvm/default-java/bin/java"
    || candidate.replaceAll("\\", "/") === "/usr/lib/android-sdk/platform-tools/adb";
  assert.equal(support.findJavaHome({}, "linux", linuxExists), "/usr/lib/jvm/default-java");
  assert.equal(support.findAndroidSdk({}, "linux", linuxExists), "/usr/lib/android-sdk");
});

test("WSL SDK discovery handles mounted profiles, missing roots and read errors", () => {
  const { mountedWindowsSdkCandidates, findAndroidSdk } = require("../scripts/mobile-build-support.js");
  assert.deepEqual(mountedWindowsSdkCandidates(() => false, () => []), []);
  assert.deepEqual(mountedWindowsSdkCandidates(() => true, () => { throw new Error("denied"); }), []);
  const candidates = mountedWindowsSdkCandidates(() => true, () => ["Alpha", "Beta"]);
  assert.equal(candidates.length, 2);
  const mountedExists = (candidate) => candidate.replaceAll("\\", "/").endsWith("/Beta/AppData/Local/Android/Sdk/platform-tools/adb.exe")
    || candidate.replaceAll("\\", "/") === "/mnt/c/Users";
  assert.match(findAndroidSdk({}, "linux", mountedExists, () => ["Alpha", "Beta"]), /Beta/);
});

test("SHA-256 helper hashes artifact bytes", () => {
  const { sha256File } = require("../scripts/mobile-build-support.js");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moaworks-mobile-test-"));
  const artifact = path.join(tempDir, "artifact.bin");
  try {
    fs.writeFileSync(artifact, "abc", "utf8");
    assert.equal(sha256File(artifact), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
