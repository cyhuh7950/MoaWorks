import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runApproval } from "./adapters/approval.mjs";
import { persistAreaEvidence } from "./orchestrator.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(here, "manifest.json"), "utf8"));
const runId = "UI046_20260729T120000_appr1";
const companyId = `${runId}_company`;
const roleId = `${runId}_role`;
const ids = {
  author: `${runId}_author`, approver: `${runId}_approver`, delegate: `${runId}_delegate`,
  approveDocument: `${runId}_document_approve`, rejectDocument: `${runId}_document_reject`, withdrawDocument: `${runId}_document_withdraw`,
  approveLine: `${runId}_line_approve`, rejectLine: `${runId}_line_reject`, withdrawLine: `${runId}_line_withdraw`,
  attachment: `${runId}_attachment`, upload: `${runId}_upload`, preference: `${runId}_preference`, delegation: `${runId}_delegation`,
  notification: `${runId}_notification`, notificationState: `${runId}_notification_state`, monitoring: `${runId}_monitoring`, storageObject: `${runId}_storage_object`,
};

const DOCUMENT_ACTIONS = ["approval.list", "approval.detail", "approval.audit", "approval.approvers", "approval.attachment.upload", "approval.attachment.download", "approval.draft.save", "approval.draft.reread", "approval.submit", "approval.approve", "approval.reject", "approval.withdraw", "approval.redraft", "approval.action.reread"];
const SETTING_ACTIONS = ["approval.settings.basic.get", "approval.settings.basic.save", "approval.settings.basic.reread"];
const DELEGATION_ACTIONS = ["approval.delegations.list", "approval.delegation.create", "approval.delegation.reread", "approval.delegation.update", "approval.delegation.delete", "approval.delegation.soft_delete.reread"];
const AUDITS = ["approval.created", "approval.submitted", "approval.approved", "approval.rejected", "approval.withdrawn", "approval.redrafted", "approval.settings.updated", "approval.delegation.created", "approval.delegation.updated", "approval.delegation.deleted"];
const SCREENSHOTS = ["approval-list-detail.png", "approval-compose.png", "approval-actions.png", "approval-basic-settings.png", "approval-delegations.png"].map((name) => `screenshots/${name}`);

function clone(value) { return structuredClone(value); }

function ownershipFixture() {
  const records = [
    { kind: "test_role", id: roleId, name: `${runId}_approval_role`, permissions: ["approval:read", "approval:create", "approval:submit", "approval:act", "approval:withdraw", "approval:rework"], companyId, ownerRunId: runId },
    ...["author", "approver", "delegate"].map((purpose) => ({ kind: "test_user", id: ids[purpose], purpose, name: `${runId}_${purpose}`, loginId: `${runId.toLowerCase()}_${purpose}`, email: `${runId.toLowerCase()}_${purpose}@moaworks.sinsan.kr`, roleId, companyId, active: true, ownerRunId: runId })),
    ...["approve", "reject", "withdraw"].map((purpose) => ({ kind: "approval_document", id: ids[`${purpose}Document`], purpose, authorId: ids.author, companyId, ownerRunId: runId })),
    ...["approve", "reject", "withdraw"].map((purpose) => ({ kind: "approval_line", id: ids[`${purpose}Line`], documentId: ids[`${purpose}Document`], approverId: ids.approver, ownerRunId: runId })),
    { kind: "approval_attachment", id: ids.attachment, documentId: ids.approveDocument, ownerRunId: runId },
    { kind: "approval_upload", id: ids.upload, attachmentId: ids.attachment, ownerRunId: runId },
    { kind: "approval_basic_preference", id: ids.preference, userId: ids.author, companyId, ownerRunId: runId },
    { kind: "approval_delegation", id: ids.delegation, ownerId: ids.approver, delegateId: ids.delegate, companyId, ownerRunId: runId },
    { kind: "notification", id: ids.notification, ownerRunId: runId },
    { kind: "notification_state", id: ids.notificationState, ownerRunId: runId },
    { kind: "monitoring_event", id: ids.monitoring, ownerRunId: runId },
    { kind: "storage_object", id: ids.storageObject, ownerRunId: runId },
  ];
  return { runId, companyId, records };
}

