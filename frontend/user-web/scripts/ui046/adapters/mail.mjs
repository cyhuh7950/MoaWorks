import { assertNoMailSensitiveKeys, mailContractError, validateMailCore } from "./mail-core.mjs";
import { validateMailSettings } from "./mail-settings.mjs";

const REQUIRED_AUDITS = ["mail.sent", "mail.draft.saved", "mail.preferences.basic.update", "mail.signature.created", "mail.spam.rule.created", "mail.auto_classification.rule.created", "mail.auto_forward.targets.created", "mail.out_of_office.policy.updated", "mail.external.created"];
const AUDIT_TARGET_KINDS = {
  "mail.sent": new Set(["mail_message"]),
  "mail.draft.saved": new Set(["mail_message"]),
  "mail.preferences.basic.update": new Set(["mail_basic_preferences"]),
  "mail.signature.created": new Set(["mail_signature"]),
  "mail.spam.rule.created": new Set(["spam_rule_email", "spam_rule_domain"]),
  "mail.auto_classification.rule.created": new Set(["auto_classification_rule"]),
  "mail.auto_forward.targets.created": new Set(["auto_forward_target"]),
  "mail.out_of_office.policy.updated": new Set(["out_of_office_policy"]),
  "mail.external.created": new Set(["external_account"]),
};
const REQUIRED_METHODS = { browser: ["runMailCore", "runMailSettings", "close"], db: ["prepareOwnedData", "collectMailEvidence", "cleanupOwnedData"] };
const PROTECTED = ["admin", "cyhuh", "ysla"];
const ALLOWED_KINDS = new Set(["test_role", "test_user", "mail_account", "mail_message", "mail_recipient", "mail_attachment", "mail_folder", "mail_tag", "mail_delivery", "mail_basic_preferences", "mail_signature", "mailbox_policy", "spam_rule_email", "spam_rule_domain", "auto_classification_rule", "auto_forward_target", "out_of_office_policy", "external_account", "recent_recipient"]);

function assertDrivers(browserDriver, dbDriver) {
  if (!browserDriver || !dbDriver) throw mailContractError("LIVE_INPUT_REQUIRED");
  assertNoMailSensitiveKeys(browserDriver, "browserDriver");
  assertNoMailSensitiveKeys(dbDriver, "dbDriver");
  for (const method of REQUIRED_METHODS.browser) if (typeof browserDriver[method] !== "function") throw mailContractError("LIVE_INPUT_REQUIRED");
  for (const method of REQUIRED_METHODS.db) if (typeof dbDriver[method] !== "function") throw mailContractError("LIVE_INPUT_REQUIRED");
}

function includesRunId(value, runId) {
  return typeof value === "string" && value.toLowerCase().includes(runId.toLowerCase());
}

function assertOwnership(candidate, runId) {
  assertNoMailSensitiveKeys(candidate, "mailOwnership");
  if (candidate?.runId !== runId || !Array.isArray(candidate.records)) throw mailContractError("OWNERSHIP_CONTRACT_INVALID");
  const ids = new Set();
  for (const record of candidate.records) {
    if (!ALLOWED_KINDS.has(record.kind) || typeof record.id !== "string" || !record.id || ids.has(record.id) || record.ownerRunId !== runId) throw mailContractError("OWNERSHIP_CONTRACT_INVALID");
    ids.add(record.id);
  }
  const roles = candidate.records.filter((record) => record.kind === "test_role");
  const users = candidate.records.filter((record) => record.kind === "test_user");
  const accounts = candidate.records.filter((record) => record.kind === "mail_account");
  if (roles.length !== 1 || users.length !== 2 || accounts.length !== 2) throw mailContractError("IDENTITY_TOPOLOGY_INVALID");
  const role = roles[0];
  if (typeof role.name !== "string" || !role.name.includes(runId) || JSON.stringify([...(role.permissions ?? [])].sort()) !== JSON.stringify(["mail:read", "mail:send"])) throw mailContractError("IDENTITY_TOPOLOGY_INVALID");
  const sender = users.find((user) => user.purpose === "sender");
  const recipient = users.find((user) => user.purpose === "recipient");
  if (!sender || !recipient) throw mailContractError("IDENTITY_TOPOLOGY_INVALID");
  for (const user of [sender, recipient]) {
    if (user.roleId !== role.id || !includesRunId(user.name, runId) || !includesRunId(user.loginId, runId) || !includesRunId(user.email?.split("@")[0], runId) || !user.name.toLowerCase().includes(user.purpose) || !user.loginId.toLowerCase().includes(user.purpose) || !user.email.toLowerCase().split("@")[0].includes(user.purpose) || user.email.toLowerCase().split("@")[1] !== "moaworks.sinsan.kr") throw mailContractError("IDENTITY_TOPOLOGY_INVALID");
  }
  if (!accounts.every((account) => [sender.id, recipient.id].includes(account.userId)) || new Set(accounts.map((account) => account.userId)).size !== 2) throw mailContractError("IDENTITY_TOPOLOGY_INVALID");
  return { ownership: candidate, role, sender, recipient, accounts };
}

