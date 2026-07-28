import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertMailComposite, runMail } from "./adapters/mail.mjs";
import { persistAreaEvidence } from "./orchestrator.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const userWeb = resolve(here, "../..");
const manifest = JSON.parse(await readFile(resolve(here, "manifest.json"), "utf8"));
const runId = "UI046_20260729T020000_mail1";
const senderId = `${runId}_sender_id`;
const recipientId = `${runId}_recipient_id`;
const senderAddress = `${runId.toLowerCase()}-sender@moaworks.sinsan.kr`;
const recipientAddress = `${runId.toLowerCase()}-recipient@moaworks.sinsan.kr`;

const CORE_ACTIONS = ["mail.list", "mail.detail", "mail.draft.save", "mail.draft.reread", "mail.send", "mail.reply", "mail.forward", "mail.recipient.read", "mail.receipt.reread", "mail.star", "mail.tag", "mail.folder.move", "mail.spam", "mail.not_spam", "mail.trash", "mail.restore", "mail.purge"];
const SETTINGS_ACTIONS = ["mail.settings.basic.save", "mail.settings.basic.reread", "mail.signature.create", "mail.signature.default", "mail.signature.reread", "mail.signature.delete", "mail.mailbox.save", "mail.mailbox.reread", "mail.spam.email.create", "mail.spam.email.reread", "mail.spam.domain.create", "mail.spam.domain.reread", "mail.classification.create", "mail.classification.reread", "mail.forwarding.save", "mail.forwarding.reread", "mail.forwarding.disable", "mail.ooo.save", "mail.ooo.reread", "mail.ooo.disable", "mail.external.create", "mail.external.reread", "mail.external.delete", "mail.recent.reread", "mail.recent.delete"];
const AUDITS = ["mail.sent", "mail.draft.saved", "mail.preferences.basic.update", "mail.signature.created", "mail.spam.rule.created", "mail.auto_classification.rule.created", "mail.auto_forward.targets.created", "mail.out_of_office.policy.updated", "mail.external.created"];

function ownershipFixture() {
  const roleId = `${runId}_role`;
  const records = [
    { kind: "test_role", id: roleId, name: `${runId}_mail_role`, permissions: ["mail:read", "mail:send"], ownerRunId: runId },
    { kind: "test_user", id: senderId, purpose: "sender", name: `${runId}_sender`, loginId: `${runId.toLowerCase()}_sender`, email: senderAddress, roleId, ownerRunId: runId },
    { kind: "test_user", id: recipientId, purpose: "recipient", name: `${runId}_recipient`, loginId: `${runId.toLowerCase()}_recipient`, email: recipientAddress, roleId, ownerRunId: runId },
    { kind: "mail_account", id: `${runId}_account_sender`, userId: senderId, ownerRunId: runId },
    { kind: "mail_account", id: `${runId}_account_recipient`, userId: recipientId, ownerRunId: runId },
    ...["draft", "sent", "reply", "forward"].map((suffix) => ({ kind: "mail_message", id: `${runId}_message_${suffix}`, ownerRunId: runId })),
    { kind: "mail_recipient", id: `${runId}_recipient_row`, userId: recipientId, ownerRunId: runId },
    { kind: "mail_attachment", id: `${runId}_attachment`, ownerRunId: runId },
    { kind: "mail_folder", id: `${runId}_folder`, ownerRunId: runId },
    { kind: "mail_tag", id: `${runId}_tag`, ownerRunId: runId },
    { kind: "mail_delivery", id: `${runId}_delivery`, ownerRunId: runId },
    ...["mail_basic_preferences", "mail_signature", "mailbox_policy", "spam_rule_email", "spam_rule_domain", "auto_classification_rule", "auto_forward_target", "out_of_office_policy", "external_account", "recent_recipient"].map((kind) => ({ kind, id: `${runId}_${kind}`, ownerRunId: runId })),
  ];
  return { runId, records };
}