function documentsFixture(overrides = {}) {
  return {
    status: "PASS",
    sessions: [{ activeLoginId: `${runId.toLowerCase()}_author` }, { activeLoginId: `${runId.toLowerCase()}_approver` }],
    actions: [...DOCUMENT_ACTIONS],
    documents: [
      { purpose: "approve", id: ids.approveDocument, lineId: ids.approveLine, authorId: ids.author, approverId: ids.approver, title: `${runId}_approve`, finalStatus: "approved", lineFinalStatus: "approved", draftReread: true, submittedReread: true, actionReread: true, historyReread: true },
      { purpose: "reject", id: ids.rejectDocument, lineId: ids.rejectLine, authorId: ids.author, approverId: ids.approver, title: `${runId}_reject`, finalStatus: "draft", lineFinalStatus: "pending", draftReread: true, submittedReread: true, actionReread: true, redraftReread: true, historyReread: true },
      { purpose: "withdraw", id: ids.withdrawDocument, lineId: ids.withdrawLine, authorId: ids.author, approverId: ids.approver, title: `${runId}_withdraw`, finalStatus: "draft", lineFinalStatus: "pending", draftReread: true, submittedReread: true, actionReread: true, redraftReread: true, historyReread: true },
    ],
    attachment: { id: ids.attachment, uploadId: ids.upload, documentId: ids.approveDocument, ownerRunId: runId, fileName: `${runId}.txt`, mimeType: "text/plain", sizeBytes: 512, downloadConfirmed: true },
    network: [
      { method: "GET", path: "/api/v1/approvals", status: 200 },
      { method: "GET", path: `/api/v1/approvals/${ids.approveDocument}`, status: 200 },
      { method: "GET", path: `/api/v1/approvals/${ids.approveDocument}/audit`, status: 200 },
      { method: "GET", path: "/api/v1/approvals/approvers", status: 200 },
      { method: "POST", path: "/api/v1/approvals/attachments", status: 201 },
      { method: "GET", path: `/api/v1/approvals/attachments/${ids.attachment}`, status: 200 },
      ...[ids.approveDocument, ids.rejectDocument, ids.withdrawDocument].flatMap((id) => [{ method: "POST", path: "/api/v1/approvals", status: 201 }, { method: "PATCH", path: `/api/v1/approvals/${id}`, status: 200 }, { method: "POST", path: `/api/v1/approvals/${id}/submit`, status: 200 }]),
      { method: "POST", path: `/api/v1/approvals/${ids.approveDocument}/approve`, status: 200 },
      { method: "POST", path: `/api/v1/approvals/${ids.rejectDocument}/reject`, status: 200 },
      { method: "POST", path: `/api/v1/approvals/${ids.rejectDocument}/redraft`, status: 200 },
      { method: "POST", path: `/api/v1/approvals/${ids.withdrawDocument}/withdraw`, status: 200 },
      { method: "POST", path: `/api/v1/approvals/${ids.withdrawDocument}/redraft`, status: 200 },
    ],
    mutationOwnership: [
      { kind: "approval_attachment", id: ids.attachment, method: "POST", path: "/api/v1/approvals/attachments" },
      ...["approve", "reject", "withdraw"].flatMap((purpose) => {
        const id = ids[`${purpose}Document`];
        return [{ kind: "approval_document", id, method: "POST", path: "/api/v1/approvals" }, { kind: "approval_document", id, method: "PATCH", path: `/api/v1/approvals/${id}` }, { kind: "approval_document", id, method: "POST", path: `/api/v1/approvals/${id}/submit` }];
      }),
      { kind: "approval_document", id: ids.approveDocument, method: "POST", path: `/api/v1/approvals/${ids.approveDocument}/approve` },
      { kind: "approval_document", id: ids.rejectDocument, method: "POST", path: `/api/v1/approvals/${ids.rejectDocument}/reject` },
      { kind: "approval_document", id: ids.rejectDocument, method: "POST", path: `/api/v1/approvals/${ids.rejectDocument}/redraft` },
      { kind: "approval_document", id: ids.withdrawDocument, method: "POST", path: `/api/v1/approvals/${ids.withdrawDocument}/withdraw` },
      { kind: "approval_document", id: ids.withdrawDocument, method: "POST", path: `/api/v1/approvals/${ids.withdrawDocument}/redraft` },
    ],
    screenshots: SCREENSHOTS.slice(0, 3),
    ...overrides,
  };
}

