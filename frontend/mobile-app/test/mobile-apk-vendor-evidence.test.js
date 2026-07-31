const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyVendorDevServerEvidence } = require("../scripts/mobile-apk-vendor-evidence");

const safeEvidence = {
  apkConstants: ["10.0.2.2"],
  bundleConstants: [],
  appSourceConstants: [],
  releaseAarDisassembly: "getTypedExportedConstants reactNativeVersion uiMode",
  mappingText: "com.facebook.react.modules.systeminfo.AndroidInfoHelpers -> o1.a:",
};

test("allows only the approved dormant React Native emulator constant", () => {
  assert.deepEqual(classifyVendorDevServerEvidence(safeEvidence), {
    status: "approved-vendor-dormant",
    approvedConstants: ["10.0.2.2"],
    reason: "RN_RELEASE_AAR_DEV_BRANCH_ABSENT",
  });
});

test("reports a clean result when no development constants exist", () => {
  assert.deepEqual(classifyVendorDevServerEvidence({}), {
    status: "clean",
    approvedConstants: [],
  });
});

test("blocks any development address in the production bundle or app source", () => {
  assert.equal(
    classifyVendorDevServerEvidence({ ...safeEvidence, bundleConstants: ["10.0.2.2"] }).status,
    "blocked",
  );
  assert.equal(
    classifyVendorDevServerEvidence({ ...safeEvidence, appSourceConstants: ["10.0.2.2"] }).status,
    "blocked",
  );
});

test("blocks localhost port constants and unapproved APK constants", () => {
  assert.equal(
    classifyVendorDevServerEvidence({ ...safeEvidence, apkConstants: ["localhost:8081"] }).status,
    "blocked",
  );
  assert.equal(
    classifyVendorDevServerEvidence({ ...safeEvidence, apkConstants: ["127.0.0.1"] }).status,
    "blocked",
  );
});

test("blocks when release AAR still exposes the development server branch", () => {
  assert.equal(
    classifyVendorDevServerEvidence({
      ...safeEvidence,
      releaseAarDisassembly: "ServerHost AndroidInfoHelpers.getServerHost",
    }).status,
    "blocked",
  );
});

test("blocks when the full bridge development manager remains in release mapping", () => {
  assert.equal(
    classifyVendorDevServerEvidence({
      ...safeEvidence,
      mappingText: "com.facebook.react.devsupport.BridgeDevSupportManager -> a.b:",
    }).status,
    "blocked",
  );
});
