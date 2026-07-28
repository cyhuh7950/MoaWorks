const REQUIRED_ACTIONS = [
  "home.summary",
  "search.open",
  "search.navigate",
  "notification.read",
  "notification.read_all",
  "notification.archive",
  "notification.preferences.save",
  "notification.preferences.reread",
];

const REQUIRED_AUDIT_EVENTS = [
  "workspace.notice.read",
  "notification.read",
  "notification.archived",
  "notification.preferences.updated",
];

const REQUIRED_DRIVER_METHODS = {
  browser: ["runHomeSearchNotification", "close"],
  db: ["prepareOwnedData", "collectOwnedEvidence", "cleanupOwnedData"],
};

const sensitiveKey = /password|hash|token|cookie|authorization|secret|set-cookie/i;
const PROTECTED_LOGIN_IDS = new Set(["admin", "cyhuh", "ysla"]);

function isProtectedLogin(loginId) {
  return typeof loginId === "string" && PROTECTED_LOGIN_IDS.has(loginId.toLowerCase());
}

function contractError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertNoSensitiveKeys(value, path = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key)) throw contractError(`SENSITIVE_FIELD_REJECTED:${path}.${key}`);
    if (item && typeof item === "object") assertNoSensitiveKeys(item, `${path}.${key}`);
  }
}

function assertDrivers(browserDriver, dbDriver) {
  if (!browserDriver || !dbDriver) throw contractError("LIVE_INPUT_REQUIRED");
  assertNoSensitiveKeys(browserDriver, "browserDriver");
  assertNoSensitiveKeys(dbDriver, "dbDriver");
  for (const method of REQUIRED_DRIVER_METHODS.browser) {
    if (typeof browserDriver[method] !== "function") throw contractError("LIVE_INPUT_REQUIRED");
  }
  for (const method of REQUIRED_DRIVER_METHODS.db) {
    if (typeof dbDriver[method] !== "function") throw contractError("LIVE_INPUT_REQUIRED");
  }
}

function assertOwnership(ownership, runId) {
  assertNoSensitiveKeys(ownership, "ownership");
  if (ownership?.runId !== runId || !Array.isArray(ownership.records) || ownership.records.length === 0) throw contractError("OWNERSHIP_CONTRACT_INVALID");
  if (Object.hasOwn(ownership, "preferencesBefore")) throw contractError("SNAPSHOT_RESTORE_CONTRACT_REJECTED");
  const allowedKinds = new Set(["test_user", "test_role", "notice", "schedule", "notification", "notification_state"]);
  const recordIds = new Set();
  for (const record of ownership.records) {
    if (!allowedKinds.has(record.kind) || typeof record.id !== "string" || !record.id || recordIds.has(record.id) || record.ownerRunId !== runId) throw contractError("OWNERSHIP_CONTRACT_INVALID");
    recordIds.add(record.id);
  }
  const testUsers = ownership.records.filter((record) => record.kind === "test_user");
  const testRoles = ownership.records.filter((record) => record.kind === "test_role");
  if (testUsers.length !== 1 || testRoles.length !== 1) throw contractError("DISPOSABLE_IDENTITY_REQUIRED");
  const [testUser] = testUsers;
  const [testRole] = testRoles;
  if (typeof testUser.loginId !== "string" || !testUser.loginId.toLowerCase().includes(runId.toLowerCase()) || isProtectedLogin(testUser.loginId) || testUser.roleId !== testRole.id) throw contractError("DISPOSABLE_IDENTITY_INVALID");
  if (typeof testRole.name !== "string" || !testRole.name.includes(runId)) throw contractError("DISPOSABLE_IDENTITY_INVALID");
  const states = ownership.records.filter((record) => record.kind === "notification_state");
  if (states.length === 0 || states.some((record) => record.userId !== testUser.id)) throw contractError("OWNERSHIP_CONTRACT_INVALID");
}

function disposableIdentity(ownership) {
  return ownership.records.find((record) => record.kind === "test_user");
}