function settingsFixture(overrides = {}) {
  return {
    status: "PASS", session: { activeLoginId: `${runId.toLowerCase()}_author` }, actions: [...SETTING_ACTIONS],
    preference: { id: ids.preference, userId: ids.author, companyId, beforeVersion: 2, afterVersion: 3, rereadVersion: 3, beforeAttachmentImageDisplay: "inline", afterAttachmentImageDisplay: "attachment", rereadAttachmentImageDisplay: "attachment", hasSignature: false },
    network: [{ method: "GET", path: "/api/v1/approvals/settings/basic", status: 200 }, { method: "PUT", path: "/api/v1/approvals/settings/basic", status: 200 }, { method: "GET", path: "/api/v1/approvals/settings/basic", status: 200 }],
    mutationOwnership: [{ kind: "approval_basic_preference", id: ids.preference, method: "PUT", path: "/api/v1/approvals/settings/basic" }],
    screenshots: [SCREENSHOTS[3]], ...overrides,
  };
}

function delegationsFixture(overrides = {}) {
  return {
    status: "PASS", session: { activeLoginId: `${runId.toLowerCase()}_approver` }, actions: [...DELEGATION_ACTIONS],
    delegation: { id: ids.delegation, ownerId: ids.approver, delegateId: ids.delegate, companyId, includesCurrentSeoulDate: true, reasonIncludesRunId: true, versionBeforeUpdate: 1, versionAfterUpdate: 2, rereadVersion: 2, deleteExpectedVersion: 2, softDeleted: true, absentAfterDelete: true },
    network: [{ method: "GET", path: "/api/v1/approvals/delegations", status: 200 }, { method: "POST", path: "/api/v1/approvals/delegations", status: 201 }, { method: "GET", path: "/api/v1/approvals/delegations", status: 200 }, { method: "PATCH", path: `/api/v1/approvals/delegations/${ids.delegation}`, status: 200 }, { method: "GET", path: "/api/v1/approvals/delegations", status: 200 }, { method: "DELETE", path: `/api/v1/approvals/delegations/${ids.delegation}`, status: 204 }, { method: "GET", path: "/api/v1/approvals/delegations", status: 200 }],
    mutationOwnership: [{ kind: "approval_delegation", id: ids.delegation, method: "POST", path: "/api/v1/approvals/delegations" }, { kind: "approval_delegation", id: ids.delegation, method: "PATCH", path: `/api/v1/approvals/delegations/${ids.delegation}` }, { kind: "approval_delegation", id: ids.delegation, method: "DELETE", path: `/api/v1/approvals/delegations/${ids.delegation}` }],
    screenshots: [SCREENSHOTS[4]], ...overrides,
  };
}