function coreFixture(overrides = {}) {
  return {
    status: "PASS",
    actions: [...CORE_ACTIONS],
    sessions: [{ activeLoginId: `${runId.toLowerCase()}_sender` }, { activeLoginId: `${runId.toLowerCase()}_recipient` }],
    targets: [{ userId: recipientId, address: recipientAddress }, { userId: senderId, address: senderAddress }],
    network: [
      { method: "GET", path: "/api/v1/mail/inbox", status: 200 },
      { method: "GET", path: "/api/v1/mail/sent", status: 200 },
      { method: "GET", path: "/api/v1/mail/drafts", status: 200 },
      { method: "POST", path: "/api/v1/mail/attachments", status: 201 },
      { method: "POST", path: "/api/v1/mail/draft", status: 201 },
      { method: "POST", path: "/api/v1/mail/send", status: 201 },
      { method: "GET", path: `/api/v1/mail/${runId}_message_sent`, status: 200 },
      { method: "POST", path: `/api/v1/mail/${runId}_message_sent/read`, status: 200 },
      { method: "POST", path: `/api/v1/mail/${runId}_message_sent/star`, status: 200 },
      { method: "POST", path: "/api/v1/mail/bulk", status: 200 },
      { method: "GET", path: "/api/v1/mail/folders", status: 200 },
      { method: "POST", path: "/api/v1/mail/folders", status: 201 },
      { method: "GET", path: "/api/v1/mail/tags", status: 200 },
      { method: "POST", path: "/api/v1/mail/tags", status: 201 },
    ],
    mutationOwnership: [
      { kind: "mail_folder", id: `${runId}_folder`, method: "POST", path: "/api/v1/mail/folders" },
      { kind: "mail_tag", id: `${runId}_tag`, method: "POST", path: "/api/v1/mail/tags" },
    ],
    screenshots: ["screenshots/mail-inbox.png", "screenshots/mail-detail.png", "screenshots/mail-receipt.png", "screenshots/mail-state.png"],
    attachment: { id: `${runId}_attachment`, ownerRunId: runId, fileName: `${runId}.txt`, mimeType: "text/plain", sizeBytes: 512, storageKey: `${runId}/attachment.txt` },
    receipt: { mailId: `${runId}_message_sent`, recipientRowId: `${runId}_recipient_row`, actorId: recipientId, targetId: `${runId}_recipient_row`, isRead: true, readAtPresent: true, senderDetailConfirmed: true, recipientMaskingConfirmed: true },
    rereadConfirmed: true,
    ...overrides,
  };
}

