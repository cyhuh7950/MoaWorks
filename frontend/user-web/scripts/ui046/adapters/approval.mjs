const REQUIRED_PERMISSIONS = ["approval:act", "approval:create", "approval:read", "approval:rework", "approval:submit", "approval:withdraw"];
const REQUIRED_METHODS = { browser: ["runApprovalDocuments", "runApprovalBasicSettings", "runApprovalDelegations", "close"], db: ["prepareOwnedData", "collectApprovalEvidence", "cleanupOwnedData"] };
const REQUIRED_DOCUMENT_ACTIONS = ["approval.list", "approval.detail", "approval.audit", "approval.approvers", "approval.attachment.upload", "approval.attachment.download", "approval.draft.save", "approval.draft.reread", "approval.submit", "approval.approve", "approval.reject", "approval.withdraw", "approval.redraft", "approval.action.reread"];
const REQUIRED_SETTING_ACTIONS = ["approval.settings.basic.get", "approval.settings.basic.save", "approval.settings.basic.reread"];
const REQUIRED_DELEGATION_ACTIONS = ["approval.delegations.list", "approval.delegation.create", "approval.delegation.reread", "approval.delegation.update", "approval.delegation.delete", "approval.delegation.soft_delete.reread"];
const REQUIRED_AUDITS = ["approval.created", "approval.submitted", "approval.approved", "approval.rejected", "approval.withdrawn", "approval.redrafted", "approval.settings.updated", "approval.delegation.created", "approval.delegation.updated", "approval.delegation.deleted"];
const ALLOWED_KINDS = new Set(["test_role", "test_user", "approval_document", "approval_line", "approval_attachment", "approval_upload", "approval_basic_preference", "approval_delegation", "notification", "notification_state", "monitoring_event", "storage_object"]);
const PROTECTED = new Set(["admin", "cyhuh", "ysla"]);
const SENSITIVE_KEY = /password|hash|token|cookie|authorization|secret|set-cookie|storage(?:key|path)/i;
const EXPECTED_SCREENSHOTS = ["approval-list-detail.png", "approval-compose.png", "approval-actions.png", "approval-basic-settings.png", "approval-delegations.png"].map((name) => `screenshots/${name}`);

export function approvalContractError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertNoSensitiveKeys(value, path = "approval") {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw approvalContractError(`SENSITIVE_FIELD_REJECTED:${path}.${key}`);
    if (item && typeof item === "object") assertNoSensitiveKeys(item, `${path}.${key}`);
  }
}

function assertDrivers(browserDriver, dbDriver) {
  if (!browserDriver || !dbDriver) throw approvalContractError("LIVE_INPUT_REQUIRED");
  assertNoSensitiveKeys(browserDriver, "browserDriver");
  assertNoSensitiveKeys(dbDriver, "dbDriver");
  for (const method of REQUIRED_METHODS.browser) if (typeof browserDriver[method] !== "function") throw approvalContractError("LIVE_INPUT_REQUIRED");
  for (const method of REQUIRED_METHODS.db) if (typeof dbDriver[method] !== "function") throw approvalContractError("LIVE_INPUT_REQUIRED");
}

function includesRunId(value, runId) {
  return typeof value === "string" && value.toLowerCase().includes(runId.toLowerCase());
}

function one(records, kind) {
  const matches = records.filter((record) => record.kind === kind);
  return matches.length === 1 ? matches[0] : null;
}