function dbFixture(ownership, overrides = {}) {
  const auditTarget = {
    "approval.created": ids.approveDocument, "approval.submitted": ids.approveDocument, "approval.approved": ids.approveDocument,
    "approval.rejected": ids.rejectDocument, "approval.withdrawn": ids.withdrawDocument, "approval.redrafted": ids.rejectDocument,
    "approval.settings.updated": ids.preference, "approval.delegation.created": ids.delegation, "approval.delegation.updated": ids.delegation, "approval.delegation.deleted": ids.delegation,
  };
  const auditActor = (event) => ["approval.approved", "approval.rejected"].includes(event) || event.startsWith("approval.delegation.") ? ids.approver : ids.author;
  return {
    rows: ownership.records.map(({ kind, id, ownerRunId }) => ({ kind, id, ownerRunId })),
    audits: AUDITS.map((event) => ({ event, actorId: auditActor(event), targetId: auditTarget[event], ownerRunId: runId })),
    documentStates: [
      { id: ids.approveDocument, lineId: ids.approveLine, status: "approved", lineStatus: "approved", actorId: ids.approver },
      { id: ids.rejectDocument, lineId: ids.rejectLine, status: "draft", lineStatus: "pending", actorId: ids.approver },
      { id: ids.withdrawDocument, lineId: ids.withdrawLine, status: "draft", lineStatus: "pending", actorId: ids.author },
    ],
    preference: { id: ids.preference, userId: ids.author, companyId, beforeVersion: 2, afterVersion: 3, rereadVersion: 3 },
    delegation: { id: ids.delegation, ownerId: ids.approver, delegateId: ids.delegate, companyId, versionBeforeUpdate: 1, versionAfterUpdate: 2, softDeleted: true },
    existingRowChanges: 0,
    ...overrides,
  };
}

function fingerprint(loginId, exists = true) { return exists ? { loginId, before: { exists: true, fingerprint: `${loginId}_fp` }, after: { exists: true, fingerprint: `${loginId}_fp` } } : { loginId, before: { exists: false }, after: { exists: false } }; }

function cleanupFixture(ownership, overrides = {}) {
  const identities = ownership.records.filter((record) => ["test_role", "test_user"].includes(record.kind));
  return {
    runId, residualOwnedRows: 0, residualOwnedAudit: 0, residualNotifications: 0, residualMonitoringEvents: 0, residualStorageObjects: 0,
    orderVerified: true, sessionsClosed: true, existingRowChanges: 0,
    disposableIdentities: identities.map((record) => ({ kind: record.kind, id: record.id, ownerRunId: runId, active: false, disposition: "soft_deleted" })),
    protectedAccounts: [fingerprint("admin"), fingerprint("cyhuh"), fingerprint("ysla", false)],
    existingApprovalFingerprint: { before: "approval_fp", after: "approval_fp" },
    ...overrides,
  };
}

function drivers(overrides = {}) {
  const ownership = overrides.ownership ?? ownershipFixture();
  let closeCalled = false;
  let cleanupCalled = false;
  return {
    browserDriver: {
      async runApprovalDocuments() { if (overrides.documentError) throw new Error("primary"); return overrides.documents ?? documentsFixture(); },
      async runApprovalBasicSettings() { return overrides.settings ?? settingsFixture(); },
      async runApprovalDelegations() { return overrides.delegations ?? delegationsFixture(); },
      async close() { closeCalled = true; },
    },
    dbDriver: {
      async prepareOwnedData() { return ownership; },
      async collectApprovalEvidence() { return overrides.db ?? dbFixture(ownership); },
      async cleanupOwnedData() { cleanupCalled = true; return overrides.cleanup ?? cleanupFixture(ownership); },
    },
    closeCalled: () => closeCalled,
    cleanupCalled: () => cleanupCalled,
  };
}

async function expectCode(code, setup) {
  await assert.rejects(runApproval({ manifest, runId, evidenceDir: "contract-evidence", ...setup }), (error) => String(error?.code ?? "").split(":", 1)[0] === code);
}

const checks = [];
await expectCode("LIVE_INPUT_REQUIRED", {}); checks.push("missing drivers");
const missingMethod = drivers(); delete missingMethod.browserDriver.runApprovalDelegations;
await expectCode("LIVE_INPUT_REQUIRED", missingMethod); checks.push("missing driver method");

