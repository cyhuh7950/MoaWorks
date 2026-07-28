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

const sensitiveKey = /password|token|cookie|authorization|secret|set-cookie/i;

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
  const allowedKinds = new Set(["notice", "schedule", "notification", "notification_state"]);
  for (const record of ownership.records) {
    if (!allowedKinds.has(record.kind) || typeof record.id !== "string" || !record.id || record.ownerRunId !== runId) throw contractError("OWNERSHIP_CONTRACT_INVALID");
  }
  if (!ownership.preferencesBefore || typeof ownership.preferencesBefore !== "object") throw contractError("PREFERENCES_SNAPSHOT_REQUIRED");
}

function assertBrowserResult(result, allowedPaths) {
  assertNoSensitiveKeys(result, "browserResult");
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
  const ownedIds = new Set(ownership.records.map((record) => record.id));
  if (!evidence.rows.every((row) => row.ownerRunId === runId && ownedIds.has(row.id))) throw contractError("DB_EVIDENCE_NOT_RUN_OWNED");
  const evidenceRowIds = new Set(evidence.rows.map((row) => row.id));
  if (![...ownedIds].every((id) => evidenceRowIds.has(id))) throw contractError("DB_EVIDENCE_INCOMPLETE");
  if (!evidence.preferences || evidence.preferences.beforeMatchesSnapshot !== true || evidence.preferences.afterSaved !== true || evidence.preferences.rereadMatchesAfter !== true) throw contractError("PREFERENCES_EVIDENCE_INCOMPLETE");
  const ownedAudits = (evidence.audits ?? []).filter((audit) => audit.ownerRunId === runId && audit.actorId && audit.targetId);
  const auditEvents = new Set(ownedAudits.filter((audit) => audit.event === "notification.preferences.updated" ? audit.targetId === audit.actorId : ownedIds.has(audit.targetId)).map((audit) => audit.event));
  if (!REQUIRED_AUDIT_EVENTS.every((event) => auditEvents.has(event))) throw contractError("AUDIT_EVIDENCE_INCOMPLETE");
}

function assertCleanup(cleanup, runId) {
  assertNoSensitiveKeys(cleanup, "cleanup");
  if (cleanup?.runId !== runId || cleanup.residualOwnedRows !== 0 || cleanup.residualOwnedAudit !== 0 || cleanup.residualStorageObjects !== 0 || cleanup.preferencesRestored !== true) throw contractError("CLEANUP_INCOMPLETE");
  const protectedState = cleanup.protectedAccounts ?? [];
  const required = ["admin", "cyhuh", "ysla"];
  if (!required.every((loginId) => protectedState.some((item) => item.loginId === loginId && item.unchanged === true))) throw contractError("PROTECTED_ACCOUNT_CHECK_INCOMPLETE");
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
    assertBrowserResult(browserResult, area.apiPaths);
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
  assertCleanup(cleanup, runId);
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