function assertOwnership(candidate, runId) {
  assertNoSensitiveKeys(candidate, "ownership");
  if (candidate?.runId !== runId || typeof candidate.companyId !== "string" || !candidate.companyId || !Array.isArray(candidate.records)) throw approvalContractError("OWNERSHIP_CONTRACT_INVALID");
  const seen = new Set();
  for (const record of candidate.records) {
    if (!ALLOWED_KINDS.has(record.kind) || typeof record.id !== "string" || !record.id || seen.has(record.id) || record.ownerRunId !== runId) throw approvalContractError("OWNERSHIP_CONTRACT_INVALID");
    seen.add(record.id);
  }
  const role = one(candidate.records, "test_role");
  const users = candidate.records.filter((record) => record.kind === "test_user");
  if (!role || users.length !== 3 || role.companyId !== candidate.companyId || JSON.stringify([...(role.permissions ?? [])].sort()) !== JSON.stringify(REQUIRED_PERMISSIONS) || !includesRunId(role.name, runId)) throw approvalContractError("IDENTITY_TOPOLOGY_INVALID");
  const byPurpose = Object.fromEntries(users.map((user) => [user.purpose, user]));
  if (!byPurpose.author || !byPurpose.approver || !byPurpose.delegate || Object.keys(byPurpose).length !== 3) throw approvalContractError("IDENTITY_TOPOLOGY_INVALID");
  for (const purpose of ["author", "approver", "delegate"]) {
    const user = byPurpose[purpose];
    const localPart = user.email?.split("@")[0];
    if (user.roleId !== role.id || user.companyId !== candidate.companyId || user.active !== true || !includesRunId(user.name, runId) || !includesRunId(user.loginId, runId) || !includesRunId(localPart, runId) || !user.name.toLowerCase().includes(purpose) || !user.loginId.toLowerCase().includes(purpose) || !localPart?.toLowerCase().includes(purpose)) throw approvalContractError("IDENTITY_TOPOLOGY_INVALID");
  }
  const documents = candidate.records.filter((record) => record.kind === "approval_document");
  const lines = candidate.records.filter((record) => record.kind === "approval_line");
  if (documents.length !== 3 || lines.length !== 3 || new Set(documents.map((record) => record.purpose)).size !== 3 || !["approve", "reject", "withdraw"].every((purpose) => documents.some((record) => record.purpose === purpose))) throw approvalContractError("OWNERSHIP_CONTRACT_INVALID");
  for (const document of documents) {
    if (document.authorId !== byPurpose.author.id || document.companyId !== candidate.companyId || !lines.some((line) => line.documentId === document.id && line.approverId === byPurpose.approver.id)) throw approvalContractError("OWNERSHIP_CONTRACT_INVALID");
  }
  const preference = one(candidate.records, "approval_basic_preference");
  const delegation = one(candidate.records, "approval_delegation");
  if (!preference || preference.userId !== byPurpose.author.id || preference.companyId !== candidate.companyId || !delegation || delegation.ownerId !== byPurpose.approver.id || delegation.delegateId !== byPurpose.delegate.id || delegation.companyId !== candidate.companyId) throw approvalContractError("OWNERSHIP_CONTRACT_INVALID");
  for (const kind of ["approval_attachment", "approval_upload", "notification", "notification_state", "monitoring_event", "storage_object"]) if (!one(candidate.records, kind)) throw approvalContractError("OWNERSHIP_CONTRACT_INVALID");
  return { ownership: candidate, role, ...byPurpose, documents, lines, preference, delegation, owned: new Map(candidate.records.map((record) => [record.id, record])) };
}

function assertSession(session, expectedUser) {
  const loginIds = Array.isArray(session) ? session.map((item) => item?.activeLoginId) : [session?.activeLoginId];
  if (loginIds.some((loginId) => PROTECTED.has(String(loginId).toLowerCase()))) throw approvalContractError("PROTECTED_ACCOUNT_SESSION_REJECTED");
  if (!loginIds.includes(expectedUser.loginId)) throw approvalContractError("DISPOSABLE_SESSION_REQUIRED");
}

function assertActions(actions, required, code) {
  const actual = new Set(actions ?? []);
  if (!required.every((action) => actual.has(action))) throw approvalContractError(code);
}