function assertBrowserResult(result, allowedPaths, ownership) {
  assertNoSensitiveKeys(result, "browserResult");
  const testUser = disposableIdentity(ownership);
  const activeLoginId = result?.session?.activeLoginId;
  if (isProtectedLogin(activeLoginId)) throw contractError("PROTECTED_ACCOUNT_SESSION_REJECTED");
  if (typeof activeLoginId !== "string" || activeLoginId !== testUser.loginId) throw contractError("DISPOSABLE_SESSION_REQUIRED");
  const actionSet = new Set(result?.actions ?? []);
  if (!REQUIRED_ACTIONS.every((action) => actionSet.has(action))) throw contractError("BROWSER_ACTION_EVIDENCE_INCOMPLETE");
  if (!Array.isArray(result.network) || result.network.length === 0) throw contractError("NETWORK_EVIDENCE_INCOMPLETE");
  for (const record of result.network) {
    const path = record?.path;
    if (typeof path !== "string" || !path.startsWith("/api/v1/") || path.includes("://") || path.includes("?") || !allowedPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) throw contractError("NETWORK_NOT_SAME_ORIGIN_RELATIVE");
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(record.method) || !Number.isInteger(record.status) || record.status < 200 || record.status >= 400) throw contractError("NETWORK_EVIDENCE_INVALID");
  }
  const screenshots = result.screenshots ?? [];
  if (!["home.png", "search.png", "notifications.png"].every((name) => screenshots.includes(`screenshots/${name}`))) throw contractError("SCREENSHOT_EVIDENCE_INCOMPLETE");
  if (result.rereadConfirmed !== true) throw contractError("SCREEN_REREAD_NOT_CONFIRMED");
}

function assertDbEvidence(evidence, ownership, runId) {
  assertNoSensitiveKeys(evidence, "dbEvidence");
  if (!Array.isArray(evidence?.rows) || evidence.rows.length === 0) throw contractError("DB_EVIDENCE_INCOMPLETE");
  const ownedRecords = new Map(ownership.records.map((record) => [record.id, record]));
  const ownedIds = new Set(ownedRecords.keys());
  if (!evidence.rows.every((row) => row.ownerRunId === runId && ownedIds.has(row.id) && row.kind === ownedRecords.get(row.id).kind)) throw contractError("DB_EVIDENCE_NOT_RUN_OWNED");
  const evidenceRowIds = new Set(evidence.rows.map((row) => row.id));
  if (![...ownedIds].every((id) => evidenceRowIds.has(id))) throw contractError("DB_EVIDENCE_INCOMPLETE");
  const testUser = disposableIdentity(ownership);
  if (!evidence.preferences || evidence.preferences.beforeAbsent !== true || evidence.preferences.afterOwnedByRun !== true || evidence.preferences.rereadMatchesAfter !== true || evidence.preferences.ownerRunId !== runId || evidence.preferences.userId !== testUser.id) throw contractError("PREFERENCES_EVIDENCE_INCOMPLETE");
  const ownedStateIds = new Set(ownership.records.filter((record) => record.kind === "notification_state" && record.userId === testUser.id).map((record) => record.id));
  const readAll = evidence.readAll;
  if (readAll?.existingUserStateChanges !== 0 || readAll?.protectedAccountStateChanges !== 0) throw contractError("EXISTING_NOTIFICATION_STATE_CHANGED");
  if (readAll?.actorUserId !== testUser.id) throw contractError("READ_ALL_ACTOR_INVALID");
  for (const field of ["beforeStateIds", "afterStateIds", "changedStateIds"]) {
    if (!Array.isArray(readAll[field]) || readAll[field].length === 0 || readAll[field].some((id) => !ownedStateIds.has(id))) throw contractError("READ_ALL_OWNERSHIP_INVALID");
  }
  const ownedAudits = evidence.audits ?? [];
  if (!Array.isArray(ownedAudits) || ownedAudits.some((audit) => audit.ownerRunId !== runId || audit.actorId !== testUser.id || !audit.targetId || (audit.event === "notification.preferences.updated" ? audit.targetId !== testUser.id : !ownedIds.has(audit.targetId)))) throw contractError("AUDIT_EVIDENCE_NOT_RUN_OWNED");
  const auditEvents = new Set(ownedAudits.map((audit) => audit.event));
  if (!REQUIRED_AUDIT_EVENTS.every((event) => auditEvents.has(event))) throw contractError("AUDIT_EVIDENCE_INCOMPLETE");
}

