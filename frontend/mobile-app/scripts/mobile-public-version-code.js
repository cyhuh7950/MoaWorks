function parseVersionCode(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolvePublicVersionCode(gradleSource, apkBadging) {
  const defaultConfig = gradleSource.match(/\bdefaultConfig\s*\{([\s\S]*?)^\s*\}/m)?.[1];
  const gradleMatches = [...(defaultConfig || "").matchAll(/^\s*versionCode\s+(\d+)\s*$/gm)];
  const apkMatches = [...apkBadging.matchAll(/^package: name='com\.moaworks\.mobile' versionCode='(\d+)'(?:\s|$)/gm)];
  if (gradleMatches.length !== 1 || apkMatches.length !== 1) throw new Error("VERSION_CODE_UNREADABLE");
  const gradleCode = parseVersionCode(gradleMatches[0][1]);
  const apkCode = parseVersionCode(apkMatches[0][1]);
  if (!gradleCode || !apkCode) throw new Error("VERSION_CODE_UNREADABLE");
  if (gradleCode !== apkCode) throw new Error("VERSION_CODE_MISMATCH");
  return gradleCode;
}

module.exports = { resolvePublicVersionCode };