function settingsFixture(overrides = {}) {
  return {
    status: "PASS",
    actions: [...SETTINGS_ACTIONS],
    sessions: [{ activeLoginId: `${runId.toLowerCase()}_sender` }],
    targets: [{ userId: recipientId, address: recipientAddress, purpose: "forward-or-ooo" }],
    network: [
      { method: "GET", path: "/api/v1/mail/preferences/basic", status: 200 },
      { method: "PUT", path: "/api/v1/mail/preferences/basic", status: 200 },
      { method: "GET", path: "/api/v1/mail/signatures", status: 200 },
      { method: "POST", path: "/api/v1/mail/signatures", status: 201 },
      { method: "PUT", path: "/api/v1/mail/signatures/preferences", status: 200 },
      { method: "DELETE", path: `/api/v1/mail/signatures/${runId}_mail_signature`, status: 204 },
      { method: "GET", path: "/api/v1/mail/mailbox-settings", status: 200 },
      { method: "PATCH", path: `/api/v1/mail/mailbox-settings/${runId}_mailbox_policy`, status: 200 },
      { method: "GET", path: "/api/v1/mail/spam-settings", status: 200 },
      { method: "POST", path: "/api/v1/mail/spam-settings/rules", status: 201 },
      { method: "POST", path: "/api/v1/mail/spam-settings/rules", status: 201 },
      { method: "GET", path: "/api/v1/mail/settings/auto-classification", status: 200 },
      { method: "POST", path: "/api/v1/mail/settings/auto-classification/rules", status: 201 },
      { method: "GET", path: "/api/v1/mail/settings/auto-forwarding", status: 200 },
      { method: "POST", path: "/api/v1/mail/settings/auto-forwarding/targets", status: 201 },
      { method: "PATCH", path: "/api/v1/mail/settings/auto-forwarding", status: 200 },
      { method: "PATCH", path: "/api/v1/mail/settings/auto-forwarding", status: 200 },
      { method: "GET", path: "/api/v1/mail/settings/out-of-office", status: 200 },
      { method: "PATCH", path: "/api/v1/mail/settings/out-of-office", status: 200 },
      { method: "PATCH", path: "/api/v1/mail/settings/out-of-office", status: 200 },
      { method: "GET", path: "/api/v1/mail/settings/external-accounts", status: 200 },
      { method: "POST", path: "/api/v1/mail/settings/external-accounts", status: 201 },
      { method: "DELETE", path: `/api/v1/mail/settings/external-accounts/${runId}_external_account`, status: 204 },
      { method: "GET", path: "/api/v1/mail/settings/recent-recipients", status: 200 },
      { method: "DELETE", path: `/api/v1/mail/settings/recent-recipients/${runId}_recent_recipient`, status: 204 },
    ],
    mutationOwnership: [
      { kind: "mail_basic_preferences", id: `${runId}_mail_basic_preferences`, method: "PUT", path: "/api/v1/mail/preferences/basic" },
      { kind: "mail_signature", id: `${runId}_mail_signature`, method: "POST", path: "/api/v1/mail/signatures" },
      { kind: "mail_signature", id: `${runId}_mail_signature`, method: "PUT", path: "/api/v1/mail/signatures/preferences" },
      { kind: "spam_rule_email", id: `${runId}_spam_rule_email`, method: "POST", path: "/api/v1/mail/spam-settings/rules" },
      { kind: "spam_rule_domain", id: `${runId}_spam_rule_domain`, method: "POST", path: "/api/v1/mail/spam-settings/rules" },
      { kind: "auto_classification_rule", id: `${runId}_auto_classification_rule`, method: "POST", path: "/api/v1/mail/settings/auto-classification/rules" },
      { kind: "auto_forward_target", id: `${runId}_auto_forward_target`, method: "POST", path: "/api/v1/mail/settings/auto-forwarding/targets" },
      { kind: "auto_forward_target", id: `${runId}_auto_forward_target`, method: "PATCH", path: "/api/v1/mail/settings/auto-forwarding" },
      { kind: "out_of_office_policy", id: `${runId}_out_of_office_policy`, method: "PATCH", path: "/api/v1/mail/settings/out-of-office" },
      { kind: "external_account", id: `${runId}_external_account`, method: "POST", path: "/api/v1/mail/settings/external-accounts" },
      { kind: "recent_recipient", id: `${runId}_recent_recipient`, method: "DELETE", path: `/api/v1/mail/settings/recent-recipients/${runId}_recent_recipient` },
    ],
    screenshots: ["screenshots/mail-settings.png", "screenshots/mail-external.png"],
    externalDummy: { enabled: false, host: `${runId.toLowerCase()}.ui046.invalid`, status: "untested", networkAttempts: 0, credentialConfigured: true },
    rereadConfirmed: true,
    ...overrides,
  };
}

function bulkSettingsFixture(overrides = {}) {
  const fixture = settingsFixture();
  fixture.network = fixture.network.map((item) => item.method === "DELETE" && item.path.startsWith("/api/v1/mail/settings/recent-recipients/")
    ? { method: "POST", path: "/api/v1/mail/settings/recent-recipients/bulk-delete", status: 200 }
    : item);
  fixture.mutationOwnership = fixture.mutationOwnership.map((item) => item.kind === "recent_recipient"
    ? { kind: "recent_recipient", id: `${runId}_recent_recipient`, method: "POST", path: "/api/v1/mail/settings/recent-recipients/bulk-delete" }
    : item);
  return { ...fixture, ...overrides };
}