function assertCleanup(cleanup, ownership, runId) {
  assertNoSensitiveKeys(cleanup, "cleanup");
  if (Object.hasOwn(cleanup ?? {}, "preferencesRestored")) throw contractError("SNAPSHOT_RESTORE_CONTRACT_REJECTED");
  if (cleanup?.existingNotificationStateChanges !== 0) throw contractError("EXISTING_NOTIFICATION_STATE_CHANGED");
  if (cleanup?.runId !== runId || cleanup.residualOwnedRows !== 0 || cleanup.residualOwnedAudit !== 0 || cleanup.residualStorageObjects !== 0) throw contractError("CLEANUP_INCOMPLETE");
  const requiredIdentities = ownership.records.filter((record) => record.kind === "test_user" || record.kind === "test_role");
  const cleanedIdentities = cleanup.disposableIdentities ?? [];
  if (!Array.isArray(cleanedIdentities) || cleanedIdentities.length !== requiredIdentities.length || !cleanedIdentities.every((item) => requiredIdentities.some((record) => item.kind === record.kind && item.id === record.id) && item.ownerRunId === runId && item.active === false && ["removed", "soft_deleted"].includes(item.disposition))) throw contractError("CLEANUP_INCOMPLETE");
  const protectedState = cleanup.protectedAccounts ?? [];
  const required = ["admin", "cyhuh", "ysla"];
  if (!required.every((loginId) => protectedState.some((item) => {
    if (item.loginId !== loginId || typeof item.before?.exists !== "boolean" || typeof item.after?.exists !== "boolean") return false;
    if (item.before.exists === false) return item.after.exists === false;
    return item.after.exists === true && typeof item.before.fingerprint === "string" && item.before.fingerprint.length > 0 && item.before.fingerprint === item.after.fingerprint;
  }))) throw contractError("PROTECTED_ACCOUNT_CHANGED");
}

export async function runHomeSearchNotification({ manifest, runId, browserDriver, dbDriver, evidenceDir }) {
  assertDrivers(browserDriver, dbDriver);
  const area = manifest.areas.find((item) => item.id === "home-search-notification");
  if (!area || area.status !== "READY" || area.adapter !== "home-search-notification") throw contractError("AREA_NOT_READY");

  let ownership;
  let browserResult;
  let dbEvidence;
  let cleanup;
  let primaryError;
  let cleanupError;
  try {
    const preparedOwnership = await dbDriver.prepareOwnedData({ runId });
    assertOwnership(preparedOwnership, runId);
    ownership = preparedOwnership;
    browserResult = await browserDriver.runHomeSearchNotification({
      runId,
      origin: manifest.environment.userOrigin,
      actions: REQUIRED_ACTIONS,
      allowedPaths: area.apiPaths,
      evidenceDir,
    });
    assertBrowserResult(browserResult, area.apiPaths, ownership);
    dbEvidence = await dbDriver.collectOwnedEvidence({ runId, ownership });
    assertDbEvidence(dbEvidence, ownership, runId);
  } catch (error) {
    primaryError = error?.code ? error : contractError("LIVE_EXECUTION_FAILED");
  } finally {
    if (ownership) {
      try {
        cleanup = await dbDriver.cleanupOwnedData({ runId, ownership });
      } catch {
        cleanupError = contractError("CLEANUP_DRIVER_FAILED");
      }
    }
    try {
      await browserDriver.close();
    } catch {
      if (!primaryError) primaryError = contractError("BROWSER_CLOSE_FAILED");
    }
  }

  if (cleanupError) throw cleanupError;
  if (!cleanup) throw primaryError ?? contractError("CLEANUP_REQUIRED");
  assertCleanup(cleanup, ownership, runId);
  if (primaryError) throw primaryError;

  return {
    status: "PASS",
    areaId: area.id,
    actions: browserResult.actions,
    network: browserResult.network,
    screenshots: browserResult.screenshots,
    dbAudit: dbEvidence,
    cleanup,
  };
}

export const homeSearchNotificationContract = {
  requiredActions: REQUIRED_ACTIONS,
  requiredAuditEvents: REQUIRED_AUDIT_EVENTS,
  requiredDriverMethods: REQUIRED_DRIVER_METHODS,
};