function assertNetwork(network, requiredFamilies) {
  if (!Array.isArray(network) || !network.length) throw approvalContractError("NETWORK_EVIDENCE_INCOMPLETE");
  for (const record of network) {
    if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(["method", "path", "status"])) throw approvalContractError("NETWORK_FIELDS_INVALID");
    if (typeof record.path !== "string" || !record.path.startsWith("/api/v1/approvals") || record.path.includes("://") || record.path.includes("?") || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(record.method) || !Number.isInteger(record.status) || record.status < 200 || record.status >= 300) throw approvalContractError("NETWORK_NOT_SAME_ORIGIN_RELATIVE");
  }
  if (!requiredFamilies.every((matches) => network.some(matches))) throw approvalContractError("NETWORK_ROUTE_FAMILY_INCOMPLETE");
}

function assertDocumentNetwork(network, context) {
  const required = new Set();
  for (const record of network) {
    const { method, path } = record;
    if (/^\/api\/v1\/approvals\/[^/]+\/audit$/.test(path) || (method === "GET" && /^\/api\/v1\/approvals\/attachments\/[^/]+$/.test(path))) throw approvalContractError("NETWORK_LEGACY_ROUTE_REJECTED");
    if (method === "GET" && path === "/api/v1/approvals") { required.add("list"); continue; }
    if (method === "POST" && path === "/api/v1/approvals") { required.add("create"); continue; }
    if (method === "GET" && path === "/api/v1/approvals/audit-logs") { required.add("audit"); continue; }
    if (method === "GET" && path === "/api/v1/approvals/approvers") { required.add("approvers"); continue; }
    if (method === "POST" && path === "/api/v1/approvals/attachments") { required.add("attachment-upload"); continue; }
    const attachment = path.match(/^\/api\/v1\/approvals\/([^/]+)\/attachments\/([^/]+)$/);
    if (method === "GET" && attachment) {
      const [, documentId, attachmentId] = attachment;
      const document = context.owned.get(documentId);
      const ownedAttachment = context.owned.get(attachmentId);
      if (document?.kind !== "approval_document" || ownedAttachment?.kind !== "approval_attachment" || ownedAttachment.documentId !== documentId) throw approvalContractError("NETWORK_DYNAMIC_OWNERSHIP_MISMATCH");
      required.add("attachment-download");
      continue;
    }
    const action = path.match(/^\/api\/v1\/approvals\/([^/]+)\/(submit|approve|reject|withdraw|redraft)$/);
    if (method === "POST" && action) {
      if (context.owned.get(action[1])?.kind !== "approval_document") throw approvalContractError("NETWORK_DYNAMIC_OWNERSHIP_MISMATCH");
      required.add(action[2]);
      continue;
    }
    const document = path.match(/^\/api\/v1\/approvals\/([^/]+)$/);
    if (document && ["GET", "PATCH"].includes(method)) {
      if (context.owned.get(document[1])?.kind !== "approval_document") throw approvalContractError("NETWORK_DYNAMIC_OWNERSHIP_MISMATCH");
      required.add(method === "GET" ? "detail" : "update");
      continue;
    }
    throw approvalContractError("NETWORK_ROUTE_FAMILY_INCOMPLETE");
  }
  const expected = ["list", "detail", "audit", "approvers", "attachment-upload", "attachment-download", "create", "update", "submit", "approve", "reject", "withdraw", "redraft"];
  if (!expected.every((name) => required.has(name))) throw approvalContractError("NETWORK_ROUTE_FAMILY_INCOMPLETE");
}

function assertDelegationNetwork(network, context) {
  const required = new Set();
  for (const record of network) {
    const { method, path } = record;
    if (path === "/api/v1/approvals/delegations" || path.startsWith("/api/v1/approvals/delegations/")) throw approvalContractError("NETWORK_LEGACY_ROUTE_REJECTED");
    if (path === "/api/v1/approvals/settings/delegations" && ["GET", "POST"].includes(method)) {
      required.add(method === "GET" ? "list" : "create");
      continue;
    }
    const dynamic = path.match(/^\/api\/v1\/approvals\/settings\/delegations\/([^/]+)$/);
    if (dynamic && ["PATCH", "DELETE"].includes(method)) {
      if (dynamic[1] !== context.delegation.id || context.owned.get(dynamic[1])?.kind !== "approval_delegation") throw approvalContractError("NETWORK_DYNAMIC_OWNERSHIP_MISMATCH");
      required.add(method === "PATCH" ? "update" : "delete");
      continue;
    }
    throw approvalContractError("NETWORK_ROUTE_FAMILY_INCOMPLETE");
  }
  if (!["list", "create", "update", "delete"].every((name) => required.has(name))) throw approvalContractError("NETWORK_ROUTE_FAMILY_INCOMPLETE");
}