function dbFixture(ownership, overrides = {}) {
  const ownedIds = ownership.records.map((record) => record.id);
  const kindForEvent = {
    "mail.sent": "mail_message",
    "mail.draft.saved": "mail_message",
    "mail.preferences.basic.update": "mail_basic_preferences",
    "mail.signature.created": "mail_signature",
    "mail.spam.rule.created": "spam_rule_email",
    "mail.auto_classification.rule.created": "auto_classification_rule",
    "mail.auto_forward.targets.created": "auto_forward_target",
    "mail.out_of_office.policy.updated": "out_of_office_policy",
    "mail.external.created": "external_account",
  };
  const targetFor = (event) => event === "mail.sent" ? `${runId}_message_sent` : ownership.records.find((record) => record.kind === kindForEvent[event]).id;
  return {
    rows: ownership.records.map((record) => ({ id: record.id, kind: record.kind, ownerRunId: runId })),
    audits: [...AUDITS.map((event) => ({ event, actorId: senderId, targetId: targetFor(event), ownerRunId: runId })), { event: "mail.spam.rule.created", actorId: senderId, targetId: `${runId}_spam_rule_domain`, ownerRunId: runId }],
    receipt: { mailId: `${runId}_message_sent`, recipientRowId: `${runId}_recipient_row`, actorId: recipientId, targetId: `${runId}_recipient_row`, isRead: true, readAtPresent: true },
    existingUserRowChanges: 0,
    ownedIds,
    ...overrides,
  };
}

function fingerprint(loginId, exists = true) {
  return exists ? { loginId, before: { exists: true, fingerprint: `${loginId}_fp` }, after: { exists: true, fingerprint: `${loginId}_fp` } } : { loginId, before: { exists: false }, after: { exists: false } };
}

function cleanupFixture(ownership, overrides = {}) {
  const identities = ownership.records.filter((record) => record.kind === "test_role" || record.kind === "test_user");
  const accounts = ownership.records.filter((record) => record.kind === "mail_account");
  return {
    runId,
    residualOwnedRows: 0,
    residualOwnedAudit: 0,
    residualStorageObjects: 0,
    externalNetworkAttempts: 0,
    existingUserRowChanges: 0,
    orderVerified: true,
    sessionsClosed: true,
    disposableIdentities: identities.map((record) => ({ kind: record.kind, id: record.id, ownerRunId: runId, active: false, disposition: "soft_deleted" })),
    mailAccounts: accounts.map((record) => ({ id: record.id, ownerRunId: runId, active: false })),
    protectedAccounts: [fingerprint("admin"), fingerprint("cyhuh"), fingerprint("ysla", false)],
    providerFingerprint: { before: "provider_fp", after: "provider_fp" },
    relayFingerprint: { before: "relay_fp", after: "relay_fp" },
    ...overrides,
  };
}

function drivers({ ownership = ownershipFixture(), core = coreFixture(), settings = settingsFixture(), db, cleanup } = {}) {
  let cleanupCalled = false;
  return {
    browserDriver: { async runMailCore() { return core; }, async runMailSettings() { return settings; }, async close() {} },
    dbDriver: {
      async prepareOwnedData() { return ownership; },
      async collectMailEvidence() { return db ?? dbFixture(ownership); },
      async cleanupOwnedData() { cleanupCalled = true; return cleanup ?? cleanupFixture(ownership); },
    },
    cleanupCalled: () => cleanupCalled,
  };
}

async function expectCode(code, setup) {
  await assert.rejects(runMail({ manifest, runId, evidenceDir: "contract-evidence", ...setup }), (error) => String(error?.code ?? "").split(":", 1)[0] === code);
}

const checks = [];
await expectCode("LIVE_INPUT_REQUIRED", {});
checks.push("missing drivers");

const valid = drivers();
const validResult = await runMail({ manifest, runId, browserDriver: valid.browserDriver, dbDriver: valid.dbDriver, evidenceDir: "contract-evidence" });
assert.equal(validResult.status, "PASS");
assert.equal(valid.cleanupCalled(), true);
checks.push("valid composite");

const bulkSettings = bulkSettingsFixture();
const bulkDelete = drivers({ settings: bulkSettings });
const bulkDeleteResult = await runMail({ manifest, runId, browserDriver: bulkDelete.browserDriver, dbDriver: bulkDelete.dbDriver, evidenceDir: "contract-evidence" });
assert.equal(bulkDeleteResult.status, "PASS");
assert.equal(bulkDelete.cleanupCalled(), true);
checks.push("recent recipient bulk delete valid composite");