const valid = drivers();
const validResult = await runApproval({ manifest, runId, evidenceDir: "contract-evidence", browserDriver: valid.browserDriver, dbDriver: valid.dbDriver });
assert.equal(validResult.status, "PASS"); assert.equal(valid.closeCalled(), true); assert.equal(valid.cleanupCalled(), true); checks.push("valid composite");

for (const [label, mutate, code] of [
  ["permission topology", (x) => x.records.find((r) => r.kind === "test_role").permissions.push("mail:read"), "IDENTITY_TOPOLOGY_INVALID"],
  ["three users", (x) => { x.records = x.records.filter((r) => r.id !== ids.delegate); }, "IDENTITY_TOPOLOGY_INVALID"],
  ["run-id purpose", (x) => { x.records.find((r) => r.id === ids.author).loginId = "foreign_author"; }, "IDENTITY_TOPOLOGY_INVALID"],
  ["foreign company", (x) => { x.records.find((r) => r.id === ids.delegate).companyId = "foreign"; }, "IDENTITY_TOPOLOGY_INVALID"],
]) {
  const ownership = ownershipFixture(); mutate(ownership); await expectCode(code, drivers({ ownership })); checks.push(label);
}

const protectedSession = documentsFixture(); protectedSession.sessions[0].activeLoginId = "admin";
await expectCode("PROTECTED_ACCOUNT_SESSION_REJECTED", drivers({ documents: protectedSession })); checks.push("protected session");
const missingDocument = documentsFixture(); missingDocument.documents.pop();
await expectCode("DOCUMENT_COMPOSITE_INCOMPLETE", drivers({ documents: missingDocument })); checks.push("three documents");
const missingAction = documentsFixture(); missingAction.actions = missingAction.actions.filter((x) => x !== "approval.reject");
await expectCode("DOCUMENT_ACTION_INCOMPLETE", drivers({ documents: missingAction })); checks.push("document actions");
const wrongTarget = documentsFixture(); wrongTarget.documents[0].approverId = ids.delegate;
await expectCode("DOCUMENT_TARGET_MISMATCH", drivers({ documents: wrongTarget })); checks.push("document target");

const extraNetworkField = documentsFixture(); extraNetworkField.network[0].duration = 3;
await expectCode("NETWORK_FIELDS_INVALID", drivers({ documents: extraNetworkField })); checks.push("network exact fields");
const queryNetwork = documentsFixture(); queryNetwork.network[0].path += "?page=1";
await expectCode("NETWORK_NOT_SAME_ORIGIN_RELATIVE", drivers({ documents: queryNetwork })); checks.push("same-origin queryless network");
const missingFamily = documentsFixture(); missingFamily.network = missingFamily.network.filter((x) => !x.path.endsWith("/audit"));
await expectCode("NETWORK_ROUTE_FAMILY_INCOMPLETE", drivers({ documents: missingFamily })); checks.push("route families");
const foreignMutation = documentsFixture(); foreignMutation.mutationOwnership[0].id = "foreign";
await expectCode("MUTATION_OWNERSHIP_MISMATCH", drivers({ documents: foreignMutation })); checks.push("mutation ownership");

const badSettingVersion = settingsFixture(); badSettingVersion.preference.afterVersion = 4;
await expectCode("BASIC_SETTING_VERSION_INVALID", drivers({ settings: badSettingVersion })); checks.push("basic setting version");
const badSettingReread = settingsFixture(); badSettingReread.preference.rereadAttachmentImageDisplay = "inline";
await expectCode("BASIC_SETTING_REREAD_MISMATCH", drivers({ settings: badSettingReread })); checks.push("basic setting reread");
const badDelegationTarget = delegationsFixture(); badDelegationTarget.delegation.delegateId = ids.author;
await expectCode("DELEGATION_TARGET_MISMATCH", drivers({ delegations: badDelegationTarget })); checks.push("delegation target");
const badDelegationVersion = delegationsFixture(); badDelegationVersion.delegation.versionAfterUpdate = 3;
await expectCode("DELEGATION_VERSION_INVALID", drivers({ delegations: badDelegationVersion })); checks.push("delegation version");
const badDelegationDelete = delegationsFixture(); badDelegationDelete.delegation.softDeleted = false;
await expectCode("DELEGATION_REREAD_MISMATCH", drivers({ delegations: badDelegationDelete })); checks.push("delegation soft delete");