function assertMutations(mutations, network, context) {
  if (!Array.isArray(mutations) || !mutations.length) throw approvalContractError("MUTATION_OWNERSHIP_MISMATCH");
  const successful = new Set(network.map((item) => `${item.method} ${item.path}`));
  for (const mutation of mutations) {
    const owned = context.owned.get(mutation.id);
    if (!owned || owned.kind !== mutation.kind || !successful.has(`${mutation.method} ${mutation.path}`)) throw approvalContractError("MUTATION_OWNERSHIP_MISMATCH");
  }
  const mutationCounts = new Map();
  for (const mutation of mutations) {
    const key = `${mutation.method} ${mutation.path}`;
    mutationCounts.set(key, (mutationCounts.get(key) ?? 0) + 1);
  }
  const networkCounts = new Map();
  for (const record of network.filter((item) => item.method !== "GET")) {
    const key = `${record.method} ${record.path}`;
    networkCounts.set(key, (networkCounts.get(key) ?? 0) + 1);
  }
  if ([...networkCounts].some(([key, count]) => mutationCounts.get(key) !== count)) throw approvalContractError("MUTATION_OWNERSHIP_MISMATCH");
}

function assertScreenshots(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length || new Set(actual).size !== actual.length || !expected.every((path) => actual.includes(path))) throw approvalContractError("SCREENSHOT_EVIDENCE_INCOMPLETE");
}

function validateDocuments(result, context, runId) {
  assertNoSensitiveKeys(result, "documents");
  if (result?.status !== "PASS") throw approvalContractError("APPROVAL_COMPOSITE_INCOMPLETE");
  assertSession(result.sessions, context.author);
  assertSession(result.sessions, context.approver);
  assertActions(result.actions, REQUIRED_DOCUMENT_ACTIONS, "DOCUMENT_ACTION_INCOMPLETE");
  const documents = result.documents ?? [];
  if (documents.length !== 3 || new Set(documents.map((item) => item.id)).size !== 3 || !["approve", "reject", "withdraw"].every((purpose) => documents.some((item) => item.purpose === purpose))) throw approvalContractError("DOCUMENT_COMPOSITE_INCOMPLETE");
  const expected = { approve: ["approved", "approved"], reject: ["draft", "pending"], withdraw: ["draft", "pending"] };
  for (const item of documents) {
    const owned = context.documents.find((document) => document.id === item.id && document.purpose === item.purpose);
    const line = context.lines.find((candidate) => candidate.id === item.lineId && candidate.documentId === item.id);
    if (!owned || !line || item.authorId !== context.author.id || item.approverId !== context.approver.id || !includesRunId(item.title, runId)) throw approvalContractError("DOCUMENT_TARGET_MISMATCH");
    if (item.finalStatus !== expected[item.purpose]?.[0] || item.lineFinalStatus !== expected[item.purpose]?.[1] || item.draftReread !== true || item.submittedReread !== true || item.actionReread !== true || item.historyReread !== true || (item.purpose !== "approve" && item.redraftReread !== true)) throw approvalContractError("DOCUMENT_STATE_REREAD_MISMATCH");
  }
  const attachment = result.attachment;
  if (!attachment || context.owned.get(attachment.id)?.kind !== "approval_attachment" || context.owned.get(attachment.uploadId)?.kind !== "approval_upload" || attachment.documentId !== documents.find((item) => item.purpose === "approve")?.id || attachment.ownerRunId !== runId || attachment.mimeType !== "text/plain" || !Number.isInteger(attachment.sizeBytes) || attachment.sizeBytes < 1 || attachment.sizeBytes > 1024 || attachment.downloadConfirmed !== true || !includesRunId(attachment.fileName, runId)) throw approvalContractError("ATTACHMENT_CONTRACT_INVALID");
  assertNetwork(result.network, []);
  assertDocumentNetwork(result.network, context);
  assertMutations(result.mutationOwnership, result.network, context);
  assertScreenshots(result.screenshots, EXPECTED_SCREENSHOTS.slice(0, 3));
  return result;
}