const badTopologyOwnership = ownershipFixture();
badTopologyOwnership.records = badTopologyOwnership.records.filter((record) => !(record.kind === "test_user" && record.purpose === "recipient"));
const badTopology = drivers({ ownership: badTopologyOwnership });
await expectCode("IDENTITY_TOPOLOGY_INVALID", badTopology);
assert.equal(badTopology.cleanupCalled(), true);
const twoRoleOwnership = ownershipFixture();
twoRoleOwnership.records.push({ ...twoRoleOwnership.records.find((record) => record.kind === "test_role"), id: `${runId}_role_2` });
await expectCode("IDENTITY_TOPOLOGY_INVALID", drivers({ ownership: twoRoleOwnership }));
checks.push("identity topology fail closed");

for (const [code, core] of [
  ["PROTECTED_ACCOUNT_SESSION_REJECTED", coreFixture({ sessions: [{ activeLoginId: "admin" }] })],
  ["PROTECTED_ACCOUNT_TARGET_REJECTED", coreFixture({ targets: [{ userId: recipientId, address: "admin@ui046.invalid" }] })],
  ["MAIL_TARGET_NOT_INTERNAL", coreFixture({ targets: [{ userId: "foreign", address: "outside@example.com" }] })],
]) { const setup = drivers({ core }); await expectCode(code, setup); assert.equal(setup.cleanupCalled(), true); }
checks.push("session and recipient boundary");

for (const [code, network] of [
  ["NETWORK_NOT_SAME_ORIGIN_RELATIVE", [{ method: "GET", path: "https://internal/api/v1/mail", status: 200 }]],
  ["NETWORK_QUERY_REJECTED", [{ method: "GET", path: "/api/v1/mail?page=1", status: 200 }]],
  ["NETWORK_EVIDENCE_INVALID", [{ method: "GET", path: "/api/v1/mail", status: 500 }]],
]) { await expectCode(code, drivers({ core: coreFixture({ network }) })); }
checks.push("network boundaries");

const extraNetworkField = coreFixture().network.map((item, index) => index === 0 ? { ...item, ownershipId: `${runId}_message_sent` } : item);
await expectCode("NETWORK_FIELDS_INVALID", drivers({ core: coreFixture({ network: extraNetworkField }) }));
const missingNetworkField = coreFixture().network.map((item, index) => index === 0 ? { method: item.method, path: item.path } : item);
await expectCode("NETWORK_FIELDS_INVALID", drivers({ core: coreFixture({ network: missingNetworkField }) }));
checks.push("network exact three fields");

await expectCode("CORE_NETWORK_FAMILY_INCOMPLETE", drivers({ core: coreFixture({ network: coreFixture().network.filter((item) => item.path !== "/api/v1/mail/inbox") }) }));
await expectCode("SETTINGS_NETWORK_FAMILY_INCOMPLETE", drivers({ settings: settingsFixture({ network: settingsFixture().network.filter((item) => item.path !== "/api/v1/mail/preferences/basic") }) }));
checks.push("required route families");

await expectCode("CORE_NETWORK_MUTATION_INCOMPLETE", drivers({ core: coreFixture({ network: coreFixture().network.filter((item) => !(item.method === "POST" && item.path === "/api/v1/mail/folders")) }) }));
await expectCode("CORE_NETWORK_MUTATION_INCOMPLETE", drivers({ core: coreFixture({ network: coreFixture().network.filter((item) => !(item.method === "POST" && item.path === "/api/v1/mail/tags")) }) }));
checks.push("core folder and tag mutations");

await expectCode("SETTINGS_NETWORK_MUTATION_INCOMPLETE", drivers({ settings: settingsFixture({ network: settingsFixture().network.filter((item) => item.method === "GET") }) }));
for (const missing of [
  (item) => item.method === "PUT" && item.path === "/api/v1/mail/signatures/preferences",
  (item) => item.method === "DELETE" && item.path.startsWith("/api/v1/mail/signatures/"),
  (item) => item.method === "PATCH" && item.path.startsWith("/api/v1/mail/mailbox-settings/"),
  (item) => item.method === "DELETE" && item.path.startsWith("/api/v1/mail/settings/external-accounts/"),
  (item) => item.method === "DELETE" && item.path.startsWith("/api/v1/mail/settings/recent-recipients/"),
]) {
  await expectCode("SETTINGS_NETWORK_MUTATION_INCOMPLETE", drivers({ settings: settingsFixture({ network: settingsFixture().network.filter((item) => !missing(item)) }) }));
}
checks.push("settings read and mutation combinations");

