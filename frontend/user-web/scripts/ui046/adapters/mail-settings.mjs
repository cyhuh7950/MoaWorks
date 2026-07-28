import { assertInternalTargets, assertMailNetwork, assertMailSessions, assertMutationOwnership, assertNoMailSensitiveKeys, assertScreenshotSet, mailContractError } from "./mail-core.mjs";

export const SETTINGS_ACTIONS = ["mail.settings.basic.save", "mail.settings.basic.reread", "mail.signature.create", "mail.signature.default", "mail.signature.reread", "mail.signature.delete", "mail.mailbox.save", "mail.mailbox.reread", "mail.spam.email.create", "mail.spam.email.reread", "mail.spam.domain.create", "mail.spam.domain.reread", "mail.classification.create", "mail.classification.reread", "mail.forwarding.save", "mail.forwarding.reread", "mail.forwarding.disable", "mail.ooo.save", "mail.ooo.reread", "mail.ooo.disable", "mail.external.create", "mail.external.reread", "mail.external.delete", "mail.recent.reread", "mail.recent.delete"];
const SETTINGS_SCREENSHOTS = ["screenshots/mail-settings.png", "screenshots/mail-external.png"];

function has2xx(records, methods, path) {
  return records.some((record) => methods.includes(record.method) && record.path === path && record.status >= 200 && record.status < 300);
}

function assertSettingsNetworkFamilies(records) {
  const families = [
    [["GET", "PUT"], "/api/v1/mail/preferences/basic"],
    [["GET", "POST", "PUT", "DELETE"], "/api/v1/mail/signatures"],
    [["GET", "PATCH"], "/api/v1/mail/mailbox-settings"],
    [["GET", "PATCH", "POST", "DELETE"], "/api/v1/mail/spam-settings"],
    [["GET", "PATCH", "POST", "DELETE"], "/api/v1/mail/settings/auto-classification"],
    [["GET", "PATCH", "POST", "DELETE"], "/api/v1/mail/settings/auto-forwarding"],
    [["GET", "PATCH"], "/api/v1/mail/settings/out-of-office"],
    [["GET", "POST", "DELETE"], "/api/v1/mail/settings/external-accounts"],
    [["GET", "DELETE", "POST"], "/api/v1/mail/settings/recent-recipients"],
  ];
  if (families.some(([methods, path]) => !has2xx(records, methods, path))) throw mailContractError("SETTINGS_NETWORK_FAMILY_INCOMPLETE");
}

function assertSettingsMutationProof(records, context) {
  const successful = (method, path) => records.filter((record) => record.method === method && record.path === path && record.status >= 200 && record.status < 300);
  const owned = new Map(context.ownership.records.map((record) => [record.kind, record.id]));
  const reads = [
    "/api/v1/mail/preferences/basic",
    "/api/v1/mail/signatures",
    "/api/v1/mail/mailbox-settings",
    "/api/v1/mail/spam-settings",
    "/api/v1/mail/settings/auto-classification",
    "/api/v1/mail/settings/auto-forwarding",
    "/api/v1/mail/settings/out-of-office",
    "/api/v1/mail/settings/external-accounts",
    "/api/v1/mail/settings/recent-recipients",
  ];
  if (reads.some((path) => successful("GET", path).length === 0)) throw mailContractError("SETTINGS_NETWORK_FAMILY_INCOMPLETE");

  const signatureDelete = records.find((record) => record.method === "DELETE" && /^\/api\/v1\/mail\/signatures\/[^/]+$/.test(record.path) && record.status >= 200 && record.status < 300);
  const mailboxPatch = records.find((record) => record.method === "PATCH" && /^\/api\/v1\/mail\/mailbox-settings\/[^/]+$/.test(record.path) && record.status >= 200 && record.status < 300);
  const externalDelete = records.find((record) => record.method === "DELETE" && /^\/api\/v1\/mail\/settings\/external-accounts\/[^/]+$/.test(record.path) && record.status >= 200 && record.status < 300);
  const recentDelete = records.find((record) => record.method === "DELETE" && /^\/api\/v1\/mail\/settings\/recent-recipients\/[^/]+$/.test(record.path) && record.status >= 200 && record.status < 300);
  const recentBulkDelete = successful("POST", "/api/v1/mail/settings/recent-recipients/bulk-delete")[0];
  const requiredMutations = [
    successful("PUT", "/api/v1/mail/preferences/basic")[0],
    successful("POST", "/api/v1/mail/signatures")[0],
    successful("PUT", "/api/v1/mail/signatures/preferences")[0],
    signatureDelete,
    mailboxPatch,
    successful("POST", "/api/v1/mail/settings/auto-classification/rules")[0],
    successful("POST", "/api/v1/mail/settings/auto-forwarding/targets")[0],
    successful("POST", "/api/v1/mail/settings/external-accounts")[0],
    externalDelete,
    recentDelete ?? recentBulkDelete,
  ];
  if (requiredMutations.some((record) => !record)) throw mailContractError("SETTINGS_NETWORK_MUTATION_INCOMPLETE");

  const spamPosts = successful("POST", "/api/v1/mail/spam-settings/rules");
  const forwardingPatches = successful("PATCH", "/api/v1/mail/settings/auto-forwarding");
  const outOfOfficePatches = successful("PATCH", "/api/v1/mail/settings/out-of-office");
  if (spamPosts.length < 2 || forwardingPatches.length < 2 || outOfOfficePatches.length < 2) throw mailContractError("SETTINGS_NETWORK_CALL_COUNT_INCOMPLETE");

  const dynamicOwnership = [
    [signatureDelete, "mail_signature", 5],
    [mailboxPatch, "mailbox_policy", 5],
    [externalDelete, "external_account", 6],
    [recentDelete, "recent_recipient", 6],
  ];
  for (const [record, kind, idIndex] of dynamicOwnership) {
    if (record && record.path.split("/")[idIndex] !== owned.get(kind)) throw mailContractError("NETWORK_OWNERSHIP_MISMATCH");
  }
  return recentDelete
    ? { kind: "recent_recipient", method: "DELETE", path: recentDelete.path }
    : { kind: "recent_recipient", method: "POST", path: recentBulkDelete.path };
}