const ownership = ownershipFixture();
const missingAudit = dbFixture(ownership); missingAudit.audits.pop();
await expectCode("AUDIT_EVIDENCE_INCOMPLETE", drivers({ ownership, db: missingAudit })); checks.push("ten audits");
const foreignAudit = dbFixture(ownership); foreignAudit.audits[0].actorId = ids.delegate;
await expectCode("AUDIT_ACTOR_TARGET_MISMATCH", drivers({ ownership, db: foreignAudit })); checks.push("audit actor target");
const missingRow = dbFixture(ownership); missingRow.rows.pop();
await expectCode("DB_EVIDENCE_NOT_RUN_OWNED", drivers({ ownership, db: missingRow })); checks.push("all owned rows");
await expectCode("EXISTING_ROW_CHANGED", drivers({ ownership, db: dbFixture(ownership, { existingRowChanges: 1 }) })); checks.push("existing rows unchanged");

const sensitiveDocuments = documentsFixture(); sensitiveDocuments[["to", "ken"].join("")] = "fixture-marker";
await expectCode("SENSITIVE_FIELD_REJECTED", drivers({ documents: sensitiveDocuments })); checks.push("sensitive fields");
const partial = settingsFixture({ status: "PARTIAL" });
await expectCode("APPROVAL_COMPOSITE_INCOMPLETE", drivers({ settings: partial })); checks.push("partial pass rejected");

await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: cleanupFixture(ownership, { residualOwnedAudit: 1 }) })); checks.push("cleanup residuals");
const activeCleanup = cleanupFixture(ownership); activeCleanup.disposableIdentities[0].active = true;
await expectCode("CLEANUP_INCOMPLETE", drivers({ cleanup: activeCleanup })); checks.push("identities inactive");
await expectCode("PROTECTED_ACCOUNT_CHANGED", drivers({ cleanup: cleanupFixture(ownership, { existingApprovalFingerprint: { before: "a", after: "b" } }) })); checks.push("protected fingerprints");

const primaryFailure = drivers({ documentError: true });
await expectCode("LIVE_EXECUTION_FAILED", primaryFailure);
assert.equal(primaryFailure.closeCalled(), true); assert.equal(primaryFailure.cleanupCalled(), true); checks.push("finally cleanup and close");

const evidenceDir = await mkdtemp(resolve(tmpdir(), "ui046-approval-"));
try {
  await mkdir(resolve(evidenceDir, "screenshots"), { recursive: true });
  for (const screenshot of SCREENSHOTS) await writeFile(resolve(evidenceDir, screenshot), "png", "utf8");
  await persistAreaEvidence({ result: validResult, directory: evidenceDir, selectedAreaId: "approval", selectedRunId: runId });
  const names = await readdir(evidenceDir);
  for (const name of manifest.evidence.requiredFiles) assert.ok(names.includes(name), `missing evidence file ${name}`);
  checks.push("six evidence files");
  const duplicate = clone(validResult); duplicate.screenshots[1] = duplicate.screenshots[0];
  await assert.rejects(persistAreaEvidence({ result: duplicate, directory: evidenceDir, selectedAreaId: "approval", selectedRunId: runId }), (error) => error.code === "SCREENSHOT_EVIDENCE_DUPLICATE");
  checks.push("screenshot duplicate rejected");
} finally { await rm(evidenceDir, { recursive: true, force: true }); }

assert.equal(manifest.areas.find((area) => area.id === "approval")?.adapter, "approval");
assert.equal(manifest.areas.find((area) => area.id === "approval")?.status, "READY");
checks.push("manifest ready");

console.log(JSON.stringify({ status: "PASS", passed: checks.length, total: checks.length, checks }));