function assertDbEvidence(evidence, context, runId, coreResult, settingsResult) {
  assertNoMailSensitiveKeys(evidence, "mailDbEvidence");
  if (evidence?.existingUserRowChanges !== 0) throw mailContractError("EXISTING_USER_ROW_CHANGED");
  const owned = new Map(context.ownership.records.map((record) => [record.id, record]));
  const evidenceRowIds = new Set((evidence?.rows ?? []).map((row) => row.id));
  if (!Array.isArray(evidence?.rows) || evidence.rows.length !== owned.size || evidenceRowIds.size !== owned.size || evidence.rows.some((row) => row.ownerRunId !== runId || !owned.has(row.id) || row.kind !== owned.get(row.id).kind)) throw mailContractError("DB_EVIDENCE_NOT_RUN_OWNED");
  const audits = evidence.audits ?? [];
  const allowedActors = new Set([context.sender.id, context.recipient.id]);
  if (!Array.isArray(audits) || audits.some((audit) => audit.ownerRunId !== runId || !allowedActors.has(audit.actorId) || !owned.has(audit.targetId) || !AUDIT_TARGET_KINDS[audit.event]?.has(owned.get(audit.targetId).kind))) throw mailContractError("AUDIT_EVIDENCE_NOT_RUN_OWNED");
  const events = new Set(audits.map((audit) => audit.event));
  if (!REQUIRED_AUDITS.every((event) => events.has(event))) throw mailContractError("AUDIT_EVIDENCE_INCOMPLETE");
  const mutations = [...coreResult.mutationOwnership, ...settingsResult.mutationOwnership];
  for (const mutation of mutations) {
    if (!evidenceRowIds.has(mutation.id) || owned.get(mutation.id)?.kind !== mutation.kind) throw mailContractError("MUTATION_DB_AUDIT_MISMATCH");
    const auditEvents = Object.entries(AUDIT_TARGET_KINDS).filter(([, kinds]) => kinds.has(mutation.kind)).map(([event]) => event);
    if (auditEvents.length && !audits.some((audit) => audit.targetId === mutation.id && auditEvents.includes(audit.event))) throw mailContractError("MUTATION_DB_AUDIT_MISMATCH");
  }
  const receipt = evidence.receipt;
  if (!receipt || receipt.mailId !== coreResult.receipt.mailId || receipt.recipientRowId !== coreResult.receipt.recipientRowId || receipt.actorId !== context.recipient.id || receipt.targetId !== coreResult.receipt.targetId || receipt.isRead !== true || receipt.readAtPresent !== true) throw mailContractError("RECEIPT_CONTRACT_INVALID");
}

function sameFingerprint(item) {
  if (!item || typeof item.before?.exists !== "boolean" || typeof item.after?.exists !== "boolean") return false;
  if (!item.before.exists) return item.after.exists === false;
  return item.after.exists === true && typeof item.before.fingerprint === "string" && item.before.fingerprint.length > 0 && item.before.fingerprint === item.after.fingerprint;
}