export function validateMailSettings(result, context, runId) {
  assertNoMailSensitiveKeys(result, "mailSettings");
  const actions = new Set(result?.actions ?? []);
  if (!SETTINGS_ACTIONS.every((action) => actions.has(action))) throw mailContractError("SETTINGS_ACTION_EVIDENCE_INCOMPLETE");
  assertMailSessions(result.sessions, context);
  assertInternalTargets(result.targets, context);
  assertMailNetwork(result.network);
  assertSettingsNetworkFamilies(result.network);
  const recentMutationRequirement = assertSettingsMutationProof(result.network, context);
  assertMutationOwnership(result.mutationOwnership, result.network, context, [
    { kind: "mail_basic_preferences", method: "PUT", path: "/api/v1/mail/preferences/basic" },
    { kind: "mail_signature", method: "POST", path: "/api/v1/mail/signatures" },
    { kind: "mail_signature", method: "PUT", path: "/api/v1/mail/signatures/preferences" },
    { kind: "spam_rule_email", method: "POST", path: "/api/v1/mail/spam-settings/rules" },
    { kind: "spam_rule_domain", method: "POST", path: "/api/v1/mail/spam-settings/rules" },
    { kind: "auto_classification_rule", method: "POST", path: "/api/v1/mail/settings/auto-classification/rules" },
    { kind: "auto_forward_target", method: "POST", path: "/api/v1/mail/settings/auto-forwarding/targets" },
    { kind: "auto_forward_target", method: "PATCH", path: "/api/v1/mail/settings/auto-forwarding" },
    { kind: "out_of_office_policy", method: "PATCH", path: "/api/v1/mail/settings/out-of-office" },
    { kind: "external_account", method: "POST", path: "/api/v1/mail/settings/external-accounts" },
    recentMutationRequirement,
  ]);
  assertScreenshotSet(result.screenshots, SETTINGS_SCREENSHOTS);
  const dummy = result.externalDummy;
  const dummyKeys = Object.keys(dummy ?? {}).sort();
  if (!dummy || JSON.stringify(dummyKeys) !== JSON.stringify(["credentialConfigured", "enabled", "host", "networkAttempts", "status"]) || dummy.enabled !== false || typeof dummy.host !== "string" || !dummy.host.toLowerCase().includes(runId.toLowerCase()) || !dummy.host.toLowerCase().endsWith(".invalid") || dummy.status !== "untested" || dummy.networkAttempts !== 0 || dummy.credentialConfigured !== true) throw mailContractError("EXTERNAL_DUMMY_CONTRACT_INVALID");
  if (result.rereadConfirmed !== true) throw mailContractError("SETTINGS_REREAD_REQUIRED");
  return { status: result.status === "PASS" ? "PASS" : "FAIL", actions: result.actions, network: result.network, mutationOwnership: result.mutationOwnership, screenshots: result.screenshots, externalDummy: dummy };
}
