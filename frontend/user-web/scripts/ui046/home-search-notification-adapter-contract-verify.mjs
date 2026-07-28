import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runHomeSearchNotification } from "./adapters/home-search-notification.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const userWeb = resolve(here, "../..");
const manifest = JSON.parse(await readFile(resolve(here, "manifest.json"), "utf8"));
const runId = "UI046_20260729T000000_contract";

function ownershipFixture() {
  return {
    runId,
    records: [
      { kind: "notice", id: `${runId}_notice`, ownerRunId: runId },
      { kind: "schedule", id: `${runId}_schedule`, ownerRunId: runId },
      { kind: "notification", id: `${runId}_notification_read`, ownerRunId: runId },
      { kind: "notification", id: `${runId}_notification_archive`, ownerRunId: runId },
      { kind: "notification_state", id: `${runId}_state`, ownerRunId: runId },
    ],
    preferencesBefore: { desktopEnabled: true, categories: { mail: true } },
  };
}

function browserFixture(overrides = {}) {
  return {
    actions: ["home.summary", "search.open", "search.navigate", "notification.read", "notification.read_all", "notification.archive", "notification.preferences.save", "notification.preferences.reread"],
    network: [
      { method: "GET", path: "/api/v1/workspace/notices", status: 200 },
      { method: "GET", path: "/api/v1/workspace/schedules", status: 200 },
      { method: "GET", path: "/api/v1/notifications", status: 200 },
      { method: "PATCH", path: "/api/v1/notifications/read-all", status: 200 },
    ],
    screenshots: ["screenshots/home.png", "screenshots/search.png", "screenshots/notifications.png"],
    rereadConfirmed: true,
    ...overrides,
  };
}

function dbEvidenceFixture(ownership) {
  const byKind = Object.fromEntries(ownership.records.map((record) => [record.kind === "notification" && record.id.endsWith("archive") ? "notification_archive" : record.kind, record.id]));
  return {
    rows: ownership.records.map((record) => ({ id: record.id, kind: record.kind, ownerRunId: runId })),
    preferences: { beforeMatchesSnapshot: true, afterSaved: true, rereadMatchesAfter: true },
    audits: [
      { event: "workspace.notice.read", actorId: "contract-user", targetId: byKind.notice, ownerRunId: runId },
      { event: "notification.read", actorId: "contract-user", targetId: ownership.records.find((record) => record.id.endsWith("notification_read")).id, ownerRunId: runId },
      { event: "notification.archived", actorId: "contract-user", targetId: byKind.notification_archive, ownerRunId: runId },
      { event: "notification.preferences.updated", actorId: "contract-user", targetId: "contract-user", ownerRunId: runId },
    ],
  };
}

function cleanupFixture(overrides = {}) {
  return {
    runId,
    residualOwnedRows: 0,
    residualOwnedAudit: 0,
    residualStorageObjects: 0,
    preferencesRestored: true,
    protectedAccounts: ["admin", "cyhuh", "ysla"].map((loginId) => ({ loginId, unchanged: true })),
    ...overrides,
  };
}

function drivers({ browser = browserFixture(), ownership = ownershipFixture(), dbEvidence, cleanup = cleanupFixture() } = {}) {
  let cleanupCalled = false;
  return {
    browserDriver: {
      async runHomeSearchNotification() { return browser; },
      async close() {},
    },
    dbDriver: {
      async prepareOwnedData() { return ownership; },
      async collectOwnedEvidence() { return dbEvidence ?? dbEvidenceFixture(ownership); },
      async cleanupOwnedData() { cleanupCalled = true; return cleanup; },
    },
    cleanupCalled: () => cleanupCalled,
  };
}

async function expectCode(code, setup) {
  await assert.rejects(
    runHomeSearchNotification({ manifest, runId, evidenceDir: "contract-evidence", ...setup }),
    (error) => String(error?.code ?? "").split(":", 1)[0] === code,
  );
}

const checks = [];

await expectCode("LIVE_INPUT_REQUIRED", {});
checks.push("missing drivers fail closed");

const valid = drivers();
const passed = await runHomeSearchNotification({ manifest, runId, evidenceDir: "contract-evidence", browserDriver: valid.browserDriver, dbDriver: valid.dbDriver });
assert.equal(passed.status, "PASS");
assert.equal(valid.cleanupCalled(), true);
checks.push("valid complete contract");

const absoluteNetwork = drivers({ browser: browserFixture({ network: [{ method: "GET", path: "https://api.internal/api/v1/notifications", status: 200 }] }) });
await expectCode("NETWORK_NOT_SAME_ORIGIN_RELATIVE", absoluteNetwork);
assert.equal(absoluteNetwork.cleanupCalled(), true);
const failedNetwork = drivers({ browser: browserFixture({ network: [{ method: "GET", path: "/api/v1/notifications", status: 500 }] }) });
await expectCode("NETWORK_EVIDENCE_INVALID", failedNetwork);
assert.equal(failedNetwork.cleanupCalled(), true);
checks.push("absolute or failed network rejected and cleaned");

const foreignOwnership = ownershipFixture();
foreignOwnership.records[0].ownerRunId = "OTHER_RUN";
const foreign = drivers({ ownership: foreignOwnership });
await expectCode("OWNERSHIP_CONTRACT_INVALID", foreign);
assert.equal(foreign.cleanupCalled(), false);
checks.push("foreign ownership rejected without unsafe cleanup");

const sensitive = drivers({ browser: browserFixture({ accessToken: "must-not-be-recorded" }) });
await expectCode("SENSITIVE_FIELD_REJECTED", sensitive);
assert.equal(sensitive.cleanupCalled(), true);
checks.push("sensitive field rejected and cleaned");

const incompleteCleanup = drivers({ cleanup: cleanupFixture({ residualOwnedRows: 1 }) });
await expectCode("CLEANUP_INCOMPLETE", incompleteCleanup);
checks.push("incomplete cleanup rejected");

const cli = spawnSync(process.execPath, [resolve(here, "orchestrator.mjs"), "execute-area", "--area=home-search-notification", `--run-id=${runId}`], {
  cwd: userWeb,
  encoding: "utf8",
  shell: false,
  windowsHide: true,
});
assert.equal(cli.status, 2);
assert.equal(cli.stdout, "");
assert.deepEqual(JSON.parse(cli.stderr), { status: "LIVE_INPUT_REQUIRED", errorCode: "LIVE_INPUT_REQUIRED" });
checks.push("orchestrator runtime input fail closed");

console.log(JSON.stringify({ status: "PASS", passed: checks.length, total: checks.length, checks }));