function validateSettings(result, context) {
  assertNoSensitiveKeys(result, "settings");
  if (result?.status !== "PASS") throw approvalContractError("APPROVAL_COMPOSITE_INCOMPLETE");
  assertSession(result.session, context.author);
  assertActions(result.actions, REQUIRED_SETTING_ACTIONS, "BASIC_SETTING_ACTION_INCOMPLETE");
  const value = result.preference;
  const allowed = new Set(["thumbnail", "original", "filename"]);
  if (!value || value.id !== context.preference.id || value.userId !== context.author.id || value.companyId !== context.ownership.companyId || !allowed.has(value.beforeAttachmentImageDisplay) || !allowed.has(value.afterAttachmentImageDisplay) || value.beforeAttachmentImageDisplay === value.afterAttachmentImageDisplay || value.afterVersion !== value.beforeVersion + 1 || value.hasSignature !== false) throw approvalContractError("BASIC_SETTING_VERSION_INVALID");
  if (value.rereadVersion !== value.afterVersion || value.rereadAttachmentImageDisplay !== value.afterAttachmentImageDisplay) throw approvalContractError("BASIC_SETTING_REREAD_MISMATCH");
  assertNetwork(result.network, [(r) => r.method === "GET" && r.path === "/api/v1/approvals/settings/basic", (r) => r.method === "PUT" && r.path === "/api/v1/approvals/settings/basic"]);
  assertMutations(result.mutationOwnership, result.network, context);
  assertScreenshots(result.screenshots, [EXPECTED_SCREENSHOTS[3]]);
  return result;
}

function validateDelegations(result, context) {
  assertNoSensitiveKeys(result, "delegations");
  if (result?.status !== "PASS") throw approvalContractError("APPROVAL_COMPOSITE_INCOMPLETE");
  assertSession(result.session, context.approver);
  assertActions(result.actions, REQUIRED_DELEGATION_ACTIONS, "DELEGATION_ACTION_INCOMPLETE");
  const value = result.delegation;
  if (!value || value.id !== context.delegation.id || value.ownerId !== context.approver.id || value.delegateId !== context.delegate.id || value.companyId !== context.ownership.companyId || value.includesCurrentSeoulDate !== true || value.reasonIncludesRunId !== true) throw approvalContractError("DELEGATION_TARGET_MISMATCH");
  if (value.versionAfterUpdate !== value.versionBeforeUpdate + 1 || value.rereadVersion !== value.versionAfterUpdate || value.deleteExpectedVersion !== value.versionAfterUpdate) throw approvalContractError("DELEGATION_VERSION_INVALID");
  if (value.softDeleted !== true || value.absentAfterDelete !== true) throw approvalContractError("DELEGATION_REREAD_MISMATCH");
  assertNetwork(result.network, []);
  assertDelegationNetwork(result.network, context);
  assertMutations(result.mutationOwnership, result.network, context);
  assertScreenshots(result.screenshots, [EXPECTED_SCREENSHOTS[4]]);
  return result;
}