function assertCleanup(cleanup, context, runId) {
  assertNoMailSensitiveKeys(cleanup, "mailCleanup");
  if (cleanup?.runId !== runId || cleanup.residualOwnedRows !== 0 || cleanup.residualOwnedAudit !== 0 || cleanup.residualStorageObjects !== 0 || cleanup.externalNetworkAttempts !== 0 || cleanup.existingUserRowChanges !== 0 || cleanup.orderVerified !== true || cleanup.sessionsClosed !== true) throw mailContractError("CLEANUP_INCOMPLETE");
  if (!PROTECTED.every((loginId) => sameFingerprint((cleanup.protectedAccounts ?? []).find((item) => item.loginId === loginId)))) throw mailContractError("PROTECTED_ACCOUNT_CHANGED");
  if (!cleanup.providerFingerprint || cleanup.providerFingerprint.before !== cleanup.providerFingerprint.after) throw mailContractError("PROVIDER_FINGERPRINT_CHANGED");
  if (!cleanup.relayFingerprint || cleanup.relayFingerprint.before !== cleanup.relayFingerprint.after) throw mailContractError("RELAY_FINGERPRINT_CHANGED");
  if (!context) return;
  const identities = context.ownership.records.filter((record) => record.kind === "test_role" || record.kind === "test_user");
  if (!Array.isArray(cleanup.disposableIdentities) || cleanup.disposableIdentities.length !== identities.length || cleanup.disposableIdentities.some((item) => item.ownerRunId !== runId || item.active !== false || !["removed", "soft_deleted"].includes(item.disposition) || !identities.some((record) => record.id === item.id && record.kind === item.kind))) throw mailContractError("CLEANUP_INCOMPLETE");
  if (!Array.isArray(cleanup.mailAccounts) || cleanup.mailAccounts.length !== context.accounts.length || cleanup.mailAccounts.some((item) => item.ownerRunId !== runId || item.active !== false || !context.accounts.some((account) => account.id === item.id))) throw mailContractError("CLEANUP_INCOMPLETE");
}

export function assertMailComposite(coreResult, settingsResult) {
  if (coreResult?.status !== "PASS" || settingsResult?.status !== "PASS") throw mailContractError("MAIL_COMPOSITE_INCOMPLETE");
}

export async function runMail({ manifest, runId, browserDriver, dbDriver, evidenceDir }) {
  assertDrivers(browserDriver, dbDriver);
  const area = manifest.areas.find((item) => item.id === "mail");
  if (!area || area.status !== "READY" || area.adapter !== "mail") throw mailContractError("AREA_NOT_READY");
  let context;
  let coreResult;
  let settingsResult;
  let dbEvidence;
  let cleanup;
  let primaryError;
  let closeError;
  let cleanupError;
  try {
    const prepared = await dbDriver.prepareOwnedData({ runId });
    context = assertOwnership(prepared, runId);
    coreResult = validateMailCore(await browserDriver.runMailCore({ runId, origin: manifest.environment.userOrigin, evidenceDir, ownership: context.ownership }), context, runId);
    settingsResult = validateMailSettings(await browserDriver.runMailSettings({ runId, origin: manifest.environment.userOrigin, evidenceDir, ownership: context.ownership }), context, runId);
    assertMailComposite(coreResult, settingsResult);
    dbEvidence = await dbDriver.collectMailEvidence({ runId, ownership: context.ownership });
    assertDbEvidence(dbEvidence, context, runId, coreResult, settingsResult);
  } catch (error) {
    primaryError = error?.code ? error : mailContractError("LIVE_EXECUTION_FAILED");
  } finally {
    try { await browserDriver.close(); } catch { closeError = mailContractError("BROWSER_CLOSE_FAILED"); }
    try {
      cleanup = await dbDriver.cleanupOwnedData({ runId, ownership: context?.ownership });
    } catch { cleanupError = mailContractError("CLEANUP_DRIVER_FAILED"); }
  }
  if (cleanupError) throw cleanupError;
  if (!cleanup) throw primaryError ?? mailContractError("CLEANUP_REQUIRED");
  assertCleanup(cleanup, context, runId);
  if (closeError) throw closeError;
  if (primaryError) throw primaryError;
  return {
    status: "PASS",
    areaId: "mail",
    actions: { core: coreResult.actions, settings: settingsResult.actions },
    screenshots: [...coreResult.screenshots, ...settingsResult.screenshots],
    network: [...coreResult.network, ...settingsResult.network],
    mutationOwnership: { core: coreResult.mutationOwnership, settings: settingsResult.mutationOwnership },
    core: coreResult,
    settings: settingsResult,
    dbAudit: dbEvidence,
    cleanup,
  };
}