for (const [path, method] of [
  ["/api/v1/mail/spam-settings/rules", "POST"],
  ["/api/v1/mail/settings/auto-forwarding", "PATCH"],
  ["/api/v1/mail/settings/out-of-office", "PATCH"],
]) {
  let retained = false;
  const network = settingsFixture().network.filter((item) => {
    if (item.path !== path || item.method !== method) return true;
    if (!retained) { retained = true; return true; }
    return false;
  });
  await expectCode("SETTINGS_NETWORK_CALL_COUNT_INCOMPLETE", drivers({ settings: settingsFixture({ network }) }));
}
checks.push("settings mutation call counts");

const foreignSettingsId = settingsFixture().network.map((item) => item.path.startsWith("/api/v1/mail/signatures/") && item.method === "DELETE" ? { ...item, path: "/api/v1/mail/signatures/foreign" } : item);
await expectCode("NETWORK_OWNERSHIP_MISMATCH", drivers({ settings: settingsFixture({ network: foreignSettingsId }) }));
const foreignCoreId = coreFixture().network.map((item) => item.method === "GET" && item.path === `/api/v1/mail/${runId}_message_sent` ? { ...item, path: "/api/v1/mail/foreign" } : item);
await expectCode("NETWORK_OWNERSHIP_MISMATCH", drivers({ core: coreFixture({ network: foreignCoreId }) }));
checks.push("dynamic route ownership");

const foreignRecentPath = settingsFixture().network.map((item) => item.method === "DELETE" && item.path.startsWith("/api/v1/mail/settings/recent-recipients/") ? { ...item, path: "/api/v1/mail/settings/recent-recipients/foreign" } : item);
await expectCode("NETWORK_OWNERSHIP_MISMATCH", drivers({ settings: settingsFixture({ network: foreignRecentPath }) }));
const bulkForeign = bulkSettingsFixture();
bulkForeign.mutationOwnership = bulkForeign.mutationOwnership.map((item) => item.kind === "recent_recipient" ? { ...item, id: "foreign" } : item);
await expectCode("MUTATION_OWNERSHIP_MISMATCH", drivers({ settings: bulkForeign }));
checks.push("recent recipient single and bulk ownership");

await expectCode("MUTATION_OWNERSHIP_INCOMPLETE", drivers({ core: coreFixture({ mutationOwnership: [] }) }));
await expectCode("MUTATION_OWNERSHIP_INCOMPLETE", drivers({ settings: settingsFixture({ mutationOwnership: settingsFixture().mutationOwnership.slice(1) }) }));
const foreignMutationOwnership = settingsFixture().mutationOwnership.map((item, index) => index === 0 ? { ...item, id: "foreign" } : item);
await expectCode("MUTATION_OWNERSHIP_MISMATCH", drivers({ settings: settingsFixture({ mutationOwnership: foreignMutationOwnership }) }));
const unobservedMutationOwnership = settingsFixture().mutationOwnership.map((item, index) => index === 0 ? { ...item, method: "POST", path: "/api/v1/mail/preferences/basic" } : item);
await expectCode("MUTATION_OWNERSHIP_NETWORK_MISMATCH", drivers({ settings: settingsFixture({ mutationOwnership: unobservedMutationOwnership }) }));
const extraMutationField = coreFixture().mutationOwnership.map((item, index) => index === 0 ? { ...item, ownerRunId: runId } : item);
await expectCode("MUTATION_OWNERSHIP_FIELDS_INVALID", drivers({ core: coreFixture({ mutationOwnership: extraMutationField }) }));
checks.push("separate mutation ownership contract");

await expectCode("SCREENSHOT_EVIDENCE_INCOMPLETE", drivers({ core: coreFixture({ screenshots: coreFixture().screenshots.slice(1) }) }));
await expectCode("SCREENSHOT_PATH_REJECTED", drivers({ settings: settingsFixture({ screenshots: ["../outside.png", "screenshots/mail-external.png"] }) }));
checks.push("six screenshot paths");

