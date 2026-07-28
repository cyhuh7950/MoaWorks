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
const testRoleId = `${runId}_role_id`;
const testUserId = `${runId}_user_id`;
const testLoginId = `${runId}_login`;

function ownershipFixture() {
  return {
    runId,
    records: [
      { kind: "test_role", id: testRoleId, name: `${runId}_role`, ownerRunId: runId },
      { kind: "test_user", id: testUserId, loginId: testLoginId, roleId: testRoleId, ownerRunId: runId },
      { kind: "notice", id: `${runId}_notice`, ownerRunId: runId },
      { kind: "schedule", id: `${runId}_schedule`, ownerRunId: runId },
      { kind: "notification", id: `${runId}_notification_read`, ownerRunId: runId },
      { kind: "notification", id: `${runId}_notification_archive`, ownerRunId: runId },
      { kind: "notification_state", id: `${runId}_state`, userId: testUserId, ownerRunId: runId },
    ],
  };
}

function browserFixture(overrides = {}) {
  return {
    session: { activeLoginId: testLoginId },
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

function dbEvidenceFixture(ownership, overrides = {}) {
  const byKind = Object.fromEntries(ownership.records.map((record) => [record.kind === "notification" && record.id.endsWith("archive") ? "notification_archive" : record.kind, record.id]));
  const stateIds = ownership.records.filter((record) => record.kind === "notification_state").map((record) => record.id);
  return {
    rows: ownership.records.map((record) => ({ id: record.id, kind: record.kind, ownerRunId: runId })),
    preferences: { beforeAbsent: true, afterOwnedByRun: true, rereadMatchesAfter: true, ownerRunId: runId, userId: testUserId },
    readAll: {
      actorUserId: testUserId,
      beforeStateIds: stateIds,
      afterStateIds: stateIds,
      changedStateIds: stateIds,
      existingUserStateChanges: 0,
      protectedAccountStateChanges: 0,
    },
    audits: [
      { event: "workspace.notice.read", actorId: testUserId, targetId: byKind.notice, ownerRunId: runId },
      { event: "notification.read", actorId: testUserId, targetId: ownership.records.find((record) => record.id.endsWith("notification_read")).id, ownerRunId: runId },
      { event: "notification.archived", actorId: testUserId, targetId: byKind.notification_archive, ownerRunId: runId },
      { event: "notification.preferences.updated", actorId: testUserId, targetId: testUserId, ownerRunId: runId },
    ],
    ...overrides,
  };
}

function cleanupFixture(ownership, overrides = {}) {
  const identities = ownership.records.filter((record) => record.kind === "test_user" || record.kind === "test_role");
  return {
    runId,
    residualOwnedRows: 0,
    residualOwnedAudit: 0,
    residualStorageObjects: 0,
    existingNotificationStateChanges: 0,
    disposableIdentities: identities.map((record) => ({ kind: record.kind, id: record.id, ownerRunId: runId, active: false, disposition: "removed" })),
    protectedAccounts: ["admin", "cyhuh", "ysla"].map((loginId) => loginId === "ysla" ? {
      loginId,
      before: { exists: false },
      after: { exists: false },
    } : {
      loginId,
      before: { exists: true, fingerprint: `${loginId}_fingerprint` },
      after: { exists: true, fingerprint: `${loginId}_fingerprint` },
    }),
    ...overrides,
  };
}

function drivers({ browser = browserFixture(), ownership = ownershipFixture(), dbEvidence, cleanup } = {}) {
  let cleanupCalled = false;
  return {
    browserDriver: {
      async runHomeSearchNotification() { return browser; },
      async close() {},
    },
    dbDriver: {
      async prepareOwnedData() { return ownership; },
      async collectOwnedEvidence() { return dbEvidence ?? dbEvidenceFixture(ownership); },
      async cleanupOwnedData() { cleanupCalled = true; return cleanup ?? cleanupFixture(ownership); },
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
checks.push("disposable user and role complete contract");

const lowercaseOwnership = ownershipFixture();
const lowercaseUser = lowercaseOwnership.records.find((record) => record.kind === "test_user");
lowercaseUser.loginId = lowercaseUser.loginId.toLowerCase();
const lowercaseLogin = drivers({ ownership: lowercaseOwnership, browser: browserFixture({ session: { activeLoginId: lowercaseUser.loginId } }) });
const lowercasePassed = await runHomeSearchNotification({ manifest, runId, evidenceDir: "contract-evidence", browserDriver: lowercaseLogin.browserDriver, dbDriver: lowercaseLogin.dbDriver });
assert.equal(lowercasePassed.status, "PASS");
assert.equal(lowercaseLogin.cleanupCalled(), true);
checks.push("lowercase normalized disposable login contract");

const protectedSession = drivers({ browser: browserFixture({ session: { activeLoginId: "admin" } }) });
await expectCode("PROTECTED_ACCOUNT_SESSION_REJECTED", protectedSession);
assert.equal(protectedSession.cleanupCalled(), true);
checks.push("protected account session rejected and cleaned");

const changedExistingState = drivers();
changedExistingState.dbDriver.collectOwnedEvidence = async () => dbEvidenceFixture(ownershipFixture(), { readAll: { ...dbEvidenceFixture(ownershipFixture()).readAll, existingUserStateChanges: 1 } });
await expectCode("EXISTING_NOTIFICATION_STATE_CHANGED", changedExistingState);
assert.equal(changedExistingState.cleanupCalled(), true);
checks.push("existing notification state change rejected and cleaned");

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

const sensitive = drivers({ browser: browserFixture({ passwordHash: "must-not-be-recorded" }) });
await expectCode("SENSITIVE_FIELD_REJECTED", sensitive);
assert.equal(sensitive.cleanupCalled(), true);
checks.push("sensitive field rejected and cleaned");

const snapshotOwnership = ownershipFixture();
snapshotOwnership.preferencesBefore = { enabled: true };
const snapshot = drivers({ ownership: snapshotOwnership });
await expectCode("SNAPSHOT_RESTORE_CONTRACT_REJECTED", snapshot);
assert.equal(snapshot.cleanupCalled(), false);
checks.push("existing preference snapshot contract rejected");

const changedProtected = drivers();
changedProtected.dbDriver.cleanupOwnedData = async () => cleanupFixture(ownershipFixture(), {
  protectedAccounts: cleanupFixture(ownershipFixture()).protectedAccounts.map((item) => item.loginId === "admin" ? { ...item, after: { exists: true, fingerprint: "changed" } } : item),
});
await expectCode("PROTECTED_ACCOUNT_CHANGED", changedProtected);
checks.push("protected account fingerprint change rejected");

const incompleteCleanup = drivers({ cleanup: cleanupFixture(ownershipFixture(), { disposableIdentities: [] }) });
await expectCode("CLEANUP_INCOMPLETE", incompleteCleanup);
checks.push("incomplete disposable cleanup rejected");

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
