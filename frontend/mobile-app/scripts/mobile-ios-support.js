const path = require("node:path");

class IosBuildError extends Error {
  constructor(code) {
    super(code);
    this.name = "IosBuildError";
    this.code = code;
  }
}

function createIosCommand(dependencies) {
  const {
    projectRoot,
    packageVersion,
    platform,
    environment,
    existsSync,
    mkdirSync,
    rmSync,
    spawn,
  } = dependencies;
  const iosRoot = path.join(projectRoot, "ios");
  const project = path.join(iosRoot, "MoaWorksMobile.xcodeproj", "project.pbxproj");
  const workspace = path.join(iosRoot, "MoaWorksMobile.xcworkspace");
  const evidenceRoot = path.join(projectRoot, "build-evidence");
  const bundleIdentifier = "com.moaworks.mobile";
  const fail = (code) => {
    throw new IosBuildError(code);
  };
  const executableExists = (name) => spawn("/usr/bin/env", ["which", name], { encoding: "utf8" }).status === 0;
  const run = (command, args, code) => {
    const result = spawn(command, args, {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
    });
    if ((result.status ?? 1) !== 0) fail(code);
  };

  function execute(mode) {
    if (!new Set(["build", "archive"]).has(mode)) fail("IOS_COMMAND_INVALID");
    if (platform !== "darwin") fail("IOS_BUILD_HOST_REQUIRED");
    if (!existsSync(project)) fail("IOS_PROJECT_NOT_FOUND");
    if (!existsSync(path.join(projectRoot, "node_modules", "react-native"))) fail("NODE_MODULES_NOT_INSTALLED");
    if (!executableExists("xcodebuild")) fail("XCODEBUILD_NOT_FOUND");
    if (!executableExists("bundle")) fail("BUNDLER_NOT_FOUND");
    if (!executableExists("pod")) fail("COCOAPODS_NOT_FOUND");

    const developmentTeam = environment.MOAWORKS_IOS_DEVELOPMENT_TEAM?.trim();
    if (!developmentTeam) fail("APPLE_TEAM_NOT_CONFIGURED");
    if (!/^[A-Z0-9]{10}$/.test(developmentTeam)) fail("APPLE_TEAM_INVALID");

    run("bundle", ["check"], "BUNDLER_DEPENDENCIES_MISSING");
    run("bundle", ["exec", "pod", "install", "--project-directory=ios"], "POD_INSTALL_FAILED");
    if (!existsSync(workspace)) fail("IOS_WORKSPACE_NOT_FOUND");

    const xcodeArgs = [
      "-workspace",
      workspace,
      "-scheme",
      "MoaWorksMobile",
      "-configuration",
      "Release",
      "-sdk",
      "iphoneos",
      "-destination",
      "generic/platform=iOS",
      `DEVELOPMENT_TEAM=${developmentTeam}`,
      `PRODUCT_BUNDLE_IDENTIFIER=${bundleIdentifier}`,
      "CODE_SIGN_STYLE=Automatic",
      "-allowProvisioningUpdates",
    ];

    let artifact;
    if (mode === "archive") {
      mkdirSync(evidenceRoot, { recursive: true });
      artifact = path.join(evidenceRoot, `MoaWorks-Mobile-${packageVersion}-ios-release.xcarchive`);
      rmSync(artifact, { recursive: true, force: true });
      xcodeArgs.push("-archivePath", artifact, "archive");
    } else {
      xcodeArgs.push("build");
    }

    run("xcodebuild", xcodeArgs, mode === "archive" ? "IOS_ARCHIVE_FAILED" : "IOS_BUILD_FAILED");
    return { mode, bundleIdentifier, artifact };
  }

  return { execute };
}

module.exports = { createIosCommand, IosBuildError };
