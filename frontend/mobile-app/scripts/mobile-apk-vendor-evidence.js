const APPROVED_DORMANT_VENDOR_CONSTANTS = ["10.0.2.2"];

function classifyVendorDevServerEvidence(evidence) {
  const apkConstants = [...new Set(evidence.apkConstants || [])];
  const applicationConstants = [
    ...(evidence.bundleConstants || []),
    ...(evidence.appSourceConstants || []),
  ];
  if (applicationConstants.length > 0) {
    return { status: "blocked", code: "APPLICATION_DEV_SERVER_CONSTANTS_PRESENT", constants: applicationConstants };
  }
  if (apkConstants.some((value) => !APPROVED_DORMANT_VENDOR_CONSTANTS.includes(value))) {
    return { status: "blocked", code: "APK_DEV_SERVER_CONSTANTS_PRESENT", constants: apkConstants };
  }
  if (/ServerHost|AndroidInfoHelpers\.getServerHost/.test(evidence.releaseAarDisassembly || "")) {
    return { status: "blocked", code: "RN_RELEASE_AAR_DEV_BRANCH_PRESENT", constants: apkConstants };
  }
  if (/^com\.facebook\.react\.devsupport\.BridgeDevSupportManager ->/m.test(evidence.mappingText || "")) {
    return { status: "blocked", code: "RN_BRIDGE_DEV_SUPPORT_PRESENT", constants: apkConstants };
  }
  if (apkConstants.length === 0) {
    return { status: "clean", approvedConstants: [] };
  }
  return {
    status: "approved-vendor-dormant",
    approvedConstants: apkConstants,
    reason: "RN_RELEASE_AAR_DEV_BRANCH_ABSENT",
  };
}

module.exports = { APPROVED_DORMANT_VENDOR_CONSTANTS, classifyVendorDevServerEvidence };
