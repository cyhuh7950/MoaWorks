const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
};

const packageJson = JSON.parse(read("package.json"));
const project = read("ios/MoaWorksMobile.xcodeproj/project.pbxproj");
const podfile = read("ios/Podfile");
const gemfile = read("Gemfile");
const infoPlist = read("ios/MoaWorksMobile/Info.plist");
const appDelegate = read("ios/MoaWorksMobile/AppDelegate.mm");
const iosCommand = `${read("scripts/mobile-ios-command.js")}\n${read("scripts/mobile-ios-support.js")}`;

test("React Native 0.75.4 iOS native project is present and targets MoaWorks", () => {
  assert.match(project, /PBXProject/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.moaworks\.mobile/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 13\.4/);
  assert.match(podfile, /target 'MoaWorksMobile'/);
  assert.match(podfile, /use_react_native!/);
  assert.match(gemfile, /gem 'cocoapods', '>= 1\.13', '!= 1\.15\.0', '!= 1\.15\.1'/);
  assert.match(appDelegate, /moduleName\s*=\s*@"MoaWorksMobile"/);
});

test("iOS application transport security does not permit arbitrary or local HTTP", () => {
  assert.match(infoPlist, /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/);
  assert.doesNotMatch(infoPlist, /<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
  assert.match(infoPlist, /<string>MoaWorks Mobile<\/string>/);
});

test("package scripts expose iOS device run and release archive commands", () => {
  assert.equal(packageJson.scripts.ios, "react-native run-ios");
  assert.equal(packageJson.scripts["build:ios"], "node ./scripts/mobile-ios-command.js build");
  assert.equal(packageJson.scripts["package:ios"], "node ./scripts/mobile-ios-command.js archive");
});

test("iOS build wrapper fails closed outside macOS and requires signing prerequisites", () => {
  assert.match(iosCommand, /IOS_BUILD_HOST_REQUIRED/);
  assert.match(iosCommand, /XCODEBUILD_NOT_FOUND/);
  assert.match(iosCommand, /COCOAPODS_NOT_FOUND/);
  assert.match(iosCommand, /BUNDLER_NOT_FOUND/);
  assert.match(iosCommand, /BUNDLER_DEPENDENCIES_MISSING/);
  assert.match(iosCommand, /APPLE_TEAM_NOT_CONFIGURED/);
  assert.match(iosCommand, /MOAWORKS_IOS_DEVELOPMENT_TEAM/);
  assert.match(iosCommand, /com\.moaworks\.mobile/);

  const result = spawnSync(process.execPath, [path.join(root, "scripts", "mobile-ios-command.js"), "build"], {
    cwd: root,
    encoding: "utf8",
  });
  if (process.platform !== "darwin") {
    assert.equal(result.status, 2);
    assert.match(`${result.stdout}\n${result.stderr}`, /STATUS=blocked[\s\S]*BLOCKER=IOS_BUILD_HOST_REQUIRED/);
  }
});

test("iOS support validates macOS tools and signing inputs without invoking a build", () => {
  const supportPath = path.join(root, "scripts", "mobile-ios-support.js");
  assert.equal(fs.existsSync(supportPath), true);
  const { createIosCommand, IosBuildError } = require(supportPath);

  const base = {
    projectRoot: root,
    packageVersion: packageJson.version,
    platform: "darwin",
    environment: { MOAWORKS_IOS_DEVELOPMENT_TEAM: "ABCDE12345" },
    existsSync: () => true,
    mkdirSync: () => {},
    rmSync: () => {},
    spawn: () => ({ status: 0 }),
  };

  assert.throws(() => createIosCommand({ ...base, platform: "win32" }).execute("build"), (error) => {
    assert.equal(error instanceof IosBuildError, true);
    assert.equal(error.code, "IOS_BUILD_HOST_REQUIRED");
    return true;
  });
  assert.throws(() => createIosCommand(base).execute("invalid"), /IOS_COMMAND_INVALID/);
  assert.throws(
    () => createIosCommand({ ...base, environment: {} }).execute("build"),
    /APPLE_TEAM_NOT_CONFIGURED/,
  );
  assert.throws(
    () => createIosCommand({ ...base, environment: { MOAWORKS_IOS_DEVELOPMENT_TEAM: "bad" } }).execute("build"),
    /APPLE_TEAM_INVALID/,
  );
});

test("iOS support runs CocoaPods then signed build and archive with fixed bundle id", () => {
  const { createIosCommand } = require(path.join(root, "scripts", "mobile-ios-support.js"));
  const calls = [];
  const removed = [];
  const command = createIosCommand({
    projectRoot: root,
    packageVersion: packageJson.version,
    platform: "darwin",
    environment: { MOAWORKS_IOS_DEVELOPMENT_TEAM: "ABCDE12345" },
    existsSync: () => true,
    mkdirSync: () => {},
    rmSync: (target) => removed.push(target),
    spawn: (executable, args) => {
      calls.push([executable, ...args]);
      return { status: 0 };
    },
  });

  const build = command.execute("build");
  const archive = command.execute("archive");

  assert.equal(build.mode, "build");
  assert.equal(archive.mode, "archive");
  assert.match(archive.artifact, /MoaWorks-Mobile-0\.1\.0-ios-release\.xcarchive$/);
  assert.equal(removed.includes(archive.artifact), true);
  assert.equal(
    calls.some(
      (call) =>
        call[0] === "bundle" && call[1] === "exec" && call[2] === "pod" && call.includes("--project-directory=ios"),
    ),
    true,
  );
  assert.equal(
    calls.some(
      (call) =>
        call[0] === "xcodebuild" &&
        call.includes("PRODUCT_BUNDLE_IDENTIFIER=com.moaworks.mobile") &&
        call.includes("DEVELOPMENT_TEAM=ABCDE12345") &&
        call.includes("archive"),
    ),
    true,
  );
});

test("iOS support reports missing tools and subprocess failures with stable blocker codes", () => {
  const { createIosCommand } = require(path.join(root, "scripts", "mobile-ios-support.js"));
  const base = {
    projectRoot: root,
    packageVersion: packageJson.version,
    platform: "darwin",
    environment: { MOAWORKS_IOS_DEVELOPMENT_TEAM: "ABCDE12345" },
    existsSync: () => true,
    mkdirSync: () => {},
    rmSync: () => {},
  };

  assert.throws(
    () => createIosCommand({ ...base, spawn: () => ({ status: 1 }) }).execute("build"),
    /XCODEBUILD_NOT_FOUND/,
  );

  let whichCount = 0;
  assert.throws(
    () =>
      createIosCommand({
        ...base,
        spawn: () => ({ status: ++whichCount < 3 ? 0 : 1 }),
      }).execute("build"),
    /COCOAPODS_NOT_FOUND/,
  );

  assert.throws(
    () =>
      createIosCommand({
        ...base,
        spawn: (executable, args) => ({ status: executable === "bundle" && args[0] === "exec" ? 1 : 0 }),
      }).execute("build"),
    /POD_INSTALL_FAILED/,
  );
});