function assertDbEvidence(evidence, context, documents, settings, delegations, runId) {
  assertNoSensitiveKeys(evidence, "dbEvidence");
  if (evidence?.existingRowChanges !== 0 || !Array.isArray(evidence.rows) || evidence.rows.length !== context.owned.size) throw approvalContractError(evidence?.existingRowChanges ? "EXISTING_ROW_CHANGED" : "DB_EVIDENCE_NOT_RUN_OWNED");
  const rowIds = new Set(evidence.rows.map((row) => row.id));
  if (rowIds.size !== context.owned.size || evidence.rows.some((row) => row.ownerRunId !== runId || context.owned.get(row.id)?.kind !== row.kind)) throw approvalContractError("DB_EVIDENCE_NOT_RUN_OWNED");
  const audits = evidence.audits ?? [];
  const events = new Set(audits.map((audit) => audit.event));
  if (!REQUIRED_AUDITS.every((event) => events.has(event))) throw approvalContractError("AUDIT_EVIDENCE_INCOMPLETE");
  const actorFor = (event) => ["approval.approved", "approval.rejected"].includes(event) || event.startsWith("approval.delegation.") ? context.approver.id : context.author.id;
  const allowedTargets = {
    "approval.created": context.documents.map((x) => x.id), "approval.submitted": context.documents.map((x) => x.id), "approval.approved": [documents.documents.find((x) => x.purpose === "approve").id],
    "approval.rejected": [documents.documents.find((x) => x.purpose === "reject").id], "approval.withdrawn": [documents.documents.find((x) => x.purpose === "withdraw").id],
    "approval.redrafted": context.documents.filter((x) => x.purpose !== "approve").map((x) => x.id), "approval.settings.updated": [settings.preference.id],
    "approval.delegation.created": [delegations.delegation.id], "approval.delegation.updated": [delegations.delegation.id], "approval.delegation.deleted": [delegations.delegation.id],
  };
  if (audits.some((audit) => audit.ownerRunId !== runId || audit.actorId !== actorFor(audit.event) || !allowedTargets[audit.event]?.includes(audit.targetId))) throw approvalContractError("AUDIT_ACTOR_TARGET_MISMATCH");
  for (const item of documents.documents) {
    const state = (evidence.documentStates ?? []).find((candidate) => candidate.id === item.id);
    if (!state || state.lineId !== item.lineId || state.status !== item.finalStatus || state.lineStatus !== item.lineFinalStatus || state.actorId !== (item.purpose === "withdraw" ? context.author.id : context.approver.id)) throw approvalContractError("DOCUMENT_DB_STATE_MISMATCH");
  }
  const preference = evidence.preference;
  if (!preference || preference.id !== settings.preference.id || preference.userId !== context.author.id || preference.companyId !== context.ownership.companyId || preference.afterVersion !== preference.beforeVersion + 1 || preference.rereadVersion !== preference.afterVersion) throw approvalContractError("BASIC_SETTING_DB_MISMATCH");
  const delegation = evidence.delegation;
  if (!delegation || delegation.id !== delegations.delegation.id || delegation.ownerId !== context.approver.id || delegation.delegateId !== context.delegate.id || delegation.companyId !== context.ownership.companyId || delegation.versionAfterUpdate !== delegation.versionBeforeUpdate + 1 || delegation.softDeleted !== true) throw approvalContractError("DELEGATION_DB_MISMATCH");
}

function sameFingerprint(item) {
  if (!item || typeof item.before?.exists !== "boolean" || typeof item.after?.exists !== "boolean") return false;
  return item.before.exists ? item.after.exists === true && typeof item.before.fingerprint === "string" && item.before.fingerprint.length > 0 && item.before.fingerprint === item.after.fingerprint : item.after.exists === false;
}

