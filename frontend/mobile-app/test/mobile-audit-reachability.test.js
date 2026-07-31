const test = require("node:test");
const assert = require("node:assert/strict");

test("audit classifier separates build-only advisories from runtime advisories", () => {
  const { classifyAudit, summarizeAudit } = require("../scripts/mobile-audit-reachability.js");
  const audit = {
    vulnerabilities: {
      glob: { severity: "high", isDirect: false, via: [{ source: 1, title: "glob issue" }], effects: ["react-native"] },
      "runtime-package": { severity: "high", isDirect: true, via: [{ source: 2, title: "runtime issue" }], effects: [] },
      "react-native": { severity: "high", isDirect: true, via: ["glob"], effects: [] },
    },
  };
  const classified = classifyAudit(audit, { runtimePackages: ["runtime-package", "react-native"], buildOnlyPackages: ["glob"] });
  assert.equal(classified.find((item) => item.package === "glob").reachability, "build-only");
  assert.equal(classified.find((item) => item.package === "runtime-package").reachability, "runtime");
  assert.equal(classified.find((item) => item.package === "react-native").reachability, "build-only-carrier");
  assert.deepEqual(summarizeAudit(classified), { runtime: 1, buildOnly: 2, unclassified: 0, total: 3 });
});

test("unknown and direct advisories are never silently classified build-only", () => {
  const { classifyAudit } = require("../scripts/mobile-audit-reachability.js");
  const audit = { vulnerabilities: {
    unknown: { severity: "moderate", isDirect: false, via: [], effects: [] },
    direct: { severity: "high", isDirect: true, via: [{ source: 7, title: "direct advisory" }], effects: [] },
  } };
  const classified = classifyAudit(audit, { runtimePackages: ["direct"], buildOnlyPackages: [] });
  assert.equal(classified.find((item) => item.package === "unknown").reachability, "unclassified");
  assert.equal(classified.find((item) => item.package === "direct").reachability, "runtime");
});