const missingCoreAction = drivers({ core: coreFixture({ actions: CORE_ACTIONS.slice(1) }) });
await expectCode("CORE_ACTION_EVIDENCE_INCOMPLETE", missingCoreAction);
assert.equal(missingCoreAction.cleanupCalled(), true);
const missingSettingsAction = drivers({ settings: settingsFixture({ actions: SETTINGS_ACTIONS.slice(1) }) });
await expectCode("SETTINGS_ACTION_EVIDENCE_INCOMPLETE", missingSettingsAction);
assert.equal(missingSettingsAction.cleanupCalled(), true);
checks.push("core and settings action completeness");

for (const attachment of [
  { ...coreFixture().attachment, sizeBytes: 1025 },
  { ...coreFixture().attachment, fileName: `${runId}.pdf`, mimeType: "application/pdf" },
  { ...coreFixture().attachment, id: "foreign", ownerRunId: "OTHER", storageKey: "foreign/a.txt" },
]) { await expectCode("ATTACHMENT_CONTRACT_INVALID", drivers({ core: coreFixture({ attachment }) })); }
checks.push("attachment boundaries");

for (const externalDummy of [
  { ...settingsFixture().externalDummy, enabled: true },
  { ...settingsFixture().externalDummy, host: "mail.example.com" },
  { ...settingsFixture().externalDummy, status: "tested" },
  { ...settingsFixture().externalDummy, networkAttempts: 1 },
]) { await expectCode("EXTERNAL_DUMMY_CONTRACT_INVALID", drivers({ settings: settingsFixture({ externalDummy }) })); }
checks.push("external dummy no-connect boundary");

await expectCode("RECEIPT_CONTRACT_INVALID", drivers({ core: coreFixture({ receipt: { ...coreFixture().receipt, actorId: senderId } }) }));
await expectCode("RECIPIENT_MASKING_REQUIRED", drivers({ core: coreFixture({ receipt: { ...coreFixture().receipt, recipientMaskingConfirmed: false } }) }));
checks.push("receipt actor target and masking");

await expectCode("EXISTING_USER_ROW_CHANGED", drivers({ db: dbFixture(ownershipFixture(), { existingUserRowChanges: 1 }) }));
checks.push("existing user rows unchanged");

await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ db: dbFixture(ownershipFixture(), { audits: dbFixture(ownershipFixture()).audits.slice(1) }) }));
await expectCode("AUDIT_EVIDENCE_NOT_RUN_OWNED", drivers({ db: dbFixture(ownershipFixture(), { audits: dbFixture(ownershipFixture()).audits.map((item, index) => index ? item : { ...item, actorId: "foreign" } ) }) }));
checks.push("audit completeness and ownership");

const missingDomainAudit = dbFixture(ownershipFixture()).audits.filter((item) => item.targetId !== `${runId}_spam_rule_domain`);
await expectCode("MUTATION_DB_AUDIT_MISMATCH", drivers({ db: dbFixture(ownershipFixture(), { audits: missingDomainAudit }) }));
checks.push("mutation ownership DB and audit linkage");

await expectCode("SENSITIVE_FIELD_REJECTED", drivers({ settings: settingsFixture({ passwordHash: true }) }));
checks.push("sensitive fields");

await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: cleanupFixture(ownershipFixture(), { residualOwnedRows: 1 }) }));
await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: cleanupFixture(ownershipFixture(), { disposableIdentities: [] }) }));
await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: cleanupFixture(ownershipFixture(), { externalNetworkAttempts: 1 }) }));
const activeIdentity = cleanupFixture(ownershipFixture());
activeIdentity.disposableIdentities[0].active = true;
await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: activeIdentity }));
const changedProtected = cleanupFixture(ownershipFixture());
changedProtected.protectedAccounts[0].after.fingerprint = "changed";
await expectCode("PROTECTED_ACCOUNT_CHANGED", drivers({ cleanup: changedProtected }));
await expectCode("PROVIDER_FINGERPRINT_CHANGED", drivers({ cleanup: cleanupFixture(ownershipFixture(), { providerFingerprint: { before: "a", after: "b" } }) }));
await expectCode("RELAY_FINGERPRINT_CHANGED", drivers({ cleanup: cleanupFixture(ownershipFixture(), { relayFingerprint: { before: "a", after: "b" } }) }));
checks.push("cleanup and provider boundaries");