function assertCleanup(cleanup, context, runId) {
  assertNoSensitiveKeys(cleanup, "cleanup");
  if (cleanup?.runId !== runId || cleanup.residualOwnedRows !== 0 || cleanup.residualOwnedAudit !== 0 || cleanup.residualNotifications !== 0 || cleanup.residualMonitoringEvents !== 0 || cleanup.residualStorageObjects !== 0 || cleanup.existingRowChanges !== 0 || cleanup.orderVerified !== true || cleanup.sessionsClosed !== true) throw approvalContractError("CLEANUP_INCOMPLETE");
  if (context) {
    const identities = context.ownership.records.filter((record) => ["test_role", "test_user"].includes(record.kind));
    if (!Array.isArray(cleanup.disposableIdentities) || cleanup.disposableIdentities.length !== identities.length || cleanup.disposableIdentities.some((item) => item.ownerRunId !== runId || item.active !== false || !["removed", "soft_deleted"].includes(item.disposition) || !identities.some((record) => record.id === item.id && record.kind === item.kind))) throw approvalContractError("CLEANUP_INCOMPLETE");
  }
  if (!["admin", "cyhuh", "ysla"].every((loginId) => sameFingerprint((cleanup.protectedAccounts ?? []).find((item) => item.loginId === loginId))) || !cleanup.existingApprovalFingerprint || cleanup.existingApprovalFingerprint.before !== cleanup.existingApprovalFingerprint.after) throw approvalContractError("PROTECTED_ACCOUNT_CHANGED");
}

export async function runApproval({ manifest, runId, browserDriver, dbDriver, evidenceDir }) {
  assertDrivers(browserDriver, dbDriver);
  const area = manifest.areas.find((item) => item.id === "approval");
  if (!area || area.status !== "READY" || area.adapter !== "approval") throw approvalContractError("AREA_NOT_READY");
  let context;
  let documents;
  let settings;
  let delegations;
  let dbEvidence;
  let cleanup;
  let primaryError;
  let closeError;
  let cleanupError;
  try {
    context = assertOwnership(await dbDriver.prepareOwnedData({ runId }), runId);
    documents = validateDocuments(await browserDriver.runApprovalDocuments({ runId, origin: manifest.environment.userOrigin, evidenceDir, ownership: context.ownership }), context, runId);
    settings = validateSettings(await browserDriver.runApprovalBasicSettings({ runId, origin: manifest.environment.userOrigin, evidenceDir, ownership: context.ownership }), context);
    delegations = validateDelegations(await browserDriver.runApprovalDelegations({ runId, origin: manifest.environment.userOrigin, evidenceDir, ownership: context.ownership }), context);
    if ([documents, settings, delegations].some((result) => result.status !== "PASS")) throw approvalContractError("APPROVAL_COMPOSITE_INCOMPLETE");
    dbEvidence = await dbDriver.collectApprovalEvidence({ runId, ownership: context.ownership });
    assertDbEvidence(dbEvidence, context, documents, settings, delegations, runId);
  } catch (error) {
    primaryError = error?.code ? error : approvalContractError("LIVE_EXECUTION_FAILED");
  } finally {
    try { await browserDriver.close(); } catch { closeError = approvalContractError("BROWSER_CLOSE_FAILED"); }
    try { cleanup = await dbDriver.cleanupOwnedData({ runId, ownership: context?.ownership }); } catch { cleanupError = approvalContractError("CLEANUP_DRIVER_FAILED"); }
  }
  if (cleanupError) throw cleanupError;
  if (!cleanup) throw primaryError ?? approvalContractError("CLEANUP_REQUIRED");
  assertCleanup(cleanup, context, runId);
  if (closeError) throw closeError;
  if (primaryError) throw primaryError;
  return {
    status: "PASS", areaId: "approval",
    actions: { documents: documents.actions, settings: settings.actions, delegations: delegations.actions },
    screenshots: [...documents.screenshots, ...settings.screenshots, ...delegations.screenshots],
    network: [...documents.network, ...settings.network, ...delegations.network],
    mutationOwnership: { documents: documents.mutationOwnership, settings: settings.mutationOwnership, delegations: delegations.mutationOwnership },
    documents, settings, delegations, dbAudit: dbEvidence, cleanup,
  };
}

export const approvalContract = { requiredPermissions: REQUIRED_PERMISSIONS, requiredAudits: REQUIRED_AUDITS, requiredDriverMethods: REQUIRED_METHODS, requiredScreenshots: EXPECTED_SCREENSHOTS };
