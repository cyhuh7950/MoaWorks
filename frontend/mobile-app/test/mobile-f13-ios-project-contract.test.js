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
const infoPlist = read("ios/MoaWorksMobile/Info.plist");
const appDelegate = read("ios/MoaWorksMobile/AppDelegate.mm");
const iosCommand = read("scripts/mobile-ios-command.js");

test("React Native 0.75.4 iOS native project is present and targets MoaWorks", () => {
  assert.match(project, /PBXProject/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.moaworks\.mobile/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 13\.4/);
  assert.match(podfile, /target 'MoaWorksMobile'/);
  assert.match(podfile, /use_react_native!/);
  assert.match(appDelegate, /moduleName:@"MoaWorksMobile"/);
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
