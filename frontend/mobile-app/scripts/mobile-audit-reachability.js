#!/usr/bin/env node
const fs = require("node:fs");

const BUILD_ONLY_PACKAGES = new Set([
  "@react-native/babel-plugin-codegen",
  "@react-native/babel-preset",
  "@react-native/codegen",
  "@react-native/community-cli-plugin",
  "@react-native/dev-middleware",
  "@react-native/metro-babel-transformer",
  "@react-native-community/cli",
  "@react-native-community/cli-doctor",
  "@react-native-community/cli-platform-android",
  "@react-native-community/cli-platform-apple",
  "@react-native-community/cli-platform-ios",
  "brace-expansion",
  "chromium-edge-launcher",
  "fast-xml-parser",
  "glob",
  "jscodeshift",
  "minimatch",
  "node-dir",
  "rimraf",
  "temp",
]);
const RUNTIME_PACKAGES = new Set(["react", "react-native"]);

function classifyAudit(audit, policy = {}) {
  const buildOnly = new Set(policy.buildOnlyPackages || BUILD_ONLY_PACKAGES);
  const runtime = new Set(policy.runtimePackages || RUNTIME_PACKAGES);
  return Object.entries(audit.vulnerabilities || {}).map(([packageName, item]) => {
    const directAdvisories = (item.via || []).filter((via) => via && typeof via === "object");
    const viaPackages = (item.via || []).filter((via) => typeof via === "string");
    let reachability = "unclassified";
    let rationale = "Package is not covered by the conservative reachability policy";

    if (buildOnly.has(packageName)) {
      reachability = "build-only";
      rationale = "Package is used by the React Native build, codegen, CLI, or file-processing toolchain";
    } else if (runtime.has(packageName) && directAdvisories.length > 0) {
      reachability = "runtime";
      rationale = "Runtime package has a direct advisory";
    } else if (
      runtime.has(packageName)
      && viaPackages.length > 0
      && directAdvisories.length === 0
      && viaPackages.every((name) => buildOnly.has(name))
    ) {
      reachability = "build-only-carrier";
      rationale = "Runtime package is listed only as a carrier for explicitly classified build-only packages";
    }

    return {
      package: packageName,
      severity: item.severity,
      isDirect: Boolean(item.isDirect),
      reachability,
      viaPackages,
      directAdvisories: directAdvisories.map(({ source, name, title, url, severity }) => ({
        source,
        name,
        title,
        url,
        severity,
      })),
      effects: item.effects || [],
      range: item.range,
      nodes: item.nodes || [],
      fixAvailable: item.fixAvailable ?? null,
      rationale,
    };
  }).sort((left, right) => left.package.localeCompare(right.package));
}

function summarizeAudit(classifications) {
  const summary = { runtime: 0, buildOnly: 0, unclassified: 0, total: classifications.length };
  for (const item of classifications) {
    if (item.reachability === "runtime") summary.runtime += 1;
    else if (item.reachability === "build-only" || item.reachability === "build-only-carrier") summary.buildOnly += 1;
    else summary.unclassified += 1;
  }
  return summary;
}

function writeReachabilityReport(filePath, audit, options = {}) {
  const classifications = classifyAudit(audit, options);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "npm-audit-omit-dev",
    policy: {
      approach: "conservative-explicit-allowlist",
      runtimePackages: [...(options.runtimePackages || RUNTIME_PACKAGES)].sort(),
      buildOnlyPackages: [...(options.buildOnlyPackages || BUILD_ONLY_PACKAGES)].sort(),
      unknownDefaultsTo: "unclassified",
    },
    npmAuditMetadata: audit.metadata || {},
    summary: summarizeAudit(classifications),
    packages: classifications,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

module.exports = {
  BUILD_ONLY_PACKAGES,
  RUNTIME_PACKAGES,
  classifyAudit,
  summarizeAudit,
  writeReachabilityReport,
};

if (require.main === module) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error("Usage: mobile-audit-reachability.js <npm-audit.json> <report.json>");
    process.exit(2);
  }
  const audit = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const report = writeReachabilityReport(outputPath, audit);
  console.log(JSON.stringify(report.summary));
  process.exit(report.summary.runtime === 0 && report.summary.unclassified === 0 ? 0 : 2);
}