const foreignOwnership = ownershipFixture();
foreignOwnership.records[0].ownerRunId = "OTHER_RUN";
const foreignSetup = drivers({ ownership: foreignOwnership });
await expectCode("OWNERSHIP_CONTRACT_INVALID", foreignSetup);
assert.equal(foreignSetup.cleanupCalled(), true);
checks.push("foreign ownership fail closed");

assert.throws(() => assertMailComposite({ status: "PASS" }, { status: "FAIL" }), (error) => error.code === "MAIL_COMPOSITE_INCOMPLETE");
assert.throws(() => assertMailComposite({ status: "FAIL" }, { status: "PASS" }), (error) => error.code === "MAIL_COMPOSITE_INCOMPLETE");
checks.push("composite partial pass rejected");

const cli = spawnSync(process.execPath, [resolve(here, "orchestrator.mjs"), "execute-area", "--area=mail", `--run-id=${runId}`], { cwd: userWeb, encoding: "utf8", shell: false, windowsHide: true });
assert.equal(cli.status, 2);
assert.equal(cli.stdout, "");
assert.deepEqual(JSON.parse(cli.stderr), { status: "LIVE_INPUT_REQUIRED", errorCode: "LIVE_INPUT_REQUIRED" });
checks.push("mail execute-area reaches live input guard");

const evidenceDirectory = await mkdtemp(resolve(tmpdir(), "ui046-mail-evidence-"));
const missingEvidenceDirectory = await mkdtemp(resolve(tmpdir(), "ui046-mail-missing-"));
try {
  for (const directory of [evidenceDirectory, missingEvidenceDirectory]) await mkdir(resolve(directory, "screenshots"), { recursive: true });
  for (const screenshot of validResult.screenshots) await writeFile(resolve(evidenceDirectory, screenshot), "png", "utf8");
  for (const screenshot of validResult.screenshots.slice(1)) await writeFile(resolve(missingEvidenceDirectory, screenshot), "png", "utf8");
  await persistAreaEvidence({ result: validResult, directory: evidenceDirectory, selectedAreaId: "mail", selectedRunId: runId });
  const evidenceFiles = new Set(await readdir(evidenceDirectory));
  for (const name of manifest.evidence.requiredFiles) {
    assert.equal(evidenceFiles.has(name), true);
    await access(resolve(evidenceDirectory, name));
  }
  const persistedNetwork = JSON.parse(await readFile(resolve(evidenceDirectory, "network.json"), "utf8"));
  assert.equal(persistedNetwork.every((item) => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(["method", "path", "status"])), true);
  assert.equal(persistedNetwork.filter((item) => item.method === "POST" && item.path === "/api/v1/mail/spam-settings/rules").length, 2);
  assert.equal(persistedNetwork.filter((item) => item.method === "PATCH" && item.path === "/api/v1/mail/settings/auto-forwarding").length, 2);
  assert.equal(persistedNetwork.filter((item) => item.method === "PATCH" && item.path === "/api/v1/mail/settings/out-of-office").length, 2);
  const persistedResult = JSON.parse(await readFile(resolve(evidenceDirectory, "result.json"), "utf8"));
  assert.deepEqual(persistedResult.mutationOwnership, validResult.mutationOwnership);
  await assert.rejects(persistAreaEvidence({ result: validResult, directory: missingEvidenceDirectory, selectedAreaId: "mail", selectedRunId: runId }), (error) => error?.code === "SCREENSHOT_EVIDENCE_MISSING");
} finally {
  await rm(evidenceDirectory, { recursive: true, force: true });
  await rm(missingEvidenceDirectory, { recursive: true, force: true });
}
checks.push("six evidence files and screenshot existence");

console.log(JSON.stringify({ status: "PASS", passed: checks.length, total: checks.length, checks }));
